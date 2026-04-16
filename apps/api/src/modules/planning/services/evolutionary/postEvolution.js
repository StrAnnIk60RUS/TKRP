import { buildPostFeatureVector, buildPostFeatureVectorFromFeatureMap, POST_FEATURE_NAMES } from '../../../ml/services/ml/ontologyFeatureEngineering.js';
import { predictPostMetricsByFeatureVectors } from '../../../ml/services/relevancePredictionService.js';
import { runAsyncGeneticAlgorithm } from './asyncGaCore.js';
import { 
  cloneJson, 
  onePointCrossoverArrays,
  twoPointCrossoverArrays,
  uniformCrossoverArrays,
  inversionMutation
} from './operators.js';
import {
  buildDraftSemanticCore,
  buildObjectiveCta,
  calibrateExpectedKpi,
  choosePreferredKeyMessage,
  choosePreferredSummary,
  choosePreferredTopic,
  normalizePublicationTopicForUi,
  sanitizeTopicTitle
} from '../contentOutputUtils.js';

const TONE_START = 24;
const TONE_END = 28;
const CTA_INDEX = 20;

function asNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clampProbability(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(1, numeric));
}

function clampInt(value, min, max, fallback) {
  const numeric = Math.floor(Number(value));
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
}

function readPostGaEnvNumber(name) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return null;
  const normalized = typeof raw === 'string' ? raw.replace(',', '.').trim() : raw;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

function parseNumericInput(value) {
  if (value === null || value === undefined) return Number.NaN;
  const normalized = typeof value === 'string' ? value.replace(',', '.').trim() : value;
  return Number(normalized);
}

function normalizeGaInteger(value, fallback, min, max) {
  const numeric = Math.floor(parseNumericInput(value));
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
}

function normalizeGaProbability(value, fallback) {
  const numeric = parseNumericInput(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(1, numeric));
}

function normalizeGaMethod(value, allowed, fallback) {
  const method = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return allowed.includes(method) ? method : fallback;
}

// Веса для фитнес-функции поста
const FITNESS_WEIGHTS = {
  likes: 0.5,
  shares: 0.3,
  views: 0.2
};

function calculateFitness(predictedMetrics, metadata) {
  const [likes, shares, views] = predictedMetrics;
  
  const maxLikes = metadata?.target_summary?.likes?.max || 1;
  const maxShares = metadata?.target_summary?.shares?.max || 1;
  const maxViews = metadata?.target_summary?.views?.max || 1;
  
  const normLikes = Math.min(1, likes / maxLikes);
  const normShares = Math.min(1, shares / maxShares);
  const normViews = Math.min(1, views / maxViews);
  
  return FITNESS_WEIGHTS.likes * normLikes +
         FITNESS_WEIGHTS.shares * normShares +
         FITNESS_WEIGHTS.views * normViews;
}

/** Средняя L1-разница по измеримым признакам (0..1): выше — дальше от других слотов плана. */
function peerGenomeDiversityScore(candidate, peerGenomes) {
  if (!Array.isArray(candidate) || !Array.isArray(peerGenomes) || peerGenomes.length === 0) return 0;
  let sum = 0;
  for (const peer of peerGenomes) {
    if (!Array.isArray(peer)) continue;
    const dim = Math.min(candidate.length, peer.length, 34);
    if (dim <= 0) continue;
    let d = 0;
    for (let i = 0; i < dim; i += 1) {
      d += Math.abs(asNumber(candidate[i], 0) - asNumber(peer[i], 0));
    }
    sum += d / dim;
  }
  if (sum <= 0) return 0;
  return Math.max(0, Math.min(1, sum / peerGenomes.length));
}

function buildAllowedValues(index) {
  const binaryIndexes = new Set([0, 3, 4, 8, 9, 10, 12, 14, 15, 17, 19, 20, 24, 25, 26, 27, 28, 32, 33]);
  const ternaryIndexes = new Set([2, 5, 6, 11, 16, 18, 21, 22, 29, 30]);
  const normalizedIndexes = new Set([1, 7, 13, 23, 31]);
  if (binaryIndexes.has(index)) return [0, 1];
  if (ternaryIndexes.has(index)) return [0, 0.5, 1];
  if (normalizedIndexes.has(index)) return [0, 0.25, 0.5, 0.75, 1];
  return [0, 1];
}

