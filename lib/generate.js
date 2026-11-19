'use strict';

const NL_STOPWORDS = new Set(
  ('de het een en van in is dat op te met voor niet zijn er aan als door maar om ook bij of uit nog ' +
    'worden wordt kan naar dan deze dit die zich heeft hebben was waren over onder tussen hun hem zij ' +
    'wij je u g ze zich meer meest veel weinig alle elke ander andere tussen tijdens via zonder binnen ' +
    'waar wanneer waarom hoe wie wat welk welke waarmee hier daar nu straks steeds altijd nooit soms ' +
    'doet doen gaat gaan geeft geven maakt maken neemt nemen ziet zien komt komen moet moeten wil willen')
    .split(/\s+/)
    .filter(Boolean)
);

const EN_STOPWORDS = new Set(
  ('the a an and or of in is are was were to for with on at by from as be been being this that these ' +
    'those it its he she they we you i his her their our your my not no can could will would should ' +
    'may might must do does did have has had but if then than so such into over under about which who ' +
    'whom what when where why how all any each other more most some many few')
    .split(/\s+/)
    .filter(Boolean)
);

function isStopword(w) {
  const lw = w.toLowerCase();
  return NL_STOPWORDS.has(lw) || EN_STOPWORDS.has(lw);
}

function splitSentences(text) {
  return text
    .replace(/\r/g, '\n')
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => s.length >= 25 && s.length <= 400);
}

function candidateWords(text) {
  const tokens = text.match(/[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\-]{3,}/g) || [];
  const seen = new Set();
  const out = [];
  for (const t of tokens) {
    const w = t.replace(/^-+|-+$/g, '');
    if (w.length < 5) continue;
    if (isStopword(w)) continue;
    const key = w.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(w);
  }
  return out;
}

function pickTargetWord(sentence, pool) {
  const words = sentence.match(/[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\-]{3,}/g) || [];
  const viable = words.filter((w) => w.length >= 5 && !isStopword(w));
  if (viable.length === 0) return null;
  // prefer longer / capitalized words
  viable.sort((a, b) => {
    const capA = /^[A-ZÀ-Ý]/.test(a) ? 1 : 0;
    const capB = /^[A-ZÀ-Ý]/.test(b) ? 1 : 0;
    if (capA !== capB) return capB - capA;
    return b.length - a.length;
  });
  // avoid picking if it's the only content word (too obvious) - still allow
  const chosen = viable[0];
  return chosen;
}

function blankSentence(sentence, target) {
  // replace whole-word occurrence (case-insensitive)
  const re = new RegExp('\\b' + escapeRegExp(target) + '\\b', 'i');
  return sentence.replace(re, '_______');
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildDistractors(answer, pool, n = 3) {
  const ansLower = answer.toLowerCase();
  const candidates = pool.filter(
    (w) => w.toLowerCase() !== ansLower && Math.abs(w.length - answer.length) <= 8
  );
  const picked = shuffle(candidates).slice(0, n);
  // pad if not enough
  let i = 0;
  while (picked.length < n && i < pool.length) {
    const w = pool[i++];
    if (w.toLowerCase() !== ansLower && !picked.includes(w)) picked.push(w);
  }
  return picked;
}

function makeClosed(sentence, target, pool, id) {
  const answer = target;
  const distractors = buildDistractors(answer, pool, 3);
  if (distractors.length < 3) return null;
  const options = shuffle([answer, ...distractors]);
  return {
    id,
    type: 'closed',
    prompt: blankSentence(sentence, target),
    options,
    answer,
    explanation: sentence
  };
}

function makeOpen(sentence, target, id) {
  return {
    id,
    type: 'open',
    prompt: 'Vul de ontbrekende term in: "' + blankSentence(sentence, target) + '"',
    answer: target,
    keywords: [target.toLowerCase()],
    explanation: sentence
  };
}

/**
 * Generate a list of questions from raw text.
 * @param {string} text
 * @param {{count:number, type:'open'|'closed'|'mixed'}} opts
 */
function generateHeuristic(text, opts) {
  const count = Math.max(1, Math.min(50, opts.count || 5));
  const type = opts.type || 'closed';

  const sentences = splitSentences(text);
  const pool = candidateWords(text);

  const questions = [];
  if (sentences.length === 0 || pool.length === 0) {
    return questions;
  }

  let idx = 0;
  let sIdx = 0;
  const maxLoops = sentences.length * 2;

  while (questions.length < count && idx < maxLoops) {
    const sentence = sentences[sIdx % sentences.length];
    sIdx++;
    idx++;

    const target = pickTargetWord(sentence, pool);
    if (!target) continue;

    let qtype = type;
    if (type === 'mixed') {
      qtype = questions.length % 2 === 0 ? 'closed' : 'open';
    }

    let q = null;
    if (qtype === 'open') {
      q = makeOpen(sentence, target, 'q' + questions.length);
    } else {
      q = makeClosed(sentence, target, pool, 'q' + questions.length);
    }
    if (q) {
      questions.push(q);
    }
  }

  return questions;
}

async function generateOpenAI(text, opts, apiKey, model) {
  const count = Math.max(1, Math.min(30, opts.count || 5));
  const type = opts.type || 'closed';

  const system =
    'Je bent een expert die oefentests maakt voor studenten Audiologie en Logopedie. ' +
    'Maak enkel vragen op basis van de aangeleverde studietekst. Antwoord in het Nederlands.';
  const user =
    `Maak ${count} ${type === 'mixed' ? 'gemengde (open en gesloten)' : type === 'open' ? 'open' : 'gesloten (meerkeuze)'} vragen ` +
    `over de volgende tekst. Geef per vraag: prompt, type ("open" of "closed"), ` +
    `voor gesloten 4 options met het juiste antwoord in "answer", voor open het verwachte antwoord in "answer" ` +
    `en een korte "explanation". Antwoord enkel met geldige JSON in de vorm {"questions":[...]}.\n\n` +
    `TEKST:\n"""\n${text.slice(0, 8000)}\n"""`;

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + apiKey
    },
    body: JSON.stringify({
      model: model || 'gpt-4o-mini',
      temperature: 0.3,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ]
    })
  });

  if (!resp.ok) {
    throw new Error('OpenAI API fout: ' + resp.status);
  }
  const data = await resp.json();
  const content = data.choices[0].message.content;

  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Geen JSON in OpenAI antwoord');
  const parsed = JSON.parse(jsonMatch[0]);
  const questions = Array.isArray(parsed.questions) ? parsed.questions : [];

  return questions.map((q, i) => ({
    id: 'q' + i,
    type: q.type === 'open' ? 'open' : 'closed',
    prompt: q.prompt,
    options: Array.isArray(q.options) ? q.options : undefined,
    answer: q.answer,
    keywords: q.keywords || [String(q.answer).toLowerCase()],
    explanation: q.explanation || ''
  }));
}

/**
 * Public API: tries OpenAI if key present, else heuristic.
 */
async function generateQuestions(text, opts) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (apiKey) {
    try {
      const qs = await generateOpenAI(text, opts, apiKey, process.env.OPENAI_MODEL);
      if (qs.length > 0) return { questions: qs, engine: 'openai' };
    } catch (err) {
      console.warn('[generate] OpenAI mislukt, val terug op heuristiek:', err.message);
    }
  }
  const questions = generateHeuristic(text, opts);
  return { questions, engine: 'heuristic' };
}

module.exports = { generateQuestions, generateHeuristic, splitSentences };