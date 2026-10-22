// Audit receipts and evaluation summaries. A kit already records every step of the agent workflow in `trace`, every
// image inspection in its scenes' `review`, and every cue rewrite in `repairs`. This module reads those records and
// nothing else: it reports what code refused and why, and never asks a model to describe its own work.

// The check that sent a storyboard back, by the trace's agent name. Tagged steps ("Reference Contract check") are
// the same checks run on a kit's reference scene.
const CHECKS = { 'Source check': 'source wording', 'Contract check': 'technique contract', 'Word check': 'dictionary words', 'Rules Agent': 'cue review', 'Cue check': 'cue points back' };
const checkOf = agent => CHECKS[agent.replace(/^Reference /, '')] || null;

// Every refusal in the kit as a flat list: storyboards sent back, images regenerated, cues rewritten.
export function rejections(kit) {
  const out = [];
  for (const t of kit.trace || []) {
    const check = checkOf(t.agent || '');
    if (!check || t.output?.approved !== false) continue;
    out.push({
      kind: 'storyboard', check, step: t.agent, attempt: t.attempt ?? null,
      // A storyboard the Rules Agent still doubted on the last attempt, after every code check passed, is kept.
      outcome: t.output.kept ? 'kept with reservations' : 'sent back',
      issues: (t.output.issues || []).map(String),
      ...(t.output.findings ? { findings: t.output.findings } : {}),
    });
  }
  (kit.scenes || []).forEach((s, i) => {
    for (const [n, issues] of (s.review?.rejected || []).entries()) out.push({ kind: 'image', check: 'image inspection', scene: i + 1, attempt: n + 1, outcome: 'regenerated', issues: (issues || []).map(String) });
    if (s.review?.status === 'needs_review') out.push({ kind: 'image', check: 'image inspection', scene: i + 1, attempt: s.review.attempts, outcome: 'kept for the learner to judge', issues: (s.review.issues || []).map(String) });
  });
  for (const r of kit.repairs || []) out.push({ kind: 'cue', check: 'repair', scene: r.scene, outcome: 'rewritten', diagnosis: r.diagnosis, diagnosedBy: r.diagnosedBy, issues: [r.explanation].filter(Boolean), before: r.before, after: r.after });
  return out;
}

// Counts for one kit, by kind and by check.
export function summarize(kit) {
  const all = rejections(kit), main = (kit.trace || []).filter(t => !/^Reference /.test(t.agent || ''));
  const attempts = Math.max(1, ...main.map(t => Number.isInteger(t.attempt) ? t.attempt : 1));
  const images = (kit.scenes || []).filter(s => s.review);
  return {
    storyboardAttempts: attempts,
    firstAttempt: !all.some(r => r.kind === 'storyboard' && !/^Reference /.test(r.step)),
    storyboardRejections: all.filter(r => r.kind === 'storyboard').length,
    imagesInspected: images.filter(s => s.review.status !== 'unchecked').length,
    imagesAccepted: images.filter(s => s.review.status === 'accepted').length,
    imageRegenerations: all.filter(r => r.kind === 'image' && r.outcome === 'regenerated').length,
    imagesNeedingReview: images.filter(s => s.review.status === 'needs_review').length,
    cuesRewritten: (kit.repairs || []).length,
    byCheck: all.reduce((m, r) => ({ ...m, [r.check]: (m[r.check] || 0) + 1 }), {}),
  };
}

// The receipt a learner or judge downloads: who decided what, under which contract, and every refusal with its reason,
// read straight from the kit's own records.
export function receipt(kit) {
  const t = kit.technique || {};
  return {
    receipt: 'recall-audit', version: 1, kit: kit.id, title: kit.title, created: kit.created, exported: new Date().toISOString(),
    ai: kit.ai,
    technique: { id: t.technique, name: t.name, decidedBy: t.selectedBy, escalated: !!t.escalated, reason: t.reason },
    decision: kit.decision ? { facts: kit.decision.facts, policy_version: kit.decision.policy_version, question_version: kit.decision.question_version, modes: kit.decision.modes, checkpoint: kit.decision.checkpoint, answers: kit.decision.answers, ...(kit.decision.cueCheck ? { cueCheck: kit.decision.cueCheck } : {}) } : null,
    contract: kit.contract ? { name: kit.contract.name, method: kit.contract.method, goal: kit.contract.goal, evidence_required: kit.contract.evidence_required, source_units: kit.contract.source_units } : null,
    summary: summarize(kit),
    rejections: rejections(kit),
    steps: (kit.trace || []).map(s => ({ agent: s.agent, ...(s.attempt ? { attempt: s.attempt } : {}), output: s.output })),
    images: (kit.scenes || []).map((s, i) => s.review ? { scene: i + 1, status: s.review.status, attempts: s.review.attempts, model: s.review.model, ...(s.review.reason ? { reason: s.review.reason } : {}) } : { scene: i + 1, status: 'not generated' }),
    ...(kit.notes ? { notes: kit.notes } : {}),
  };
}

// Totals across many kits, for the public evaluation page. Counts only: no wording, cue or answer leaves a library.
export function totals(kits) {
  const t = { kits: 0, firstAttempt: 0, storyboardRejections: 0, imagesInspected: 0, imagesAccepted: 0, imageRegenerations: 0, imagesNeedingReview: 0, cuesRewritten: 0, byCheck: {}, bySelector: {} };
  for (const kit of kits) {
    const s = summarize(kit);
    t.kits++;
    if (s.firstAttempt) t.firstAttempt++;
    for (const k of ['storyboardRejections', 'imagesInspected', 'imagesAccepted', 'imageRegenerations', 'imagesNeedingReview', 'cuesRewritten']) t[k] += s[k];
    for (const [c, n] of Object.entries(s.byCheck)) t.byCheck[c] = (t.byCheck[c] || 0) + n;
    const by = kit.technique?.selectedBy || 'unknown';
    t.bySelector[by] = (t.bySelector[by] || 0) + 1;
  }
  return t;
}
