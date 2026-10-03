import http from 'node:http';
import { readFile, access, constants } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { techniques } from './lib/memory.mjs';
import { transcribe, textProvider, requestContext, modelListed } from './lib/providers.mjs';
import { randomUUID, randomBytes } from 'node:crypto';
import { createKit, reviewKit, illustrate, setTarget, repairScene, languageAids, importKit } from './lib/orchestrate.mjs';
import { research, TRANSLATIONS } from './lib/research.mjs';
import { TRACKS, daily } from './lib/tracks.mjs';
import { majorMatches, majorReadings } from './lib/validate.mjs';
import { today, calendarFile } from './lib/schedule.mjs';
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
const allowance = { repair: Number(process.env.LIMIT_REPAIRS_PER_HOUR || 30), storyboard: Number(process.env.LIMIT_STORYBOARDS_PER_HOUR || 30), image: Number(process.env.LIMIT_IMAGES_PER_HOUR || 150), transcribe: Number(process.env.LIMIT_TRANSCRIPTIONS_PER_HOUR || 60), research: Number(process.env.LIMIT_RESEARCH_PER_HOUR || 40) };

// One JSON line per request on stdout: enough to see what failed and how long it took, never a body, token or key.
// LOG_REQUESTS=0 silences it (the tests do).
const logging = process.env.LOG_REQUESTS !== '0';
const log = entry => { if (logging) console.log(JSON.stringify({ t: new Date().toISOString(), ...entry })); };

function send(res, status, data, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(data));
}
const fail = (message, status) => { throw Object.assign(Error(message), { status }); };
async function body(req) {
  let s = '';
  for await (const c of req) { s += c; if (s.length > 15000000) fail('Request too large.', 413); }
  try { return JSON.parse(s || '{}'); } catch { fail('The request body is not valid JSON.', 400); }
}

// Browser security headers. The landing page keeps its one inline script and stylesheet, so only it allows inline
// code; the studio loads everything from files. The microphone is needed for recording, nothing else is.
const CSP_BASE = "default-src 'self'; img-src 'self' data: blob: https:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
const CSP = { '/': CSP_BASE + "; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'", '/app': CSP_BASE + "; script-src 'self'; style-src 'self'" };
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
  if (CSP[url.pathname]) res.setHeader('Content-Security-Policy', CSP[url.pathname]);
  res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
  return res.end(await readFile(new URL(file, root)));
}

// The session lives in an HttpOnly cookie, so page scripts cannot read it and <img> requests carry it automatically.
const COOKIE = 'recall_session';
const sessionToken = req => (req.headers.cookie || '').split(';').map(c => c.trim().split('=')).find(([k]) => k === COOKIE)?.[1] || '';
const sessionCookie = (req, token, maxAge) => COOKIE + '=' + token + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=' + maxAge + (req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '');

async function handleAuth(req, res, url, b) {
  // Behind a hosting proxy every request arrives from the proxy's address, so the caller is the last hop it recorded.
  const forwarded = process.env.TRUST_PROXY ? String(req.headers['x-forwarded-for'] || '').split(',').pop().trim() : '';
  const ip = forwarded || req.socket.remoteAddress;
  if (url.pathname === '/api/logout') {
    await accounts.logout(sessionToken(req));
    return send(res, 200, { loggedOut: true }, { 'Set-Cookie': sessionCookie(req, '', 0) });
  }
  // Only failed attempts count, per address and per username, so a household behind one address is not locked out
  // by its own successful logins. New accounts are limited per address as well.
  const byIp = 'auth:' + ip, byName = 'auth-user:' + String(b.username || '').trim().toLowerCase();
  if (!limits.check(byIp, 20, 10 * 60000) || !limits.check(byName, 10, 10 * 60000)) fail('Too many attempts. Try again in a few minutes.', 429);
  if (url.pathname === '/api/register' && !limits.check('register:' + ip, Number(process.env.LIMIT_SIGNUPS_PER_HOUR || 10), HOUR)) fail('Too many new accounts from this address. Try again later.', 429);
  const first = accounts.count() === 0;
  let s;
  try { s = url.pathname === '/api/register' ? await accounts.register(b.username, b.password, b.code) : await accounts.login(b.username, b.password); }
  catch (e) { limits.hit(byIp); limits.hit(byName); throw e; }
  if (url.pathname === '/api/register') limits.hit('register:' + ip);
  // The first account ever created inherits any library saved before accounts existed.
  const adopted = url.pathname === '/api/register' && first ? await store.adoptLegacy(s.user.id) : 0;
  return send(res, url.pathname === '/api/register' ? 201 : 200, { user: s.user, adopted }, { 'Set-Cookie': sessionCookie(req, s.token, s.maxAge) });
}

