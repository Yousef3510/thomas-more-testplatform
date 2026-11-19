'use strict';

/**
 * Parse a document that already contains questions and answers into question
 * objects. Supports JSON, CSV and plain-text ("Vraag:/Antwoord:", "Q:/A:",
 * numbered lists, Option/Optie lines).
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

function buildQuestion(question, answer, options, typeHint) {
  const q = String(question || '').trim();
  const a = String(answer == null ? '' : answer).trim();
  if (!q || !a) return null;

  const opts = Array.isArray(options)
    ? options.map((o) => String(o).trim()).filter(Boolean)
    : null;

  let type = typeHint ? lower(typeHint) : '';
  if (type !== 'open' && type !== 'closed') {
    type = opts && opts.length >= 2 ? 'closed' : 'open';
  }

  if (type === 'closed') {
    if (!opts || opts.length < 2) {
      // not enough options -> treat as open
      type = 'open';
    } else {
      let options2 = opts.slice();
      if (!options2.some((o) => normKey(o) === normKey(a))) options2.push(a);
      // dedupe by normalised form
      const seen = new Set();
      options2 = options2.filter((o) => {
        const k = normKey(o);
        if (!k || seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      if (options2.length < 2) return null;
      return {
        type: 'closed',
        prompt: q,
        options: options2,
        answer: a,
        keywords: [lower(a)],
        explanation: ''
      };
    }
  }

  return { type: 'open', prompt: q, options: undefined, answer: a, keywords: [lower(a)], explanation: '' };
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

  const out = [];
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
    const built = buildQuestion(q, a, opts, item.type != null ? item.type : item.Type);
    if (built) out.push(built);
  }
  return out.length ? out : null;
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

  const first = splitDelimited(lines[0], delim).map(lower);
  let start = 0;
  const headerLooksRight =
    first.some((c) => c === 'question' || c === 'vraag' || c === 'q') &&
    first.some((c) => c === 'answer' || c === 'antwoord' || c === 'a' || c === 'oplossing');
  if (headerLooksRight) start = 1;

  const out = [];
  for (let i = start; i < lines.length; i++) {
    const cols = splitDelimited(lines[i], delim);
    if (cols.length < 2) continue;
    const q = cols[0];
    const a = cols[1];
    const opts = cols.length > 2 ? cols.slice(2).filter(Boolean) : null;
    const built = buildQuestion(q, a, opts, null);
    if (built) out.push(built);
  }
  return out.length ? out : null;
}

function parseBlocks(text) {
  const lines = text.replace(/\r/g, '').split('\n');
  const out = [];
  let q = null;
  let a = null;
  let opts = [];

  const flush = () => {
    if (q && a) {
      const built = buildQuestion(q.trim(), a.trim(), opts.length ? opts : null, null);
      if (built) out.push(built);
    }
    q = null;
    a = null;
    opts = [];
  };

  const reQ = /^(?:vraag|Vraag|q|Q|question|Question)\s*[:.\-]\s*(.*)$/;
  const reA = /^(?:antwoord|Antwoord|a|A|answer|Answer|oplossing|Oplossing)\s*[:.\-]\s*(.*)$/;
  const reOpt = /^(?:optie|Optie|option|Option|keuze|Keuze)\s*\d*\s*[:.\-]\s*(.*)$/;
  const reNum = /^\d+\s*[.)\-]\s+(.*)$/;

  for (const raw of lines) {
    const l = raw.trim();
    if (!l) continue;

    let m;
    if ((m = l.match(reOpt))) {
      opts.push(m[1].trim());
    } else if ((m = l.match(reQ))) {
      flush();
      q = m[1];
    } else if ((m = l.match(reA))) {
      a = m[1];
    } else if ((m = l.match(reNum))) {
      // a numbered line starts a new question
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

  return out.length ? out : null;
}

function parseQA(text) {
  const t = String(text || '').trim();
  if (!t) return [];
  const attempts = [parseJson, parseCsv, parseBlocks];
  for (const fn of attempts) {
    try {
      const res = fn(t);
      if (res && res.length) return res;
    } catch (e) {
      /* try next */
    }
  }
  return [];
}

module.exports = { parseQA };