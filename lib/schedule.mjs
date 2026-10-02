// Training schedule. Days are plain 'YYYY-MM-DD' strings in the learner's own calendar, supplied by the browser,
// so a session planned for Friday is Friday wherever the server runs.

const DAY = 86400000;
const VALID = /^\d{4}-\d{2}-\d{2}$/;
const toMs = day => Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10));
export const addDays = (day, n) => new Date(toMs(day) + n * DAY).toISOString().slice(0, 10);
export const daysBetween = (from, to) => Math.round((toMs(to) - toMs(from)) / DAY);
export const isDay = day => typeof day === 'string' && VALID.test(day) && addDays(day, 0) === day;

// The learner's "today": what the browser says, if it is within a day of the server's date; otherwise the server's.
export function today(claimed, now = Date.now()) {
  const server = new Date(now).toISOString().slice(0, 10);
  return isDay(claimed) && Math.abs(daysBetween(server, claimed)) <= 1 ? claimed : server;
}

// Practice days from `start` up to a deadline: gaps that widen (today, +1, +3, +7, +14, +30 …) while there is room,
// then a run-through the day before and a final check on the day itself. With little time, it becomes daily.
const OFFSETS = [0, 1, 3, 7, 14, 30, 60, 120, 240];
export function planSessions(start, target) {
  const span = daysBetween(start, target);
  if (span <= 0) return [start];
  const offsets = new Set(OFFSETS.filter(o => o < span - 1));
  offsets.add(0); offsets.add(Math.max(0, span - 1)); offsets.add(span);
  return [...offsets].sort((a, b) => a - b).map(o => addDays(start, o));
}

// Without a deadline the gap doubles with each successful session (2, 4, 8, 16, 30 days) and resets on a poor one.
export function nextOpenEnded(day, score, streak) {
  return score < .8 ? day : addDays(day, Math.min(30, 2 ** Math.min(streak, 5)));
}

// The next day this kit should be practised after a session on `day`.
export function nextDue(kit, day, score, streak) {
  if (score < .8) return day;                                   // not there yet: practise again today
  const ahead = (kit.plan || []).find(d => d > day);
  return ahead || nextOpenEnded(day, score, streak);
}

// Every practice day still ahead for a kit, from its plan or its single due date.
export function upcoming(kit, day) {
  const due = kit.dueDay || (kit.due || '').slice(0, 10) || day;
  const planned = (kit.plan || []).filter(d => d >= day);
  const days = new Set(planned);
  days.add(due < day ? day : due);                               // an overdue kit is due today
  return [...days].sort();
}

// --- Calendar export (RFC 5545) -----------------------------------------------------------------------------------
const escapeText = s => String(s).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
// Lines are folded at 75 bytes; continuation lines start with a space.
function fold(line) {
  const out = [];
  let current = '';
  for (const ch of line) {
    if (Buffer.byteLength(current + ch) > (out.length ? 74 : 75)) { out.push(current); current = ''; }
    current += ch;
  }
  out.push(current);
  return out.join('\r\n ');
}
export function calendarFile(kits, day, now = Date.now()) {
  const stamp = new Date(now).toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Recall//Training schedule//EN', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Recall practice'];
  for (const kit of kits) for (const d of upcoming(kit, day)) {
    const last = kit.targetDay === d;
    lines.push('BEGIN:VEVENT', 'UID:' + kit.id + '-' + d + '@recall', 'DTSTAMP:' + stamp,
      'DTSTART;VALUE=DATE:' + d.replace(/-/g, ''), 'DTEND;VALUE=DATE:' + addDays(d, 1).replace(/-/g, ''),
      'SUMMARY:' + escapeText((last ? 'Recall final check: ' : 'Recall practice: ') + kit.title),
      'DESCRIPTION:' + escapeText((kit.technique?.name || 'Memory kit') + ', ' + kit.scenes.length + (kit.scenes.length === 1 ? ' scene.' : ' scenes.') + (kit.targetDay ? ' Needed by ' + kit.targetDay + '.' : '')),
      'TRANSP:TRANSPARENT', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
