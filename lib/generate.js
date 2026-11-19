'use strict';

const { prepare } = require('./clean');

// ---------------------------------------------------------------------------
// small utilities
// ---------------------------------------------------------------------------

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function clampCount(n, def = 5, max = 30) {
  const v = parseInt(n, 10);
  if (Number.isNaN(v)) return def;
  return Math.max(1, Math.min(max, v));
}

function blankSentence(sentence, target) {
  const re = new RegExp('\\b' + escapeRegExp(target) + '\\b', 'i');
  // only blank the first occurrence
  let done = false;
  return sentence.replace(re, (m) => {
    if (done) return m;
    done = true;
    return '_______';
  });
}

const IGNORE_SUBJECT = new Set([
  'een', 'de', 'het', 'the', 'a', 'an', 'dit', 'dat', 'deze', 'die', 'elk', 'elke',
  'er', 'men', 'des', 'der', 'den', 'hem', 'haar', 'hen', 'ons', 'jullie', 'mijn', 'jouw'
]);

/**
 * For definitional sentences ("<term> is/zijn/betekent ..."), return the term
 * being defined so the cloze tests the key concept instead of a random word.
 */
function definitionalSubject(sentence) {
  const m = sentence.match(/^\s*(.{3,60}?)\s+(is|zijn|betekent|heet|wordt|worden)\s+/i);
  if (!m) return null;
  const words = m[1].match(/[\p{L}][\p{L}\-]{2,}/gu) || [];
  if (!words.length) return null;
  const content = words.filter((w) => !IGNORE_SUBJECT.has(w.toLowerCase()));
  if (!content.length) return null;
  // the head noun is normally the longest content word of the subject
  content.sort((a, b) => b.length - a.length);
  const head = content[0];
  if (head.length < 3) return null;
  return head;
}

function pickTarget(sentence, keyTerms = []) {
  // 1) prefer the defined term in definitional sentences
  const subject = definitionalSubject(sentence);
  if (subject) return subject;

  const words = sentence.match(/[\p{L}][\p{L}\-]{3,}/gu) || [];
  const viable = words.filter((w) => w.length >= 5);
  if (viable.length === 0) return null;

  // 2) otherwise prefer words that belong to the document's topic vocabulary
  const keySet = new Set(keyTerms.map((k) => k.toLowerCase()));
  const topicWords = viable.filter((w) => keySet.has(w.toLowerCase()));
  const candidates = topicWords.length ? topicWords : viable;

  // prefer longer, then capitalized words
  candidates.sort((a, b) => {
    const capA = /^[A-ZÀ-Ý]/.test(a) ? 1 : 0;
    const capB = /^[A-ZÀ-Ý]/.test(b) ? 1 : 0;
    if (capA !== capB) return capB - capA;
    return b.length - a.length;
  });
  // choose among the top few randomly for variety
  const top = candidates.slice(0, Math.min(3, candidates.length));
  return top[Math.floor(Math.random() * top.length)];
}

function buildDistractors(answer, pool, n = 3) {
  const ansLower = answer.toLowerCase();
  const candidates = pool.filter(
    (w) => w.toLowerCase() !== ansLower && Math.abs(w.length - answer.length) <= 9
  );
  const picked = shuffle(candidates).slice(0, n);
  let i = 0;
  while (picked.length < n && i < pool.length) {
    const w = pool[i++];
    if (w.toLowerCase() !== ansLower && !picked.includes(w)) picked.push(w);
  }
  return picked;
}

// ---------------------------------------------------------------------------
// heuristic generator (theory only)
// ---------------------------------------------------------------------------

function makeClosed(sentence, target, pool) {
  const distractors = buildDistractors(target, pool, 3);
  if (distractors.length < 3) return null;
  const blanked = blankSentence(sentence, target);
  const options = shuffle([target, ...distractors]);
  return {
    type: 'closed',
    prompt: blanked,
    options,
    answer: target,
    keywords: [target.toLowerCase()],
    explanation: sentence,
    sourceKey: blanked + '||' + target.toLowerCase()
  };
}

function makeOpen(sentence, target) {
  const blanked = blankSentence(sentence, target);
  return {
    type: 'open',
    prompt: 'Vul de ontbrekende term in: "' + blanked + '"',
    options: undefined,
    answer: target,
    keywords: [target.toLowerCase()],
    explanation: sentence,
    sourceKey: blanked + '||' + target.toLowerCase()
  };
}

