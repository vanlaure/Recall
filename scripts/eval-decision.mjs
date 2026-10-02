// Measures technique selection on the labelled tasks in eval/technique-samples.json against the live decision model.
// Run with `npm run eval` (needs LAYA_BASE_URL). `dev` was used to choose wording and the confidence bar; `test` is held out.
import { readFileSync } from 'node:fs';
import { splitSource } from '../lib/memory.mjs';
import { ask, layaHealth } from '../lib/providers.mjs';
import { QUESTIONS, decisionState, select, modes } from '../lib/decision.mjs';

if (!process.env.LAYA_BASE_URL) { console.log('Set LAYA_BASE_URL to run this evaluation.'); process.exit(1); }
const data = JSON.parse(readFileSync(new URL('../eval/technique-samples.json', import.meta.url), 'utf8'));
const bars = [.4, .5, .6, .7, .8], configured = Number(process.env.LAYA_MIN_CONFIDENCE || .5);
const pct = (a, b) => b ? Math.round(100 * a / b) + '%' : 'n/a';

// Which checkpoint is being measured. Run this again whenever the checkpoint changes (for example one trained on
// Recall's own tasks): a category should be set to `enforced` only on the strength of the numbers for that checkpoint.
const health = await layaHealth();
console.log('Decision service: ' + (health ? Object.entries(health.revisions).map(([m, r]) => m + '@' + String(r).slice(0, 12) + ' on ' + (health.devices[m] || health.device)).join(', ') : 'health not available'));
console.log('Configured authority: technique ' + modes().technique + ', cue check ' + modes().cue_check);

// The same recall-target question asked two other ways, to see how much the answer depends on presentation:
// with the options in the opposite order, and with the question reworded.
const target = QUESTIONS.target;
const reversed = { target: { ...target, criteria: Object.fromEntries(Object.entries(target.criteria).reverse()) } };
const reworded = { target: { ...target, instructions: 'Which of these best describes what has to be remembered here?' } };

// Each yes/no question with its opposite. A model that understands negation answers the two differently.
const NEGATED = {
  is_list: ['Is this a single item, not a list of separate items?', ['ordered_items', 'unordered_items']],
  is_vocabulary: ['Is this something other than a foreign or unfamiliar word with its meaning?', ['vocabulary']],
  is_name: ["Is the main thing to remember something other than a person's name?", ['name_face']],
  is_recitation: ['Is this something that does not need to be recited word for word?', ['exact_wording']],
  is_concept: ['Is this something other than a definition, fact or explanation of an idea?', ['meaning']],
};
const negated = Object.fromEntries(Object.entries(NEGATED).map(([id, [instructions]]) => [id, { type: 'noul', instructions }]));

for (const split of ['dev', 'test']) {
  const rows = [];
  for (const s of data[split]) {
    const units = splitSource(s.text, s.kind), state = decisionState(units, s.mode), { answers } = await ask(state, QUESTIONS);
    rows.push({ s, units, answers, reversed: (await ask(state, reversed)).answers.target.choice, reworded: (await ask(state, reworded)).answers.target.choice, negated: (await ask(state, negated)).answers });
  }
  const n = rows.length;
  console.log('\n== ' + split + ' (' + n + ' labelled tasks) ==');
  const targetRight = rows.filter(r => r.s.target.includes(r.answers.target.choice)).length;
  console.log('Decision model alone, "what must be recalled?": ' + targetRight + '/' + n + ' correct (' + pct(targetRight, n) + ')');
  const right = r => r.s.target.includes(r.answers.target.choice);
  for (const [label, key] of [['options in reverse order', 'reversed'], ['question reworded', 'reworded']]) {
    const same = rows.filter(r => r[key] === r.answers.target.choice).length, ok = rows.filter(r => r.s.target.includes(r[key])).length;
    console.log('  ' + label + ': same answer on ' + same + '/' + n + ', correct on ' + ok + '/' + n);
  }
  // Is a higher stated confidence actually right more often?
  console.log('  stated confidence vs. correct: ' + [[0, .5], [.5, .8], [.8, 1.01]].map(([lo, hi]) => {
    const band = rows.filter(r => r.answers.target.answer_confidence >= lo && r.answers.target.answer_confidence < hi);
    return (lo * 100) + '–' + Math.min(100, hi * 100) + '%: ' + band.filter(right).length + '/' + band.length;
  }).join(' · '));
  // Negation: over every task and yes/no question, does the opposite question get the opposite answer, and is each right?
  let flips = 0, plain = 0, opposite = 0, total = 0;
  for (const r of rows) for (const [id, [, targets]] of Object.entries(NEGATED)) {
    const truth = r.s.target.some(t => targets.includes(t)), yes = r.answers[id].noul >= .5, no = r.negated[id].noul >= .5;
    total++; if (yes !== no) flips++; if (yes === truth) plain++; if (no === !truth) opposite++;
  }
  console.log('  yes/no questions: correct on ' + plain + '/' + total + '; asked as the opposite, correct on ' + opposite + '/' + total + '; the two answers differ (as they should) on ' + flips + '/' + total);
  console.log('\nFull selection (code facts, then the decision model above a confidence bar, else escalate to the Memory Expert):');
  console.log('  bar   by code      by model     escalated   wrong picks   picks that are acceptable');
  for (const bar of bars) {
    const out = rows.map(r => ({ r, sel: select({ units: r.units, mode: r.s.mode, laya: r.answers, minConfidence: bar }) }));
    const by = who => out.filter(o => o.sel.selectedBy === who), ok = list => list.filter(o => o.r.s.techniques.includes(o.sel.technique)).length;
    const code = by('code'), model = by('laya'), esc = out.filter(o => o.sel.escalate), picked = code.length + model.length;
    console.log('  ' + bar.toFixed(1) + (bar === configured ? '*' : ' ') + '  ' + (ok(code) + '/' + code.length).padEnd(12) + ' ' + (ok(model) + '/' + model.length).padEnd(12) + ' ' + String(esc.length).padEnd(11) + ' ' + String(picked - ok(code) - ok(model)).padEnd(13) + ' ' + (ok(code) + ok(model)) + '/' + picked + ' (' + pct(ok(code) + ok(model), picked) + ')');
    if (bar === configured) for (const o of [...code, ...model].filter(o => !o.r.s.techniques.includes(o.sel.technique))) console.log('        wrong: "' + o.r.s.text.slice(0, 40) + '" -> ' + o.sel.technique + ' by ' + o.sel.selectedBy + ' (acceptable: ' + o.r.s.techniques.join('/') + ')');
  }
  console.log('  (* = configured bar, LAYA_MIN_CONFIDENCE)');
}
