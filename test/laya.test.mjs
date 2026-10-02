import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { ask } from '../lib/providers.mjs';

// Stand-in for laya-serve: records the request and answers in the /v1/systemone response shape.
async function mock(answers) {
  let seen;
  const server = http.createServer(async (req, res) => {
    let s = ''; for await (const c of req) s += c;
    seen = { url: req.url, auth: req.headers.authorization, body: JSON.parse(s) };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ model: 'laya-rl-agent', answers, routing: { model: 'english' } }));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { url: 'http://127.0.0.1:' + server.address().port, seen: () => seen, close: () => server.close() };
}
const questions = {
  kind: { type: 'choice', instructions: 'What is it?', criteria: { digits: 'a number', words: 'words' } },
  listy: { type: 'noul', instructions: 'Is it a list?' },
};
async function withLaya(answers, fn) {
  const m = await mock(answers);
  process.env.LAYA_BASE_URL = m.url; process.env.LAYA_API_KEY = 'k';
  try { return await fn(m); } finally { m.close(); delete process.env.LAYA_BASE_URL; delete process.env.LAYA_API_KEY; }
}

test('the decision model is skipped when not configured', async () => {
  delete process.env.LAYA_BASE_URL;
  assert.equal(await ask('8472', questions), null);
});

test('typed questions follow the systemone protocol and the answers come back', () => withLaya({ kind: { type: 'choice', choice: 'digits', answer_confidence: .9 }, listy: { type: 'noul', noul: .2 } }, async m => {
  const r = await ask('8472', questions);
  assert.deepEqual([m.seen().url, m.seen().auth, m.seen().body.state], ['/v1/systemone', 'Bearer k', '8472']);
  assert.deepEqual(m.seen().body.questions, questions);
  assert.deepEqual([r.answers.kind.choice, r.answers.listy.noul, r.checkpoint, typeof r.ms], ['digits', .2, 'english', 'number']);
}));

test('a choice outside the question\'s options, or a missing answer, is rejected', async () => {
  await withLaya({ kind: { type: 'choice', choice: 'telepathy', answer_confidence: .9 }, listy: { type: 'noul', noul: .2 } }, () => assert.rejects(ask('x', questions), /no usable answer for "kind"/));
  await withLaya({ kind: { type: 'choice', choice: 'digits', answer_confidence: .9 } }, () => assert.rejects(ask('x', questions), /no usable answer for "listy"/));
});
