function asString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function safeNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export function clamp01(value) {
  return Math.max(0, Math.min(1, safeNumber(value, 0)));
}

export function clampPositive(value, fallback = 0) {
  const numeric = safeNumber(value, fallback);
  return numeric >= 0 ? numeric : fallback;
}

export function normalizeByRange(value, min, max) {
  const numeric = safeNumber(value, min);
  if (max <= min) return 0;
  if (numeric <= min) return 0;
  if (numeric >= max) return 1;
  return (numeric - min) / (max - min);
}

export function mapTernaryToUnit(value) {
  const numeric = safeNumber(value, 0);
  if (numeric <= 0) return 0;
  if (numeric === 1) return 0.5;
  return 1;
}

export function average(values = []) {
  const filtered = values.filter((value) => Number.isFinite(Number(value))).map((value) => Number(value));
  if (!filtered.length) return 0;
  return filtered.reduce((sum, value) => sum + value, 0) / filtered.length;
}

export function uniqueValues(values = []) {
  return Array.from(new Set(values.filter(Boolean)));
}

export function splitParagraphs(text) {
  const source = asString(text);
  if (!source) return [];
  return source
    .split(/\n\s*\n/g)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function splitSentences(text) {
  const source = asString(text);
  if (!source) return [];
  return source
    .split(/[.!?]+/g)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function countWords(text) {
  const source = asString(text);
  if (!source) return 0;
  const matches = source.match(/[\p{L}\p{N}_-]+/gu);
  return matches ? matches.length : 0;
}

export function getTitleLine(text, fallback = '') {
  const source = asString(text);
  if (!source) return asString(fallback);
  const lines = source.split('\n').map((line) => line.trim()).filter(Boolean);
  return lines[0] || asString(fallback);
}

export function getLeadParagraph(text, fallback = '') {
  const paragraphs = splitParagraphs(text);
  if (paragraphs.length > 0) return paragraphs[0];
  return asString(fallback);
}

export function tokenize(text) {
  const source = asString(text).toLowerCase();
  if (!source) return [];
  return source.match(/[\p{L}\p{N}_-]+/gu) || [];
}

export function tokenOverlapScore(a, b) {
  const left = uniqueValues(tokenize(a));
  const rightSet = new Set(uniqueValues(tokenize(b)));
  if (!left.length || rightSet.size === 0) return 0;
  const overlap = left.filter((token) => rightSet.has(token)).length;
  return overlap / Math.max(1, left.length);
}

export function detectIntrigue(text) {
  const source = asString(text).toLowerCase();
  if (!source) return 0;
  return /(как|почему|секрет|ошибк|причин|способ|кейс|инсайт|разбор|что если|вот почему)/u.test(source)
    ? 1
    : 0;
}

export function detectEmphasis(text) {
  const source = asString(text);
  if (!source) return 0;
  return /(\*\*|__|\*[^*\n]+\*|_[^_\n]+_|[A-ZА-ЯЁ]{4,})/u.test(source) ? 1 : 0;
}

export function detectFormattingLists(text) {
  const source = asString(text);
  if (!source) return 0;
  return /^\s*(?:[-*•]|\d+[.)])\s+\S+/m.test(source) ? 1 : 0;
}

export function detectCta(text) {
  const source = asString(text).toLowerCase();
  if (!source) return 0;
  return /(подпис|напиш|остав(ьте)? заявку|скач|узна(й|йте)|закаж|свяж|переход|пишите|обращайт|посмотрит|читайт)/u.test(
    source
  )
    ? 1
    : 0;
}

export function detectQuestion(text) {
  return asString(text).includes('?') ? 1 : 0;
}

export function detectDigit(text) {
  return /\d/u.test(asString(text)) ? 1 : 0;
}

export function detectEvidence(text) {
  const source = asString(text).toLowerCase();
  if (!source) return 0;
  if (/\d+\s?%|\d+\s?(кейс|факт|данн|исслед|результат|метрик)/u.test(source)) return 1;
  if (/\d/u.test(source)) return 0.5;
  return 0;
}

export function detectConclusion(text) {
  const source = asString(text).toLowerCase();
  if (!source) return 0;
  return /(итог|вывод|в заключение|главное|резюмир|подведем итог|таким образом)/u.test(source) ? 1 : 0;
}

export function detectTechQuality(text) {
  const source = asString(text);
  if (!source) return 1;
  const hasWrongQuotes = /["']/u.test(source);
  const hasDashIssue = /\s-\s/u.test(source);
  return hasWrongQuotes || hasDashIssue ? 0 : 1;
}

export function estimateGrammarQuality(text) {
  const source = asString(text);
  if (!source) return 0.75;
  let score = 1;
  if (/([!?.,])\1{2,}/u.test(source)) score -= 0.15;
  if (/[A-Za-z]{6,}[А-Яа-яЁё]{6,}|[А-Яа-яЁё]{6,}[A-Za-z]{6,}/u.test(source)) score -= 0.1;
  if (/\s{2,}/u.test(source)) score -= 0.05;
  return clamp01(score);
}

export function resolveToneFlags(rawTone) {
  const source = asString(rawTone).toLowerCase();
  return {
    expert: /(expert|эксперт|technical|tech)/u.test(source) ? 1 : 0,
    friendly: /(friend|друж|warm|casual)/u.test(source) ? 1 : 0,
    official: /(official|formal|офиц|корпоратив)/u.test(source) ? 1 : 0,
    inspiring: /(inspir|motiv|вдохнов)/u.test(source) ? 1 : 0,
    humorous: /(humor|юмор|fun)/u.test(source) ? 1 : 0
  };
}

export function estimateSentenceLengthBucket(text) {
  const sentences = splitSentences(text);
  if (!sentences.length) return 0.5;
  const avgWords = average(sentences.map((sentence) => countWords(sentence)));
  if (avgWords < 10) return 0;
  if (avgWords <= 20) return 0.5;
  return 1;
}

export function pickFirstFinite(...values) {
  for (const value of values) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return null;
}
