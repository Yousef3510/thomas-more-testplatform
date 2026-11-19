'use strict';

function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

/**
 * Grade an open answer against expected keywords.
 * Tolerant: exact, substring, or small typo.
 */
function isOpenCorrect(userAnswer, question) {
  const ua = normalize(userAnswer);
  if (!ua) return false;

  const expected = normalize(question.answer || '');
  const keywords = (question.keywords && question.keywords.length
    ? question.keywords
    : [question.answer]
  ).map(normalize);

  // substring either direction
  if (expected && (ua.includes(expected) || (ua.length >= 3 && expected.includes(ua)))) {
    return true;
  }
  // typo tolerance for words >= 5 chars
  for (const kw of keywords) {
    if (!kw) continue;
    if (ua === kw) return true;
    if (kw.length >= 5 && ua.length >= 5 && levenshtein(ua, kw) <= 1) return true;
    if (ua.includes(kw) || kw.includes(ua)) return true;
  }
  return false;
}

function isClosedCorrect(userAnswer, question) {
  return normalize(userAnswer) === normalize(question.answer);
}

function gradeQuestion(question, userAnswer) {
  if (!question || question.id == null) {
    return { id: question && question.id, correct: false, userAnswer: userAnswer || '', correctAnswer: '', explanation: '' };
  }
  let correct = false;
  if (question.type === 'open') {
    correct = isOpenCorrect(userAnswer, question);
  } else {
    correct = isClosedCorrect(userAnswer, question);
  }
  return {
    id: question.id,
    type: question.type,
    prompt: question.prompt,
    correct,
    userAnswer: userAnswer || '',
    correctAnswer: question.answer,
    explanation: question.explanation || '',
    options: question.options || undefined
  };
}

/**
 * Grade a whole attempt.
 * @param {Array} questions - full question objects (with answers)
 * @param {Object} answersMap - { [questionId]: userAnswer }
 */
function gradeAttempt(questions, answersMap) {
  const details = questions.map((q) => gradeQuestion(q, answersMap[q.id]));
  const total = questions.length;
  const correct = details.filter((d) => d.correct).length;
  const score = total > 0 ? Math.round((correct / total) * 100) : 0;
  return { details, total, correct, score };
}

module.exports = { gradeAttempt, gradeQuestion, isOpenCorrect, isClosedCorrect, normalize };