// Technique selection. Code decides everything it can determine exactly (digits, counts, labels, the learner's own
// choice); the decision model (Laya) answers typed questions about the rest; and the result is a contract the
// orchestrator enforces. See docs/EVALUATION.md for how the decision model measured on labelled memory tasks.
import { techniques } from './memory.mjs';

const technique = id => techniques.find(t => t[0] === id);
const digitsOf = s => (s.match(/\d/g) || []).join('');

// Facts about the source that code can state with certainty.
export function facts(units) {
  const digitCounts = units.map(u => digitsOf(u).length);
  const every = re => units.length > 0 && units.every(u => re.test(u));
  return {
    unitCount: units.length,
    maxDigits: Math.max(0, ...digitCounts),
    totalDigits: digitCounts.reduce((a, b) => a + b, 0),
    // Nothing but digits and separators: a PIN, phone number, card number, decimal.
    digitsOnly: every(/^[\d\s.,:\/()+#-]+$/) && digitCounts.every(n => n > 0),
    // "1 speech, 2 arms, 3 quartering": items carrying their own position, counting up from 1.
    numbered: units.length > 1 && units.every((u, i) => new RegExp('^' + (i + 1) + '[.)]?\\s+\\p{L}', 'u').test(u)),
    // "1066 Battle of Hastings": a year or number followed by what it refers to.
    dated: every(/^\d{3,4}[.,:]?\s+\p{L}/u),
    // "pato means duck", "Hund = dog": a word paired with its meaning.
    translations: every(/\S\s+(?:means|=)\s+\S/i),
    // "Dr. Okafor": a title followed by a capitalised name.
    titledNames: every(/^(?:mr|mrs|ms|miss|dr|prof)\.?\s+\p{Lu}/iu),
    averageWords: units.length ? units.reduce((n, u) => n + u.trim().split(/\s+/).length, 0) / units.length : 0,
  };
}

// The typed questions put to the decision model, in one request. `target` is the one selection relies on;
// the yes/no questions are recorded as supporting evidence and shown to the learner.
export const QUESTIONS = {
  target: {
    type: 'choice', instructions: 'What does the learner mainly need to recall from this material?',
    criteria: {
      exact_wording: 'the exact words of a sentence, verse or quotation',
      meaning: 'the meaning of a fact, definition or idea',
      ordered_items: 'a list of items or steps in a fixed order',
      unordered_items: 'a list of everyday items in any order',
      digits: 'a number, code, date or PIN made of digits',
      name_face: 'the name of a person',
      vocabulary: 'a foreign or unfamiliar word and what it means',
    },
  },
  is_list: { type: 'noul', instructions: 'Is this a list of separate items?' },
  is_vocabulary: { type: 'noul', instructions: 'Does this give a foreign or unfamiliar word together with its meaning?' },
  is_name: { type: 'noul', instructions: "Is a person's name the main thing to remember?" },
  is_recitation: { type: 'noul', instructions: 'Is this a sentence, verse or quotation to recite word for word?' },
  is_concept: { type: 'noul', instructions: 'Is this a definition, fact or explanation of an idea?' },
};

// The state given to the decision model: the learner's goal and the material, as plain labelled text.
export const decisionState = (units, mode) =>
  ('Goal: recall the ' + (mode === 'meaning' ? 'meaning' : 'exact wording') + '.\nItems: ' + units.length + '\nMaterial:\n' + units.join('\n')).slice(0, 4000);

// Which techniques can represent this material at all. Used to honour or refuse the learner's own choice.
export function workable(id, f) {
  if (['major', 'shape', 'pao'].includes(id) && f.totalDigits === 0) return technique(id)[1] + ' encodes digits, and this material has none.';
  if (id === 'chunk' && f.maxDigits < 5 && f.averageWords < 4) return 'Chunking splits a long number, code or passage into groups, and this material is already short.';
  if (id === 'peg' && f.unitCount < 2) return 'The peg system attaches several items to numbered pegs, and this is a single item.';
  if (id === 'link' && f.unitCount < 2) return 'The link system connects consecutive items, and this is a single item.';
  return null;
}

const pick = (id, by, why, extra = {}) => ({ technique: id, selectedBy: by, reason: why, ...extra });
const forItems = f => f.unitCount <= 5 ? 'link' : 'loci';
const forDigits = f => f.maxDigits <= 2 ? 'shape' : f.maxDigits <= 8 ? 'major' : 'chunk';

// How much authority the decision model has, per kind of decision. `enforced`: its answer decides, within the code
// facts. `advisory`: its answer is recorded and shown, and something else decides. A category is enforced only once
// `npm run eval` supports it for the checkpoint in use (docs/EVALUATION.md), so a better-trained checkpoint is
// promoted by changing configuration, not code.
export const POLICY_VERSION = '1', QUESTION_VERSION = '1';
const modeOf = (name, fallback) => ['enforced', 'advisory'].includes(process.env[name]) ? process.env[name] : fallback;
export const modes = () => ({ technique: modeOf('LAYA_TECHNIQUE_MODE', 'enforced'), cue_check: modeOf('LAYA_CUE_MODE', 'advisory'), repair: modeOf('LAYA_REPAIR_MODE', 'advisory') });

// The cue check's question: which of these items does a finished cue lead back to?
export const cueQuestion = units => ({ points_to: { type: 'choice', instructions: 'Which item does this memory cue most strongly represent?', criteria: Object.fromEntries(units.map((u, i) => ['unit_' + (i + 1), u.slice(0, 60)])) } });

// Practice adaptation: why does this cue keep failing? Asked from the learner's recorded attempts and wrong answers.
export const REPAIR_QUESTION = { cause: { type: 'choice', instructions: 'Why does this memory cue keep failing the learner?', criteria: {
  cue_ambiguity: 'the cue could stand for several different things',
  weak_link: 'the cue does not lead on to the next item',
  unfamiliar_encoding: 'the learner does not know the code the cue relies on',
  overloaded_scene: 'the cue holds too many things at once',
  insufficient_evidence: 'there is too little to tell',
} } };
export const repairState = scene => ('Source: ' + scene.source + '\nCue: ' + scene.cue + '\nAttempts: ' + (scene.stats?.attempts || 0) + ', recalled: ' + (scene.stats?.recalled || 0) + ', without hints: ' + (scene.stats?.unaided || 0) + '\nThe learner answered: ' + ((scene.stats?.answers || []).join(' | ') || 'nothing')).slice(0, 2000);

// Systems a learner has to know before a cue built on them can be read back: technique id -> key in the learner's profile.
export const SYSTEMS = { major: 'major', peg: 'pegs', pao: 'pao' };

// Returns {technique, selectedBy, reason} or {escalate: reason} when neither code nor the decision model can settle it.
// `laya` is the decision model's answers ({target:{choice, answer_confidence}, ...}) or null when it is unavailable.
// `authority` is 'enforced' or 'advisory' for technique selection.
export function select({ units, mode, choice, laya, minConfidence = .5, authority = 'enforced' }) {
  const f = facts(units);
  if (choice) {
    if (!technique(choice)) throw Error('Unknown technique.');
    const problem = workable(choice, f);
    if (problem) throw Error(problem + ' Choose another technique, or let Recall choose.');
    return pick(choice, 'learner', 'You chose this technique.');
  }
  // 1. Facts code can state exactly.
  if (f.digitsOnly) return pick(forDigits(f), 'code', f.maxDigits <= 2 ? 'The material is one or two digits.' : f.maxDigits <= 8 ? 'The material is a number of ' + f.maxDigits + ' digits or fewer per item.' : 'The material is a long number of ' + f.maxDigits + ' digits, best split into groups.');
  if (f.numbered) return pick('peg', 'code', 'Each item carries its own position number, counting up from 1.');
  if (f.dated) return pick('major', 'code', 'Each item starts with a year or number that must be recalled exactly.');
  if (f.translations) return pick('keyword', 'code', 'Each item pairs a word with its meaning.');
  if (f.titledNames) return pick('keyword', 'code', 'Each item is a person’s name with a title.');

  // 2. The decision model, when it is confident and does not contradict the facts.
  const t = laya?.target;
  if (!t) return { escalate: 'The decision model is not available.' };
  const percent = Math.round(t.answer_confidence * 100);
  if (authority !== 'enforced') return { escalate: 'The decision model is advisory for technique selection; it answered "' + t.choice + '" (' + percent + '%).' };
  if (t.answer_confidence < minConfidence) return { escalate: 'The decision model answered "' + t.choice + '" at only ' + percent + '% confidence.' };
  if (t.choice === 'digits' && f.totalDigits === 0) return { escalate: 'The decision model answered "digits" but the material contains none.' };
  if (['ordered_items', 'unordered_items'].includes(t.choice) && f.unitCount < 2) return { escalate: 'The decision model answered "' + t.choice + '" but there is only one item.' };
  const by = { selectedBy: 'laya', confidence: t.answer_confidence };
  const said = 'The decision model read this as ';
  switch (t.choice) {
    case 'digits': return { ...pick(forDigits(f), 'laya', said + 'a number to recall exactly (' + percent + '%).'), ...by };
    case 'vocabulary': return { ...pick('keyword', 'laya', said + 'an unfamiliar word and its meaning (' + percent + '%).'), ...by };
    case 'name_face': return { ...pick('keyword', 'laya', said + 'a person’s name (' + percent + '%).'), ...by };
    case 'ordered_items': case 'unordered_items': return { ...pick(forItems(f), 'laya', said + 'a list of ' + f.unitCount + ' items (' + percent + '%); ' + (f.unitCount <= 5 ? 'short enough to chain together.' : 'long enough to need a route.')), ...by };
    case 'exact_wording': return { ...pick(mode === 'meaning' ? 'visual' : 'story', 'laya', said + 'wording to recite (' + percent + '%).'), ...by };
    case 'meaning': return { ...pick(mode === 'exact' && f.averageWords > 6 ? 'story' : 'visual', 'laya', said + 'an idea to understand (' + percent + '%).'), ...by };
    default: return { escalate: 'The decision model gave an answer outside the question’s options.' };
  }
}

// The contract the storyboard must satisfy. The orchestrator checks every scene against it.
// `extra` carries what only some kits have: `route` (the learner's saved palace, one place per scene), `face_feature`
// (what the learner will see on the photographed face) and `note` (what a reference scene is for).
export function contract(selection, units, mode, extra = {}) {
  const t = technique(selection.technique);
  return {
    schema_version: '1', primary_technique: t[0], name: t[1], method: t[2],
    goal: mode === 'meaning' ? 'meaning' : 'exact_wording',
    source_units: units,
    ...(t[0] === 'link' ? { required_links: units.slice(0, -1).map((u, i) => [u, units[i + 1]]) } : {}),
    ...extra,
    evidence_required: extra.route ? 'evidence.location: exactly the contract.route place for this scene (scene 1 uses the first place, scene 2 the second, and so on), named in the cue. Do not invent places.'
      : (EVIDENCE[t[0]] || 'none') + (extra.face_feature ? ' The cue must also attach the keyword to contract.face_feature, the feature the learner will see on the face, and must name that feature.' : ''),
    visual_rules: { text_in_image: false, numerals_in_image: false, style: 'white-background-ink', brands: false, real_person_imagery: false },
  };
}

// What each scene must supply, per technique, so the method can be checked rather than taken on trust.
export const EVIDENCE = {
  link: 'evidence.links_to: the exact next source unit this scene connects to (null for the last scene). The cue must show this unit interacting with the next one.',
  loci: 'evidence.location: the place on the route where this cue sits. Every scene needs a different location, named in the cue, in route order.',
  peg: 'evidence.peg: the peg object for this position (for example 1 = bun, 2 = shoe). Every scene needs a different peg, named in the cue.',
  major: 'evidence.words: the words in the cue that encode the digits, in order. Using 0 s/z, 1 t/d, 2 n, 3 m, 4 r, 5 l, 6 sh/ch/j, 7 k/g, 8 f/v, 9 p/b, their consonant sounds must spell exactly the digits of the source unit, with no extra consonant sounds.',
  shape: 'evidence.pegs: one {digit, object} for every digit of the source unit, in order, where the object is shaped like or rhymes with the digit. Each object must appear in the cue.',
  pao: 'evidence.person, evidence.action and evidence.object: the three parts of the compound cue, each named in the cue.',
  keyword: 'evidence.keyword: the familiar sound-alike word the cue is built on. It must appear in the cue and must not be the source word itself.',
  chunk: 'evidence.chunks: the source unit split into groups, in order. Joined together they must give back the source unit exactly.',
};
