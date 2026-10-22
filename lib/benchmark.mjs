// The live benchmark: fresh tasks from the held-out test split of eval/technique-samples.json, run through the same
// createKit workflow a learner uses, scored by code against the answers a careful person would accept. Each run is
// logged, so the public evaluation page shows every run a judge started, good or bad.
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { createKit } from './orchestrate.mjs';
import { summarize } from './audit.mjs';

export const TASKS = 5;
const KEEP_RUNS = 50;

// The numbers docs/EVALUATION.md reports, shown beside each live run. Update both together.
export const PUBLISHED = {
  source: 'docs/EVALUATION.md',
  selection: { label: 'Automatic technique picks that were wrong (held-out test set, default bar 0.5)', value: '0 of 17' },
  compliant: { label: 'Requests that produced a contract-compliant kit', value: '11 of 11' },
  firstAttempt: { label: 'Kits compliant on the first attempt', value: '9 of 11' },
};

let samples;
async function testSet() {
  samples ||= JSON.parse(await readFile(new URL('../eval/technique-samples.json', import.meta.url), 'utf8')).test;
  return samples;
}

// `count` tasks chosen at random without repeats; `random` is replaceable for tests.
export async function pick(count = TASKS, random = Math.random) {
  const pool = [...await testSet()];
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  return pool.slice(0, count);
}

// Runs the tasks one after another. onEvent receives {type:'task', n, text} as each starts, the workflow's own
// {type:'step', ...} events, and {type:'result', n, ...} as each ends. Returns the run record.
export async function runBenchmark(tasks, onEvent = () => {}, options = {}) {
  const started = Date.now(), results = [];
  for (const [n, task] of tasks.entries()) {
    onEvent({ type: 'task', n: n + 1, of: tasks.length, text: task.text });
    const t0 = Date.now();
    let result;
    try {
      const kit = await createKit({ text: task.text, kind: task.kind, mode: task.mode, module: 'Everyday memory', absurdity: 'Playful', knows: options.knows || {} }, e => onEvent({ type: 'step', n: n + 1, ...e }));
      const s = summarize(kit);
      result = {
        text: task.text, technique: kit.technique.technique, decidedBy: kit.technique.selectedBy, acceptable: task.techniques,
        techniqueOk: task.techniques.includes(kit.technique.technique), compliant: true, firstAttempt: s.firstAttempt,
        attempts: s.storyboardAttempts, rejections: s.storyboardRejections, seconds: Math.round((Date.now() - t0) / 100) / 10,
      };
    } catch (e) {
      if (e.aborted) throw e;
      result = { text: task.text, acceptable: task.techniques, techniqueOk: false, compliant: false, firstAttempt: false, error: String(e.message).slice(0, 300), seconds: Math.round((Date.now() - t0) / 100) / 10 };
    }
    results.push(result);
    onEvent({ type: 'result', n: n + 1, ...result });
  }
  const count = k => results.filter(r => r[k]).length;
  return {
    id: new Date(started).toISOString(), ran: tasks.length, seconds: Math.round((Date.now() - started) / 1000),
    score: { techniqueOk: count('techniqueOk'), compliant: count('compliant'), firstAttempt: count('firstAttempt') },
    results, published: PUBLISHED,
  };
}

// The run log, newest first, kept in DATA_DIR beside the accounts.
export function benchmarkLog(dataDir) {
  const file = new URL('benchmarks.json', dataDir);
  let queue = Promise.resolve();
  const read = async () => { try { return JSON.parse(await readFile(file, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return []; throw e; } };
  return {
    read,
    add: run => (queue = queue.catch(() => {}).then(async () => {
      const runs = [run, ...await read()].slice(0, KEEP_RUNS);
      await mkdir(dataDir, { recursive: true });
      await writeFile(new URL('benchmarks.tmp', dataDir), JSON.stringify(runs));
      await rename(new URL('benchmarks.tmp', dataDir), file);
    })),
  };
}
