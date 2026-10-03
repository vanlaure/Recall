// User accounts and login sessions, kept in two JSON files. Passwords are stored as salted scrypt hashes
// and session tokens as SHA-256 hashes, so neither file contains anything that can be used to log in.
import { scrypt, randomBytes, randomUUID, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';

const derive = promisify(scrypt);
const SESSION_DAYS = 30;
const USERNAME = /^[a-z0-9][a-z0-9._-]{2,31}$/;
const sha = s => createHash('sha256').update(s).digest('hex');

async function load(url, fallback) {
  try { return JSON.parse(await readFile(url, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return fallback; throw e; }
}

export async function openAccounts(dataDir) {
  await mkdir(dataDir, { recursive: true });
  const usersFile = new URL('users.json', dataDir), sessionsFile = new URL('sessions.json', dataDir);
  const users = await load(usersFile, []), sessions = await load(sessionsFile, {});
  // Expired sessions are dropped whenever the file is next written, so it does not grow for ever.
  const prune = () => { const now = Date.now(); for (const [k, s] of Object.entries(sessions)) if (!(s.expires > now)) delete sessions[k]; };
  prune();
  let queue = Promise.resolve();
  const save = (url, data) => (queue = queue.catch(() => {}).then(async () => {
    const tmp = new URL(url.href + '.tmp');
    await writeFile(tmp, JSON.stringify(data));
    await rename(tmp, url);
  }));
  const fail = (message, status = 400) => { throw Object.assign(Error(message), { status }); };
  const find = username => users.find(u => u.username === String(username || '').trim().toLowerCase());

  async function startSession(user) {
    const token = randomBytes(32).toString('base64url');
    prune();
    sessions[sha(token)] = { userId: user.id, expires: Date.now() + SESSION_DAYS * 86400000 };
    await save(sessionsFile, sessions);
    return { token, maxAge: SESSION_DAYS * 86400, user: { id: user.id, username: user.username } };
  }

  return {
    count: () => users.length,

    async register(username, password, code) {
      const name = String(username || '').trim().toLowerCase();
      if (process.env.SIGNUP_CODE && String(code || '') !== process.env.SIGNUP_CODE) fail('That sign-up code is not valid.', 403);
      if (!USERNAME.test(name)) fail('Usernames are 3–32 characters: letters, numbers, dot, dash or underscore.');
      if (typeof password !== 'string' || password.length < 8 || password.length > 200) fail('Passwords are 8–200 characters.');
      if (find(name)) fail('That username is taken.', 409);
      const salt = randomBytes(16).toString('hex');
      const user = { id: randomUUID(), username: name, salt, hash: (await derive(password, salt, 64)).toString('hex'), created: new Date().toISOString() };
      users.push(user);
      await save(usersFile, users);
      return startSession(user);
    },

    async login(username, password) {
      const user = find(username);
      // Hash even when the user does not exist, so the response time does not reveal which usernames are registered.
      const hash = await derive(String(password || ''), user?.salt || 'no-such-user', 64);
      if (!user || !timingSafeEqual(hash, Buffer.from(user.hash, 'hex'))) fail('Wrong username or password.', 401);
      return startSession(user);
    },

    // Returns {id, username} for a valid session token, otherwise null.
    session(token) {
      const s = token && sessions[sha(token)];
      if (!s || s.expires < Date.now()) return null;
      const user = users.find(u => u.id === s.userId);
      return user ? { id: user.id, username: user.username } : null;
    },

    async logout(token) {
      if (token && sessions[sha(token)]) { delete sessions[sha(token)]; await save(sessionsFile, sessions); }
    },
  };
}

// Counts events per key inside a sliding window; used for login attempts and per-user generation limits.
// `allow` counts and decides in one step; `check` only decides and `hit` only counts, for limits that should count
// failures alone; `refund` gives back the most recent count, for work that never happened. Keys that have gone quiet
// are swept so the map does not grow with every address that ever connected.
export function limiter() {
  const hits = new Map();
  let sweepAt = Date.now() + 600000;
  const recentOf = (key, windowMs, now) => (hits.get(key) || []).filter(t => now - t < windowMs);
  const sweep = now => {
    if (now < sweepAt) return;
    sweepAt = now + 600000;
    for (const [key, times] of hits) if (!times.length || now - times.at(-1) > 3600000) hits.delete(key);
  };
  return {
    allow(key, max, windowMs) {
      const now = Date.now(), recent = recentOf(key, windowMs, now);
      sweep(now);
      if (recent.length >= max) { hits.set(key, recent); return false; }
      recent.push(now); hits.set(key, recent);
      return true;
    },
    check(key, max, windowMs) {
      const now = Date.now(), recent = recentOf(key, windowMs, now);
      hits.set(key, recent);
      return recent.length < max;
    },
    hit(key) { hits.set(key, [...(hits.get(key) || []), Date.now()]); },
    refund(key) { const times = hits.get(key); if (times?.length) times.pop(); },
  };
}
