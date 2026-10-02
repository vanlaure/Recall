// Deterministic enforcement of the technique contract. A storyboard that fails any check here is sent back for
// repair, whatever the generating or reviewing model says about it.

const fold = s => String(s ?? '').toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '');
const digitsOf = s => (String(s).match(/\d/g) || []).join('');
const filled = v => typeof v === 'string' && v.trim().length > 0;

// True when the cue names the phrase: any of its words of three letters or more appears (allowing a plural or tense ending).
function mentions(cue, phrase) {
  const c = fold(cue), words = fold(phrase).split(/[^\p{L}\p{N}]+/u).filter(w => w.length >= 3);
  if (!words.length) return fold(phrase).trim() !== '' && c.includes(fold(phrase).trim());
  return words.some(w => c.includes(w.length > 4 ? w.slice(0, -1) : w));
}

// --- Major system -------------------------------------------------------------------------------------------------
// Spelling does not fix pronunciation, so each letter group yields every digit reading it could plausibly have
// ("g" is 7 in "goat" and 6 in "giant"). A word passes when one of its readings matches; a word with an extra
// consonant sound has no matching reading and fails.
const VOWEL = /[aeiouhwy]/;
const SINGLE = { s: '0', z: '0', t: '1', d: '1', n: '2', m: '3', r: '4', l: '5', j: '6', k: '7', q: '7', f: '8', v: '8', p: '9', b: '9' };
function nextSound(w, i) {
  const rest = w.slice(i), at = (...opts) => opts;
  if (rest.startsWith('tion') || rest.startsWith('sion')) return [4, at('62')];
  if (rest.startsWith('tch')) return [3, at('6')];
  if (rest.startsWith('sch')) return [3, at('07', '6')];
  if (rest.startsWith('dg')) return [2, at('6')];
  if (rest.startsWith('sh')) return [2, at('6')];
  if (rest.startsWith('ch')) return [2, at('6', '7')];
  if (rest.startsWith('ph')) return [2, at('8')];
  if (rest.startsWith('th')) return [2, at('1')];
  if (rest.startsWith('ck')) return [2, at('7')];
  if (rest.startsWith('gh')) return [2, at('', '8', '7')];
  if (rest.startsWith('ng')) return [2, at('27', '2', '7')];
  if (rest.startsWith('qu')) return [2, at('7')];
  if (i === 0 && rest.startsWith('kn')) return [2, at('2')];
  if (i === 0 && rest.startsWith('wr')) return [2, at('4')];
  if (rest === 'mb') return [2, at('3', '39')];
  const ch = rest[0], next = rest[1] || '';
  if (VOWEL.test(ch)) return [1, at('')];
  if (ch === 'x') return [1, at('70')];
  if (ch === 'c') return next === 'c' ? [2, at('7', '70')] : [1, /[eiy]/.test(next) ? at('0') : at('7')];
  if (ch === 'g') return next === 'g' ? [2, at('7')] : [1, /[eiy]/.test(next) ? at('6', '7') : at('7')];
  if (SINGLE[ch]) return [next === ch ? 2 : 1, at(SINGLE[ch])];   // a doubled letter is one sound
  return [1, at('')];
}
// Every digit string the word could encode (capped so an unusual word cannot explode the search).
export function majorReadings(word) {
  const w = fold(word).replace(/[^a-z]/g, '');
  let readings = [''];
  for (let i = 0; i < w.length;) {
    const [len, options] = nextSound(w, i);
    readings = [...new Set(readings.flatMap(r => options.map(o => r + o)))].slice(0, 128);
    i += len;
  }
  return readings;
}
// Can the words, in order, be read as exactly these digits?
export function majorMatches(words, digits) {
  let reach = new Set([0]);
  for (const word of words) {
    const next = new Set();
    for (const pos of reach) for (const r of majorReadings(word)) if (digits.startsWith(r, pos)) next.add(pos + r.length);
    reach = next;
    if (!reach.size) return false;
  }
  return reach.has(digits.length);
}

