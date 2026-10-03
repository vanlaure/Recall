// Regression tests for the defects found in the 2026-10-03 end-to-end audit (docs/CHANGES.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { contractIssues, mentions } from '../lib/validate.mjs';
import { contract } from '../lib/decision.mjs';
import { createKit } from '../lib/orchestrate.mjs';
import { agent, transcribe, cleanTranscript, modelListed } from '../lib/providers.mjs';
import { limiter } from '../lib/accounts.mjs';
import { withMocks, startServer, client } from './helpers.mjs';

const ENV = ['TEXT_PROVIDER', 'NEBIUS_BASE_URL', 'NEBIUS_API_KEY', 'NEBIUS_MODEL', 'PROVIDER_RETRY_MS', 'PROVIDER_TIMEOUT_MS', 'SPEECH_BASE_URL', 'SPEECH_MODEL', 'SPEECH_API_KEY', 'NVIDIA_API_KEY'];
async function withEnv(values, fn) {
  const saved = Object.fromEntries(ENV.map(k => [k, process.env[k]]));
  for (const k of ENV) delete process.env[k];
  Object.assign(process.env, values);
  try { return await fn(); } finally { for (const k of ENV) saved[k] === undefined ? delete process.env[k] : process.env[k] = saved[k]; }
}
async function jsonServer(handler) {
  const server = http.createServer(async (req, res) => { let s = ''; for await (const c of req) s += c; const [status, body] = handler(req.url, s); res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { url: 'http://127.0.0.1:' + server.address().port, close: () => server.close() };
}

// D-01: the link contract failed the landing page's own example because Nemotron wrote "egg" for the item "eggs".
test('a cue names its item in singular or plural, with or without an ending', () => {
  assert.ok(mentions('A carton of milk tips over and pours onto a huge egg.', 'eggs'));
  assert.ok(mentions('the battery hums on the sofa', 'batteries'));
  assert.ok(mentions('one knife on the table', 'knives'));
  assert.ok(mentions('two glasses clink', 'glass'));
  assert.ok(mentions('a key turns', 'keys'));
  assert.ok(!mentions('A carton of milk sits on a shelf.', 'eggs'));
  const link = contract({ technique: 'link' }, ['milk', 'eggs', 'bread'], 'exact');
  const scenes = [
    { source: 'milk', cue: 'A carton of milk tips over and pours onto a huge egg.', prompt: 'p', objects: ['carton'], evidence: { links_to: 'eggs' } },
    { source: 'eggs', cue: 'An egg cracks over a loaf of bread.', prompt: 'p', objects: ['egg'], evidence: { links_to: 'bread' } },
    { source: 'bread', cue: 'A loaf of bread wears a crown.', prompt: 'p', objects: ['loaf'], evidence: { links_to: null } },
  ];
  assert.deepEqual(contractIssues(link, scenes), []);
  scenes[0].cue = 'A carton of milk sits on a shelf.';
  assert.match(contractIssues(link, scenes)[0], /does not show "milk" interacting with the next item, "eggs"/);
});

// D-02 and D-05: the Rules Agent is told what code verified, sees encoding words and a reference scene's purpose, and
// cannot throw away a code-compliant storyboard on the last attempt.
const groceries = { text: 'milk, eggs, bread', kind: 'list', module: 'Everyday memory', mode: 'exact', absurdity: 'Playful' };
test('a code-compliant storyboard the Rules Agent still rejects on the last attempt is kept with its reservations', () => withMocks({ laya: ['unordered_items', .9], rules: [{ approved: false, issues: ['the last scene links nowhere'] }] }, async m => {
  const events = [];
  const kit = await createKit(groceries, e => events.push(e));
  assert.equal(m.calls.storyboard.length, 3);
  assert.deepEqual(kit.notes, ['Storyboard kept with the Rules Agent\'s reservations: the last scene links nowhere']);
  assert.deepEqual(kit.trace.filter(t => t.agent === 'Rules Agent').map(t => [t.attempt, t.output.approved, t.output.kept]), [[1, false, undefined], [2, false, undefined], [3, false, true]]);
  assert.equal(events.findLast(e => e.agent === 'Rules Agent').detail, 'reservations noted, storyboard kept');
  assert.match(m.calls.rules[0].verified_by_code, /exact source wording and order/);
  assert.equal(m.calls.rules[0].contract.purpose, undefined);
}));
// D-06: a Major-system word that decodes correctly but is not a real word is sent back when the reviewer names it.
test('a coined Major-system encoding word is sent back as a violation by the word check', async () => {
  // Every storyboard here decodes correctly; the first time round "far" is declared a coinage, the second time it is accepted.
  await withMocks({ laya: ['digits', .9], nonwords: ['far'] }, async m => {
    await assert.rejects(createKit({ text: '8472', kind: 'passage', module: 'Everyday memory', mode: 'exact', absurdity: 'Playful' }), /"far" is not a dictionary word; use only real words whose consonant sounds spell 8-4-7-2/);
    assert.deepEqual(m.calls.wordcheck[0], ['far', 'ken']);
    assert.deepEqual([m.calls.storyboard.length, m.calls.rules.length], [3, 0], 'the reviewer never sees a storyboard with a coined word');
    assert.deepEqual(m.calls.storyboard[1].issues, ['Scene 1: "far" is not a dictionary word; use only real words whose consonant sounds spell 8-4-7-2.']);
  });
  await withMocks({ laya: ['unordered_items', .9] }, async m => {
    await createKit({ text: 'milk, eggs, bread', kind: 'list', module: 'Everyday memory', mode: 'exact', absurdity: 'Playful' });
    assert.equal(m.calls.wordcheck.length, 0, 'no encoding words, no word check');
  });
});

test('the reviewer is told the purpose of a reference scene and sees the Major-system encoding words', () => withMocks({ laya: ['exact_wording', .9] }, async m => {
  const kit = await createKit({ ...groceries, kind: 'passage', text: 'For God so loved the world.', reference: 'John 3:16' });
  const ref = m.calls.rules.find(r => r.contract.purpose);
  assert.match(ref.contract.purpose, /This unit is the reference/);
  assert.equal(ref.contract.must_name, 'John');
  assert.deepEqual(ref.scenes[0].encoding_words, ['my', 'dish']);
  assert.equal(kit.scenes.at(-1).role, 'reference');
  assert.equal(kit.notes, undefined);
}));

// D-07: network failures and timeouts are reported like HTTP failures, naming the host, and the timeout is configurable.
test('a provider that cannot be reached, or does not answer in time, is reported with its host and maps to 502', async () => {
  const probe = net.createServer(); await new Promise(r => probe.listen(0, '127.0.0.1', r));
  const closedPort = probe.address().port; await new Promise(r => probe.close(r));
  const silent = net.createServer(() => {}); await new Promise(r => silent.listen(0, '127.0.0.1', r));
  try {
    await withEnv({ NEBIUS_BASE_URL: 'http://127.0.0.1:' + closedPort + '/v1', NEBIUS_API_KEY: 'k', NEBIUS_MODEL: 'm', PROVIDER_RETRY_MS: '1' }, () =>
      assert.rejects(agent('Role.', {}), e => e.status === 502 && new RegExp('127\\.0\\.0\\.1:' + closedPort + ' could not be reached \\(ECONNREFUSED\\)').test(e.message)));
    const t = Date.now();
    await withEnv({ NEBIUS_BASE_URL: 'http://127.0.0.1:' + silent.address().port + '/v1', NEBIUS_API_KEY: 'k', NEBIUS_MODEL: 'm', PROVIDER_TIMEOUT_MS: '1500' }, () =>
      assert.rejects(agent('Role.', {}), e => e.status === 502 && /timed out after 2 s/.test(e.message)));
    assert.ok(Date.now() - t < 6000, 'a timeout is not retried');
  } finally { silent.close(); }
});

// D-08: silence came back from the speech provider as a run of <unk> tokens.
test('transcripts lose <unk> tokens, so silence is empty rather than garbage', async () => {
  assert.equal(cleanTranscript('<unk><unk> hello <unk>world <UNK>'), 'hello world');
  assert.equal(cleanTranscript('<unk><unk><unk>'), '');
  const speech = await jsonServer(() => [200, { text: '<unk> <unk> milk and eggs <unk>' }]);
  try {
    await withEnv({ SPEECH_BASE_URL: speech.url, SPEECH_MODEL: 'whisper', SPEECH_API_KEY: 'k' }, async () => assert.equal(await transcribe(Buffer.from('RIFF'), 'audio/wav'), 'milk and eggs'));
  } finally { speech.close(); }
});

// D-03: the studio can tell whether the configured model is still in the platform's catalogue.
test('the model catalogue check says listed, not listed, or unknown', async () => {
  const list = await jsonServer(() => [200, { data: [{ id: 'nvidia/alive' }] }]);
  try {
    assert.equal(await modelListed({ base: list.url, key: 'k', model: 'nvidia/alive' }), true);
    assert.equal(await modelListed({ base: list.url, key: 'k', model: 'nvidia/retired' }), false);
    assert.equal(await modelListed({ base: list.url, key: '', model: 'nvidia/alive' }), null, 'no key, nothing to ask with');
    assert.equal(await modelListed({ base: 'http://127.0.0.1:9/v1', key: 'k', model: 'nvidia/alive' }), null, 'catalogue unreachable');
  } finally { list.close(); }
});

// D-10 and D-16: a limiter that can count failures alone and give a slot back.
test('the limiter can check without counting, count failures alone, and refund', () => {
  const l = limiter();
  assert.ok(l.check('a', 2, 1000)); l.hit('a'); l.hit('a');
  assert.ok(!l.check('a', 2, 1000));
  l.refund('a');
  assert.ok(l.check('a', 2, 1000));
  assert.ok(l.allow('b', 1, 1000)); assert.ok(!l.allow('b', 1, 1000)); l.refund('b'); assert.ok(l.allow('b', 1, 1000));
});

// D-09, D-10, D-11, D-14, D-15, D-16, D-17 at the HTTP boundary.
test('security headers, anonymous who-am-i, failure-only login limits, slot refunds, the kit cap and hidden internal errors', async () => {
  const s = await startServer(3091, { LIMIT_KITS_PER_ACCOUNT: '2', LIMIT_STORYBOARDS_PER_HOUR: '1' });
  try {
    const app = await fetch(s.base + '/app'), landing = await fetch(s.base + '/');
    assert.equal(app.headers.get('x-frame-options'), 'DENY');
    assert.match(app.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    assert.match(app.headers.get('content-security-policy'), /script-src 'self'; style-src 'self'$/, 'the studio runs no inline code');
    assert.match(landing.headers.get('content-security-policy'), /script-src 'self' 'unsafe-inline'/);
    assert.match(app.headers.get('permissions-policy'), /microphone=\(self\)/);
    assert.match(app.headers.get('x-request-id'), /^[a-f0-9]{12}$/);
    assert.equal(app.headers.get('strict-transport-security'), null, 'HSTS only behind an https proxy');
    assert.equal((await fetch(s.base + '/api/config', { headers: { 'X-Forwarded-Proto': 'https' } })).headers.get('strict-transport-security'), 'max-age=31536000');
    assert.deepEqual(await (await fetch(s.base + '/api/me')).json(), { user: null });

    const alice = client(s.base);
    assert.equal((await alice.register('alice')).status, 201);
    // Failed attempts on one username trip its own limit; other names from the same address are unaffected, and
    // successful logins never count.
    for (let i = 0; i < 10; i++) assert.equal((await client(s.base).login('bob', 'wrong password!')).status, 401);
    assert.equal((await client(s.base).login('bob', 'wrong password!')).status, 429);
    for (let i = 0; i < 25; i++) assert.equal((await client(s.base).login('alice')).status, 200);

    // The kit cap.
    const kit = { text: 'milk', kind: 'list', mode: 'exact', scenes: [{ source: 'milk', cue: 'c', prompt: 'p' }] };
    assert.equal((await alice.json('/api/kits/import', 'POST', { kit })).status, 201);
    assert.equal((await alice.json('/api/kits/import', 'POST', { kit })).status, 201);
    const full = await alice.json('/api/kits/import', 'POST', { kit });
    assert.deepEqual([full.status, /holds 2 kits/.test(full.body.error)], [400, true]);

    // A generation that fails before any model was called (no provider here) gives its only hourly slot back.
    assert.equal((await alice.json('/api/kits', 'POST', { text: 'milk, eggs', kind: 'list' })).status, 400);
    const again = await alice.json('/api/kits', 'POST', { text: 'milk, eggs', kind: 'list' });
    assert.deepEqual([again.status, /Configure NEBIUS/.test(again.body.error)], [400, true]);

    // Programming faults and unreadable bodies are answered in plain words, without the internal message.
    const nul = await alice.json('/api/profile', 'POST', null);
    assert.deepEqual([nul.status, nul.body.error], [400, 'The request body must be a JSON object.']);
    const bad = await fetch(s.base + '/api/profile', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: alice.cookie() }, body: '{not json' });
    assert.deepEqual([bad.status, (await bad.json()).error], [400, 'The request body is not valid JSON.']);
    const arr = await alice.json('/api/profile', 'POST', []);
    assert.equal(arr.status, 400);
  } finally { await s.stop(); }
});

// D-06: code hands the storyboard agent real words whose sounds spell the digits, so it has no reason to coin one.
test('every digit chunk has a real picturable word, and Major-system candidates always decode', async () => {
  const { candidates, wordsFor } = await import('../lib/major-words.mjs');
  const { majorMatches } = await import('../lib/validate.mjs');
  for (let d = 0; d < 10; d++) assert.ok(wordsFor(String(d)).length, 'no word for ' + d);
  for (let n = 0; n < 100; n++) { const p = String(n).padStart(2, '0'); assert.ok(wordsFor(p).length, 'no word for ' + p); }
  for (const digits of ['8472', '1066', '316', '7', '90210']) {
    const sets = candidates(digits);
    assert.ok(sets.length >= 2, digits + ' has ' + sets.length + ' candidate sets');
    for (const ws of sets) assert.ok(majorMatches(ws, digits), ws.join(' ') + ' must decode to ' + digits);
  }
  assert.deepEqual(candidates('8472')[0], ['fire', 'can'], 'unambiguous words come first');
  assert.ok(candidates('1066').length >= 3);
  const c = contract({ technique: 'major' }, ['8472', '1066'], 'exact');
  assert.deepEqual(Object.keys(c.word_candidates).sort(), ['1066', '8472']);
  assert.match(c.evidence_required, /word_candidates/);
  assert.equal(contract({ technique: 'link' }, ['milk'], 'exact').word_candidates, undefined);
});
