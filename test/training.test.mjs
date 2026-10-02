import test from 'node:test';
import assert from 'node:assert/strict';
import { planSessions, nextDue, upcoming, today, isDay, addDays, calendarFile } from '../lib/schedule.mjs';
import { createKit, reviewKit, setTarget, repairScene, repairable } from '../lib/orchestrate.mjs';
import { withMocks, mocks, startServer, client } from './helpers.mjs';

const NOW = Date.UTC(2026, 9, 2, 12);   // 2 October 2026, midday UTC

test('days are validated and the learner\'s today is trusted only near the server\'s date', () => {
  assert.deepEqual([isDay('2026-10-02'), isDay('2026-02-30'), isDay('02/10/2026'), isDay(20261002)], [true, false, false, false]);
  assert.equal(addDays('2026-10-30', 3), '2026-11-02');
  assert.equal(today('2026-10-03', NOW), '2026-10-03', 'one day ahead is a time zone');
  assert.equal(today('2026-10-09', NOW), '2026-10-02', 'a week ahead is not');
  assert.equal(today(undefined, NOW), '2026-10-02');
});

test('sessions widen towards a deadline and always end with a run-through and a final check', () => {
  assert.deepEqual(planSessions('2026-10-02', '2026-10-30'), ['2026-10-02', '2026-10-03', '2026-10-05', '2026-10-09', '2026-10-16', '2026-10-29', '2026-10-30']);
  assert.deepEqual(planSessions('2026-10-02', '2026-10-05'), ['2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05'], 'a few days out it is daily');
  assert.deepEqual(planSessions('2026-10-02', '2026-10-03'), ['2026-10-02', '2026-10-03']);
  assert.deepEqual(planSessions('2026-10-02', '2026-10-02'), ['2026-10-02']);
});

test('the next practice day follows the plan, repeats today after a poor session, and doubles without a deadline', () => {
  const planned = { plan: ['2026-10-02', '2026-10-03', '2026-10-05'] };
  assert.equal(nextDue(planned, '2026-10-02', 1, 1), '2026-10-03');
  assert.equal(nextDue(planned, '2026-10-03', .9, 2), '2026-10-05');
  assert.equal(nextDue(planned, '2026-10-03', .5, 0), '2026-10-03', 'below 80% it comes back today');
  assert.equal(nextDue(planned, '2026-10-05', 1, 3), '2026-10-13', 'past the plan it falls back to doubling gaps');
  assert.deepEqual([1, 2, 3, 4, 5, 9].map(s => nextDue({}, '2026-10-02', 1, s)), ['2026-10-04', '2026-10-06', '2026-10-10', '2026-10-18', '2026-11-01', '2026-11-01']);
  assert.deepEqual(upcoming({ plan: planned.plan, dueDay: '2026-10-03' }, '2026-10-03'), ['2026-10-03', '2026-10-05']);
  assert.deepEqual(upcoming({ dueDay: '2026-09-20' }, '2026-10-02'), ['2026-10-02'], 'an overdue kit is due today');
});

test('the calendar file lists each coming session and marks the final check', () => {
  const kit = { id: 'k1', title: 'Opening remarks; thanks, sponsors', technique: { name: 'Method of loci' }, scenes: [{}, {}], plan: ['2026-10-02', '2026-10-05'], dueDay: '2026-10-02', targetDay: '2026-10-05' };
  const ics = calendarFile([kit], '2026-10-02', NOW);
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n') && ics.endsWith('END:VCALENDAR\r\n'));
  assert.equal(ics.match(/BEGIN:VEVENT/g).length, 2);
  assert.match(ics, /UID:k1-2026-10-02@recall\r\nDTSTAMP:20261002T120000Z\r\nDTSTART;VALUE=DATE:20261002\r\nDTEND;VALUE=DATE:20261003\r\n/);
  assert.match(ics, /SUMMARY:Recall practice: Opening remarks\\; thanks\\, sponsors\r\n/);
  assert.match(ics, /SUMMARY:Recall final check: Opening remarks/);
  assert.ok(ics.split('\r\n').every(line => Buffer.byteLength(line) <= 75), 'lines are folded to 75 bytes');
});

