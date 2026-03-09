import { calculateEngagementRate } from '../../openrouter.js';

/**
 * Подсчитывает количество слов в строке.
 * Считаем словом любую последовательность букв/цифр/подчёркиваний.
 * @param {string} text
 * @returns {number}
 */
function countWords(text) {
  if (!text || typeof text !== 'string') return 0;
  const matches = text.trim().match(/[\p{L}\p{N}_]+/gu);
  return matches ? matches.length : 0;
}

/**
 * Возвращает первую непустую строку текста (псевдозаголовок).
 * @param {string} content
 * @returns {string}
 */
function getFirstLine(content) {
  if (!content || typeof content !== 'string') return '';
  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return '';
}

/**
 * Делит текст на абзацы по пустым строкам / двойным переводам строки.
 * @param {string} content
 * @returns {string[]}
 */
function splitParagraphs(content) {
  if (!content || typeof content !== 'string') return [];
  return content
    .split(/\n\s*\n/g)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

/**
 * Проверяет наличие списков (маркированных или нумерованных).
 * @param {string} content
 * @returns {number} 0 | 1
 */
function detectLists(content) {
  if (!content || typeof content !== 'string') return 0;
  const lines = content.split('\n');
  const hasList = lines.some((line) =>
    /^\s*(?:[-*•]|\d+[\.\)])\s+\S+/.test(line)
  );
  return hasList ? 1 : 0;
}

/**
 * Возвращает количество хэштегов в тексте и категорию по шкале 0..4.
 * @param {string} content
 * @returns {{rawCount: number, bucket: number}}
 */
function detectHashtags(content) {
  if (!content || typeof content !== 'string') {
    return { rawCount: 0, bucket: 0 };
  }
  const matches = content.match(/#[^\s#]+/g) || [];
  const count = matches.length;

  let bucket = 0;
  if (count === 0) bucket = 0;
  else if (count >= 1 && count <= 3) bucket = 1;
  else if (count >= 4 && count <= 7) bucket = 2;
  else if (count >= 8 && count <= 12) bucket = 3;
  else bucket = 4;

  return { rawCount: count, bucket };
}

/**
 * Обновляет / создаёт раздел analysis структуры поста детерминированными метриками.
 * Никакой "семантики" здесь нет — только то, что можно безошибочно посчитать из текста.
 * @param {Object} post
 * @returns {Object} post с дополненным analysis
 */
function enrichPostWithDeterministicFeatures(post) {
  if (!post || typeof post !== 'object') return post;

  const content = typeof post.content === 'string' ? post.content : '';
  const analysis = { ...(post.analysis || {}) };

  // --- 1. Структура и читаемость (частично, только то, что считаем "железно") ---
  const paragraphs = splitParagraphs(content);
  const structure = {
    ...(analysis.structure || {})
  };
  // 1.1 Наличие абзацев
  structure.has_paragraphs = paragraphs.length > 1 ? 1 : 0;
  // 1.2 Количество абзацев
  structure.paragraph_count = paragraphs.length;
  // 1.5 Наличие списков/маркировок
  structure.has_lists = detectLists(content);

  analysis.structure = structure;

  // --- 2. Заголовок (headline) — работаем только с длинами / знаками / цифрами ---
  const headlineLine = getFirstLine(content);
  const headline = {
    ...(analysis.headline || {})
  };
  // 2.1 Длина заголовка (кол-во слов)
  headline.length_words = countWords(headlineLine);
  // 2.2 Заголовок-вопрос: по факту наличия "?" в конце
  headline.is_question = headlineLine.trim().endsWith('?') ? 1 : 0;
  // 2.4 Заголовок с цифрой
  headline.has_number = /\d/.test(headlineLine) ? 1 : 0;
  // 2.8 Длина заголовка до среза (по факту, <= 60 символов)
  headline.preview_length = headlineLine.trim().length <= 60 ? 1 : 0;

  analysis.headline = headline;

  // --- 3. Первый абзац (first_paragraph) — только длина ---
  const firstParagraph = paragraphs[0] || headlineLine || content;
  const firstParagraphBlock = {
    ...(analysis.first_paragraph || {})
  };
  // 3.1 Длина первого абзаца (количество слов)
  firstParagraphBlock.length_words = countWords(firstParagraph);

  analysis.first_paragraph = firstParagraphBlock;

  // --- 5. Тон и стиль (частично, только формальное наличие обращения "мы"/"вы") ---
  const toneStyle = {
    ...(analysis.tone_style || {})
  };

  const lower = content.toLowerCase();
  // 5.2 Использование "мы"
  toneStyle.uses_we = /\bмы\b/u.test(lower) ? 1 : 0;
  // 5.3 Использование "вы"
  toneStyle.uses_you = /\bвы\b/u.test(lower) ? 1 : 0;

  analysis.tone_style = toneStyle;

  // --- 6. Грамотность (только количество тегов, без семантики) ---
  const literacy = {
    ...(analysis.literacy || {})
  };
  const { bucket: hashtagsBucket } = detectHashtags(content);
  // 6.9 Количество тегов (bucket 0..4)
  literacy.hashtags_count = hashtagsBucket;

  analysis.literacy = literacy;

  // --- Метрика вовлеченности уже считается в openrouter.js, но на всякий случай обновим, если нет ---
  if (!post.engagement_rate && post.metrics) {
    post.engagement_rate = calculateEngagementRate(post.metrics);
  }

  return {
    ...post,
    analysis
  };
}

/**
 * Применяет детерминированные вычисления ко всем постам всех конкурентов.
 * Можно вызывать как на сырых, так и на уже обогащённых данных от LLM.
 * @param {Object} competitorsData
 * @returns {Object}
 */
export function applyDeterministicPostProcessing(competitorsData) {
  if (!competitorsData || typeof competitorsData !== 'object') return competitorsData;

  const cloned = JSON.parse(JSON.stringify(competitorsData));

  if (Array.isArray(cloned.competitors)) {
    cloned.competitors = cloned.competitors.map((competitor) => {
      if (!competitor || !Array.isArray(competitor.posts)) return competitor;

      const posts = competitor.posts.map((post) => enrichPostWithDeterministicFeatures(post));

      return {
        ...competitor,
        posts
      };
    });
  }

  return cloned;
}

