import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createKit, reviewKit } from '../lib/orchestrate.mjs';

async function listen(handler) {
  const server = http.createServer(async (req, res) => {
    let s = ''; for await (const c of req) s += c;
    const [status, body] = handler(req.url, JSON.parse(s));
    res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { url: 'http://127.0.0.1:' + server.address().port, close: () => server.close() };
}

// Stand-ins for the text model and Laya. `script` supplies each agent's replies in order (the last one repeats);
// `calls` records what each agent was sent.
async function mocks({ laya, expert, storyboard, rules = [{ approved: true, issues: [] }] }) {
  const calls = { expert: [], storyboard: [], rules: [], laya: [] };
  const next = (list, n) => list[Math.min(n, list.length) - 1];
  const chat = await listen((url, body) => {
    const role = body.messages[0].content, state = JSON.parse(body.messages[1].content);
    let reply;
    if (role.startsWith('Memory Expert')) { calls.expert.push(state); reply = expert; }
    else if (role.startsWith('Association and Storyboard')) {
      calls.storyboard.push(state);
      const make = storyboard ? next(storyboard, calls.storyboard.length) : null;
      reply = make ? make(state) : { scenes: state.units.map(u => ({ source: u, cue: 'cue for ' + u, prompt: 'prompt for ' + u })) };
    } else if (role.startsWith('Rules Agent')) { calls.rules.push(state); reply = next(rules, calls.rules.length); }
    else reply = { score: .5, feedback: 'half' };
    return [200, { choices: [{ message: { content: JSON.stringify(reply) } }] }];
  });
  const layaServer = laya ? await listen((url, body) => {
    calls.laya.push(body);
    return [200, { answers: { technique: { type: 'choice', choice: laya[0], answer_confidence: laya[1], probabilities: { [laya[0]]: laya[1] } } }, routing: { model: 'english' } }];
  }) : null;
  const env = { TEXT_PROVIDER: 'nebius', NEBIUS_BASE_URL: chat.url, NEBIUS_API_KEY: 'k', NEBIUS_MODEL: 'nvidia/test', LAYA_BASE_URL: layaServer?.url || '', LAYA_MIN_CONFIDENCE: '0.4', PROVIDER_RETRY_MS: '1' };
  return { calls, env, close: () => { chat.close(); layaServer?.close(); } };
}
async function withMocks(script, fn) {
  const m = await mocks(script), saved = {};
  for (const k of Object.keys(m.env)) { saved[k] = process.env[k]; if (m.env[k]) process.env[k] = m.env[k]; else delete process.env[k]; }
  try { return await fn(m); } finally { m.close(); for (const k of Object.keys(saved)) saved[k] === undefined ? delete process.env[k] : process.env[k] = saved[k]; }
}
const input = { text: '8472, 1066', kind: 'list', module: 'Everyday memory', mode: 'exact', absurdity: 'Playful' };

test('a confident Laya choice skips the Memory Expert and hands its method to the storyboard agent', () => withMocks({ laya: ['major', .9] }, async m => {
  const events = [];
  const kit = await createKit(input, e => events.push(e.agent + ':' + e.status));
  assert.equal(m.calls.expert.length, 0);
  assert.deepEqual([kit.technique.technique, kit.technique.selectedBy, kit.kind], ['major', 'laya', 'list']);
  assert.match(m.calls.storyboard[0].selection.method, /Encode digits as consonant sounds/);
  assert.deepEqual(kit.ai, { provider: 'nebius', platform: 'Nebius Token Factory', model: 'nvidia/test' });
  assert.deepEqual(kit.scenes.map(s => s.source), ['8472', '1066']);
  assert.deepEqual(events, ['Source:done', 'Laya technique selector:started', 'Laya technique selector:done', 'Storyboard Agent:started', 'Storyboard Agent:done', 'Rules Agent:started', 'Rules Agent:done']);
}));

test('an unsure Laya defers to the Memory Expert, and an unknown technique becomes visual association', () => withMocks({ laya: ['major', .2], expert: { technique: 'telepathy', reason: 'x' } }, async m => {
  const kit = await createKit(input);
  assert.equal(m.calls.expert.length, 1);
  assert.deepEqual([kit.technique.technique, kit.technique.selectedBy, kit.technique.name], ['visual', 'nemotron', 'Visual association']);
  assert.match(kit.trace.find(t => t.agent === 'Memory Expert').note, /confidence below 0.4/);
}));

test('without Laya the Memory Expert chooses', () => withMocks({ expert: { technique: 'link', reason: 'short list' } }, async m => {
  const kit = await createKit(input);
  assert.equal(m.calls.laya.length, 0);
  assert.deepEqual([kit.technique.technique, kit.technique.reason, kit.trace[0].output.enabled], ['link', 'short list', false]);
}));

test('a rejected storyboard is revised with the reviewer\'s issues', () => withMocks({ laya: ['major', .9], rules: [{ approved: false, issues: ['cue 1 is vague'] }, { approved: true, issues: [] }] }, async m => {
  const kit = await createKit(input);
  assert.equal(m.calls.storyboard.length, 2);
  assert.equal(m.calls.storyboard[0].issues, undefined);
  assert.deepEqual(m.calls.storyboard[1].issues, ['cue 1 is vague']);
  assert.equal(m.calls.storyboard[1].previous.length, 2);
  assert.deepEqual(kit.trace.filter(t => t.agent === 'Rules Agent').map(t => [t.attempt, t.output.approved]), [[1, false], [2, true]]);
}));

test('a storyboard that rewords the source is sent back instead of failing the request', () => withMocks({ laya: ['major', .9], storyboard: [s => ({ scenes: s.units.map(u => ({ source: u + '!', cue: 'c', prompt: 'p' })) }), null] }, async m => {
  const kit = await createKit(input);
  assert.equal(m.calls.storyboard.length, 2);
  assert.deepEqual(m.calls.storyboard[1].issues, ['Source wording or order changed.']);
  assert.equal(m.calls.rules.length, 1);
  assert.deepEqual(kit.scenes.map(s => s.source), ['8472', '1066']);
}));

test('three rejections end with an error that carries the issues', () => withMocks({ laya: ['major', .9], rules: [{ approved: false, issues: ['still vague'] }] }, async m => {
  await assert.rejects(createKit(input), /still requires revision after 3 attempts: still vague/);
  assert.equal(m.calls.storyboard.length, 3);
}));

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

test('the server streams each agent step and then the saved kit', async () => {
  const m = await mocks({ laya: ['major', .9] }), dir = await mkdtemp(join(tmpdir(), 'recall-test-'));
  const child = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, ...m.env, PORT: '3098', APP_TOKEN: '', DATA_DIR: dir }, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await new Promise((resolve, reject) => { child.stdout.once('data', resolve); child.once('error', reject); child.once('exit', () => reject(Error('Server exited early'))); });
    const r = await fetch('http://127.0.0.1:3098/api/kits', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' }, body: JSON.stringify(input) });
    assert.equal(r.headers.get('content-type'), 'application/x-ndjson');
    const lines = (await r.text()).trim().split('\n').map(l => JSON.parse(l));
    assert.deepEqual(lines.slice(0, -1).map(l => l.type), Array(7).fill('step'));
    assert.deepEqual(lines[2], { type: 'step', agent: 'Laya technique selector', status: 'done', detail: 'Major system at 90% confidence' });
    const kit = lines.at(-1).kit;
    assert.equal(lines.at(-1).type, 'kit');
    assert.equal(JSON.parse(await readFile(join(dir, 'kits.json'), 'utf8'))[0].id, kit.id);
    // A failure mid-stream arrives as an error line, and plain JSON clients still get a normal response.
    const bad = await fetch('http://127.0.0.1:3098/api/kits', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' }, body: JSON.stringify({ text: '', kind: 'list' }) });
    assert.match((await bad.text()).trim(), /^\{"type":"error","error":"Enter 1/);
    const plain = await fetch('http://127.0.0.1:3098/api/kits', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    assert.deepEqual([plain.status, (await plain.json()).kind], [201, 'list']);
  } finally { child.kill(); m.close(); await rm(dir, { recursive: true, force: true }); }
});
