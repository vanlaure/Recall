const $ = id => document.getElementById(id);
let current = null, recorder, stream;
const status = s => $('status').textContent = s;
const authHeaders = () => ({ 'Content-Type': 'application/json' });

async function api(path, method = 'GET', data) {
  const r = await fetch('/api/' + path, { method, headers: authHeaders(), ...(data ? { body: JSON.stringify(data) } : {}) });
  const b = await r.json();
  if (r.status === 401 && !['login', 'register', 'logout'].includes(path)) showAuth();
  if (!r.ok) throw Error(b.error);
  return b;
}

function el(tag, text, cls) {
  const e = document.createElement(tag);
  if (text) e.textContent = text;
  if (cls) e.className = cls;
  return e;
}
// A button that disables itself while its action runs and reports any error in the status line.
function button(text, fn) {
  const b = el('button', text);
  b.type = 'button';
  b.onclick = async () => { b.disabled = true; try { await fn(); } catch (e) { status(e.message); } finally { b.disabled = false; } };
  return b;
}

async function library() {
  kits = await api('kits');
  $('library').replaceChildren();
  $('kit-count').textContent = kits.length ? ' · ' + kits.length : '';
  if (!kits.length) $('library').append(el('p', 'No kits yet. Create one and it will be kept here.'));
  for (const k of kits) {
    const card = button('', () => show(k));
    card.className = 'kit-card';
    card.append(el('strong', k.title), el('span', (k.technique?.name || 'Memory kit') + ' · ' + k.scenes.length + (k.scenes.length === 1 ? ' scene' : ' scenes') + (dueDay(k) <= localDay() ? ' · due today' : ' · next ' + niceDay(dueDay(k)))));
    $('library').append(card);
  }
  renderToday();
  renderCalendar();
}

// --- Training: today's practice, the calendar, guided practice, cue rewrites and progress ---------------------------
let kits = [], calendarMonth = null;
const pad = n => String(n).padStart(2, '0');
const localDay = (d = new Date()) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const dueDay = k => k.dueDay || localDay(new Date(k.due));
const niceDay = day => new Date(day + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const percent = x => Math.round(x * 100) + '%';
// Reloads the library and re-opens the same kit with its fresh data.
async function refresh(k) { const tab = kitTab; await library(); const fresh = kits.find(x => x.id === k.id); if (fresh) { show(fresh); selectTab(tab); } return fresh; }

function renderToday() {
  const today = localDay(), due = kits.filter(k => dueDay(k) <= today), box = $('today');
  box.replaceChildren();
  $('due-count').textContent = due.length ? ' · ' + due.length + ' due' : '';
  if (!kits.length) return box.append(el('p', 'Create your first memory kit, then come back here to practise it.'));
  if (!due.length) {
    const next = kits.map(dueDay).sort()[0];
    return box.append(el('p', 'Nothing is due today. Your next session is ' + niceDay(next) + '.'));
  }
  for (const k of due) {
    const row = el('div', null, 'today-row');
    row.append(el('span', k.title + (k.targetDay ? ' · needed by ' + niceDay(k.targetDay) : '')), button('Practise', () => { show(k); startPractice(k, k.scenes.map((_, i) => i)); }));
    box.append(row);
  }
}

// Every past session and every coming practice day, keyed by day.
function calendarEvents() {
  const today = localDay(), days = new Map(), add = (day, e) => days.set(day, [...(days.get(day) || []), e]);
  for (const k of kits) {
    for (const r of k.reviews) add(r.day || localDay(new Date(r.date)), { kit: k, kind: 'done', score: r.score });
    const coming = new Set((k.plan || []).filter(d => d >= today));
    coming.add(dueDay(k) < today ? today : dueDay(k));
    for (const d of coming) add(d, { kit: k, kind: d === k.targetDay ? 'final' : 'planned' });
  }
  return days;
}
function renderCalendar() {
  const today = localDay(), events = calendarEvents(), box = $('calendar');
  calendarMonth ||= new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const year = calendarMonth.getFullYear(), month = calendarMonth.getMonth(), move = n => () => { calendarMonth = new Date(year, month + n, 1); renderCalendar(); };
  const bar = el('div', null, 'cal-bar'), grid = el('div', null, 'cal-grid');
  bar.append(button('← Earlier', move(-1)), el('strong', calendarMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })), button('Later →', move(1)));
  for (const name of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']) grid.append(el('div', name, 'cal-head'));
  const lead = (new Date(year, month, 1).getDay() + 6) % 7, count = new Date(year, month + 1, 0).getDate();
  for (let i = 0; i < lead; i++) grid.append(el('div', null, 'cal-day empty'));
  for (let d = 1; d <= count; d++) {
    const day = year + '-' + pad(month + 1) + '-' + pad(d), cell = el('div', null, 'cal-day' + (day === today ? ' is-today' : ''));
    cell.append(el('span', String(d), 'cal-num'));
    // Sessions already done come first; a crowded day shows three and counts the rest.
    const order = { done: 0, final: 1, planned: 2 }, list = (events.get(day) || []).sort((x, y) => order[x.kind] - order[y.kind]);
    for (const e of list.slice(0, 3)) {
      const text = e.kind === 'done' ? '✓ ' + percent(e.score) + ' ' + e.kit.title : e.kind === 'final' ? '★ ' + e.kit.title : e.kit.title;
      const chip = el('button', text, 'cal-chip ' + e.kind);
      chip.type = 'button'; chip.title = (e.kind === 'done' ? 'Practised: ' : e.kind === 'final' ? 'Needed by this day: ' : 'Practice planned: ') + e.kit.title;
      chip.onclick = () => show(e.kit);
      cell.append(chip);
    }
    if (list.length > 3) cell.append(el('span', '+' + (list.length - 3) + ' more', 'cal-more'));
    grid.append(cell);
  }
  box.replaceChildren(bar, grid);
  $('ics').href = '/api/calendar.ics?today=' + today;
}

