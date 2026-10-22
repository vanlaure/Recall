import test from 'node:test';
import assert from 'node:assert/strict';
import { splitSource } from '../lib/memory.mjs';
import { createKit, reviewKit, repairScene, languageAids, importKit } from '../lib/orchestrate.mjs';
import { parseQuotes, verseReference, research } from '../lib/research.mjs';
import { TRACKS, daily } from '../lib/tracks.mjs';
import { contractIssues, contractFindings } from '../lib/validate.mjs';
import { withMocks, mocks, compliant, listen, startServer, client } from './helpers.mjs';

const VERSE = 'For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.';
const base = { module: 'Bible verses', mode: 'exact', absurdity: 'Playful' };
const groceries = { ...base, text: 'milk, eggs, bread', kind: 'list' };
const PHOTO = 'data:image/jpeg;base64,/9j/AAAA';

test('phrase beats split a verse at its clauses and join back to the exact wording', () => {
  const beats = splitSource(VERSE, 'phrases');
  assert.deepEqual(beats, ['For God so loved the world,', 'that he gave his only begotten Son,', 'that whosoever believeth in him should not perish,', 'but have everlasting life.']);
  assert.equal(beats.join(' '), VERSE);
  assert.deepEqual(splitSource(VERSE, 'passage'), [VERSE], 'a passage is still one scene per sentence');
  // A piece of fewer than three words stays with its neighbour, and a comma inside a number does not split.
  assert.deepEqual(splitSource('Yes, I paid 1,000 dollars for it, and gladly.', 'phrases'), ['Yes, I paid 1,000 dollars for it, and gladly.']);
  assert.deepEqual(splitSource('Ask not what your country can do for you; ask what you can do for your country.', 'phrases').length, 2);
});

test('a reference becomes its own scene under a Major contract that code verifies', () => withMocks({ laya: ['exact_wording', .9] }, async m => {
  const events = [];
  const kit = await createKit({ ...base, text: VERSE, kind: 'phrases', reference: 'John 3:16' }, e => events.push(e));
  assert.equal(kit.scenes.length, 5);
  const ref = kit.scenes.at(-1);
  assert.deepEqual([ref.role, ref.source, ref.evidence.words.join(' ')], ['reference', 'John 3:16', 'my dish']);
  assert.deepEqual([kit.reference, kit.referenceContract.primary_technique, kit.contract.source_units.length], ['John 3:16', 'major', 4]);
  assert.match(m.calls.storyboard[1].contract.note, /where the material comes from/);
  assert.ok(events.some(e => e.agent === 'Reference Contract check' && e.status === 'done'));
  // The whole verse is still graded against the verse alone.
  assert.equal((await reviewKit(kit, { answer: VERSE })).score, 1);
}));

test('a reference cue must be a picture that names its book, not just the encoding words', () => {
  const rules = { primary_technique: 'major', source_units: ['John 3:16'], must_name: 'John' };
  const scene = cue => [{ source: 'John 3:16', cue, prompt: 'a drawing', objects: ['dish'], evidence: { words: ['my', 'dish'] } }];
  assert.deepEqual(contractIssues(rules, scene('John carries my dish across a river')), []);
  assert.match(contractIssues(rules, scene('my dish')).join(' '), /little more than the encoding words.*does not name "John"/);
});

const badReference =s => { const b = compliant(s.contract); b.scenes[0].evidence.words = ['octopus']; b.scenes[0].cue = 'an octopus'; return b; };
test('a reference cue that never meets its contract is left out, and the kit is kept', () => withMocks({ laya: ['unordered_items', .9], storyboard: [null, badReference] }, async m => {
  const kit = await createKit({ ...groceries, reference: 'Aisle 316' });
  assert.equal(m.calls.storyboard.length, 4);
  assert.deepEqual([kit.scenes.length, kit.reference, kit.referenceContract], [3, 'Aisle 316', undefined]);
  assert.match(kit.trace.at(-1).output.error, /do not decode to 316/);
}));

