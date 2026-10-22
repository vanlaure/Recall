// The Research Agent: finds wording to memorise, with a citation the learner can check. Nemotron works out what to
// look up and which of the found quotations fit the request; it never supplies wording. Every word shown comes from
// the fetched source, chosen by number, and carries the page it was read from.
import { agent } from './providers.mjs';

const WIKIQUOTE = () => (process.env.WIKIQUOTE_BASE_URL || 'https://en.wikiquote.org').replace(/\/$/, '');
const BIBLE = () => (process.env.BIBLE_BASE_URL || 'https://bible-api.com').replace(/\/$/, '');
// Public-domain translations only, so a retrieved verse can be stored and shown without a licence.
export const TRANSLATIONS = { kjv: 'King James Version', web: 'World English Bible', asv: 'American Standard Version (1901)' };

async function getJson(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'Recall/0.1 (memory study app)' }, signal: AbortSignal.timeout(20000) });
  if (r.status === 404) return null;
  if (!r.ok) throw Object.assign(Error('The reference source ' + new URL(url).host + ' did not answer (' + r.status + '). Try again.'), { status: 502 });
  return r.json();
}

// --- Tavily web search --------------------------------------------------------------------------------------------
// Tavily finds where the material lives: which Wikiquote page holds a person's or work's quotations, or which chapter
// and verse a learner means when they describe a passage instead of citing it. It never supplies wording. Every word
// shown is still read from the fetched source, so a search result that paraphrases or misquotes changes nothing.
// Without TAVILY_API_KEY, or if Tavily does not answer, the Wikiquote search and the reference parser are used alone.
const TAVILY = () => (process.env.TAVILY_BASE_URL || 'https://api.tavily.com').replace(/\/$/, '');
export const tavilyConfigured = () => !!process.env.TAVILY_API_KEY?.trim();

export async function tavily(query, domains) {
  if (!tavilyConfigured()) return null;
  try {
    const r = await fetch(TAVILY() + '/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.TAVILY_API_KEY.trim() },
      body: JSON.stringify({ query: query.slice(0, 380), include_domains: domains, max_results: 5, search_depth: 'basic' }),
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) return null;
    const data = await r.json();
    return (Array.isArray(data?.results) ? data.results : []).filter(x => typeof x?.url === 'string')
      .map(x => ({ url: x.url, title: String(x.title || ''), content: String(x.content || '') }));
  } catch { return null; }
}

