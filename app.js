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
  const kits = await api('kits');
  $('library').replaceChildren();
  for (const k of kits) $('library').append(button(k.title + (Date.parse(k.due) <= Date.now() ? ' · Due' : ''), () => show(k)));
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
    $('config').textContent = `Text AI: ${text} · Images: ${c.images ? 'configured' : 'needs setup'} · Speech: ${c.voice ? 'configured' : 'needs setup'} · Laya: ${c.laya ? 'connected' : 'optional, not configured'}`;
    $('techniques').replaceChildren(...c.techniques.map(t => el('p', t[1] + ': ' + t[2])));
    $('code').hidden = $('code-label').hidden = !c.signupCode;
    const me = await fetch('/api/me');
    if (me.ok) await showStudio((await me.json()).user); else showAuth();
  } catch (e) { status(e.message); }
}

// Carry over the quick draft saved on the landing page.
try {
  const draft = localStorage.getItem('recall-draft');
  if (draft && !$('source').value) { $('source').value = draft; status('Loaded the draft you saved on the home page.'); }
} catch {}

$('refresh').onclick = () => library().catch(e => status(e.message));
$('fresh').onclick = () => { current = null; $('kit').replaceChildren(); $('progress').replaceChildren(); $('source').value = ''; $('source').focus(); };

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
    const k = await createKit({ text: $('source').value, kind: $('kind').value, module: $('module').value, mode: $('mode').value, absurdity: $('absurdity').value });
    show(k);
    await library();
    status('Storyboard saved. Generate the images when ready.');
  } catch (e) { status(e.message); } finally { $('generate').disabled = false; }
};

async function generateImage(k, i) {
  k.scenes[i] = await api('kits/' + k.id + '/image', 'POST', { index: i });
}

function show(k) {
  current = k;
  const wrap = $('kit');
  wrap.replaceChildren();
  wrap.append(el('h2', k.title), el('p', (k.technique.name || k.technique.technique) + ' · ' + k.technique.reason));
  if (k.ai) wrap.append(el('p', 'Built with ' + k.ai.model + ' on ' + k.ai.platform + '.', 'built-with'));

  const grid = el('div', null, 'scenes');
  k.scenes.forEach((s, i) => {
    const card = el('article', null, 'scene');
    card.append(el('h3', 'Scene ' + (i + 1)));
    if (s.image) { const img = el('img'); img.src = s.image; img.alt = s.cue; card.append(img); }
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
  tools.append(button('Hide / show text hints', () => grid.classList.toggle('hidden-cues')));
  wrap.append(tools, grid);

  const training = el('div', null, 'review');
  training.append(el('h2', 'Practice recall'), el('p', 'Reproduce the source ' + (k.mode === 'exact' ? 'wording. Punctuation and case are ignored.' : 'meaning. AI evaluation is an estimate.')));
  const answer = el('textarea');
  answer.setAttribute('aria-label', 'Your recall answer');
  const feedback = el('p');
  training.append(answer, button('Check recall', async () => {
    const r = await api('kits/' + k.id + '/review', 'POST', { answer: answer.value });
    feedback.textContent = `${Math.round(r.score * 100)}% · ${r.feedback} Next review: ${new Date(r.due).toLocaleString()}`;
    await library();
  }), feedback);
  wrap.append(training);

  const trace = el('details');
  trace.append(el('summary', 'Agent workflow'));
  for (const t of k.trace) trace.append(el('p', t.agent + ': ' + JSON.stringify(t.output)));
  wrap.append(trace, button('Export kit JSON', () => {
    const u = URL.createObjectURL(new Blob([JSON.stringify(k, null, 2)], { type: 'application/json' }));
    const a = el('a');
    a.href = u; a.download = 'recall-' + k.id + '.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(u), 1000);
  }), button('Delete kit', async () => {
    if (confirm('Delete this saved memory kit?')) { await api('kits/' + k.id, 'DELETE'); wrap.replaceChildren(); await library(); }
  }));
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

init();
