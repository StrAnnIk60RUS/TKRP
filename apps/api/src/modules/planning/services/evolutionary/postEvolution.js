import { buildPostFeatureVector, POST_FEATURE_NAMES } from '../../../ml/services/ml/ontologyFeatureEngineering.js';
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
  estimateCommentsFromBase,
  kpiScore,
  combineFitness
} from './fitnessUtils.js';
import {
  buildDraftSemanticCore,
  buildObjectiveCta,
  calibrateExpectedKpi,
  choosePreferredKeyMessage,
  choosePreferredSummary,
  choosePreferredTopic,
  normalizePublicationTopicForUi
} from '../contentOutputUtils.js';
import { generatePostContent } from '../llmPostGeneration.js';
import { buildFallbackMediaPrompt, mediaKindForFormat } from '../mediaGenerationService.js';

const TONE_START = 24;
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

function calculateFitness(predictedMetrics, metadata, publication = null) {
  const estimate = estimateCommentsFromBase(
    predictedMetrics?.[0],
    publication?.metrics || publication?.raw_metrics || null
  );
  const metrics = estimate == null ? predictedMetrics : [predictedMetrics[0], predictedMetrics[1], predictedMetrics[2], estimate];
  return kpiScore(metrics, metadata, { keyPrefix: '' });
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

const TONE_LABELS = ['expert', 'friendly', 'official', 'inspiring', 'humorous'];
const HOOK_IDS = ['direct', 'question', 'case', 'contrast'];
const LENGTH_IDS = ['short', 'medium', 'long'];

function decisionAllowed(index) {
  if (index === 0) return [0, 1, 2, 3, 4];
  if (index === 1) return [0, 0.25, 0.5, 0.75, 1];
  if (index === 3) return [0, 1, 2, 3];
  if (index === 4) return [0, 1, 2];
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

function toneFromFeatureMap(featureMap = {}) {
  let bestIndex = -1;
  let bestValue = 0;
  for (let index = 0; index <= 4; index += 1) {
    const value = asNumber(featureMap?.[`tone_onehot_${index}`], 0);
    if (value > bestValue) {
      bestValue = value;
      bestIndex = index;
    }
  }
  if (bestIndex < 0) return '';
  return ['expert', 'friendly', 'official', 'inspiring', 'humorous'][bestIndex];
}

function resolveCtaPreference(publication = {}) {
  const objective = String(publication?.objective || '').toLowerCase();
  if (objective === 'convert' || objective === 'retain') return 'required';
  if (objective === 'engage' || objective === 'brand_building') return 'preferred';
  return 'avoid';
}

function baseDecision(publication = {}) {
  const toneIndex = resolveToneIndex(publication?.tone);
  const creativity = asNumber(publication?.ontology_features?.creativity, 0.5);
  return [
    toneIndex == null ? 0 : toneIndex,
    nearestAllowedValue(creativity, decisionAllowed(1)),
    String(publication?.cta || '').trim() ? 1 : 0,
    0,
    1,
    detectListsFlag(publication)
  ];
}

function detectListsFlag(publication = {}) {
  const text = `${publication?.summary || ''}\n${publication?.key_message || ''}`;
  return /(^|\n)\s*(?:[-•*]|\d+[.)])\s+/u.test(text) ? 1 : 0;
}

function repairDecision(genome, constants = {}) {
  const next = [0, 1, 2, 3, 4, 5].map((index) =>
    nearestAllowedValue(asNumber(genome?.[index], 0), decisionAllowed(index))
  );
  if (Number.isInteger(constants.targetToneIndex) && constants.targetToneIndex >= 0 && constants.targetToneIndex <= 4) {
    next[0] = constants.targetToneIndex;
  }
  if (constants.hasCta !== undefined && constants.hasCta !== null) {
    next[2] = asNumber(constants.hasCta, 0) >= 0.5 ? 1 : 0;
  }
  return next;
}

function writingBriefFromDecision(decision) {
  return {
    tone: TONE_LABELS[decision[0]] || 'expert',
    creativity: decision[1],
    has_cta: decision[2] >= 0.5 ? 1 : 0,
    hook: HOOK_IDS[decision[3]] || 'direct',
    length: LENGTH_IDS[decision[4]] || 'medium',
    lists: decision[5] >= 0.5 ? 1 : 0
  };
}

function projectDecisionToVector(decision, baseVector, planFeatureMap = {}) {
  const vector = Array.isArray(baseVector) ? baseVector.slice() : [];
  while (vector.length < POST_FEATURE_NAMES.length) vector.push(0);
  for (let index = 0; index < 5; index += 1) {
    vector[TONE_START + index] = index === decision[0] ? 1 : 0;
  }
  vector[CTA_INDEX] = decision[2] >= 0.5 ? 1 : 0;
  vector[POST_FEATURE_NAMES.indexOf('creativity')] = decision[1];
  vector[POST_FEATURE_NAMES.indexOf('lead_is_hook')] = decision[3] > 0 ? 1 : 0;
  vector[POST_FEATURE_NAMES.indexOf('title_has_question')] = decision[3] === 1 ? 1 : 0;
  vector[POST_FEATURE_NAMES.indexOf('title_has_intrigue')] = decision[3] === 2 ? 1 : 0;
  vector[POST_FEATURE_NAMES.indexOf('title_has_digit')] = decision[3] === 3 ? 1 : 0;
  vector[POST_FEATURE_NAMES.indexOf('has_lists')] = decision[5] >= 0.5 ? 1 : 0;
  vector[POST_FEATURE_NAMES.indexOf('sentence_length')] = decision[4] === 0 ? 0 : decision[4] === 2 ? 1 : 0.5;
  vector[POST_FEATURE_NAMES.indexOf('lead_length_norm')] = decision[4] === 0 ? 0.25 : decision[4] === 2 ? 1 : 0.5;
  vector[34] = asNumber(planFeatureMap.unique_tones, 1);
  vector[35] = asNumber(planFeatureMap.avg_creativity, decision[1]);
  return vector;
}

function createFeatureMap(vector) {
  return POST_FEATURE_NAMES.reduce((acc, name, index) => {
    acc[name] = vector[index] ?? 0;
    return acc;
  }, {});
}

function createDecisionIndividual(baseDecisionGenome, constants, rng) {
  const genome = baseDecisionGenome.map((value, index) => {
    const allowed = decisionAllowed(index);
    const keepBase = rng() < 0.4;
    return keepBase ? nearestAllowedValue(value, allowed) : allowed[Math.floor(rng() * allowed.length)];
  });
  return repairDecision(genome, constants);
}

function mutateDecision(genome, constants, rng) {
  const next = genome.slice();
  const mutableIndex = Math.floor(rng() * next.length);
  const allowed = decisionAllowed(mutableIndex);
  next[mutableIndex] = allowed[Math.floor(rng() * allowed.length)];
  return repairDecision(next, constants);
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
  const startingDecision = baseDecision(publication);
  const targetToneIndex = lockedFields.targetToneIndex === undefined || lockedFields.targetToneIndex === null
    ? null
    : lockedFields.targetToneIndex;
  
  const constants = {
    tonesCount: planFeatureMap.unique_tones,
    creativityFromBestPlan: planFeatureMap.avg_creativity,
    hasCta: lockedFields.has_cta,
    targetToneIndex
  };
  
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
    0.2
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
      mutateFn = (individual, rng) => repairDecision(inversionMutation(individual, rng), constants);
      break;
    case 'random_replace':
    default:
      mutateFn = (individual, rng) => mutateDecision(individual, constants, rng);
  }

  const traces = [];
  const repairedBasesAll = stage2Options.repairedBases;
  const peerWeight = clampProbability(asNumber(stage2Options.peerDiversityWeight, 0.28), 0.28);
  const targetCtaShare = asNumber(stage2Options.targetCtaShare, -1);
  const ctaAlignmentWeight = lockedFields.has_cta === undefined || lockedFields.has_cta === null
    ? clampProbability(asNumber(stage2Options.ctaAlignmentWeight, 0.05), 0.05)
    : 0;
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
    createIndividual: (rng) => createDecisionIndividual(startingDecision, constants, rng),
    cloneIndividual: (individual) => cloneJson(individual),
    crossover: (left, right, rng) => {
      const crossed = crossoverFn(left, right, rng);
      return crossed.map((child) => repairDecision(child, constants));
    },
    mutate: mutateFn,
    cacheKeyForIndividual: (individual) => JSON.stringify(individual),
    scorePopulation: async (population) => {
      const repaired = population.map((item) => repairDecision(item, constants));
      const projected = repaired.map((item) => projectDecisionToVector(item, baseVector, planFeatureMap));
      const predictionResult = await predictPostMetricsByFeatureVectors(projected, { forceTrain: false });
      
      return predictionResult.predictions.map((predictedMetrics, index) => {
        const capped = capPostPredictedMetrics(predictedMetrics, predictionResult.metadata);
        const kpi = calculateFitness(
          [capped.cappedLikes, capped.cappedShares, capped.cappedViews],
          predictionResult.metadata,
          publication
        );
        const diversity = peerGenomeDiversityScore(repaired[index], peerGenomes);
        let ctaPenalty = 0;
        if (ctaAlignmentWeight > 0 && targetCtaShare >= 0) {
          const geneCta = asNumber(repaired[index][2], 0) >= 0.5 ? 1 : 0;
          ctaPenalty = ctaAlignmentWeight * Math.abs(geneCta - targetCtaShare);
        }
        const combined = combineFitness({
          kpi,
          diversity,
          diversityWeight: peerGenomes.length ? peerWeight : 0,
          penalty: ctaPenalty
        });
        const fitness = combined.optimization;

        return {
          score: fitness,
          meta: {
            predicted_likes: capped.cappedLikes,
            predicted_shares: capped.cappedShares,
            predicted_views: capped.cappedViews,
            fitness,
            display_fitness: combined.display,
            peer_diversity: diversity,
            cta_penalty: ctaPenalty
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

  const bestDecision = repairDecision(result.best || startingDecision, constants);
  const bestVector = projectDecisionToVector(bestDecision, baseVector, planFeatureMap);
  const featureMap = createFeatureMap(bestVector);
  const writingBrief = writingBriefFromDecision(bestDecision);
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
        predicted_likes_source: 'decision_proxy'
      },
      tone: writingBrief.tone,
      ontology_features: featureMap,
      writing_brief: writingBrief
    },
    predictedLikes: bestLikes,
    predictedShares: bestShares,
    predictedViews: bestViews,
    fitness: bestFitness,
    featureVector: bestVector,
    featureMap,
    writingBrief,
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

function selectArchetypeForPublication(publication = {}, archetypes = [], usageByKey = new Map(), toneUsage = null, targetUniqueTones = 0) {
  if (!Array.isArray(archetypes) || archetypes.length === 0) return null;
  let bestArchetype = archetypes[0];
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const archetype of archetypes) {
    const key = createArchetypeKey(archetype);
    const usagePenalty = (usageByKey.get(key) || 0) * 6;
    const toneKey = String(archetype?.tone || '').toLowerCase();
    const tonePenalty = toneUsage && targetUniqueTones > toneUsage.size
      ? (toneUsage.get(toneKey) || 0) * 2
      : 0;
    const score = scoreArchetypeMatch(publication, archetype) - usagePenalty - tonePenalty;
    if (score > bestScore) {
      bestArchetype = archetype;
      bestScore = score;
    }
  }

  const selectedKey = createArchetypeKey(bestArchetype);
  usageByKey.set(selectedKey, (usageByKey.get(selectedKey) || 0) + 1);
  if (toneUsage) {
    const selectedToneKey = String(bestArchetype?.tone || '').toLowerCase();
    toneUsage.set(selectedToneKey, (toneUsage.get(selectedToneKey) || 0) + 1);
  }
  return bestArchetype;
}

function resolveWritingBrief(slotResult, publication, featureMap = {}) {
  const stored = slotResult?.writingBrief || slotResult?.optimizedPublication?.writing_brief;
  if (stored && typeof stored === 'object') {
    return {
      tone: stored.tone || toneFromFeatureMap(featureMap) || publication?.tone || 'expert',
      creativity: asNumber(stored.creativity, 0.5),
      has_cta: asNumber(stored.has_cta, 0) >= 0.5 ? 1 : 0,
      hook: HOOK_IDS.includes(stored.hook) ? stored.hook : 'direct',
      length: LENGTH_IDS.includes(stored.length) ? stored.length : 'medium',
      lists: asNumber(stored.lists, 0) >= 0.5 ? 1 : 0
    };
  }
  return {
    tone: toneFromFeatureMap(featureMap) || publication?.tone || 'expert',
    creativity: asNumber(featureMap.creativity, 0.5),
    has_cta: asNumber(featureMap.has_cta, 0) > 0 ? 1 : 0,
    hook: 'direct',
    length: 'medium',
    lists: asNumber(featureMap.has_lists, 0) > 0 ? 1 : 0
  };
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

function buildFinalPublication(basePublication, bestPublication, featureMap, predictedLikes, predictedShares, predictedViews, index, toneOverride = '', keyMessageOverride = null, summaryOverride = null, ctaOverride = null) {
  const source = cloneJson(bestPublication || {});
  const base = cloneJson(basePublication || {});
  const semanticCore = base?.semantic_core || source?.semantic_core || buildDraftSemanticCore(basePublication || bestPublication || {});
  const baseKpi = base?.expected_kpi && typeof base.expected_kpi === 'object' ? base.expected_kpi : {};
  const sourceKpi = source?.expected_kpi && typeof source.expected_kpi === 'object' ? source.expected_kpi : {};
  const objective = base?.objective || source?.objective || null;
  const format = base?.format || source?.format || null;
  const tone = toneOverride || base?.tone || source?.tone || null;
  const topic = normalizePublicationTopicForUi(
    choosePreferredTopic(semanticCore, base?.topic || source?.topic || null, objective, index)
  );
   const cta = typeof ctaOverride === 'string' && ctaOverride.trim()
     ? ctaOverride.trim()
     : resolveEffectiveCta(
       { ...base, objective, topic },
       { ...source, objective, topic },
       featureMap
     );
   const keyMessage = typeof keyMessageOverride === 'string' && keyMessageOverride.trim()
     ? keyMessageOverride.trim()
     : choosePreferredKeyMessage(semanticCore, base?.key_message || source?.key_message || '', {
       topic,
       objective,
       format,
       tone,
       index
     });
   const summary = typeof summaryOverride === 'string' && summaryOverride.trim()
     ? summaryOverride.trim()
     : choosePreferredSummary(semanticCore, base?.summary || source?.summary || '', {
       topic,
       format,
       fallbackSummary: base?.summary || source?.summary || ''
     });
  const nextPublication = {
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
      predicted_likes_source: 'written_post_features'
    },
    ontology_features: featureMap
  };
  return {
    ...nextPublication,
    semantic_core: buildDraftSemanticCore(nextPublication)
  };
}

function rebalanceBriefField(results, field, allowed, limit) {
  const counts = new Map();
  for (const item of results) {
    const value = item.writingBrief?.[field] || allowed[0];
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  const order = results
    .map((item, index) => ({ index, fitness: asNumber(item.fitness, 0) }))
    .sort((left, right) => left.fitness - right.fitness);
  for (const { index } of order) {
    const value = results[index].writingBrief?.[field] || allowed[0];
    if ((counts.get(value) || 0) <= limit) continue;
    const replacement = allowed
      .slice()
      .sort((left, right) => (counts.get(left) || 0) - (counts.get(right) || 0))
      .find((candidate) => candidate !== value);
    if (!replacement) continue;
    counts.set(value, (counts.get(value) || 1) - 1);
    counts.set(replacement, (counts.get(replacement) || 0) + 1);
    results[index].writingBrief = {
      ...(results[index].writingBrief || {}),
      [field]: replacement
    };
    if (results[index].optimizedPublication) {
      results[index].optimizedPublication = {
        ...results[index].optimizedPublication,
        ...(field === 'tone' ? { tone: replacement } : {}),
        writing_brief: { ...results[index].writingBrief }
      };
    }
  }
}

/** After independent post GAs, spread tone and hook across the chosen briefs. */
function reconcileChosenBriefs(results = []) {
  if (!Array.isArray(results) || results.length < 2) return results;
  const next = results.map((item) => ({
    ...item,
    writingBrief: { ...(item.writingBrief || item.optimizedPublication?.writing_brief || {}) }
  }));
  rebalanceBriefField(next, 'tone', TONE_LABELS, Math.max(1, Math.ceil(next.length / TONE_LABELS.length)));
  rebalanceBriefField(next, 'hook', HOOK_IDS, Math.max(1, Math.ceil(next.length / HOOK_IDS.length)));
  return next;
}

export async function optimizePublicationsEvolution(publications = [], planFeatureMap = {}, config = {}) {
  const gaConfig = config.ga || config;
  const lockedFields = config.lockedFields || {};

  const repairedBases = publications.map((pub) => {
    const targetToneIndex = lockedFields.targetToneIndex === undefined || lockedFields.targetToneIndex === null
      ? null
      : lockedFields.targetToneIndex;
    return repairDecision(baseDecision(pub), {
      hasCta: lockedFields.has_cta,
      targetToneIndex
    });
  });

  const peerDivRaw =
    gaConfig.peerDiversityWeight ??
    config.peerDiversityWeight ??
    readPostGaEnvNumber('PLAN_GA_PEER_DIVERSITY_WEIGHT');
  const peerDiversityWeight = Number.isFinite(Number(peerDivRaw))
    ? clampProbability(peerDivRaw, 0.28)
    : 0.28;

  const optimized = await mapWithConcurrency(
    publications,
    gaConfig.parallelism ?? config.parallelism ?? 3,
    (publication, index) =>
      evolveSinglePublication(publication, planFeatureMap, gaConfig, index, lockedFields, {
        repairedBases,
        peerDiversityWeight,
        targetCtaShare: config.targetCtaShare ?? planFeatureMap?.cta_share,
        ctaAlignmentWeight: config.ctaAlignmentWeight ?? gaConfig.ctaAlignmentWeight
      })
  );

  const coordinated = reconcileChosenBriefs(optimized);
  const bestPublication = coordinated
    .slice()
    .sort((left, right) => right.fitness - left.fitness)[0] || null;
  const archetypes = buildPublicationArchetypes(
    coordinated,
    gaConfig.maxArchetypes ?? config.maxArchetypes ?? 8
  );

  return {
    optimizedPublications: coordinated.map((item) => item.optimizedPublication),
    publicationResults: coordinated,
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
    ? buildPublicationArchetypes(slotResults, options.maxArchetypes ?? 8)
    : [];
    
  if (!archetypes.length || !Array.isArray(publications) || publications.length === 0) {
    return {
      publications: publications || [],
      ctaTargetCount: 0,
      ctaAssignedCount: 0
    };
  }

  const usageByKey = new Map();
  const toneUsage = new Map();
   const targetUniqueTones = options.targetUniqueTones ?? asNumber(planFeatureMap.unique_tones, 0);
   const llmContext = options.llmContext || {};
   const formInput = llmContext.formInput || llmContext.form_input;
   const ragResults = llmContext.ragResults;
   const selectedSources = publications.map((publication, index) =>
    slotResultsById.get(publication?.publication_id) ||
    slotResults[index] ||
    selectArchetypeForPublication(publication, archetypes, usageByKey, toneUsage, targetUniqueTones)
  );
  
  const avoidOpenings = [];
  const avoidTopics = [];
  const drafts = [];
  for (let index = 0; index < publications.length; index += 1) {
    const publication = publications[index];
    const source = selectedSources[index]?.optimizedPublication || selectedSources[index] || archetypes[0];
    const slotFeatureMap = selectedSources[index]?.featureMap || source?.ontology_features || {};
    const brief = resolveWritingBrief(selectedSources[index], publication, slotFeatureMap);
    const evolvedTone = brief.tone || toneFromFeatureMap(slotFeatureMap) || publication?.tone;
    const topic = publication?.topic || source?.topic;
    const format = publication?.format || source?.format;
    const objective = publication?.objective || source?.objective;
    const generated = await generatePostContent(
      publication,
      {
        topic,
        format,
        objective,
        tone: evolvedTone || source?.tone,
        platform: publication?.platform || source?.platform,
        has_cta: brief.has_cta,
        creativity: brief.creativity,
        hook: brief.hook,
        length: brief.length,
        lists: brief.lists,
        index,
        avoid_openings: avoidOpenings.slice(-12),
        avoid_topics: avoidTopics.slice(-24)
      },
      formInput,
      ragResults,
      {}
    );
    const keyMessage = generated?.key_message || generated?.keyMessage || '';
    const summary = generated?.summary || '';
    const cta = generated?.cta || '';
    if (summary) avoidOpenings.push(String(summary).replace(/\s+/g, ' ').trim().slice(0, 120));
    if (topic) avoidTopics.push(String(topic));
    drafts.push({
      publication,
      source,
      brief,
      evolvedTone,
      keyMessage,
      summary,
      cta,
      mediaPrompt: String(generated?.media_prompt || '').trim(),
      textOrigin: generated?.text_origin || 'llm'
    });
  }

  const featureOptions = {
    tonesCount: planFeatureMap.unique_tones,
    creativityFromBestPlan: planFeatureMap.avg_creativity
  };
  const bodyIsUsable = (summary, keyMessage) =>
    String(summary || '').trim().length >= 80 && String(keyMessage || '').trim().length >= 12;

  const writtenVectors = drafts.map((draft) => buildPostFeatureVector({
    topic: draft.publication?.topic || draft.source?.topic,
    summary: draft.summary,
    key_message: draft.keyMessage,
    cta: draft.cta,
    tone: draft.evolvedTone
  }, featureOptions));
  const predictionResult = await predictPostMetricsByFeatureVectors(writtenVectors, { forceTrain: false });
  const shouldCompareDraft = drafts.some((draft) =>
    draft.textOrigin === 'template_fallback' ||
    bodyIsUsable(draft.publication?.summary, draft.publication?.key_message)
  );
  const originalVectors = shouldCompareDraft
    ? drafts.map((draft) => buildPostFeatureVector({
      topic: draft.publication?.topic,
      summary: draft.publication?.summary,
      key_message: draft.publication?.key_message,
      cta: draft.publication?.cta,
      tone: draft.publication?.tone
    }, featureOptions))
    : [];
  const originalPrediction = originalVectors.length
    ? await predictPostMetricsByFeatureVectors(originalVectors, { forceTrain: false })
    : null;

  const publicationsArray = drafts.map((draft, index) => {
    const writtenPred = predictionResult.predictions[index] || [0, 0, 0];
    const originalPred = originalPrediction?.predictions?.[index] || null;
    let summary = draft.summary;
    let keyMessage = draft.keyMessage;
    let cta = draft.cta;
    let textOrigin = draft.textOrigin;
    let pred = writtenPred;
    let vector = writtenVectors[index];
    const draftUsable = bodyIsUsable(draft.publication?.summary, draft.publication?.key_message);
    const writtenKpi = calculateFitness(writtenPred, predictionResult.metadata, draft.publication);
    const originalKpi = originalPred
      ? calculateFitness(originalPred, originalPrediction.metadata, draft.publication)
      : -1;
    const keepDraft = draftUsable && originalPred && (
      textOrigin === 'template_fallback' ||
      originalKpi > writtenKpi + 0.03
    );
    if (keepDraft) {
      summary = draft.publication.summary;
      keyMessage = draft.publication.key_message;
      cta = draft.publication.cta || '';
      textOrigin = 'draft_kept';
      pred = originalPred;
      vector = originalVectors[index];
    }
    const writtenMap = createFeatureMap(vector);
    const built = buildFinalPublication(
      draft.publication,
      draft.source,
      writtenMap,
      pred[0],
      pred[1],
      pred[2],
      index,
      draft.evolvedTone,
      keyMessage,
      summary,
      cta
    );
    const mediaKind = mediaKindForFormat(draft.publication?.format || draft.source?.format);
    const mediaPrompt = mediaKind
      ? (keepDraft
        ? buildFallbackMediaPrompt(mediaKind, draft.publication?.topic, summary)
        : draft.mediaPrompt || buildFallbackMediaPrompt(mediaKind, draft.publication?.topic, summary))
      : '';
    return {
      ...built,
      writing_brief: draft.brief,
      text_origin: textOrigin,
      media_prompt: mediaPrompt,
      media: null
    };
  });

  const ctaAssignedCount = drafts.filter((draft) => Number(draft.brief?.has_cta) > 0).length;
  return {
    publications: publicationsArray,
    ctaTargetCount: ctaAssignedCount,
    ctaAssignedCount
  };
}