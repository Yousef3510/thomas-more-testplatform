'use strict';

// ---------------- state ----------------
const state = {
  token: localStorage.getItem('tm_token') || null,
  user: null,
  subjects: [],
  dash: null,
  test: null,
  result: null,
  config: { ai: 'heuristic', aiLabel: 'Automatisch (zonder AI)' }
};

const app = document.getElementById('app');
const toastEl = document.getElementById('toast');
let toastTimer = null;

// ---------------- helpers ----------------
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function toast(msg, type) {
  toastEl.textContent = msg;
  toastEl.className = 'toast ' + (type || '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.className = 'toast hidden';
  }, 3200);
}

function initials(name) {
  return (name || '?')
    .split(/\s+/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function fmtDate(ts) {
  try {
    return new Date(ts).toLocaleString('nl-BE', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch (e) {
    return '';
  }
}

function scoreClass(score) {
  if (score >= 70) return 'good';
  if (score >= 50) return 'mid';
  return 'bad';
}

async function api(path, { method = 'GET', body = null } = {}) {
  const headers = {};
  if (state.token) headers['Authorization'] = 'Bearer ' + state.token;
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  let payload = body;
  if (body && !isForm) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch('/api' + path, { method, headers, body: payload });
  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    /* ignore */
  }
  if (!res.ok) {
    const err = new Error((data && data.error) || 'Fout ' + res.status);
    err.status = res.status;
    throw err;
  }
  return data;
}

function logout() {
  state.token = null;
  state.user = null;
  localStorage.removeItem('tm_token');
  renderAuth();
}

// ---------------- Auth view ----------------
function renderAuth() {
  app.innerHTML = `
    <div class="auth-wrap">
      <div class="auth-card">
        <div class="brand">
          <div class="logo">TM</div>
          <div>
            <h1>Thomas More</h1>
            <p>Testplatform Audiologie &amp; Logopedie</p>
          </div>
        </div>
        <div class="tabs">
          <button id="tabLogin" class="active">Inloggen</button>
          <button id="tabRegister">Registreren</button>
        </div>
        <form id="authForm">
          <div class="field hidden" id="nameField">
            <label for="name">Naam</label>
            <input id="name" type="text" autocomplete="name" placeholder="Voor- en achternaam" />
          </div>
          <div class="field">
            <label for="email">E-mail</label>
            <input id="email" type="email" autocomplete="email" placeholder="jij@student.thomasmore.be" required />
          </div>
          <div class="field">
            <label for="password">Wachtwoord</label>
            <input id="password" type="password" autocomplete="current-password" placeholder="Min. 6 tekens" required />
          </div>
          <button type="submit" class="btn btn-primary" id="authSubmit">Inloggen</button>
        </form>
      </div>
    </div>`;

  let mode = 'login';
  const tabLogin = document.getElementById('tabLogin');
  const tabRegister = document.getElementById('tabRegister');
  const nameField = document.getElementById('nameField');
  const nameInput = document.getElementById('name');
  const submit = document.getElementById('authSubmit');

  function setMode(m) {
    mode = m;
    tabLogin.classList.toggle('active', m === 'login');
    tabRegister.classList.toggle('active', m === 'register');
    nameField.classList.toggle('hidden', m !== 'register');
    nameInput.required = m === 'register';
    submit.textContent = m === 'login' ? 'Inloggen' : 'Account aanmaken';
  }

  tabLogin.addEventListener('click', () => setMode('login'));
  tabRegister.addEventListener('click', () => setMode('register'));

  document.getElementById('authForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    submit.disabled = true;
    submit.textContent = 'Even geduld...';
    try {
      const email = document.getElementById('email').value.trim();
      const password = document.getElementById('password').value;
      const body = { email, password };
      if (mode === 'register') body.name = nameInput.value.trim();
      const data = await api(mode === 'login' ? '/login' : '/register', {
        method: 'POST',
        body
      });
      state.token = data.token;
      state.user = data.user;
      localStorage.setItem('tm_token', data.token);
      await boot();
    } catch (err) {
      toast(err.message, 'error');
      submit.disabled = false;
      submit.textContent = mode === 'login' ? 'Inloggen' : 'Account aanmaken';
    }
  });
}

// ---------------- boot ----------------
async function boot() {
  try {
    const me = await api('/me');
    state.user = me.user;
    const subs = await api('/subjects');
    state.subjects = subs.subjects;
    try {
      const cfg = await api('/config');
      if (cfg && cfg.aiLabel) state.config = cfg;
    } catch (e) {
      /* ignore */
    }
    await loadDashboard();
    renderDashboard();
  } catch (err) {
    if (err.status === 401) {
      logout();
    } else {
      toast(err.message, 'error');
    }
  }
}

async function loadDashboard() {
  const data = await api('/dashboard');
  state.dash = data;
}

// ---------------- Dashboard ----------------
function subjectCard(s) {
  const hasScore = s.bestScore != null;
  const ring = hasScore
    ? `<div class="score-ring" style="--pct:${s.bestScore}"><span>${s.bestScore}%</span></div>`
    : `<div class="score-ring" style="--pct:0"><span class="empty">—</span></div>`;

  return `
    <div class="subject-card" style="--subject-color:${esc(s.color)}">
      <div class="title"><span class="dot"></span><h3>${esc(s.name)}</h3></div>
      ${ring}
      <div class="subject-meta">
        <span>${s.attempts} ${s.attempts === 1 ? 'poging' : 'pogingen'}</span>
        <span>${s.avgScore != null ? 'gem. ' + s.avgScore + '%' : 'nog geen score'}</span>
      </div>
      <div class="bar"><div style="width:${s.avgScore || 0}%"></div></div>
      <div class="subject-actions">
        <button class="btn btn-outline" data-history="${esc(s.id)}">Resultaten</button>
        <button class="btn btn-primary" data-newtest="${esc(s.id)}" style="width:auto">+ Test</button>
      </div>
    </div>`;
}

function renderDashboard() {
  const d = state.dash;
  const stats = d.stats;

  const recentRows = d.recent.length
    ? d.recent
        .map(
          (r) => `
        <div class="table-row">
          <div>${esc(r.title)}<div class="muted" style="font-size:12px">${esc(r.subjectName)}</div></div>
          <div>${r.correct}/${r.total} juist</div>
          <div><span class="pill ${scoreClass(r.score)}">${r.score}%</span></div>
          <div class="muted">${fmtDate(r.createdAt)}</div>
        </div>`
        )
        .join('')
    : `<div class="empty-state">Nog geen resultaten. Dien je eerste bestand in om een test te maken!</div>`;

  app.innerHTML = `
    <div class="shell">
      <header class="topbar">
        <div class="brand">
          <div class="logo">TM</div>
          <div>
            <h1>Thomas More</h1>
            <p>Testplatform Audiologie &amp; Logopedie</p>
          </div>
        </div>
        <div class="spacer"></div>
        <div class="user-chip">
          <div class="avatar">${esc(initials(state.user.name))}</div>
          <span>${esc(state.user.name)}</span>
        </div>
        <button class="btn btn-outline" id="logoutBtn" style="width:auto">Uitloggen</button>
      </header>

      <main class="container">
        <div class="page-head">
          <div>
            <h2>Dashboard</h2>
            <p>Welkom terug! Kies een vak of dien een nieuw bestand in om automatisch een oefentest te maken.</p>
          </div>
          <button class="btn btn-primary" id="newTestBtn" style="width:auto">+ Nieuwe test</button>
        </div>

        <div class="stat-row">
          <div class="stat"><div class="label">Pogingen</div><div class="value">${stats.totalAttempts}</div></div>
          <div class="stat"><div class="label">Gemiddelde score</div><div class="value">${stats.overallAvg != null ? stats.overallAvg + '%' : '—'}</div></div>
          <div class="stat"><div class="label">Beste score</div><div class="value">${stats.bestOverall != null ? stats.bestOverall + '%' : '—'}</div></div>
        </div>

        <div class="grid-subjects">
          ${state.subjects.map(subjectCard).join('')}
        </div>

        <div class="recent">
          <div class="page-head" style="margin-bottom:14px">
            <div><h2 style="font-size:18px">Recente resultaten</h2></div>
          </div>
          <div class="table">
            <div class="table-row head">
              <div>Test</div><div>Score</div><div>%</div><div>Datum</div>
            </div>
            ${recentRows}
          </div>
        </div>
      </main>
    </div>`;

  document.getElementById('logoutBtn').addEventListener('click', logout);
  document.getElementById('newTestBtn').addEventListener('click', () => openUpload(null));
  document.querySelectorAll('[data-newtest]').forEach((b) =>
    b.addEventListener('click', () => openUpload(b.getAttribute('data-newtest')))
  );
  document.querySelectorAll('[data-history]').forEach((b) =>
    b.addEventListener('click', () => openHistory(b.getAttribute('data-history')))
  );
}

// ---------------- Upload modal ----------------
function openUpload(subjectId) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal">
      <h2>Nieuwe oefentest</h2>
      <p class="sub">Dien een PDF of PowerPoint in. Het hele bestand wordt gelezen en enkel de theorie wordt bevraagd.</p>
      <p class="sub" style="margin-top:-10px">🤖 Modus: ${esc(state.config.aiLabel)}</p>

      <label class="dropzone" id="dropzone">
        <div class="big">Klik of sleep je bestand hier</div>
        <div class="small">PDF, PPTX, PPT, TXT, CSV of JSON — max 25 MB</div>
        <div id="fileBadge"></div>
        <input type="file" id="fileInput" accept=".pdf,.ppt,.pptx,.txt,.csv,.json" class="hidden" />
      </label>

      <div class="switch-row" style="padding-top:0">
        <div>
          <div style="font-weight:700">Bestand bevat al vragen &amp; antwoorden</div>
          <div class="muted" style="font-size:12px">Zelf een Q&amp;A-bestand aanleveren i.p.v. automatisch genereren</div>
        </div>
        <label class="switch"><input type="checkbox" id="mQA" /><span class="slider"></span></label>
      </div>
      <p class="muted hidden" id="qaHint" style="font-size:12px;margin:-6px 0 16px;line-height:1.45">
        Formaten: JSON <code>[{"question":"...","answer":"..."}]</code>, CSV <code>question,answer</code> of tekst met
        <code>Vraag: ...</code> / <code>Antwoord: ...</code>. Meerkeuze: voeg <code>optie:</code>-regels of extra CSV-kolommen toe.
      </p>

      <div class="form-grid">
        <div class="field">
          <label for="mSubject">Vak</label>
          <select id="mSubject">
            ${state.subjects.map((s) => `<option value="${esc(s.id)}" ${s.id === subjectId ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label for="mCount">Aantal vragen</label>
          <input type="number" id="mCount" min="1" max="30" value="5" />
        </div>
        <div class="field" id="typeField">
          <label for="mType">Type vragen</label>
          <select id="mType">
            <option value="closed">Gesloten (meerkeuze)</option>
            <option value="open">Open</option>
            <option value="mixed">Gemengd</option>
          </select>
        </div>
        <div class="field">
          <label for="mTime">Tijdslimiet (minuten, 0 = geen)</label>
          <input type="number" id="mTime" min="0" max="180" value="0" />
        </div>
      </div>

      <div class="switch-row">
        <div>
          <div style="font-weight:700">Tips tonen</div>
          <div class="muted" style="font-size:12px">Toon een hint (lengte + eerste letter) tijdens de test</div>
        </div>
        <label class="switch"><input type="checkbox" id="mTips" /><span class="slider"></span></label>
      </div>

      <div style="display:flex;gap:10px;margin-top:18px">
        <button class="btn btn-outline" id="mCancel" style="flex:0 0 auto">Annuleren</button>
        <button class="btn btn-primary" id="mSubmit" style="flex:1">Genereer test</button>
      </div>
    </div>`;
  document.body.appendChild(backdrop);

  let file = null;
  const fileInput = document.getElementById('fileInput');
  const badge = document.getElementById('fileBadge');
  const dz = document.getElementById('dropzone');
  const mQA = document.getElementById('mQA');
  const qaHint = document.getElementById('qaHint');
  const typeField = document.getElementById('typeField');

  function syncQA() {
    const on = mQA.checked;
    qaHint.classList.toggle('hidden', !on);
    typeField.classList.toggle('hidden', on);
  }
  mQA.addEventListener('change', syncQA);
  syncQA();

  function setFile(f) {
    file = f;
    if (f) {
      badge.innerHTML = `<span class="file-badge">${esc(f.name)}</span>`;
    } else {
      badge.innerHTML = '';
    }
  }

  fileInput.addEventListener('change', () => setFile(fileInput.files[0]));
  ['dragenter', 'dragover'].forEach((ev) =>
    dz.addEventListener(ev, (e) => {
      e.preventDefault();
      dz.classList.add('drag');
    })
  );
  ['dragleave', 'drop'].forEach((ev) =>
    dz.addEventListener(ev, (e) => {
      e.preventDefault();
      dz.classList.remove('drag');
    })
  );
  dz.addEventListener('drop', (e) => {
    if (e.dataTransfer.files.length) setFile(e.dataTransfer.files[0]);
  });

  function close() {
    backdrop.remove();
  }
  document.getElementById('mCancel').addEventListener('click', close);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });

  document.getElementById('mSubmit').addEventListener('click', async () => {
    if (!file) {
      toast('Selecteer eerst een bestand', 'error');
      return;
    }
    const btn = document.getElementById('mSubmit');
    btn.disabled = true;
    btn.textContent = 'Test genereren...';
    const fd = new FormData();
    fd.append('file', file);
    fd.append('subjectId', document.getElementById('mSubject').value);
    fd.append('count', document.getElementById('mCount').value);
    fd.append('type', document.getElementById('mType').value);
    fd.append('tips', document.getElementById('mTips').checked);
    fd.append('timeLimit', document.getElementById('mTime').value);
    fd.append('qaImport', mQA.checked);

    try {
      const data = await api('/tests', { method: 'POST', body: fd });
      if (data.warning) toast(data.warning, '');
      close();
      state.test = data.test;
      state.test.engine = data.engine;
      state.test.pages = data.pages || 0;
      state.test.slides = data.slides || 0;
      state.test.stats = data.stats || null;
      const readMsg =
        data.pages > 0
          ? `Test klaar: ${data.count} vragen uit ${data.pages} pagina's.`
          : data.slides > 0
          ? `Test klaar: ${data.count} vragen uit ${data.slides} slides.`
          : `Test klaar: ${data.count} vragen.`;
      if (!data.warning) toast(readMsg, 'success');
      renderTest();
    } catch (err) {
      toast(err.message, 'error');
      btn.disabled = false;
      btn.textContent = 'Genereer test';
    }
  });
}

// ---------------- History modal ----------------
async function openHistory(subjectId) {
  try {
    const data = await api('/results');
    const rows = data.results.filter((r) => r.subjectId === subjectId);
    const subject = state.subjects.find((s) => s.id === subjectId);
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    const body = rows.length
      ? rows
          .map(
            (r) => `
        <div class="table-row" style="grid-template-columns:1fr 90px 130px">
          <div>${esc(r.title)}<div class="muted" style="font-size:12px">${r.correct}/${r.total} juist</div></div>
          <div><span class="pill ${scoreClass(r.score)}">${r.score}%</span></div>
          <div class="muted">${fmtDate(r.createdAt)}</div>
        </div>`
          )
          .join('')
      : `<div class="empty-state">Nog geen resultaten voor ${esc(subject ? subject.name : 'dit vak')}.</div>`;

    backdrop.innerHTML = `
      <div class="modal">
        <h2>${esc(subject ? subject.name : 'Resultaten')}</h2>
        <p class="sub">Alle afgewerkte tests voor dit vak.</p>
        <div class="table">${body}</div>
        <div style="margin-top:18px;text-align:right">
          <button class="btn btn-outline" id="hClose" style="width:auto">Sluiten</button>
        </div>
      </div>`;
    document.body.appendChild(backdrop);
    document.getElementById('hClose').addEventListener('click', () => backdrop.remove());
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) backdrop.remove();
    });
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ---------------- Test view ----------------
let timerHandle = null;
let startTime = null;