function nearestAllowedValue(value, allowedValues) {
  return allowedValues
    .slice()
    .sort((left, right) => Math.abs(left - value) - Math.abs(right - value))[0];
}

function resolveToneIndex(tone) {
  const source = String(tone || '').toLowerCase();
  if (/(expert|эксперт|technical|tech)/u.test(source)) return 0;
  if (/(friend|друж|warm|casual)/u.test(source)) return 1;
  if (/(official|formal|офиц|корпоратив)/u.test(source)) return 2;
  if (/(inspir|motiv|вдохнов)/u.test(source)) return 3;
  if (/(humor|юмор|fun)/u.test(source)) return 4;
  return null;
}

function resolveCtaPreference(publication = {}) {
  const objective = String(publication?.objective || '').toLowerCase();
  if (objective === 'convert' || objective === 'retain') return 'required';
  if (objective === 'engage' || objective === 'brand_building') return 'preferred';
  return 'avoid';
}

function repairGenome(genome, constants = {}) {
  const repaired = POST_FEATURE_NAMES.map((_, index) => {
    if (index === CTA_INDEX && constants.hasCta !== undefined) return constants.hasCta;
    if (index === 34) return asNumber(constants.tonesCount, 1);
    if (index === 35) return asNumber(constants.creativityFromBestPlan, 0.5);
    return nearestAllowedValue(asNumber(genome[index], 0), buildAllowedValues(index));
  });

  // Принудительно устанавливаем целевой тон, если он задан
  if (constants.targetToneIndex !== undefined && constants.targetToneIndex >= 0 && constants.targetToneIndex <= 4) {
    for (let index = TONE_START; index <= TONE_END; index += 1) {
      repaired[index] = 0;
    }
    repaired[TONE_START + constants.targetToneIndex] = 1;
  } else {
    // Иначе оставляем один активный тон
    let winningToneIndex = TONE_START;
    let winningToneValue = -1;
    for (let index = TONE_START; index <= TONE_END; index += 1) {
      if (repaired[index] > winningToneValue) {
        winningToneValue = repaired[index];
        winningToneIndex = index;
      }
      repaired[index] = 0;
    }
    repaired[winningToneIndex] = 1;
  }
  
  return repaired;
}

function createFeatureMap(vector) {
  return POST_FEATURE_NAMES.reduce((acc, name, index) => {
    acc[name] = vector[index] ?? 0;
    return acc;
  }, {});
}

function createIndividual(baseVector, constants, rng) {
  const genome = baseVector.map((value, index) => {
    if (index >= 34) return value;
    const allowed = buildAllowedValues(index);
    const keepBase = rng() < 0.6;
    return keepBase ? nearestAllowedValue(value, allowed) : allowed[Math.floor(rng() * allowed.length)];
  });
  return repairGenome(genome, constants);
}

function mutateGenome(genome, constants, rng) {
  const next = cloneJson(genome);
  const mutableIndex = Math.floor(rng() * 34);
  const allowed = buildAllowedValues(mutableIndex);
  next[mutableIndex] = allowed[Math.floor(rng() * allowed.length)];
  return repairGenome(next, constants);
}

function capPostPredictedMetrics(predictedMetrics, metadata) {
  const [likes, shares, views] = predictedMetrics;
  const maxLikes = metadata?.target_summary?.likes?.max || 0;
  const maxShares = metadata?.target_summary?.shares?.max || 0;
  const maxViews = metadata?.target_summary?.views?.max || 0;
  
  return {
    cappedLikes: maxLikes > 0 ? Math.min(likes, maxLikes) : likes,
    cappedShares: maxShares > 0 ? Math.min(shares, maxShares) : shares,
    cappedViews: maxViews > 0 ? Math.min(views, maxViews) : views
  };
}

