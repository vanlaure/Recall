# Evaluation: technique selection and contract enforcement

Measured on 2026-10-02 with the Laya `english` checkpoint (laya 0.3.23, CPU) and
`nvidia/nemotron-3-super-120b-a12b`. Reproduce the selection numbers with `npm run eval`
(needs `LAYA_BASE_URL`). The labelled tasks are in `eval/technique-samples.json`.

## What was measured

40 labelled memory tasks, 20 used to choose question wording and the confidence bar (`dev`) and 20 held out
(`test`). Each task lists the recall targets and the final techniques a careful person would accept.

## The decision model on its own

| Question put to Laya | dev | test |
|---|---|---|
| "What does the learner mainly need to recall?" (7 options, each described) | 15/20 | 15/20 |
| "Which technique family best fits?" (7 options) | 9/20 at best | not run |
| The same recall-target question with bare option names | 9–10/20 | not run |
| The state as JSON instead of labelled text | 7–11/20 | not run |

Yes/no questions (`noul`) were right on 15–19 of 20 `dev` tasks per question, but mostly by answering "no": on the
tasks where the true answer was "yes", the average probability was between 0.09 ("is this a quotation to recite?")
and 0.62 ("is this a foreign word with its meaning?").

Conclusion: Laya is right about three times in four on this material and is not reliable enough to choose a
technique alone. The technique-family question and the yes/no questions are not used for selection. The yes/no
answers are still asked and shown to the learner as supporting evidence.

### Sensitivity to presentation, and calibration

Measured on 2026-10-02 with `english` at revision `55cf4c4ebb4e` on CPU. The same recall-target question was asked
again with the seven options in the opposite order, and again with the question reworded.

| | dev | test |
|---|---|---|
| Original question: correct | 15/20 | 15/20 |
| Options reversed: same answer as original | 11/20 | 10/20 |
| Options reversed: correct | 9/20 | 10/20 |
| Question reworded: same answer as original | 13/20 | 12/20 |
| Question reworded: correct | 12/20 | 13/20 |
| Correct when stated confidence is under 50% | 2/4 | 1/2 |
| Correct when stated confidence is 50–80% | 4/6 | 5/7 |
| Correct when stated confidence is 80% or more | 9/10 | 9/11 |

Negation, over the five yes/no questions on every task (100 answers per split), each also asked as its opposite
("Is this a single item, not a list of separate items?"):

| | dev | test |
|---|---|---|
| Question as Recall asks it: correct | 79/100 | 81/100 |
| Asked as the opposite: correct | 37/100 | 37/100 |
| The two answers differ, as they should | 22/100 | 24/100 |

The stock checkpoint gives the same answer to a question and its opposite about three times in four: it mostly
answers "no" whichever way the question faces. Its yes/no answers are therefore shown as supporting evidence only
and decide nothing.

The stock checkpoint's answer changes on about half the tasks when only the order of the options changes. Its
accuracy with the wording and order Recall uses was arrived at on the `dev` tasks, so part of the 15/20 belongs to
that presentation rather than to the model's reading of the material. Stated confidence rises with accuracy but
overstates it: 18 of 21 answers given at 80% or more were right.

## Authority and promotion of a checkpoint

Each kind of decision has a mode, set in configuration and recorded with every kit together with the checkpoint,
its revision and its device:

- `LAYA_TECHNIQUE_MODE` (default `enforced`): above the confidence bar and within the code facts, the recall-target
  answer selects the technique. Supported by the pipeline table below. With `advisory`, the answer is recorded and
  given to the Memory Expert, who chooses.
- `LAYA_CUE_MODE` (default `advisory`): the cue check is recorded and shown. With `enforced`, a cue read as another
  item is sent back once for rewriting, and the result is recorded as passed or unresolved. Not supported by any
  measurement yet, so it stays advisory.

- `LAYA_REPAIR_MODE` (default `advisory`): when a cue is rewritten after repeated misses, Laya reads the recorded
  attempts and wrong answers and names the likely cause. It is stored beside Nemotron's diagnosis. With `enforced`,
  and at or above the confidence bar, Laya's cause directs the rewrite. Not measured: there are no labelled
  cue-failure cases yet. In one live rewrite Laya answered "weak link" at 27% where Nemotron said "cue ambiguity".

One live run with the cue check enforced (seven errands on a route): six of seven cues were read back as their own
item, the storyboard was sent back with the stray one named, and the rewritten storyboard passed seven of seven.
That shows the loop works, not that the check is accurate.

`npm run export:training` writes the labelled `dev` tasks (never `test`) in Laya's own labelled-dataset format
(`{state, questions, expected, tags}` per line), checked with `laya-evals validate`. With `--kits <data folder>`
it adds cue-to-item examples and recorded cue-rewrite causes from saved kits; those are learners' own material and
weak labels, tagged as such. The Laya package installed here (0.3.23) contains evaluation and calibration tools
but no training command, so whether the upstream training code takes this file unchanged has not been checked.

A checkpoint trained on Recall's own questions and tasks is expected to do better than these numbers, and every
decision it takes over from Nemotron removes a paid model call. The route to that is: serve the new checkpoint,
run `npm run eval`, and change a mode only if the numbers for that checkpoint support it. The figures to beat are
the ones above, option-order stability first. Tasks used to train a checkpoint must not be the `test` tasks here.

## The full selection pipeline

1. The learner's own choice is honoured if the technique can represent the material, and refused with the reason
   if it cannot.