function renderTest() {
  const test = state.test;
  startTime = Date.now();
  if (timerHandle) clearInterval(timerHandle);

  const totalSec = (test.timeLimit || 0) * 60;
  const engineLabel =
    test.engine === 'openai'
      ? 'AI-gegenereerd (OpenAI)'
      : test.engine === 'ollama'
      ? 'AI-gegenereerd (lokaal)'
      : test.engine === 'import'
      ? 'Zelf aangeleverd (Q&A)'
      : 'Automatisch gegenereerd';
  const readLabel =
    test.pages > 0
      ? `${test.pages} pagina's`
      : test.slides > 0
      ? `${test.slides} slides`
      : 'hele bestand';

  app.innerHTML = `
    <div class="shell">
      <header class="topbar">
        <div class="brand">
          <div class="logo">TM</div>
          <div><h1>${esc(test.title)}</h1><p>${esc(engineLabel)} · ${test.questions.length} vragen · ${esc(readLabel)} gelezen</p></div>
        </div>
      </header>
      <main class="test-wrap">
        <div class="test-head">
          <div class="muted">${totalSec > 0 ? '⏱ Je hebt een tijdslimiet' : 'Geen tijdslimiet'}</div>
          ${totalSec > 0 ? `<div class="timer" id="timer">${fmtTime(totalSec)}</div>` : ''}
        </div>
        <div class="progress-track"><div id="progress" style="width:0%"></div></div>

        <form id="testForm">
          ${test.questions.map((q, i) => renderQuestion(q, i)).join('')}
          <div class="test-footer">
            <div class="muted" id="answeredCount">0 / ${test.questions.length} beantwoord</div>
            <button type="submit" class="btn btn-primary" style="width:auto">Test insturen</button>
          </div>
        </form>
      </main>
    </div>`;

  // update progress as user answers
  const form = document.getElementById('testForm');
  form.addEventListener('change', updateProgress);
  form.addEventListener('input', updateProgress);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    await submitTest(false);
  });

  if (totalSec > 0) {
    let remaining = totalSec;
    timerHandle = setInterval(() => {
      remaining--;
      const el = document.getElementById('timer');
      if (el) {
        el.textContent = fmtTime(remaining);
        if (remaining <= 60) el.classList.add('low');
      }
      if (remaining <= 0) {
        clearInterval(timerHandle);
        submitTest(true);
      }
    }, 1000);
  }
}