// One storyboard at a time per account. A client that accepts application/x-ndjson gets each agent step as it happens,
// one JSON object per line, ending with {type:'kit'} or {type:'error'}; other clients get the kit as plain JSON.
// Closing the connection (the Stop button, or a closed tab) aborts the provider calls still in flight.
const busy = new Set();
async function handleCreate(req, res, user, input) {
  if (busy.has(user.id)) return send(res, 429, { error: 'A generation is already running. Please wait.' });
  const slot = 'storyboard:' + user.id;
  if (!limits.allow(slot, allowance.storyboard, HOUR)) return send(res, 429, { error: 'Hourly storyboard limit reached. Try again later.' });
  busy.add(user.id);
  const streaming = (req.headers.accept || '').includes('application/x-ndjson');
  const line = obj => { if (!res.destroyed) res.write(JSON.stringify(obj) + '\n'); };
  const control = new AbortController(), ctx = { signal: control.signal, calls: 0 };
  res.on('close', () => { if (!res.writableFinished) control.abort(); });
  try {
    if (streaming) res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
    // A palace is named by id and its places are read from this account's own saved palaces, never from the request.
    const palaces = await store.palaces(user.id), knows = (await store.profile(user.id)).knows;
    const kit = await requestContext.run(ctx, () => createKit({ ...input, palaces, knows }, event => { if (streaming) line({ type: 'step', ...event }); }));
    if (input.photo) kit.photo = await store.savePhoto(user.id, kit, input.photo);
    await store.add(user.id, kit);
    if (!streaming) return send(res, 201, kit);
    line({ type: 'kit', kit });
    res.end();
  } catch (e) {
    // A request that no provider answered, was stopped, or failed at the provider gives its hourly slot back.
    if (!ctx.calls || e.status === 502 || e.aborted) limits.refund(slot);
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
    const slot = 'image:' + user.id;
    if (!limits.allow(slot, allowance.image, HOUR)) fail('Hourly image limit reached. Try again later.', 429);
    let result;
    try { result = await illustrate(scene); } catch (e) { limits.refund(slot); throw e; }
    scene.image = await store.saveImage(user.id, kit, b.index, result.image);
    scene.review = result.review;
    await store.save(user.id);
    return send(res, 200, scene);
  }
  if (req.method === 'POST' && match[2] === 'review') {
    const review = await reviewKit(kit, b);
    await store.save(user.id);
    return send(res, 200, review);
  }
  if (req.method === 'POST' && match[2] === 'target') {
    setTarget(kit, b.targetDate, b.today);
    await store.save(user.id);
    return send(res, 200, { targetDay: kit.targetDay || null, plan: kit.plan || [], dueDay: kit.dueDay, due: kit.due });
  }
  if (req.method === 'POST' && match[2] === 'repair') {
    const slot = 'repair:' + user.id;
    if (!limits.allow(slot, allowance.repair, HOUR)) fail('Hourly cue-rewrite limit reached. Try again later.', 429);
    let result;
    try { result = await repairScene(kit, b.index); } catch (e) { if (e.status === 502) limits.refund(slot); throw e; }
    await store.dropImage(user.id, result.oldImage);
    await store.save(user.id);
    return send(res, 200, { repair: result.repair, scene: result.scene });
  }
  if (req.method === 'POST' && match[2] === 'language') {
    if (!limits.allow('repair:' + user.id, allowance.repair, HOUR)) fail('Hourly limit reached. Try again later.', 429);
    const language = await languageAids(kit);
    await store.save(user.id);
    return send(res, 200, language);
  }
  return send(res, 404, { error: 'Route not found.' });
}

