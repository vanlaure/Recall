import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer, client, mocks } from './helpers.mjs';

test('server serves the studio, rejects cross-origin writes and requires a login', async () => {
  const s = await startServer(3097);
  try {
    assert.equal((await fetch(s.base + '/app')).status, 200);
    assert.equal((await fetch(s.base + '/.env')).status, 404);
    assert.equal((await fetch(s.base + '/api/kits', { method: 'POST', headers: { Origin: 'https://evil.example' }, body: '{}' })).status, 403);
    const config = await (await fetch(s.base + '/api/config')).json();
    assert.deepEqual([config.text, config.signupCode, config.textProvider.name], [false, false, 'nebius']);
    assert.deepEqual(await (await fetch(s.base + '/api/me')).json(), { user: null }, 'who-am-i answers without an error when nobody is logged in');
    for (const [path, method] of [['/api/kits', 'GET'], ['/api/kits', 'POST'], ['/api/transcribe', 'POST'], ['/api/images/x.jpg', 'GET']]) {
      assert.equal((await fetch(s.base + path, { method, ...(method === 'POST' ? { body: '{}' } : {}) })).status, 401, method + ' ' + path);
    }
    // Logged in but with no text provider configured, creation explains what is missing.
    const c = client(s.base);
    assert.equal((await c.register('alice')).status, 201);
    const r = await c.json('/api/kits', 'POST', { text: 'milk, eggs', kind: 'list' });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /Configure NEBIUS/);
  } finally { await s.stop(); }
});

test('accounts: sign-up rules, login, logout and sessions that survive a restart', async () => {
  let s = await startServer(3096);
  try {
    const c = client(s.base);
    assert.equal((await c.register('ab')).status, 400);
    assert.equal((await c.register('alice', 'short')).status, 400);
    const made = await c.register('Alice');
    assert.equal(made.status, 201);
    assert.match(made.headers.get('set-cookie'), /^recall_session=[\w-]{40,}; HttpOnly; SameSite=Strict; Path=\/; Max-Age=2592000$/);
    assert.deepEqual((await c.json('/api/me')).body.user.username, 'alice');
    assert.equal((await client(s.base).register('ALICE')).status, 409);
    assert.equal((await client(s.base).login('alice', 'wrong password')).status, 401);
    assert.equal((await client(s.base).login('nobody')).status, 401);

    // Nothing on disk can be used to log in: no password and no session token.
    const users = await readFile(join(s.dataDir, 'users.json'), 'utf8'), sessions = await readFile(join(s.dataDir, 'sessions.json'), 'utf8');
    assert.ok(!users.includes('correct horse battery'));
    assert.ok(!sessions.includes(c.cookie().split('=')[1]));

    const dir = s.dataDir;
    await s.stop(true);
    s = await startServer(3096, {}, dir);
    const again = client(s.base);
    assert.equal((await fetch(s.base + '/api/me', { headers: { Cookie: c.cookie() } })).status, 200, 'session survives a restart');
    assert.equal((await again.login('alice')).status, 200);
    assert.equal((await again.call('/api/logout', 'POST', {})).status, 200);
    assert.deepEqual(await (await again.call('/api/me')).json(), { user: null });
  } finally { await s.stop(); }
});

test('a sign-up code, when set, is required to create an account but not to log in', async () => {
  const s = await startServer(3095, { SIGNUP_CODE: 'judges-2026' });
  try {
    assert.equal((await (await fetch(s.base + '/api/config')).json()).signupCode, true);
    assert.equal((await client(s.base).register('bob')).status, 403);
    assert.equal((await client(s.base).register('bob', undefined, 'wrong')).status, 403);
    assert.equal((await client(s.base).register('bob', undefined, 'judges-2026')).status, 201);
    assert.equal((await client(s.base).login('bob')).status, 200);
  } finally { await s.stop(); }
});

// Stand-ins for the text and image providers; with no decision model configured, the Memory Expert picks.
async function providers() {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]).toString('base64');
  const m = await mocks({ jpeg, expert: { technique: 'link', reason: 'short list' } });
  return { env: m.env, jpeg, close: m.close };
}

