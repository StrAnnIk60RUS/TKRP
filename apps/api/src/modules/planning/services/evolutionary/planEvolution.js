import { buildPlanFeatureMap, buildPlanFeatureVector } from '../../../ml/services/ml/ontologyFeatureEngineering.js';
import { predictPlanMetricsByFeatureVectors } from '../../../ml/services/relevancePredictionService.js';
import { buildOntologyFromSnapshot } from '../../../precedents/services/ontologyAggregationService.js';
import { runAsyncGeneticAlgorithm } from './asyncGaCore.js';
import { cloneJson, onePointCrossoverArrays, randomReplaceMutation, twoPointCrossoverArrays, uniformCrossoverArrays } from './operators.js';
import { normalizePublicationToneValue } from '../../routes/shared/planUtils.js';

function asNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clamp01(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(1, numeric));
}

function clampProbability(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(1, numeric));
}

function uniqueDomain(values = []) {
  return Array.from(new Set(values.filter(Boolean).map((value) => String(value)))).slice(0, 80);
}

function normalizeKey(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeTitle(value) {
  const title = String(value || '').trim().replace(/\s+/g, ' ');
  return title || '';
}

function toReadablePhrase(value) {
  return String(value || '')
    .trim()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function buildTitleContextTokenSet(publication = {}) {
  return new Set([
    ...tokenizeText(publication?.topic),
    ...tokenizeText(publication?.key_message),
    ...tokenizeText(publication?.objective)
  ]);
}

function titleMatchesPublicationContext(title, publication) {
  const titleTokens = tokenizeText(title);
  if (!titleTokens.length) return false;
  const contextTokens = buildTitleContextTokenSet(publication);
  if (!contextTokens.size) return true;
  const overlap = titleTokens.filter((token) => contextTokens.has(token)).length;
  return overlap / titleTokens.length >= 0.34;
}

function buildContextAwareTitle(publication, index) {
  const topic = toReadablePhrase(publication?.topic);
  const objective = toReadablePhrase(publication?.objective);
  if (topic && objective) return `${topic}: ${objective}`;
  if (topic) return topic;
  if (objective) return `Пост: ${objective}`;
  return `Пост ${index + 1}`;
}

function buildPublicationTitle(publication, index) {
  const currentTitle = normalizeTitle(publication?.title);
  if (currentTitle && titleMatchesPublicationContext(currentTitle, publication)) {
    return currentTitle;
  }

  return buildContextAwareTitle(publication, index);
}

function ensureUniquePublicationTitles(publications = []) {
  const usedTitleKeys = new Set();

  return publications.map((publication, index) => {
    const baseTitle = buildPublicationTitle(publication, index);
    let candidateTitle = baseTitle;
    let suffix = 2;

    while (usedTitleKeys.has(normalizeKey(candidateTitle))) {
      candidateTitle = `${baseTitle} — ${suffix}`;
      suffix += 1;
    }

    usedTitleKeys.add(normalizeKey(candidateTitle));

    return {
      ...publication,
      title: candidateTitle
    };
  });
}

function uniqueNormalized(values = []) {
  return Array.from(new Set(values.map((value) => normalizeKey(value)).filter(Boolean)));
}

function buildFrequencyMap(values = []) {
  return values.reduce((acc, value) => {
    const key = normalizeKey(value);
    if (!key) return acc;
    acc.set(key, (acc.get(key) || 0) + 1);
    return acc;
  }, new Map());
}

function averageReliability(items = []) {
  const values = items.map((item) => asNumber(item?.reliability, NaN)).filter((value) => Number.isFinite(value));
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function tokenizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-zа-я0-9\s_-]+/gi, ' ')
    .split(/[\s_-]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

function buildKeywordSet(draftContentPlan, publications = []) {
  const sources = [
    draftContentPlan?.plan_id,
    draftContentPlan?.notes,
    ...(draftContentPlan?.target_audience || []),
    ...(draftContentPlan?.audience_segments || []),
    ...(draftContentPlan?.platforms || []),
    ...publications.flatMap((publication) => [
      publication?.topic,
      publication?.title,
      publication?.summary,
      publication?.key_message
    ])
  ];
  return new Set(sources.flatMap((value) => tokenizeText(value)));
}

function scoreTextRelevance(candidate, keywordSet) {
  const tokens = tokenizeText(candidate);
  if (!tokens.length || !keywordSet?.size) return 0;
  const overlap = tokens.filter((token) => keywordSet.has(token)).length;
  return overlap / tokens.length;
}

function normalizePrecedentPublication(item) {
  if (!item || typeof item !== 'object') return null;
  if (item?.data && typeof item.data === 'object') {
    return {
      data: item.data,
      reliability: asNumber(item.reliability, 0),
      score: asNumber(item.score, 0)
    };
  }
  return {
    data: item,
    reliability: asNumber(item.reliability, 0),
    score: asNumber(item.score, 0)
  };
}

function buildPrecedentContext(precedentPublications = [], draftContentPlan = {}) {
  const normalized = precedentPublications.map(normalizePrecedentPublication).filter(Boolean);
  const rawPublications = normalized.map((item) => item.data).filter(Boolean);
  const ontology = buildOntologyFromSnapshot({
    publications: rawPublications,
    content_plans: []
  });

  const reliablePublications = normalized.filter((item) => item.reliability >= 0.55 || item.score >= 0.6);

  return {
    normalized,
    rawPublications,
    reliablePublications: reliablePublications.length ? reliablePublications : normalized,
    avgReliability: averageReliability(normalized)
  };
}

function parseDate(value) {
  if (!value || typeof value !== 'string') return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function resolvePlanningHorizon(draftContentPlan, constraints = {}) {
  const startDate = constraints?.date_min || draftContentPlan?.planning_horizon?.start_date || null;
  const endDate = constraints?.date_max || draftContentPlan?.planning_horizon?.end_date || null;
  const explicitDuration = asNumber(draftContentPlan?.planning_horizon?.duration_days, 0) || asNumber(constraints?.duration_days, 0);

  const parsedStart = parseDate(startDate);
  const parsedEnd = parseDate(endDate);
  const derivedDuration = parsedStart && parsedEnd
    ? Math.max(1, Math.round((parsedEnd.getTime() - parsedStart.getTime()) / 86400000) + 1)
    : 0;

  return {
    start_date: startDate,
    end_date: endDate,
    duration_days: explicitDuration || derivedDuration || 30
  };
}

function resolveTargetPostCount(draftContentPlan, constraints = {}) {
  const horizonDays = resolvePlanningHorizon(draftContentPlan, constraints).duration_days;
  const postsPerWeek = asNumber(constraints.posts_per_week, 0);
  const minPublications = Math.max(0, asNumber(constraints.min_publications, 0));
  const requestedByWeek = postsPerWeek > 0 ? Math.max(1, Math.round((postsPerWeek * horizonDays) / 7)) : null;
  if (requestedByWeek !== null) {
    return Math.max(requestedByWeek, minPublications || 1);
  }
  return Math.max(1, minPublications || draftContentPlan?.publications?.length || 1);
}

function buildDomains(draftContentPlan, precedentContext = {}) {
  const draftPublications = Array.isArray(draftContentPlan?.publications) ? draftContentPlan.publications : [];
  const fromPrecedents = (precedentContext.reliablePublications || []).map((item) => item?.data?.publication_model || item?.data || {});
  const fromDraft = draftPublications;
  const draftTopics = uniqueDomain(fromDraft.map((item) => item.topic));
  const precedentTopics = uniqueDomain(fromPrecedents.map((item) => item.topic));
  const keywordSet = buildKeywordSet(draftContentPlan, fromDraft);
  const relevantPrecedentTopics = precedentTopics.filter((topic) => scoreTextRelevance(topic, keywordSet) >= 0.25);
  const topicDomain = draftTopics.length
    ? uniqueDomain([...draftTopics, ...relevantPrecedentTopics.slice(0, Math.max(4, draftTopics.length))])
    : uniqueDomain(relevantPrecedentTopics.length ? relevantPrecedentTopics : precedentTopics);
  
  return [
    topicDomain,
    uniqueDomain([...fromDraft.map((item) => item.format), ...fromPrecedents.map((item) => item.format)]),
    uniqueDomain([...fromDraft.map((item) => item.objective), ...fromPrecedents.map((item) => item.objective)]),
    uniqueDomain([...fromDraft.map((item) => item.tone), ...fromPrecedents.map((item) => item.tone)])
  ];
}

function expandBasePublications(draftContentPlan, targetCount) {
  const base = Array.isArray(draftContentPlan?.publications) ? draftContentPlan.publications : [];
  return Array.from({ length: targetCount }, (_, index) => {
    const source = cloneJson(base[index % Math.max(1, base.length)] || {});
    return {
      ...source,
      publication_id: source.publication_id || `evo_publication_${String(index + 1).padStart(3, '0')}`
    };
  });
}

const EVO_MIN_SUMMARY_LENGTH = {
  text: 650,
  combined: 650,
  image: 400,
  video: 400
};

const OBJECTIVE_HINT_RU = {
  inform: 'даём полезную информацию и контекст',
  educate: 'обучаем аудиторию и объясняем детали',
  engage: 'вовлекаем через практику и обсуждение',
  convert: 'показываем ценность и следующий шаг к сделке',
  retain: 'укрепляем доверие и долгосрочные отношения',
  brand_building: 'усиливаем узнаваемость и экспертный образ бренда'
};

const SERVICE_TOPIC_TONE_BLOCKLIST =
  /постгарант|гарантий|сервис|обслуживан|ремонт|sla|простой|запчаст/u;

const TECHNICAL_TOPIC_PATTERN =
  /характеристик|спецификац|регистратор|датчик|точност|калибр|сертификат|измерен|диапазон|чувствительн|аналогов|цифров|интерфейс\s*связи|specification|datasheet|calibration|sensor|accuracy|interface/u;

function normalizeFormatForSummary(format) {
  const f = String(format || 'text').toLowerCase();
  if (f === 'combined') return 'combined';
  if (f === 'image' || f === 'video') return f;
  return 'text';
}

function adjustToneForTopicContext(topic, tone) {
  const t = String(tone || 'expert').toLowerCase();
  if (t !== 'humorous') return tone;
  const topicStr = String(topic || '');
  if (SERVICE_TOPIC_TONE_BLOCKLIST.test(topicStr)) return 'expert';
  if (TECHNICAL_TOPIC_PATTERN.test(topicStr)) return 'expert';
  return tone;
}

function buildSyncedKeyMessage(resolvedTopic, resolvedObjective, index = 0) {
  const topicPhrase = toReadablePhrase(resolvedTopic).slice(0, 90);
  const hint = OBJECTIVE_HINT_RU[normalizeKey(resolvedObjective)] || OBJECTIVE_HINT_RU.inform;
  const mod = ((index % 3) + 3) % 3;
  let raw;
  if (mod === 0) {
    raw = `${topicPhrase}: ${hint}.`;
  } else if (mod === 1) {
    raw = `Почему сейчас актуален вопрос «${topicPhrase}»? ${hint.charAt(0).toUpperCase()}${hint.slice(1)}.`;
  } else {
    raw = `В фокусе: ${topicPhrase} — ${hint}.`;
  }
  return raw.length <= 200 ? raw : `${raw.slice(0, 197)}...`;
}

function padEvoSummaryBody(core, minLength) {
  const pad =
    ' Раскрываем практические детали, типовые сценарии внедрения и измеримый эффект для производства. Добавляем конкретные шаги и мягкий призыв к диалогу в комментариях.';
  let out = core;
  while (out.length < minLength) {
    out = `${out}${pad}`;
  }
  return out.slice(0, 2200).trim();
}

function buildSyncedSummary(resolvedTopic, resolvedObjective, resolvedFormat, index = 0) {
  const fmt = normalizeFormatForSummary(resolvedFormat);
  const minLen = EVO_MIN_SUMMARY_LENGTH[fmt] || EVO_MIN_SUMMARY_LENGTH.text;
  const topicPhrase = toReadablePhrase(resolvedTopic);
  const hint = OBJECTIVE_HINT_RU[normalizeKey(resolvedObjective)] || OBJECTIVE_HINT_RU.inform;
  const mod = ((index % 3) + 3) % 3;
  const cores = [
    `В этом материале разбираем тему: ${topicPhrase}. Цель публикации — ${hint}. Описываем контекст задачи на производстве, типовые боли аудитории и практический подход к решению. Приводим ориентиры по внедрению и ожидаемый результат для команды.`,
    `Разбираем на практике: ${topicPhrase}. Задача материала — ${hint}. Показываем контекст на производстве, шаги проверки и ожидаемый эффект для команды.`,
    `Погружаемся в тему «${topicPhrase}». ${hint.charAt(0).toUpperCase()}${hint.slice(1)}. Даём прикладной контекст, примеры и ориентиры по внедрению для целевой аудитории.`
  ];
  const core = cores[mod];
  return padEvoSummaryBody(core, minLen);
}

function syncBodyFieldsAfterGeneChange(base, resolvedTopic, resolvedObjective, resolvedFormat, index) {
  const topicChanged = normalizeKey(resolvedTopic) !== normalizeKey(base.topic);
  const objectiveChanged = normalizeKey(resolvedObjective) !== normalizeKey(base.objective);
  if (!topicChanged && !objectiveChanged) {
    return { key_message: base.key_message, summary: base.summary };
  }
  return {
    key_message: buildSyncedKeyMessage(resolvedTopic, resolvedObjective, index),
    summary: buildSyncedSummary(resolvedTopic, resolvedObjective, resolvedFormat, index)
  };
}

function applyGenomeToPlan(basePublications, draftContentPlan, genome, planningHorizon, precedentContext = {}) {
  const publications = genome.map((gene, index) => {
    const [topic, format, objective, tone, hasCta, creativity] = Array.isArray(gene) ? gene : [];
    const base = cloneJson(basePublications[index] || {});
    const nextCreativity = clamp01(creativity, asNumber(base?.ontology_features?.creativity, 0.5));
    const resolvedTopic = topic ?? base.topic ?? `topic_${index + 1}`;
    const resolvedFormat = format ?? base.format ?? 'text';
    const resolvedObjective = objective ?? base.objective ?? 'inform';
    const resolvedTone = normalizePublicationToneValue(
      adjustToneForTopicContext(resolvedTopic, tone ?? base.tone ?? 'expert'),
      'expert'
    );
    const { key_message, summary } = syncBodyFieldsAfterGeneChange(
      base,
      resolvedTopic,
      resolvedObjective,
      resolvedFormat,
      index
    );

    return {
      ...base,
      publication_id: base.publication_id || `evo_publication_${String(index + 1).padStart(3, '0')}`,
      topic: resolvedTopic,
      format: resolvedFormat,
      objective: resolvedObjective,
      tone: resolvedTone,
      key_message,
      summary,
      platform: base.platform || draftContentPlan?.platforms?.[0] || null,
      cta: hasCta ? base.cta || 'Свяжитесь с нами, чтобы получить детали.' : '',
      ontology_features: {
        ...(base.ontology_features || {}),
        has_cta: hasCta ? 1 : 0,
        creativity: nextCreativity
      }
    };
  });
  const publicationsWithUniqueTitles = ensureUniquePublicationTitles(publications);

  return {
    ...draftContentPlan,
    planning_horizon: {
      ...(draftContentPlan?.planning_horizon || {}),
      ...(planningHorizon || {})
    },
    publications: publicationsWithUniqueTitles
  };
}

function capPlanPredictedMetrics(predictedMetrics, metadata = null) {
  const [likes, shares, views] = predictedMetrics;
  const maxLikes = asNumber(metadata?.target_summary?.total_likes?.max, 0);
  const maxShares = asNumber(metadata?.target_summary?.total_shares?.max, 0);
  const maxViews = asNumber(metadata?.target_summary?.total_views?.max, 0);
  
  return {
    cappedLikes: maxLikes > 0 ? Math.min(likes, maxLikes) : likes,
    cappedShares: maxShares > 0 ? Math.min(shares, maxShares) : shares,
    cappedViews: maxViews > 0 ? Math.min(views, maxViews) : views
  };
}

function normalizeAgainstTarget(value, targetMax) {
  const safeValue = Math.max(0, asNumber(value, 0));
  const safeTarget = Math.max(0, asNumber(targetMax, 0));

  if (safeTarget > 0) {
    // Keep ranking sensitivity above historical max values instead of hard clipping to 1.
    return Math.min(1, Math.log1p(safeValue) / Math.log1p(safeTarget * 10));
  }
  return Math.tanh(Math.log1p(safeValue) / 8);
}

// Веса для фитнес-функции (можно вынести в конфиг)
const FITNESS_WEIGHTS = {
  likes: 0.5,
  shares: 0.3,
  views: 0.2
};

function buildNormalizedFrequencyMap(values = []) {
  const freq = buildFrequencyMap(values);
  const total = Array.from(freq.values()).reduce((sum, value) => sum + value, 0);
  return {
    freq,
    total
  };
}

function normalizedUniqueness(values = []) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  return uniqueNormalized(values).length / values.length;
}

function normalizedEntropy(values = []) {
  if (!Array.isArray(values) || values.length <= 1) return 0;
  const { freq, total } = buildNormalizedFrequencyMap(values);
  const uniqueCount = freq.size;
  if (uniqueCount <= 1 || total <= 1) return 0;

  const entropy = Array.from(freq.values()).reduce((acc, count) => {
    const p = count / total;
    return acc - p * Math.log(p);
  }, 0);
  const maxEntropy = Math.log(uniqueCount);
  if (maxEntropy <= 0) return 0;
  return clamp01(entropy / maxEntropy, 0);
}

function maxRepeatSpread(values = []) {
  if (!Array.isArray(values) || values.length <= 1) return 1;
  const freq = buildFrequencyMap(values);
  const maxCount = Math.max(0, ...Array.from(freq.values()));
  return clamp01(1 - (maxCount - 1) / (values.length - 1), 0);
}

const CTA_MIN_SHARE = 0.7;
const CTA_MAX_SHARE = 0.8;
const CTA_TARGET_SHARE = 0.75;
const CTA_VARIANTS = [
  'Запросить демо',
  'Записаться на консультацию',
  'Заказать аудит участка',
  'Запустить пилот на 2 недели'
];

function calculateCtaBounds(totalPublications) {
  const minCount = Math.max(1, Math.ceil(totalPublications * CTA_MIN_SHARE));
  const maxCount = Math.max(minCount, Math.floor(totalPublications * CTA_MAX_SHARE));
  const targetCount = Math.min(
    maxCount,
    Math.max(minCount, Math.round(totalPublications * CTA_TARGET_SHARE))
  );
  return { minCount, maxCount, targetCount };
}

function buildEvolutionCtaText(objective = 'inform') {
  const objectiveMap = {
    inform: 0,
    educate: 1,
    engage: 2,
    convert: 0,
    retain: 3,
    brand_building: 1
  };
  const variantIndex = objectiveMap[normalizeKey(objective)] ?? 0;
  return CTA_VARIANTS[variantIndex];
}

function enforceCtaCoverage(publications = [], lockedFields = {}) {
  if (!Array.isArray(publications) || publications.length === 0) return publications;
  if (lockedFields?.has_cta !== undefined) {
    const forceHasCta = lockedFields.has_cta ? 1 : 0;
    return publications.map((publication) => ({
      ...publication,
      cta: forceHasCta ? buildEvolutionCtaText(publication?.objective) : '',
      ontology_features: {
        ...(publication?.ontology_features || {}),
        has_cta: forceHasCta
      }
    }));
  }

  const { targetCount } = calculateCtaBounds(publications.length);
  const next = publications.map((publication) => ({ ...publication }));
  const activeIndices = [];
  const inactiveIndices = [];

  next.forEach((publication, index) => {
    const hasCta = asNumber(publication?.ontology_features?.has_cta, 0) > 0
      || Boolean(String(publication?.cta || '').trim());
    if (hasCta) activeIndices.push(index);
    else inactiveIndices.push(index);
  });

  while (activeIndices.length < targetCount && inactiveIndices.length) {
    activeIndices.push(inactiveIndices.shift());
  }
  while (activeIndices.length > targetCount) {
    inactiveIndices.unshift(activeIndices.pop());
  }

  const activeSet = new Set(activeIndices);
  return next.map((publication, index) => {
    const hasCta = activeSet.has(index);
    return {
      ...publication,
      cta: hasCta ? buildEvolutionCtaText(publication?.objective) : '',
      ontology_features: {
        ...(publication?.ontology_features || {}),
        has_cta: hasCta ? 1 : 0
      }
    };
  });
}

function scorePlanDiversity(publications = []) {
  if (!Array.isArray(publications) || publications.length <= 1) return 0;

  const topics = publications.map((item) => item?.topic);
  const objectives = publications.map((item) => item?.objective);
  const formats = publications.map((item) => item?.format);
  const tones = publications.map((item) => item?.tone);
  const topicObjectiveFormatCombos = publications.map((item) =>
    [item?.topic, item?.objective, item?.format].map((part) => normalizeKey(part)).join('::')
  );

  const components = {
    topic_uniqueness: normalizedUniqueness(topics),
    topic_entropy: normalizedEntropy(topics),
    topic_repeat_spread: maxRepeatSpread(topics),
    combo_uniqueness: normalizedUniqueness(topicObjectiveFormatCombos),
    objective_uniqueness: normalizedUniqueness(objectives),
    format_uniqueness: normalizedUniqueness(formats),
    tone_uniqueness: normalizedUniqueness(tones)
  };

  const diversityScore =
    components.topic_uniqueness * 0.3 +
    components.topic_entropy * 0.2 +
    components.topic_repeat_spread * 0.2 +
    components.combo_uniqueness * 0.15 +
    components.objective_uniqueness * 0.075 +
    components.format_uniqueness * 0.05 +
    components.tone_uniqueness * 0.025;

  return clamp01(diversityScore, 0);
}

function topicStemKey(topic) {
  const key = normalizeKey(topic);
  if (!key) return '';
  return key.length > 96 ? key.slice(0, 96) : key;
}

function scoreTopicStemSpread(publications = []) {
  if (!Array.isArray(publications) || publications.length <= 1) return 1;
  const stems = publications.map((item) => topicStemKey(item?.topic));
  const freq = buildFrequencyMap(stems);
  const maxRepeat = Math.max(0, ...Array.from(freq.values()));
  const n = publications.length;
  const concentration = (maxRepeat - 1) / Math.max(1, n - 1);
  return clamp01(1 - concentration * 0.55, 0);
}

function calculateFitness(predictedMetrics, metadata, publications = [], options = {}) {
  const { cappedLikes, cappedShares, cappedViews } = capPlanPredictedMetrics(predictedMetrics, metadata);
  
  const maxLikes = metadata?.target_summary?.total_likes?.max || 1;
  const maxShares = metadata?.target_summary?.total_shares?.max || 1;
  const maxViews = metadata?.target_summary?.total_views?.max || 1;
  
  const normLikes = normalizeAgainstTarget(cappedLikes, maxLikes);
  const normShares = normalizeAgainstTarget(cappedShares, maxShares);
  const normViews = normalizeAgainstTarget(cappedViews, maxViews);

  const kpiScore =
    FITNESS_WEIGHTS.likes * normLikes +
    FITNESS_WEIGHTS.shares * normShares +
    FITNESS_WEIGHTS.views * normViews;

  const diversityScore = scorePlanDiversity(publications);
  const stemSpreadScore = scoreTopicStemSpread(publications);
  const blendedDiversity = clamp01(diversityScore * 0.78 + stemSpreadScore * 0.22, 0);
  const diversityWeight = clampProbability(options?.diversityWeight, 0.65);
  const kpiWeight = 1 - diversityWeight;

  return kpiWeight * kpiScore + diversityWeight * blendedDiversity;
}

export async function optimizeContentPlanEvolution(draftContentPlan, config = {}) {
  const {
    precedentPublications = [],
    constraints = {},
    ga = {},
    lockedFields = {}
  } = config;
  const diversityWeight = clampProbability(
    ga?.diversityWeight ?? constraints?.diversity_weight ?? draftContentPlan?.constraints?.diversity_weight,
    0.65
  );

  const crossoverMethod = ga.crossoverMethod || 'one_point';
  const mutationMethod = ga.mutationMethod || 'random_replace';

  let crossoverFn;
  switch (crossoverMethod) {
    case 'two_point':
      crossoverFn = twoPointCrossoverArrays;
      break;
    case 'uniform':
      crossoverFn = uniformCrossoverArrays;
      break;
    case 'one_point':
    default:
      crossoverFn = onePointCrossoverArrays;
  }

  let mutateFn;
  switch (mutationMethod) {
    case 'inversion':
      mutateFn = (individual, rng) => inversionMutation(individual, rng);
      break;
    case 'random_replace':
    default:
      mutateFn = (individual, rng) => {
        if (!Array.isArray(individual) || individual.length === 0) return cloneJson(individual);
        const slotIndex = Math.floor(rng() * individual.length);
        const next = cloneJson(individual);
        next[slotIndex] = randomReplaceMutation(next[slotIndex], geneDomains, rng);
        return next;
      };
  }

  const precedentContext = buildPrecedentContext(precedentPublications, draftContentPlan);
  const planningHorizon = resolvePlanningHorizon(draftContentPlan, constraints);
  const targetPostCount = resolveTargetPostCount(draftContentPlan, constraints);
  
  const domains = buildDomains(draftContentPlan, precedentContext);
  const basePublications = expandBasePublications(draftContentPlan, targetPostCount);
  
  const allowedFormats = lockedFields.formats || (Array.isArray(draftContentPlan?.allowed_formats) ? draftContentPlan.allowed_formats : []);
  const allowedPlatforms = lockedFields.platforms || (Array.isArray(draftContentPlan?.platforms) ? draftContentPlan.platforms : []);
  
  const CTA_GENE_VALUES = [0, 1];
  const CREATIVITY_GENE_VALUES = [0.25, 0.5, 0.75, 1];
  const geneDomains = [...domains, CTA_GENE_VALUES, CREATIVITY_GENE_VALUES];

  const createPublicationGene = (rng, fallback = {}) => {
    let topic = domains[0][Math.floor(rng() * Math.max(1, domains[0].length))] || fallback.topic || 'unspecified';
    let format = domains[1][Math.floor(rng() * Math.max(1, domains[1].length))] || fallback.format || 'text';
    let objective = domains[2][Math.floor(rng() * Math.max(1, domains[2].length))] || fallback.objective || 'inform';
    let tone = domains[3][Math.floor(rng() * Math.max(1, domains[3].length))] || fallback.tone || 'expert';
    let hasCta = CTA_GENE_VALUES[Math.floor(rng() * CTA_GENE_VALUES.length)] ?? (fallback?.ontology_features?.has_cta ? 1 : 0);
    let creativity = CREATIVITY_GENE_VALUES[Math.floor(rng() * CREATIVITY_GENE_VALUES.length)] ?? clamp01(fallback?.ontology_features?.creativity, 0.5);
    
    // Принудительно устанавливаем заблокированные поля
    if (lockedFields.topic && fallback.topic) topic = fallback.topic;
    if (lockedFields.format && fallback.format && allowedFormats.includes(fallback.format)) format = fallback.format;
    if (lockedFields.platform && fallback.platform && allowedPlatforms.includes(fallback.platform)) {
      // platform не в геноме, но проверяем при создании
    }
    if (lockedFields.objective && fallback.objective) objective = fallback.objective;
    if (lockedFields.tone && fallback.tone) tone = fallback.tone;
    if (lockedFields.has_cta !== undefined) hasCta = lockedFields.has_cta ? 1 : 0;
    if (lockedFields.creativity !== undefined) creativity = lockedFields.creativity;
    
    return [topic, format, objective, tone, hasCta, creativity];
  };

  const createIndividual = (rng) => basePublications.map((publication) => createPublicationGene(rng, publication));
  const cloneIndividual = (individual) => cloneJson(individual);
  const crossover = (left, right, rng) => crossoverFn(left, right, rng);
  const applyLockedFieldsToGene = (gene, slotIndex) => {
    const nextGene = Array.isArray(gene) ? cloneJson(gene) : cloneJson(createPublicationGene(Math.random, basePublications[slotIndex]));
    if (lockedFields.topic && basePublications[slotIndex]?.topic) {
      nextGene[0] = basePublications[slotIndex].topic;
    }
    if (
      lockedFields.format &&
      basePublications[slotIndex]?.format &&
      allowedFormats.includes(basePublications[slotIndex].format)
    ) {
      nextGene[1] = basePublications[slotIndex].format;
    }
    if (lockedFields.objective && basePublications[slotIndex]?.objective) {
      nextGene[2] = basePublications[slotIndex].objective;
    }
    if (lockedFields.tone && basePublications[slotIndex]?.tone) {
      nextGene[3] = basePublications[slotIndex].tone;
    }
    if (lockedFields.has_cta !== undefined) {
      nextGene[4] = lockedFields.has_cta ? 1 : 0;
    }
    if (lockedFields.creativity !== undefined) {
      nextGene[5] = lockedFields.creativity;
    }
    return nextGene;
  };
  const mutate = (individual, rng) => {
    if (!Array.isArray(individual) || individual.length === 0) return cloneJson(individual);
    const slotIndex = Math.floor(rng() * individual.length);
    const next = cloneJson(individual);
    next[slotIndex] = mutateFn(next[slotIndex], rng);
    next[slotIndex] = applyLockedFieldsToGene(next[slotIndex], slotIndex);
    return next;
  };

  const traces = [];
  
  const result = await runAsyncGeneticAlgorithm({
    direction: 'max',
    seed: ga.seed ?? null,
    populationSize: ga.populationSize ?? 64,
    maxGenerations: ga.maxGenerations ?? 80,
    stagnationGenerations: ga.stagnationGenerations ?? 20,
    eliteSize: ga.eliteSize ?? 4,
    tournamentSize: ga.tournamentSize ?? 5,
    crossoverProbability: ga.crossoverProbability ?? 0.9,
    mutationProbability: ga.mutationProbability ?? 0.08,
    selectionMethod: ga.selectionMethod || 'tournament',
    createIndividual,
    cloneIndividual,
    crossover,
    mutate,
    cacheKeyForIndividual: (individual) => JSON.stringify(individual),
    minImprovementEpsilon: ga.minImprovementEpsilon ?? 1e-4,
    minImprovementGenerations: ga.minImprovementGenerations ?? 4,
    scorePopulation: async (population) => {
      const candidatePlans = population.map((genome) =>
        applyGenomeToPlan(basePublications, draftContentPlan, genome, planningHorizon, precedentContext)
      );
      
      const featureVectors = candidatePlans.map((plan) => buildPlanFeatureVector(plan.publications, {
        durationDays: planningHorizon.duration_days,
        startDate: planningHorizon.start_date,
        endDate: planningHorizon.end_date,
        expectedPlatforms: lockedFields.platforms || draftContentPlan?.platforms || [],
        targetAudience: draftContentPlan?.target_audience || []
      }));
      
      const predictionResult = await predictPlanMetricsByFeatureVectors(featureVectors, { forceTrain: false });
      
      return predictionResult.predictions.map((predictedMetrics, index) => {
        const fitness = calculateFitness(
          predictedMetrics,
          predictionResult.metadata,
          candidatePlans[index]?.publications || [],
          { diversityWeight }
        );
        
        return {
          score: fitness,
          meta: {
            predicted_likes: predictedMetrics[0],
            predicted_shares: predictedMetrics[1],
            predicted_views: predictedMetrics[2],
            fitness
          }
        };
      });
    },
    onGeneration: (entry) => {
      traces.push(entry);
      console.log('[GA:content-plan]', JSON.stringify({
        generation: entry.generation,
        best_score: entry.best_score,
        generation_best_score: entry.generation_best_score,
        avg_score: entry.generation_avg_score,
        summary: entry.best_meta
      }));
    }
  });

  const optimizedPlan = applyGenomeToPlan(
    basePublications,
    draftContentPlan,
    result.best || createIndividual(Math.random),
    planningHorizon,
    precedentContext
  );
  optimizedPlan.publications = enforceCtaCoverage(optimizedPlan.publications, lockedFields);
  
  const featureMap = buildPlanFeatureMap(optimizedPlan.publications, {
    durationDays: planningHorizon.duration_days,
    startDate: planningHorizon.start_date,
    endDate: planningHorizon.end_date,
    expectedPlatforms: lockedFields.platforms || draftContentPlan?.platforms || [],
    targetAudience: draftContentPlan?.target_audience || []
  });

  return {
    optimizedPlan,
    planFeatureMap: featureMap,
    predictedLikes: asNumber(result.best_meta?.predicted_likes, 0),
    predictedShares: asNumber(result.best_meta?.predicted_shares, 0),
    predictedViews: asNumber(result.best_meta?.predicted_views, 0),
    ga: {
      ...result,
      history: traces
    }
  };
}