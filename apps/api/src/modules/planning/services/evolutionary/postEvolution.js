import { buildPostFeatureVector, buildPostFeatureVectorFromFeatureMap, POST_FEATURE_NAMES } from '../../../ml/services/ml/ontologyFeatureEngineering.js';
import { predictPostLikesByFeatureVectors } from '../../../ml/services/relevancePredictionService.js';
import { runAsyncGeneticAlgorithm } from './asyncGaCore.js';
import { GA_UTILS } from './gaCore.js';
import { cloneJson, onePointCrossoverArrays } from './operators.js';

const TONE_START = 24;
const TONE_END = 28;

function asNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
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

function repairGenome(genome, constants = {}) {
  const repaired = POST_FEATURE_NAMES.map((_, index) => {
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

function scoreAlignment(featureMap, planFeatureMap) {
  const creativityAlignment = 1 - Math.abs(asNumber(featureMap.creativity, 0) - asNumber(planFeatureMap.avg_creativity, 0));
  const grammarBonus = asNumber(featureMap.grammar_quality, 0);
  const singleToneBonus = featureMap.tone_onehot_0 + featureMap.tone_onehot_1 + featureMap.tone_onehot_2 + featureMap.tone_onehot_3 + featureMap.tone_onehot_4 === 1 ? 1 : 0;
  return (creativityAlignment * 25) + (grammarBonus * 10) + (singleToneBonus * 5);
}

function sumAbsoluteDeviation(vectorA = [], vectorB = []) {
  const size = Math.min(vectorA.length, vectorB.length);
  let total = 0;
  for (let index = 0; index < size; index += 1) {
    total += Math.abs(asNumber(vectorA[index], 0) - asNumber(vectorB[index], 0));
  }
  return total;
}

function calculateRealismPenalty(featureMap, baseFeatureMap, candidateVector, baseVector, baselinePredictedLikes, predictedLikes) {
  const deviationPenalty = sumAbsoluteDeviation(candidateVector.slice(0, 34), baseVector.slice(0, 34)) * 3.5;
  let qualityPenalty = 0;

  if (asNumber(featureMap.grammar_quality, 0) < 0.75) qualityPenalty += 70;
  if (asNumber(featureMap.tech_quality, 0) < 1) qualityPenalty += 25;
  if (asNumber(featureMap.readability, 0) < 0.25) qualityPenalty += 18;
  if (asNumber(featureMap.idea_clarity, 0) < 0.5) qualityPenalty += 15;
  if (asNumber(featureMap.title_fits_notif, 0) < 1) qualityPenalty += 10;
  if (asNumber(featureMap.creativity, 0) < Math.max(0.25, asNumber(baseFeatureMap.creativity, 0) - 0.1)) qualityPenalty += 35;

  const upperBound = Math.max(baselinePredictedLikes * 2, baselinePredictedLikes + 60, 60);
  const cappedPredictedLikes = Math.min(asNumber(predictedLikes, 0), upperBound);

  return {
    cappedPredictedLikes,
    penalty: deviationPenalty + qualityPenalty
  };
}

async function evolveSinglePublication(publication, planFeatureMap, gaConfig = {}, publicationIndex = 0) {
  const baseVector = buildPostFeatureVector(publication, {
    tonesCount: planFeatureMap.unique_tones,
    creativityFromBestPlan: planFeatureMap.avg_creativity
  });
  const constants = {
    tonesCount: planFeatureMap.unique_tones,
    creativityFromBestPlan: planFeatureMap.avg_creativity
  };
  const baseFeatureMap = createFeatureMap(baseVector);
  const baselinePrediction = await predictPostLikesByFeatureVectors([baseVector], { forceTrain: false });
  const baselinePredictedLikes = asNumber(baselinePrediction?.predictions?.[0], 0);
  const traces = [];

  const result = await runAsyncGeneticAlgorithm({
    direction: 'max',
    seed: gaConfig.seed ?? null,
    populationSize: gaConfig.populationSize ?? 20,
    maxGenerations: gaConfig.maxGenerations ?? 20,
    stagnationGenerations: gaConfig.stagnationGenerations ?? 6,
    eliteSize: gaConfig.eliteSize ?? 2,
    tournamentSize: gaConfig.tournamentSize ?? 3,
    crossoverProbability: gaConfig.crossoverProbability ?? 0.8,
    mutationProbability: gaConfig.mutationProbability ?? 0.14,
    createIndividual: (rng) => createIndividual(baseVector, constants, rng),
    cloneIndividual: (individual) => cloneJson(individual),
    crossover: (left, right, rng) => {
      const crossed = onePointCrossoverArrays(left, right, rng);
      return crossed.map((child) => repairGenome(child, constants));
    },
    mutate: (individual, rng) => mutateGenome(individual, constants, rng),
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
          predictedLikes
        );
        const effectivePredictedLikes = Math.max(0, realism.cappedPredictedLikes);
        return {
          score: effectivePredictedLikes + scoreAlignment(featureMap, planFeatureMap) - realism.penalty,
          meta: {
            predicted_likes: Number(effectivePredictedLikes.toFixed(2)),
            raw_predicted_likes: Number(asNumber(predictedLikes, 0).toFixed(2)),
            realism_penalty: Number(realism.penalty.toFixed(2)),
            creativity: featureMap.creativity,
            grammar_quality: featureMap.grammar_quality,
            cta: featureMap.has_cta
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
  return {
    optimizedPublication: {
      ...publication,
      expected_kpi: {
        ...(publication.expected_kpi || {}),
        predicted_likes: asNumber(result.best_meta?.predicted_likes, 0),
        predicted_likes_source: 'ga_post_likes_model',
        engagement_rate: Math.min(1, asNumber(result.best_meta?.predicted_likes, 0) / 100),
        engagement_rate_source: 'ga_post_likes_model_normalized'
      },
      ontology_features: featureMap
    },
    predictedLikes: asNumber(result.best_meta?.predicted_likes, 0),
    featureVector: bestVector,
    featureMap,
    ga: {
      ...result,
      history: traces
    }
  };
}

export async function optimizePublicationsEvolution(publications = [], planFeatureMap = {}, config = {}) {
  const optimized = [];
  for (let index = 0; index < publications.length; index += 1) {
    optimized.push(await evolveSinglePublication(publications[index], planFeatureMap, config.ga || config, index));
  }

  const bestPublication = optimized
    .slice()
    .sort((left, right) => right.predictedLikes - left.predictedLikes)[0] || null;

  return {
    optimizedPublications: optimized.map((item) => item.optimizedPublication),
    publicationResults: optimized,
    bestPublication: bestPublication?.optimizedPublication || null
  };
}

function cloneFeatureMap(featureMap = {}, planFeatureMap = {}) {
  const next = { ...featureMap };
  next.tones_count = asNumber(planFeatureMap.unique_tones, next.tones_count || 1);
  next.creativity_from_best_plan = asNumber(planFeatureMap.avg_creativity, next.creativity_from_best_plan || 0);
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

function buildFinalPublication(basePublication, bestPublication, featureMap, predictedLikes, index) {
  const source = cloneJson(bestPublication || {});
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
    expected_kpi: {
      ...(source?.expected_kpi || {}),
      predicted_likes: asNumber(predictedLikes, 0),
      predicted_likes_source: 'final_best_post_template',
      engagement_rate: Math.min(1, asNumber(predictedLikes, 0) / 100),
      engagement_rate_source: 'final_best_post_template'
    },
    ontology_features: featureMap
  };
}

export async function fillPlanWithBestPublication(publications = [], bestPublication, planFeatureMap = {}, options = {}) {
  if (!bestPublication || !Array.isArray(publications) || publications.length === 0) {
    return {
      publications: publications || [],
      ctaTargetCount: 0,
      ctaAssignedCount: 0
    };
  }

  const rng = GA_UTILS.makeRng(options.seed ?? null);
  const baseFeatureMap = cloneFeatureMap(bestPublication.ontology_features || {}, planFeatureMap);
  const totalCount = publications.length;
  const ctaTargetCount = Math.max(0, Math.min(totalCount, Math.round(asNumber(planFeatureMap.cta_share, 0) * totalCount)));
  const shuffledIndices = Array.from({ length: totalCount }, (_, index) => index);

  for (let index = shuffledIndices.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1));
    const temp = shuffledIndices[index];
    shuffledIndices[index] = shuffledIndices[swapIndex];
    shuffledIndices[swapIndex] = temp;
  }

  const ctaIndices = new Set(shuffledIndices.slice(0, ctaTargetCount));
  const featureVectors = publications.map((_, index) =>
    buildPostFeatureVectorFromFeatureMap(assignCtaToFeatureMap(baseFeatureMap, ctaIndices.has(index)))
  );
  const predictionResult = await predictPostLikesByFeatureVectors(featureVectors, { forceTrain: false });

  return {
    publications: publications.map((publication, index) => {
      const featureMap = assignCtaToFeatureMap(baseFeatureMap, ctaIndices.has(index));
      return buildFinalPublication(publication, bestPublication, featureMap, predictionResult.predictions[index], index);
    }),
    ctaTargetCount,
    ctaAssignedCount: ctaIndices.size
  };
}
