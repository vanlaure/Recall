// Study tracks: short thematic sets of verse references. Only the references live here; the wording is retrieved
// from the source when the learner opens one, so nothing here can misquote a verse.
export const TRACKS = [
  ['Salvation', ['John 3:16', 'Romans 3:23', 'Romans 6:23', 'Ephesians 2:8-9', 'Romans 10:9']],
  ['Wisdom', ['Proverbs 3:5-6', 'James 1:5', 'Proverbs 9:10', 'Psalm 111:10', 'Proverbs 1:7']],
  ['Comfort', ['Psalm 23:1', 'Isaiah 41:10', 'Matthew 11:28', 'Philippians 4:6-7', 'Psalm 46:1']],
  ['Faith', ['Hebrews 11:1', 'Romans 10:17', '2 Corinthians 5:7', 'James 2:17', 'Proverbs 3:5-6']],
  ['Christ', ['John 1:1', 'John 14:6', 'Colossians 1:15', 'Hebrews 1:3', 'Philippians 2:9-11']],
  ['Prophecy', ['Isaiah 53:5', 'Isaiah 7:14', 'Micah 5:2', 'Isaiah 9:6', 'Zechariah 9:9']],
];

// The day's verse: the same for everyone on a given day, cycling through every track reference in turn.
export function daily(day) {
  const all = [...new Set(TRACKS.flatMap(t => t[1]))];
  return all[Math.floor(Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10)) / 86400000) % all.length];
}
