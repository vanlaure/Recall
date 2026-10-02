import test from 'node:test';
import assert from 'node:assert/strict';
import { createKit, reviewKit } from '../lib/orchestrate.mjs';
import { withMocks, mocks, compliant, startServer, client } from './helpers.mjs';

const numbers = { text: '8472, 1066', kind: 'list', module: 'Everyday memory', mode: 'exact', absurdity: 'Playful' };
const groceries = { ...numbers, text: 'milk, eggs, bread' };
const steps = events => events.map(e => e.agent + ':' + e.status);

test('facts decide a number: no expert call, and the Major contract reaches the storyboard agent', () => withMocks({ laya: ['vocabulary', .99] }, async m => {
  const events = [];
  const kit = await createKit(numbers, e => events.push(e));
  assert.equal(m.calls.expert.length, 0);
  assert.deepEqual([kit.technique.technique, kit.technique.selectedBy, kit.kind], ['major', 'code', 'list']);
  const sent = m.calls.storyboard[0].contract;
  assert.deepEqual([sent.primary_technique, sent.source_units, sent.visual_rules.text_in_image], ['major', ['8472', '1066'], false]);
  assert.match(sent.evidence_required, /consonant sounds must spell exactly the digits/);
  assert.deepEqual(kit.scenes.map(s => [s.source, s.evidence.words.join(' ')]), [['8472', 'far ken'], ['1066', 'tea sea she she']]);
  assert.deepEqual(kit.ai, { provider: 'nebius', platform: 'Nebius Token Factory', model: 'nvidia/test' });
  assert.deepEqual(steps(events), ['Source:done', 'Decision model:started', 'Decision model:done', 'Technique:done', 'Storyboard Agent:started', 'Storyboard Agent:done', 'Contract check:started', 'Contract check:done', 'Rules Agent:started', 'Rules Agent:done', 'Cue check:started', 'Cue check:done']);
  assert.equal(events.find(e => e.agent === 'Technique').detail, 'Major system, decided by the facts of the material');
}));

test('the decision model\'s answers are recorded as a readable list, and a confident one selects the technique', () => withMocks({ laya: ['unordered_items', .9] }, async m => {
  const kit = await createKit(groceries);
  assert.equal(m.calls.expert.length, 0);
  assert.deepEqual([kit.technique.technique, kit.technique.selectedBy, kit.technique.confidence], ['link', 'laya', .9]);
  assert.equal(m.calls.laya[0].state, 'Goal: recall the exact wording.\nItems: 3\nMaterial:\nmilk\neggs\nbread');
  const answers = kit.decision.answers;
  assert.deepEqual(answers[0], { id: 'target', question: 'What does the learner mainly need to recall from this material?', type: 'choice', answer: 'unordered_items', confidence: .9, probabilities: { unordered_items: .9 } });
  assert.deepEqual(answers.slice(1).map(a => [a.type, a.answer, a.probability]), Array(5).fill(['yes_no', 'no', .1]));
  assert.equal(kit.decision.facts.unitCount, 3);
  // The advisory cue check: a link cue may point to its own item or the next one.
  assert.deepEqual(kit.decision.cueCheck.checks.map(c => c.matches), [true, true, true]);
  assert.equal(kit.decision.cueCheck.advisory, true);
}));

test('an unsure decision model escalates to the Memory Expert with the facts and the diagnosis', () => withMocks({ laya: ['unordered_items', .3], expert: { technique: 'loci', reason: 'a route helps' } }, async m => {
  const kit = await createKit(groceries);
  assert.equal(m.calls.expert.length, 1);
  assert.equal(m.calls.expert[0].facts.unitCount, 3);
  assert.equal(m.calls.expert[0].diagnosis[0].answer, 'unordered_items');
  assert.ok(!m.calls.expert[0].catalog.some(t => t.id === 'major'), 'techniques that cannot represent the material are not offered');
  assert.deepEqual([kit.technique.technique, kit.technique.selectedBy, kit.technique.reason], ['loci', 'nemotron', 'a route helps']);
  assert.match(kit.technique.escalated, /only 30% confidence/);
}));

test('without a decision model the expert chooses, and an unusable answer becomes visual association', () => withMocks({ expert: { technique: 'major', reason: 'x' } }, async m => {
  const kit = await createKit(groceries);
  assert.equal(m.calls.laya.length, 0);
  assert.deepEqual([kit.technique.technique, kit.technique.selectedBy, kit.decision.configured], ['visual', 'nemotron', false]);
  assert.equal(kit.decision.cueCheck, undefined);
}));

test('the learner\'s choice is honoured, and an unworkable one is refused before any model is called', () => withMocks({ laya: ['digits', .99] }, async m => {
  const kit = await createKit({ ...groceries, technique: 'loci' });
  assert.deepEqual([kit.technique.technique, kit.technique.selectedBy], ['loci', 'learner']);
  assert.deepEqual(kit.scenes.map(s => s.evidence.location), ['place a', 'place b', 'place c']);
  const before = JSON.stringify(m.calls);
  await assert.rejects(createKit({ ...groceries, technique: 'major' }), /Major system encodes digits, and this material has none/);
  assert.equal(JSON.stringify(m.calls), before, 'no provider was called');
}));