async function evolveSinglePublication(
  publication,
  planFeatureMap,
  gaConfig = {},
  publicationIndex = 0,
  lockedFields = {},
  stage2Options = {}
) {
  const baseVector = buildPostFeatureVector(publication, {
    tonesCount: planFeatureMap.unique_tones,
    creativityFromBestPlan: planFeatureMap.avg_creativity
  });
  
  const targetToneIndex = lockedFields.targetToneIndex !== undefined 
    ? lockedFields.targetToneIndex 
    : resolveToneIndex(publication?.tone);
  
  const constants = {
    tonesCount: planFeatureMap.unique_tones,
    creativityFromBestPlan: planFeatureMap.avg_creativity,
    hasCta: lockedFields.has_cta !== undefined ? lockedFields.has_cta : null,
    targetToneIndex
  };
  
  const baseFeatureMap = createFeatureMap(baseVector);
  
  const crossoverMethod = normalizeGaMethod(
    gaConfig.crossoverMethod,
    ['one_point', 'two_point', 'uniform'],
    'one_point'
  );
  const mutationMethod = normalizeGaMethod(gaConfig.mutationMethod, ['random_replace', 'inversion'], 'random_replace');
  const selectionMethod = normalizeGaMethod(gaConfig.selectionMethod, ['tournament', 'roulette', 'rank'], 'tournament');
  const normalizedPopulationSize = normalizeGaInteger(gaConfig.populationSize, 48, 2, 2000);
  const normalizedMaxGenerations = normalizeGaInteger(gaConfig.maxGenerations, 50, 1, 100000);
  const normalizedStagnationGenerations = normalizeGaInteger(gaConfig.stagnationGenerations, 12, 0, 100000);
  const normalizedEliteSize = normalizeGaInteger(gaConfig.eliteSize, 3, 0, 64);
  const normalizedTournamentSize = normalizeGaInteger(gaConfig.tournamentSize, 4, 2, 64);
  const normalizedCrossoverProbability = normalizeGaProbability(gaConfig.crossoverProbability, 0.9);
  const normalizedMutationProbability = normalizeGaProbability(
    gaConfig.mutationProbability ?? readPostGaEnvNumber('PLAN_GA_POST_MUTATION_PROBABILITY'),
    0.12
  );

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
      mutateFn = (individual, rng) => mutateGenome(individual, constants, rng);
  }

  const traces = [];
  const repairedBasesAll = stage2Options.repairedBases;
  const peerWeight = clampProbability(asNumber(stage2Options.peerDiversityWeight, 0.1), 0.1);
  const peerGenomes =
    Array.isArray(repairedBasesAll) && repairedBasesAll.length > 1
      ? repairedBasesAll.filter((_, j) => j !== publicationIndex)
      : [];

  const result = await runAsyncGeneticAlgorithm({
    direction: 'max',
    seed: gaConfig.seed ?? null,
    populationSize: normalizedPopulationSize,
    maxGenerations: normalizedMaxGenerations,
    stagnationGenerations: normalizedStagnationGenerations,
    eliteSize: normalizedEliteSize,
    tournamentSize: normalizedTournamentSize,
    crossoverProbability: normalizedCrossoverProbability,
    mutationProbability: normalizedMutationProbability,
    selectionMethod,
    createIndividual: (rng) => createIndividual(baseVector, constants, rng),
    cloneIndividual: (individual) => cloneJson(individual),
    crossover: (left, right, rng) => {
      const crossed = crossoverFn(left, right, rng);
      return crossed.map((child) => repairGenome(child, constants));
    },
    mutate: mutateFn,
    cacheKeyForIndividual: (individual) => JSON.stringify(individual),
    scorePopulation: async (population) => {
      const repaired = population.map((item) => repairGenome(item, constants));
      const predictionResult = await predictPostMetricsByFeatureVectors(repaired, { forceTrain: false });
      
      return predictionResult.predictions.map((predictedMetrics, index) => {
        const capped = capPostPredictedMetrics(predictedMetrics, predictionResult.metadata);
        const kpi = calculateFitness(
          [capped.cappedLikes, capped.cappedShares, capped.cappedViews],
          predictionResult.metadata
        );
        const diversity = peerGenomeDiversityScore(repaired[index], peerGenomes);
        const fitness = peerGenomes.length ? kpi + peerWeight * diversity : kpi;

        return {
          score: fitness,
          meta: {
            predicted_likes: capped.cappedLikes,
            predicted_shares: capped.cappedShares,
            predicted_views: capped.cappedViews,
            fitness,
            peer_diversity: diversity
          }
        };
      });
    },
    onGeneration: (entry) => {
      traces.push(entry);
      console.log('[GA:post]', JSON.stringify({
        publication_index: publicationIndex,
        generation: entry.generation,
        best_score: entry.best_score,
        generation_best_score: entry.generation_best_score,
        avg_score: entry.generation_avg_score,
        summary: entry.best_meta
      }));
    }
  });

  const bestVector = repairGenome(result.best || baseVector, constants);
  const featureMap = createFeatureMap(bestVector);
  const bestFitness = asNumber(result.best_meta?.fitness, 0);
  const bestLikes = asNumber(result.best_meta?.predicted_likes, 0);
  const bestShares = asNumber(result.best_meta?.predicted_shares, 0);
  const bestViews = asNumber(result.best_meta?.predicted_views, 0);
  
  return {
    optimizedPublication: {
      ...publication,
      expected_kpi: {
        ...(publication.expected_kpi || {}),
        predicted_likes: bestLikes,
        predicted_shares: bestShares,
        predicted_views: bestViews,
        predicted_likes_source: 'ga_post_metrics_model'
      },
      ontology_features: featureMap
    },
    predictedLikes: bestLikes,
    predictedShares: bestShares,
    predictedViews: bestViews,
    fitness: bestFitness,
    featureVector: bestVector,
    featureMap,
    ga: {
      ...result,
      history: traces
    }
  };
}

