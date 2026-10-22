import test from 'node:test';
import assert from 'node:assert/strict';
import { kindOf, runs, splitIntoParts, MAX_PARTS } from '../lib/plan.mjs';
import { createKit, repairScene } from '../lib/orchestrate.mjs';
import { receipt, summarize } from '../lib/audit.mjs';
import { withMocks } from './helpers.mjs';

const base = { module: 'Everyday memory', mode: 'exact', absurdity: 'Playful' };
const SENTENCE = 'For God so loved the world, that he gave his only begotten Son.';

test('each item is classed by its shape alone', () => {
  assert.deepEqual(['8472', '415 555 0132', '1066 Battle of Hastings', '1 speech', 'pato means duck', 'Dr. Okafor', 'milk', SENTENCE, 'buy some fresh milk today'].map(kindOf),
    ['digits', 'digits', 'dated', 'numbered', 'vocabulary', 'name', 'item', 'prose', 'mid']);
});

test('neighbouring items of one kind form a run, and an in-between item joins the run before it', () => {
  assert.deepEqual(runs(['milk', 'eggs', 'bread', '8472']).map(r => [r.kind, r.from, r.units.length]), [['item', 0, 3], ['digits', 3, 1]]);
  assert.deepEqual(runs(['milk', 'buy some fresh milk today', '8472']).map(r => [r.kind, r.units.length]), [['item', 2], ['digits', 1]]);
  assert.deepEqual(runs(['buy some fresh milk today', 'eggs', '8472']).map(r => [r.kind, r.units.length]), [['item', 2], ['digits', 1]], 'a leading in-between item takes the next run\'s kind');
  assert.deepEqual(runs(['milk', '8472', 'eggs']).map(r => r.kind), ['item', 'digits', 'item'], 'order is kept, so the same kind can appear twice');
});

test('material of one kind is not split, and neither is material that would break into too many parts', () => {
  assert.equal(splitIntoParts(['milk', 'eggs', 'bread']), null);
  assert.equal(splitIntoParts([SENTENCE, SENTENCE + ' Amen. Amen. Amen.']), null);
  assert.equal(splitIntoParts(['milk']), null);
  assert.equal(splitIntoParts(['8472', 'milk', '1066 Battle of Hastings', 'pato means duck', 'Dr. Okafor']), null, 'more than ' + MAX_PARTS + ' parts');
  assert.deepEqual(splitIntoParts(['1 speech', '2 arms', SENTENCE]).map(p => [p.kind, p.from, p.units.length]), [['numbered', 0, 2], ['prose', 2, 1]]);
});

test('mixed material is built in parts, each under its own technique, in the learner\'s order', () => withMocks({ laya: ['unordered_items', .9] }, async m => {
  const events = [];
  const kit = await createKit({ ...base, text: 'milk, eggs, bread, 8472', kind: 'list' }, e => events.push(e));
  assert.deepEqual(kit.scenes.map(s => s.source), ['milk', 'eggs', 'bread', '8472']);
  assert.deepEqual(kit.scenes.map(s => s.part), [0, 0, 0, 1]);
  assert.deepEqual(kit.segments.map(g => [g.technique.technique, g.technique.selectedBy, g.from, g.count]), [['link', 'laya', 0, 3], ['major', 'code', 3, 1]]);
  assert.deepEqual(m.calls.storyboard.map(s => [s.contract.primary_technique, s.contract.source_units.join('|')]), [['link', 'milk|eggs|bread'], ['major', '8472']]);
  // The digits are settled by code, so only the words were put to the decision model.
  assert.equal(m.calls.laya.filter(c => 'target' in c.questions).length, 1);
  // The kit carries one technique record for everything that shows "the kit's technique".
  assert.deepEqual([kit.technique.name, kit.technique.selectedBy, kit.technique.technique, kit.technique.parts], ['Link system + Major system', 'split', 'link', 2]);
  assert.match(kit.technique.reason, /Link system for items 1–3; Major system for item 4/);
  assert.equal(kit.contract, undefined);
  assert.ok(events.some(e => e.agent === 'Part 2 Contract check' && e.status === 'done') && events.some(e => e.agent === 'Plan'));
  assert.ok(kit.trace.some(t => t.agent === 'Plan'));
}));

test('a split kit\'s receipt lists its parts, and its refusals are still counted', () => withMocks({ laya: ['unordered_items', .9], storyboard: [null, s => { const b = { scenes: s.contract.source_units.map(source => ({ source, cue: 'x', prompt: 'a drawing', objects: ['a'], evidence: { words: ['octopus'] } })) }; return b; }, null] }, async () => {
  const kit = await createKit({ ...base, text: 'milk, eggs, bread, 8472', kind: 'list' });
  const r = receipt(kit);
  assert.deepEqual(r.parts.map(p => [p.part, p.technique, p.items]), [[1, 'link', 3], [2, 'major', 1]]);
  assert.equal(r.contract, null);
  assert.ok(r.rejections.some(x => /^Part 2 /.test(x.step) && x.check === 'technique contract'), 'a refusal inside a part is attributed to its check');
  assert.equal(summarize(kit).firstAttempt, false);
}));

test('a cue in one part is rewritten under that part\'s contract and compared only with that part', () => withMocks({ laya: ['unordered_items', .9] }, async m => {
  const kit = await createKit({ ...base, text: 'milk, eggs, bread, 8472', kind: 'list' });
  kit.scenes[3].stats = { attempts: 2, recalled: 0, unaided: 0, missStreak: 2, answers: ['bob', 'tom'] };
  const out = await repairScene(kit, 3);
  assert.equal(m.calls.repair.at(-1).contract.primary_technique, 'major');
  assert.equal(m.calls.repair.at(-1).scene_number, 1, 'its position within its own part');
  assert.equal(out.scene.part, 1);
  assert.equal(kit.scenes[3].part, 1);
}));

test('the learner\'s own technique, or parts that end up with one technique, keep the kit whole', () => withMocks({ laya: ['unordered_items', .9] }, async m => {
  const chosen = await createKit({ ...base, text: 'milk, eggs, bread, 8472', kind: 'list', technique: 'link' });
  assert.equal(chosen.segments, undefined);
  assert.deepEqual([chosen.technique.technique, chosen.technique.selectedBy], ['link', 'learner']);
  // A vocabulary pair and a titled name are different kinds of item but both call for the keyword method.
  const same = await createKit({ ...base, text: 'pato means duck\nDr. Okafor', kind: 'list' });
  assert.equal(same.segments, undefined);
  assert.deepEqual([same.technique.technique, same.technique.selectedBy, same.contract.source_units.length], ['keyword', 'code', 2]);
  assert.equal(same.scenes.some(s => 'part' in s), false);
}));