// The date the learner needs this by, and the sessions planned up to it.
function planPanel(k) {
  const panel = el('div', null, 'plan'), date = el('input'), today = localDay();
  date.type = 'date'; date.min = today; date.value = k.targetDay || ''; date.setAttribute('aria-label', 'Need it by');
  const setTarget = target => async () => { await api('kits/' + k.id + '/target', 'POST', { targetDate: target(), today }); await refresh(k); status(target() ? 'Practice sessions planned.' : 'Date cleared.'); };
  const row = el('div', null, 'toolbar');
  row.append(el('span', 'Need it by '), date, button('Plan my practice', setTarget(() => date.value)));
  if (k.targetDay) row.append(button('Clear date', setTarget(() => null)));
  const coming = (k.plan || []).filter(d => d >= today);
  panel.append(el('h2', 'Training plan'), row, el('p', k.targetDay
    ? (coming.length ? coming.length + (coming.length === 1 ? ' session' : ' sessions') + ' to go: ' + coming.map(niceDay).join(', ') + '. The last is a final check on the day.' : 'The date has passed. Practice continues at widening gaps.')
    : 'Next session: ' + niceDay(dueDay(k) < today ? today : dueDay(k)) + '. Set a date to plan sessions that lead up to it; without one, the gap doubles after each good session.'));
  return panel;
}

// Guided practice: one scene at a time, from memory first, with hints only if asked for.
// `letters` starts every item with the first letter of each word showing, which counts as a hint.
function startPractice(k, indexes, { letters = false } = {}) {
  selectTab('practise');
  const stage = $('practice-stage');
  if (!stage) return;
  const answers = [];
  let pos = 0;
  const step = () => {
    const i = indexes[pos], s = k.scenes[i], card = el('div', null, 'practice-card'), reveal = el('div', null, 'practice-hints'), input = el('input');
    let hint = 0;
    const raise = level => { hint = Math.max(hint, level); };
    const first = s.source.trim().split(/\s+/), firstHint = first.length > 1 ? first[0] + ' …' : s.source.trim().slice(0, 2) + '…';
    const showLetters = () => { raise(4); reveal.append(el('p', 'First letters: ' + first.map(w => (w.match(/[\p{L}\p{N}]/u) || [''])[0]).join(' '))); };
    const hints = el('div', null, 'toolbar'), isReference = s.role === 'reference';
    // A names-and-faces kit asks its question with the learner's own photo.
    if (k.photo && !isReference) { const face = el('img'); face.src = k.photo; face.alt = 'The face to name'; face.className = 'face'; reveal.append(face); }
    if (s.image) hints.append(button('Show the picture', () => { raise(1); const img = el('img'); img.src = s.image; img.alt = 'Picture hint'; reveal.append(img); }));
    hints.append(button('Show the cue', () => { raise(2); reveal.append(el('p', s.cue, 'cue')); }), button('Show how it starts', () => { raise(3); reveal.append(el('p', 'It starts: ' + firstHint)); }));
    if (letters) showLetters(); else if (first.length > 2) hints.append(button('Show first letters', showLetters));
    input.type = 'text'; input.autocomplete = 'off'; input.setAttribute('aria-label', 'Your answer for item ' + (i + 1));
    const next = async () => {
      answers.push({ index: i, answer: input.value, hint });
      if (++pos < indexes.length) return step();
      status('Checking your answers…');
      const r = await api('kits/' + k.id + '/review', 'POST', { items: answers, today: localDay() });
      const fresh = await refresh(k);
      if (fresh) showResults(fresh, r);
      status('Practice saved.');
    };
    input.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); next().catch(err => status(err.message)); } };
    card.append(el('p', 'Item ' + (pos + 1) + ' of ' + indexes.length + (k.kind === 'list' ? ' · position ' + (i + 1) + ' in the list' : ' · line ' + (i + 1)), 'practice-count'),
      el('p', isReference ? 'Where is it from? Type the reference.' : k.photo ? 'Who is this? Type the name.' : k.mode === 'meaning' ? 'Say what it means, in your own words.' : 'Type it from memory. Ask for a hint only if you need one.'), input, hints, reveal,
      button(pos + 1 < indexes.length ? 'Next' : 'Finish and check', next));
    stage.replaceChildren(card);
    input.focus();
  };
  step();
  stage.scrollIntoView({ block: 'center' });
}