async function mapWithConcurrency(items = [], limit, worker) {
  const concurrency = clampInt(limit, 1, 8, 3);
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => runWorker()));
  return results;
}

function createArchetypeKey(publication = {}) {
  return [
    publication?.topic || '',
    publication?.format || '',
    publication?.objective || '',
    publication?.tone || ''
  ].join('|');
}

function scoreArchetypeMatch(publication = {}, archetype = {}) {
  let score = 0;
  if ((publication?.topic || null) === (archetype?.topic || null)) score += 5;
  if ((publication?.format || null) === (archetype?.format || null)) score += 3.5;
  if ((publication?.objective || null) === (archetype?.objective || null)) score += 4;
  if ((publication?.tone || null) === (archetype?.tone || null)) score += 2.5;
  if ((publication?.platform || null) === (archetype?.platform || null)) score += 2;
  score += asNumber(archetype?.expected_kpi?.predicted_likes, 0) / 2000;
  return score;
}

function buildPublicationArchetypes(publicationResults = [], maxCount = 3) {
  const limit = clampInt(maxCount, 1, 8, 3);
  const ranked = publicationResults
    .slice()
    .sort((left, right) => asNumber(right?.predictedLikes, 0) - asNumber(left?.predictedLikes, 0));
  const archetypes = [];
  const seen = new Set();
  const seenIds = new Set();

  for (const item of ranked) {
    const publication = item?.optimizedPublication || null;
    if (!publication) continue;
    const key = createArchetypeKey(publication);
    if (seen.has(key)) continue;
    archetypes.push(publication);
    seen.add(key);
    if (publication?.publication_id) seenIds.add(publication.publication_id);
    if (archetypes.length >= limit) return archetypes;
  }

  for (const item of ranked) {
    const publication = item?.optimizedPublication || null;
    if (!publication) continue;
    if (publication?.publication_id && seenIds.has(publication.publication_id)) continue;
    archetypes.push(publication);
    if (publication?.publication_id) seenIds.add(publication.publication_id);
    if (archetypes.length >= limit) break;
  }

  return archetypes;
}