const groceries = { text: 'milk, eggs, bread', kind: 'list', module: 'Everyday memory', mode: 'exact', absurdity: 'Playful' };
const answers = (...list) => list.map(([answer, hint = 0], index) => ({ index, answer, hint }));

test('a target date plans the sessions; clearing it removes the plan; bad dates are refused', () => withMocks({ laya: ['unordered_items', .9] }, async () => {
  const kit = await createKit(groceries);
  const day = today();
  setTarget(kit, addDays(day, 3), day);
  assert.deepEqual([kit.targetDay, kit.plan, kit.dueDay], [addDays(day, 3), [0, 1, 2, 3].map(n => addDays(day, n)), day]);
  assert.throws(() => setTarget(kit, addDays(day, -1), day), /today or a later date/);
  assert.throws(() => setTarget(kit, 'next friday', day), /YYYY-MM-DD/);
  assert.throws(() => setTarget(kit, addDays(day, 800), day), /within two years/);
  setTarget(kit, null, day);
  assert.deepEqual([kit.targetDay, kit.plan], [undefined, undefined]);
  const planned = await createKit({ ...groceries, targetDate: addDays(day, 1), today: day });
  assert.deepEqual(planned.plan, [day, addDays(day, 1)]);
}));

test('guided practice grades each scene, separates unaided recall from hinted recall, and schedules the next day', () => withMocks({ laya: ['unordered_items', .9] }, async () => {
  const kit = await createKit(groceries), day = today();
  setTarget(kit, addDays(day, 3), day);
  const r = await reviewKit(kit, { items: answers(['Milk'], ['egg', 2], ['bread', 1]), today: day });
  assert.deepEqual([r.mode, r.recalled, r.unaided, r.missed, r.feedback], ['guided', 2, 1, ['eggs'], '2 of 3 recalled, 1 without hints. Missed: eggs.']);
  assert.equal(r.score, (1 + 0 + .6) / 3);
  assert.deepEqual(r.items.map(i => [i.source, i.correct, i.hint]), [['milk', true, 0], ['eggs', false, 2], ['bread', true, 1]]);
  assert.deepEqual(kit.scenes.map(s => [s.stats.attempts, s.stats.recalled, s.stats.unaided, s.stats.missStreak]), [[1, 1, 1, 0], [1, 0, 0, 1], [1, 1, 0, 0]]);
  assert.deepEqual([kit.streak, kit.dueDay, r.repairable], [0, day, []], 'below 80%, so it is due again today');
  const again = await reviewKit(kit, { items: answers(['milk'], ['eggs'], ['bread']), today: day });
  assert.deepEqual([again.score, kit.streak, kit.dueDay], [1, 1, addDays(day, 1)], 'a clean session moves to the next planned day');
  assert.equal(kit.reviews.length, 2);
  assert.equal(kit.reviews[0].repairable, undefined, 'the stored record does not carry the repair offer');
}));

test('guided answers are validated, and a subset of scenes can be practised', () => withMocks({ laya: ['unordered_items', .9] }, async () => {
  const kit = await createKit(groceries);
  for (const bad of [[], [{ index: 9, answer: 'x', hint: 0 }], [{ index: 0, answer: 'x', hint: 7 }], [{ index: 0, answer: 5, hint: 0 }], [{ index: 0, answer: 'a', hint: 0 }, { index: 0, answer: 'b', hint: 0 }]])
    await assert.rejects(reviewKit(kit, { items: bad }), /Invalid practice answers/);
  const r = await reviewKit(kit, { items: [{ index: 1, answer: 'eggs', hint: 0 }] });
  assert.deepEqual([r.recalled, r.items.length, kit.scenes[0].stats, kit.scenes[1].stats.attempts], [1, 1, undefined, 1]);
}));