// The outcome of a guided session, item by item, with an offer to rewrite any cue that keeps failing.
function showResults(k, r) {
  const stage = $('practice-stage'), list = el('div', null, 'results'), hintName = ['no hint', 'picture', 'cue', 'first word', 'first letters'];
  list.append(el('p', r.feedback + ' Next practice: ' + niceDay(r.dueDay) + '.', 'practice-count'));
  for (const it of r.items) {
    const row = el('div', null, 'result ' + (it.correct ? 'right' : 'wrong'));
    row.append(el('strong', (it.correct ? '✓ ' : '✗ ') + it.source), el('span', it.correct ? (it.hint ? 'recalled with a hint (' + hintName[it.hint] + ')' : 'recalled unaided') : 'you answered: ' + (it.answer || 'nothing')));
    list.append(row);
  }
  stage.replaceChildren(list);
}
function repairOffer(k, i) {
  const box = el('div', null, 'repair');
  box.append(el('p', '“' + k.scenes[i].source + '” has been missed two sessions running. The cue may be the problem, not you.'), button('Rewrite this cue', async () => {
    status('Working out why this cue fails and writing a new one…');
    const r = await api('kits/' + k.id + '/repair', 'POST', { index: i });
    await refresh(k);
    status('Cue rewritten. ' + r.repair.explanation + ' Generate its new picture when ready.');
  }));
  return box;
}

function practicePanel(k) {
  const panel = el('div', null, 'review'), all = k.scenes.map((_, i) => i), weak = all.filter(i => (k.scenes[i].stats?.missStreak || 0) > 0), tools = el('div', null, 'toolbar'), stage = el('div');
  stage.id = 'practice-stage';
  tools.append(button('Practise all ' + all.length + (all.length === 1 ? ' item' : ' items'), () => startPractice(k, all)));
  if (weak.length && weak.length < all.length) tools.append(button('Practise the ' + weak.length + ' I missed', () => startPractice(k, weak)));
  if (all.length > 1) tools.append(button('In reverse order', () => startPractice(k, [...all].reverse())));
  if (k.mode !== 'meaning' && k.scenes.some(s => s.source.trim().split(/\s+/).length > 2)) tools.append(button('From first letters', () => startPractice(k, all, { letters: true })));
  panel.append(el('h2', 'Practice recall'), el('p', 'Guided practice asks for one item at a time. Hints are there if you need them, and recalling without one counts for more.'), tools, stage);
  for (const i of all.filter(i => (k.scenes[i].stats?.missStreak || 0) >= 2)) panel.append(repairOffer(k, i));

  const free = el('details'), answer = el('textarea'), feedback = el('p');
  answer.setAttribute('aria-label', 'Your recall answer');
  free.append(el('summary', 'Or type the whole thing from memory'), el('p', 'Reproduce the source ' + (k.mode === 'exact' ? 'wording. Punctuation and case are ignored.' : 'meaning. AI evaluation is an estimate.')), answer, button('Check recall', async () => {
    const r = await api('kits/' + k.id + '/review', 'POST', { answer: answer.value, today: localDay() });
    const text = percent(r.score) + ' · ' + r.feedback + ' Next practice: ' + niceDay(r.dueDay) + '.';
    await refresh(k);
    status(text);
  }), feedback);
  panel.append(free);
  return panel;
}

// What practice has shown so far: each session, and each item's record.
function progressPanel(k) {
  const panel = el('details', null, 'progress');
  panel.append(el('summary', 'Progress'));
  if (!k.reviews.length) { panel.append(el('p', 'No practice yet. Your sessions and each item\'s record will appear here.')); return panel; }
  const last = k.reviews.at(-1), guided = k.reviews.filter(r => r.mode === 'guided');
  panel.append(el('p', k.reviews.length + (k.reviews.length === 1 ? ' session' : ' sessions') + ' · last score ' + percent(last.score) + ' on ' + niceDay(last.day || localDay(new Date(last.date)))
    + (guided.length ? ' · ' + guided.at(-1).unaided + ' of ' + guided.at(-1).items.length + ' recalled without hints last time' : '') + ' · ' + k.streak + ' good ' + (k.streak === 1 ? 'session' : 'sessions') + ' in a row'));
  const chart = el('div', null, 'bars');
  chart.setAttribute('role', 'img');
  chart.setAttribute('aria-label', 'Score of each practice session: ' + k.reviews.map(r => percent(r.score)).join(', '));
  for (const r of k.reviews.slice(-24)) {
    const bar = el('div', null, 'bar'), fill = el('div', null, 'bar-fill');
    fill.style.height = Math.max(4, r.score * 100) + '%';
    bar.title = niceDay(r.day || localDay(new Date(r.date))) + ': ' + percent(r.score) + (r.mode === 'guided' ? ' (' + r.unaided + ' of ' + r.items.length + ' unaided)' : '');
    bar.append(fill);
    chart.append(bar);
  }
  panel.append(chart, el('p', 'Each bar is one session. These are scores on the day; they do not yet show how much you keep over weeks.', 'built-with'));
  if (k.scenes.some(s => s.stats)) {
    const table = el('table'), head = el('tr');
    head.append(el('th', 'Item'), el('th', 'Attempts'), el('th', 'Recalled'), el('th', 'Without hints'), el('th', 'Status'));
    table.append(head);
    for (const s of k.scenes) {
      const st = s.stats || { attempts: 0, recalled: 0, unaided: 0, missStreak: 0 }, row = el('tr');
      const state = !st.attempts ? 'not practised yet' : st.missStreak >= 2 ? 'needs a new cue' : st.missStreak === 1 ? 'missed last time' : st.unaided === st.attempts ? 'solid' : st.recalled === st.attempts ? 'recalled, with hints' : 'shaky';
      row.append(el('td', s.source.slice(0, 60)), el('td', String(st.attempts)), el('td', String(st.recalled)), el('td', String(st.unaided)), el('td', state + (s.repaired ? ' · cue rewritten' + (s.repaired > 1 ? ' ' + s.repaired + ' times' : '') : '')));
      table.append(row);
    }
    panel.append(table);
  }
  for (const r of k.repairs || []) panel.append(el('p', 'Cue rewritten for “' + r.source + '” on ' + niceDay(localDay(new Date(r.date))) + ' (' + r.diagnosis.replace(/_/g, ' ') + '): ' + r.explanation, 'built-with'));
  return panel;
}