function selectArchetypeForPublication(publication = {}, archetypes = [], usageByKey = new Map()) {
  if (!Array.isArray(archetypes) || archetypes.length === 0) return null;
  let bestArchetype = archetypes[0];
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const archetype of archetypes) {
    const key = createArchetypeKey(archetype);
    const usagePenalty = (usageByKey.get(key) || 0) * 1.4;
    const score = scoreArchetypeMatch(publication, archetype) - usagePenalty;
    if (score > bestScore) {
      bestArchetype = archetype;
      bestScore = score;
    }
  }

  const selectedKey = createArchetypeKey(bestArchetype);
  usageByKey.set(selectedKey, (usageByKey.get(selectedKey) || 0) + 1);
  return bestArchetype;
}

function cloneFeatureMap(featureMap = {}, planFeatureMap = {}) {
  const next = { ...featureMap };
  next.tones_count = asNumber(planFeatureMap.unique_tones, next.tones_count || 1);
  next.creativity_from_best_plan = asNumber(planFeatureMap.avg_creativity, next.creativity_from_best_plan || 0);
  next.has_cta = 0;
  next.grammar_quality = Math.max(asNumber(next.grammar_quality, 1), 0.75);
  next.tech_quality = Math.max(asNumber(next.tech_quality, 1), 1);
  return next;
}

function assignCtaToFeatureMap(featureMap = {}, hasCta = false) {
  return {
    ...featureMap,
    has_cta: hasCta ? 1 : 0
  };
}

function assignToneToFeatureMap(featureMap = {}, tone = '') {
  const targetToneIndex = resolveToneIndex(tone);
  if (!Number.isInteger(targetToneIndex)) {
    return featureMap;
  }
  const next = { ...featureMap };
  for (let index = TONE_START; index <= TONE_END; index += 1) {
    next[`tone_onehot_${index - TONE_START}`] = index - TONE_START === targetToneIndex ? 1 : 0;
  }
  return next;
}

function rankCtaPriority(publication = {}) {
  const objective = String(publication?.objective || '').toLowerCase();
  if (objective === 'convert') return 4;
  if (objective === 'retain') return 3;
  if (objective === 'engage' || objective === 'brand_building') return 2;
  return 1;
}

const DEFAULT_PLAN_CTA = 'Запросить демонстрацию решения';

function resolveEffectiveCta(basePublication, sourcePublication, featureMap) {
  const base = basePublication || {};
  const source = sourcePublication || {};
  const pref = resolveCtaPreference(base);
  const existing = String(base?.cta || source?.cta || '').trim();
  const hasFeatureCta = asNumber(featureMap?.has_cta, 0) > 0;
  const fallback = buildObjectiveCta(base?.objective || source?.objective, '', base?.topic || source?.topic, 0);
  if (pref === 'required') {
    return existing || fallback || DEFAULT_PLAN_CTA;
  }
  if (pref === 'preferred' && (hasFeatureCta || existing)) {
    return existing || fallback || DEFAULT_PLAN_CTA;
  }
  if (hasFeatureCta) {
    return existing || fallback || DEFAULT_PLAN_CTA;
  }
  return '';
}