// --- Technique checks ---------------------------------------------------------------------------------------------
const CHECKS = {
  link(scenes, units, issue) {
    scenes.forEach((s, i) => {
      if (i === scenes.length - 1) return;
      if (s.evidence?.links_to !== units[i + 1]) issue(i, 'evidence.links_to must be the next source unit, "' + units[i + 1] + '"');
      if (!mentions(s.cue, units[i + 1])) issue(i, 'the cue does not show "' + units[i] + '" interacting with the next item, "' + units[i + 1] + '"');
    });
  },
  loci(scenes, units, issue, contract) {
    const seen = new Map();
    scenes.forEach((s, i) => {
      const place = s.evidence?.location;
      if (!filled(place)) return issue(i, 'evidence.location is missing');
      if (contract.route && fold(place).trim() !== fold(contract.route[i]).trim()) issue(i, 'evidence.location must be the learner\'s own place for this scene, "' + contract.route[i] + '"');
      if (seen.has(fold(place).trim())) issue(i, 'location "' + place + '" is already used by scene ' + (seen.get(fold(place).trim()) + 1) + '; every cue needs its own place on the route');
      seen.set(fold(place).trim(), i);
      if (!mentions(s.cue, place)) issue(i, 'the cue does not name its location, "' + place + '"');
    });
  },
  peg(scenes, units, issue) {
    const seen = new Map();
    scenes.forEach((s, i) => {
      const peg = s.evidence?.peg;
      if (!filled(peg)) return issue(i, 'evidence.peg is missing');
      if (seen.has(fold(peg).trim())) issue(i, 'peg "' + peg + '" is already used by scene ' + (seen.get(fold(peg).trim()) + 1));
      seen.set(fold(peg).trim(), i);
      if (!mentions(s.cue, peg)) issue(i, 'the cue does not name its peg, "' + peg + '"');
    });
  },
  major(scenes, units, issue) {
    scenes.forEach((s, i) => {
      const digits = digitsOf(units[i]), words = s.evidence?.words;
      if (!digits) return issue(i, 'the source unit has no digits for the Major system to encode');
      if (!Array.isArray(words) || !words.length || !words.every(filled)) return issue(i, 'evidence.words is missing');
      for (const w of words) if (!fold(s.cue).includes(fold(w))) issue(i, 'the encoding word "' + w + '" does not appear in the cue');
      if (!majorMatches(words, digits)) issue(i, 'the words ' + words.map(w => '"' + w + '"').join(' + ') + ' do not decode to ' + digits + ' (their consonant sounds read as ' + words.map(w => majorReadings(w)[0] || 'nothing').join(' ') + '); use only words whose consonant sounds spell ' + digits.split('').join('-'));
      // A picture needs something besides the encoding words: at least two other words of three letters or more.
      const used = new Set(words.map(w => fold(w).trim()));
      if (fold(s.cue).split(/[^\p{L}\p{N}]+/u).filter(w => w.length >= 3 && !used.has(w)).length < 2) issue(i, 'the cue is little more than the encoding words; describe one picture in which those words appear as things or actions');
    });
  },
  shape(scenes, units, issue) {
    scenes.forEach((s, i) => {
      const digits = digitsOf(units[i]), pegs = s.evidence?.pegs;
      if (!digits) return issue(i, 'the source unit has no digits to turn into shapes');
      if (!Array.isArray(pegs) || pegs.map(p => String(p?.digit ?? '')).join('') !== digits) return issue(i, 'evidence.pegs must list one {digit, object} for each digit of ' + digits + ', in order');
      for (const p of pegs) if (!filled(p.object) || !mentions(s.cue, p.object)) issue(i, 'the object for digit ' + p.digit + ' is missing from the cue');
    });
  },
  pao(scenes, units, issue) {
    scenes.forEach((s, i) => {
      for (const part of ['person', 'action', 'object']) {
        if (!filled(s.evidence?.[part])) issue(i, 'evidence.' + part + ' is missing');
        else if (!mentions(s.cue, s.evidence[part])) issue(i, 'the ' + part + ' "' + s.evidence[part] + '" does not appear in the cue');
      }
    });
  },
  keyword(scenes, units, issue, contract) {
    scenes.forEach((s, i) => {
      const keyword = s.evidence?.keyword;
      if (contract.face_feature && !mentions(s.cue, contract.face_feature)) issue(i, 'the cue does not attach the name to the feature seen on the face, "' + contract.face_feature + '"');
      if (!filled(keyword)) return issue(i, 'evidence.keyword is missing');
      if (!fold(s.cue).includes(fold(keyword).trim())) issue(i, 'the keyword "' + keyword + '" does not appear in the cue');
      if (fold(units[i]).split(/[^\p{L}\p{N}]+/u).includes(fold(keyword).trim())) issue(i, 'the keyword "' + keyword + '" is a word from the source itself, not a sound-alike bridge');
    });
  },
  chunk(scenes, units, issue) {
    const plain = s => fold(s).replace(/[^\p{L}\p{N}]/gu, '');
    scenes.forEach((s, i) => {
      const chunks = s.evidence?.chunks;
      if (!Array.isArray(chunks) || !chunks.length || !chunks.every(filled)) return issue(i, 'evidence.chunks is missing');
      if (plain(chunks.join('')) !== plain(units[i])) issue(i, 'the chunks ' + JSON.stringify(chunks) + ' do not join back into the source unit "' + units[i] + '"');
      if (chunks.length < 2 && plain(units[i]).length > 4) issue(i, 'the source unit was not split into groups');
    });
  },
};

