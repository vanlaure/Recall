// Real, picturable words for the Major system, so the storyboard agent can be handed candidates whose consonant
// sounds spell the digits instead of coining words ("forkin" decodes to 8472 but nobody can picture it). The digit
// reading of every word is computed by the same decoder that checks storyboards, so the list can only ever offer
// words that the contract check will accept. Order within the list is preference order.
import { majorReadings } from './validate.mjs';

export const NOUNS = [
  // single digits
  'sea', 'zoo', 'tie', 'toe', 'knee', 'hen', 'ham', 'emu', 'ear', 'arrow', 'ray', 'eel', 'owl', 'hill', 'shoe', 'jaw', 'cow', 'key', 'hook', 'egg', 'ivy', 'hive', 'hoof', 'pie', 'bee', 'ape', 'hoop',
  // 0x
  'sauce', 'seed', 'suit', 'soda', 'sun', 'snow', 'sumo', 'zero', 'sail', 'seal', 'soil', 'sash', 'sock', 'sack', 'ski', 'safe', 'sofa', 'soap', 'zip', 'sub',
  // 1x
  'dice', 'toes', 'dad', 'tattoo', 'tin', 'tuna', 'den', 'dime', 'tomb', 'tire', 'door', 'deer', 'tail', 'doll', 'towel', 'dish', 'tack', 'dog', 'duck', 'dove', 'taffy', 'tub', 'tape',
  // 2x
  'nose', 'noose', 'net', 'nut', 'note', 'nun', 'onion', 'anime', 'winery', 'nail', 'nacho', 'hinge', 'neck', 'nag', 'wink', 'knife', 'nap', 'knob',
  // 3x
  'mouse', 'moss', 'maze', 'mat', 'meat', 'moth', 'moon', 'mane', 'mummy', 'memo', 'hammer', 'mail', 'mole', 'mill', 'match', 'mesh', 'mug', 'movie', 'muff', 'map', 'mop', 'mob',
  // 4x
  'rose', 'rice', 'horse', 'rat', 'rod', 'road', 'rain', 'horn', 'ram', 'arm', 'rum', 'warrior', 'aurora', 'rail', 'roll', 'reel', 'ridge', 'roach', 'rock', 'rake', 'rag', 'roof', 'reef', 'rope', 'robe', 'rib',
  // 5x
  'lace', 'lasso', 'lid', 'light', 'lion', 'lane', 'loon', 'lime', 'lamb', 'loom', 'lorry', 'lily', 'lolly', 'leash', 'lodge', 'lake', 'log', 'leg', 'lock', 'leaf', 'loaf', 'lip', 'lab',
  // 6x
  'cheese', 'juice', 'shoes', 'jet', 'sheet', 'chain', 'gin', 'jam', 'gem', 'gym', 'jar', 'chair', 'cherry', 'jail', 'shell', 'jelly', 'judge', 'geisha', 'shush', 'jug', 'shack', 'chick', 'chef', 'ship', 'sheep', 'jeep', 'chip',
  // 7x
  'case', 'goose', 'gas', 'cat', 'kite', 'goat', 'coat', 'can', 'coin', 'gun', 'cane', 'comb', 'gum', 'game', 'car', 'gear', 'crow', 'coal', 'goal', 'clay', 'glue', 'cage', 'coach', 'cash', 'cake', 'cook', 'cog', 'cave', 'cuff', 'cap', 'cup', 'cab', 'cob',
  // 8x
  'vase', 'face', 'fuse', 'fez', 'foot', 'food', 'photo', 'fan', 'phone', 'fin', 'foam', 'fire', 'fur', 'fairy', 'fly', 'veil', 'fuel', 'file', 'fish', 'fudge', 'fig', 'fog', 'fife', 'fava', 'fob',
  // 9x
  'bus', 'boss', 'base', 'piece', 'bat', 'boat', 'bed', 'pot', 'bone', 'pan', 'pen', 'bun', 'bin', 'bomb', 'poem', 'puma', 'bear', 'beer', 'pear', 'bar', 'bell', 'ball', 'pill', 'pool', 'bowl', 'badge', 'bush', 'peach', 'beach', 'bike', 'book', 'bag', 'pig', 'beef', 'puff', 'pipe', 'baby', 'pup', 'puppy',
];

let index;
// Every one-, two- and three-digit reading each noun has, in list order.
function readings() {
  if (index) return index;
  // A word whose most natural reading is the chunk comes before one that only reaches it through an ambiguous letter
  // ('can' before 'chain' for 72, since 'ch' is usually 6).
  const primary = new Map(), secondary = new Map();
  for (const word of NOUNS) { const all = majorReadings(word); new Set(all).forEach(r => { if (!r || r.length > 3) return; const bucket = r === all[0] ? primary : secondary; if (!bucket.has(r)) bucket.set(r, []); bucket.get(r).push(word); }); }
  index = new Map();
  for (const r of new Set([...primary.keys(), ...secondary.keys()])) index.set(r, [...new Set([...(primary.get(r) || []), ...(secondary.get(r) || [])])]);
  return index;
}
export const wordsFor = chunk => readings().get(chunk) || [];

// Ways to cut a digit string into chunks the list covers: pairs first, with any odd digit at the end or the start.
function segmentations(digits) {
  if (!digits) return [];
  const pairs = s => { const out = []; for (let i = 0; i < s.length; i += 2) out.push(s.slice(i, i + 2)); return out; };
  const even = digits.length % 2 === 0;
  const options = even ? [pairs(digits)] : [pairs(digits.slice(0, -1)).concat(digits.slice(-1)), [digits[0]].concat(pairs(digits.slice(1)))];
  if (digits.length === 1) return [[digits]];
  return options;
}

// Up to `max` word sets, each of real words whose sounds spell exactly these digits: [['fire','can'], ['fur','gun'], ...].
export function candidates(digits, max = 10) {
  const out = [], seen = new Set();
  for (const seg of segmentations(String(digits).replace(/\D/g, ''))) {
    const lists = seg.map(wordsFor);
    if (lists.some(l => !l.length)) continue;
    // Walk the combinations breadth-first so the first few mix the preferred word of each chunk.
    const depth = Math.max(...lists.map(l => l.length));
    for (let d = 0; d < depth && out.length < max; d++) {
      const walk = (i, acc) => {
        if (out.length >= max) return;
        if (i === lists.length) { const key = acc.join(' '); if (!seen.has(key)) { seen.add(key); out.push([...acc]); } return; }
        for (const w of lists[i].slice(0, d + 1)) walk(i + 1, [...acc, w]);
      };
      walk(0, []);
    }
    if (out.length >= max) break;
  }
  return out.slice(0, max);
}
