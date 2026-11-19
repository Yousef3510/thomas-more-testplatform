'use strict';

const path = require('path');
const AdmZip = require('adm-zip');

/**
 * Extract raw text from a PDF buffer using pdfjs-dist (modern, maintained).
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

  const out = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    let line = '';
    for (const item of content.items) {
      if (typeof item.str !== 'string') continue;
      line += item.str;
      if (item.hasEOL) {
        out.push(line);
        line = '';
      } else {
        line += ' ';
      }
    }
    if (line.trim()) out.push(line);
    out.push('');
  }

  return out.join('\n').replace(/[ \t]+\n/g, '\n').trim();
}

/**
 * Extract text from a .pptx buffer (zip of XML slides).
 */
function extractPptx(buffer) {
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries();

  const slideEntries = entries
    .filter((e) => /^ppt\/slides\/slide\d+\.xml$/i.test(e.entryName))
    .sort((a, b) => {
      const na = parseInt(a.entryName.match(/(\d+)/)[1], 10);
      const nb = parseInt(b.entryName.match(/(\d+)/)[1], 10);
      return na - nb;
    });

  const texts = [];
  for (const entry of slideEntries) {
    const xml = entry.getData().toString('utf8');
    // grab text inside <a:t>...</a:t> runs
    const runs = [];
    const re = /<a:t>([\s\S]*?)<\/a:t>/gi;
    let m;
    while ((m = re.exec(xml)) !== null) {
      runs.push(decodeXml(m[1]));
    }
    if (runs.length) {
      texts.push(runs.join(' '));
    }
  }

  // also try notes
  const notes = entries
    .filter((e) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/i.test(e.entryName))
    .sort((a, b) => {
      const na = parseInt(a.entryName.match(/(\d+)/)[1], 10);
      const nb = parseInt(b.entryName.match(/(\d+)/)[1], 10);
      return na - nb;
    });
  for (const entry of notes) {
    const xml = entry.getData().toString('utf8');
    const runs = [];
    const re = /<a:t>([\s\S]*?)<\/a:t>/gi;
    let m;
    while ((m = re.exec(xml)) !== null) {
      runs.push(decodeXml(m[1]));
    }
    if (runs.length) {
      texts.push(runs.join(' '));
    }
  }

  return texts.join('\n').trim();
}

/**
 * Legacy .ppt (binary) fallback: best-effort ASCII extraction.
 */
function extractPptLegacy(buffer) {
  const s = buffer.toString('latin1');
  // keep readable words
  const matches = s.match(/[A-Za-zÀ-ÿ0-9 ,.;:()\-]{4,}/g) || [];
  return matches.join(' ').replace(/\s+/g, ' ').trim();
}

function decodeXml(str) {
  return str
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ');
}

/**
 * Main entry: dispatch by file extension / mimetype.
 * @returns {Promise<{text: string, warning?: string}>}
 */
async function extractText(file) {
  const original = (file.originalname || '').toLowerCase();
  const buffer = file.buffer;

  if (!buffer || buffer.length === 0) {
    return { text: '', warning: 'Leeg bestand.' };
  }

  try {
    if (original.endsWith('.pdf') || file.mimetype === 'application/pdf') {
      const text = await extractPdf(buffer);
      return { text, warning: text ? undefined : 'Geen tekst gevonden in PDF (mogelijk gescand).' };
    }

    if (original.endsWith('.pptx')) {
      const text = extractPptx(buffer);
      return { text, warning: text ? undefined : 'Geen tekst gevonden in PPTX.' };
    }

    if (original.endsWith('.ppt')) {
      const text = extractPptLegacy(buffer);
      return {
        text,
        warning:
          'Oud .ppt-formaat heeft beperkte extractie. Converteer naar .pptx voor beste resultaten.'
      };
    }

    if (original.endsWith('.txt') || file.mimetype === 'text/plain') {
      return { text: buffer.toString('utf8').trim() };
    }

    // unknown: try as utf8 text
    const text = buffer.toString('utf8').trim();
    if (/[\u0000-\u0008]/.test(text)) {
      return { text: '', warning: 'Niet-ondersteund bestandstype.' };
    }
    return { text };
  } catch (err) {
    return { text: '', warning: 'Fout bij verwerken: ' + err.message };
  }
}

module.exports = { extractText };