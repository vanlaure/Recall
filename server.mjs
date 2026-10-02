import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { techniques } from './lib/memory.mjs';
import { transcribe, textProvider } from './lib/providers.mjs';
import { createKit, reviewKit, illustrate } from './lib/orchestrate.mjs';
import { visionModel } from './lib/vision.mjs';
import { openAccounts, limiter } from './lib/accounts.mjs';
import { openStore, contentType } from './lib/store.mjs';

const root = new URL('./', import.meta.url);
const dataDir = process.env.DATA_DIR ? pathToFileURL(resolve(process.env.DATA_DIR) + '/') : new URL('data/', root);
const accounts = await openAccounts(dataDir);
const store = await openStore(dataDir);
const limits = limiter();
const HOUR = 3600000;
// Per-account hourly allowances, so one login cannot exhaust the shared provider credits.
const allowance = { storyboard: Number(process.env.LIMIT_STORYBOARDS_PER_HOUR || 30), image: Number(process.env.LIMIT_IMAGES_PER_HOUR || 150), transcribe: Number(process.env.LIMIT_TRANSCRIPTIONS_PER_HOUR || 60) };

function send(res, status, data, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(data));
}
const fail = (message, status) => { throw Object.assign(Error(message), { status }); };
async function body(req) {
  let s = '';
  for await (const c of req) { s += c; if (s.length > 15000000) throw Error('Request too large.'); }
  return JSON.parse(s || '{}');
}

const PAGES = { '/': 'index.html', '/app': 'app.html', '/app.js': 'app.js', '/app.css': 'app.css' };
async function serveStatic(url, res) {
  if (/^\/assets\/[a-z0-9-]+\.webp$/.test(url.pathname)) {
    let img;
    try { img = await readFile(new URL('.' + url.pathname, root)); } catch { res.writeHead(404); return res.end('Not found'); }
    res.setHeader('Content-Type', 'image/webp');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.end(img);
  }
  const file = PAGES[url.pathname];
  if (!file) { res.writeHead(404); return res.end('Not found'); }
  res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
  return res.end(await readFile(new URL(file, root)));
}

// The session lives in an HttpOnly cookie, so page scripts cannot read it and <img> requests carry it automatically.
const COOKIE = 'recall_session';
const sessionToken = req => (req.headers.cookie || '').split(';').map(c => c.trim().split('=')).find(([k]) => k === COOKIE)?.[1] || '';
const sessionCookie = (req, token, maxAge) => COOKIE + '=' + token + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=' + maxAge + (req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '');

async function handleAuth(req, res, url, b) {
  const ip = req.socket.remoteAddress;
  if (url.pathname === '/api/logout') {
    await accounts.logout(sessionToken(req));
    return send(res, 200, { loggedOut: true }, { 'Set-Cookie': sessionCookie(req, '', 0) });
  }
  if (!limits.allow('auth:' + ip, 20, 10 * 60000)) fail('Too many attempts. Try again in a few minutes.', 429);
  const first = accounts.count() === 0;
  const s = url.pathname === '/api/register' ? await accounts.register(b.username, b.password, b.code) : await accounts.login(b.username, b.password);
  // The first account ever created inherits any library saved before accounts existed.
  const adopted = url.pathname === '/api/register' && first ? await store.adoptLegacy(s.user.id) : 0;
  return send(res, url.pathname === '/api/register' ? 201 : 200, { user: s.user, adopted }, { 'Set-Cookie': sessionCookie(req, s.token, s.maxAge) });
}

// One storyboard at a time per account. A client that accepts application/x-ndjson gets each agent step as it happens,
// one JSON object per line, ending with {type:'kit'} or {type:'error'}; other clients get the kit as plain JSON.
const busy = new Set();
async function handleCreate(req, res, user, input) {
  if (busy.has(user.id)) return send(res, 429, { error: 'A generation is already running. Please wait.' });
  if (!limits.allow('storyboard:' + user.id, allowance.storyboard, HOUR)) return send(res, 429, { error: 'Hourly storyboard limit reached. Try again later.' });
  busy.add(user.id);
  const streaming = (req.headers.accept || '').includes('application/x-ndjson');
  const line = obj => res.write(JSON.stringify(obj) + '\n');
  try {
    if (streaming) res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
    const kit = await createKit(input, event => { if (streaming) line({ type: 'step', ...event }); });
    await store.add(user.id, kit);
    if (!streaming) return send(res, 201, kit);
    line({ type: 'kit', kit });
    res.end();
  } catch (e) {
    if (!streaming) throw e;
    line({ type: 'error', error: e.message });
    res.end();
  } finally { busy.delete(user.id); }
}

