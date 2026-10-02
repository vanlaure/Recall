import test from 'node:test';
import assert from 'node:assert/strict';
import { splitSource, validateScenes, grade, gradeList } from '../lib/memory.mjs';

test('ordered list split rejects oversized kits', () => {
  assert.deepEqual(splitSource('milk, eggs; bread', 'list'), ['milk', 'eggs', 'bread']);
  assert.deepEqual(splitSource('one\n\n two ,, three', 'list'), ['one', 'two', 'three']);
  assert.throws(() => splitSource(Array(25).fill('x').join(','), 'list'));
});

test('list split keeps prose and numbers with commas whole', () => {
  const verse = 'For God so loved the world, that he gave his only begotten Son.';
  assert.deepEqual(splitSource(verse, 'list'), [verse]);
  assert.deepEqual(splitSource('1,000 apples, 2 pears', 'list'), ['1,000 apples', '2 pears']);
  assert.deepEqual(splitSource('1066 Battle of Hastings, 1215 Magna Carta', 'list'), ['1066 Battle of Hastings', '1215 Magna Carta']);
});

test('passage split keeps decimals, times and abbreviations inside one sentence', () => {
  assert.deepEqual(splitSource('3.1415926535', 'passage'), ['3.1415926535']);
  assert.deepEqual(splitSource('Meet Mr. Armstrong at 9.30 a.m. on Friday.', 'passage'), ['Meet Mr. Armstrong at 9.30 a.m. on Friday.']);
  assert.deepEqual(splitSource('The price is $4.50. Pay by Friday.', 'passage'), ['The price is $4.50.', 'Pay by Friday.']);
  assert.deepEqual(splitSource('Open with the story. Explain the problem! Any questions?', 'passage'), ['Open with the story.', 'Explain the problem!', 'Any questions?']);
  assert.deepEqual(splitSource('First line\nSecond line', 'passage'), ['First line', 'Second line']);
});

test('verbatim coverage rejects rewritten or omitted source', () => {
  assert.throws(() => validateScenes([{ source: 'changed', cue: 'x', prompt: 'x' }], ['original']));
  assert.throws(() => validateScenes([], ['original']));
  assert.equal(validateScenes([{ source: 'original', cue: 'x', prompt: 'x' }], ['original'])[0].source, 'original');
});

test('recall tracks omissions and order', () => {
  assert.equal(grade('Milk, eggs!', 'milk eggs'), 1);
  assert.ok(grade('milk eggs bread', 'milk') < .5);
  assert.ok(grade('milk eggs', 'eggs milk') < 1);
});

test('recall ignores accents, apostrophes and punctuation inside numbers', () => {
  assert.equal(grade('café', 'cafe'), 1);
  assert.equal(grade('It is 9:30', 'it is 930'), 1);
  assert.equal(grade("Don't stop", 'dont stop'), 1);
  assert.equal(grade('Meet Mr. Armstrong at 9.30 a.m. on Friday.', 'meet mr armstrong at 930 am on friday'), 1);
  assert.ok(grade('the the the cat', 'the cat') < 1);
});

test('list recall counts items, names the missed ones and reports order without penalising it', () => {
  const units = ['milk', 'eggs', 'bread'];
  assert.deepEqual(gradeList(units, 'bread, eggs and milk'), { score: 1, missed: [], inOrder: false });
  assert.deepEqual(gradeList(units, 'Milk. Eggs. Bread.'), { score: 1, missed: [], inOrder: true });
  assert.deepEqual(gradeList(units, 'milk and bread'), { score: 2 / 3, missed: ['eggs'], inOrder: true });
  assert.deepEqual(gradeList(['post office', 'bank'], 'the office post, bank'), { score: .5, missed: ['post office'], inOrder: true });
  assert.equal(gradeList(units, '').score, 0);
});
