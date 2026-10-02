import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { agent, image, textProvider } from '../lib/providers.mjs';

const KEYS = ['TEXT_PROVIDER', 'NEBIUS_BASE_URL', 'NEBIUS_API_KEY', 'NEBIUS_MODEL', 'NVIDIA_BASE_URL', 'NVIDIA_API_KEY', 'NVIDIA_MODEL', 'IMAGE_BASE_URL', 'IMAGE_API_KEY', 'IMAGE_MODEL', 'PROVIDER_RETRY_MS'];
// Run fn with exactly these provider settings, then restore the environment.
async function withEnv(values, fn) {
  const saved = Object.fromEntries(KEYS.map(k => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, values);
  try { return await fn(); } finally { for (const k of KEYS) saved[k] === undefined ? delete process.env[k] : process.env[k] = saved[k]; }
}

// Stand-in provider: records each request and answers with the next queued [status, body].
async function mock(replies) {
  const seen = [];
  const server = http.createServer(async (req, res) => {
    let s = ''; for await (const c of req) s += c;
    seen.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(s) });
    const [status, body] = replies[Math.min(seen.length, replies.length) - 1];
    res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { url: 'http://127.0.0.1:' + server.address().port, seen, close: () => server.close() };
}
const chat = content => [200, { choices: [{ message: { content } }] }];

test('text provider defaults to Nebius and switches to NVIDIA', () => withEnv({ NEBIUS_API_KEY: 'n', NEBIUS_MODEL: 'nvidia/x', NVIDIA_API_KEY: 'v' }, () => {
  assert.deepEqual([textProvider().name, textProvider().label, textProvider().model], ['nebius', 'Nebius Token Factory', 'nvidia/x']);
  process.env.TEXT_PROVIDER = 'NVIDIA';
  assert.deepEqual([textProvider().name, textProvider().base, textProvider().model], ['nvidia', 'https://integrate.api.nvidia.com/v1', 'nvidia/nemotron-3-super-120b-a12b']);
  process.env.TEXT_PROVIDER = 'openai';
  assert.throws(() => textProvider(), /must be "nebius" or "nvidia"/);
}));

test('agent calls the selected platform with that platform\'s key and model', async () => {
  const nebius = await mock([chat('{"from":"nebius"}')]), nvidia = await mock([chat('```json\n{"from":"nvidia"}\n```')]);
  const env = { NEBIUS_BASE_URL: nebius.url, NEBIUS_API_KEY: 'neb-key', NEBIUS_MODEL: 'nvidia/a', NVIDIA_BASE_URL: nvidia.url, NVIDIA_API_KEY: 'nv-key', NVIDIA_MODEL: 'nvidia/b' };
  try {
    await withEnv(env, async () => {
      assert.deepEqual(await agent('Role.', { x: 1 }), { from: 'nebius' });
      process.env.TEXT_PROVIDER = 'nvidia';
      assert.deepEqual(await agent('Role.', { x: 1 }), { from: 'nvidia' });
    });
    assert.deepEqual([nebius.seen.length, nebius.seen[0].url, nebius.seen[0].auth, nebius.seen[0].body.model], [1, '/chat/completions', 'Bearer neb-key', 'nvidia/a']);
    assert.deepEqual([nvidia.seen.length, nvidia.seen[0].auth, nvidia.seen[0].body.model], [1, 'Bearer nv-key', 'nvidia/b']);
  } finally { nebius.close(); nvidia.close(); }
});

test('agent reports which key is missing for the selected platform', async () => {
  await withEnv({}, () => assert.rejects(agent('Role.', {}), /Configure NEBIUS_API_KEY and NEBIUS_MODEL/));
  await withEnv({ TEXT_PROVIDER: 'nvidia' }, () => assert.rejects(agent('Role.', {}), /Configure NVIDIA_API_KEY/));
});

test('a busy provider is retried, and a persistent failure names the host and maps to 502', async () => {
  const flaky = await mock([[503, {}], chat('{"ok":true}')]), down = await mock([[503, {}]]);
  try {
    await withEnv({ NEBIUS_BASE_URL: flaky.url, NEBIUS_API_KEY: 'k', NEBIUS_MODEL: 'm', PROVIDER_RETRY_MS: '1' }, async () => {
      assert.deepEqual(await agent('Role.', {}), { ok: true });
      assert.equal(flaky.seen.length, 2);
      process.env.NEBIUS_BASE_URL = down.url;
      await assert.rejects(agent('Role.', {}), e => e.status === 502 && /127\.0\.0\.1:\d+ failed \(503\)/.test(e.message) && !e.message.includes('Bearer'));
      assert.equal(down.seen.length, 3);
    });
  } finally { flaky.close(); down.close(); }
});

test('image key falls back to NVIDIA_API_KEY and the style is prepended', async () => {
  const m = await mock([[200, { artifacts: [{ base64: '/9j/AAAA' }] }]]);
  try {
    await withEnv({ IMAGE_BASE_URL: m.url + '/genai', IMAGE_MODEL: 'vendor/model', NVIDIA_API_KEY: 'nv-key' }, async () => {
      assert.equal(await image('A duck.'), 'data:image/jpeg;base64,/9j/AAAA');
    });
    assert.deepEqual([m.seen[0].url, m.seen[0].auth], ['/genai/vendor/model', 'Bearer nv-key']);
    assert.match(m.seen[0].body.prompt, /^Hand-drawn ink illustration.* A duck\. No written words/);
  } finally { m.close(); }
});