test('meaning kits are graded per item by the model, and its scores are checked', async () => {
  await withMocks({ laya: ['unordered_items', .9], itemScores: [.9, .2, .75] }, async () => {
    const kit = await createKit({ ...groceries, mode: 'meaning' });
    const r = await reviewKit(kit, { items: answers(['dairy drink'], ['no idea'], ['a loaf']) });
    assert.deepEqual(r.items.map(i => i.correct), [true, false, true]);
  });
  await withMocks({ laya: ['unordered_items', .9], itemScores: [.9] }, async () => {
    const kit = await createKit({ ...groceries, mode: 'meaning' });
    await assert.rejects(reviewKit(kit, { items: answers(['a'], ['b'], ['c']) }), /Invalid review scores/);
  });
});

test('free recall of a list also updates each item\'s record', () => withMocks({ laya: ['unordered_items', .9] }, async () => {
  const kit = await createKit(groceries);
  await reviewKit(kit, { answer: 'milk and bread' });
  assert.deepEqual(kit.scenes.map(s => s.stats.missStreak), [0, 1, 0]);
  assert.deepEqual(kit.scenes[1].stats.answers, ['milk and bread']);
}));

// Two sessions in a row missing "eggs".
async function failingKit() {
  const kit = await createKit(groceries);
  await reviewKit(kit, { items: answers(['milk'], ['cheese'], ['bread']) });
  await reviewKit(kit, { items: answers(['milk'], ['butter', 2], ['bread']) });
  return kit;
}

test('a cue is offered for rewriting only after two missed sessions in a row, and the rewrite is held to the contract', () => withMocks({ laya: ['unordered_items', .9] }, async m => {
  const fresh = await createKit(groceries);
  await reviewKit(fresh, { items: answers(['milk'], ['cheese'], ['bread']) });
  assert.deepEqual(repairable(fresh), []);
  await assert.rejects(repairScene(fresh, 1), /only after it has been missed in two sessions in a row/);

  const kit = await failingKit();
  assert.deepEqual(repairable(kit), [1]);
  const before = kit.scenes[1].cue;
  const r = await repairScene(kit, 1);
  // The repair agent saw the evidence: the contract, the failing cue, the learner's wrong answers and the other cues.
  const sent = m.calls.repair[0];
  assert.deepEqual([sent.contract.primary_technique, sent.scene_number, sent.failing.cue, sent.learner_answers, sent.other_cues.length], ['link', 2, before, ['cheese', 'butter'], 2]);
  assert.deepEqual([r.repair.scene, r.repair.source, r.repair.diagnosis, r.repair.before, r.repair.after], [2, 'eggs', 'cue_ambiguity', before, 'fresh ' + before]);
  assert.deepEqual([kit.scenes[1].source, kit.scenes[1].cue, kit.scenes[1].image, kit.scenes[1].repaired, kit.scenes[1].stats.missStreak, kit.scenes[1].stats.attempts], ['eggs', 'fresh ' + before, null, 1, 0, 2]);
  assert.deepEqual([kit.repairs.length, repairable(kit), kit.scenes[0].cue.startsWith('fresh')], [1, [], false], 'only the failing scene changed');
}));