2. Code decides what it can determine exactly: digits only, items numbered from 1, items starting with a year,
   word-and-meaning pairs, names with titles; and, within a kind of material, the counts (list length, digit count).
3. Otherwise Laya's recall-target answer is used when its confidence is at or above `LAYA_MIN_CONFIDENCE` and it
   does not contradict the facts (it cannot say "digits" when there are none).
4. Otherwise the Nemotron Memory Expert chooses, given the facts and Laya's answers, from the techniques that can
   represent the material.

| Confidence bar | dev: by code | by model | escalated | wrong | test: by code | by model | escalated | wrong |
|---|---|---|---|---|---|---|---|---|
| 0.4 | 10/10 | 8/8 | 2 | 0 | 10/10 | 8/8 | 2 | 0 |
| 0.5 (default) | 10/10 | 6/6 | 4 | 0 | 10/10 | 7/7 | 3 | 0 |
| 0.6 | 10/10 | 6/6 | 4 | 0 | 10/10 | 6/6 | 4 | 0 |
| 0.8 | 10/10 | 5/5 | 5 | 0 | 10/10 | 5/5 | 5 | 0 |

"x/y" means y tasks were decided at that step and x of those picks were acceptable. No automatic pick was wrong at
any bar; the bar only changes how many tasks are handed to the Memory Expert. The Memory Expert's own picks on the
escalated tasks were not scored here.

## Contract enforcement

Each storyboard must satisfy a contract checked by code (`lib/validate.mjs`): exact source wording and order,
technique-specific evidence (for example the Major-system words must decode to the source digits; each memory-palace
cue needs its own named location), and image prompts with no numerals and no request for words, labels or logos.
A failing storyboard goes back to the generating agent with the specific violation, at most three times.

Twelve live requests through the full workflow, one per technique plus two learner choices:

- 11 produced a compliant kit; the twelfth was a learner choice the material cannot support (Major system on a
  grocery list), refused before any model was called.
- 9 of the 11 complied on the first attempt. One was sent back by the contract check (a peg cue that did not name
  its peg) and one by the Rules agent; both complied on the second attempt.
- The Major-system kits decode correctly: 8472 as "far ken", 1066 as "tea sea she she".

Before the contract existed, an unchecked run encoded 1066 as "tooth, sausage, sheep, sheep", which reads as
11-00-6-6. The decoder now rejects that.

## Image inspection

After an image is generated, a vision model reports what it shows as typed fields (visible text, logos, a real or
photographed person, style, each required object, the action, clarity), and code applies the image rules to that
report (`lib/vision.mjs`). A rule-breaking image is regenerated with a correction aimed at what was wrong, at most
three times, then kept and marked for the learner's review. Reproduce with `npm run eval:vision`.

18 labelled checks on 16 images in `eval/images/`: nine acceptable illustrations, seven that break a rule (five
generated to do so on purpose: a shop sign, numerals on a clock, a labelled jar, a photographed man, an oil
painting), and two decoys that ask for an object the picture does not contain.

| Vision model | Correct verdicts | Rule-breakers accepted | Good images rejected | Errors | Median time |
|---|---|---|---|---|---|
| `zai-org/GLM-5.3-Flash` on Nebius (default there) | 18/18 | 0 | 0 | 0 | 3.6 s |
| `Qwen/Qwen3.8-27B` on Nebius | 17/18 | 0 | 0 | 1 unreadable report | 1.6 s |
| `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning` on NVIDIA (default there) | 16/18 | 1 (numerals on a clock) | 0 | 1 provider 503 | 15.5 s |
| `google/gemma-3-27b-it` on Nebius | 12/18 | 0 | 6 | 0 | 2.2 s |
| `openbmb/MiniCPM-V-4_5` on Nebius | 6/18 | 0 | 9 | 3 | 0.8 s |

A live run through the server with GLM-5.3-Flash, five storyboards and 13 images:

- 10 images were accepted, 8 on the first attempt. Two were regenerated: one for visible text and a logo, one
  for a missing object; both passed afterwards.
- 1 was kept and marked for review after three attempts (the picture did not show the cue's action).
- 2 were left unchecked: one provider timeout and one unreadable report.
- 18 images were generated in total for the 13 scenes.

## Limits

- The 40 tasks and the code rules were written by the same author in the same session, so the held-out set is not
  independent of the rules. The zero-wrong-picks result should be read as "the pipeline does what it was designed to
  do on this kind of input", not as an accuracy estimate for real learners' material.
- 20 tasks per split is too few to distinguish, say, 95% from 100%.
- The Major-system decoder works from spelling, and accepts any plausible reading of an ambiguous letter group, so
  it catches extra or wrong consonants but can accept a word whose actual pronunciation differs.
- Compliance is not quality. A chunking cue passed the contract while being a poor mnemonic. The Rules agent's
  judgement of cue ambiguity is a model opinion and was not measured.
- The cue check (Laya reading each finished cue back to a source unit) is recorded and shown but not enforced,
  because of the accuracy above.
- The image inspection was measured on 18 checks, most of them clear-cut. Subtle cases (faint lettering, a brand-like
  shape, an object that is present but unrecognisable) are untested, and the "wrong action" judgement is a model
  opinion that was not measured separately.
- An image the inspector cannot read (timeout, malformed report) is kept and marked unchecked rather than blocked.
- None of this measures whether learners remember more. No recall data has been collected.
