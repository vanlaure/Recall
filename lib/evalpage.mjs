// The public evaluation page at /eval: no login, no scripts. It shows (1) counts of what code refused across every
// account, which carry no wording; (2) the full record of refusals from the accounts named in EVAL_PUBLIC_USERS,
// which the owner chose to publish (a demo account, say); and (3) every live benchmark run, with the published numbers
// beside it. Nobody else's material, cues or answers appear.
import { rejections, summarize } from './audit.mjs';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const pct = (a, b) => b ? Math.round(100 * a / b) + '%' : 'n/a';
const REPO = 'https://github.com/vanlaure/Recall/blob/main/';

const STYLE = `
:root{--bg:#fbfaf7;--fg:#1d1d1b;--muted:#5d5b55;--line:#dcd8cf;--accent:#1f5f8b;--ok:#2e6b3a;--bad:#9b2f22;--card:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#141413;--fg:#ecebe6;--muted:#a8a59c;--line:#33322e;--accent:#7fb6dc;--ok:#8fcf9b;--bad:#f0988a;--card:#1c1c1a}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}
main{max-width:980px;margin:0 auto;padding:24px 16px 64px}h1{font-size:1.9rem;margin:.2em 0}h2{margin-top:2em;border-bottom:1px solid var(--line);padding-bottom:.2em}
p.lead{color:var(--muted);max-width:70ch}a{color:var(--accent)}code{font-size:.9em}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px}.tile{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px}
.tile b{display:block;font-size:1.6rem}.tile span{color:var(--muted);font-size:.9rem}
.scroll{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:.92rem;background:var(--card)}th,td{border:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}
th{font-weight:600}.ok{color:var(--ok)}.bad{color:var(--bad)}.muted{color:var(--muted)}details{margin:.5em 0}summary{cursor:pointer}`;

const tile = (n, label) => `<div class="tile"><b>${esc(n)}</b><span>${esc(label)}</span></div>`;
const mark = ok => ok ? '<span class="ok">yes</span>' : '<span class="bad">no</span>';

function totalsSection(t) {
  const checks = Object.entries(t.byCheck).sort((a, b) => b[1] - a[1]);
  return `<h2>Across every account</h2>
<p class="lead">Counts only. They come from the records each kit keeps of its own workflow; no wording, cue or answer is shown.</p>
<div class="tiles">${tile(t.kits, 'storyboards built')}${tile(pct(t.firstAttempt, t.kits), 'passed every check on the first attempt')}${tile(t.storyboardRejections, 'storyboards sent back by a check')}${tile(t.imageRegenerations, 'images rejected by inspection and redrawn')}${tile(t.imagesInspected ? pct(t.imagesAccepted, t.imagesInspected) : 'n/a', 'of inspected images accepted')}${tile(t.cuesRewritten, 'cues rewritten after repeated misses')}</div>
${checks.length ? `<div class="scroll"><table><thead><tr><th>Check that refused</th><th>Refusals</th></tr></thead><tbody>${checks.map(([c, n]) => `<tr><td>${esc(c)}</td><td>${n}</td></tr>`).join('')}</tbody></table></div>` : ''}
<p class="muted">Who chose the technique: ${Object.entries(t.bySelector).map(([k, n]) => esc({ code: 'code, from the facts', laya: 'decision model', nemotron: 'Memory Expert (Nemotron)', learner: 'the learner', split: 'split into parts, each chosen separately' }[k] || k) + ' ' + n).join(' · ') || 'no kits yet'}.</p>`;
}