function buildFinalPublication(basePublication, bestPublication, featureMap, predictedLikes, predictedShares, predictedViews, index) {
  const source = cloneJson(bestPublication || {});
  const base = cloneJson(basePublication || {});
  const semanticCore = base?.semantic_core || source?.semantic_core || buildDraftSemanticCore(basePublication || bestPublication || {});
  const baseKpi = base?.expected_kpi && typeof base.expected_kpi === 'object' ? base.expected_kpi : {};
  const sourceKpi = source?.expected_kpi && typeof source.expected_kpi === 'object' ? source.expected_kpi : {};
  const objective = base?.objective || source?.objective || null;
  const format = base?.format || source?.format || null;
  const tone = base?.tone || source?.tone || null;
  const topic = normalizePublicationTopicForUi(
    choosePreferredTopic(semanticCore, base?.topic || source?.topic || null, objective, index)
  );
  const cta = resolveEffectiveCta(
    { ...base, objective, topic },
    { ...source, objective, topic },
    featureMap
  );
  const keyMessage = choosePreferredKeyMessage(semanticCore, base?.key_message || source?.key_message || '', {
    topic,
    objective,
    format,
    tone,
    index
  });
  const summary = choosePreferredSummary(semanticCore, base?.summary || source?.summary || '', {
    topic,
    format,
    fallbackSummary: base?.summary || source?.summary || ''
  });
  return {
    ...source,
    ...base,
    publication_id: base?.publication_id || source?.publication_id || `final_publication_${String(index + 1).padStart(3, '0')}`,
    planned_date: base?.planned_date || source?.planned_date || null,
    planned_at: base?.planned_at || source?.planned_at || null,
    platform: base?.platform || source?.platform || null,
    // Keep semantic fields from the slot itself to avoid cross-slot text mixing.
    topic,
    format,
    objective,
    tone,
    summary: summary || null,
    key_message: keyMessage || null,
    cta,
    expected_kpi: {
      ...calibrateExpectedKpi(
        {
          engagement_rate: baseKpi.engagement_rate ?? sourceKpi.engagement_rate,
          conversion_potential: baseKpi.conversion_potential ?? sourceKpi.conversion_potential,
          reach_potential: baseKpi.reach_potential ?? sourceKpi.reach_potential
        },
        { objective, format, tone, cta }
      ),
      predicted_likes: predictedLikes,
      predicted_shares: predictedShares,
      predicted_views: predictedViews,
      ml_predicted_likes: predictedLikes,
      ml_predicted_shares: predictedShares,
      ml_predicted_views: predictedViews,
      predicted_likes_source: 'final_best_post_template'
    },
    ontology_features: featureMap,
    semantic_core: semanticCore
  };
}

export async function optimizePublicationsEvolution(publications = [], planFeatureMap = {}, config = {}) {
  const gaConfig = config.ga || config;
  const lockedFields = config.lockedFields || {};

  const repairedBases = publications.map((pub) => {
    const targetToneIndex =
      lockedFields.targetToneIndex !== undefined
        ? lockedFields.targetToneIndex
        : resolveToneIndex(pub?.tone);
    const constants = {
      tonesCount: planFeatureMap.unique_tones,
      creativityFromBestPlan: planFeatureMap.avg_creativity,
      hasCta: lockedFields.has_cta !== undefined ? lockedFields.has_cta : null,
      targetToneIndex
    };
    const raw = buildPostFeatureVector(pub, {
      tonesCount: planFeatureMap.unique_tones,
      creativityFromBestPlan: planFeatureMap.avg_creativity
    });
    return repairGenome(raw, constants);
  });

  const peerDivRaw =
    gaConfig.peerDiversityWeight ??
    config.peerDiversityWeight ??
    readPostGaEnvNumber('PLAN_GA_PEER_DIVERSITY_WEIGHT');
  const peerDiversityWeight = Number.isFinite(Number(peerDivRaw))
    ? clampProbability(peerDivRaw, 0.1)
    : 0.1;

  const optimized = await mapWithConcurrency(
    publications,
    gaConfig.parallelism ?? config.parallelism ?? 3,
    (publication, index) =>
      evolveSinglePublication(publication, planFeatureMap, gaConfig, index, lockedFields, {
        repairedBases,
        peerDiversityWeight
      })
  );

  const bestPublication = optimized
    .slice()
    .sort((left, right) => right.fitness - left.fitness)[0] || null;
  const archetypes = buildPublicationArchetypes(
    optimized,
    gaConfig.maxArchetypes ?? config.maxArchetypes ?? 5
  );

  return {
    optimizedPublications: optimized.map((item) => item.optimizedPublication),
    publicationResults: optimized,
    bestPublication: bestPublication?.optimizedPublication || null,
    archetypes
  };
}

