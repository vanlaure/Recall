// Shared test helpers: stand-in providers, a throwaway server process with its own data folder, and a cookie-carrying client.
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export async function listen(handler) {
  const server = http.createServer(async (req, res) => {
    let s = ''; for await (const c of req) s += c;
    let status = 404, body = { error: 'no such mock route' };
    try { [status, body] = handler(req.url, JSON.parse(s || 'null')); } catch {}
    res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { url: 'http://127.0.0.1:' + server.address().port, close: () => server.close() };
}

// Major-system words that really decode to these digits, for storyboards that must pass the contract check.
export const MAJOR_WORDS = { 8472: ['far', 'ken'], 1066: ['tea', 'sea', 'she', 'she'], 316: ['my', 'dish'] };

// A storyboard that satisfies the contract it was given: correct sources, technique evidence and clean prompts.
export function compliant(contract) {
  const units = contract.source_units, t = contract.primary_technique;
  return {
    scenes: units.map((source, i) => {
      const next = units[i + 1], digits = (source.match(/\d/g) || []).join('');
      const evidence = {
        link: { links_to: next ?? null }, loci: { location: 'place ' + 'abcdefgh'[i] }, peg: { peg: 'hook' + 'abcdefgh'[i] },
        major: { words: MAJOR_WORDS[digits] }, keyword: { keyword: 'soundalike' }, chunk: { chunks: [source.slice(0, 3), source.slice(3)] },
        shape: { pegs: [...digits].map(d => ({ digit: d, object: 'swan' })) }, pao: { person: 'pilot', action: 'juggling', object: 'lantern' },
      }[t] || {};
      const extra = { link: next ? ' touching ' + next : '', loci: ' at place ' + 'abcdefgh'[i], peg: ' on hook' + 'abcdefgh'[i], major: ' ' + (MAJOR_WORDS[digits] || []).join(' '), keyword: ' soundalike' + (contract.face_feature ? ' on the ' + contract.face_feature : ''), shape: ' swan', pao: ' pilot juggling lantern' }[t] || '';
      return { source, cue: 'cue for ' + source + extra, prompt: 'an ink drawing for scene ' + 'abcdefgh'[i], objects: ['thing ' + 'abcdefgh'[i]], evidence };
    }),
  };
}

// Stand-ins for the text model and the decision model. `script` supplies each agent's replies in order (the last
// one repeats); a storyboard entry is a function of the request state, or null for a compliant storyboard.
// `laya` is [recallTarget, confidence], or omitted to leave the decision model unconfigured. `calls` records requests.
// `vision` supplies the image inspector's reports in order; each is merged over a report that passes every rule.
export const CLEAN = { visible_objects: ['thing'], text: 'not_detected', logo_or_brand: 'not_detected', real_person: 'not_detected', style: 'consistent', interaction: 'correct_action', clarity: 'clear' };
export async function mocks({ laya, expert = { technique: 'visual', reason: 'default' }, storyboard, rules = [{ approved: true, issues: [] }], jpeg, vision = [{}], repair, itemScores, face = ['curly hair'], lookup = { search: 'Jim Croce', topic: '' }, picks = [2], language = { words: [] }, nonwords = [] } = {}) {
  const calls = { expert: [], storyboard: [], rules: [], laya: [], image: [], vision: [], repair: [], face: [], research: [], wordcheck: [] };
  const next = (list, n) => list[Math.min(n, list.length) - 1];
  const chat = await listen((url, body) => {
    if (url.startsWith('/genai/')) { calls.image.push(body); return [200, { artifacts: [{ base64: jpeg }] }]; }
    if (Array.isArray(body.messages[0].content)) {
      // The image inspector: by default every required object is reported present.
      const text = body.messages[0].content[0].text;
      // The face reader sends a photo with no required objects.
      if (!text.includes('Required objects: ')) { calls.face.push(body.messages[0].content[1].image_url.url); return [200, { choices: [{ message: { content: JSON.stringify({ features: face }) } }] }]; }
      const required = JSON.parse(text.match(/Required objects: (\[.*\])/)[1]);
      calls.vision.push({ model: body.model, required, image: body.messages[0].content[1].image_url.url });
      const given = next(vision, calls.vision.length);
      const report = typeof given === 'string' ? given : JSON.stringify({ ...CLEAN, required: required.map(object => ({ object, present: true })), ...given });
      return [200, { choices: [{ message: { content: report } }] }];
    }
    const role = body.messages[0].content, state = JSON.parse(body.messages[1].content);
    let reply;
    if (role.startsWith('Memory Expert')) { calls.expert.push(state); reply = expert; }
    else if (role.startsWith('Association and Storyboard')) {
      calls.storyboard.push(state);
      const make = storyboard ? next(storyboard, calls.storyboard.length) : null;
      reply = make ? make(state) : compliant(state.contract);
    } else if (role.startsWith('Rules Agent')) { calls.rules.push(state); reply = next(rules, calls.rules.length); }
    else if (role.startsWith('Repair Agent')) {
      // By default: a compliant replacement for the failing scene, worded differently from the original.
      calls.repair.push(state);
      const make = repair ? next(repair, calls.repair.length) : null, fresh = compliant(state.contract).scenes[state.scene_number - 1];
      reply = make ? make(state, fresh) : { diagnosis: 'cue_ambiguity', explanation: 'The old picture could mean several things.', scene: { ...fresh, cue: 'fresh ' + fresh.cue } };
    } else if (role.startsWith('Research Agent')) { calls.research.push(state); reply = role.includes('choose the quotations') ? { picks } : lookup; }
    else if (role.startsWith('Language Agent')) reply = language;
    // The word check: every encoding word is a real word unless the test names it in `nonwords`.
    else if (role.startsWith('Word check')) { calls.wordcheck.push(state.words); reply = { real: Object.fromEntries(state.words.map(w => [w, !nonwords.includes(w)])) }; }
    else if (role.startsWith('Training Agent: for each item')) reply = { scores: itemScores || state.items.map(() => 1) };
    else reply = { score: .5, feedback: 'half' };
    return [200, { choices: [{ message: { content: JSON.stringify(reply) } }] }];
  });
  const layaServer = laya ? await listen((url, body) => {
    if (url === '/health') return [200, { status: 'ok', revisions: { english: 'rev-1' }, checkpoint_devices: { english: 'cpu' }, device: 'cpu' }];
    calls.laya.push(body);
    // laya[2] === 'truncated' makes the service report that the material did not fit.
    if (laya[2] === 'truncated') return [200, { answers: { target: { type: 'choice', choice: laya[0], answer_confidence: laya[1] }, ...Object.fromEntries(Object.keys(body.questions).filter(k => k !== 'target').map(k => [k, { noul: .1 }])) }, usage: { truncated: true }, routing: { model: 'english' } }];
    const answers = {};
    for (const [id, q] of Object.entries(body.questions)) {
      if (q.type === 'noul') answers[id] = { type: 'noul', noul: .1, confidence: .9 };
      else if (id === 'target') answers[id] = { type: 'choice', choice: laya[0], answer_confidence: laya[1], probabilities: { [laya[0]]: laya[1] } };
      // The cue check: answer with the first option whose text appears in the cue.
      else { const hit = Object.keys(q.criteria).find(k => body.state.includes(q.criteria[k])) || Object.keys(q.criteria)[0]; answers[id] = { type: 'choice', choice: hit, answer_confidence: .8, probabilities: {} }; }
    }
    return [200, { answers, routing: { model: 'english', repo: 'test/laya' } }];
  }) : null;
  const env = { TEXT_PROVIDER: 'nebius', NEBIUS_BASE_URL: chat.url, NEBIUS_API_KEY: 'k', NEBIUS_MODEL: 'nvidia/test', LAYA_BASE_URL: layaServer?.url || '', LAYA_MIN_CONFIDENCE: '0.5', PROVIDER_RETRY_MS: '1', VISION_PROVIDER: '', NEBIUS_VISION_MODEL: vision ? 'vision/test' : '', ...(jpeg ? { IMAGE_BASE_URL: chat.url + '/genai', IMAGE_MODEL: 'vendor/model', IMAGE_API_KEY: 'k' } : {}) };
  return { calls, env, close: () => { chat.close(); layaServer?.close(); } };
}

// Runs fn with the mock providers configured in this process, then restores the environment.
export async function withMocks(script, fn) {
  const m = await mocks(script), saved = {};
  for (const k of Object.keys(m.env)) { saved[k] = process.env[k]; if (m.env[k] || k === 'NEBIUS_VISION_MODEL') process.env[k] = m.env[k]; else delete process.env[k]; }
  try { return await fn(m); } finally { m.close(); for (const k of Object.keys(saved)) saved[k] === undefined ? delete process.env[k] : process.env[k] = saved[k]; }
}

export async function startServer(port, env = {}, dir) {
  const dataDir = dir || await mkdtemp(join(tmpdir(), 'recall-test-'));
  const child = spawn(process.execPath, ['server.mjs'], {
    env: { ...process.env, TEXT_PROVIDER: '', NEBIUS_API_KEY: '', NEBIUS_MODEL: '', LAYA_BASE_URL: '', SIGNUP_CODE: '', IMAGE_BASE_URL: '', IMAGE_MODEL: '', VISION_PROVIDER: '', NEBIUS_VISION_MODEL: '', LOG_REQUESTS: '0', MODEL_CHECK: '0', LIMIT_KITS_PER_ACCOUNT: '', ...env, PORT: String(port), DATA_DIR: dataDir },
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