test('a reference scene is rewritten under its own contract, and a content scene under the kit\'s', () => withMocks({ laya: ['unordered_items', .9] }, async m => {
  const kit = await createKit({ ...groceries, reference: 'Aisle 316' });
  for (const i of [1, 3]) kit.scenes[i].stats = { attempts: 2, recalled: 0, unaided: 0, missStreak: 2, answers: ['x'] };
  const r = await repairScene(kit, 3);
  assert.deepEqual([m.calls.repair[0].contract.primary_technique, m.calls.repair[0].scene_number, kit.scenes[3].role, r.scene.repaired], ['major', 1, 'reference', 1]);
  await repairScene(kit, 1);
  assert.deepEqual([m.calls.repair[1].contract.primary_technique, m.calls.repair[1].contract.source_units, m.calls.repair[1].scene_number], ['link', ['milk', 'eggs', 'bread'], 2]);
  // A list is scored on its items; the reference is not one of them.
  assert.equal((await reviewKit(kit, { answer: 'milk eggs bread' })).score, 1);
}));

test('a saved palace fixes the route: its places are required in order, and too few places are refused first', () => withMocks({ laya: ['digits', .99] }, async m => {
  const palaces = [{ id: 'short', name: 'Flat', places: ['hall', 'sofa'] }, { id: 'home', name: 'Home', places: ['place a', 'place b', 'place c', 'place d'] }, { id: 'other', name: 'Office', places: ['hall', 'sofa', 'fridge'] }];
  await assert.rejects(createKit({ ...groceries, palaces, palace: 'short' }), /This palace has 2 places and the material has 3 items/);
  await assert.rejects(createKit({ ...groceries, palaces, palace: 'gone' }), /palace was not found/);
  assert.equal(m.calls.storyboard.length, 0);
  const kit = await createKit({ ...groceries, palaces, palace: 'home' });
  assert.deepEqual([kit.technique.technique, kit.technique.selectedBy, kit.contract.route, kit.palace], ['loci', 'learner', ['place a', 'place b', 'place c'], { id: 'home', name: 'Home' }]);
  assert.match(kit.contract.evidence_required, /exactly the contract\.route place/);
  await assert.rejects(createKit({ ...groceries, palaces, palace: 'other' }), /evidence\.location must be the learner's own place for this scene, "hall"/);
}));

test('when a route is chosen automatically, the learner\'s own long-enough palace is used, and the expert is told one exists', () => withMocks({ expert: { technique: 'loci', reason: 'a route helps.' } }, async m => {
  const palaces = [{ id: 'short', name: 'Flat', places: ['hall', 'sofa'] }, { id: 'home', name: 'Home', places: ['place a', 'place b', 'place c'] }];
  const kit = await createKit({ ...groceries, palaces });
  assert.equal(m.calls.expert[0].learner.has_familiar_route, true);
  assert.deepEqual([kit.technique.selectedBy, kit.contract.route, kit.palace.name], ['nemotron', ['place a', 'place b', 'place c'], 'Home']);
  assert.match(kit.technique.reason, /a route helps\. Your saved palace “Home” is used as the route\./);
  const none = await createKit({ ...groceries, palaces: palaces.slice(0, 1) });
  assert.deepEqual([none.contract.route, none.palace, m.calls.expert[1].learner.has_familiar_route], [undefined, undefined, false]);
}));

test('each decision records the checkpoint, its revision and device, and the authority it had', () => withMocks({ laya: ['unordered_items', .9] }, async () => {
  const d = (await createKit(groceries)).decision;
  assert.deepEqual([d.checkpoint, d.repo, d.revision, d.device, d.modes, d.policy_version, d.question_version], ['english', 'test/laya', 'rev-1', 'cpu', { technique: 'enforced', cue_check: 'advisory', repair: 'advisory' }, '1', '1']);
}));

test('a contract failure is a record: the check, the scene, what was expected and observed, and the repair it needs', () => withMocks({ laya: ['digits', .9], storyboard: [s => { const b = compliant(s.contract); b.scenes[0].evidence.words = ['octopus']; b.scenes[0].cue = 'an octopus juggles on a ball'; b.scenes[1].prompt = 'a clock showing 3:16'; return b; }, null] }, async m => {
  const kit = await createKit({ ...base, text: '8472, 1066', kind: 'list' });
  const sent = m.calls.storyboard[1].findings;
  assert.deepEqual(sent.map(f => [f.check, f.scene, f.repair]), [['technique.major', 1, 'fix_encoding'], ['image.prompt', 2, 'rewrite_prompt']]);
  assert.match(sent[0].expected, /consonant sounds must spell exactly the digits/);
  assert.match(sent[0].observed, /^the words "octopus" do not decode to 8472/);
  assert.equal(kit.trace.find(t => t.agent === 'Contract check').output.findings[1].source, '1066');
  assert.deepEqual(contractFindings(kit.contract, kit.scenes), []);
}));

test('a system the learner has not said they know is flagged for teaching, and one they do not know is not offered', () => withMocks({ expert: { technique: 'visual', reason: 'x' } }, async m => {
  const digits = { ...base, text: '8472', kind: 'list' };
  assert.deepEqual((await createKit(digits)).teach, { technique: 'major', name: 'Major system', known: 'unknown' });
  assert.equal((await createKit({ ...digits, knows: { major: false } })).teach.known, 'no');
  assert.equal((await createKit({ ...digits, knows: { major: true } })).teach, undefined);
  assert.equal((await createKit({ ...digits, technique: 'major' })).teach, undefined, 'the learner\'s own choice is not second-guessed');
  await createKit({ ...groceries, knows: { pegs: false, pao: true } });
  const asked = m.calls.expert.at(-1);
  assert.ok(!asked.catalog.some(t => t.id === 'peg') && asked.catalog.some(t => t.id === 'link'));
  assert.deepEqual([asked.learner.knows_number_code, asked.learner.has_established_pegs, asked.learner.knows_person_action_object], ['unknown', false, true]);
}));

test('a cue rewrite records the decision model\'s reading of the cause, and follows it only when enforced', () => withMocks({ laya: ['unordered_items', .9] }, async m => {
  const failing = async () => { const kit = await createKit(groceries); kit.scenes[1].stats = { attempts: 3, recalled: 1, unaided: 0, missStreak: 2, answers: ['cheese'] }; return kit; };
  let kit = await failing();
  const advisory = (await repairScene(kit, 1)).repair;
  assert.match(m.calls.laya.at(-1).state, /^Source: eggs\nCue: .*\nAttempts: 3, recalled: 1, without hints: 0\nThe learner answered: cheese$/);
  assert.deepEqual([advisory.diagnosedBy, advisory.diagnosis, advisory.decision.mode, typeof advisory.decision.choice, m.calls.repair[0].diagnosis_required], ['nemotron', 'cue_ambiguity', 'advisory', 'string', undefined]);
  await withEnv({ LAYA_REPAIR_MODE: 'enforced' }, async () => {
    kit = await failing();
    const enforced = (await repairScene(kit, 1)).repair;
    assert.deepEqual([enforced.diagnosedBy, enforced.diagnosis, m.calls.repair.at(-1).diagnosis_required], ['laya', enforced.decision.choice, enforced.decision.choice]);
  });
}));

async function withEnv(vars, fn) {
  Object.assign(process.env, vars);
  try { return await fn(); } finally { for (const k of Object.keys(vars)) delete process.env[k]; }
}

test('in advisory mode the decision model\'s answer is recorded but the Memory Expert chooses', () => withEnv({ LAYA_TECHNIQUE_MODE: 'advisory' }, () => withMocks({ laya: ['unordered_items', .99], expert: { technique: 'story', reason: 'x' } }, async m => {
  const kit = await createKit(groceries);
  assert.deepEqual([kit.technique.technique, kit.technique.selectedBy, kit.decision.modes.technique, kit.decision.answers[0].answer], ['story', 'nemotron', 'advisory', 'unordered_items']);
  assert.match(kit.technique.escalated, /advisory for technique selection; it answered "unordered_items" \(99%\)/);
  assert.equal(m.calls.expert[0].diagnosis[0].answer, 'unordered_items');
})));

test('a decision made on truncated material is not used', () => withMocks({ laya: ['unordered_items', .99, 'truncated'] }, async () => {
  const kit = await createKit(groceries);
  assert.deepEqual([kit.technique.selectedBy, kit.decision.configured, kit.decision.answers], ['nemotron', true, []]);
  assert.match(kit.decision.error, /truncated/);
}));

// A route cue that names an earlier item instead of its own.
const strayCue = s => { const b = compliant(s.contract); b.scenes[1].cue = 'milk at place b'; return b; };
test('an enforced cue check sends a stray cue back once, and records the outcome honestly', () => withEnv({ LAYA_CUE_MODE: 'enforced' }, async () => {
  await withMocks({ laya: ['unordered_items', .9], storyboard: [strayCue, null] }, async m => {
    const kit = await createKit({ ...groceries, technique: 'loci' });
    assert.equal(m.calls.storyboard.length, 2);
    assert.match(m.calls.storyboard[1].issues[0], /^Scene 2: read on its own, this cue points to "milk" rather than its own item, "eggs"/);
    assert.deepEqual([kit.decision.cueCheck.advisory, kit.decision.cueCheck.status, kit.scenes[1].cue], [false, 'passed', 'cue for eggs at place b']);
  });
  await withMocks({ laya: ['unordered_items', .9], storyboard: [strayCue] }, async m => {
    const kit = await createKit({ ...groceries, technique: 'loci' });
    assert.deepEqual([m.calls.storyboard.length, kit.decision.cueCheck.status], [2, 'unresolved']);
  });
}));
test('by default the cue check stays advisory and sends nothing back', () => withMocks({ laya: ['unordered_items', .9], storyboard: [strayCue] }, async m => {
  const kit = await createKit({ ...groceries, technique: 'loci' });
  assert.deepEqual([m.calls.storyboard.length, kit.decision.cueCheck.advisory, kit.decision.cueCheck.status, kit.contract.schema_version], [1, true, undefined, '1']);
}));

test('a face photo is read for a feature, and the name\'s cue must attach to it', () => withMocks({ laya: ['name_face', .9], face: ['round glasses', 'beard'] }, async m => {
  const events = [];
  const kit = await createKit({ ...base, text: 'Dr. Okafor', kind: 'passage', photo: PHOTO, technique: 'loci' }, e => events.push(e));
  assert.deepEqual([m.calls.face, kit.face.features, kit.contract.face_feature, kit.technique.technique], [[PHOTO], ['round glasses', 'beard'], 'round glasses', 'keyword']);
  assert.match(kit.scenes[0].cue, /round glasses/);
  assert.equal(events.find(e => e.agent === 'Face reader' && e.status === 'done').detail, 'hook: round glasses');
  assert.ok(!JSON.stringify(kit).includes(PHOTO), 'the photo itself is not stored inside the kit');
  const ignores = s => { const b = compliant(s.contract); b.scenes[0].cue = 'cue for Dr. Okafor soundalike'; return b; };
  await withMocks({ laya: ['name_face', .9], storyboard: [ignores] }, () => assert.rejects(createKit({ ...base, text: 'Dr. Okafor', kind: 'passage', photo: PHOTO }), /does not attach the name to the feature seen on the face, "curly hair"/));
  await assert.rejects(createKit({ ...base, text: 'Ann. Bob.', kind: 'passage', photo: PHOTO }), /enter just that person's name/);
  await assert.rejects(createKit({ ...base, text: 'Ann', kind: 'passage', photo: 'data:text/html;base64,AAAA' }), /JPEG, PNG or WebP/);
}));

test('without a vision model a face kit is still built, on the name alone', () => withMocks({ laya: ['name_face', .9], vision: null }, async () => {
  const kit = await createKit({ ...base, text: 'Dr. Okafor', kind: 'passage', photo: PHOTO });
  assert.deepEqual([kit.face.features, kit.contract.face_feature], [[], undefined]);
}));

const PAGE = `'''Jim Croce''' was a singer.
== Song lyrics ==
=== ''[[w:Life and Times|Life and Times]]'' (1973) ===
* If I could save [[time]] in a bottle,<br>The first thing that I'd like to do
** "[[w:Time in a Bottle|Time in a Bottle]]", in [http://example.org/lyrics the album notes]
* '''You don't tug on Superman's cape.'''
* Short
== Misattributed ==
* A line he never said, at all.
** Often quoted online
== Quotes about Croce ==
* He was a wonderful writer of songs.
== External links ==
* [http://example.org Official site of the artist]`;

test('a quotation page is read into quotations with their work, source and standing', () => {
  assert.deepEqual(parseQuotes(PAGE), [
    { text: 'If I could save time in a bottle,\nThe first thing that I\'d like to do', section: 'Life and Times (1973)', source: '"Time in a Bottle", in the album notes', sourceUrl: 'http://example.org/lyrics', status: 'sourced' },
    { text: 'You don\'t tug on Superman\'s cape.', section: 'Life and Times (1973)', source: '', sourceUrl: null, status: 'unsourced' },
    { text: 'A line he never said, at all.', section: 'Misattributed', source: 'Often quoted online', sourceUrl: null, status: 'misattributed' },
  ]);
  assert.deepEqual(['get me John 3:16 please', 'Read 1 Corinthians 13:4-7', 'Song of Solomon 2:4', 'a quote by Jim Croce'].map(verseReference), ['John 3:16', '1 Corinthians 13:4-7', 'Song of Solomon 2:4', null]);
});

// Stand-ins for the quotation reference and the verse source.
async function sources() {
  const seen = [];
  const s = await listen(url => {
    seen.push(decodeURIComponent(url));
    if (url.includes('list=search')) return [200, { query: { search: [{ title: 'Empty page' }, { title: 'Jim Croce' }] } }];
    if (url.includes('action=parse')) return [200, { parse: { title: url.includes('Empty') ? 'Empty page' : 'Jim Croce', wikitext: { '*': url.includes('Empty') ? 'No quotations here.' : PAGE } } }];
    if (url.startsWith('/John')) return [200, { reference: 'John 3:16', text: ' For God so loved\n the world.\n', verses: [{ book_name: 'John', chapter: 3, verse: 16 }] }];
    return [404, { error: 'not found' }];
  });
  return { seen, env: { WIKIQUOTE_BASE_URL: s.url, BIBLE_BASE_URL: s.url }, close: s.close };
}
async function withSources(script, fn) {
  const src = await sources();
  Object.assign(process.env, src.env);
  try { return await withMocks(script, m => fn(m, src)); } finally { src.close(); delete process.env.WIKIQUOTE_BASE_URL; delete process.env.BIBLE_BASE_URL; }
}

test('the Research Agent looks up and chooses; the wording and citation come from the source', () => withSources({ picks: [1, 99, 'x', 1, 3] }, async (m, src) => {
  const r = await research('get me a famous quote by Jim Croche');
  assert.deepEqual([r.kind, r.looked_up, r.page], ['quotes', 'Jim Croce', { title: 'Jim Croce', url: 'https://en.wikiquote.org/wiki/Jim_Croce' }]);
  assert.deepEqual(r.results.map(q => [q.text.split('\n')[0], q.status, q.work]), [['If I could save time in a bottle,', 'sourced', 'Life and Times (1973)'], ['A line he never said, at all.', 'misattributed', 'Misattributed']]);
  assert.deepEqual([r.results[0].source, r.results[0].sourceUrl, r.results[0].attribution], ['"Time in a Bottle", in the album notes', 'http://example.org/lyrics', 'Jim Croce']);
  assert.ok(src.seen.some(u => u.includes('srsearch=Jim Croce')), 'the corrected name was searched, not the typed one');
  // The chooser sees numbered candidates and never the reverse: its state has no free-text answer field to fill.
  assert.deepEqual(m.calls.research[1].candidates.map(c => c.n), [1, 2, 3]);
}));

test('with no usable pick the page\'s first quotations are shown, and a verse reference skips the model', () => withSources({ picks: 'none' }, async (m, src) => {
  assert.equal((await research('Jim Croce')).results.length, 3);
  const before = m.calls.research.length;
  const v = await research('John 3:16', 'web');
  assert.equal(m.calls.research.length, before);
  assert.deepEqual([v.kind, v.results[0].text, v.results[0].attribution, v.results[0].work], ['verse', 'For God so loved the world.', 'John 3:16', 'World English Bible, public domain']);
  assert.deepEqual([v.results[0].url, v.results[0].interlinear], ['https://www.biblegateway.com/passage/?search=John%203%3A16&version=WEB', 'https://biblehub.com/interlinear/john/3-16.htm']);
  assert.ok(src.seen.some(u => u === '/John 3:16?translation=web'));
  await assert.rejects(research(''), /1–300 characters/);
}));

// A stand-in for Tavily: records each search and answers by the domains it was limited to; `fail` makes it error.
async function withTavily(fail, fn) {
  const searches = [];
  const t = await listen((url, body) => {
    searches.push(body);
    if (fail) return [500, { error: 'down' }];
    if (body.include_domains.includes('en.wikiquote.org')) return [200, { results: [{ url: 'https://en.wikiquote.org/wiki/Talk:Jim_Croce', title: 'Talk' }, { url: 'https://en.wikiquote.org/wiki/Jim_Croce', title: 'Jim Croce - Wikiquote', content: 'a paraphrase that must never be shown' }] }];
    return [200, { results: [{ url: 'https://www.biblegateway.com/passage/?search=John+3', title: 'John 3:16 - King James Version', content: 'For God so loved...' }] }];
  });
  Object.assign(process.env, { TAVILY_BASE_URL: t.url, TAVILY_API_KEY: 'tvly-test' });
  try { return await fn(searches); } finally { t.close(); delete process.env.TAVILY_BASE_URL; delete process.env.TAVILY_API_KEY; }
}

test('Tavily finds the Wikiquote page; the wording is still read from Wikiquote itself', () => withSources({ picks: [1] }, (m, src) => withTavily(false, async searches => {
  const r = await research('a famous quote by Jim Croce');
  assert.equal(r.found_by, 'tavily');
  assert.deepEqual(searches[0].include_domains, ['en.wikiquote.org']);
  assert.match(searches[0].query, /Jim Croce/);
  assert.ok(!src.seen.some(u => u.includes('list=search')), 'Wikiquote search is not needed when Tavily found the page');
  assert.ok(src.seen.some(u => u.includes('page=Jim Croce')) && !src.seen.some(u => u.includes('Talk:')), 'talk pages are skipped');
  assert.equal(r.results[0].text.split('\n')[0], 'If I could save time in a bottle,');
  assert.ok(!JSON.stringify(r).includes('paraphrase'), 'search snippets never reach the learner');
})));

test('Tavily names a described passage, whose wording comes from the public-domain source', () => withSources({}, (m, src) => withTavily(false, async searches => {
  const v = await research('the verse about God loving the world', 'kjv');
  assert.deepEqual([v.kind, v.found_by, v.looked_up, v.identified_at], ['verse', 'tavily', 'John 3:16', 'https://www.biblegateway.com/passage/?search=John+3']);
  assert.equal(v.results[0].text, 'For God so loved the world.');
  assert.deepEqual(searches[0].include_domains, ['biblegateway.com', 'biblehub.com', 'openbible.info']);
  // A cited reference never needs a search.
  const before = searches.length;
  assert.equal((await research('John 3:16')).found_by, 'reference');
  assert.equal(searches.length, before);
})));

test('if Tavily fails, the Research Agent falls back to Wikiquote search', () => withSources({ picks: [1] }, (m, src) => withTavily(true, async () => {
  const r = await research('a famous quote by Jim Croce');
  assert.equal(r.found_by, 'wikiquote');
  assert.ok(src.seen.some(u => u.includes('srsearch=Jim Croce')));
  assert.equal(r.results.length, 1);
})));

test('original-language aids keep only words that are in the verse, and are stored as unverified', () => withMocks({ language: { words: [{ english: 'loved', original: 'ἠγάπησεν', transliteration: 'ēgapēsen', language: 'Greek', gloss: 'loved' }, { english: 'grace', original: 'χάρις', transliteration: 'charis', language: 'Greek', gloss: 'favour' }] } }, async () => {
  const kit = { reference: 'John 3:16', text: VERSE };
  const aids = await languageAids(kit);
  assert.deepEqual([aids.verified, aids.words.map(w => w.english)], [false, ['loved']]);
  await assert.rejects(languageAids({ reference: 'Jim Croce', text: 'x' }), /need a kit with a verse reference/);
}));

test('study tracks hold references only, and the daily verse is stable for a day', () => {
  assert.ok(TRACKS.every(t => t[1].length === 5 && t[1].every(r => verseReference(r) === r)));
  assert.equal(daily('2026-10-02'), daily('2026-10-02'));
  assert.notEqual(daily('2026-10-02'), daily('2026-10-03'));
});

test('an exported kit can be imported as a fresh kit, and other files are refused', () => withMocks({ laya: ['unordered_items', .9] }, async () => {
  const kit = await createKit({ ...groceries, reference: 'Aisle 316' });
  kit.scenes[0].image = '/api/images/x.jpg'; kit.reviews.push({ score: 1 });
  const copy = importKit(JSON.parse(JSON.stringify(kit)), '2026-10-02');
  assert.notEqual(copy.id, kit.id);
  assert.deepEqual([copy.scenes.map(s => s.source), copy.scenes.map(s => s.image), copy.reviews, copy.scenes[3].role], [['milk', 'eggs', 'bread', 'Aisle 316'], [null, null, null, null], [], 'reference']);
  assert.deepEqual([copy.contract.primary_technique, copy.contract.source_units, copy.referenceContract.primary_technique, copy.technique.selectedBy], ['link', ['milk', 'eggs', 'bread'], 'major', 'import']);
  for (const bad of [null, {}, { text: 'x', scenes: [] }, { text: 'x', scenes: [{ source: 'x' }] }, { text: 'x', scenes: [{ source: 5, cue: 'c', prompt: 'p' }] }]) assert.throws(() => importKit(bad), /not a Recall kit file|Missing/);
}));

test('the server saves palaces per account, runs the Major drill in code, imports kits and stores a face photo', async () => {
  const m = await mocks({ laya: ['name_face', .9], jpeg: '/9j/AAAA' }), s = await startServer(3097, m.env);
  try {
    const alice = client(s.base), bob = client(s.base);
    await alice.register('alice'); await bob.register('bobby');
    // Palaces
    assert.equal((await alice.json('/api/palaces', 'POST', { name: 'Home', places: ['door'] })).status, 400);
    assert.match((await alice.json('/api/palaces', 'POST', { name: 'Home', places: ['door', 'Door'] })).body.error, /must be different/);
    const palace = (await alice.json('/api/palaces', 'POST', { name: 'Home', places: ['place a', 'place b', 'place c'] })).body;
    assert.deepEqual([(await alice.json('/api/palaces')).body.length, (await bob.json('/api/palaces')).body.length], [1, 0]);
    const kit = (await alice.json('/api/kits', 'POST', { ...groceries, palace: palace.id, route: ['x', 'y', 'z'] })).body;
    assert.deepEqual([kit.contract.route, kit.palace], [['place a', 'place b', 'place c'], { id: palace.id, name: 'Home' }]);
    assert.match((await bob.json('/api/kits', 'POST', { ...groceries, palace: palace.id })).body.error, /palace was not found/);
    assert.equal((await alice.json('/api/palaces/' + palace.id, 'DELETE')).body.deleted, true);
    assert.equal((await alice.json('/api/palaces')).body.length, 0);
    // Profile: only true/false answers are kept, per account, and they reach kit creation.
    assert.deepEqual((await alice.json('/api/profile')).body, { knows: {} });
    assert.deepEqual((await alice.json('/api/profile', 'POST', { knows: { major: true, pegs: 'yes', pao: false, other: true } })).body, { knows: { major: true, pao: false } });
    assert.deepEqual([(await alice.json('/api/profile')).body.knows, (await bob.json('/api/profile')).body.knows], [{ major: true, pao: false }, {}]);
    assert.deepEqual([(await alice.json('/api/kits', 'POST', { ...base, text: '8472', kind: 'list' })).body.teach, (await bob.json('/api/kits', 'POST', { ...base, text: '8472', kind: 'list' })).body.teach?.known], [undefined, 'unknown']);
    // Drill
    assert.deepEqual((await alice.json('/api/drill', 'POST', { digits: '316', words: 'my dish' })).body, { correct: true, readings: [{ word: 'my', digits: ['3'] }, { word: 'dish', digits: ['16'] }] });
    assert.equal((await alice.json('/api/drill', 'POST', { digits: '317', words: 'my dish' })).body.correct, false);
    assert.equal((await alice.json('/api/drill', 'POST', { digits: 'abc', words: 'my' })).status, 400);
    // Import
    const imported = await alice.json('/api/kits/import', 'POST', { kit, today: '2026-10-02' });
    assert.deepEqual([imported.status, imported.body.id !== kit.id, (await alice.json('/api/kits')).body.length], [201, true, 3]);
    assert.equal((await alice.json('/api/kits/import', 'POST', { kit: { nope: 1 } })).status, 400);
    // Face photo: stored as a file only its owner can load, and removed with the kit.
    const faceKit = (await alice.json('/api/kits', 'POST', { ...base, text: 'Dr. Okafor', kind: 'passage', photo: PHOTO })).body;
    assert.match(faceKit.photo, /^\/api\/images\/[a-f0-9-]{36}-99-[a-f0-9]{8}\.jpg$/);
    assert.deepEqual([(await alice.call(faceKit.photo)).status, (await bob.call(faceKit.photo)).status], [200, 404]);
    await alice.json('/api/kits/' + faceKit.id, 'DELETE');
    assert.equal((await alice.call(faceKit.photo)).status, 404);
    // Tracks
    const tracks = (await alice.json('/api/tracks?today=2026-10-02')).body;
    assert.deepEqual([tracks.tracks.length, typeof tracks.daily, Object.keys(tracks.translations)], [6, 'string', ['kjv', 'web', 'asv']]);
  } finally { await s.stop(); m.close(); }
});

test('guided practice accepts the first-letters hint level', () => withMocks({}, async () => {
  const kit = { kind: 'passage', mode: 'exact', text: 'a b', scenes: [{ source: 'milk' }], reviews: [], streak: 0 };
  assert.equal((await reviewKit(kit, { items: [{ index: 0, answer: 'milk', hint: 4 }] })).score, .6);
  await assert.rejects(reviewKit(kit, { items: [{ index: 0, answer: 'milk', hint: 5 }] }), /Invalid practice answers/);
}));
