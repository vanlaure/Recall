// The judge-facing records: the audit receipt, the public evaluation page and the live benchmark.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer, client, mocks } from './helpers.mjs';
import { rejections, summarize, receipt, totals } from '../lib/audit.mjs';
import { pick, runBenchmark, TASKS } from '../lib/benchmark.mjs';
import { withMocks } from './helpers.mjs';

// A storyboard with the wrong wording, which the source check must send back.
const wrongWording = state => ({ scenes: state.contract.source_units.map(() => ({ source: 'not the source', cue: 'c', prompt: 'p', objects: ['a'], evidence: {} })) });

test('the audit receipt lists every refusal from the kit\'s own records', () => {
  const kit = {
    id: 'k', title: 'milk', technique: { technique: 'link', name: 'Link system', selectedBy: 'nemotron', escalated: true, reason: 'r' },
    trace: [
      { agent: 'Source check', attempt: 1, output: { approved: false, issues: ['Scene 1: wording differs.'] } },
      { agent: 'Contract check', attempt: 2, output: { approved: false, issues: ['Scene 2: does not name the next item.'], findings: [{ check: 'link', scene: 2 }] } },
      { agent: 'Contract check', attempt: 3, output: { approved: true, issues: [] } },
      { agent: 'Rules Agent', attempt: 3, output: { approved: false, kept: true, issues: ['Cue 1 is vague.'] } },
      { agent: 'Reference Contract check', attempt: 1, output: { approved: false, issues: ['Reference scene: digits do not decode.'] } },
    ],
    scenes: [{ review: { status: 'accepted', attempts: 2, rejected: [['text, letters or numerals are visible']] } }, { review: { status: 'needs_review', attempts: 3, issues: ['missing: cow'], rejected: [['missing: cow'], ['missing: cow'], ['missing: cow']] } }],
    repairs: [{ scene: 1, diagnosis: 'weak_link', diagnosedBy: 'nemotron', explanation: 'Too far from milk.', before: 'old', after: 'new' }],
  };
  const r = rejections(kit);
  assert.deepEqual(r.map(x => [x.kind, x.check, x.outcome]), [
    ['storyboard', 'source wording', 'sent back'], ['storyboard', 'technique contract', 'sent back'], ['storyboard', 'cue review', 'kept with reservations'],
    ['storyboard', 'technique contract', 'sent back'],
    ['image', 'image inspection', 'regenerated'], ['image', 'image inspection', 'regenerated'], ['image', 'image inspection', 'regenerated'], ['image', 'image inspection', 'regenerated'], ['image', 'image inspection', 'kept for the learner to judge'],
    ['cue', 'repair', 'rewritten'],
  ]);
  assert.deepEqual(r[1].findings, [{ check: 'link', scene: 2 }]);
  const s = summarize(kit);
  assert.deepEqual([s.storyboardAttempts, s.firstAttempt, s.storyboardRejections, s.imagesInspected, s.imagesAccepted, s.imageRegenerations, s.imagesNeedingReview, s.cuesRewritten], [3, false, 4, 2, 1, 4, 1, 1]);
  assert.equal(receipt(kit).technique.decidedBy, 'nemotron');
  // A kit whose only refusal was on its reference scene still counts as first attempt for the material itself.
  assert.equal(summarize({ trace: [kit.trace[4]], scenes: [] }).firstAttempt, true);
  const t = totals([kit, { trace: [], scenes: [], technique: { selectedBy: 'code' } }]);
  assert.deepEqual([t.kits, t.firstAttempt, t.byCheck['technique contract'], t.bySelector], [2, 1, 2, { nemotron: 1, code: 1 }]);
});

