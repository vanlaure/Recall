// [id, name, method given to the storyboard agent, kind of material it suits (Laya's choice criteria)]
export const techniques = [
  ['link', 'Link system', 'Connect consecutive items through interacting images.', 'a short list of everyday things or groceries'],
  ['loci', 'Method of loci', 'Place cues along a familiar ordered route.', 'a long list of places, errands or the points of a talk'],
  ['peg', 'Peg system', 'Attach new items to a stable ordered set of cues.', 'items that each start with a number label'],
  ['keyword', 'Keyword / sound association', 'Link an unfamiliar word to a familiar similar-sounding cue.', 'foreign vocabulary, names of people or unfamiliar terms'],
  ['chunk', 'Chunking', 'Group material into meaningful smaller units.', 'a phone number or long code'],
  ['story', 'Narrative chaining', 'Arrange cues into a coherent story.', 'a sentence, verse, quotation or sequence of events'],
  ['major', 'Major system', 'Encode digits as consonant sounds: 0 s/z, 1 t/d, 2 n, 3 m, 4 r, 5 l, 6 sh/ch/j, 7 k/g, 8 f/v, 9 p/b.', 'a number, year, date or PIN made of digits'],
  ['shape', 'Number-shape / rhyme', 'Use shapes or rhymes as numeric pegs.', 'one or two single digits'],
  ['pao', 'Person-action-object', 'Combine familiar people, actions and objects into compound cues.', 'a very long run of digits such as a card number'],
  ['visual', 'Visual association', 'Represent ideas through concrete images and interaction.', 'a definition, fact or abstract idea'],
];

// A full stop after one of these does not end a sentence.
const ABBREVIATION = /(?:^|[\s(])(?:mr|mrs|ms|dr|prof|sr|jr|st|vs|etc|no|a\.m|p\.m|e\.g|i\.e)$/i;
const INITIAL = /(?:^|[\s(])[A-HJ-Z]$/;

// Splits on sentence punctuation that is followed by a space or the end, so "3.14", "9.30" and "$4.50" stay whole.
function sentences(line) {
  const out = [];
  let start = 0;
  for (const m of line.matchAll(/[.!?]+(?=\s|$)/g)) {
    const end = m.index + m[0].length, before = line.slice(start, m.index);
    if (m[0] === '.' && end < line.length && (ABBREVIATION.test(before) || INITIAL.test(before))) continue;
    out.push(line.slice(start, end));
    start = end;
  }
  if (start < line.length) out.push(line.slice(start));
  return out;
}

// Lines and semicolons always separate items. Commas do too, unless a piece is long enough to be prose
// ("For God so loved the world, that he gave...") or the comma sits inside a number ("1,000").
function listItems(text) {
  return text.split(/\n|;/).flatMap(line => {
    const parts = line.split(/,(?=\s)|(?<!\d),|,(?!\d)/);
    return parts.every(p => p.trim().split(/\s+/).length <= 5) ? parts : [line];
  });
}

export function splitSource(text, kind) {
  if (typeof text !== 'string' || !text.trim() || text.length > 12000) throw Error('Enter 1–12,000 characters.');
  const parts = kind === 'list' ? listItems(text) : text.split('\n').flatMap(sentences);
  const units = parts.map(x => x.trim()).filter(Boolean);
  if (units.length > 24) throw Error('Use at most 24 scenes per kit.');
  return units;
}

export function validateScenes(scenes, units) {
  if (!Array.isArray(scenes) || scenes.length !== units.length) throw Error('Storyboard must cover every source unit.');
  return scenes.map((s, i) => {
    if (s.source !== units[i]) throw Error('Source wording or order changed.');
    for (const k of ['cue', 'prompt']) if (typeof s[k] !== 'string' || !s[k].trim() || s[k].length > 4000) throw Error('Missing or oversized ' + k);
    // Technique evidence is kept (size-capped) so the contract checks can verify the method was applied.
    const evidence = s.evidence && typeof s.evidence === 'object' && JSON.stringify(s.evidence).length <= 2000 ? s.evidence : undefined;
    return { source: units[i], cue: s.cue, prompt: s.prompt, ...(evidence ? { evidence } : {}), image: null };
  });
}

// Words for comparison: case, accents, apostrophes and punctuation are ignored, and punctuation inside a number or abbreviation is dropped ("9:30" = "930", "a.m." = "am").
const words = s => s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/['’]/g, '')
  .replace(/(?<=\d)[^\p{L}\p{N}\s](?=\d)/gu, '').replace(/(?<=\p{L})\.(?=\p{L})/gu, '').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);

// Exact recall of a passage: 1 minus the word edit distance, so omissions, additions and reordering all cost.
export function grade(expected, answer) {
  const a = words(expected), b = words(answer);
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return Math.max(0, 1 - dp[a.length][b.length] / Math.max(a.length, b.length, 1));
}

// Recall of a list: the share of items that appear in the answer. Order is reported, not penalised.
export function gradeList(units, answer) {
  const said = words(answer), positions = [], missed = [];
  for (const unit of units) {
    const u = words(unit);
    if (!u.length) continue;
    let at = -1;
    for (let i = 0; i + u.length <= said.length && at < 0; i++) if (u.every((w, k) => said[i + k] === w)) at = i;
    if (at < 0) missed.push(unit); else positions.push(at);
  }
  const total = positions.length + missed.length;
  return { score: total ? positions.length / total : 0, missed, inOrder: positions.every((p, i) => i === 0 || p > positions[i - 1]) };
}

export function nextReview(score, streak, now = Date.now()) {
  const days = score < .8 ? 0 : Math.min(30, 2 ** Math.min(streak, 5));
  return new Date(now + (days ? days * 86400000 : 600000)).toISOString();
}