function generateHeuristicPrepared(prepared, opts, avoidPrompts = []) {
  const { theory, pool, keyTerms } = prepared;
  const count = clampCount(opts.count);
  const type = opts.type || 'closed';

  const out = [];
  if (!theory.length || !pool.length) return out;

  // Prefer sentences that mention the document's topic vocabulary, so cloze
  // questions stay on-topic instead of filling in an unrelated word.
  const keySet = new Set((keyTerms || []).map((k) => k.toLowerCase()));
  const onTopic = theory.filter((s) =>
    s.split(/\s+/).some((w) => keySet.has(w.toLowerCase()))
  );
  const source = onTopic.length >= count ? onTopic : onTopic.length ? onTopic.concat(theory) : theory;

  const usedKeys = new Set();
  const usedPrompts = new Set(avoidPrompts.map((p) => String(p).trim()));
  let i = Math.floor(Math.random() * source.length);
  let guard = 0;
  const maxGuard = Math.max(20, source.length * 4);

  while (out.length < count && guard < maxGuard) {
    guard++;
    const sentence = source[i % source.length];
    i++;

    const target = pickTarget(sentence, keyTerms);
    if (!target) continue;

    let qt = type;
    if (type === 'mixed') qt = out.length % 2 === 0 ? 'closed' : 'open';

    const q = qt === 'open' ? makeOpen(sentence, target) : makeClosed(sentence, target, pool);
    if (!q) continue;

    if (usedKeys.has(q.sourceKey) || usedPrompts.has(q.prompt.trim())) continue;

    out.push(q);
    usedKeys.add(q.sourceKey);
    usedPrompts.add(q.prompt.trim());
  }

  return out;
}

/**
 * Legacy helper kept for compatibility.
 */
function generateHeuristic(text, opts) {
  const prepared = prepare(text);
  return generateHeuristicPrepared(prepared, opts);
}

// ---------------------------------------------------------------------------
// AI generation (OpenAI + Ollama)
// ---------------------------------------------------------------------------

function resolveProvider(cfg = {}) {
  const p = (cfg.provider || 'auto').toLowerCase();
  if (p === 'heuristic' || p === 'none') return null;
  if (p === 'openai') return cfg.openaiKey ? 'openai' : null;
  if (p === 'ollama') return cfg.ollamaUrl ? 'ollama' : null;
  // auto
  if (cfg.openaiKey) return 'openai';
  if (cfg.ollamaUrl) return 'ollama';
  return null;
}

function chunkText(text, size) {
  const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [text];
  const chunks = [];
  let cur = '';
  for (const s of sentences) {
    if ((cur + s).length > size && cur.length) {
      chunks.push(cur.trim());
      cur = '';
    }
    cur += s + ' ';
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks.length ? chunks : [text];
}

function buildSystemPrompt(type) {
  return (
    'Je bent een expert docent die oefentests maakt voor studenten. ' +
    'De student heeft een studiebestand geüpload over een specifiek onderwerp. ' +
    'BELANGRIJK: maak vragen die gaan over HET ONDERWERP van dat bestand (het thema dat in de bestandsnaam en de tekst staat), ' +
    'niet over willekeurige losse woorden. Gebruik UITSLUITEND de aangeleverde theorie. ' +
    'Negeer slide-titels, paginanummers, kopteksten, voetteksten, inhoudsopgaven, literatuurlijsten en louter opsommingen. ' +
    'Stel vragen die conceptueel begrip van dat onderwerp testen (begrippen, functies, samenhang, oorzaken), ' +
    'geen vragen waarbij je enkel een onbelangrijk woord uit een zin moet invullen. ' +
    'Elke vraag moet uitsluitend uit de theorie te beantwoorden zijn en relevant zijn voor het hoofdonderwerp. ' +
    'Antwoord in het Nederlands. Geef per vraag een korte "explanation" die het antwoord motiveert. ' +
    'vraagtype: ' +
    (type === 'mixed'
      ? 'gemengd open en gesloten'
      : type === 'open'
      ? 'open vragen (bv. "Wat is ...?", "Leg uit waarom ...?") met een beknopt modelantwoord'
      : 'gesloten meerkeuzevragen met 4 plausible opties') +
    '. Geef uitsluitend geldige JSON terug in de vorm: ' +
    '{"questions":[{"type":"open|closed","prompt":"...","options":["A","B","C","D"],"answer":"...","explanation":"..."}]}. ' +
    'Bij open vragen laat je "options" weg en is "answer" het verwachte (korte) antwoord.'
  );
}

function buildUserPrompt(want, type, chunk, fileName) {
  const nameLine = fileName ? `BESTANDSNAAM: "${fileName}"\n` : '';
  return (
    `Bepaal eerst het hoofdonderwerp van het bestand${fileName ? ` "${fileName}"` : ''}. ` +
    `Maak daarna maximaal ${want} ${type === 'mixed' ? 'gemengde' : type === 'open' ? 'open' : 'gesloten (meerkeuze)'} vragen ` +
    `over DAT onderwerp, op basis van deze theorie. Elk antwoord moet uit de theorie af te leiden zijn.\n\n` +
    nameLine +
    `THEORIE:\n"""\n${chunk}\n"""`
  );
}

async function callLLM(provider, system, user, cfg) {
  if (provider === 'openai') {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + cfg.openaiKey
      },
      body: JSON.stringify({
        model: cfg.openaiModel || 'gpt-4o-mini',
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ]
      })
    });
    if (!res.ok) throw new Error('OpenAI API fout ' + res.status + ': ' + (await res.text()).slice(0, 200));
    const data = await res.json();
    return data.choices[0].message.content;
  }

  if (provider === 'ollama') {
    const base = String(cfg.ollamaUrl).replace(/\/+$/, '');
    const res = await fetch(base + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: cfg.ollamaModel || 'llama3.1',
        stream: false,
        format: 'json',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ]
      })
    });
    if (!res.ok) throw new Error('Ollama fout ' + res.status + ': ' + (await res.text()).slice(0, 200));
    const data = await res.json();
    return data.message.content;
  }

  throw new Error('Onbekende AI-provider: ' + provider);
}