// Accounts: the studio stays hidden until someone is logged in; each account sees only its own library.
function showAuth() {
  $('studio').hidden = true; $('auth').hidden = false; $('logout').hidden = true; $('who').textContent = '';
  $('kit').replaceChildren(); $('library').replaceChildren(); $('progress').replaceChildren();
}
async function showStudio(user) {
  $('auth').hidden = true; $('studio').hidden = false; $('logout').hidden = false;
  $('who').textContent = user.username;
  $('password').value = '';
  await library();
  nextDrill();
  await Promise.all([loadPalaces(), loadTracks()]).catch(e => status(e.message));
}
async function authenticate(path) {
  const authStatus = s => $('auth-status').textContent = s;
  try {
    authStatus(path === 'register' ? 'Creating your account…' : 'Logging in…');
    const r = await api(path, 'POST', { username: $('username').value, password: $('password').value, code: $('code').value });
    authStatus('');
    await showStudio(r.user);
    if (r.adopted) status('Welcome. ' + r.adopted + ' kit(s) saved before accounts existed are now in your library.');
  } catch (e) { authStatus(e.message); }
}
$('login').onsubmit = e => { e.preventDefault(); authenticate('login'); };
$('do-register').onclick = () => { if ($('login').reportValidity()) authenticate('register'); };
$('logout').onclick = async () => { try { await api('logout', 'POST', {}); } finally { showAuth(); } };

async function init() {
  try {
    const c = await api('config');
    const text = c.text ? c.textProvider.model.split('/').pop() + ' via ' + c.textProvider.label : 'needs setup (' + c.textProvider.label + ')';
    $('config').textContent = `Text AI: ${text} · Images: ${c.images ? 'configured' + (c.vision ? ', checked by ' + c.vision.split('/').pop() : ', not inspected') : 'needs setup'} · Speech: ${c.voice ? 'configured' : 'needs setup'} · Laya: ${c.laya ? 'connected' : 'optional, not configured'}`;
    $('techniques').replaceChildren(...c.techniques.map(t => el('p', t[1] + ': ' + t[2])));
    $('code').hidden = $('code-label').hidden = !c.signupCode;
    const me = await fetch('/api/me');
    if (me.ok) await showStudio((await me.json()).user); else showAuth();
  } catch (e) { status(e.message); }
}

// The studio is a set of pages: Create, Library, the open Kit, Training and Tools. The navigation switches between
// them; on a phone it is folded behind the Menu button.
const VIEWS = ['create', 'library', 'kit', 'training', 'tools'];
function setView(name) {
  const view = VIEWS.includes(name) && (name !== 'kit' || current) ? name : 'create';
  for (const v of VIEWS) $('view-' + v).hidden = v !== view;
  for (const a of document.querySelectorAll('#nav a')) a.setAttribute('aria-current', String(a.dataset.view === view));
  if (location.hash.slice(1) !== view) history.replaceState(null, '', '#' + view);
  setMenu(false);
}
function setMenu(open) {
  $('sidebar').classList.toggle('open', open);
  $('menu').setAttribute('aria-expanded', String(open));
}
$('menu').onclick = () => setMenu(!$('sidebar').classList.contains('open'));
for (const a of document.querySelectorAll('#nav a')) a.onclick = e => { e.preventDefault(); setView(a.dataset.view); scrollTo(0, 0); };
setView(location.hash.slice(1));
addEventListener('hashchange', () => setView(location.hash.slice(1)));

// Carry over the quick draft saved on the landing page.
try {
  const draft = localStorage.getItem('recall-draft');
  if (draft && !$('source').value) { $('source').value = draft; status('Loaded the draft you saved on the home page.'); }
} catch {}

$('refresh').onclick = () => library().catch(e => status(e.message));
$('fresh').onclick = () => { setView('create'); current = null; $('nav-kit').hidden = true; $('kit').replaceChildren(); $('progress').replaceChildren(); $('source').value = ''; $('source').focus(); };

// Shows each agent step as the server reports it: a row appears when a step starts and is completed in place when it finishes.
function showStep(step) {
  const list = $('progress');
  let row = [...list.children].reverse().find(r => r.dataset.agent === step.agent && r.dataset.status === 'started');
  if (!row) { row = el('li'); row.dataset.agent = step.agent; list.append(row); }
  row.dataset.status = step.status;
  row.replaceChildren(el('strong', step.agent), el('span', step.status === 'started' ? ' working…' + (step.detail ? ' (' + step.detail + ')' : '') : ' ' + (step.detail || 'done')));
}

// Creates a kit while reading the server's line-by-line progress stream.
async function createKit(input) {
  const r = await fetch('/api/kits', { method: 'POST', headers: { ...authHeaders(), Accept: 'application/x-ndjson' }, body: JSON.stringify(input) });
  if (!r.ok) throw Error((await r.json()).error);
  const reader = r.body.getReader(), decoder = new TextDecoder();
  let buffer = '', kit;
  for (;;) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const text of lines.filter(Boolean)) {
      const msg = JSON.parse(text);
      if (msg.type === 'step') showStep(msg);
      else if (msg.type === 'error') throw Error(msg.error);
      else if (msg.type === 'kit') kit = msg.kit;
    }
    if (done) break;
  }
  if (!kit) throw Error('The server stopped before the storyboard was finished.');
  return kit;
}

