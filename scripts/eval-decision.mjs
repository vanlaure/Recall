// Measures technique selection on the labelled tasks in eval/technique-samples.json against the live decision model.
// Run with `npm run eval` (needs LAYA_BASE_URL). `dev` was used to choose wording and the confidence bar; `test` is held out.
import { readFileSync } from 'node:fs';
import { splitSource } from '../lib/memory.mjs';
import { ask } from '../lib/providers.mjs';
import { QUESTIONS, decisionState, select } from '../lib/decision.mjs';

if (!process.env.LAYA_BASE_URL) { console.log('Set LAYA_BASE_URL to run this evaluation.'); process.exit(1); }
const data = JSON.parse(readFileSync(new URL('../eval/technique-samples.json', import.meta.url), 'utf8'));
const bars = [.4, .5, .6, .7, .8], configured = Number(process.env.LAYA_MIN_CONFIDENCE || .5);
const pct = (a, b) => b ? Math.round(100 * a / b) + '%' : 'n/a';

for (const split of ['dev', 'test']) {
  const rows = [];
  for (const s of data[split]) {
    const units = splitSource(s.text, s.kind), { answers } = await ask(decisionState(units, s.mode), QUESTIONS);
    rows.push({ s, units, answers });
  }
  const n = rows.length;
  console.log('\n== ' + split + ' (' + n + ' labelled tasks) ==');
  const targetRight = rows.filter(r => r.s.target.includes(r.answers.target.choice)).length;
  console.log('Decision model alone, "what must be recalled?": ' + targetRight + '/' + n + ' correct (' + pct(targetRight, n) + ')');
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
