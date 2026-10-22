// Splitting mixed material into parts. A kit normally has one technique, but material can mix kinds: groceries and a
// locker code, a numbered run of steps and a verse. Code reads what kind each item is from its shape alone, groups
// neighbouring items of the same kind into runs, and returns the runs when there is more than one. Which technique
// each run gets is decided afterwards, by the same code facts, decision model and Memory Expert as for any kit.
// Items stay in the order the learner gave them, so a run is always a stretch of the original list.

export const MAX_PARTS = 4;

const words = u => u.trim().split(/\s+/).length;
const SENTENCE = /[.!?]["”')\]]*\s*$/;

// What an item is, judged only from its shape. 'item' and 'prose' are both plain text that the decision model reads;
// they are told apart so a list of short things followed by a sentence to recite is not given one method.
// 'mid' is in between and joins whichever run it sits next to.
export function kindOf(unit) {
  const u = unit.trim();
  if (/^[\d\s.,:\/()+#-]+$/.test(u) && /\d/.test(u)) return 'digits';
  if (/^\d{3,4}[.,:]?\s+\p{L}/u.test(u)) return 'dated';
  if (/^\d{1,2}[.)]?\s+\p{L}/u.test(u)) return 'numbered';
  if (/\S\s+(?:means|=)\s+\S/i.test(u)) return 'vocabulary';
  if (/^(?:mr|mrs|ms|miss|dr|prof)\.?\s+\p{Lu}/iu.test(u)) return 'name';
  const n = words(u);
  if (n >= 8 || (n >= 6 && SENTENCE.test(u))) return 'prose';
  if (n <= 4 && !SENTENCE.test(u)) return 'item';
  return 'mid';
}

// Runs of neighbouring items of one kind: [{kind, from, units}]. A 'mid' item joins the run before it, or the one
// after it when it comes first.
export function runs(units) {
  const kinds = units.map(kindOf), out = [];
  kinds.forEach((kind, i) => {
    const last = out.at(-1);
    if (kind === 'mid') { if (last) { last.units.push(units[i]); return; } kind = null; }
    if (last && last.kind === kind) last.units.push(units[i]);
    else if (kind !== null) out.push({ kind, from: i, units: [units[i]] });
    else out.push({ kind: 'mid', from: i, units: [units[i]] });
  });
  // A leading 'mid' item takes the kind of the run that follows it.
  if (out[0]?.kind === 'mid' && out[1]) { out[1].units.unshift(...out[0].units); out[1].from = out[0].from; out.shift(); }
  else if (out[0]?.kind === 'mid') out[0].kind = 'item';
  return out;
}

// The parts to build, or null when the material is one kind throughout (or too fragmented to be worth splitting),
// in which case the kit is built exactly as before.
export function splitIntoParts(units) {
  if (units.length < 2) return null;
  const found = runs(units);
  if (found.length < 2 || found.length > MAX_PARTS) return null;
  return found.map(r => ({ kind: r.kind, from: r.from, units: r.units }));
}