// Saved memory palaces: a name and an ordered list of places the learner already knows.
async function handlePalaces(req, res, user, url, b) {
  const list = await store.palaces(user.id), id = url.pathname.split('/')[3];
  if (req.method === 'DELETE' && id) {
    await store.savePalaces(user.id, list.filter(p => p.id !== id));
    return send(res, 200, { deleted: true });
  }
  if (req.method !== 'POST' || id) return send(res, 404, { error: 'Route not found.' });
  const name = typeof b.name === 'string' ? b.name.trim().slice(0, 60) : '';
  const places = (Array.isArray(b.places) ? b.places : []).filter(p => typeof p === 'string' && p.trim()).map(p => p.trim().slice(0, 60));
  if (!name || places.length < 2 || places.length > 24) throw Error('Give the palace a name and 2 to 24 places, in the order you walk them.');
  if (new Set(places.map(p => p.toLowerCase())).size !== places.length) throw Error('Each place in a palace must be different.');
  if (list.length >= 20) throw Error('You can save up to 20 palaces. Delete one first.');
  const palace = { id: randomUUID(), name, places };
  await store.savePalaces(user.id, [...list, palace]);
  return send(res, 201, palace);
}

// Errors thrown on purpose carry a plain message for the learner; anything else is a programming fault whose detail
// belongs in the log, not in the response.
const INTERNAL = e => e instanceof TypeError || e instanceof RangeError || e instanceof ReferenceError || e instanceof SyntaxError;