function parseQuestions(content, type) {
  if (!content) return [];
  const m = String(content).match(/\{[\s\S]*\}/);
  if (!m) return [];
  let parsed;
  try {
    parsed = JSON.parse(m[0]);
  } catch (e) {
    return [];
  }
  const arr = Array.isArray(parsed.questions)
    ? parsed.questions
    : Array.isArray(parsed)
    ? parsed
    : [];

  const out = [];
  for (const q of arr) {
    if (!q || !q.prompt) continue;
    let qt = q.type === 'open' ? 'open' : 'closed';
    if (type !== 'mixed') qt = type;

    let answer = q.answer != null ? String(q.answer).trim() : '';
    let options = Array.isArray(q.options) ? q.options.map((o) => String(o).trim()).filter(Boolean) : undefined;

    if (qt === 'closed') {
      if (!answer || !options || options.length < 2) continue;
      if (!options.some((o) => o.toLowerCase() === answer.toLowerCase())) {
        options = options.slice(0, 3);
        options.push(answer);
      }
      // dedupe
      options = [...new Set(options)];
      if (options.length < 2) continue;
    } else if (!answer) {
      continue;
    }

    out.push({
      type: qt,
      prompt: String(q.prompt).trim(),
      options: qt === 'closed' ? options : undefined,
      answer,
      keywords: Array.isArray(q.keywords) && q.keywords.length ? q.keywords.map(String) : [answer.toLowerCase()],
      explanation: String(q.explanation || '').trim()
    });
  }
  return out;
}

async function generateAI(prepared, opts, cfg) {
  const count = clampCount(opts.count);
  const type = opts.type || 'closed';
  const provider = resolveProvider(cfg);
  if (!provider) return [];

  const chunks = chunkText(prepared.clean, 6000);
  const all = [];
  let remaining = count;

  for (const chunk of chunks) {
    if (remaining <= 0) break;
    const want = Math.min(remaining, 8);
    const system = buildSystemPrompt(type);
    const user = buildUserPrompt(want, type, chunk, opts.fileName);
    const content = await callLLM(provider, system, user, cfg);
    const qs = parseQuestions(content, type);
    all.push(...qs);
    remaining = count - all.length;
  }

  return all.slice(0, count);
}

// ---------------------------------------------------------------------------
// public API
// ---------------------------------------------------------------------------

/**
 * @param {string} rawText
 * @param {{count:number, type:'open'|'closed'|'mixed'}} opts
 * @param {{provider?:string, openaiKey?:string, openaiModel?:string, ollamaUrl?:string, ollamaModel?:string}} cfg
 * @returns {Promise<{questions:Array, engine:string, stats:object}>}
 */
async function generateQuestions(rawText, opts = {}, cfg = {}) {
  const prepared = prepare(rawText);
  const count = clampCount(opts.count);
  const provider = resolveProvider(cfg);

  const stats = {
    totalChars: prepared.clean.length,
    theorySentences: prepared.theory.length,
    allSentences: prepared.sentences.length
  };

  let questions = [];
  let engine = 'heuristic';
  let aiCount = 0;

  if (provider) {
    try {
      questions = await generateAI(prepared, opts, cfg);
      aiCount = questions.length;
      if (aiCount > 0) engine = provider;
    } catch (err) {
      console.warn('[generate] AI mislukt (' + err.message + '), val terug op heuristiek.');
    }
  }

  // top-up with heuristic so the requested amount is reached
  if (questions.length < count) {
    const avoid = questions.map((q) => q.prompt);
    const extra = generateHeuristicPrepared(
      prepared,
      { count: count - questions.length, type: opts.type || 'closed' },
      avoid
    );
    questions = questions.concat(extra);
  }

  questions = questions
    .filter((q) => q && q.prompt && (q.type === 'open' ? q.answer : q.options && q.options.length >= 2))
    .slice(0, count)
    .map((q, i) => {
      const { sourceKey, ...rest } = q;
      return { id: 'q' + i, ...rest };
    });

  stats.questions = questions.length;
  stats.aiQuestions = aiCount;

  return { questions, engine, stats };
}

module.exports = {
  generateQuestions,
  generateHeuristic,
  resolveProvider
};