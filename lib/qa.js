'use strict';

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
 * Build final questions from raw items, respecting the requested type mode.
 * @param {Array} rawItems
 * @param {'open'|'closed'|'mixed'} typeMode
 */
function buildQuestionsFromRaw(rawItems, typeMode = 'closed') {
  const allAnswers = new Set();
  const normToOriginal = new Map();
  for (const item of rawItems) {
    if (item.answer) {
      const k = normKey(item.answer);
      allAnswers.add(k);
      if (!normToOriginal.has(k)) normToOriginal.set(k, item.answer);
    }
  }

  const out = [];
  const seenQuestions = new Set();
  const items = [];
  for (const item of rawItems) {
    const k = normKey(item.question || '');
    if (!k || seenQuestions.has(k)) continue;
    seenQuestions.add(k);
    items.push(item);
  }

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const q = String(item.question || '').trim();
    const a = String(item.answer || '').trim();
    if (!q || !a) continue;

    const rawOpts = Array.isArray(item.options)
      ? item.options.map((o) => String(o).trim()).filter(Boolean)
      : null;
    const hasExplicitOptions = !!(rawOpts && rawOpts.length >= 2);

    let forceOpen = false;
    let forceClosed = false;
    if (typeMode === 'open') forceOpen = true;
    else if (typeMode === 'closed') forceClosed = true;
    else if (typeMode === 'mixed') {
      forceClosed = i % 2 === 0;
      forceOpen = i % 2 === 1;
    }

    if (forceOpen) {
      out.push({
        type: 'open',
        prompt: q,
        options: undefined,
        answer: a,
        keywords: [lower(a)],
        explanation: ''
      });
      continue;
    }

    if (forceClosed || hasExplicitOptions) {
      let opts = hasExplicitOptions ? rawOpts.slice() : [];

      if (!hasExplicitOptions || opts.length < 4) {
        const otherAnswers = [...allAnswers].filter((k) => k !== normKey(a));
        if (otherAnswers.length >= 3) {
          const distractors = shuffle(otherAnswers).slice(0, 3);
          opts = opts.concat(distractors.map((k) => normToOriginal.get(k) || k));
        }
      }

      if (!opts.some((o) => normKey(o) === normKey(a))) opts.push(a);

      const seen = new Set();
      opts = opts.filter((o) => {
        const k = normKey(o);
        if (!k || seen.has(k)) return false;
        seen.add(k);
        return true;
      });

      opts = shuffle(opts).slice(0, 4);
      if (opts.length < 2) {
        out.push({
          type: 'open',
          prompt: q,
          options: undefined,
          answer: a,
          keywords: [lower(a)],
          explanation: ''
        });
        continue;
      }

      out.push({
        type: 'closed',
        prompt: q,
        options: opts,
        answer: a,
        keywords: [lower(a)],
        explanation: ''
      });
    } else {
      out.push({
        type: 'open',
        prompt: q,
        options: undefined,
        answer: a,
        keywords: [lower(a)],
        explanation: ''
      });
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
    if (q != null && a != null) {
      raw.push({ question: q, answer: a, options: opts, type: item.type != null ? item.type : item.Type });
    }
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
    const cols = splitDelimited(lines[i], delim);
    if (cols.length < 2) continue;
    const opts = cols.length > 2 ? cols.slice(2).filter(Boolean) : null;
    raw.push({ question: cols[0], answer: cols[1], options: opts, type: null });
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

  for (const rawLine of lines) {
    const l = rawLine.trim();
    if (!l) continue;

    let m;
    if ((m = l.match(/^(?:optie|optie|option|keuze)\s*\d*\s*[:.\-]\s*(.*)$/i))) {
      opts.push(m[1].trim());
    } else if ((m = l.match(/^(?:vraag|q|question)\s*[:.\-]\s*(.*)$/i))) {
      flush();
      q = m[1];
    } else if ((m = l.match(/^(?:antwoord|a|answer|oplossing)\s*[:.\-]\s*(.*)$/i))) {
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

function parseQA(text, typeMode = 'closed') {
  const t = String(text || '').trim();
  if (!t) return [];

  const attempts = [parseJson, parseCsv, parseBlocks];
  for (const fn of attempts) {
    try {
      const raw = fn(t);
      if (raw && raw.length) return buildQuestionsFromRaw(raw, typeMode);
    } catch (e) {
      /* try next format */
    }
  }
  return [];
}

module.exports = { parseQA };