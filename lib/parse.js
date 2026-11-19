'use strict';

const path = require('path');
const AdmZip = require('adm-zip');

/**
 * Convert pdf.js text items into text, using item positions to decide
 * whether to insert a space, keep words together, or start a new line.
 * This avoids splitting words ("gehoor" -> "ge hoor") and keeps lines intact.
 */
function itemsToText(items) {
  let out = '';
  let prev = null;

  for (const it of items) {
    // skip empty marker items (they carry EOL but no text)
    if (typeof it.str !== 'string' || it.str === '') {
      continue;
    }
    const tr = it.transform || [1, 0, 0, 1, 0, 0];
    const x = tr[4];
    const y = tr[5];
    const w = it.width || 0;

    if (prev) {
      const prevTr = prev.transform || [1, 0, 0, 1, 0, 0];
      const prevX = prevTr[4];
      const prevY = prevTr[5];
      const prevW = prev.width || 0;

      const dy = Math.abs(y - prevY);
      const gap = x - (prevX + prevW);

      if (dy > 3 || prev.hasEOL) {
        // new visual line
        if (!out.endsWith('\n')) out += '\n';
      } else if (gap > 1.2 && !out.endsWith(' ') && !/\s$/.test(it.str) && !/^\s/.test(it.str)) {
        // only add a space when there is a real horizontal gap
        out += ' ';
      }
    }

    out += it.str;
    prev = it;
  }

  return out;
}

/**
 * Extract text from every page of a PDF using pdfjs-dist (modern, maintained).
 * @returns {Promise<{text: string, pages: number}>}
 */
async function extractPdf(buffer) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

  let standardFontDataUrl;
  try {
    const pkgDir = path.dirname(require.resolve('pdfjs-dist/package.json'));
    standardFontDataUrl = path.join(pkgDir, 'standard_fonts').replace(/\\/g, '/') + '/';
  } catch (e) {
    /* optional */
  }

  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    standardFontDataUrl,
    useSystemFonts: true
  }).promise;

  const pages = [];
  const total = doc.numPages;

  for (let i = 1; i <= total; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const text = itemsToText(content.items).replace(/[ \t]+\n/g, '\n');
    pages.push(text);
  }

  return { text: pages.join('\n').trim(), pages: total };
}

/**
 * Extract text from a .pptx buffer (zip of XML slides), including grouped
 * shapes and tables (all <a:t> runs), plus speaker notes.
 * @returns {{text: string, slides: number}}
 */
function extractPptx(buffer) {
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries();

  const byNumber = (a, b) => {
    const na = parseInt((a.entryName.match(/(\d+)/) || [])[1] || '0', 10);
    const nb = parseInt((b.entryName.match(/(\d+)/) || [])[1] || '0', 10);
    return na - nb;
  };

  function paragraphsFrom(xml) {
    // split into <a:p> paragraphs, gather <a:t> runs per paragraph
    const segments = xml.split(/<\/a:p>/i);
    const paras = [];
    for (const seg of segments) {
      const runs = [];
      const re = /<a:t>([\s\S]*?)<\/a:t>/gi;
      let m;
      while ((m = re.exec(seg)) !== null) {
        const t = decodeXml(m[1]).replace(/\s+/g, ' ').trim();
        if (t) runs.push(t);
      }
      if (!runs.length) continue;
      let text = runs.join(' ').replace(/\s+/g, ' ').trim();
      if (!/[.!?]$/.test(text)) text += '.';
      paras.push(text);
    }
    return paras.join(' ');
  }

  const slideEntries = entries
    .filter((e) => /^ppt\/slides\/slide\d+\.xml$/i.test(e.entryName))
    .sort(byNumber);

  const slides = [];
  for (const entry of slideEntries) {
    const xml = entry.getData().toString('utf8');
    const text = paragraphsFrom(xml);
    if (text.trim()) slides.push(text.trim());
  }

  // speaker notes (can contain extra theory)
  const notes = entries
    .filter((e) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/i.test(e.entryName))
    .sort(byNumber);
  for (const entry of notes) {
    const xml = entry.getData().toString('utf8');
    const text = paragraphsFrom(xml);
    if (text.trim()) slides.push(text.trim());
  }

  return { text: slides.join('\n').trim(), slides: slideEntries.length };
}

/**
 * Legacy .ppt (binary) fallback: best-effort text extraction.
 */
function extractPptLegacy(buffer) {
  const s = buffer.toString('latin1');
  const matches = s.match(/[A-Za-zÀ-ÿ0-9 ,.;:()\-]{4,}/g) || [];
  return { text: matches.join(' ').replace(/\s+/g, ' ').trim(), slides: 0 };
}

function decodeXml(str) {
  return str
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)))
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ');
}

/**
 * Main entry: dispatch by file extension / mimetype.
 * @returns {Promise<{text: string, pages: number, slides: number, warning?: string}>}
 */
async function extractText(file) {
  const original = (file.originalname || '').toLowerCase();
  const buffer = file.buffer;

  if (!buffer || buffer.length === 0) {
    return { text: '', pages: 0, slides: 0, warning: 'Leeg bestand.' };
  }

  try {
    if (original.endsWith('.pdf') || file.mimetype === 'application/pdf') {
      const { text, pages } = await extractPdf(buffer);
      return {
        text,
        pages,
        slides: 0,
        warning: text ? undefined : 'Geen tekst gevonden in PDF (mogelijk gescand — OCR is nodig).'
      };
    }

    if (original.endsWith('.pptx')) {
      const { text, slides } = extractPptx(buffer);
      return { text, pages: 0, slides, warning: text ? undefined : 'Geen tekst gevonden in PPTX.' };
    }

    if (original.endsWith('.ppt')) {
      const { text } = extractPptLegacy(buffer);
      return {
        text,
        pages: 0,
        slides: 0,
        warning: 'Oud .ppt-formaat heeft beperkte extractie. Converteer naar .pptx voor beste resultaten.'
      };
    }

    if (original.endsWith('.txt') || file.mimetype === 'text/plain') {
      return { text: buffer.toString('utf8').trim(), pages: 0, slides: 0 };
    }

    // unknown: try as utf8 text
    const text = buffer.toString('utf8').trim();
    if (/[\u0000-\u0008]/.test(text)) {
      return { text: '', pages: 0, slides: 0, warning: 'Niet-ondersteund bestandstype.' };
    }
    return { text, pages: 0, slides: 0 };
  } catch (err) {
    return { text: '', pages: 0, slides: 0, warning: 'Fout bij verwerken: ' + err.message };
  }
}

module.exports = { extractText, extractPdf, extractPptx, itemsToText };