// Shared test helpers: a throwaway server process with its own data folder, and a cookie-carrying client.
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export async function startServer(port, env = {}, dir) {
  const dataDir = dir || await mkdtemp(join(tmpdir(), 'recall-test-'));
  const child = spawn(process.execPath, ['server.mjs'], {
    env: { ...process.env, TEXT_PROVIDER: '', NEBIUS_API_KEY: '', NEBIUS_MODEL: '', LAYA_BASE_URL: '', SIGNUP_CODE: '', IMAGE_BASE_URL: '', IMAGE_MODEL: '', ...env, PORT: String(port), DATA_DIR: dataDir },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => { child.stdout.once('data', resolve); child.once('error', reject); child.once('exit', () => reject(Error('Server exited early'))); });
  return { base: 'http://127.0.0.1:' + port, dataDir, stop: async (keep = false) => { child.kill(); await new Promise(r => child.once('exit', r)); if (!keep) await rm(dataDir, { recursive: true, force: true }); } };
}

// A client that remembers the session cookie, like a browser tab.
export function client(base) {
  let cookie = '';
  const call = async (path, method = 'GET', data, headers = {}) => {
    const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...headers }, ...(data !== undefined ? { body: JSON.stringify(data) } : {}) });
    const set = r.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return r;
  };
  return {
    call,
    json: async (...args) => { const r = await call(...args); return { status: r.status, body: await r.json() }; },
    register: (username, password = 'correct horse battery', code) => call('/api/register', 'POST', { username, password, code }),
    login: (username, password = 'correct horse battery') => call('/api/login', 'POST', { username, password }),
    cookie: () => cookie,
  };
}
