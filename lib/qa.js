'use strict';

/**
 * Parse a document that already contains questions and answers into question
 * objects. Supports JSON, CSV and plain-text ("Vraag:/Antwoord:", "Q:/A:",
 * numbered lists, Option/Optie lines).
 *
 * For open questions (no options provided), distractors are automatically
 * generated from the answers of other questions in the same file.
 *
 * @param {string} text
 * @returns {Array<{type:'open'|'closed', prompt:string, options?:string[], answer:string, keywords:string[], explanation:string}>}
 */

function lower(s) {
  return String(s == null ? '' : s).toLowerCase().trim();
}

function normKey(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Build final question objects from raw data, adding distractors for open questions
 * using the global answer pool.
 */
function buildQuestionsFromRaw(rawItems) {
  // Collect all unique answers from all questions
  const allAnswers = new Set();
  for (const item of rawItems) {
    if (item.answer) allAnswers.add(normKey(item.answer));
  }

  const out = [];
  for (const item of rawItems) {
    const q = String(item.question || '').trim();
    const a = String(item.answer || '').trim();
    if (!q || !a) continue;

    const rawOpts = Array.isArray(item.options)
      ? item.options.map((o) => String(o).trim()).filter(Boolean)
      : null;

    let type = item.type ? String(item.type).toLowerCase().trim() : '';

    // If options provided and >= 2, it's a closed question
    if (rawOpts && rawOpts.length >= 2) {
      // Ensure answer is among options, dedupe, max 4 options
      let opts = rawOpts.slice();
      if (!opts.some((o) => normKey(o) === normKey(item.answer))) opts.push(item.answer);
      // dedupe by normalised form
      const seen = new Set();
      opts = opts.filter((o) => {
        const k = normKey(o);
        if (!k || seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      // keep max 4 options
      opts = shuffle(opts).slice(0, 4);
      if (opts.length < 2) continue;
      out.push({
        type: 'closed',
        prompt: q,
        options: opts,
        answer: a,
        keywords: [lower(a)],
        explanation: ''
      });
    } else {
      // Open question: auto-generate 3 distractors from other answers
      const otherAnswers = [...allAnswers].filter((k) => k !== normKey(a));
      if (otherAnswers.size < 3) {
        // Not enough distractors, keep as open
        out.push({
          type: 'open',
          prompt: q,
          options: undefined,
          answer: a,
          keywords: [lower(a)],
          explanation: ''
        });
      } else {
        const distractors = shuffle([...otherAnswers]).slice(0, 3);
        // Need to map back from normKey to original answer text
        // Build a map from normKey to original answer
        const normToOriginal = new Map();
        for (const item of rawItems) {
          if (item.answer) normToOriginal.set(normKey(item.answer), item.answer);
        }
        const distractorTexts = distractors.map((k) => normToOriginal.get(k) || k);
        const opts = shuffle([a, ...distractorTexts]);
        out.push({
          type: 'closed',
          prompt: q,
          options: opts,
          answer: a,
          keywords: [lower(a)],
          explanation: ''
        });
      }
    }
  }

  return out;
}

function parseJson(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return null;
  }
  let arr = null;
  if (Array.isArray(data)) arr = data;
  else if (data && Array.isArray(data.questions)) arr = data.questions;
  else if (data && Array.isArray(data.items)) arr = data.items;
  if (!arr) return null;

  const raw = [];
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const q =
      item.question != null
        ? item.question
        : item.vraag != null
        ? item.vraag
        : item.prompt != null
        ? item.prompt
        : item.q;
    const a =
      item.answer != null
        ? item.answer
        : item.antwoord != null
        ? item.antwoord
        : item.solution != null
        ? item.solution
        : item.a;
    const opts = item.options != null ? item.options : item.opties != null ? item.opties : item.choices;
    if (q != null && a != null) raw.push({ question: q, answer: a, options: opts, type: item.type ?? item.Type });
  }
  return raw.length ? raw : null;
}

function splitDelimited(line, delim) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delim && !inQuotes) {
      out.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

function parseCsv(text) {
  const lines = text
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return null;

  const delim = lines[0].includes(';') && !lines[0].includes(',') ? ';' : ',';
  if (!lines[0].includes(delim)) return null;

  const first = splitDelimited(lines[0], delim).map((s) => s.toLowerCase().trim());
  let start = 0;
  const headerLooksRight =
    first.some((c) => c === 'question' || c === 'vraag' || c === 'q') &&
    first.some((c) => c === 'answer' || c === 'antwoord' || c === 'a' || c === 'oplossing');
  if (headerLooksRight) start = 1;

  const raw = [];
  for (let i = start; i < lines.length; i++) {
    const cols = splitDelimited(lines[i], ',');
    if (cols.length < 2) continue;
    const q = cols[0];
    const a = cols[1];
    const opts = cols.length > 2 ? cols.slice(2).filter(Boolean) : null;
    raw.push({ question: q, answer: a, options: opts, type: null });
  }
  return raw.length ? raw : null;
}

function parseBlocks(text) {
  const lines = text.replace(/\r/g, '').split('\n');
  const raw = [];
  let q = null;
  let a = null;
  let opts = [];

  const flush = () => {
    if (q && a) {
      raw.push({ question: q.trim(), answer: a.trim(), options: opts.length ? opts : null, type: null });
    }
    q = null;
    a = null;
    opts = [];
  };

  const reQ = /^(?:vraag|Vraag|q|Q|question|Question)\s*[:.\-]\s*(.*)$/;
  const reA = /^(?:antwoord|Antwoord|a|A|answer|Answer|oplossing|Oplossing)\s*[:.\-]\s*(.*)$/;
  const reOpt = /^(?:optie|Optie|option|Option|keuze|Keuze)\s*\d*\s*[:.\-]\s*(.*)$/;
  const reNum = /^\d+\s*[.)\-]\s+(.*)$/;

  for (const rawLine of lines) {
    const l = rawLine.trim();
    if (!l) continue;

    let m;
    if ((m = l.match(/^(?:optie|Optie|option|Option|keuze|Keuze)\s*\d*\s*[:.\-]\s*(.*)$/))) {
      opts.push(m[1].trim());
    } else if ((m = l.match(/^(?:vraag|Vraag|q|Q|question|Question)\s*[:.\-]\s*(.*)$/))) {
      flush();
      q = m[1];
    } else if ((m = l.match(/^(?:antwoord|Antwoord|a|A|answer|Answer|oplossing|Oplossing)\s*[:.\-]\s*(.*)$/))) {
      a = m[1];
    } else if ((m = l.match(/^\d+\s*[.)\-]\s+(.*)$/))) {
      flush();
      q = m[1];
      a = null;
      opts = [];
    } else if (q && !a) {
      q += ' ' + l;
    } else if (a) {
      a += ' ' + l;
    }
  }
  flush();

  return raw.length ? raw : null;
}

function parseQA(text) {
  const t = String(text || '').trim();
  if (!t) return [];

  const attempts = [parseJson, parseCsv, parseBlocks];
  for (const fn of attempts) {
    try {
      const raw = fn(t);
      if (raw && raw.length) {
        return buildQuestionsFromRaw(raw);
      }
    } catch (e) {
      /* try next */
    }
  }
  return [];
}

module.exports = { parseQA };