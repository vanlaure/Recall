import http from 'node:http';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { techniques } from './lib/memory.mjs';
import { image, transcribe, textProvider } from './lib/providers.mjs';
import { createKit, reviewKit } from './lib/orchestrate.mjs';

const root = new URL('./', import.meta.url);
// The single-user kit library is one JSON file, rewritten atomically after each change.
const dataDir = process.env.DATA_DIR ? pathToFileURL(resolve(process.env.DATA_DIR) + '/') : new URL('data/', root);
await mkdir(dataDir, { recursive: true });
const store = new URL('kits.json', dataDir);
let kits = [];
try { kits = JSON.parse(await readFile(store, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
let queue = Promise.resolve();
function persist() {
  queue = queue.catch(() => {}).then(async () => {
    await writeFile(new URL('kits.tmp', dataDir), JSON.stringify(kits));
    await rename(new URL('kits.tmp', dataDir), store);
  });
  return queue;
}

function send(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}
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

function authorised(req) {
  if (!process.env.APP_TOKEN) return true;
  const expected = Buffer.from(process.env.APP_TOKEN), given = Buffer.from((req.headers.authorization || '').replace(/^Bearer /, ''));
  return given.length === expected.length && timingSafeEqual(given, expected);
}

// One storyboard at a time. A client that accepts application/x-ndjson gets each agent step as it happens,
// one JSON object per line, ending with {type:'kit'} or {type:'error'}; other clients get the kit as plain JSON.
let busy = false;
async function handleCreate(req, res, input) {
  if (busy) return send(res, 429, { error: 'A generation is already running. Please wait.' });
  busy = true;
  const streaming = (req.headers.accept || '').includes('application/x-ndjson');
  const line = obj => res.write(JSON.stringify(obj) + '\n');
  try {
    if (streaming) res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
    const kit = await createKit(input, event => { if (streaming) line({ type: 'step', ...event }); });
    kits.unshift(kit);
    await persist();
    if (!streaming) return send(res, 201, kit);
    line({ type: 'kit', kit });
    res.end();
  } catch (e) {
    if (!streaming) throw e;
    line({ type: 'error', error: e.message });
    res.end();
  } finally { busy = false; }
}

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  const url = new URL(req.url, 'http://localhost');
  try {
    if (!url.pathname.startsWith('/api/')) return await serveStatic(url, res);
    const { origin, host } = req.headers;
    if (req.method !== 'GET' && origin && origin !== `http://${host}` && origin !== `https://${host}`) return send(res, 403, { error: 'Cross-origin request rejected.' });
    if (!authorised(req)) return send(res, 401, { error: 'Enter the application access token.' });

    if (req.method === 'GET' && url.pathname === '/api/config') {
      const p = textProvider();
      return send(res, 200, { text: !!(p.key && p.model), textProvider: { name: p.name, label: p.label, model: p.model }, images: !!process.env.IMAGE_MODEL, voice: !!process.env.SPEECH_MODEL, laya: !!process.env.LAYA_BASE_URL, techniques });
    }
    if (req.method === 'GET' && url.pathname === '/api/kits') return send(res, 200, kits);

    const b = await body(req);
    if (req.method === 'POST' && url.pathname === '/api/transcribe') {
      if (typeof b.audio !== 'string' || b.audio.length > 14000000 || typeof b.mime !== 'string') throw Error('Unsupported audio or file too large.');
      return send(res, 200, { text: await transcribe(Buffer.from(b.audio, 'base64'), b.mime) });
    }
    if (req.method === 'POST' && url.pathname === '/api/kits') return await handleCreate(req, res, b);

    const match = url.pathname.match(/^\/api\/kits\/([a-f0-9-]+)(?:\/(image|review))?$/);
    if (match) {
      const kit = kits.find(k => k.id === match[1]);
      if (!kit) return send(res, 404, { error: 'Kit not found.' });
      if (req.method === 'DELETE' && !match[2]) {
        kits = kits.filter(k => k !== kit);
        await persist();
        return send(res, 200, { deleted: true });
      }
      if (req.method === 'POST' && match[2] === 'image') {
        const scene = kit.scenes[b.index];
        if (!scene) throw Error('Invalid scene.');
        scene.image = await image(scene.prompt);
        await persist();
        return send(res, 200, scene);
      }
      if (req.method === 'POST' && match[2] === 'review') {
        const review = await reviewKit(kit, b.answer);
        await persist();
        return send(res, 200, review);
      }
    }
    send(res, 404, { error: 'Route not found.' });
  } catch (e) {
    if (res.headersSent) return res.end();
    send(res, e.status || 400, { error: e.message });
  }
});
server.listen(Number(process.env.PORT || 3000), process.env.HOST || '127.0.0.1', () => console.log('Recall ready on port ' + (process.env.PORT || 3000)));
