import test from 'node:test';
import assert from 'node:assert/strict';
import { facts, select, workable, contract, QUESTIONS, decisionState } from '../lib/decision.mjs';
import { majorReadings, majorMatches, contractIssues, promptIssues } from '../lib/validate.mjs';

const target = (choice, confidence) => ({ target: { choice, answer_confidence: confidence } });
const chosen = args => { const s = select({ mode: 'exact', ...args }); return s.escalate ? 'escalate' : s.technique + ' by ' + s.selectedBy; };

test('facts are read from the material by code', () => {
  assert.deepEqual(facts(['415 555 0132']), { unitCount: 1, maxDigits: 10, totalDigits: 10, digitsOnly: true, numbered: false, dated: false, translations: false, titledNames: false, averageWords: 3 });
  assert.equal(facts(['1 speech', '2 arms', '3 quartering']).numbered, true);
  assert.equal(facts(['2 arms', '1 speech']).numbered, false, 'numbers must count up from 1');
  assert.equal(facts(['1066 Battle of Hastings', '1215 Magna Carta']).dated, true);
  assert.equal(facts(['pato means duck', 'Hund = dog']).translations, true);
  assert.equal(facts(['Dr. Okafor', 'Ms Lindqvist']).titledNames, true);
  assert.equal(facts(['milk', 'eggs']).digitsOnly, false);
});

test('code decides what it can determine exactly, without the decision model', () => {
  const wrong = target('vocabulary', .99);   // a confident wrong model answer must not override a fact
  assert.equal(chosen({ units: ['7'], laya: wrong }), 'shape by code');
  assert.equal(chosen({ units: ['8472'], laya: wrong }), 'major by code');
  assert.equal(chosen({ units: ['415 555 0132'], laya: wrong }), 'chunk by code');
  assert.equal(chosen({ units: ['1 speech', '2 arms'], laya: wrong }), 'peg by code');
  assert.equal(chosen({ units: ['1066 Battle of Hastings', '1215 Magna Carta'], laya: wrong }), 'major by code');
  assert.equal(chosen({ units: ['pato means duck'], laya: target('digits', .99) }), 'keyword by code');
  assert.equal(chosen({ units: ['Dr. Okafor', 'Ms Lindqvist'], laya: target('digits', .99) }), 'keyword by code');
});

test('the decision model is used only when confident and consistent with the facts', () => {
  const list = ['milk', 'eggs', 'bread'], long = ['a', 'b', 'c', 'd', 'e', 'f'];
  assert.equal(chosen({ units: list, laya: target('unordered_items', .9) }), 'link by laya');
  assert.equal(chosen({ units: long, laya: target('ordered_items', .9) }), 'loci by laya');
  assert.equal(chosen({ units: ['To be, or not to be.'], laya: target('exact_wording', .9) }), 'story by laya');
  assert.equal(chosen({ units: ['Inflation is a rise in prices.'], mode: 'meaning', laya: target('meaning', .9) }), 'visual by laya');
  assert.equal(chosen({ units: ['Priya Raman'], laya: target('name_face', .9) }), 'keyword by laya');
  assert.equal(chosen({ units: list, laya: target('unordered_items', .49) }), 'escalate', 'below the confidence bar');
  assert.equal(chosen({ units: list, laya: target('unordered_items', .49), minConfidence: .4 }), 'link by laya');
  assert.equal(chosen({ units: list, laya: target('digits', .95) }), 'escalate', 'says digits but there are none');
  assert.equal(chosen({ units: ['milk'], laya: target('ordered_items', .95) }), 'escalate', 'says list but there is one item');
  assert.equal(chosen({ units: list, laya: null }), 'escalate', 'decision model unavailable');
  assert.match(select({ units: list, mode: 'exact', laya: target('unordered_items', .3) }).escalate, /only 30% confidence/);
});

test('the learner\'s own choice is honoured, or refused with the reason', () => {
  assert.equal(chosen({ units: ['milk', 'eggs', 'bread'], choice: 'loci', laya: target('digits', .99) }), 'loci by learner');
  assert.throws(() => select({ units: ['milk', 'eggs'], mode: 'exact', choice: 'major' }), /Major system encodes digits, and this material has none\. Choose another technique, or let Recall choose\./);
  assert.throws(() => select({ units: ['milk'], mode: 'exact', choice: 'link' }), /single item/);
  assert.throws(() => select({ units: ['milk'], mode: 'exact', choice: 'telepathy' }), /Unknown technique/);
  assert.equal(workable('major', facts(['8472'])), null);
});

test('the contract states the technique, its required evidence and the image rules', () => {
  const c = contract({ technique: 'link' }, ['milk', 'eggs', 'bread'], 'exact');
  assert.deepEqual([c.primary_technique, c.name, c.goal], ['link', 'Link system', 'exact_wording']);
  assert.deepEqual(c.required_links, [['milk', 'eggs'], ['eggs', 'bread']]);
  assert.match(c.evidence_required, /links_to/);
  assert.deepEqual(c.visual_rules, { text_in_image: false, numerals_in_image: false, style: 'white-background-ink', brands: false, real_person_imagery: false });
  assert.equal(contract({ technique: 'visual' }, ['x'], 'meaning').evidence_required, 'none');
  assert.equal(Object.values(QUESTIONS).filter(q => q.type === 'noul').length, 5);
  assert.equal(decisionState(['milk', 'eggs'], 'exact'), 'Goal: recall the exact wording.\nItems: 2\nMaterial:\nmilk\neggs');
});