const wrongWords = s => { const b = compliant(s.contract); b.scenes[0].evidence.words = ['octopus']; b.scenes[0].cue = 'an octopus juggles'; return b; };
test('a storyboard that breaks the technique contract is sent back with the exact violation', () => withMocks({ laya: ['digits', .9], storyboard: [wrongWords, null] }, async m => {
  const events = [];
  const kit = await createKit(numbers, e => events.push(e));
  assert.equal(m.calls.storyboard.length, 2);
  assert.equal(m.calls.rules.length, 1, 'the reviewer never saw the non-compliant storyboard');
  assert.match(m.calls.storyboard[1].issues[0], /^Scene 1: the words "octopus" do not decode to 8472/);
  assert.equal(m.calls.storyboard[1].previous[0].evidence.words[0], 'octopus');
  assert.match(events.find(e => e.agent === 'Contract check' && e.status === 'done').detail, /^sent back: Scene 1/);
  assert.deepEqual(kit.trace.filter(t => t.agent === 'Contract check').map(t => [t.attempt, t.output.approved]), [[1, false], [2, true]]);
}));

const numeralPrompt = s => { const b = compliant(s.contract); b.scenes[1].prompt = 'a clock showing 3:16'; return b; };
const reworded = s => { const b = compliant(s.contract); b.scenes[0].source += '!'; return b; };
test('image-rule and source-wording violations are repaired the same way', () => withMocks({ laya: ['unordered_items', .9], storyboard: [numeralPrompt, reworded, null] }, async m => {
  const kit = await createKit(groceries);
  assert.equal(m.calls.storyboard.length, 3);
  assert.match(m.calls.storyboard[1].issues[0], /Scene 2: the image prompt contains numerals/);
  assert.deepEqual(m.calls.storyboard[2].issues, ['Source wording or order changed.']);
  assert.deepEqual(kit.scenes.map(s => s.source), ['milk', 'eggs', 'bread']);
}));

test('the reviewer can send a compliant storyboard back, and three failures stop with what is still wrong', async () => {
  await withMocks({ laya: ['unordered_items', .9], rules: [{ approved: false, issues: ['cue 1 is vague'] }, { approved: true, issues: [] }] }, async m => {
    const kit = await createKit(groceries);
    assert.deepEqual(m.calls.storyboard[1].issues, ['cue 1 is vague']);
    assert.deepEqual(kit.trace.filter(t => t.agent === 'Rules Agent').map(t => [t.attempt, t.output.approved]), [[1, false], [2, true]]);
  });
  await withMocks({ laya: ['digits', .9], storyboard: [wrongWords] }, async m => {
    await assert.rejects(createKit(numbers), /still breaks the Major system contract after 3 attempts: Scene 1: the words "octopus" do not decode to 8472.* Try rewording the source or choosing a different technique\./);
    assert.deepEqual([m.calls.storyboard.length, m.calls.rules.length], [3, 0]);
  });
});

test('reviews grade lists by items, passages by wording and meaning by the model', () => withMocks({}, async () => {
  const base = { text: 'milk, eggs', scenes: [{ source: 'milk' }, { source: 'eggs' }], reviews: [], streak: 0 };
  const list = { ...base, kind: 'list', mode: 'exact', reviews: [] };
  const r = await reviewKit(list, 'eggs');
  assert.deepEqual([r.score, r.missed, r.feedback], [.5, ['milk'], '1 of 2 items recalled. Missed: milk.']);
  assert.deepEqual([list.streak, list.reviews.length], [0, 1]);
  const passage = { ...base, kind: 'passage', mode: 'exact', reviews: [] };
  assert.equal((await reviewKit(passage, 'Milk eggs')).score, 1);
  assert.equal(passage.streak, 1);
  const meaning = { ...base, mode: 'meaning', reviews: [] };
  assert.deepEqual([(await reviewKit(meaning, 'dairy')).score, meaning.reviews[0].feedback], [.5, 'half']);
  await assert.rejects(reviewKit(list, 42), /Invalid answer/);
}));

test('the server streams each step and then the saved kit, and passes the learner\'s technique through', async () => {
  const m = await mocks({ laya: ['unordered_items', .9] }), s = await startServer(3098, m.env);
  try {
    const c = client(s.base), ndjson = { Accept: 'application/x-ndjson' };
    await c.register('alice');
    const r = await c.call('/api/kits', 'POST', groceries, ndjson);
    assert.equal(r.headers.get('content-type'), 'application/x-ndjson');
    const lines = (await r.text()).trim().split('\n').map(l => JSON.parse(l));
    assert.deepEqual(lines.slice(0, -1).map(l => l.type), Array(12).fill('step'));
    assert.deepEqual(lines[2], { type: 'step', agent: 'Decision model', status: 'done', detail: 'recall target: unordered items (90%)' });
    assert.deepEqual(lines[3], { type: 'step', agent: 'Technique', status: 'done', detail: 'Link system, chosen by the decision model' });
    assert.equal(lines.at(-1).type, 'kit');
    assert.equal((await c.json('/api/kits')).body[0].id, lines.at(-1).kit.id);
    // A failure mid-stream arrives as an error line, and plain JSON clients still get a normal response.
    const bad = await c.call('/api/kits', 'POST', { text: '', kind: 'list' }, ndjson);
    assert.match((await bad.text()).trim(), /^\{"type":"error","error":"Enter 1/);
    const plain = await c.json('/api/kits', 'POST', { ...groceries, technique: 'loci' });
    assert.deepEqual([plain.status, plain.body.technique.selectedBy, plain.body.contract.primary_technique], [201, 'learner', 'loci']);
    const refused = await c.json('/api/kits', 'POST', { ...groceries, technique: 'major' });
    assert.deepEqual([refused.status, /has none/.test(refused.body.error)], [400, true]);
  } finally { await s.stop(); m.close(); }
});
