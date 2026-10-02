// Writes labelled decisions for the decision model in Laya's own labelled-dataset format: one JSON object per line,
// {state, questions, expected, tags}, the format `laya-evals validate` checks. Use it to fine-tune or calibrate a
// checkpoint on Recall's questions, then measure the result with `npm run eval`.
//
//   npm run export:training                      labelled tasks only (the `dev` split)
//   npm run export:training -- --kits data       also examples from saved kits in that data folder
//
// The `test` split of eval/technique-samples.json is never exported: it is what a trained checkpoint is measured on.
// Kit examples are learners' own material and are weakly labelled (see the tags); export them only with permission.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { splitSource } from '../lib/memory.mjs';
import { QUESTIONS, decisionState, cueQuestion, REPAIR_QUESTION, repairState } from '../lib/decision.mjs';

const args = process.argv.slice(2), flag = name => args.includes(name) ? args[args.indexOf(name) + 1] : null;
const out = flag('--out') || 'eval/laya-train.jsonl', rows = [];

// The recall target and the yes/no questions it settles, from the labelled tasks.
const YES = { is_list: ['ordered_items', 'unordered_items'], is_vocabulary: ['vocabulary'], is_name: ['name_face'], is_recitation: ['exact_wording'], is_concept: ['meaning'] };
const data = JSON.parse(readFileSync(new URL('../eval/technique-samples.json', import.meta.url), 'utf8'));
for (const s of data.dev) {
  const expected = { target: s.target[0], ...Object.fromEntries(Object.entries(YES).map(([id, targets]) => [id, s.target.some(t => targets.includes(t))])) };
  rows.push({ state: decisionState(splitSource(s.text, s.kind), s.mode), questions: QUESTIONS, expected, tags: ['recall-target', 'labelled', ...(s.target.length > 1 ? ['several-acceptable'] : [])] });
}

// From saved kits: each accepted cue with the item it stands for, and each cue rewrite with the cause recorded for it.
const dir = flag('--kits');
if (dir) {
  const users = existsSync(dir + '/users') ? readdirSync(dir + '/users') : [];
  for (const user of users) {
    const file = dir + '/users/' + user + '/kits.json';
    if (!existsSync(file)) continue;
    for (const kit of JSON.parse(readFileSync(file, 'utf8'))) {
      const scenes = kit.scenes.filter(s => s.role !== 'reference');
      if (scenes.length >= 2 && scenes.length <= 8) scenes.forEach((s, i) => {
        // A cue counts as a good example only if practice has not shown it failing.
        if (!(s.stats?.missStreak > 0)) rows.push({ state: s.cue, questions: cueQuestion(scenes.map(x => x.source)), expected: { points_to: 'unit_' + (i + 1) }, tags: ['cue', 'from-kit', s.stats?.unaided ? 'recalled-unaided' : 'not-yet-practised'] });
      });
      // The cause was named by a model, not a person: a weak label, kept apart by its tag.
      for (const r of kit.repairs || []) rows.push({ state: repairState({ source: r.source, cue: r.before, stats: { answers: r.answers } }), questions: REPAIR_QUESTION, expected: { cause: r.diagnosis }, tags: ['repair-cause', 'from-kit', 'model-labelled'] });
    }
  }
}

writeFileSync(out, rows.map(r => JSON.stringify(r)).join('\n') + '\n');
const count = tag => rows.filter(r => r.tags.includes(tag)).length;
console.log('Wrote ' + rows.length + ' rows to ' + out + ': ' + count('recall-target') + ' labelled tasks, ' + count('cue') + ' cues from kits, ' + count('repair-cause') + ' cue-rewrite causes from kits.');
console.log('The held-out test tasks were not exported. Check the file with: laya-evals validate ' + out);