test('the Major-system decoder accepts correct encodings and rejects extra or wrong sounds', () => {
  for (const [words, digits] of [[['fire', 'can'], '8472'], [['my', 'turtle'], '31415'], [['tea', 'sea', 'she', 'she'], '1066'], [['giant'], '621'], [['goat'], '71'], [['knight'], '21'], [['lamb'], '53'], [['nation'], '262'], [['taxi'], '170'], [['butter'], '914'], [['phone'], '82']])
    assert.equal(majorMatches(words, digits), true, words.join(' ') + ' = ' + digits);
  for (const [words, digits] of [[['octopus'], '8472'], [['tooth', 'sausage', 'sheep', 'sheep'], '1066'], [['dynamite', 'ladder'], '1215'], [['fire'], '8472'], [['fire', 'can', 'dog'], '8472']])
    assert.equal(majorMatches(words, digits), false, words.join(' ') + ' is not ' + digits);
  assert.deepEqual(majorReadings('church'), ['646', '647', '746', '747']);
});

const scene = (source, cue, evidence, prompt = 'an ink drawing') => ({ source, cue, prompt, evidence });
const issues = (id, units, scenes) => contractIssues(contract({ technique: id }, units, 'exact'), scenes);

test('each technique\'s evidence is checked against the cue and the source', () => {
  assert.deepEqual(issues('link', ['milk', 'eggs'], [scene('milk', 'milk pours onto eggs', { links_to: 'eggs' }), scene('eggs', 'eggs alone', { links_to: null })]), []);
  assert.deepEqual(issues('link', ['milk', 'eggs'], [scene('milk', 'a carton of milk', { links_to: 'bread' }), scene('eggs', 'eggs', {})]),
    ['Scene 1: evidence.links_to must be the next source unit, "eggs".', 'Scene 1: the cue does not show "milk" interacting with the next item, "eggs".']);

  assert.deepEqual(issues('loci', ['a', 'b'], [scene('a', 'at the front door, a', { location: 'front door' }), scene('b', 'on the sofa, b', { location: 'sofa' })]), []);
  assert.deepEqual(issues('loci', ['a', 'b'], [scene('a', 'at the front door, a', { location: 'front door' }), scene('b', 'b floats by the front door', { location: 'Front Door' })]),
    ['Scene 2: location "Front Door" is already used by scene 1; every cue needs its own place on the route.']);

  assert.deepEqual(issues('peg', ['1 speech', '2 arms'], [scene('1 speech', 'a bun speaks', { peg: 'bun' }), scene('2 arms', 'arms flex', { peg: 'shoe' })]), ['Scene 2: the cue does not name its peg, "shoe".']);

  assert.deepEqual(issues('major', ['8472'], [scene('8472', 'a far ken', { words: ['far', 'ken'] })]), []);
  assert.match(issues('major', ['8472'], [scene('8472', 'an octopus juggles', { words: ['octopus'] })])[0], /^Scene 1: the words "octopus" do not decode to 8472 \(their consonant sounds read as 7190\); use only words whose consonant sounds spell 8-4-7-2\.$/);
  assert.match(issues('major', ['8472'], [scene('8472', 'a blazing tin', { words: ['fire', 'can'] })])[0], /"fire" does not appear in the cue/);

  assert.deepEqual(issues('shape', ['27'], [scene('27', 'a swan beside a cliff', { pegs: [{ digit: '2', object: 'swan' }, { digit: '7', object: 'cliff' }] })]), []);
  assert.match(issues('shape', ['27'], [scene('27', 'a swan', { pegs: [{ digit: '2', object: 'swan' }] })])[0], /one \{digit, object\} for each digit of 27/);

  assert.deepEqual(issues('keyword', ['pato means duck'], [scene('pato means duck', 'a duck wearing a pot', { keyword: 'pot' })]), []);
  assert.match(issues('keyword', ['pato means duck'], [scene('pato means duck', 'a duck quacks', { keyword: 'duck' })])[0], /a word from the source itself/);

  assert.deepEqual(issues('chunk', ['415 555 0132'], [scene('415 555 0132', 'three boxes', { chunks: ['415', '555', '0132'] })]), []);
  assert.match(issues('chunk', ['415 555 0132'], [scene('415 555 0132', 'boxes', { chunks: ['415', '555', '0123'] })])[0], /do not join back into the source unit/);

  assert.match(issues('pao', ['123456'], [scene('123456', 'a pilot juggling', { person: 'pilot', action: 'juggling' })])[0], /evidence\.object is missing/);
  assert.deepEqual(issues('visual', ['x'], [scene('x', 'anything', undefined)]), [], 'techniques without evidence only face the image rules');
});

test('image prompts that ask for numerals, words or logos are rejected', () => {
  assert.deepEqual(promptIssues([{ prompt: 'a duck wearing a cooking pot' }, { prompt: 'three ducks and no words' }]), []);
  assert.match(promptIssues([{ prompt: 'a clock showing 3:16' }])[0], /Scene 1: the image prompt contains numerals/);
  assert.match(promptIssues([{ prompt: 'a jar labeled honey' }])[0], /asks for visible text or a logo \("labeled"\)/);
  assert.match(promptIssues([{ prompt: 'a sign that says welcome' }])[0], /"sign that says"/);
  assert.match(promptIssues([{ prompt: 'a can with a famous logo' }])[0], /"logo"/);
  assert.equal(issues('visual', ['x'], [scene('x', 'cue', undefined, 'a banner reading sale and the number 5')]).length, 2);
});
