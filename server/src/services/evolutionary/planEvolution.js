import { buildPlanFeatureMap, buildPlanFeatureVector } from '../ml/ontologyFeatureEngineering.js';
import { predictContentPlanLikesByFeatureVectors } from '../relevancePredictionService.js';
import { runAsyncGeneticAlgorithm } from './asyncGaCore.js';
import { cloneJson, onePointCrossoverArrays, randomReplaceMutation } from './operators.js';

function asNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function uniqueDomain(values = []) {
  return Array.from(new Set(values.filter(Boolean).map((value) => String(value)))).slice(0, 80);
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
  return [
    uniqueDomain([...fromPrecedents.map((item) => item.topic), ...fromDraft.map((item) => item.topic)]),
    uniqueDomain([...fromPrecedents.map((item) => item.format), ...fromDraft.map((item) => item.format)]),
    uniqueDomain([...fromPrecedents.map((item) => item.objective), ...fromDraft.map((item) => item.objective)]),
    uniqueDomain([...fromPrecedents.map((item) => item.tone), ...fromDraft.map((item) => item.tone)])
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
    const [topic, format, objective, tone] = Array.isArray(gene) ? gene : [];
    const base = cloneJson(basePublications[index] || {});
    return {
      ...base,
      publication_id: base.publication_id || `evo_publication_${String(index + 1).padStart(3, '0')}`,
      topic: topic ?? base.topic ?? `topic_${index + 1}`,
      format: format ?? base.format ?? 'text',
      objective: objective ?? base.objective ?? 'inform',
      tone: tone ?? base.tone ?? 'expert'
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

export async function optimizeContentPlanEvolution(draftContentPlan, config = {}) {
  const {
    precedentPublications = [],
    constraints = {},
    ga = {}
  } = config;
  const planningHorizon = resolvePlanningHorizon(draftContentPlan, constraints);
  const targetPostCount = resolveTargetPostCount(draftContentPlan, constraints);
  const domains = buildDomains(draftContentPlan, precedentPublications);
  const basePublications = expandBasePublications(draftContentPlan, targetPostCount);
  const postsPerWeekTarget = asNumber(constraints.posts_per_week, 0);
  const postsPerWeekTolerance = asNumber(constraints.posts_per_week_tolerance, 0.35);

  const createPublicationGene = (rng, fallback = {}) => [
    domains[0][Math.floor(rng() * Math.max(1, domains[0].length))] || fallback.topic || 'unspecified',
    domains[1][Math.floor(rng() * Math.max(1, domains[1].length))] || fallback.format || 'text',
    domains[2][Math.floor(rng() * Math.max(1, domains[2].length))] || fallback.objective || 'inform',
    domains[3][Math.floor(rng() * Math.max(1, domains[3].length))] || fallback.tone || 'expert'
  ];

  const createIndividual = (rng) => basePublications.map((publication) => createPublicationGene(rng, publication));
  const cloneIndividual = (individual) => cloneJson(individual);
  const crossover = (left, right, rng) => onePointCrossoverArrays(left, right, rng);
  const mutate = (individual, rng) => {
    if (!Array.isArray(individual) || individual.length === 0) return cloneJson(individual);
    const slotIndex = Math.floor(rng() * individual.length);
    const next = cloneJson(individual);
    next[slotIndex] = randomReplaceMutation(next[slotIndex], domains, rng);
    return next;
  };

  const traces = [];
  const result = await runAsyncGeneticAlgorithm({
    direction: 'max',
    seed: ga.seed ?? null,
    populationSize: ga.populationSize ?? 24,
    maxGenerations: ga.maxGenerations ?? 24,
    stagnationGenerations: ga.stagnationGenerations ?? 8,
    eliteSize: ga.eliteSize ?? 2,
    tournamentSize: ga.tournamentSize ?? 3,
    crossoverProbability: ga.crossoverProbability ?? 0.8,
    mutationProbability: ga.mutationProbability ?? 0.12,
    createIndividual,
    cloneIndividual,
    crossover,
    mutate,
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
        const penalty = weeklyDelta > postsPerWeekTolerance ? weeklyDelta * 250 : weeklyDelta * 60;
        const score = asNumber(predictedLikes, 0) - penalty;
        return {
          score,
          meta: buildPlanSummary(
            candidatePlans[index],
            featureMap,
            asNumber(predictedLikes, 0),
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