$('create').onsubmit = async e => {
  e.preventDefault();
  $('generate').disabled = true;
  $('progress').replaceChildren();
  $('kit').replaceChildren();
  status('Memory agents are building and reviewing your storyboard…');
  try {
    const file = $('photo').files[0], text = $('source').value;
    // A citation stays with the kit only while the wording is still exactly what was retrieved.
    const citation = found && found.text === text.trim() ? { url: found.url, label: [found.attribution, found.work, found.source].filter(Boolean).join(' · '), interlinear: found.interlinear } : undefined;
    const k = await createKit({ text, kind: $('kind').value, module: $('module').value, mode: $('mode').value, absurdity: $('absurdity').value, technique: $('technique').value, targetDate: $('target').value, today: localDay(),
      reference: $('reference').value, palace: $('palace').value, ...(file ? { photo: await photoData(file) } : {}), ...(citation ? { citation } : {}) });
    $('photo').value = '';
    show(k);
    await library();
    status('Storyboard saved. Generate the images when ready.');
  } catch (e) { status(e.message); } finally { $('generate').disabled = false; }
};

// How the technique was chosen: the facts code read, the decision model's typed answers, and the contract that was enforced.
function decisionPanel(k) {
  const d = k.decision, f = d.facts, panel = el('details', null, 'decision');
  const who = { learner: 'You chose the technique.', code: 'Decided by the facts of the material, without a model.', laya: 'Chosen by the decision model.', nemotron: 'Chosen by the Memory Expert' + (k.technique.escalated ? ', because: ' + k.technique.escalated : '.') }[k.technique.selectedBy] || '';
  panel.append(el('summary', 'How this technique was chosen'), el('p', who));
  const noted = [f.unitCount + (f.unitCount === 1 ? ' item' : ' items'), f.totalDigits ? f.totalDigits + ' digits' : 'no digits',
    f.digitsOnly && 'digits only', f.numbered && 'items numbered from 1', f.dated && 'each item starts with a year or number', f.translations && 'word-and-meaning pairs', f.titledNames && 'names with titles'].filter(Boolean);
  panel.append(el('p', 'Facts read by code: ' + noted.join(' · ') + '.'));
  if (d.answers?.length) {
    const table = el('table'), head = el('tr');
    head.append(el('th', 'Question put to the decision model'), el('th', 'Answer'), el('th', 'Certainty'));
    table.append(head);
    for (const a of d.answers) {
      const row = el('tr'), certainty = a.type === 'yes_no' ? Math.round((a.answer === 'yes' ? a.probability : 1 - a.probability) * 100) : Math.round(a.confidence * 100);
      row.append(el('td', a.question), el('td', String(a.answer).replace(/_/g, ' ')), el('td', certainty + '%'));
      table.append(row);
    }
    panel.append(table, el('p', 'The decision model is right about three times in four on our test material, so its answer is used only when it is confident and agrees with the facts.', 'built-with'));
  } else panel.append(el('p', d.error ? 'The decision model was unavailable.' : 'The decision model is not configured.'));
  if (k.contract) panel.append(el('p', 'Contract enforced by code: every scene keeps the source wording' + (k.contract.evidence_required === 'none' ? '' : ', supplies the ' + k.contract.name + ' evidence that code checks') + ', and no image prompt may ask for numerals, words, labels or logos.'));
  if (d.cueCheck?.checks) panel.append(el('p', 'Cue check (advisory): ' + d.cueCheck.checks.filter(c => c.matches).length + ' of ' + d.cueCheck.checks.length + ' cues were read back as their own item.'));
  return panel;
}

// What the image inspection found: accepted, kept for the learner to judge after repeated failures, or not inspected.
function reviewLine(r) {
  if (r.status === 'accepted') {
    const f = r.findings, parts = ['no text or logos', f.style === 'consistent' ? 'style consistent' : 'style close', f.required.length ? 'all ' + f.required.length + ' required objects present' : null, ...(r.notes || [])].filter(Boolean);
    return el('p', '✓ Image checked: ' + parts.join(', ') + (r.attempts > 1 ? ' (attempt ' + r.attempts + '; earlier: ' + r.rejected.map(x => x.join('; ')).join(' / ') + ')' : '') + '.', 'image-review ok');
  }
  if (r.status === 'needs_review') return el('p', '⚠ Needs your review. After ' + r.attempts + ' attempts the image still has: ' + r.issues.join('; ') + '. Regenerate it or judge it yourself.', 'image-review warn');
  return el('p', 'Image not inspected: ' + r.reason, 'image-review');
}

async function generateImage(k, i) {
  k.scenes[i] = await api('kits/' + k.id + '/image', 'POST', { index: i });
}

