import { buildPlanFeatureMap, buildPlanFeatureVector } from '../../../ml/services/ml/ontologyFeatureEngineering.js';
import { predictPlanMetricsByFeatureVectors } from '../../../ml/services/relevancePredictionService.js';
import { buildOntologyFromSnapshot } from '../../../precedents/services/ontologyAggregationService.js';
import { runAsyncGeneticAlgorithm } from './asyncGaCore.js';
import { cloneJson, onePointCrossoverArrays, randomReplaceMutation, twoPointCrossoverArrays, uniformCrossoverArrays } from './operators.js';

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
    
    return {
      ...base,
      publication_id: base.publication_id || `evo_publication_${String(index + 1).padStart(3, '0')}`,
      topic: topic ?? base.topic ?? `topic_${index + 1}`,
      format: format ?? base.format ?? 'text',
      objective: objective ?? base.objective ?? 'inform',
      tone: tone ?? base.tone ?? 'expert',
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

// Веса для фитнес-функции (можно вынести в конфиг)
const FITNESS_WEIGHTS = {
  likes: 0.5,
  shares: 0.3,
  views: 0.2
};

function calculateFitness(predictedMetrics, metadata) {
  const { cappedLikes, cappedShares, cappedViews } = capPlanPredictedMetrics(predictedMetrics, metadata);
  
  const maxLikes = metadata?.target_summary?.total_likes?.max || 1;
  const maxShares = metadata?.target_summary?.total_shares?.max || 1;
  const maxViews = metadata?.target_summary?.total_views?.max || 1;
  
  const normLikes = Math.min(1, cappedLikes / maxLikes);
  const normShares = Math.min(1, cappedShares / maxShares);
  const normViews = Math.min(1, cappedViews / maxViews);
  
  return FITNESS_WEIGHTS.likes * normLikes +
         FITNESS_WEIGHTS.shares * normShares +
         FITNESS_WEIGHTS.views * normViews;
}

export async function optimizeContentPlanEvolution(draftContentPlan, config = {}) {
  const {
    precedentPublications = [],
    constraints = {},
    ga = {},
    lockedFields = {}
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
  const mutate = (individual, rng) => {
    if (!Array.isArray(individual) || individual.length === 0) return cloneJson(individual);
    const slotIndex = Math.floor(rng() * individual.length);
    const next = cloneJson(individual);
    next[slotIndex] = randomReplaceMutation(next[slotIndex], geneDomains, rng);
    
    // Принудительно восстанавливаем заблокированные поля после мутации
    if (lockedFields.topic && basePublications[slotIndex]?.topic) {
      next[slotIndex][0] = basePublications[slotIndex].topic;
    }
    if (lockedFields.format && basePublications[slotIndex]?.format && allowedFormats.includes(basePublications[slotIndex].format)) {
      next[slotIndex][1] = basePublications[slotIndex].format;
    }
    if (lockedFields.objective && basePublications[slotIndex]?.objective) {
      next[slotIndex][2] = basePublications[slotIndex].objective;
    }
    if (lockedFields.tone && basePublications[slotIndex]?.tone) {
      next[slotIndex][3] = basePublications[slotIndex].tone;
    }
    if (lockedFields.has_cta !== undefined) {
      next[slotIndex][4] = lockedFields.has_cta ? 1 : 0;
    }
    if (lockedFields.creativity !== undefined) {
      next[slotIndex][5] = lockedFields.creativity;
    }
    
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
        const fitness = calculateFitness(predictedMetrics, predictionResult.metadata);
        
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