function renderQuestion(q, i) {
  const typeLabel = q.type === 'open' ? 'Open' : 'Meerkeuze';
  const tipHtml =
    test_hasTips() && q.tip
      ? `<div class="hint">💡 ${esc(q.tip)}</div>`
      : '';

  let body;
  if (q.type === 'open') {
    body = `<input class="text-input" type="text" name="${esc(q.id)}" autocomplete="off" placeholder="Typ je antwoord..." />${tipHtml}`;
  } else {
    body =
      `<div class="options">` +
      q.options
        .map(
          (opt, oi) => `
        <label class="option">
          <input type="radio" name="${esc(q.id)}" value="${esc(opt)}" />
          <span>${esc(opt)}</span>
        </label>`
        )
        .join('') +
      `</div>${tipHtml}`;
  }

  return `
    <div class="q-card">
      <div class="q-head">
        <span class="q-index">Vraag ${i + 1} / ${state.test.questions.length}</span>
        <span class="q-type">${typeLabel}</span>
      </div>
      <div class="q-prompt">${esc(q.prompt)}</div>
      ${body}
    </div>`;
}

function test_hasTips() {
  return state.test && state.test.questions.some((q) => q.tip);
}

function fmtTime(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function collectAnswers() {
  const answers = {};
  state.test.questions.forEach((q) => {
    if (q.type === 'open') {
      const input = document.querySelector(`input[name="${q.id}"]`);
      answers[q.id] = input ? input.value : '';
    } else {
      const checked = document.querySelector(`input[name="${q.id}"]:checked`);
      answers[q.id] = checked ? checked.value : '';
    }
  });
  return answers;
}

function updateProgress() {
  const answers = collectAnswers();
  const answered = Object.values(answers).filter((v) => String(v).trim() !== '').length;
  const total = state.test.questions.length;
  const count = document.getElementById('answeredCount');
  const prog = document.getElementById('progress');
  if (count) count.textContent = `${answered} / ${total} beantwoord`;
  if (prog) prog.style.width = `${(answered / total) * 100}%`;
}

async function submitTest(auto) {
  const btn = document.querySelector('#testForm button[type=submit]');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Nakijken...';
  }
  if (timerHandle) clearInterval(timerHandle);
  const timeTakenSeconds = Math.round((Date.now() - startTime) / 1000);
  const answers = collectAnswers();
  try {
    const data = await api(`/tests/${state.test.id}/grade`, {
      method: 'POST',
      body: { answers, timeTakenSeconds }
    });
    state.result = { ...data, title: state.test.title, subjectId: state.test.subjectId };
    renderResult();
    // refresh dashboard in background
    loadDashboard().catch(() => {});
  } catch (err) {
    toast(err.message, 'error');
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Test insturen';
    }
  }
}