test('a rewrite that breaks the contract, rewords the source or repeats the old cue is sent back, then refused', async () => {
  const breaksLink = (s, fresh) => ({ diagnosis: 'weak_link', explanation: 'x', scene: { ...fresh, cue: 'an egg alone', evidence: { links_to: 'milk' } } });
  await withMocks({ laya: ['unordered_items', .9], repair: [breaksLink, null] }, async m => {
    const kit = await failingKit();
    await repairScene(kit, 1);
    assert.equal(m.calls.repair.length, 2);
    assert.deepEqual(m.calls.repair[1].issues, ['Scene 2: evidence.links_to must be the next source unit, "bread".', 'Scene 2: the cue does not show "eggs" interacting with the next item, "bread".']);
  });
  const unchanged = (s, fresh) => ({ diagnosis: 'made-up', explanation: 'x', scene: fresh });
  await withMocks({ laya: ['unordered_items', .9], repair: [unchanged] }, async m => {
    const kit = await failingKit(), cue = kit.scenes[1].cue;
    await assert.rejects(repairScene(kit, 1), /could not be rewritten within the Link system contract after 3 attempts: Scene 2: the replacement cue is the same as the failing one\./);
    assert.deepEqual([m.calls.repair.length, kit.scenes[1].cue, kit.repairs], [3, cue, undefined], 'the kit is untouched');
  });
  const reworded = (s, fresh) => ({ diagnosis: 'weak_link', explanation: 'x', scene: { ...fresh, source: 'egg', cue: 'fresh cue' } });
  await withMocks({ laya: ['unordered_items', .9], repair: [reworded, null] }, async m => {
    const kit = await failingKit();
    const r = await repairScene(kit, 1);
    assert.deepEqual([m.calls.repair[1].issues, r.repair.diagnosis], [['Source wording or order changed.'], 'cue_ambiguity']);
  });
});

test('the server sets targets, grades guided practice, rewrites cues and serves the calendar, per account', async () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]).toString('base64');
  const m = await mocks({ laya: ['unordered_items', .9], jpeg }), s = await startServer(3091, m.env);
  try {
    const alice = client(s.base), bob = client(s.base), day = today();
    await alice.register('alice'); await bob.register('bob');
    const kit = (await alice.json('/api/kits', 'POST', { ...groceries, targetDate: addDays(day, 2), today: day })).body;
    assert.deepEqual(kit.plan, [day, addDays(day, 1), addDays(day, 2)]);
    const t = await alice.json('/api/kits/' + kit.id + '/target', 'POST', { targetDate: addDays(day, 1), today: day });
    assert.deepEqual([t.status, t.body.targetDay, t.body.plan], [200, addDays(day, 1), [day, addDays(day, 1)]]);
    assert.equal((await alice.json('/api/kits/' + kit.id + '/target', 'POST', { targetDate: 'soon' })).status, 400);
    assert.equal((await bob.json('/api/kits/' + kit.id + '/target', 'POST', { targetDate: addDays(day, 1) })).status, 404);

    const ics = await alice.call('/api/calendar.ics?today=' + day);
    assert.deepEqual([ics.status, ics.headers.get('content-type'), (await ics.text()).match(/BEGIN:VEVENT/g).length], [200, 'text/calendar; charset=utf-8', 2]);
    assert.equal((await (await bob.call('/api/calendar.ics')).text()).includes('VEVENT'), false, 'another account sees none of it');
    assert.equal((await fetch(s.base + '/api/calendar.ics')).status, 401);

    await alice.json('/api/kits/' + kit.id + '/image', 'POST', { index: 1 });
    const practice = items => alice.json('/api/kits/' + kit.id + '/review', 'POST', { items, today: day });
    assert.deepEqual((await practice(answers(['milk'], ['cheese'], ['bread']))).body.repairable, []);
    assert.deepEqual((await practice(answers(['milk'], ['butter'], ['bread']))).body.repairable, [1]);
    assert.equal((await alice.json('/api/kits/' + kit.id + '/repair', 'POST', { index: 0 })).status, 400, 'a cue that is not failing is not rewritten');
    assert.equal((await bob.json('/api/kits/' + kit.id + '/repair', 'POST', { index: 1 })).status, 404);
    const fixed = await alice.json('/api/kits/' + kit.id + '/repair', 'POST', { index: 1 });
    assert.deepEqual([fixed.status, fixed.body.repair.diagnosis, fixed.body.scene.image, fixed.body.scene.cue.startsWith('fresh ')], [200, 'cue_ambiguity', null, true]);
    const saved = (await alice.json('/api/kits')).body[0];
    assert.deepEqual([saved.repairs.length, saved.scenes[1].repaired, saved.reviews.length, saved.scenes[1].image], [1, 1, 2, null]);
  } finally { await s.stop(); m.close(); }
});
