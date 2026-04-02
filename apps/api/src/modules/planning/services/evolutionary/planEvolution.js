import { buildPlanFeatureMap, buildPlanFeatureVector } from '../../../ml/services/ml/ontologyFeatureEngineering.js';
import { predictContentPlanLikesByFeatureVectors } from '../../../ml/services/relevancePredictionService.js';
import { buildOntologyFromSnapshot } from '../../../precedents/services/ontologyAggregationService.js';
import { runAsyncGeneticAlgorithm } from './asyncGaCore.js';
import { cloneJson, onePointCrossoverArrays, randomReplaceMutation,
  twoPointCrossoverArrays,    // НОВЫЙ
  uniformCrossoverArrays,     // НОВЫЙ
  inversionMutation      } from './operators.js';

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

const CTA_GENE_VALUES = [0, 1];
const CREATIVITY_GENE_VALUES = [0.25, 0.5, 0.75, 1];
const TOKEN_STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'from',
  'into',
  'your',
  'this',
  'that',
  'как',
  'для',
  'или',
  'это',
  'что',
  'про'
]);

function uniqueDomain(values = []) {
  return Array.from(new Set(values.filter(Boolean).map((value) => String(value)))).slice(0, 80);
}

function normalizeKey(value) {
  return String(value || '').trim().toLowerCase();
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

function ratioOfMatching(values = [], allowedSet = new Set()) {
  const normalized = uniqueNormalized(values);
  if (!normalized.length || !allowedSet.size) return 0;
  return normalized.filter((value) => allowedSet.has(value)).length / normalized.length;
}

function distributionSimilarity(leftValues = [], rightValues = []) {
  const left = buildFrequencyMap(leftValues);
  const right = buildFrequencyMap(rightValues);
  const keys = new Set([...left.keys(), ...right.keys()]);
  if (!keys.size) return 0;
  const leftTotal = Array.from(left.values()).reduce((sum, value) => sum + value, 0) || 1;
  const rightTotal = Array.from(right.values()).reduce((sum, value) => sum + value, 0) || 1;
  let distance = 0;
  keys.forEach((key) => {
    distance += Math.abs((left.get(key) || 0) / leftTotal - (right.get(key) || 0) / rightTotal);
  });
  return clamp01(1 - (distance / 2));
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
    .filter((token) => token.length >= 3 && !TOKEN_STOP_WORDS.has(token));
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
  const topicAudienceMap = new Map();
  const formatObjectiveMap = new Map();

  (ontology?.contexts || []).forEach((context) => {
    (context?.triples || []).forEach((triple) => {
      if (triple?.predicate === 'targets_audience') {
        const key = normalizeKey(triple.subject_label);
        if (!topicAudienceMap.has(key)) topicAudienceMap.set(key, new Set());
        topicAudienceMap.get(key).add(normalizeKey(triple.object_label));
      }
      if (triple?.predicate === 'supports_objective') {
        const key = normalizeKey(triple.subject_label);
        if (!formatObjectiveMap.has(key)) formatObjectiveMap.set(key, new Set());
        formatObjectiveMap.get(key).add(normalizeKey(triple.object_label));
      }
    });
  });

  const targetAudience = uniqueNormalized([
    ...(draftContentPlan?.target_audience || []),
    ...(draftContentPlan?.audience_segments || [])
  ]);
  const expectedPlatforms = uniqueNormalized(draftContentPlan?.platforms || []);
  const reliablePublications = normalized.filter((item) => item.reliability >= 0.55 || item.score >= 0.6);

  return {
    normalized,
    rawPublications,
    reliablePublications: reliablePublications.length ? reliablePublications : normalized,
    topicAudienceMap,
    formatObjectiveMap,
    targetAudience,
    expectedPlatforms,
    avgReliability: averageReliability(normalized)
  };
}

function calculateTopicPenalty(plan, featureMap, draftTopics = []) {
  const publications = Array.isArray(plan?.publications) ? plan.publications : [];
  const topicCounts = new Map();
  for (const publication of publications) {
    const key = String(publication?.topic || '').trim().toLowerCase();
    if (!key) continue;
    topicCounts.set(key, (topicCounts.get(key) || 0) + 1);
  }

  const repeatedTopicsPenalty = Array.from(topicCounts.values())
    .map((count) => Math.max(0, count - 1))
    .reduce((sum, value) => sum + value, 0) * 6;

  const allowedDraftTopics = new Set(draftTopics.map((value) => String(value || '').trim().toLowerCase()).filter(Boolean));
  const foreignTopicsPenalty = allowedDraftTopics.size
    ? Array.from(topicCounts.keys()).filter((topic) => !allowedDraftTopics.has(topic)).length * 18
    : 0;

  const targetUniqueTopics = Math.max(1, Math.min(publications.length, allowedDraftTopics.size || featureMap.unique_topics || 1));
  const lowDiversityPenalty = Math.max(0, targetUniqueTopics - asNumber(featureMap.unique_topics, 0)) * 10;

  return repeatedTopicsPenalty + foreignTopicsPenalty + lowDiversityPenalty;
}

function parseDate(value) {
  if (!value || typeof value !== 'string') return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function resolvePlanningHorizon(draftContentPlan, constraints = {}) {
  const startDate =
    constraints?.date_min ||
    draftContentPlan?.planning_horizon?.start_date ||
    null;
  const endDate =
    constraints?.date_max ||
    draftContentPlan?.planning_horizon?.end_date ||
    null;
  const explicitDuration =
    asNumber(draftContentPlan?.planning_horizon?.duration_days, 0) ||
    asNumber(constraints?.duration_days, 0);

  const parsedStart = parseDate(startDate);
  const parsedEnd = parseDate(endDate);
  const derivedDuration =
    parsedStart && parsedEnd
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
  const requestedByWeek = postsPerWeek > 0 ? Math.max(1, Math.round((postsPerWeek * horizonDays) / 7)) : null;
  if (requestedByWeek !== null) {
    return requestedByWeek;
  }
  return Math.max(1, asNumber(constraints.min_publications, 0) || draftContentPlan?.publications?.length || 1);
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

function applyGenomeToPlan(basePublications, draftContentPlan, genome, planningHorizon, precedentContext = {}) {
  const publications = genome.map((gene, index) => {
    const [topic, format, objective, tone, hasCta, creativity] = Array.isArray(gene) ? gene : [];
    const base = cloneJson(basePublications[index] || {});
    const nextCreativity = clamp01(creativity, asNumber(base?.ontology_features?.creativity, 0.5));
    const normalizedTopic = normalizeKey(topic ?? base.topic);
    const inferredAudience = precedentContext.topicAudienceMap?.has(normalizedTopic)
      ? Array.from(precedentContext.topicAudienceMap.get(normalizedTopic))
      : draftContentPlan?.target_audience || base?.audience_segments || [];
    return {
      ...base,
      publication_id: base.publication_id || `evo_publication_${String(index + 1).padStart(3, '0')}`,
      topic: topic ?? base.topic ?? `topic_${index + 1}`,
      format: format ?? base.format ?? 'text',
      objective: objective ?? base.objective ?? 'inform',
      tone: tone ?? base.tone ?? 'expert',
      audience_segments: uniqueDomain(inferredAudience),
      platform: base.platform || draftContentPlan?.platforms?.[0] || null,
      cta: hasCta ? base.cta || 'Свяжитесь с нами, чтобы получить детали.' : '',
      ontology_features: {
        ...(base.ontology_features || {}),
        has_cta: hasCta ? 1 : 0,
        creativity: nextCreativity
      }
    };
  });

  return {
    ...draftContentPlan,
    planning_horizon: {
      ...(draftContentPlan?.planning_horizon || {}),
      ...(planningHorizon || {})
    },
    publications
  };
}

function calculateAudienceAlignment(plan, precedentContext = {}) {
  const targetAudience = new Set(precedentContext.targetAudience || []);
  if (!targetAudience.size) return 0.5;
  const publications = Array.isArray(plan?.publications) ? plan.publications : [];
  if (!publications.length) return 0;
  const perPublication = publications.map((publication) => {
    const audience = uniqueNormalized(publication?.audience_segments || publication?.target_audience || []);
    if (!audience.length) {
      const topicAudience = precedentContext.topicAudienceMap?.get(normalizeKey(publication?.topic)) || new Set();
      const topicAudienceValues = Array.from(topicAudience);
      if (!topicAudienceValues.length) return 0;
      return ratioOfMatching(topicAudienceValues, targetAudience);
    }
    return ratioOfMatching(audience, targetAudience);
  });
  return clamp01(perPublication.reduce((sum, value) => sum + value, 0) / perPublication.length);
}

function calculateObjectiveCoverage(plan, draftPlan = {}) {
  const draftObjectives = uniqueNormalized((draftPlan?.publications || []).map((item) => item?.objective));
  const candidateObjectives = uniqueNormalized((plan?.publications || []).map((item) => item?.objective));
  if (!candidateObjectives.length) return 0;
  if (!draftObjectives.length) return 0.5;
  const draftSet = new Set(draftObjectives);
  const candidateSet = new Set(candidateObjectives);
  const covered = draftObjectives.filter((value) => candidateSet.has(value)).length / draftObjectives.length;
  const precision = candidateObjectives.filter((value) => draftSet.has(value)).length / candidateObjectives.length;
  return clamp01((covered * 0.65) + (precision * 0.35));
}

function calculateFormatMixFit(plan, draftPlan = {}, precedentContext = {}) {
  const candidateFormats = (plan?.publications || []).map((item) => item?.format);
  const draftFormats = (draftPlan?.publications || []).map((item) => item?.format);
  const precedentFormats = (precedentContext.reliablePublications || []).map(
    (item) => item?.data?.publication_model?.format || item?.data?.format
  );
  const draftSimilarity = distributionSimilarity(candidateFormats, draftFormats);
  const precedentSimilarity = distributionSimilarity(candidateFormats, precedentFormats);
  return clamp01((draftSimilarity * 0.55) + (precedentSimilarity * 0.45));
}

function calculateOntologyConsistency(plan, precedentContext = {}) {
  const publications = Array.isArray(plan?.publications) ? plan.publications : [];
  if (!publications.length) return 0.5;
  const supported = publications.map((publication) => {
    const formatObjectives = precedentContext.formatObjectiveMap?.get(normalizeKey(publication?.format)) || null;
    if (!formatObjectives || formatObjectives.size === 0) return 0.5;
    return formatObjectives.has(normalizeKey(publication?.objective)) ? 1 : 0;
  });
  return clamp01(supported.reduce((sum, value) => sum + value, 0) / supported.length);
}

function calculateNoveltyBalance(plan, draftTopics = [], precedentContext = {}) {
  const candidateTopics = uniqueNormalized((plan?.publications || []).map((item) => item?.topic));
  const reliableTopics = uniqueNormalized(
    (precedentContext.reliablePublications || []).map((item) => item?.data?.publication_model?.topic || item?.data?.topic)
  );
  const draftTopicSet = new Set(uniqueNormalized(draftTopics));
  const reliableTopicSet = new Set(reliableTopics);
  if (!candidateTopics.length) return 0;
  const draftOverlap = candidateTopics.filter((topic) => draftTopicSet.has(topic)).length / candidateTopics.length;
  const precedentOverlap = reliableTopicSet.size
    ? candidateTopics.filter((topic) => reliableTopicSet.has(topic)).length / candidateTopics.length
    : 0.5;
  const explorationRatio = candidateTopics.filter((topic) => !draftTopicSet.has(topic) && !reliableTopicSet.has(topic)).length /
    candidateTopics.length;
  return clamp01((draftOverlap * 0.35) + (precedentOverlap * 0.45) + ((1 - explorationRatio) * 0.2));
}

function calculateCalendarConsistency(featureMap, postsPerWeekTarget, planningHorizon) {
  const actualPostsPerWeek = featureMap.duration_days > 0 ? (featureMap.posts_count * 7) / featureMap.duration_days : featureMap.posts_count;
  const weeklyFit = postsPerWeekTarget > 0
    ? clamp01(1 - Math.abs(actualPostsPerWeek - postsPerWeekTarget) / Math.max(postsPerWeekTarget, 1))
    : 0.5;
  const densityTarget = planningHorizon?.duration_days > 0
    ? clamp01(featureMap.posts_count / planningHorizon.duration_days)
    : 0.5;
  const densityFit = clamp01(1 - Math.abs(featureMap.timeline_density - densityTarget));
  return clamp01((weeklyFit * 0.65) + (densityFit * 0.35));
}

function buildPlanSummary(plan, featureMap, predictedLikes, targetPostsPerWeek, planningHorizon, breakdown = {}) {
  const actualPostsPerWeek = featureMap.duration_days > 0 ? Number(((featureMap.posts_count * 7) / featureMap.duration_days).toFixed(2)) : 0;
  return {
    predicted_likes: Number(predictedLikes.toFixed(2)),
    posts_count: featureMap.posts_count,
    posts_per_week_actual: actualPostsPerWeek,
    posts_per_week_target: targetPostsPerWeek,
    duration_days_used_for_fitness: planningHorizon?.duration_days || featureMap.duration_days,
    unique_topics: featureMap.unique_topics,
    unique_tones: featureMap.unique_tones,
    avg_creativity: Number(featureMap.avg_creativity.toFixed(3)),
    format_entropy: Number(asNumber(featureMap.format_entropy, 0).toFixed(3)),
    objective_entropy: Number(asNumber(featureMap.objective_entropy, 0).toFixed(3)),
    audience_coverage: Number(asNumber(featureMap.audience_coverage, 0).toFixed(3)),
    platform_coverage: Number(asNumber(featureMap.platform_coverage, 0).toFixed(3)),
    topic_recurrence: Number(asNumber(featureMap.topic_recurrence, 0).toFixed(3)),
    timeline_density: Number(asNumber(featureMap.timeline_density, 0).toFixed(3)),
    objective_breakdown: breakdown
  };
}

function capPlanPredictedLikes(predictedLikes, metadata = null) {
  const rawPredictedLikes = asNumber(predictedLikes, 0);
  const maxTarget = asNumber(metadata?.target_summary?.max, 0);
  if (maxTarget <= 0) {
    return {
      cappedPredictedLikes: rawPredictedLikes,
      extrapolationPenalty: 0
    };
  }
  const upperBound = maxTarget * 1.15;
  const cappedPredictedLikes = Math.min(rawPredictedLikes, upperBound);
  return {
    cappedPredictedLikes,
    extrapolationPenalty: 0
  };
}

export async function optimizeContentPlanEvolution(draftContentPlan, config = {}) {
  const {
    precedentPublications = [],
    constraints = {},
    ga = {}
  } = config;
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

// Выбираем функцию мутации
let mutateFn;
switch (mutationMethod) {
  case 'inversion':
    mutateFn = (individual, rng) => {
      if (!Array.isArray(individual) || individual.length === 0) return cloneJson(individual);
      const slotIndex = Math.floor(rng() * individual.length);
      const next = cloneJson(individual);
      next[slotIndex] = randomReplaceMutation(next[slotIndex], geneDomains, rng);
      return inversionMutation(next, rng);
    };
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
  const draftTopics = uniqueDomain((draftContentPlan?.publications || []).map((item) => item?.topic));
  const draftPlanFeatureMap = buildPlanFeatureMap(draftContentPlan?.publications || [], {
    durationDays: planningHorizon.duration_days,
    startDate: planningHorizon.start_date,
    endDate: planningHorizon.end_date,
    expectedPlatforms: precedentContext.expectedPlatforms,
    targetAudience: precedentContext.targetAudience
  });
  const geneDomains = [...domains, CTA_GENE_VALUES, CREATIVITY_GENE_VALUES];
  const basePublications = expandBasePublications(draftContentPlan, targetPostCount);
  const postsPerWeekTarget = asNumber(constraints.posts_per_week, 0);
  const postsPerWeekTolerance = asNumber(constraints.posts_per_week_tolerance, 0.35);

  const createPublicationGene = (rng, fallback = {}) => [
    domains[0][Math.floor(rng() * Math.max(1, domains[0].length))] || fallback.topic || 'unspecified',
    domains[1][Math.floor(rng() * Math.max(1, domains[1].length))] || fallback.format || 'text',
    domains[2][Math.floor(rng() * Math.max(1, domains[2].length))] || fallback.objective || 'inform',
    domains[3][Math.floor(rng() * Math.max(1, domains[3].length))] || fallback.tone || 'expert',
    CTA_GENE_VALUES[Math.floor(rng() * CTA_GENE_VALUES.length)] ??
      (fallback?.ontology_features?.has_cta ? 1 : 0),
    CREATIVITY_GENE_VALUES[Math.floor(rng() * CREATIVITY_GENE_VALUES.length)] ??
      clamp01(fallback?.ontology_features?.creativity, 0.5)
  ];

  const createIndividual = (rng) => basePublications.map((publication) => createPublicationGene(rng, publication));
  const cloneIndividual = (individual) => cloneJson(individual);
  const crossover = (left, right, rng) => onePointCrossoverArrays(left, right, rng);
  const mutate = (individual, rng) => {
    if (!Array.isArray(individual) || individual.length === 0) return cloneJson(individual);
    const slotIndex = Math.floor(rng() * individual.length);
    const next = cloneJson(individual);
    next[slotIndex] = randomReplaceMutation(next[slotIndex], geneDomains, rng);
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
    minImprovementEpsilon: ga.minImprovementEpsilon ?? 0.2,
    minImprovementGenerations: ga.minImprovementGenerations ?? 8,
    mutationProbabilitySchedule: (state, defaults) => {
      const base = clampProbability(ga.mutationProbability ?? defaults.mutationProbability, defaults.mutationProbability);
      const stagnationRatio = state.stagnation / Math.max(1, Number(ga.stagnationGenerations ?? 20));
      const lowDeltaBoost = state.lowDeltaStreak >= 3 ? 0.04 : 0;
      const stagedBoost = stagnationRatio >= 0.75 ? 0.06 : stagnationRatio >= 0.5 ? 0.03 : 0;
      return clampProbability(base + lowDeltaBoost + stagedBoost, base);
    },
    createIndividual,
    cloneIndividual,
    crossover: crossoverFn,
    mutate: mutateFn,
    cacheKeyForIndividual: (individual) => JSON.stringify(individual),
    scorePopulation: async (population) => {
      const candidatePlans = population.map((genome) =>
        applyGenomeToPlan(basePublications, draftContentPlan, genome, planningHorizon, precedentContext)
      );
      const featureVectors = candidatePlans.map((plan) => buildPlanFeatureVector(plan.publications, {
        durationDays: planningHorizon.duration_days,
        startDate: planningHorizon.start_date,
        endDate: planningHorizon.end_date,
        expectedPlatforms: precedentContext.expectedPlatforms,
        targetAudience: precedentContext.targetAudience
      }));
      const featureMaps = candidatePlans.map((plan) => buildPlanFeatureMap(plan.publications, {
        durationDays: planningHorizon.duration_days,
        startDate: planningHorizon.start_date,
        endDate: planningHorizon.end_date,
        expectedPlatforms: precedentContext.expectedPlatforms,
        targetAudience: precedentContext.targetAudience
      }));
      const predictionResult = await predictContentPlanLikesByFeatureVectors(featureVectors, { forceTrain: false });
      return predictionResult.predictions.map((predictedLikes, index) => {
        const featureMap = featureMaps[index];
        const actualPostsPerWeek = featureMap.duration_days > 0 ? (featureMap.posts_count * 7) / featureMap.duration_days : featureMap.posts_count;
        const weeklyDelta = postsPerWeekTarget > 0 ? Math.abs(actualPostsPerWeek - postsPerWeekTarget) / Math.max(postsPerWeekTarget, 1) : 0;
        const weeklyPenalty = weeklyDelta > postsPerWeekTolerance ? weeklyDelta * 250 : weeklyDelta * 60;
        const topicPenalty = calculateTopicPenalty(candidatePlans[index], featureMap, draftTopics);
        const ctaUpperBound = Math.max(0.4, asNumber(draftPlanFeatureMap.cta_share, 0));
        const ctaPenalty =
          Math.max(0, asNumber(featureMap.cta_share, 0) - ctaUpperBound) * 240 +
          Math.abs(asNumber(featureMap.cta_share, 0) - asNumber(draftPlanFeatureMap.cta_share, 0)) * 45;
        const boundedPrediction = capPlanPredictedLikes(predictedLikes, predictionResult.metadata);
        const audienceAlignment = calculateAudienceAlignment(candidatePlans[index], precedentContext);
        const objectiveCoverage = calculateObjectiveCoverage(candidatePlans[index], draftContentPlan);
        const formatMixFit = calculateFormatMixFit(candidatePlans[index], draftContentPlan, precedentContext);
        const ontologyConsistency = calculateOntologyConsistency(candidatePlans[index], precedentContext);
        const noveltyBalance = calculateNoveltyBalance(candidatePlans[index], draftTopics, precedentContext);
        const calendarConsistency = calculateCalendarConsistency(featureMap, postsPerWeekTarget, planningHorizon);
        const platformCoverageBonus = asNumber(featureMap.platform_coverage, 0) * 18;
        const reliabilityBonus = precedentContext.avgReliability * 12;
        const compositeBonus =
          (audienceAlignment * 55) +
          (objectiveCoverage * 50) +
          (formatMixFit * 28) +
          (ontologyConsistency * 42) +
          (noveltyBalance * 26) +
          (calendarConsistency * 24) +
          platformCoverageBonus +
          reliabilityBonus;
        const penalty = weeklyPenalty + topicPenalty + ctaPenalty + boundedPrediction.extrapolationPenalty;
        const score = boundedPrediction.cappedPredictedLikes + compositeBonus - penalty;
        const breakdown = {
          audience_alignment: Number(audienceAlignment.toFixed(3)),
          objective_coverage: Number(objectiveCoverage.toFixed(3)),
          format_mix_fit: Number(formatMixFit.toFixed(3)),
          ontology_consistency: Number(ontologyConsistency.toFixed(3)),
          novelty_balance: Number(noveltyBalance.toFixed(3)),
          calendar_consistency: Number(calendarConsistency.toFixed(3)),
          reliability_prior: Number(precedentContext.avgReliability.toFixed(3)),
          weekly_penalty: Number(weeklyPenalty.toFixed(2)),
          topic_penalty: Number(topicPenalty.toFixed(2)),
          cta_penalty: Number(ctaPenalty.toFixed(2))
        };
        return {
          score,
          meta: buildPlanSummary(
            candidatePlans[index],
            featureMap,
            boundedPrediction.cappedPredictedLikes,
            postsPerWeekTarget,
            planningHorizon,
            breakdown
          )
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
        improvement_delta: entry.improvement_delta,
        summary: entry.best_meta
      }));
    }
  });

  const optimizedPlan = applyGenomeToPlan(
    basePublications,
    draftContentPlan,
    result.best || createIndividual(Math.random),
    planningHorizon
  );
  const featureMap = buildPlanFeatureMap(optimizedPlan.publications, {
    durationDays: planningHorizon.duration_days,
    startDate: planningHorizon.start_date,
    endDate: planningHorizon.end_date,
    expectedPlatforms: precedentContext.expectedPlatforms,
    targetAudience: precedentContext.targetAudience
  });

  return {
    optimizedPlan,
    planFeatureMap: featureMap,
    predictedLikes: asNumber(result.best_meta?.predicted_likes, 0),
    ga: {
      ...result,
      history: traces
    }
  };
}
