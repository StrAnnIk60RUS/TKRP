import { buildPostFeatureVector, buildPostFeatureVectorFromFeatureMap, POST_FEATURE_NAMES } from '../../../ml/services/ml/ontologyFeatureEngineering.js';
import { estimatePublicationKpiFromLikes, predictPostLikesByFeatureVectors } from '../../../ml/services/relevancePredictionService.js';
import { runAsyncGeneticAlgorithm } from './asyncGaCore.js';
import { GA_UTILS } from './gaCore.js';
import { 
  cloneJson, 
  onePointCrossoverArrays,
  twoPointCrossoverArrays,
  uniformCrossoverArrays,
  inversionMutation
} from './operators.js';

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

function buildExpectedKpi(existingExpectedKpi = {}, publication = {}, predictedLikes = 0, metadata = null, source = 'ga_post_likes_model') {
  const estimatedKpi = estimatePublicationKpiFromLikes(predictedLikes, publication, metadata);
  return {
    ...(existingExpectedKpi || {}),
    predicted_likes: asNumber(predictedLikes, 0),
    predicted_likes_source: source,
    engagement_rate: estimatedKpi.engagement_rate,
    engagement_rate_source: `${source}_calibrated`,
    conversion_potential: estimatedKpi.conversion_potential,
    reach_potential: estimatedKpi.reach_potential
  };
}

function clampInt(value, min, max, fallback) {
  const numeric = Math.floor(Number(value));
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
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
    if (index === CTA_INDEX && Number.isFinite(Number(constants.hasCta))) return asNumber(constants.hasCta, 0);
    if (index === 34) return asNumber(constants.tonesCount, 1);
    if (index === 35) return asNumber(constants.creativityFromBestPlan, 0.5);
    return nearestAllowedValue(asNumber(genome[index], 0), buildAllowedValues(index));
  });

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

function scoreAlignment(featureMap, planFeatureMap, slotContext = {}) {
  const creativityAlignment = 1 - Math.abs(asNumber(featureMap.creativity, 0) - asNumber(planFeatureMap.avg_creativity, 0));
  const grammarBonus = asNumber(featureMap.grammar_quality, 0);
  const singleToneBonus = featureMap.tone_onehot_0 + featureMap.tone_onehot_1 + featureMap.tone_onehot_2 + featureMap.tone_onehot_3 + featureMap.tone_onehot_4 === 1 ? 1 : 0;
  const targetToneIndex = Number.isInteger(slotContext?.targetToneIndex) ? slotContext.targetToneIndex : null;
  const toneBonus = targetToneIndex === null ? 0.75 : asNumber(featureMap[`tone_onehot_${targetToneIndex}`], 0) * 2.5;
  const ctaPreference = slotContext?.ctaPreference || 'avoid';
  const ctaAlignment =
    ctaPreference === 'required'
      ? asNumber(featureMap.has_cta, 0) * 2.4
      : ctaPreference === 'preferred'
      ? asNumber(featureMap.has_cta, 0) * 1.15
      : (1 - asNumber(featureMap.has_cta, 0)) * 1.4;
  return (creativityAlignment * 4) + (grammarBonus * 2) + singleToneBonus + toneBonus + ctaAlignment;
}