async function handleKit(req, res, user, match, b) {
  const kit = (await store.kits(user.id)).find(k => k.id === match[1]);
  if (!kit) return send(res, 404, { error: 'Kit not found.' });
  if (req.method === 'DELETE' && !match[2]) {
    await store.remove(user.id, kit);
    return send(res, 200, { deleted: true });
  }
  if (req.method === 'POST' && match[2] === 'image') {
    const scene = kit.scenes[b.index];
    if (!Number.isInteger(b.index) || !scene) throw Error('Invalid scene.');
    if (!limits.allow('image:' + user.id, allowance.image, HOUR)) fail('Hourly image limit reached. Try again later.', 429);
    const result = await illustrate(scene);
    scene.image = await store.saveImage(user.id, kit, b.index, result.image);
    scene.review = result.review;
    await store.save(user.id);
    return send(res, 200, scene);
  }
  if (req.method === 'POST' && match[2] === 'review') {
    const review = await reviewKit(kit, b.answer);
    await store.save(user.id);
    return send(res, 200, review);
  }
  return send(res, 404, { error: 'Route not found.' });
}

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  const url = new URL(req.url, 'http://localhost');
  try {
    if (!url.pathname.startsWith('/api/')) return await serveStatic(url, res);
    const { origin, host } = req.headers;
    if (req.method !== 'GET' && origin && origin !== `http://${host}` && origin !== `https://${host}`) return send(res, 403, { error: 'Cross-origin request rejected.' });

    // Open to everyone: what is configured, and whether sign-up needs a code.
    if (req.method === 'GET' && url.pathname === '/api/config') {
      const p = textProvider();
      return send(res, 200, { text: !!(p.key && p.model), textProvider: { name: p.name, label: p.label, model: p.model }, images: !!process.env.IMAGE_MODEL, vision: visionModel()?.model || null, voice: !!process.env.SPEECH_MODEL, laya: !!process.env.LAYA_BASE_URL, signupCode: !!process.env.SIGNUP_CODE, techniques });
    }
    if (req.method === 'POST' && ['/api/register', '/api/login', '/api/logout'].includes(url.pathname)) return await handleAuth(req, res, url, await body(req));

    // Everything below belongs to the logged-in account.
    const user = accounts.session(sessionToken(req));
    if (!user) return send(res, 401, { error: 'Log in to continue.' });
    if (req.method === 'GET') {
      if (url.pathname === '/api/me') return send(res, 200, { user });
      if (url.pathname === '/api/kits') return send(res, 200, await store.kits(user.id));
      const img = url.pathname.match(/^\/api\/images\/([^/]+)$/);
      const bytes = img && await store.readImage(user.id, img[1]);
      if (!bytes) return send(res, 404, { error: 'Not found.' });
      res.writeHead(200, { 'Content-Type': contentType(img[1]), 'Cache-Control': 'private, max-age=31536000, immutable' });
      return res.end(bytes);
    }

    const b = await body(req);
    if (req.method === 'POST' && url.pathname === '/api/transcribe') {
      if (typeof b.audio !== 'string' || b.audio.length > 14000000 || typeof b.mime !== 'string') throw Error('Unsupported audio or file too large.');
      if (!limits.allow('transcribe:' + user.id, allowance.transcribe, HOUR)) fail('Hourly transcription limit reached. Try again later.', 429);
      return send(res, 200, { text: await transcribe(Buffer.from(b.audio, 'base64'), b.mime) });
    }
    if (req.method === 'POST' && url.pathname === '/api/kits') return await handleCreate(req, res, user, b);
    const match = url.pathname.match(/^\/api\/kits\/([a-f0-9-]+)(?:\/(image|review))?$/);
    if (match) return await handleKit(req, res, user, match, b);
    send(res, 404, { error: 'Route not found.' });
  } catch (e) {
    if (res.headersSent) return res.end();
    send(res, e.status || 400, { error: e.message });
  }
});
server.listen(Number(process.env.PORT || 3000), process.env.HOST || '127.0.0.1', () => console.log('Recall ready on port ' + (process.env.PORT || 3000)));