test('each account has its own library and images that other accounts cannot reach', async () => {
  const p = await providers(), s = await startServer(3094, p.env);
  try {
    const alice = client(s.base), bob = client(s.base);
    await alice.register('alice'); await bob.register('bob');
    const kit = (await alice.json('/api/kits', 'POST', { text: 'milk, eggs', kind: 'list' })).body;
    assert.equal(kit.scenes.length, 2);
    assert.deepEqual([(await alice.json('/api/kits')).body.length, (await bob.json('/api/kits')).body.length], [1, 0]);

    // Images are stored as files in the owner's folder and served only to the owner.
    const scene = (await alice.json('/api/kits/' + kit.id + '/image', 'POST', { index: 0 })).body;
    assert.match(scene.image, /^\/api\/images\/[a-f0-9-]{36}-0-[a-f0-9]{8}\.jpg$/);
    assert.deepEqual([scene.review.status, scene.review.attempts, scene.review.model], ['accepted', 1, 'vision/test']);
    const img = await alice.call(scene.image);
    assert.deepEqual([img.status, img.headers.get('content-type'), Buffer.from(await img.arrayBuffer()).toString('base64')], [200, 'image/jpeg', p.jpeg]);
    assert.equal((await bob.call(scene.image)).status, 404);
    assert.equal((await fetch(s.base + scene.image)).status, 401);
    assert.equal((await alice.call('/api/images/..%2F..%2Fusers.json')).status, 404);

    // Bob cannot review, illustrate or delete Alice's kit.
    assert.equal((await bob.json('/api/kits/' + kit.id + '/review', 'POST', { answer: 'milk' })).status, 404);
    assert.equal((await bob.json('/api/kits/' + kit.id + '/image', 'POST', { index: 0 })).status, 404);
    assert.equal((await bob.json('/api/kits/' + kit.id, 'DELETE')).status, 404);
    assert.equal((await alice.json('/api/kits/' + kit.id + '/review', 'POST', { answer: 'milk and eggs' })).body.score, 1);

    // Regenerating replaces the file; deleting the kit removes its images.
    const userDirs = await readdir(join(s.dataDir, 'users'));
    assert.equal(userDirs.length, 1, 'only accounts with kits have a folder');
    const images = join(s.dataDir, 'users', userDirs[0], 'images');
    await alice.json('/api/kits/' + kit.id + '/image', 'POST', { index: 0 });
    assert.equal((await readdir(images)).length, 1);
    assert.ok(!(await readFile(join(s.dataDir, 'users', userDirs[0], 'kits.json'), 'utf8')).includes('base64'));
    assert.equal((await alice.json('/api/kits/' + kit.id, 'DELETE')).status, 200);
    assert.equal((await readdir(images)).length, 0);
  } finally { await s.stop(); p.close(); }
});

test('hourly limits apply per account', async () => {
  const p = await providers(), s = await startServer(3093, { ...p.env, LIMIT_STORYBOARDS_PER_HOUR: '1', LIMIT_IMAGES_PER_HOUR: '1' });
  try {
    const alice = client(s.base), bob = client(s.base);
    await alice.register('alice'); await bob.register('bob');
    const kit = (await alice.json('/api/kits', 'POST', { text: 'milk', kind: 'list' })).body;
    const second = await alice.json('/api/kits', 'POST', { text: 'eggs', kind: 'list' });
    assert.deepEqual([second.status, second.body.error], [429, 'Hourly storyboard limit reached. Try again later.']);
    assert.equal((await bob.json('/api/kits', 'POST', { text: 'bread', kind: 'list' })).status, 201, 'another account is unaffected');
    assert.equal((await alice.json('/api/kits/' + kit.id + '/image', 'POST', { index: 0 })).status, 200);
    assert.equal((await alice.json('/api/kits/' + kit.id + '/image', 'POST', { index: 0 })).status, 429);
  } finally { await s.stop(); p.close(); }
});

test('the first account inherits a library saved before accounts existed', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'recall-test-'));
  const legacy = [{ id: '11111111-2222-3333-4444-555555555555', title: 'milk', text: 'milk', mode: 'exact', scenes: [{ source: 'milk', cue: 'c', prompt: 'p', image: 'data:image/jpeg;base64,/9j/AAAA' }], trace: [], reviews: [], streak: 0, due: new Date().toISOString() }];
  await writeFile(join(dir, 'kits.json'), JSON.stringify(legacy));
  const s = await startServer(3092, {}, dir);
  try {
    const first = client(s.base), second = client(s.base);
    assert.equal((await (await first.register('alice')).json()).adopted, 1);
    assert.equal((await (await second.register('bob')).json()).adopted, 0);
    const kits = (await first.json('/api/kits')).body;
    assert.equal(kits.length, 1);
    assert.match(kits[0].scenes[0].image, /^\/api\/images\/11111111-2222-3333-4444-555555555555-0-[a-f0-9]{8}\.jpg$/);
    assert.equal((await first.call(kits[0].scenes[0].image)).status, 200);
    assert.equal((await second.json('/api/kits')).body.length, 0);
    assert.deepEqual([existsSync(join(dir, 'kits.json')), existsSync(join(dir, 'kits.legacy.json'))], [false, true]);
  } finally { await s.stop(); await rm(dir, { recursive: true, force: true }); }
});