// ---------------- Result view ----------------
function renderResult() {
  const r = state.result;
  const pct = r.score;
  const verdict =
    pct >= 90 ? 'Uitstekend! 🎉' : pct >= 70 ? 'Goed gedaan! 👍' : pct >= 50 ? 'Voldoende — blijf oefenen.' : 'Blijf oefenen, je kan dit!';

  const reviews = r.details
    .map(
      (d, i) => `
    <div class="review-card ${d.correct ? '' : 'wrong'}">
      <div class="q-head">
        <span class="q-index">Vraag ${i + 1}</span>
        <span class="${d.correct ? 'badge-ok' : 'badge-bad'}">${d.correct ? '✓ Correct' : '✗ Fout'}</span>
      </div>
      <div class="q-prompt">${esc(d.prompt)}</div>
      <div class="review-row"><span class="k">Jouw antwoord:</span> ${esc(d.userAnswer) || '<i class="muted">leeg</i>'}</div>
      ${
        d.correct
          ? ''
          : `<div class="review-row"><span class="k">Juist antwoord:</span> <strong>${esc(d.correctAnswer)}</strong></div>`
      }
      ${
        d.explanation
          ? `<div class="improve"><strong>${d.correct ? 'Uitleg' : 'Verbetering'}:</strong> ${esc(d.explanation)}</div>`
          : ''
      }
    </div>`
    )
    .join('');

  app.innerHTML = `
    <div class="shell">
      <header class="topbar">
        <div class="brand">
          <div class="logo">TM</div>
          <div><h1>${esc(r.title)}</h1><p>Resultaat</p></div>
        </div>
      </header>
      <main class="test-wrap">
        <div class="result-hero">
          <div class="result-score">${pct}<small>%</small></div>
          <div class="verdict">${verdict}</div>
          <div class="sub">${r.correct} van ${r.total} vragen correct</div>
        </div>

        <div class="test-footer" style="margin:0 0 24px">
          <button class="btn btn-outline" id="backBtn" style="width:auto">← Dashboard</button>
          <button class="btn btn-primary" id="againBtn" style="width:auto">Nieuwe test</button>
        </div>

        <h3 style="margin:0 0 14px">Overzicht per vraag</h3>
        ${reviews}
      </main>
    </div>`;

  document.getElementById('backBtn').addEventListener('click', async () => {
    await loadDashboard();
    renderDashboard();
  });
  document.getElementById('againBtn').addEventListener('click', () => openUpload(r.subjectId));
}

// ---------------- init ----------------
(function init() {
  if (state.token) {
    boot();
  } else {
    renderAuth();
  }
})();