function sumAbsoluteDeviation(vectorA = [], vectorB = []) {
  const size = Math.min(vectorA.length, vectorB.length);
  let total = 0;
  for (let index = 0; index < size; index += 1) {
    total += Math.abs(asNumber(vectorA[index], 0) - asNumber(vectorB[index], 0));
  }
  return total;
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

function calculateRealismPenalty(featureMap, baseFeatureMap, candidateVector, baseVector, baselinePredictedLikes, predictedLikes, planFeatureMap, slotContext = {}) {
  const deviationPenalty = sumAbsoluteDeviation(candidateVector.slice(0, 34), baseVector.slice(0, 34)) * 4.5;
  let qualityPenalty = 0;

  if (asNumber(featureMap.grammar_quality, 0) < 0.75) qualityPenalty += 70;
  if (asNumber(featureMap.tech_quality, 0) < 1) qualityPenalty += 25;
  if (asNumber(featureMap.readability, 0) < 0.25) qualityPenalty += 18;
  if (asNumber(featureMap.idea_clarity, 0) < 0.5) qualityPenalty += 15;
  if (asNumber(featureMap.title_fits_notif, 0) < 1) qualityPenalty += 10;
  if (asNumber(featureMap.creativity, 0) < Math.max(0.25, asNumber(baseFeatureMap.creativity, 0) - 0.1)) qualityPenalty += 35;
  qualityPenalty += Math.abs(asNumber(featureMap.creativity, 0) - asNumber(planFeatureMap?.avg_creativity, 0.5)) * 24;

  const rawPredictedLikes = asNumber(predictedLikes, 0);
  const upperBound = Math.max(baselinePredictedLikes * 1.45, baselinePredictedLikes + 35, 35);
  const cappedPredictedLikes = Math.min(rawPredictedLikes, upperBound);
  const extrapolationOverflow = Math.max(0, rawPredictedLikes - cappedPredictedLikes);
  const extrapolationPenalty = extrapolationOverflow * 1.35;
  const ctaPreference = slotContext?.ctaPreference || 'avoid';
  let ctaPenalty = 0;
  if (ctaPreference === 'required' && asNumber(featureMap.has_cta, 0) < 1) ctaPenalty += 42;
  if (ctaPreference === 'avoid' && asNumber(featureMap.has_cta, 0) > 0) ctaPenalty += 18;
  if (ctaPreference === 'preferred' && asNumber(featureMap.has_cta, 0) < 1) ctaPenalty += 8;
  if (ctaPreference !== 'required' && asNumber(featureMap.has_cta, 0) > 0) {
    ctaPenalty += Math.max(0, 0.55 - asNumber(planFeatureMap?.cta_share, 0)) * 24;
  }
  const targetToneIndex = Number.isInteger(slotContext?.targetToneIndex) ? slotContext.targetToneIndex : null;
  const tonePenalty =
    targetToneIndex === null
      ? 0
      : (1 - asNumber(featureMap[`tone_onehot_${targetToneIndex}`], 0)) * 20;

  return {
    cappedPredictedLikes,
    extrapolationPenalty,
    penalty: deviationPenalty + qualityPenalty + extrapolationPenalty + ctaPenalty + tonePenalty
  };
}

async function evolveSinglePublication(publication, planFeatureMap, gaConfig = {}, publicationIndex = 0, slotContext = {}) {
  const baseVector = buildPostFeatureVector(publication, {
    tonesCount: planFeatureMap.unique_tones,
    creativityFromBestPlan: planFeatureMap.avg_creativity
  });
  const constants = {
    tonesCount: planFeatureMap.unique_tones,
    creativityFromBestPlan: planFeatureMap.avg_creativity,
    hasCta: null
  };
  const baseFeatureMap = createFeatureMap(baseVector);
  const baselinePrediction = await predictPostLikesByFeatureVectors([baseVector], { forceTrain: false });
  const baselinePredictedLikes = asNumber(baselinePrediction?.predictions?.[0], 0);
  const traces = [];

  // ========== ВЫБОР МЕТОДОВ КРОССОВЕРА И МУТАЦИИ ==========
  const crossoverMethod = gaConfig.crossoverMethod || 'one_point';
  const mutationMethod = gaConfig.mutationMethod || 'random_replace';
  const selectionMethod = gaConfig.selectionMethod || 'tournament';

  // Выбираем функцию кроссовера
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
        // Инверсия применяется ко всему геному поста (вектор признаков)
        return inversionMutation(individual, rng);
      };
      break;
    case 'random_replace':
    default:
      mutateFn = (individual, rng) => mutateGenome(individual, constants, rng);
  }

  const result = await runAsyncGeneticAlgorithm({
    direction: 'max',
    seed: gaConfig.seed ?? null,
    populationSize: gaConfig.populationSize ?? 48,
    maxGenerations: gaConfig.maxGenerations ?? 50,
    stagnationGenerations: gaConfig.stagnationGenerations ?? 12,
    eliteSize: gaConfig.eliteSize ?? 3,
    tournamentSize: gaConfig.tournamentSize ?? 4,
    crossoverProbability: gaConfig.crossoverProbability ?? 0.9,
    mutationProbability: gaConfig.mutationProbability ?? 0.1,
    minImprovementEpsilon: gaConfig.minImprovementEpsilon ?? 0.25,
    minImprovementGenerations: gaConfig.minImprovementGenerations ?? 6,
    selectionMethod: selectionMethod,  // НОВЫЙ параметр
    mutationProbabilitySchedule: (state, defaults) => {
      const base = clampProbability(
        gaConfig.mutationProbability ?? defaults.mutationProbability,
        defaults.mutationProbability
      );
      const stagnationRatio = state.stagnation / Math.max(1, Number(gaConfig.stagnationGenerations ?? 12));
      const lowDeltaBoost = state.lowDeltaStreak >= 2 ? 0.03 : 0;
      const stagedBoost = stagnationRatio >= 0.75 ? 0.05 : stagnationRatio >= 0.5 ? 0.02 : 0;
      return clampProbability(base + lowDeltaBoost + stagedBoost, base);
    },
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
      const predictionResult = await predictPostLikesByFeatureVectors(repaired, { forceTrain: false });
      return predictionResult.predictions.map((predictedLikes, index) => {
        const featureMap = createFeatureMap(repaired[index]);
        const realism = calculateRealismPenalty(
          featureMap,
          baseFeatureMap,
          repaired[index],
          baseVector,
          baselinePredictedLikes,
          predictedLikes,
          planFeatureMap,
          slotContext
        );
        const effectivePredictedLikes = Math.max(0, realism.cappedPredictedLikes);
        const alignmentBonus = scoreAlignment(featureMap, planFeatureMap, slotContext);
        return {
          score: effectivePredictedLikes + alignmentBonus - realism.penalty,
          meta: {
            predicted_likes: Number(effectivePredictedLikes.toFixed(2)),
            raw_predicted_likes: Number(asNumber(predictedLikes, 0).toFixed(2)),
            realism_penalty: Number(realism.penalty.toFixed(2)),
            extrapolation_penalty: Number(realism.extrapolationPenalty.toFixed(2)),
            alignment_bonus: Number(alignmentBonus.toFixed(2)),
            creativity: featureMap.creativity,
            grammar_quality: featureMap.grammar_quality,
            cta: featureMap.has_cta,
            cta_preference: slotContext?.ctaPreference || 'avoid',
            target_tone_index: slotContext?.targetToneIndex ?? null
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
        improvement_delta: entry.improvement_delta,
        summary: entry.best_meta
      }));
    }
  });

  const bestVector = repairGenome(result.best || baseVector, constants);
  const featureMap = createFeatureMap(bestVector);
  const bestPredictedLikes = asNumber(result.best_meta?.predicted_likes, 0);
  return {
    optimizedPublication: {
      ...publication,
      expected_kpi: buildExpectedKpi(
        publication.expected_kpi || {},
        { ...publication, ontology_features: featureMap },
        bestPredictedLikes,
        baselinePrediction?.metadata || null,
        'ga_post_likes_model'
      ),
      ontology_features: featureMap
    },
    predictedLikes: bestPredictedLikes,
    featureVector: bestVector,
    featureMap,
    ga: {
      ...result,
      history: traces
    }
  };
}