function show(k) {
  current = k;
  $('nav-kit').hidden = false;
  $('nav-kit').textContent = 'Open kit · ' + k.title.slice(0, 24);
  setView('kit');
  const wrap = $('kit');
  wrap.replaceChildren();
  wrap.append(el('h2', k.title), el('p', (k.technique.name || k.technique.technique) + ' · ' + k.technique.reason));
  if (k.ai) wrap.append(el('p', 'Built with ' + k.ai.model + ' on ' + k.ai.platform + '.', 'built-with'));
  if (k.reference || k.citation) {
    const from = el('p', k.reference ? 'From: ' + k.reference + '. ' : '');
    if (k.citation) from.append(link('Check the wording at its source', k.citation.url), el('span', k.citation.label ? ' (' + k.citation.label + ')' : ''));
    wrap.append(from);
  }
  if (k.palace) wrap.append(el('p', 'Placed along your palace “' + k.palace.name + '”: ' + k.contract.route.join(' → ') + '.', 'built-with'));
  if (k.photo) {
    const face = el('img'); face.src = k.photo; face.alt = 'Your photo for ' + k.title; face.className = 'face';
    wrap.append(face, el('p', k.face?.features?.length ? 'Feature the cue hooks onto: ' + k.face.features[0] + '.' : 'No feature was read from the photo, so the cue rests on the name alone.', 'built-with'));
  }
  if (k.decision) wrap.append(decisionPanel(k));

  const grid = el('div', null, 'scenes');
  k.scenes.forEach((s, i) => {
    const card = el('article', null, 'scene');
    card.append(el('h3', s.role === 'reference' ? 'Reference' : 'Scene ' + (i + 1)));
    if (s.image) { const img = el('img'); img.src = s.image; img.alt = s.cue; card.append(img); if (s.review) card.append(reviewLine(s.review)); }
    else card.append(el('p', 'Image not generated yet.', 'placeholder'));
    card.append(el('p', s.source, 'source'), el('p', s.cue, 'cue'));
    const detail = el('details');
    detail.append(el('summary', 'Image prompt'), el('p', s.prompt));
    card.append(detail, button(s.image ? 'Regenerate image' : 'Generate image', async () => {
      status('Generating scene ' + (i + 1) + '…');
      await generateImage(k, i);
      show(k);
      status('Image saved.');
    }));
    grid.append(card);
  });

  const missing = k.scenes.map((s, i) => s.image ? -1 : i).filter(i => i >= 0);
  const tools = el('div', null, 'toolbar');
  if (missing.length) tools.append(button('Generate all images (' + missing.length + ')', async () => {
    let made = 0;
    try {
      for (const i of missing) {
        status('Generating image ' + (made + 1) + ' of ' + missing.length + '…');
        await generateImage(k, i);
        made++;
        if (current === k) show(k);
      }
      status('All ' + made + ' images saved.');
    } catch (e) { if (current === k) show(k); throw Error(made + ' of ' + missing.length + ' images saved, then: ' + e.message); }
  }));
  tools.append(button('Hide / show text hints', () => grid.classList.toggle('hidden-cues')), button('Print cards', () => print()));
  wrap.append(tools, grid);
  if (/\d:\d/.test(k.reference || '')) wrap.append(languagePanel(k));

  wrap.append(planPanel(k), practicePanel(k), progressPanel(k));

  const trace = el('details');
  trace.append(el('summary', 'Agent workflow'));
  for (const t of k.trace) trace.append(el('p', t.agent + ': ' + JSON.stringify(t.output)));
  wrap.append(trace, button('Export kit JSON', () => {
    const u = URL.createObjectURL(new Blob([JSON.stringify(k, null, 2)], { type: 'application/json' }));
    const a = el('a');
    a.href = u; a.download = 'recall-' + k.id + '.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(u), 1000);
  }), button('Delete kit', async () => {
    if (confirm('Delete this saved memory kit?')) { await api('kits/' + k.id, 'DELETE'); wrap.replaceChildren(); current = null; $('nav-kit').hidden = true; await library(); setView('library'); }
  }));
  tabify(wrap);
}

// The open kit is split into tabs so each job has its own screen: the pictures, practice, progress, and the detail.
const TABS = [['storyboard', 'Storyboard'], ['practise', 'Practise'], ['progress', 'Progress'], ['details', 'Details']];
let kitTab = 'storyboard';
function selectTab(name) {
  kitTab = name;
  for (const b of document.querySelectorAll('#kit .tabs button')) b.setAttribute('aria-selected', String(b.dataset.tab === name));
  for (const p of document.querySelectorAll('#kit .tab-panel')) p.hidden = p.dataset.tab !== name;
}
function tabify(wrap) {
  const nodes = [...wrap.children], head = el('div', null, 'kit-head'), tabs = el('div', null, 'tabs'), panels = {};
  tabs.setAttribute('role', 'tablist');
  for (const [id, label] of TABS) {
    const b = el('button', label); b.type = 'button'; b.dataset.tab = id; b.setAttribute('role', 'tab'); b.onclick = () => selectTab(id);
    tabs.append(b);
    panels[id] = el('div', null, 'tab-panel'); panels[id].dataset.tab = id; panels[id].setAttribute('role', 'tabpanel');
  }
  let inHead = true;
  for (const node of nodes) {
    if (inHead && node.matches('h2, p, img.face')) { head.append(node); continue; }
    inHead = false;
    const tab = node.matches('.plan, .review') ? 'practise' : node.matches('details.progress') ? 'progress' : node.matches('details, button') ? 'details' : 'storyboard';
    if (tab !== 'storyboard' && node.matches('details')) node.open = true;
    panels[tab].append(node);
  }
  wrap.replaceChildren(head, tabs, ...Object.values(panels));
  selectTab(kitTab);
}

