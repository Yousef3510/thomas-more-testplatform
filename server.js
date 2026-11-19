'use strict';

const path = require('path');
const express = require('express');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

const db = require('./lib/db');
const { extractText } = require('./lib/parse');
const { generateQuestions } = require('./lib/generate');
const { gradeAttempt } = require('./lib/grade');
const { parseQA } = require('./lib/qa');

// lightweight .env loader (no dependency)
(function loadEnv() {
  try {
    const fs = require('fs');
    const envPath = path.join(__dirname, '.env');
    if (fs.existsSync(envPath)) {
      for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
        if (m) process.env[m[1]] = m[2];
      }
    }
  } catch (e) {
    /* ignore */
  }
})();

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const TOKEN_TTL = '7d';

// AI configuration (OpenAI and/or a local Ollama server).
// AI_PROVIDER: 'auto' | 'openai' | 'ollama' | 'heuristic'
const AI_CFG = {
  provider: process.env.AI_PROVIDER || 'auto',
  openaiKey: process.env.OPENAI_API_KEY || '',
  openaiModel: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  ollamaUrl: process.env.OLLAMA_URL || '',
  ollamaModel: process.env.OLLAMA_MODEL || 'llama3.1'
};

const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 } // 25 MB
});

// ---------- helpers ----------

function signToken(user) {
  return jwt.sign({ id: user.id, name: user.name, email: user.email }, JWT_SECRET, {
    expiresIn: TOKEN_TTL
  });
}

function publicUser(u) {
  return { id: u.id, name: u.name, email: u.email };
}

function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Niet ingelogd' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const store = db.read();
    const user = store.users.find((u) => u.id === payload.id);
    if (!user) return res.status(401).json({ error: 'Gebruiker niet gevonden' });
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Ongeldige of verlopen sessie' });
  }
}

function findSubject(store, id) {
  return store.subjects.find((s) => s.id === id);
}

// Strip answer keys before sending a test to the client.
function stripAnswersForClient(test) {
  return {
    id: test.id,
    subjectId: test.subjectId,
    title: test.title,
    fileName: test.fileName,
    createdAt: test.createdAt,
    engine: test.engine,
    timeLimit: test.timeLimit,
    tips: test.tips,
    type: test.type,
    pages: test.pages || 0,
    slides: test.slides || 0,
    stats: test.stats || null,
    questions: test.questions.map((q) => {
      const base = {
        id: q.id,
        type: q.type,
        prompt: q.prompt,
        options: q.options
        // answer / keywords / explanation withheld until grading
      };
      if (test.tips) {
        const ans = String(q.answer || '');
        if (ans.length) {
          base.tip = `Hint: het antwoord telt ${ans.length} letters en begint met "${ans[0].toUpperCase()}".`;
        }
      }
      return base;
    })
  };
}

// ---------- Auth routes ----------

app.post('/api/register', (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Naam, e-mail en wachtwoord zijn verplicht' });
  }
  if (String(password).length < 6) {
    return res.status(400).json({ error: 'Wachtwoord moet minstens 6 tekens zijn' });
  }
  const store = db.read();
  const emailLower = String(email).toLowerCase().trim();
  if (store.users.some((u) => u.email === emailLower)) {
    return res.status(409).json({ error: 'Dit e-mailadres is al geregistreerd' });
  }
  const hash = bcrypt.hashSync(String(password), 10);
  const user = { id: uuidv4(), name: String(name).trim(), email: emailLower, password: hash, createdAt: Date.now() };
  db.mutate((d) => {
    d.users.push(user);
  });
  return res.json({ token: signToken(user), user: publicUser(user) });
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'E-mail en wachtwoord zijn verplicht' });
  }
  const store = db.read();
  const user = store.users.find((u) => u.email === String(email).toLowerCase().trim());
  if (!user || !bcrypt.compareSync(String(password), user.password)) {
    return res.status(401).json({ error: 'Onjuiste e-mail of wachtwoord' });
  }
  return res.json({ token: signToken(user), user: publicUser(user) });
});