export async function fillPlanWithBestPublication(publications = [], publicationResults, planFeatureMap = {}, options = {}) {
  const slotResults = Array.isArray(publicationResults)
    ? publicationResults.filter((item) => item?.optimizedPublication || item?.publication_id)
    : [];
  const slotResultsById = new Map(
    slotResults
      .filter((item) => item?.optimizedPublication?.publication_id)
      .map((item) => [item.optimizedPublication.publication_id, item])
  );
  const archetypes = slotResults.length
    ? buildPublicationArchetypes(slotResults, options.maxArchetypes ?? 5)
    : [];
    
  if (!archetypes.length || !Array.isArray(publications) || publications.length === 0) {
    return {
      publications: publications || [],
      ctaTargetCount: 0,
      ctaAssignedCount: 0
    };
  }

  const totalCount = publications.length;
  const requiredCtaCount = publications.filter((publication) => resolveCtaPreference(publication) === 'required').length;
  const preferredCtaCount = publications.filter((publication) => resolveCtaPreference(publication) === 'preferred').length;
  const targetCtaShare = options.targetCtaShare ?? asNumber(planFeatureMap.cta_share, 0);
  const shareBased = Math.max(0, Math.min(totalCount, Math.round(targetCtaShare * totalCount)));
  const softPreferredBudget = Math.min(3, preferredCtaCount);
  const ctaTargetCount = Math.min(
    totalCount,
    Math.max(requiredCtaCount, shareBased, requiredCtaCount + softPreferredBudget)
  );
  
  const requiredCtaIndices = publications
    .map((publication, index) => (resolveCtaPreference(publication) === 'required' ? index : null))
    .filter((index) => index !== null);
  const ctaIndices = new Set(requiredCtaIndices);
  const fillSorted = publications
    .map((publication, index) => ({
      index,
      priority: rankCtaPriority(publication),
      hasExistingCta: publication?.cta ? 1 : 0
    }))
    .sort(
      (left, right) =>
        right.priority - left.priority ||
        right.hasExistingCta - left.hasExistingCta ||
        left.index - right.index
    );
  for (const { index } of fillSorted) {
    if (ctaIndices.size >= ctaTargetCount) break;
    if (!ctaIndices.has(index)) ctaIndices.add(index);
  }
  
  const usageByKey = new Map();
  const selectedSources = publications.map((publication, index) =>
    slotResultsById.get(publication?.publication_id) ||
    slotResults[index] ||
    selectArchetypeForPublication(publication, archetypes, usageByKey)
  );
  
  const featureVectors = publications.map((_, index) => {
    const source = selectedSources[index]?.optimizedPublication || selectedSources[index] || archetypes[0];
    const slotFeatureMap = selectedSources[index]?.featureMap || source?.ontology_features || {};
    const baseFeatureMap = assignToneToFeatureMap(cloneFeatureMap(slotFeatureMap, planFeatureMap), publications[index]?.tone);
    return buildPostFeatureVectorFromFeatureMap(assignCtaToFeatureMap(baseFeatureMap, ctaIndices.has(index)));
  });
  
  const predictionResult = await predictPostMetricsByFeatureVectors(featureVectors, { forceTrain: false });

  return {
    publications: publications.map((publication, index) => {
      const source = selectedSources[index]?.optimizedPublication || selectedSources[index] || archetypes[0];
      const slotFeatureMap = selectedSources[index]?.featureMap || source?.ontology_features || {};
      const baseFeatureMap = assignToneToFeatureMap(cloneFeatureMap(slotFeatureMap, planFeatureMap), publication?.tone);
      const featureMap = assignCtaToFeatureMap(baseFeatureMap, ctaIndices.has(index));
      const pred = predictionResult.predictions[index] || [0, 0, 0];
      
      return buildFinalPublication(
        publication,
        source,
        featureMap,
        pred[0],
        pred[1],
        pred[2],
        index
      );
    }),
    ctaTargetCount,
    ctaAssignedCount: ctaIndices.size
  };
}