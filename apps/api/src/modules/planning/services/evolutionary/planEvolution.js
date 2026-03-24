import { buildPlanFeatureMap, buildPlanFeatureVector } from '../../../ml/services/ml/ontologyFeatureEngineering.js';
import { predictContentPlanLikesByFeatureVectors } from '../../../ml/services/relevancePredictionService.js';
import { runAsyncGeneticAlgorithm } from './asyncGaCore.js';
import { cloneJson, onePointCrossoverArrays, randomReplaceMutation } from './operators.js';

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

function buildDomains(draftContentPlan, precedentPublications = []) {
  const draftPublications = Array.isArray(draftContentPlan?.publications) ? draftContentPlan.publications : [];
  const fromPrecedents = precedentPublications.map((item) => item?.publication_model || item || {});
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

function applyGenomeToPlan(basePublications, draftContentPlan, genome, planningHorizon) {
  const publications = genome.map((gene, index) => {
    const [topic, format, objective, tone, hasCta, creativity] = Array.isArray(gene) ? gene : [];
    const base = cloneJson(basePublications[index] || {});
    const nextCreativity = clamp01(creativity, asNumber(base?.ontology_features?.creativity, 0.5));
    return {
      ...base,
      publication_id: base.publication_id || `evo_publication_${String(index + 1).padStart(3, '0')}`,
      topic: topic ?? base.topic ?? `topic_${index + 1}`,
      format: format ?? base.format ?? 'text',
      objective: objective ?? base.objective ?? 'inform',
      tone: tone ?? base.tone ?? 'expert',
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

function buildPlanSummary(plan, featureMap, predictedLikes, targetPostsPerWeek, planningHorizon) {
  const actualPostsPerWeek = featureMap.duration_days > 0 ? Number(((featureMap.posts_count * 7) / featureMap.duration_days).toFixed(2)) : 0;
  return {
    predicted_likes: Number(predictedLikes.toFixed(2)),
    posts_count: featureMap.posts_count,
    posts_per_week_actual: actualPostsPerWeek,
    posts_per_week_target: targetPostsPerWeek,
    duration_days_used_for_fitness: planningHorizon?.duration_days || featureMap.duration_days,
    unique_topics: featureMap.unique_topics,
    unique_tones: featureMap.unique_tones,
    avg_creativity: Number(featureMap.avg_creativity.toFixed(3))
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
  const planningHorizon = resolvePlanningHorizon(draftContentPlan, constraints);
  const targetPostCount = resolveTargetPostCount(draftContentPlan, constraints);
  const domains = buildDomains(draftContentPlan, precedentPublications);
  const draftTopics = uniqueDomain((draftContentPlan?.publications || []).map((item) => item?.topic));
  const draftPlanFeatureMap = buildPlanFeatureMap(draftContentPlan?.publications || [], {
    durationDays: planningHorizon.duration_days,
    startDate: planningHorizon.start_date,
    endDate: planningHorizon.end_date
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
    crossover,
    mutate,
    cacheKeyForIndividual: (individual) => JSON.stringify(individual),
    scorePopulation: async (population) => {
      const candidatePlans = population.map((genome) =>
        applyGenomeToPlan(basePublications, draftContentPlan, genome, planningHorizon)
      );
      const featureVectors = candidatePlans.map((plan) => buildPlanFeatureVector(plan.publications, {
        durationDays: planningHorizon.duration_days,
        startDate: planningHorizon.start_date,
        endDate: planningHorizon.end_date
      }));
      const featureMaps = candidatePlans.map((plan) => buildPlanFeatureMap(plan.publications, {
        durationDays: planningHorizon.duration_days,
        startDate: planningHorizon.start_date,
        endDate: planningHorizon.end_date
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
        const penalty = weeklyPenalty + topicPenalty + ctaPenalty + boundedPrediction.extrapolationPenalty;
        const score = boundedPrediction.cappedPredictedLikes - penalty;
        return {
          score,
          meta: buildPlanSummary(
            candidatePlans[index],
            featureMap,
            boundedPrediction.cappedPredictedLikes,
            postsPerWeekTarget,
            planningHorizon
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
    endDate: planningHorizon.end_date
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