// Speech providers differ in the formats they accept, so every recording or upload is converted to 16 kHz mono WAV first.
async function toWav(blob) {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  try {
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    if (decoded.duration > 300) throw Error('Audio must be under 5 minutes.');
    const rate = 16000, off = new OfflineAudioContext(1, Math.max(1, Math.ceil(decoded.duration * rate)), rate), src = off.createBufferSource();
    src.buffer = decoded; src.connect(off.destination); src.start();
    const pcm = (await off.startRendering()).getChannelData(0), v = new DataView(new ArrayBuffer(44 + pcm.length * 2));
    const tag = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    tag(0, 'RIFF'); v.setUint32(4, 36 + pcm.length * 2, true); tag(8, 'WAVEfmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true);
    v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    tag(36, 'data'); v.setUint32(40, pcm.length * 2, true);
    for (let i = 0; i < pcm.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i])) * 32767, true);
    return new Blob([v], { type: 'audio/wav' });
  } finally { ctx.close(); }
}

async function transcribe(blob) {
  if (blob.size > 10000000) throw Error('Audio must be under 10 MB.');
  status('Transcribing audio. Review the words before creating.');
  try { blob = await toWav(blob); } catch (e) {
    if (/under 5 minutes/.test(e.message)) throw e;
    throw Error('This audio could not be read. Try a different recording or file.');
  }
  const data = await new Promise((resolve, reject) => {
    const f = new FileReader();
    f.onerror = reject; f.onload = () => resolve(f.result.split(',')[1]); f.readAsDataURL(blob);
  });
  const r = await api('transcribe', 'POST', { audio: data, mime: blob.type.split(';')[0] });
  $('source').value = r.text;
  status('Transcription ready. Please correct any errors.');
}

$('audio').onchange = async () => { try { if ($('audio').files[0]) await transcribe($('audio').files[0]); } catch (e) { status(e.message); } };

$('record').onclick = async () => {
  if (recorder?.state === 'recording') { recorder.stop(); return; }
  try {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) throw Error('Recording needs a supported browser on localhost or HTTPS. Upload audio instead.');
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const chunks = [];
    recorder = new MediaRecorder(stream);
    recorder.ondataavailable = e => chunks.push(e.data);
    recorder.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      $('record').textContent = '● Record voice';
      try { await transcribe(new Blob(chunks, { type: recorder.mimeType })); } catch (e) { status(e.message); }
    };
    recorder.start();
    $('record').textContent = '■ Stop recording';
    status('Recording… stop within 60 seconds.');
    setTimeout(() => { if (recorder.state === 'recording') recorder.stop(); }, 60000);
  } catch (e) { stream?.getTracks().forEach(t => t.stop()); status(e.message); }
};

// --- Research, references, palaces, faces, drills and import --------------------------------------------------------
// A link the learner can follow to check something; anything that is not a web address is shown as plain text.
function link(text, href) {
  if (!/^https?:\/\//.test(href || '')) return el('span', text);
  const a = el('a', text, 'cite');
  a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer';
  return a;
}

// The quotation or verse last taken from a research result, so its citation can travel with the kit.
let found = null;
const STANDING = { sourced: 'source given', unsourced: 'no source given on the page', disputed: 'listed as disputed', misattributed: 'listed as misattributed' };
async function find(query) {
  if (!query.trim()) return;
  status('The Research Agent is looking that up…');
  const r = await api('research', 'POST', { query, translation: $('translation').value }), box = $('found');
  box.replaceChildren();
  if (!r.results.length) { status(''); return box.append(el('p', 'Nothing was found for “' + r.looked_up + '”. Try the name of the person, book, film or song.')); }
  for (const q of r.results) {
    const card = el('div', null, 'found'), by = el('p', null, 'built-with');
    by.append(el('span', [q.attribution, q.work, q.source].filter(Boolean).join(' · ') + ' · ' + STANDING[q.status] + ' · '), link('check it', q.url));
    if (q.sourceUrl) by.append(el('span', ' · '), link('cited source', q.sourceUrl));
    card.append(el('p', q.text, 'quote'), by, button('Memorise this', () => {
      found = q;
      $('source').value = q.text; $('reference').value = q.attribution; $('kind').value = 'phrases'; $('mode').value = 'exact';
      if (r.kind === 'verse') $('module').value = 'Bible verses';
      status('Wording and reference filled in. Check the citation, then create the storyboard.');
      $('source').focus();
    }));
    box.append(card);
  }
  box.append(el('p', r.kind === 'verse' ? 'Verse wording is retrieved from a public-domain translation.' : 'Wording is read from Wikiquote, which anyone can edit. Follow the link to confirm it before you memorise it.', 'built-with'));
  status('');
}
$('find-go').onclick = () => find($('find').value).catch(e => status(e.message));
$('find').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); $('find-go').click(); } };
$('daily').onclick = () => { $('find').value = $('daily').dataset.reference || ''; $('find-go').click(); };
$('track').onchange = () => { if ($('track').value) { $('find').value = $('track').value; $('find-go').click(); } };
async function loadTracks() {
  const t = await api('tracks?today=' + localDay());
  $('daily').dataset.reference = t.daily;
  $('translation').replaceChildren(...Object.entries(t.translations).map(([id, name]) => { const o = el('option', name); o.value = id; return o; }));
  const first = el('option', 'Study tracks…'); first.value = '';
  $('track').replaceChildren(first, ...t.tracks.map(([name, references]) => {
    const group = el('optgroup'); group.label = name;
    group.append(...references.map(r => el('option', r)));
    return group;
  }));
}