// Image prompts must not ask the image model for anything the visual rules forbid.
const TEXT_REQUEST = /\b(?:label(?:l?ed)?|caption(?:ed)?|sign (?:that )?(?:says|reads|reading)|banner (?:that )?(?:says|reads|reading)|text (?:that )?(?:says|reads|reading)|the words?\s+["“'‘]|written on|inscribed|engraved with|logo|watermark|speech bubble|subtitle)\b/i;
export function promptIssues(scenes) {
  const issues = [];
  scenes.forEach((s, i) => {
    if (!s.objects?.length) issues.push('Scene ' + (i + 1) + ': objects is missing; list the one to five things the image must show, so the finished image can be checked.');
    if (/\d/.test(s.prompt)) issues.push('Scene ' + (i + 1) + ': the image prompt contains numerals; describe objects instead, because the image must show no numbers.');
    const m = TEXT_REQUEST.exec(s.prompt);
    if (m) issues.push('Scene ' + (i + 1) + ': the image prompt asks for visible text or a logo ("' + m[0] + '"); the image must contain no words, labels or logos.');
  });
  return issues;
}

// What kind of repair each check calls for, so a failure says more than "try again".
const REPAIR = { link: 'strengthen_link', loci: 'reassign_location', peg: 'name_peg', major: 'fix_encoding', shape: 'fix_encoding', pao: 'add_evidence', keyword: 'change_keyword', chunk: 'fix_chunks' };

// Every contract violation as a record: which check failed, on which scene and source unit, what was expected, what
// was observed and the kind of repair it needs. `message` is the same violation as one sentence.
export function contractFindings(contract, scenes) {
  const record = (check, repair, expected) => message => {
    const scene = Number(/^Scene (\d+):/.exec(message)[1]);
    return { check, scene, source: contract.source_units[scene - 1], expected, observed: message.replace(/^Scene \d+: /, ''), repair, message };
  };
  const technique = [], check = CHECKS[contract.primary_technique];
  if (check) check(scenes, contract.source_units, (i, text) => technique.push('Scene ' + (i + 1) + ': ' + text + '.'), contract);
  const named = [];
  if (contract.must_name) scenes.forEach((s, i) => { if (!mentions(s.cue, contract.must_name)) named.push('Scene ' + (i + 1) + ': the cue does not name "' + contract.must_name + '", so the learner cannot tell where the numbers belong.'); });
  return [
    ...technique.map(record('technique.' + contract.primary_technique, REPAIR[contract.primary_technique], contract.evidence_required)),
    ...named.map(record('reference.name', 'name_source', 'The cue names "' + contract.must_name + '".')),
    ...promptIssues(scenes).map(record('image.prompt', 'rewrite_prompt', 'objects lists one to five things, and the prompt has no numerals and asks for no words, labels or logos.')),
  ];
}

// All contract violations in a storyboard, as specific repair instructions. An empty list means it complies.
export const contractIssues = (contract, scenes) => contractFindings(contract, scenes).map(f => f.message);