app.get('/api/me', auth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

// ---------- Subjects ----------

app.get('/api/subjects', (req, res) => {
  const store = db.read();
  res.json({ subjects: store.subjects });
});

// ---------- Config (AI availability) ----------

app.get('/api/config', (req, res) => {
  const provider = require('./lib/generate').resolveProvider(AI_CFG);
  res.json({
    ai: provider || 'heuristic',
    aiLabel:
      provider === 'openai'
        ? 'AI (OpenAI)'
        : provider === 'ollama'
        ? 'AI (Ollama lokaal)'
        : 'Automatisch (zonder AI)'
  });
});

// ---------- Results / dashboard ----------

app.get('/api/dashboard', auth, (req, res) => {
  const store = db.read();
  const subjects = store.subjects;
  const userResults = store.results.filter((r) => r.userId === req.user.id);

  // per subject aggregate
  const perSubject = subjects.map((s) => {
    const rs = userResults.filter((r) => r.subjectId === s.id);
    const scores = rs.map((r) => r.score);
    const best = scores.length ? Math.max(...scores) : null;
    const avg = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
    return {
      ...s,
      attempts: rs.length,
      bestScore: best,
      avgScore: avg,
      lastScore: rs.length ? rs[rs.length - 1].score : null
    };
  });

  // recent results
  const recent = userResults
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 20)
    .map((r) => ({
      id: r.id,
      subjectId: r.subjectId,
      subjectName: (findSubject(store, r.subjectId) || {}).name || r.subjectId,
      title: r.title,
      score: r.score,
      correct: r.correct,
      total: r.total,
      createdAt: r.createdAt
    }));

  const overallScores = userResults.map((r) => r.score);
  const overall = overallScores.length
    ? Math.round(overallScores.reduce((a, b) => a + b, 0) / overallScores.length)
    : null;

  res.json({
    subjects: perSubject,
    recent,
    stats: {
      totalAttempts: userResults.length,
      overallAvg: overall,
      bestOverall: overallScores.length ? Math.max(...overallScores) : null
    }
  });
});

// ---------- Upload + generate test ----------

app.post('/api/tests', auth, upload.single('file'), async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'Geen bestand ontvangen' });

  const subjectId = req.body.subjectId;
  const store0 = db.read();
  const subject = findSubject(store0, subjectId);
  if (!subject) return res.status(400).json({ error: 'Onbekend vak' });

  const count = parseInt(req.body.count, 10) || 5;
  const type = ['open', 'closed', 'mixed'].includes(req.body.type) ? req.body.type : 'closed';
  const tips = req.body.tips === 'true' || req.body.tips === true;
  const timeLimit = Math.max(0, parseInt(req.body.timeLimit, 10) || 0); // minutes, 0 = geen

  const qaImport = req.body.qaImport === 'true' || req.body.qaImport === true;

  const { text, warning, pages, slides } = await extractText(file);
  if (!text) {
    return res.status(400).json({
      error:
        warning ||
        'Geen tekst gevonden in het bestand. (Bij gescande PDF\'s is de tekst een afbeelding — gebruik een tekst-PDF of een PowerPoint.)'
    });
  }

  let questions = [];
  let engine = 'heuristic';
  let stats = null;

  if (qaImport) {
    const qa = parseQA(text);
    if (qa.length === 0) {
      return res.status(400).json({
        error:
          'Geen vraag/antwoord-paren gevonden. Gebruik een van deze formaten: ' +
          'JSON [{"question":"...","answer":"..."}], CSV "question,answer" of tekst met "Vraag: ..." / "Antwoord: ...".'
      });
    }
    questions = qa.slice(0, count).map((q, i) => ({ id: 'q' + i, ...q }));
    engine = 'import';
    stats = { totalChars: text.length, theorySentences: 0, allSentences: 0, questions: questions.length, aiQuestions: 0 };
  } else {
    if (text.length < 40) {
      return res.status(400).json({
        error:
          warning ||
          'Te weinig tekst gevonden in het bestand om een test te maken. (Bij gescande PDF\'s is de tekst een afbeelding — gebruik een tekst-PDF of een PowerPoint.)'
      });
    }
    const opts = { count, type, fileName: file.originalname };
    try {
      const generated = await generateQuestions(text, opts, AI_CFG);
      questions = generated.questions;
      engine = generated.engine;
      stats = generated.stats;
    } catch (err) {
      return res.status(500).json({ error: 'Kon geen vragen genereren: ' + err.message });
    }
  }

  if (questions.length === 0) {
    return res.status(400).json({
      error:
        'Kon geen vragen genereren uit deze tekst. Het bestand lijkt vooral titels/opslommingen te bevatten. Probeer een bestand met volledige theorie-zinnen.'
    });
  }

  const testId = uuidv4();
  const test = {
    id: testId,
    userId: req.user.id,
    subjectId,
    title: subject.name + ' - ' + file.originalname.replace(/\.[^.]+$/, ''),
    fileName: file.originalname,
    engine: engine,
    type,
    tips,
    timeLimit,
    pages: pages || 0,
    slides: slides || 0,
    stats: stats,
    createdAt: Date.now(),
    questions
  };

  db.mutate((d) => {
    d.tests.push(test);
    d.documents.push({
      id: uuidv4(),
      userId: req.user.id,
      testId,
      subjectId,
      fileName: file.originalname,
      size: file.size,
      createdAt: Date.now()
    });
  });

  return res.json({
    testId,
    warning,
    engine: engine,
    count: questions.length,
    pages: pages || 0,
    slides: slides || 0,
    stats: stats,
    test: stripAnswersForClient(test)
  });
});