export async function optimizePublicationsEvolution(publications = [], planFeatureMap = {}, config = {}) {
  const gaConfig = config.ga || config;
  const optimized = await mapWithConcurrency(
    publications,
    gaConfig.parallelism ?? config.parallelism ?? 3,
    (publication, index) =>
      evolveSinglePublication(publication, planFeatureMap, gaConfig, index, {
        targetToneIndex: resolveToneIndex(publication?.tone),
        ctaPreference: resolveCtaPreference(publication)
      })
  );

  const bestPublication = optimized
    .slice()
    .sort((left, right) => right.predictedLikes - left.predictedLikes)[0] || null;
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

function buildFinalPublication(basePublication, bestPublication, featureMap, predictedLikes, index, modelMetadata = null) {
  const source = cloneJson(bestPublication || {});
  const nextPredictedLikes = asNumber(predictedLikes, 0);
  const mergedForHeuristics = {
    ...source,
    ...cloneJson(basePublication || {}),
    ontology_features: featureMap
  };
  return {
    ...source,
    ...cloneJson(basePublication || {}),
    publication_id:
      basePublication?.publication_id ||
      source?.publication_id ||
      `final_publication_${String(index + 1).padStart(3, '0')}`,
    planned_date: basePublication?.planned_date || source?.planned_date || null,
    planned_at: basePublication?.planned_at || source?.planned_at || null,
    platform: basePublication?.platform || source?.platform || null,
    topic: basePublication?.topic || source?.topic || null,
    format: basePublication?.format || source?.format || null,
    objective: basePublication?.objective || source?.objective || null,
    tone: basePublication?.tone || source?.tone || null,
    cta: featureMap.has_cta ? source?.cta || 'Свяжитесь с нами, чтобы получить детали.' : '',
    expected_kpi: buildExpectedKpi(
      source?.expected_kpi || {},
      mergedForHeuristics,
      nextPredictedLikes,
      modelMetadata,
      'final_best_post_template'
    ),
    ontology_features: featureMap
  };
}

export async function fillPlanWithBestPublication(publications = [], bestPublication, planFeatureMap = {}, options = {}) {
  const slotResults = Array.isArray(bestPublication)
    ? bestPublication.filter((item) => item?.optimizedPublication || item?.publication_id)
    : [];
  const slotResultsById = new Map(
    slotResults
      .filter((item) => item?.optimizedPublication?.publication_id)
      .map((item) => [item.optimizedPublication.publication_id, item])
  );
  const archetypes = slotResults.length
    ? buildPublicationArchetypes(slotResults, options.maxArchetypes ?? 5)
    : Array.isArray(bestPublication)
    ? bestPublication.filter(Boolean)
    : bestPublication
    ? [bestPublication]
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
  const ctaTargetCount = Math.max(
    requiredCtaCount,
    Math.max(0, Math.min(totalCount, Math.round(asNumber(planFeatureMap.cta_share, 0) * totalCount)))
  );
  const ctaIndices = new Set(
    publications
      .map((publication, index) => ({
        index,
        priority: rankCtaPriority(publication),
        hasExistingCta: publication?.cta ? 1 : 0
      }))
      .sort((left, right) => right.priority - left.priority || right.hasExistingCta - left.hasExistingCta || left.index - right.index)
      .slice(0, ctaTargetCount)
      .map((item) => item.index)
  );
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
  const predictionResult = await predictPostLikesByFeatureVectors(featureVectors, { forceTrain: false });

  return {
    publications: publications.map((publication, index) => {
      const source = selectedSources[index]?.optimizedPublication || selectedSources[index] || archetypes[0];
      const slotFeatureMap = selectedSources[index]?.featureMap || source?.ontology_features || {};
      const baseFeatureMap = assignToneToFeatureMap(cloneFeatureMap(slotFeatureMap, planFeatureMap), publication?.tone);
      const featureMap = assignCtaToFeatureMap(baseFeatureMap, ctaIndices.has(index));
      return buildFinalPublication(
        publication,
        source,
        featureMap,
        predictionResult.predictions[index],
        index,
        predictionResult?.metadata || null
      );
    }),
    ctaTargetCount,
    ctaAssignedCount: ctaIndices.size
  };
}