function publishedSection(records) {
  if (!records.length) return `<h2>Published records</h2><p class="lead">No account is published on this server. The owner sets <code>EVAL_PUBLIC_USERS</code> to show one account's records in full here.</p>`;
  const rows = [];
  for (const { username, kits } of records) for (const kit of kits) {
    const s = summarize(kit), r = rejections(kit);
    rows.push(`<details${r.length ? ' open' : ''}><summary><b>${esc(kit.title)}</b> <span class="muted">· ${esc(username)} · ${esc(kit.technique?.name)} (${esc(kit.technique?.selectedBy)}) · ${esc(String(kit.created).slice(0, 10))} · ${r.length ? r.length + ' refusal' + (r.length === 1 ? '' : 's') : 'no refusals'}${s.firstAttempt ? ', first attempt' : ''}</span></summary>
${r.length ? `<div class="scroll"><table><thead><tr><th>What</th><th>Check</th><th>Attempt / scene</th><th>Outcome</th><th>Reason given by code or reviewer</th></tr></thead><tbody>${r.map(x => `<tr><td>${esc(x.kind)}</td><td>${esc(x.check)}</td><td>${x.kind === 'storyboard' ? 'attempt ' + esc(x.attempt) : 'scene ' + esc(x.scene) + (x.attempt ? ', try ' + esc(x.attempt) : '')}</td><td>${esc(x.outcome)}${x.diagnosis ? ' (' + esc(x.diagnosis) + ')' : ''}</td><td>${x.issues.map(esc).join('<br>')}${x.before ? `<br><span class="muted">before: ${esc(x.before)}<br>after: ${esc(x.after)}</span>` : ''}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Every check passed on the first attempt.</p>'}</details>`);
  }
  return `<h2>Published records</h2><p class="lead">Every refusal in the kits of ${records.map(r => '<b>' + esc(r.username) + '</b>').join(', ')}, newest first, with the reason recorded at the time.</p>${rows.join('\n') || '<p class="muted">No kits yet.</p>'}`;
}

function benchmarkSection(runs, published) {
  const head = `<h2>Live benchmark runs</h2><p class="lead">Any logged-in judge can start a run from the studio (Tools, Live benchmark). Each run takes ${esc(5)} fresh tasks at random from the held-out test set in <a href="${REPO}eval/technique-samples.json">eval/technique-samples.json</a> and puts them through the full workflow. Code scores them: was the technique one a careful person would accept, did the storyboard meet its contract, and on which attempt. Every run is listed, including failures.</p>
<div class="scroll"><table><thead><tr><th>Published in <a href="${REPO}${esc(published.source)}">${esc(published.source)}</a></th><th>Value</th></tr></thead><tbody>${['selection', 'compliant', 'firstAttempt'].map(k => `<tr><td>${esc(published[k].label)}</td><td>${esc(published[k].value)}</td></tr>`).join('')}</tbody></table></div>
<p class="muted">The live technique score also counts picks handed to the Memory Expert, which the published selection figure leaves out.</p>`;
  if (!runs.length) return head + '<p class="muted">No live runs yet.</p>';
  return head + runs.map(run => `<details${run === runs[0] ? ' open' : ''}><summary><b>${esc(run.id.replace('T', ' ').slice(0, 16))} UTC</b> · technique acceptable ${run.score.techniqueOk}/${run.ran} · contract met ${run.score.compliant}/${run.ran} · first attempt ${run.score.firstAttempt}/${run.ran} · ${esc(run.seconds)} s</summary>
<div class="scroll"><table><thead><tr><th>Task</th><th>Technique chosen</th><th>Acceptable</th><th>Contract met</th><th>Attempts</th><th>Seconds</th></tr></thead><tbody>${run.results.map(r => `<tr><td>${esc(r.text)}</td><td>${r.technique ? esc(r.technique) + ' <span class="muted">(' + esc(r.decidedBy) + ')</span>' : '<span class="bad">' + esc(r.error) + '</span>'}</td><td>${mark(r.techniqueOk)} <span class="muted">${esc(r.acceptable.join(', '))}</span></td><td>${mark(r.compliant)}</td><td>${esc(r.attempts ?? '')}</td><td>${esc(r.seconds)}</td></tr>`).join('')}</tbody></table></div></details>`).join('\n');
}

export function evalPage({ totals, records, runs, published, model, generated = new Date().toISOString() }) {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Recall Evaluation Log</title><style>${STYLE}</style>
<main><p><a href="/">Recall</a> · <a href="/app">Studio</a></p><h1>Evaluation log</h1>
<p class="lead">Recall's models propose and its code decides. This page shows what the code refused, read from the records each kit keeps of its own workflow. Text model: <code>${esc(model)}</code>. Offline evaluation with method and every number: <a href="${REPO}docs/EVALUATION.md">docs/EVALUATION.md</a>. Generated ${esc(generated.replace('T', ' ').slice(0, 16))} UTC.</p>
${benchmarkSection(runs, published)}
${totalsSection(totals)}
${publishedSection(records)}
</main></html>`;
}