test('/eval is public, shows counts for everyone and full records only for published accounts', async () => {
  const m = await mocks({ storyboard: [wrongWording, null], expert: { technique: 'link', reason: 'list' } });
  const s = await startServer(3089, { ...m.env, EVAL_PUBLIC_USERS: 'Demo, nobody' });
  try {
    const demo = client(s.base), bob = client(s.base);
    await demo.register('demo'); await bob.register('bob');
    const kit = (await demo.json('/api/kits', 'POST', { text: 'milk, eggs', kind: 'list' })).body;
    assert.equal(kit.scenes.length, 2);
    await bob.json('/api/kits', 'POST', { text: 'secret plans, hidden key', kind: 'list' });

    // The receipt belongs to the kit's owner only.
    const audit = await demo.json('/api/kits/' + kit.id + '/audit');
    assert.equal(audit.status, 200);
    assert.deepEqual([audit.body.receipt, audit.body.summary.storyboardRejections, audit.body.rejections[0].check], ['recall-audit', 1, 'source wording']);
    assert.equal((await bob.call('/api/kits/' + kit.id + '/audit')).status, 404);
    assert.equal((await fetch(s.base + '/api/kits/' + kit.id + '/audit')).status, 401);

    const page = await fetch(s.base + '/eval');
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-security-policy'), /default-src 'none'/);
    const html = await page.text();
    assert.match(html, /<b>2<\/b><span>storyboards built<\/span>/);
    assert.match(html, /<b>milk, eggs<\/b> <span class="muted">· demo/, 'the published account\'s kit is shown in full');
    assert.match(html, /source wording/);
    assert.doesNotMatch(html, /secret plans|hidden key/, 'an unpublished account contributes counts only');
    assert.doesNotMatch(html, /<script/i);
  } finally { await s.stop(); m.close(); }
});

test('the live benchmark runs held-out tasks, scores them in code and logs every run on /eval', async () => {
  const tasks = await pick(TASKS, () => 0.5);
  assert.equal(tasks.length, TASKS);
  assert.equal(new Set(tasks.map(t => t.text)).size, TASKS, 'no task repeats within a run');

  const m = await mocks({ expert: { technique: 'link', reason: 'list' } });
  const s = await startServer(3090, { ...m.env, BENCHMARK_PER_ACCOUNT_PER_HOUR: '1' });
  try {
    const judge = client(s.base);
    assert.equal((await judge.call('/api/benchmark', 'POST', {})).status, 401);
    await judge.register('judge');
    const r = await judge.call('/api/benchmark', 'POST', {}, { Accept: 'application/x-ndjson' });
    const lines = (await r.text()).trim().split('\n').map(JSON.parse);
    const done = lines.find(l => l.type === 'done');
    assert.ok(done, JSON.stringify(lines.at(-1)));
    assert.equal(lines.filter(l => l.type === 'task').length, TASKS);
    assert.equal(lines.filter(l => l.type === 'result').length, TASKS);
    assert.ok(lines.some(l => l.type === 'step'), 'the workflow streams its steps');
    assert.equal(done.run.results.length, TASKS);
    for (const x of done.run.results) assert.equal(x.techniqueOk, x.acceptable.includes(x.technique));
    assert.equal(done.run.published.source, 'docs/EVALUATION.md');
    // The run is not saved as a kit in the judge's library.
    assert.equal((await judge.json('/api/kits')).body.length, 0);
    // Per-account allowance.
    assert.equal((await judge.call('/api/benchmark', 'POST', {})).status, 429);
    const html = await (await fetch(s.base + '/eval')).text();
    assert.match(html, /Live benchmark runs/);
    assert.match(html, new RegExp('technique acceptable ' + done.run.score.techniqueOk + '/' + TASKS));
  } finally { await s.stop(); m.close(); }
});

test('a benchmark task that fails is recorded as a failure, not dropped', () => withMocks({ storyboard: [wrongWording] }, async () => {
  const run = await runBenchmark([{ text: 'milk, eggs', kind: 'list', mode: 'exact', techniques: ['link'] }]);
  assert.deepEqual([run.ran, run.score.compliant, run.results[0].compliant], [1, 0, false]);
  assert.match(run.results[0].error, /after 3 attempts/);
}));

test('kits are named by their list items or their reference, not just the first item', async () => {
  const { kitTitle } = await import('../lib/orchestrate.mjs');
  assert.equal(kitTitle(['milk', 'eggs', 'bread'], 'list'), 'milk, eggs, bread');
  assert.equal(kitTitle(['For God so loved the world,', 'that he gave'], 'phrases', 'John 3:16'), 'John 3:16');
  assert.equal(kitTitle(['The first sentence.', 'The second.'], 'passage'), 'The first sentence.');
  const long = kitTitle(Array.from({ length: 12 }, (_, i) => 'grocery item ' + i), 'list');
  assert.ok(long.length <= 70 && long.endsWith(', …'), long);
});