// Original-language words for a verse. They are the model's own recollection, so they are shown as unchecked.
function languagePanel(k) {
  const panel = el('details', null, 'decision');
  panel.append(el('summary', 'Original-language words'));
  if (k.language) {
    const table = el('table'), head = el('tr');
    head.append(el('th', 'In the verse'), el('th', 'Original'), el('th', 'Said'), el('th', 'Meaning'));
    table.append(head);
    for (const w of k.language.words) { const row = el('tr'); row.append(el('td', w.english), el('td', w.original + ' (' + w.language + ')'), el('td', w.transliteration), el('td', w.gloss)); table.append(row); }
    const note = el('p', 'Written by the AI model from memory and not checked against a lexicon. ', 'built-with');
    if (k.citation?.interlinear) note.append(link('Check them in an interlinear', k.citation.interlinear));
    panel.append(table, note);
  }
  panel.append(button(k.language ? 'Ask again' : 'Show the Hebrew or Greek behind key words', async () => { status('Asking for the original-language words…'); await api('kits/' + k.id + '/language', 'POST', {}); await refresh(k); status('Original-language words added. They are not verified.'); }));
  return panel;
}

// A face photo is shrunk and re-encoded in the browser before it is sent, which also drops its location data.
async function photoData(file) {
  const bitmap = await createImageBitmap(file).catch(() => { throw Error('That photo could not be read. Use a JPEG, PNG or WebP image.'); });
  const scale = Math.min(1, 768 / Math.max(bitmap.width, bitmap.height)), canvas = el('canvas');
  canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', .85);
}

// Saved memory palaces: routes through places the learner already knows, reused from kit to kit.
async function loadPalaces() {
  const list = await api('palaces'), none = el('option', 'None'), chosen = $('palace').value;
  none.value = '';
  $('palace').replaceChildren(none, ...list.map(p => { const o = el('option', p.name + ' (' + p.places.length + ' places)'); o.value = p.id; return o; }));
  $('palace').value = list.some(p => p.id === chosen) ? chosen : '';
  $('palaces').replaceChildren(...(list.length ? list.map(p => {
    const row = el('div', null, 'today-row');
    row.append(el('span', p.name + ': ' + p.places.join(' → ')), button('Delete', async () => { if (confirm('Delete this palace? Kits already built on it keep their places.')) { await api('palaces/' + p.id, 'DELETE'); await loadPalaces(); } }));
    return row;
  }) : [el('p', 'No palaces yet. Name a route you know well, such as your home, and list its places in the order you walk them.')]));
}
$('palace-save').onclick = async () => {
  try {
    await api('palaces', 'POST', { name: $('palace-name').value, places: $('palace-places').value.split('\n') });
    $('palace-name').value = $('palace-places').value = '';
    await loadPalaces();
    status('Palace saved. Choose it under “Memory palace” when you create a kit.');
  } catch (e) { status(e.message); }
};

// Major-system drill: a number to put into words, or a word to read back as digits. Code checks the answer.
const DRILL_WORDS = ['tea', 'Noah', 'ray', 'law', 'shoe', 'key', 'fee', 'bee', 'toes', 'dad', 'tin', 'dime', 'tire', 'towel', 'dish', 'duck', 'dove', 'tub', 'nose', 'net', 'nun', 'name', 'nail', 'neck', 'knife', 'mouse', 'mat', 'moon', 'hammer', 'mule', 'match', 'movie', 'mop', 'rose', 'rat', 'rain', 'ram', 'roll', 'rock', 'roof', 'rope', 'lace', 'lid', 'lion', 'lime', 'lily', 'leaf', 'lip'];
function nextDrill() {
  const box = $('drill'), encode = Math.random() < .5, input = el('input'), result = el('p');
  const shown = encode ? String(Math.floor(Math.random() * 990) + 10) : DRILL_WORDS[Math.floor(Math.random() * DRILL_WORDS.length)];
  input.autocomplete = 'off'; input.setAttribute('aria-label', encode ? 'Words for the number' : 'Digits for the word');
  const check = async () => {
    const r = await api('drill', 'POST', encode ? { digits: shown, words: input.value } : { digits: input.value.replace(/\D/g, ''), words: shown });
    result.textContent = (r.correct ? '✓ Correct. ' : '✗ Not quite. ') + r.readings.map(x => x.word + ' reads as ' + (x.digits.filter(Boolean).join(' or ') || 'no digits')).join('; ') + '.';
  };
  input.onkeydown = e => { if (e.key === 'Enter') check().catch(err => { result.textContent = err.message; }); };
  box.replaceChildren(el('p', encode ? 'Give a word or words whose consonant sounds spell ' + shown + '.' : 'Which digits does “' + shown + '” stand for?'), input, button('Check', check), button('Another', nextDrill), result,
    el('p', '0 s/z · 1 t/d · 2 n · 3 m · 4 r · 5 l · 6 sh/ch/j · 7 k/g · 8 f/v · 9 p/b. Vowels and w, h, y do not count.', 'built-with'));
}

// Import a kit exported from Recall. It arrives as a fresh kit: no pictures and no practice history.
$('import').onchange = async () => {
  const file = $('import').files[0];
  if (!file) return;
  try {
    if (file.size > 5000000) throw Error('That file is too large to be a kit.');
    let data;
    try { data = JSON.parse(await file.text()); } catch { throw Error('This is not a Recall kit file.'); }
    const k = await api('kits/import', 'POST', { kit: data, today: localDay() });
    await library();
    show(kits.find(x => x.id === k.id) || k);
    status('Kit imported. Generate its images when ready.');
  } catch (e) { status(e.message); } finally { $('import').value = ''; }
};

init();
