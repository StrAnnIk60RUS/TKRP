const OBJECTIVE_CTA_BANK = {
  inform: [
    'Получить чек-лист по теме',
    'Запросить пример отчета',
    'Задать вопрос по своему сценарию'
  ],
  educate: [
    'Скачать пошаговый чек-лист',
    'Получить рабочий регламент',
    'Запросить демонстрацию процесса'
  ],
  engage: [
    'Обсудить ваш кейс с экспертом',
    'Сравнить ваш сценарий с типовыми кейсами',
    'Разобрать ситуацию на вашем участке'
  ],
  convert: [
    'Запросить демонстрацию решения',
    'Получить расчет окупаемости',
    'Запустить пилот под ваш процесс'
  ],
  retain: [
    'Заказать сервисный аудит',
    'Получить план поддержки команды',
    'Проверить, где процесс теряет точность'
  ],
  brand_building: [
    'Посмотреть пример проекта',
    'Запросить консультацию эксперта',
    'Получить обзор решения под вашу задачу'
  ]
};

const OBJECTIVE_TOPIC_VARIATIONS = {
  inform: [
    'что важно учесть на старте',
    'где чаще всего теряют результат',
    'какие сигналы нельзя игнорировать',
    'что меняется в ежедневной работе'
  ],
  educate: [
    'пошаговый разбор для команды',
    'как внедрять без лишней теории',
    'что проверить перед запуском',
    'как не потерять качество на старте'
  ],
  engage: [
    'вопросы для обсуждения с командой',
    'сценарий, в котором мнения расходятся',
    'где практика спорит с привычкой',
    'какой подход выбрали бы вы'
  ],
  convert: [
    'какой эффект это дает бизнесу',
    'когда пилот окупается быстрее',
    'что получает производство на практике',
    'с чего начать без лишних затрат'
  ],
  retain: [
    'как поддерживать результат после запуска',
    'что важно не упустить в сопровождении',
    'где сервис удерживает качество',
    'как снизить риски после внедрения'
  ],
  brand_building: [
    'какую экспертизу это показывает',
    'почему это усиливает доверие',
    'какой подход отличает сильную команду',
    'за счет чего решение выглядит зрелым'
  ]
};

const MACHINE_KEY_MESSAGE_PATTERNS = [
  /^в\s+фокусе:\s*/iu,
  /^коротко\s+о\s+главном:\s*/iu,
  /^разбираем\s+/iu,
  /^читатель\s+увидит\s+/iu,
  /^один\s+вопрос\s+[—-]\s*/iu,
  /^стартуем\s+с\s+кейса\s+/iu,
  /^без\s+лишней\s+теории\s+[—-]\s*/iu,
  /^для\s+команды\s+на\s+местах:\s*/iu
];

const TOPIC_META_SUFFIX_RE =
  /\s*\((?:обзор|разбор|практика|риски|экономика|ценность|сопровождение|дискуссия|бренд|фокус)\s*:\s*[^()]{2,160}\)\s*$/iu;

const OBJECTIVE_TEXT_RE =
  /\b(?:цель\s+публикации|задача\s+материала|objective)\s*[:—-]\s*[^.?!]+[.?!]?/giu;

const SERVICE_OR_TECH_TOPIC_RE =
  /постгарант|гарантий|сервис|обслуживан|ремонт|sla|запчаст|характеристик|спецификац|датчик|точност|калибр|сертификат|измерен|диапазон|rfid|температур|регламент/u;

const GENERIC_TOPIC_RE =
  /^(?:пост\s+про|материал\s+про|тема\s+про|inform:|educate:|engage:|convert:|retain:|brand\s*building:)/iu;

const GENERIC_SUMMARY_RE =
  /(?:показываем\s+реальный\s+рабочий\s+сценарий|ставим\s+.+\s+в\s+связку\s+с\s+kpi,\s*рисками\s+и\s+зрелостью\s+процессов|разбираем\s+ограничения\s+внедрения,\s*роли\s+команды\s+и\s+критерии\s+готовности\s+к\s+пилоту)/iu;

const DOMAIN_SIGNAL_RE =
  /rfid|wi[\s-]?fi|веб[\s-]?интерфейс|регистратор|датчик|термоцикл|технадзор|паспорт(?:ов)?\s+шв(?:а|ов)|калибровк|метролог|сертификац|околошовн|шов|сварк|бру|допуск|аналитик|отчет|пилот/u;

const WORD_TOKEN_RE = /[a-zа-я0-9]+/giu;

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function tokenizeCoreTerms(value) {
  return normalizeWhitespace(value)
    .toLowerCase()
    .match(WORD_TOKEN_RE)
    ?.filter((token) => token.length >= 4) || [];
}

function clamp01(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(1, numeric));
}

function round3(value) {
  return Number(clamp01(value).toFixed(3));
}

function normalizeObjectiveKey(objective = '') {
  const value = normalizeWhitespace(objective).toLowerCase();
  return value || 'inform';
}

function normalizeFormatKey(format = '') {
  const value = normalizeWhitespace(format).toLowerCase();
  return value || 'text';
}

function normalizeToneKey(tone = '') {
  const value = normalizeWhitespace(tone).toLowerCase();
  return value || 'expert';
}