// Wikiquote article titles in the order Tavily ranked them. Talk, category and other non-article pages are dropped.
const NAMESPACE = /^(?:Talk|Category|Special|Wikiquote|User|File|Template|Help|Portal|Main Page)\b/i;
export function wikiquoteTitles(results) {
  const titles = [];
  for (const { url } of results || []) {
    const m = /^https?:\/\/en\.(?:m\.)?wikiquote\.org\/wiki\/([^?#]+)/.exec(url);
    if (!m) continue;
    let title;
    try { title = decodeURIComponent(m[1]).replace(/_/g, ' '); } catch { continue; }
    if (!NAMESPACE.test(title) && !titles.includes(title)) titles.push(title);
  }
  return titles;
}

// A described passage ("the love chapter", "the verse about being still") is looked up on Bible reference sites; the
// first chapter-and-verse found in a result names the passage, and its wording comes from the public-domain source.
const VERSE_REQUEST = /\b(?:verse|verses|scripture|bible|psalm|proverb|gospel|passage|chapter)\b/i;
const VERSE_SITES = ['biblegateway.com', 'biblehub.com', 'openbible.info'];

// --- Verses -------------------------------------------------------------------------------------------------------
// "John 3:16", "1 Corinthians 13:4-7", "Song of Solomon 2:4", anywhere in the request.
const REFERENCE = /\b((?:[1-3] )?[A-Z][a-z]+(?: of [A-Z][a-z]+)?) (\d{1,3}):(\d{1,3})(?:\s?[-–]\s?(\d{1,3}))?/;
export function verseReference(query) {
  const m = REFERENCE.exec(query);
  return m ? m[1] + ' ' + m[2] + ':' + m[3] + (m[4] ? '-' + m[4] : '') : null;
}

export async function verse(reference, translation = 'kjv') {
  const version = Object.hasOwn(TRANSLATIONS, translation) ? translation : 'kjv';
  const data = await getJson(BIBLE() + '/' + encodeURIComponent(reference) + '?translation=' + version);
  if (!data?.verses?.length || typeof data.text !== 'string') return null;
  const first = data.verses[0], book = String(first.book_name);
  return {
    text: data.text.replace(/\s+/g, ' ').trim(), attribution: String(data.reference), work: TRANSLATIONS[version] + ', public domain',
    source: 'Retrieved from bible-api.com', status: 'sourced',
    url: 'https://www.biblegateway.com/passage/?search=' + encodeURIComponent(data.reference) + '&version=' + version.toUpperCase(),
    // Where the original-language words of this verse can be checked.
    interlinear: 'https://biblehub.com/interlinear/' + book.toLowerCase().replace(/ /g, '_') + '/' + first.chapter + '-' + first.verse + '.htm',
  };
}

// --- Quotations ---------------------------------------------------------------------------------------------------
const clean = s => s.replace(/<!--[\s\S]*?-->/g, '').replace(/<ref[^>]*>[\s\S]*?<\/ref>|<ref[^>]*\/>/gi, '').replace(/\{\{pbr\}\}|<br\s*\/?>/gi, '\n')
  .replace(/\{\{[^{}]*\}\}/g, '').replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1').replace(/\[https?:\/\/\S+\s+([^\]]*)\]/g, '$1').replace(/\[https?:\/\/\S+\]/g, '')
  .replace(/'{2,}/g, '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&ndash;/g, '–').replace(/&mdash;/g, '—').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
  .split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');

// Sections that hold other people's words about the subject, or no quotations at all.
const SKIP = /^(?:see also|external links|references|notes|sources|further reading|cast|taglines|about|quotes about|quotations about)\b/i;

// Reads a quotation page's markup: a "*" line is a quotation, the "**" line under it is where it is from, and the
// headings above say which work or period it belongs to. Quotations the page files as disputed or misattributed
// keep that label.
export function parseQuotes(wikitext) {
  const quotes = [];
  let h2 = '', h3 = '', current = null;
  for (const line of String(wikitext).split('\n')) {
    const h = /^(={2,4})\s*(.*?)\s*\1\s*$/.exec(line);
    if (h) { if (h[1].length === 2) { h2 = clean(h[2]); h3 = ''; } else h3 = clean(h[2]); current = null; continue; }
    if (SKIP.test(h2)) continue;
    if (/^\*\*/.test(line)) {
      if (current && !current.source) {
        current.source = clean(line.replace(/^\*+/, '')).replace(/\n/g, ' ').slice(0, 300);
        current.sourceUrl = /\[(https?:\/\/[^\s\]]+)/.exec(line)?.[1] || null;
        if (current.status === 'unsourced' && current.source) current.status = 'sourced';
      }
      continue;
    }
    if (!/^\*[^*]/.test(line)) continue;
    const text = clean(line.slice(1));
    current = text.length >= 8 && text.length <= 700 ? { text, section: h3 || h2, source: '', sourceUrl: null, status: /misattributed/i.test(h2) ? 'misattributed' : /disputed/i.test(h2) ? 'disputed' : 'unsourced' } : null;
    if (current) quotes.push(current);
  }
  return quotes;
}

const LOOKUP = 'Research Agent: the learner wants a quotation to memorise. Work out whose words or which work they want. Return {search:string,topic:string}: search is only the name of the person, film, book, song or show to look up in a quotation reference; topic is the subject they want the quotation to be about, or "".';
const CHOOSE = 'Research Agent: choose the quotations that best fit the request from the numbered candidates, which were read from a reference page. Prefer lines that are widely quoted and short enough to memorise (under forty words), that have a stated source, and that are on the requested topic; put the single best-known line first; avoid ones marked disputed or misattributed unless nothing else fits. Return {picks:[number]}: up to six candidate numbers, best first. Never write quotation text yourself.';

async function quotes(query) {
  const want = await agent(LOOKUP, { request: query });
  const search = String(want.search || query).slice(0, 120);
  // Tavily ranks the pages by the whole request (person, work and topic); Wikiquote's own search matches titles only.
  let titles = wikiquoteTitles(await tavily(search + (want.topic ? ' ' + want.topic : '') + ' quotes', ['en.wikiquote.org']));
  const via = titles.length ? 'tavily' : 'wikiquote';
  if (!titles.length) {
    const found = await getJson(WIKIQUOTE() + '/w/api.php?action=query&list=search&format=json&srlimit=5&srsearch=' + encodeURIComponent(search));
    titles = (found?.query?.search || []).map(h => String(h.title));
  }
  for (const hitTitle of titles.slice(0, 3)) {
    const page = await getJson(WIKIQUOTE() + '/w/api.php?action=parse&prop=wikitext&format=json&redirects=1&page=' + encodeURIComponent(hitTitle));
    const candidates = parseQuotes(page?.parse?.wikitext?.['*'] || '').slice(0, 80);
    if (!candidates.length) continue;
    const title = String(page.parse.title), url = 'https://en.wikiquote.org/wiki/' + encodeURIComponent(title.replace(/ /g, '_'));
    const said = await agent(CHOOSE, { request: query, topic: String(want.topic || ''), page: title, candidates: candidates.map((c, n) => ({ n: n + 1, text: c.text.slice(0, 240), source: c.source || c.section, status: c.status })) });
    // Picks are candidate numbers; anything else is ignored, and with no usable pick the page's first quotations are shown.
    const picks = [...new Set((Array.isArray(said.picks) ? said.picks : []).filter(n => Number.isInteger(n) && candidates[n - 1]))].slice(0, 6);
    const chosen = (picks.length ? picks : candidates.slice(0, 6).map((_, n) => n + 1)).map(n => candidates[n - 1]);
    return { kind: 'quotes', looked_up: search, found_by: via, page: { title, url }, results: chosen.map(c => ({ text: c.text, attribution: title, work: c.section, source: c.source, sourceUrl: c.sourceUrl, url, status: c.status })) };
  }
  return { kind: 'quotes', looked_up: search, found_by: via, page: null, results: [] };
}

// Answers a learner's request ("John 3:16", "a famous quote by Jim Croce", "a line from Casablanca") with wording
// read from a source and where to check it.
export async function research(query, translation) {
  if (typeof query !== 'string' || !query.trim() || query.length > 300) throw Error('Say what to look for in 1–300 characters.');
  const reference = verseReference(query);
  if (reference) {
    const found = await verse(reference, translation);
    if (found) return { kind: 'verse', looked_up: reference, found_by: 'reference', page: { title: found.attribution, url: found.url }, results: [found] };
  }
  // A passage described in words: Tavily finds which chapter and verse it is, and the wording is fetched as above.
  if (!reference && VERSE_REQUEST.test(query)) {
    for (const hit of (await tavily(query.trim(), VERSE_SITES)) || []) {
      const named = verseReference(hit.title) || verseReference(hit.content);
      const found = named && await verse(named, translation);
      if (found) return { kind: 'verse', looked_up: named, found_by: 'tavily', identified_at: hit.url, page: { title: found.attribution, url: found.url }, results: [found] };
    }
  }
  return quotes(query.trim());
}
