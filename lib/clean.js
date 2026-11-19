'use strict';

const STOPWORDS = new Set(
  ('de het een en van in is dat op te met voor niet zijn er aan als door maar om ook bij of uit nog ' +
    'worden wordt kan naar dan deze dit die zich heeft hebben was waren over onder tussen hun hem zij ' +
    'wij je u ze meer meest veel weinig alle elke ander andere tijdens via zonder binnen waar wanneer ' +
    'waarom hoe wie wat welk welke hier daar nu straks steeds altijd nooit soms doet doen gaat gaan ' +
    'geeft geven maakt maken neemt nemen ziet zien komt komen moet moeten wil willen mag kunnen')
    .split(/\s+/)
    .filter(Boolean)
);

// Words that usually introduce a definition / factual statement (theory).
const THEORY_MARKERS = [
  ' is ',
  ' zijn ',
  ' betekent ',
  ' wordt ',
  ' worden ',
  ' heeft ',
  ' hebben ',
  ' bevat ',
  ' omvat ',
  ' bestaat ',
  ' bestaat uit ',
  ' noemt ',
  ' noemen ',
  ' heet ',
  ' kan ',
  ' kunnen ',
  ' veroorzaakt ',
  ' zorgt ',
  ' is een ',
  ' is de ',
  ' refers to ',
  ' is defined ',
  ' occurs ',
  ' causes ',
  ' consists '
];

/**
 * Normalise raw extracted text:
 * - drops page numbers / bare numbers
 * - drops repeated headers & footers (short lines repeated on many pages)
 * - drops obvious URLs / e-mail addresses
 * - merges words that were hyphenated across a line break
 */
function cleanText(raw) {
  if (!raw) return '';

  const rawLines = String(raw).replace(/\r/g, '').split(/\n/);
  const lines = [];

  for (const line of rawLines) {
    const t = line.replace(/\s+/g, ' ').trim();
    if (!t) continue;
    if (/^\d{1,4}$/.test(t)) continue; // bare page number
    if (/^(pagina|page|blz|blad|p\.)\s*\d+/i.test(t)) continue; // "Pagina 1"
    if (/^slide\s*\d+/i.test(t)) continue; // "Slide 3"
    if (/^[-–—•·.\s]+$/.test(t)) continue; // separators
    if (/^(https?:\/\/|www\.)/i.test(t)) continue; // URLs
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) continue; // e-mail
    lines.push(t);
  }

  // drop repeated headers/footers: short lines that appear many times
  const counts = new Map();
  for (const l of lines) counts.set(l, (counts.get(l) || 0) + 1);
  const repeated = new Set(
    [...counts.entries()].filter(([l, c]) => c >= 3 && l.length <= 70).map(([l]) => l)
  );

  const kept = lines.filter((l) => !repeated.has(l));

  // Build paragraphs: headings (short line without end punctuation) become
  // their own terminated segment so they never merge into the next sentence.
  const paragraphs = [];
  let buf = '';

  const flush = () => {
    if (buf.trim()) paragraphs.push(buf.trim());
    buf = '';
  };

  for (const line of kept) {
    const wc = line.split(/\s+/).length;
    const looksHeading = wc <= 6 && !/[.!?;:]$/.test(line);

    if (looksHeading) {
      flush();
      paragraphs.push(/[.!?]$/.test(line) ? line : line + '.');
    } else {
      const prev = buf.replace(/\s+$/, '');
      // merge hyphenated line break: "gehoor-" + "zenuw" -> "gehoorzenuw"
      if (/[\p{L}]-$/u.test(prev) && /^[\p{L}]/u.test(line)) {
        buf = prev.slice(0, -1) + line + ' ';
      } else {
        buf += (buf ? ' ' : '') + line;
      }
    }
  }
  flush();

  return paragraphs.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * Split cleaned text into candidate sentences.
 */
function splitSentences(text) {
  const matches = String(text).match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [text];
  return matches
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => s.length > 0);
}

/**
 * Decide whether a sentence is real theory (vs. a title, heading, caption,
 * reference, table of contents line, etc.).
 */
function isTheory(sentence) {
  const s = sentence.trim();
  if (!s) return false;

  const words = s.split(/\s+/);
  const wc = words.length;

  // too short -> likely a title / heading / bullet
  if (wc < 6) return false;
  // very long -> likely a list or paragraph blob
  if (wc > 70) return false;

  // must be mostly letters (not a table/number list)
  const letters = (s.match(/[\p{L}]/gu) || []).length;
  const digits = (s.match(/\d/g) || []).length;
  if (letters < s.length * 0.55) return false;
  if (digits > letters * 0.5) return false;

  // reference / citation line
  if (/\(\d{4}\)/.test(s) && wc < 30) return false;
  if (/\b(doi|isbn|journal|press|publisher|pp\.|vol\.|ed\.)\b/i.test(s) && wc < 30) return false;
  if (/^(figure|fig\.?|table|tables|illustratie|afbeelding|bron|source|referentie|bibliografie|literatuur)/i.test(s)) {
    return false;
  }
  // table-of-contents style: many dot leaders
  if (/\.{3,}/.test(s)) return false;

  // must end with sentence punctuation (headings are short and handled below)
  if (!/[.!?]$/.test(s)) return false;

  // Distinguish running text from a Title Case heading: real sentences contain
  // several lowercase words, headings are mostly Capitalised Words.
  const lowerWords = words.filter((w) => /^[a-zà-ÿ]/.test(w)).length;
  if (lowerWords < 4) return false;

  // enough meaningful (non-stopword) content
  const contentWords = words.filter((w) => w.length >= 5 && !STOPWORDS.has(w.toLowerCase()));
  if (contentWords.length < 3) return false;

  // Must look like a statement: either a definition marker or a finite verb.
  const lower = ' ' + s.toLowerCase() + ' ';
  const definitional = THEORY_MARKERS.some((m) => lower.includes(m));
  const hasVerb = /\b(is|zijn|wordt|worden|heeft|hebben|bevat|omvat|bestaat|kan|worden|noemen|heet|veroorzaakt|zorgt|komt|vormt|behelst|bevindt|ligt|meten|meet|begint|gebeurt|verloopt|werkt| ontstaat|ontstaat|neemt|af|toe|gaat|kiest|speelt|vormt|regelt|stuurt|geleidt|omzeilt|gebruikt)\b/i.test(
    s
  );

  return definitional || hasVerb || lowerWords >= 6;
}

/**
 * Prepare cleaned text for question generation.
 * Also derives the document's key terms (topic words) so questions stay on-topic.
 * @returns {{clean:string, theory:string[], sentences:string[], pool:string[], keyTerms:string[]}}
 */
function prepare(raw) {
  const clean = cleanText(raw);
  const sentences = splitSentences(clean);
  const theory = sentences.filter(isTheory);

  const freq = new Map();
  const display = new Map();
  const tokens = clean.match(/[\p{L}][\p{L}\-]{3,}/gu) || [];
  for (const t of tokens) {
    const w = t.replace(/^-+|-+$/g, '');
    if (w.length < 5) continue;
    const lw = w.toLowerCase();
    if (STOPWORDS.has(lw)) continue;
    freq.set(lw, (freq.get(lw) || 0) + 1);
    if (!display.has(lw)) display.set(lw, w);
  }

  // pool = unique content words (for distractors)
  const pool = [...display.values()];

  // keyTerms = most frequent content words (topic vocabulary)
  const keyTerms = [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25)
    .map(([lw]) => display.get(lw));

  return { clean, theory, sentences, pool, keyTerms };
}

module.exports = { cleanText, splitSentences, isTheory, prepare };