function hashString(value) {
  const input = String(value || '');
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function uniqueTokens(tokens = []) {
  return Array.from(new Set(tokens.filter(Boolean)));
}

function countDomainSignals(text = '') {
  const normalized = normalizeWhitespace(text);
  if (!normalized) return 0;
  const domainMatches = normalized.match(new RegExp(DOMAIN_SIGNAL_RE.source, 'giu')) || [];
  const numberMatches = normalized.match(/\b\d+(?:[.,]\d+)?\b/gu) || [];
  const acronymMatches = normalized.match(/\b[A-ZА-Я]{2,}(?:-[A-ZА-Я0-9]{1,})?\b/gu) || [];
  return domainMatches.length + numberMatches.length + acronymMatches.length;
}

function textOverlapRatio(text = '', anchorTerms = []) {
  const textTokens = new Set(tokenizeCoreTerms(text));
  const anchors = uniqueTokens(anchorTerms);
  if (!anchors.length) return 0;
  const matched = anchors.filter((token) => textTokens.has(token)).length;
  return matched / anchors.length;
}

export function sanitizeTopicTitle(topic) {
  let next = normalizeWhitespace(topic);
  if (!next) return '';
  let prev = null;
  while (prev !== next) {
    prev = next;
    next = next.replace(TOPIC_META_SUFFIX_RE, '').trim();
  }
  return next.replace(/\s+([:;,.!?])/g, '$1').trim();
}

const OBJECTIVE_KEY_EN_TAIL_RE =
  /\s*(?:[—\-·]\s*|\s+[—\-]\s*|:?\s*)(?:inform|educate|engage|convert|retain|brand_building)\s*$/iu;

const OBJECTIVE_LEADING_EN_PREFIX_RE =
  /^(?:inform|educate|engage|convert|retain|brand_building)\s*:\s*/iu;

/** Убирает из темы служебные хвосты/префиксы цели (латиница из генома / домена). */
export function stripServiceTopicTail(rawTopic = '') {
  let t = normalizeWhitespace(String(rawTopic || ''));
  if (!t) return '';
  t = t.replace(OBJECTIVE_LEADING_EN_PREFIX_RE, '').trim();
  let prev;
  do {
    prev = t;
    t = t.replace(OBJECTIVE_KEY_EN_TAIL_RE, '').trim();
  } while (prev !== t);
  return t;
}

/** Тема для UI и сохранения: без мета-хвостов и с нормализацией заголовка. */
export function normalizePublicationTopicForUi(rawTopic = '') {
  return sanitizeTopicTitle(stripServiceTopicTail(rawTopic));
}

/** Ключ для дедупликации заголовков тем в плане. */
export function normalizeTopicDedupKey(topic) {
  return String(topic || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/** Уникальные topic в массиве публикаций (повторы получают вариацию угла). */
export function ensureDistinctTopicTitles(publications) {
  if (!Array.isArray(publications)) return publications;
  const seen = new Map();
  return publications.map((pub, index) => {
    if (!pub || typeof pub !== 'object') return pub;
    const topic = typeof pub.topic === 'string' ? pub.topic.trim() : '';
    if (!topic) return pub;
    const key = normalizeTopicDedupKey(topic);
    const occurrence = (seen.get(key) || 0) + 1;
    seen.set(key, occurrence);
    if (occurrence === 1) {
      return { ...pub, topic: normalizePublicationTopicForUi(topic) };
    }
    return {
      ...pub,
      topic: normalizePublicationTopicForUi(buildNaturalTopicVariation(topic, pub.objective, occurrence, index))
    };
  });
}

/**
 * Для ключевого сообщения: если тема «длинный продукт: короткий угол», в шаблонах
 * используем только угол — иначе заголовок карточки и «ключевое» трижды повторяют одно имя.
 */
export function getCompactTopicForMessage(topic = '') {
  const t = sanitizeTopicTitle(topic);
  if (!t) return '';
  const idx = t.indexOf(': ');
  if (idx === -1) return t.length > 110 ? t.slice(0, 110) : t;
  const stem = t.slice(0, idx).trim();
  const angle = t.slice(idx + 2).trim();
  const minStem = 28;
  const minAngle = 6;
  if (stem.length >= minStem && angle.length >= minAngle) {
    return angle.length > 110 ? angle.slice(0, 110) : angle;
  }
  return t.length > 110 ? t.slice(0, 110) : t;
}

/** Заменяет в тексте кавычки «полная тема» на компактную подпись (угол), если совпало дословно. */
export function replaceQuotedFullTopicWithCompact(keyMessage, canonicalTopic, compactLabel) {
  const km = String(keyMessage || '');
  const compact = String(compactLabel || '').trim();
  if (!km || !compact) return km;
  const canNorm = normalizeWhitespace(canonicalTopic).toLowerCase();
  if (!canNorm) return km;
  let out = km;
  let search = 0;
  while (search < out.length) {
    const open = out.indexOf('«', search);
    if (open === -1) break;
    const close = out.indexOf('»', open + 1);
    if (close === -1) break;
    const inner = out.slice(open + 1, close);
    if (normalizeWhitespace(inner).toLowerCase() === canNorm) {
      out = `${out.slice(0, open + 1)}${compact}${out.slice(close)}`;
      search = open + 1 + compact.length + 1;
    } else {
      search = close + 1;
    }
  }
  return out;
}

/**
 * Индекс точки, завершающей первое предложение; пропускает ложные границы вида «… угла 1. Далее текст»
 * (нумерация после номера варианта в первой строке).
 */
export function findSummaryFirstSentenceEnd(text = '', minPos = 24, maxPos = 320) {
  const s = String(text || '');
  let search = 0;
  while (search < s.length) {
    const rel = s.slice(search).search(/\.\s+/u);
    if (rel === -1) return -1;
    const abs = search + rel;
    if (abs < minPos || abs > maxPos) return -1;
    const beforeDot = abs - 1;
    if (beforeDot >= 0 && /\d/u.test(s[beforeDot])) {
      let k = beforeDot;
      while (k >= 0 && /\d/u.test(s[k])) k -= 1;
      const digitRun = s.slice(k + 1, abs);
      const charBeforeRun = k >= 0 ? s[k] : '';
      const afterChunk = s.slice(abs + 2).trimStart();
      const looksLikeListEnumerator =
        /^\d{1,3}$/u.test(digitRun) &&
        /[\s:;—–\-]/u.test(charBeforeRun) &&
        /^[А-ЯЁA-Z«"„]/u.test(afterChunk);
      if (looksLikeListEnumerator) {
        search = abs + 2;
        continue;
      }
    }
    return abs;
  }
  return -1;
}

export function getSummaryLeadForAngleCheck(summary) {
  const s = stripObjectiveMeta(summary);
  if (!s) return '';
  const end = findSummaryFirstSentenceEnd(s, 12, 400);
  if (end < 0) return s.length <= 400 ? s : s.slice(0, 400);
  return s.slice(0, end).trim();
}

function shouldStripMisalignedLead(canonical, lead, rest) {
  if (!rest || rest.length < 48) return false;
  const leadNorm = normalizeWhitespace(lead).toLowerCase();
  const canNorm = normalizeWhitespace(canonical).toLowerCase();
  if (leadNorm === canNorm) return false;
  const cIdx = canonical.indexOf(': ');
  const lIdx = lead.indexOf(': ');
  const minStemForSplit = 12;
  if (cIdx === -1 || lIdx === -1) return false;
  const cStem = canonical.slice(0, cIdx).trim().toLowerCase();
  const lStem = lead.slice(0, lIdx).trim().toLowerCase();
  if (cStem.length < minStemForSplit || lStem !== cStem) return false;
  return keyMessageAngleMismatchesTopic(canonical, lead) || leadNorm !== canNorm;
}

/**
 * Убирает первое предложение summary, если это устаревшая строка-тема с тем же стержнем продукта,
 * но другим хвостом (рассинхрон после эволюции / merge).
 */
export function stripMisalignedSummaryLead(canonicalTopic, summary) {
  const s = stripObjectiveMeta(summary);
  const canonical = normalizePublicationTopicForUi(canonicalTopic);
  if (!s || !canonical) return s;

  const tryAtDot = (firstDot) => {
    if (firstDot < 24 || firstDot > 520) return null;
    const lead = s.slice(0, firstDot).trim();
    const rest = s.slice(firstDot + 1).trim();
    if (!shouldStripMisalignedLead(canonical, lead, rest)) return null;
    return rest;
  };

  const naiveDot = s.search(/\.\s+/u);
  const naiveRest = tryAtDot(naiveDot);
  if (naiveRest) return naiveRest;

  const smartDot = findSummaryFirstSentenceEnd(s, 24, 320);
  if (smartDot < 0) return s;
  const smartRest = tryAtDot(smartDot);
  return smartRest || s;
}

/** Сегменты угла по em dash (и похожим тире) для сравнения хвостов вроде «… бренда — A» vs «… бренда — B». */
function splitTopicAngleSegments(text = '') {
  return normalizeWhitespace(String(text || ''))
    .toLowerCase()
    .split(/\s*(?:—|–)\s*/u)
    .map((x) => x.trim())
    .filter(Boolean);
}

/**
 * В key_message есть «…» с углом, не совпадающим с углом canonical (без опоры только на номера вариантов).
 */
function keyMessageQuotedAngleMismatchesCanonical(canonical, keyMessage) {
  const km = stripObjectiveMeta(String(keyMessage || ''));
  const m = km.match(/«([^»]{10,240})»/u);
  if (!m) return false;
  const inner = m[1].trim();
  const compact = getCompactTopicForMessage(canonical);
  if (!compact || compact.length < 12) return false;

  const innerL = normalizeWhitespace(inner).toLowerCase();
  const compactL = normalizeWhitespace(compact).toLowerCase();
  const canonL = normalizeWhitespace(canonical).toLowerCase();

  if (innerL === compactL || innerL === canonL) return false;
  if (canonL.includes(innerL) && innerL.length >= 28) return false;
  if (compactL.length >= 24 && innerL.includes(compactL)) return false;

  const iSeg = splitTopicAngleSegments(inner);
  const cSeg = splitTopicAngleSegments(compact);

  if (iSeg.length >= 2 && cSeg.length >= 2 && iSeg[0] === cSeg[0]) {
    const tailI = iSeg.slice(1).join(' — ');
    const tailC = cSeg.slice(1).join(' — ');
    if (tailI === tailC) return false;
    if (tailI.length >= 8 && tailC.length >= 8) {
      const ol = textOverlapRatio(tailI, tokenizeCoreTerms(tailC));
      if (ol < 0.48) return true;
    }
    return false;
  }

  const compactTerms = tokenizeCoreTerms(compact);
  if (compactTerms.length < 3) return false;
  const overlapCompact = textOverlapRatio(inner, compactTerms);
  if (overlapCompact >= 0.34) return false;

  return innerL.length >= 14;
}

/**
 * Одинаковый RAG-абзац «Комплексная система контроля…» — оставляем в первом посту плана, в остальных вырезаем.
 */
export function dedupeRepeatedProductBoilerplateInSummaries(publications = []) {
  if (!Array.isArray(publications) || publications.length <= 1) return publications;
  const BOILERPLATE_HEAD_RE = /Комплексная система контроля сварочных процессов,?\s*включающ/iu;
  const BOILERPLATE_SENTENCE_RE =
    /(?:комплексн[а-я]*\s+систем|регистратор|блок(?:ом)?\s+датчик|мобильн[а-я]*\s+приложени|веб[\s-]?приложени|идентификац|график[а-я]*\s+параметр|документальн[а-я]*\s+подтверждени|сварочн[а-я]*\s+процесс)/iu;

  const stripLeadingBoilerplate = (summary = '') => {
    const normalized = normalizeWhitespace(summary);
    if (!normalized || !BOILERPLATE_HEAD_RE.test(normalized)) return normalized;
    const sentences = normalized
      .split(/(?<=[.!?])\s+/u)
      .map((part) => part.trim())
      .filter(Boolean);
    if (sentences.length <= 1) return normalized;

    let cutSentences = 1;
    for (let i = 1; i < Math.min(sentences.length, 5); i += 1) {
      if (BOILERPLATE_SENTENCE_RE.test(sentences[i])) {
        cutSentences = i + 1;
        continue;
      }
      break;
    }
    const stripped = normalizeWhitespace(sentences.slice(cutSentences).join(' ')).trim();
    return stripped.length >= 180 ? stripped : normalized;
  };

  let keptFirstBlock = false;
  return publications.map((pub) => {
    const sm = String(pub?.summary || '').trim();
    if (!sm || !BOILERPLATE_HEAD_RE.test(sm)) return pub;
    if (!keptFirstBlock) {
      keptFirstBlock = true;
      return pub;
    }
    const stripped = stripLeadingBoilerplate(sm);
    if (stripped.length < 180) return pub;
    const next = { ...pub, summary: stripped };
    return { ...next, semantic_core: buildDraftSemanticCore(next) };
  });
}

/** Согласовать ключевое сообщение с финальной темой карточки (title || topic). */
export function reconcilePublicationKeyMessageWithTopic(publication = {}, slotIndex = 0) {
  const canonical = normalizePublicationTopicForUi(publication.title || publication.topic || '');
  let key_message = stripObjectiveMeta(publication.key_message || '');
  if (!canonical) return key_message;

  const objective = normalizeObjectiveKey(publication.objective);
  const format = normalizeFormatKey(publication.format);
  const tone = alignToneToObjective(canonical, normalizeToneKey(publication.tone), objective);
  const index = Number.isFinite(Number(slotIndex)) ? Number(slotIndex) : 0;

  if (keyMessageAngleMismatchesTopic(canonical, key_message)) {
    return buildNaturalKeyMessage({ topic: canonical, objective, format, tone, index });
  }
  if (keyMessageQuotedAngleMismatchesCanonical(canonical, key_message)) {
    return buildNaturalKeyMessage({ topic: canonical, objective, format, tone, index });
  }
  const compact = getCompactTopicForMessage(canonical);
  if (compact && compact !== canonical) {
    return replaceQuotedFullTopicWithCompact(key_message, canonical, compact);
  }
  return key_message;
}

function collectAngleNumbers(text = '') {
  const s = String(text).toLowerCase();
  const nums = new Set();
  for (const re of [
    /кейс[а-я]*\s*[№n]?\s*(\d+)/gi,
    /обсуждени[ея]\s+кейс[а-я]*\s*(\d+)/gi,
    /практическ[а-я]*\s+разбор[а-я]*\s*(\d+)/gi,
    /разбор[а-я]*\s*(\d+)/gi,
    /решени[ея]\s+(\d+)/gi,
    /бизнес[\s-]*эффект[а-я]*\s+решен[ияи]\s*(\d+)/gi,
    /продукт[а-я]*\s*(\d+)/gi,
    /обновлени[ея]\s+продукта\s*(\d+)/gi,
    /развитие\s+сервис[а-я]*\s*(\d+)/gi,
    /сервис[а-я]*\s+(\d+)/gi,
    /экспертн[а-я]*\s+образ[а-я]*\s+бренд[а-я]*\s*(\d+)/gi,
    /образ[а-я]*\s+бренд[а-я]*\s*(\d+)/gi
  ]) {
    const matches = [...s.matchAll(re)];
    for (const m of matches) {
      if (m[1]) nums.add(m[1]);
    }
  }
  return nums;
}

/** Ключевое сообщение ссылается на другой номер угла, чем тема (кейс 19 vs кейс 3). */
export function keyMessageAngleMismatchesTopic(topic = '', keyMessage = '') {
  const tn = collectAngleNumbers(topic);
  const kn = collectAngleNumbers(keyMessage);
  if (!tn.size || !kn.size) return false;
  for (const k of kn) {
    if (!tn.has(k)) return true;
  }
  return false;
}

export function summaryLeadAngleMismatchesTopic(canonicalTopic, summary) {
  const canonical = normalizePublicationTopicForUi(canonicalTopic);
  const lead = getSummaryLeadForAngleCheck(summary);
  if (!canonical || !lead) return false;
  return keyMessageAngleMismatchesTopic(canonical, lead);
}

const BUILTIN_KEY_MESSAGE_LEAD_RE = [
  /^материал\s+про\s+[«"]/iu,
  /^пост\s+про\s+[«"]/iu,
  /^в\s+теме\s+[«"]/iu,
  /^разговор\s+про\s+[«"]/iu,
  /^на\s+примере\s+[«"]/iu,
  /^на\s+теме\s+[«"]/iu,
  /^если\s+тема\s+[«"]/iu,
  /^по\s+теме\s+[«"][^»"]+[»"]\s+важен\s+не\s+общий\s+эффект/iu,
  /^обычно\s+нет\s+одной\s+универсальной\s+схемы/iu,
  /связывает\s+практический\s+сценарий\s+с\s+бизнес/iu,
  /работает\s+на\s+доверие,\s+когда\s+за\s+заявлением\s+бренда/iu
];

export function isBuiltInKeyMessageTemplate(text = '') {
  const s = stripObjectiveMeta(String(text || '')).trim();
  if (s.length < 24) return false;
  return BUILTIN_KEY_MESSAGE_LEAD_RE.some((re) => re.test(s));
}

export function buildDraftSemanticCore(publication = {}) {
  const topic = sanitizeTopicTitle(publication?.topic);
  const keyMessage = stripObjectiveMeta(publication?.key_message || '');
  const summary = stripObjectiveMeta(publication?.summary || '');
  const topicTerms = tokenizeCoreTerms(topic);
  const messageTerms = tokenizeCoreTerms(keyMessage).slice(0, 10);
  const summaryTerms = tokenizeCoreTerms(summary).slice(0, 16);
  const anchorTerms = uniqueTokens([...topicTerms, ...messageTerms, ...summaryTerms]).slice(0, 18);
  const specificityScore =
    countDomainSignals(topic) * 2 +
    countDomainSignals(keyMessage) * 1.4 +
    countDomainSignals(summary) +
    Math.min(anchorTerms.length, 12) * 0.35;

  return {
    topic_core: topic,
    draft_topic: topic,
    draft_key_message: keyMessage,
    draft_summary: summary,
    anchor_terms: anchorTerms,
    topic_terms: uniqueTokens(topicTerms),
    specificity_score: Number(specificityScore.toFixed(3))
  };
}

export function textPreservesSemanticCore(text = '', semanticCore = {}) {
  const topicCore = sanitizeTopicTitle(semanticCore?.topic_core);
  if (!text || !topicCore) return false;
  const anchorTerms = Array.isArray(semanticCore?.anchor_terms) ? semanticCore.anchor_terms : [];
  const overlap = textOverlapRatio(text, anchorTerms);
  if (overlap >= 0.32) return true;
  const topicTerms = Array.isArray(semanticCore?.topic_terms) ? semanticCore.topic_terms : tokenizeCoreTerms(topicCore);
  return textOverlapRatio(text, topicTerms) >= 0.4;
}

export function choosePreferredTopic(semanticCore = {}, candidateTopic = '', objective = 'inform', index = 0) {
  const draftTopic = sanitizeTopicTitle(semanticCore?.draft_topic || semanticCore?.topic_core || '');
  const candidate = sanitizeTopicTitle(candidateTopic);
  if (!draftTopic) return candidate;
  if (!candidate) return draftTopic;
  if (GENERIC_TOPIC_RE.test(candidateTopic) || !textPreservesSemanticCore(candidate, semanticCore)) {
    return draftTopic;
  }
  const draftSignals = countDomainSignals(draftTopic);
  const candidateSignals = countDomainSignals(candidate);
  if (candidateSignals + 1 < draftSignals) {
    return draftTopic;
  }
  if (candidate.toLowerCase() === draftTopic.toLowerCase()) {
    return draftTopic;
  }
  return candidate;
}

function clampAlignmentScore(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Оценка 0..1: насколько тема в геноме согласована с черновым semantic_core (до merge в applyGenomeToPlan).
 * Низкий балл — ген уводит слот от сильного черновика (GA видит штраф до «лечения» choosePreferredTopic).
 */
export function scoreGeneTopicDraftAlignment(topicGene = '', semanticCore = {}, objective = 'inform', index = 0) {
  const draftTopic = sanitizeTopicTitle(semanticCore?.draft_topic || semanticCore?.topic_core || '');
  if (!draftTopic) return 1;
  const candidate = sanitizeTopicTitle(topicGene);
  if (!candidate) return 0.18;

  const preferred = choosePreferredTopic(semanticCore, topicGene, objective, index);
  const anchors = Array.isArray(semanticCore.anchor_terms) ? semanticCore.anchor_terms : [];
  const topicTerms = Array.isArray(semanticCore.topic_terms)
    ? semanticCore.topic_terms
    : tokenizeCoreTerms(draftTopic);
  const bestOverlap = Math.max(textOverlapRatio(candidate, anchors), textOverlapRatio(candidate, topicTerms));

  const preferredNorm = preferred.toLowerCase();
  const draftNorm = draftTopic.toLowerCase();
  const candidateNorm = candidate.toLowerCase();

  if (preferredNorm === draftNorm) {
    if (candidateNorm === draftNorm) return 1;
    return clampAlignmentScore(0.1 + 0.32 * bestOverlap, 0.1, 0.42);
  }
  if (candidateNorm === preferredNorm) {
    return clampAlignmentScore(0.52 + 0.48 * bestOverlap, 0.52, 1);
  }
  return clampAlignmentScore(0.35 + 0.65 * bestOverlap, 0.35, 1);
}

export function scorePlanDraftGeneAlignment(genome = [], basePublications = []) {
  if (!Array.isArray(genome) || !Array.isArray(basePublications) || genome.length === 0) return 1;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < Math.min(genome.length, basePublications.length); i += 1) {
    const gene = genome[i];
    if (!Array.isArray(gene) || gene.length < 3) continue;
    const topicGene = gene[0];
    const objectiveGene = gene[2] || 'inform';
    const pub = basePublications[i] || {};
    const semanticCore = pub.semantic_core || buildDraftSemanticCore(pub);
    sum += scoreGeneTopicDraftAlignment(topicGene, semanticCore, objectiveGene, i);
    n += 1;
  }
  return n ? sum / n : 1;
}

export function choosePreferredKeyMessage(semanticCore = {}, candidateKeyMessage = '', fallback = {}) {
  const candidate = stripObjectiveMeta(candidateKeyMessage);
  const draftKeyMessage = stripObjectiveMeta(semanticCore?.draft_key_message || '');
  const topic = sanitizeTopicTitle(fallback?.topic || semanticCore?.topic_core || '');
  const objective = fallback?.objective || 'inform';
  const format = fallback?.format || 'text';
  const tone = fallback?.tone || 'expert';
  const index = Number.isFinite(Number(fallback?.index)) ? Number(fallback.index) : 0;

  if (!candidate) {
    return draftKeyMessage || buildNaturalKeyMessage({ topic, objective, format, tone, index });
  }
  const genericCandidate =
    shouldRewriteMachineKeyMessage(candidate) ||
    GENERIC_SUMMARY_RE.test(candidate) ||
    /(?:скрыты\s+потери\s+и\s+на\s+что\s+смотреть\s+в\s+первую\s+очередь|понятную\s+последовательность\s+действий\s+без\s+лишней\s+теории|следующий\s+шаг\s+к\s+пилоту\s+и\s+окупаемости)/iu.test(candidate);
  if (genericCandidate || !textPreservesSemanticCore(candidate, semanticCore)) {
    return draftKeyMessage || buildNaturalKeyMessage({ topic, objective, format, tone, index });
  }
  if (keyMessageAngleMismatchesTopic(topic, candidate)) {
    if (
      draftKeyMessage &&
      !keyMessageAngleMismatchesTopic(topic, draftKeyMessage) &&
      textPreservesSemanticCore(draftKeyMessage, semanticCore) &&
      !shouldRewriteMachineKeyMessage(draftKeyMessage)
    ) {
      return draftKeyMessage;
    }
    return buildNaturalKeyMessage({ topic, objective, format, tone, index });
  }
  if (
    isBuiltInKeyMessageTemplate(candidate) &&
    draftKeyMessage &&
    !shouldRewriteMachineKeyMessage(draftKeyMessage) &&
    textPreservesSemanticCore(draftKeyMessage, semanticCore)
  ) {
    if (
      !isBuiltInKeyMessageTemplate(draftKeyMessage) ||
      countDomainSignals(draftKeyMessage) >= countDomainSignals(candidate)
    ) {
      return draftKeyMessage;
    }
  }
  if (countDomainSignals(candidate) + 1 < countDomainSignals(draftKeyMessage)) {
    return draftKeyMessage || candidate;
  }
  return candidate;
}

function hashStringDedupe(input = '') {
  const s = String(input);
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Убирает дословные дубликаты key_message между слотами (таблица/экспорт). */
export function dedupeKeyMessagesAcrossPublications(publications = []) {
  if (!Array.isArray(publications) || publications.length <= 1) return publications;
  const seen = new Map();
  let salt = 0;
  return publications.map((pub, index) => {
    const kmRaw = stripObjectiveMeta(String(pub?.key_message || '').trim());
    const nk = normalizeWhitespace(kmRaw).toLowerCase().replace(/\s+/g, ' ');
    if (nk.length < 42) return pub;
    if (!seen.has(nk)) {
      seen.set(nk, index);
      return pub;
    }
    salt += 1;
    const topic = sanitizeTopicTitle(pub?.topic);
    const objective = normalizeObjectiveKey(pub?.objective);
    const format = normalizeFormatKey(pub?.format);
    const tone = alignToneToObjective(topic, normalizeToneKey(pub?.tone), objective);
    const variantPick = (index + salt * 5 + hashStringDedupe(`${nk}|${index}|${salt}`)) % 11;
    const nextKm = buildNaturalKeyMessage({
      topic,
      objective,
      format,
      tone,
      index: variantPick + salt
    });
    const merged = { ...pub, key_message: nextKm };
    return { ...merged, semantic_core: buildDraftSemanticCore(merged) };
  });
}

export function choosePreferredSummary(semanticCore = {}, candidateSummary = '', fallback = {}) {
  const candidate = stripObjectiveMeta(candidateSummary);
  const draftSummary = stripObjectiveMeta(semanticCore?.draft_summary || '');
  const topic = sanitizeTopicTitle(fallback?.topic || semanticCore?.topic_core || '');
  const format = fallback?.format || 'text';
  const formInput = fallback?.formInput || {};
  const minLength =
    normalizeFormatKey(format) === 'text' || normalizeFormatKey(format) === 'combined' ? 650 : 400;

  const normalizeLength = (text) => {
    const normalized = normalizeWhitespace(text);
    if (!normalized) return '';
    if (normalized.length >= minLength) return normalized;
    return normalized;
  };

  const normalizedCandidate = normalizeLength(candidate);
  const normalizedDraft = normalizeLength(draftSummary);

  if (!normalizedCandidate) {
    return normalizedDraft || fallback?.fallbackSummary || '';
  }
  if (GENERIC_SUMMARY_RE.test(normalizedCandidate) && countDomainSignals(normalizedDraft) > countDomainSignals(normalizedCandidate)) {
    return normalizedDraft || normalizedCandidate;
  }
  if (!textPreservesSemanticCore(normalizedCandidate, semanticCore)) {
    return normalizedDraft || normalizedCandidate;
  }
  if (countDomainSignals(normalizedCandidate) + 2 < countDomainSignals(normalizedDraft)) {
    return normalizedDraft || normalizedCandidate;
  }
  if (normalizedDraft && normalizedCandidate.length < Math.min(220, normalizedDraft.length * 0.45)) {
    return normalizedDraft;
  }
  return normalizedCandidate;
}

export function stripObjectiveMeta(text) {
  const normalized = normalizeWhitespace(text);
  if (!normalized) return '';
  return normalized
    .replace(OBJECTIVE_TEXT_RE, ' ')
    .replace(/\(\s*цель\s*:\s*[^()]+\)/giu, ' ')
    .replace(/\(\s*objective\s*:\s*[^()]+\)/giu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function shouldRewriteMachineKeyMessage(text) {
  const normalized = normalizeWhitespace(text);
  if (!normalized) return true;
  return MACHINE_KEY_MESSAGE_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function alignToneToObjective(topic = '', tone = 'expert', objective = 'inform') {
  const resolvedTone = normalizeToneKey(tone);
  const resolvedObjective = normalizeObjectiveKey(objective);
  const resolvedTopic = sanitizeTopicTitle(topic);
  if (resolvedTone !== 'humorous') {
    if (resolvedTone === 'official' && resolvedObjective === 'engage') return 'expert';
    return resolvedTone;
  }
  if (SERVICE_OR_TECH_TOPIC_RE.test(resolvedTopic)) return 'expert';
  if (resolvedObjective === 'convert' || resolvedObjective === 'retain') return 'expert';
  if (resolvedObjective === 'educate') return 'friendly';
  return resolvedTone;
}

export function buildNaturalTopicVariation(topic, objective = 'inform', occurrence = 1, index = 0) {
  const baseTopic = sanitizeTopicTitle(topic);
  if (!baseTopic) return '';
  if (occurrence <= 1) return baseTopic;
  const bank = OBJECTIVE_TOPIC_VARIATIONS[normalizeObjectiveKey(objective)] || OBJECTIVE_TOPIC_VARIATIONS.inform;
  const start = (Math.max(0, occurrence - 2) + Math.max(0, index)) % bank.length;
  const separator = /[:!?]$/.test(baseTopic) || baseTopic.includes(':') ? ' — ' : ': ';
  const baseLower = baseTopic.toLowerCase();
  for (let tries = 0; tries < bank.length; tries += 1) {
    const suffix = bank[(start + tries) % bank.length];
    if (!baseLower.includes(suffix.toLowerCase())) {
      return `${baseTopic}${separator}${suffix}`;
    }
  }
  return `${baseTopic}${separator}${bank[start]}`;
}

export function buildObjectiveCta(objective = 'inform', projectName = '', topic = '', index = 0) {
  const resolvedObjective = normalizeObjectiveKey(objective);
  const variants = OBJECTIVE_CTA_BANK[resolvedObjective] || OBJECTIVE_CTA_BANK.inform;
  const topicSeed = sanitizeTopicTitle(topic);
  const variantIndex = hashString(`${resolvedObjective}|${topicSeed}|${projectName}|${index}`) % variants.length;
  let cta = variants[variantIndex];
  const normalizedProject = normalizeWhitespace(projectName);
  if (
    normalizedProject &&
    normalizedProject.length <= 32 &&
    /демонстрацию|обзор|пилот|консультацию/iu.test(cta)
  ) {
    cta = `${cta} ${normalizedProject}`;
  }
  return cta;
}

/** Согласовано с промптом articleDraftPlanBatchPrompt (п.17). */
export const KEY_MESSAGE_MAX_LENGTH = 200;

function truncateKeyMessageAtWord(text, maxLen) {
  const t = normalizeWhitespace(text);
  if (!t || t.length <= maxLen) return t;
  const budget = Math.max(1, maxLen - 3);
  let cut = t.slice(0, budget);
  const sp = cut.lastIndexOf(' ');
  if (sp > Math.floor(maxLen * 0.42)) cut = cut.slice(0, sp);
  return `${cut.trimEnd()}...`;
}

function fitKeyMessageBaseAndSuffix(baseCore, suffixParts, maxLen) {
  const suffix = suffixParts.filter(Boolean).join(' ');
  const suffixSpaced = suffix ? ` ${suffix}` : '';
  const base = normalizeWhitespace(stripObjectiveMeta(baseCore));
  if (!suffixSpaced) return truncateKeyMessageAtWord(base, maxLen);
  if (suffixSpaced.length >= maxLen - 16) {
    return truncateKeyMessageAtWord(`${base}${suffixSpaced}`, maxLen);
  }
  const maxBase = maxLen - suffixSpaced.length;
  const trimmedBase = truncateKeyMessageAtWord(base, maxBase).replace(/\.\.\.$/u, '').trimEnd();
  const out = normalizeWhitespace(`${trimmedBase}${suffixSpaced}`);
  return out.length <= maxLen ? out : truncateKeyMessageAtWord(out, maxLen);
}

export function buildNaturalKeyMessage({
  topic = '',
  objective = 'inform',
  format = 'text',
  tone = 'expert',
  index = 0
} = {}) {
  const resolvedTopic = sanitizeTopicTitle(topic);
  const resolvedObjective = normalizeObjectiveKey(objective);
  const resolvedFormat = normalizeFormatKey(format);
  const resolvedTone = alignToneToObjective(resolvedTopic, tone, resolvedObjective);
  const shortTopic = getCompactTopicForMessage(resolvedTopic) || 'тема публикации';
  const templatesByObjective = {
    inform: [
      `${shortTopic}: показываем, где в процессе теряется качество и что проверить в первую очередь.`,
      `Если «${shortTopic}» кажется второстепенной, именно здесь часто начинается просадка по качеству и скорости.`,
      `Разбираем «${shortTopic}» через прикладной контекст: что меняется на участке и почему это видно в KPI.`,
      `Коротко о главном по «${shortTopic}»: какие решения дают эффект, а какие только создают видимость работы.`,
      `Фокус на «${shortTopic}»: типовые ошибки, метрики контроля и признаки, что процесс реально улучшился.`,
      `Что важно знать о «${shortTopic}» до внедрения: ограничения, роли и критерии готовности.`,
      `Собираем в одном месте факты по «${shortTopic}», чтобы команда могла сравнить варианты без воды.`
    ],
    educate: [
      `${shortTopic}: пошагово — что делать на местах и в каком порядке.`,
      `По «${shortTopic}» важно не только что делать, но и в какой очередности запускать шаги.`,
      `Учимся на «${shortTopic}»: механика, частые ошибки и рабочий порядок действий.`,
      `Разбор «${shortTopic}» для практики: чек-лист, критерии готовности и контрольные точки.`,
      `Объясняем «${shortTopic}» на примере: от постановки задачи до проверки результата.`,
      `Для «${shortTopic}» даём структуру: вводная, ключевые шаги, типовые вопросы аудитории.`,
      `Курс коротко: «${shortTopic}» — как не утонуть в теории и быстрее выйти на рабочий регламент.`
    ],
    engage: [
      `${shortTopic}: повод сравнить подходы команды и обсудить, где практика расходится с привычкой.`,
      `Вокруг «${shortTopic}» редко бывает один «правильный» ответ — выносим на обсуждение живые сценарии.`,
      `На примере «${shortTopic}» предлагаем обсудить, какой вариант даёт меньше потерь и быстрее масштабируется.`,
      `Дискуссия по «${shortTopic}»: какие допущения вы принимаете и где они чаще всего не сходятся с реальностью.`,
      `Открытый вопрос дня — «${shortTopic}»: что бы вы изменили в процессе в первую неделю?`,
      `Сравниваем два рабочих подхода к «${shortTopic}» и просим команду выбрать аргументы за и против.`,
      `Интерактив вокруг «${shortTopic}»: мини-кейс и варианты действий без «идеального ответа».`
    ],
    convert: [
      `${shortTopic}: как тема переводится в экономию времени, денег и управляемости процесса.`,
      `По «${shortTopic}» важен понятный следующий шаг к пилоту и окупаемости, а не общие слова об эффекте.`,
      `Связываем «${shortTopic}» с бизнес-эффектом: что получает производство и где точка входа в проект.`,
      `Для «${shortTopic}» показываем ценность в цифрах и сценарии: до/после и срок окупаемости.`,
      `Коммерческий смысл «${shortTopic}»: что продаём заказчику как результат, а не как «внедрение ради внедрения».`,
      `Практический оффер по «${shortTopic}»: демонстрация, пилот, метрики успеха и риски.`,
      `«${shortTopic}» — от боли к решению: критерии выбора поставщика и чек-лист перед стартом.`
    ],
    retain: [
      `${shortTopic}: как удерживать результат после запуска и не потерять качество на сопровождении.`,
      `В «${shortTopic}» сервис и дисциплина внедрения решают не меньше, чем сам продукт.`,
      `Разговор о «${shortTopic}» там, где нужно сохранить стабильность после первых улучшений.`,
      `После старта по «${shortTopic}»: регламенты, контрольные точки и ответственные роли.`,
      `«${shortTopic}» на сопровождении: что мониторить, чтобы эффект не «растаял» через квартал.`,
      `Удержание качества в «${shortTopic}»: типовые откаты и как их предотвратить.`,
      `Долгий горизонт «${shortTopic}»: обучение смен, замена компонентов и обновление данных.`
    ],
    brand_building: [
      `${shortTopic}: через эту тему видно, насколько зрелой выглядит команда и её подход к задаче.`,
      `«${shortTopic}» — повод показать экспертизу: не обещания, а понятная инженерная логика.`,
      `На «${shortTopic}» удобно показать не лозунги, а уровень проектной культуры и дисциплины.`,
      `Имиджевый кадр «${shortTopic}»: как вы выглядите со стороны заказчика и интегратора.`,
      `«${shortTopic}» как витрина компетенций: методика, стандарты и примеры из практики.`,
      `Сильный бренд в деталях «${shortTopic}»: прозрачность процесса и ответственность за результат.`,
      `Экспертный тон по «${shortTopic}»: факты, ограничения и честные формулировки без пустых обещаний.`
    ]
  };
  const bank = templatesByObjective[resolvedObjective] || templatesByObjective.inform;
  const pick =
    (hashString(`${shortTopic}|${resolvedFormat}|${resolvedTone}|${index}|${resolvedObjective}`) >>> 0) % bank.length;
  const message = bank[pick];
  const suffixParts = [];
  if (resolvedFormat === 'video') suffixParts.push('На видео — шаги и вывод без лишних слов.');
  else if (resolvedFormat === 'image') suffixParts.push('Схема наглядно фиксирует шаги и результат.');
  if (resolvedTone === 'friendly') suffixParts.push('Тон спокойный, по делу.');
  return fitKeyMessageBaseAndSuffix(message, suffixParts, KEY_MESSAGE_MAX_LENGTH);
}

export function calibrateExpectedKpi(
  rawKpi = {},
  { objective = 'inform', format = 'text', tone = 'expert', cta = '' } = {}
) {
  const resolvedObjective = normalizeObjectiveKey(objective);
  const resolvedFormat = normalizeFormatKey(format);
  const resolvedTone = normalizeToneKey(tone);
  const hasCta = normalizeWhitespace(cta).length > 0;

  const formatPriors = {
    text: { engagement_rate: 0.022, reach_potential: 0.28 },
    image: { engagement_rate: 0.026, reach_potential: 0.36 },
    video: { engagement_rate: 0.031, reach_potential: 0.44 },
    combined: { engagement_rate: 0.028, reach_potential: 0.34 }
  };
  const objectivePriors = {
    inform: { engagement_rate: 0.002, conversion_potential: 0.015, reach_potential: 0.03 },
    educate: { engagement_rate: 0.005, conversion_potential: 0.02, reach_potential: 0.01 },
    engage: { engagement_rate: 0.009, conversion_potential: 0.018, reach_potential: 0.0 },
    convert: { engagement_rate: -0.002, conversion_potential: 0.055, reach_potential: -0.03 },
    retain: { engagement_rate: 0.001, conversion_potential: 0.035, reach_potential: -0.02 },
    brand_building: { engagement_rate: 0.006, conversion_potential: 0.022, reach_potential: 0.06 }
  };

  const toneModifiers = {
    expert: { engagement_rate: 0.0, reach_potential: 0.0 },
    friendly: { engagement_rate: 0.002, reach_potential: 0.01 },
    official: { engagement_rate: -0.002, reach_potential: -0.01 },
    inspiring: { engagement_rate: 0.001, reach_potential: 0.015 },
    humorous: { engagement_rate: 0.004, reach_potential: 0.008 },
    neutral: { engagement_rate: -0.001, reach_potential: 0.0 }
  };

  const engagementPrior =
    (formatPriors[resolvedFormat] || formatPriors.text).engagement_rate +
    (objectivePriors[resolvedObjective] || objectivePriors.inform).engagement_rate +
    (toneModifiers[resolvedTone] || toneModifiers.expert).engagement_rate;

  const conversionPrior =
    (objectivePriors[resolvedObjective] || objectivePriors.inform).conversion_potential +
    (hasCta ? 0.012 : -0.006);

  const reachPrior =
    (formatPriors[resolvedFormat] || formatPriors.text).reach_potential +
    (objectivePriors[resolvedObjective] || objectivePriors.inform).reach_potential +
    (toneModifiers[resolvedTone] || toneModifiers.expert).reach_potential;

  const engagementRaw = Number(rawKpi?.engagement_rate);
  const conversionRaw = Number(rawKpi?.conversion_potential);
  const reachRaw = Number(rawKpi?.reach_potential);

  const engagementRate = Number.isFinite(engagementRaw)
    ? Math.min(0.085, Math.max(0.008, engagementRaw * 0.55 + engagementPrior * 0.45))
    : engagementPrior;
  const conversionPotential = Number.isFinite(conversionRaw)
    ? Math.min(0.14, Math.max(0.004, conversionRaw * 0.5 + conversionPrior * 0.5))
    : conversionPrior;
  const reachPotential = Number.isFinite(reachRaw)
    ? Math.min(0.78, Math.max(0.12, reachRaw * 0.6 + reachPrior * 0.4))
    : reachPrior;

  return {
    engagement_rate: round3(engagementRate),
    conversion_potential: round3(conversionPotential),
    reach_potential: round3(reachPotential),
    engagement_band: scoreBand(engagementRate, [0.018, 0.032, 0.048]),
    conversion_band: scoreBand(conversionPotential, [0.015, 0.032, 0.055]),
    reach_band: scoreBand(reachPotential, [0.24, 0.38, 0.52]),
    scoring_mode: 'relative_model_score'
  };
}

function scoreBand(value, thresholds = []) {
  if (value >= thresholds[2]) return 'high';
  if (value >= thresholds[1]) return 'medium';
  if (value >= thresholds[0]) return 'baseline';
  return 'low';
}