// ---------- Retrieve a test (without answers) ----------

app.get('/api/tests/:id', auth, (req, res) => {
  const store = db.read();
  const test = store.tests.find((t) => t.id === req.params.id && t.userId === req.user.id);
  if (!test) return res.status(404).json({ error: 'Test niet gevonden' });
  res.json({ test: stripAnswersForClient(test) });
});

// ---------- Grade an attempt ----------

app.post('/api/tests/:id/grade', auth, (req, res) => {
  const store = db.read();
  const test = store.tests.find((t) => t.id === req.params.id && t.userId === req.user.id);
  if (!test) return res.status(404).json({ error: 'Test niet gevonden' });

  const answers = (req.body && req.body.answers) || {};
  const graded = gradeAttempt(test.questions, answers);

  const result = {
    id: uuidv4(),
    userId: req.user.id,
    testId: test.id,
    subjectId: test.subjectId,
    title: test.title,
    score: graded.score,
    correct: graded.correct,
    total: graded.total,
    timeTakenSeconds: req.body.timeTakenSeconds || null,
    createdAt: Date.now(),
    details: graded.details
  };

  db.mutate((d) => {
    d.results.push(result);
  });

  res.json({
    resultId: result.id,
    score: graded.score,
    correct: graded.correct,
    total: graded.total,
    details: graded.details
  });
});

// ---------- History for a subject ----------

app.get('/api/results', auth, (req, res) => {
  const store = db.read();
  const results = store.results
    .filter((r) => r.userId === req.user.id)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((r) => ({
      id: r.id,
      subjectId: r.subjectId,
      subjectName: (findSubject(store, r.subjectId) || {}).name || r.subjectId,
      title: r.title,
      score: r.score,
      correct: r.correct,
      total: r.total,
      createdAt: r.createdAt
    }));
  res.json({ results });
});

// ---------- static SPA fallback ----------

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'Bestand te groot (max 25 MB)' });
    }
    return res.status(400).json({ error: err.message });
  }
  console.error(err);
  res.status(500).json({ error: 'Interne serverfout' });
});

app.listen(PORT, () => {
  console.log(`\n  🎓 Thomas More Testplatform draait op http://localhost:${PORT}\n`);
});