const server = http.createServer(async (req, res) => {
  const started = Date.now(), id = randomBytes(6).toString('hex');
  let user = null;
  res.setHeader('X-Request-Id', id);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'microphone=(self), camera=(), geolocation=(), payment=()');
  if (req.headers['x-forwarded-proto'] === 'https') res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  const url = new URL(req.url, 'http://localhost');
  res.on('finish', () => { if (url.pathname.startsWith('/api/')) log({ id, method: req.method, path: url.pathname, status: res.statusCode, ms: Date.now() - started, ...(user ? { user: user.id } : {}) }); });
  try {
    if (!url.pathname.startsWith('/api/')) return await serveStatic(url, res);
    const { origin, host } = req.headers;
    if (req.method !== 'GET' && origin && origin !== `http://${host}` && origin !== `https://${host}`) return send(res, 403, { error: 'Cross-origin request rejected.' });

    // Open to everyone: what is configured, whether the text model is still in its platform's catalogue, and whether
    // sign-up needs a code.
    if (req.method === 'GET' && url.pathname === '/api/config') {
      const p = textProvider();
      const textModelListed = process.env.MODEL_CHECK === '0' ? null : await modelListed(p);
      return send(res, 200, { text: !!(p.key && p.model), textProvider: { name: p.name, label: p.label, model: p.model }, textModelListed, images: !!process.env.IMAGE_MODEL, vision: visionModel()?.model || null, voice: !!process.env.SPEECH_MODEL, laya: !!process.env.LAYA_BASE_URL, signupCode: !!process.env.SIGNUP_CODE, techniques });
    }
    if (req.method === 'POST' && ['/api/register', '/api/login', '/api/logout'].includes(url.pathname)) return await handleAuth(req, res, url, await body(req));

    // Everything below belongs to the logged-in account. "Who am I" answers with no user rather than an error, so a
    // fresh visit does not log a failed request in the browser.
    user = accounts.session(sessionToken(req));
    if (req.method === 'GET' && url.pathname === '/api/me') return send(res, 200, { user });
    if (!user) return send(res, 401, { error: 'Log in to continue.' });
    if (req.method === 'GET') {
      if (url.pathname === '/api/kits') return send(res, 200, await store.kits(user.id));
      if (url.pathname === '/api/palaces') return send(res, 200, await store.palaces(user.id));
      if (url.pathname === '/api/profile') return send(res, 200, await store.profile(user.id));
      if (url.pathname === '/api/tracks') return send(res, 200, { tracks: TRACKS, daily: daily(today(url.searchParams.get('today'))), translations: TRANSLATIONS });
      if (url.pathname === '/api/calendar.ics') {
        res.writeHead(200, { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'attachment; filename="recall-practice.ics"', 'Cache-Control': 'no-store' });
        return res.end(calendarFile(await store.kits(user.id), today(url.searchParams.get('today'))));
      }
      const img = url.pathname.match(/^\/api\/images\/([^/]+)$/);
      const bytes = img && await store.readImage(user.id, img[1]);
      if (!bytes) return send(res, 404, { error: 'Not found.' });
      res.writeHead(200, { 'Content-Type': contentType(img[1]), 'Cache-Control': 'private, max-age=31536000, immutable' });
      return res.end(bytes);
    }

    const b = await body(req);
    if (b === null || typeof b !== 'object' || Array.isArray(b)) fail('The request body must be a JSON object.', 400);
    if (req.method === 'POST' && url.pathname === '/api/transcribe') {
      if (typeof b.audio !== 'string' || b.audio.length > 14000000 || typeof b.mime !== 'string') throw Error('Unsupported audio or file too large.');
      const slot = 'transcribe:' + user.id;
      if (!limits.allow(slot, allowance.transcribe, HOUR)) fail('Hourly transcription limit reached. Try again later.', 429);
      try { return send(res, 200, { text: await transcribe(Buffer.from(b.audio, 'base64'), b.mime) }); } catch (e) { if (e.status === 502) limits.refund(slot); throw e; }
    }
    if (req.method === 'POST' && url.pathname === '/api/research') {
      if (!limits.allow('research:' + user.id, allowance.research, HOUR)) fail('Hourly research limit reached. Try again later.', 429);
      return send(res, 200, await research(b.query, b.translation));
    }
    // Major-system drill: are these words a reading of these digits? Checked by the same code that checks storyboards.
    if (req.method === 'POST' && url.pathname === '/api/drill') {
      const digits = String(b.digits ?? ''), words = String(b.words ?? '').trim().split(/\s+/).filter(Boolean);
      if (!/^\d{1,8}$/.test(digits) || !words.length || words.length > 8 || !words.every(w => /^[\p{L}'-]{1,30}$/u.test(w))) throw Error('Answer with digits for the word, or one or more words for the number.');
      return send(res, 200, { correct: majorMatches(words, digits), readings: words.map(w => ({ word: w, digits: majorReadings(w).slice(0, 4) })) });
    }
    if (url.pathname.startsWith('/api/palaces')) return await handlePalaces(req, res, user, url, b);
    // Which encoding systems the learner already knows. Anything not answered true or false stays unknown.
    if (req.method === 'POST' && url.pathname === '/api/profile') {
      const knows = Object.fromEntries(['major', 'pegs', 'pao'].filter(k => typeof b.knows?.[k] === 'boolean').map(k => [k, b.knows[k]]));
      await store.saveProfile(user.id, { knows });
      return send(res, 200, { knows });
    }
    if (req.method === 'POST' && url.pathname === '/api/kits/import') {
      const kit = importKit(b.kit, b.today);
      await store.add(user.id, kit);
      return send(res, 201, kit);
    }
    if (req.method === 'POST' && url.pathname === '/api/kits') return await handleCreate(req, res, user, b);
    const match = url.pathname.match(/^\/api\/kits\/([a-f0-9-]+)(?:\/(image|review|target|repair|language))?$/);
    if (match) return await handleKit(req, res, user, match, b);
    send(res, 404, { error: 'Route not found.' });
  } catch (e) {
    const internal = !e.status && INTERNAL(e);
    if (internal || e.status === 502) log({ id, method: req.method, path: url.pathname, error: e.constructor.name, message: e.message.slice(0, 300), ...(user ? { user: user.id } : {}) });
    if (res.headersSent) return res.end();
    send(res, e.status || 400, { error: internal ? 'That request could not be processed. If it keeps happening, check the server log for request ' + id + '.' : e.message });
  }
});

// A loopback address in a container (for example a development .env passed with --env-file) would make the app
// unreachable from outside it, so the container binds every interface and says so.
let host = process.env.HOST || '127.0.0.1';
if (process.env.RECALL_CONTAINER && /^(127\.|localhost$)/.test(host)) { console.warn('HOST=' + host + ' cannot be reached from outside a container; binding :: instead.'); host = '::'; }
try { await access(dataDir, constants.W_OK); } catch { console.error('The data directory ' + dataDir.pathname + ' is not writable by this process; accounts and kits cannot be saved.'); }
server.listen(Number(process.env.PORT || 3000), host, () => console.log('Recall ready on port ' + (process.env.PORT || 3000)));
