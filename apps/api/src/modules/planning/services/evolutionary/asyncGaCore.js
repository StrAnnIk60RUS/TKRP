import { GA_UTILS } from './gaCore.js';

function normalizeComparator(direction) {
  return direction === 'min'
    ? (left, right) => (left < right ? -1 : left > right ? 1 : 0)
    : (left, right) => (left > right ? -1 : left < right ? 1 : 0);
}

function average(values = []) {
  const numbers = values.map((value) => Number(value)).filter((value) => Number.isFinite(value));
  if (!numbers.length) return 0;
  return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
}

function clampProbability(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(1, numeric));
}

function createDefaultCacheKey(individual) {
  try {
    return JSON.stringify(individual);
  } catch (_error) {
    return null;
  }
}

function tournamentSelect(population, scored, rng, tournamentSize, comparator) {
  const size = Math.min(population.length, GA_UTILS.clampInt(tournamentSize, 2, 64));
  const contenders = [];
  for (let index = 0; index < size; index += 1) {
    const pickIndex = Math.floor(rng() * population.length);
    contenders.push({ individual: population[pickIndex], score: scored[pickIndex] });
  }
  contenders.sort((a, b) => comparator(a.score, b.score));
  return contenders[0]?.individual;
}

function defaultStop(state, config) {
  if (state.generation >= GA_UTILS.clampInt(config.maxGenerations, 1, 100000)) {
    return { stop: true, reason: 'max_generations' };
  }
  if (
    GA_UTILS.clampInt(config.stagnationGenerations, 0, 100000) > 0 &&
    state.stagnation >= GA_UTILS.clampInt(config.stagnationGenerations, 0, 100000)
  ) {
    return { stop: true, reason: 'stagnation' };
  }
  return { stop: false };
}

export async function runAsyncGeneticAlgorithm(options = {}) {
  const {
    seed = null,
    populationSize = 40,
    maxGenerations = 40,
    stagnationGenerations = 12,
    eliteSize = 2,
    tournamentSize = 3,
    crossoverProbability = 0.8,
    mutationProbability = 0.1,
    direction = 'max',
    createIndividual,
    cloneIndividual,
    scorePopulation,
    crossover,
    mutate,
    stopCondition,
    onGeneration,
    cacheKeyForIndividual,
    minImprovementEpsilon = 0,
    minImprovementGenerations = 0,
    mutationProbabilitySchedule
  } = options;

  const rng = GA_UTILS.makeRng(seed);
  const comparator = normalizeComparator(direction);
  const popSize = GA_UTILS.clampInt(populationSize, 2, 2000);
  const elite = GA_UTILS.clampInt(eliteSize, 0, Math.min(popSize, 32));
  let population = Array.from({ length: popSize }, () => createIndividual(rng));
  let best = null;
  let bestScore = direction === 'min' ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
  let bestMeta = null;
  let stagnation = 0;
  let lowDeltaStreak = 0;
  const history = [];
  const evaluationCache = new Map();
  const resolveCacheKey = typeof cacheKeyForIndividual === 'function' ? cacheKeyForIndividual : createDefaultCacheKey;

  for (let generation = 1; generation <= GA_UTILS.clampInt(maxGenerations, 1, 100000); generation += 1) {
    const uniqueMisses = [];
    const uniqueMissesByKey = new Map();
    const scored = new Array(population.length);

    for (let index = 0; index < population.length; index += 1) {
      const individual = population[index];
      const cacheKey = resolveCacheKey(individual, generation);
      if (typeof cacheKey === 'string' && evaluationCache.has(cacheKey)) {
        scored[index] = evaluationCache.get(cacheKey);
        continue;
      }

      if (typeof cacheKey === 'string' && uniqueMissesByKey.has(cacheKey)) {
        uniqueMissesByKey.get(cacheKey).indexes.push(index);
        continue;
      }

      const missEntry = {
        cacheKey: typeof cacheKey === 'string' ? cacheKey : null,
        indexes: [index],
        individual
      };
      uniqueMisses.push(missEntry);
      if (missEntry.cacheKey) {
        uniqueMissesByKey.set(missEntry.cacheKey, missEntry);
      }
    }

    if (uniqueMisses.length > 0) {
      const freshScores = await scorePopulation(
        uniqueMisses.map((entry) => entry.individual),
        generation
      );
      for (let index = 0; index < uniqueMisses.length; index += 1) {
        const entry = uniqueMisses[index];
        const result = freshScores[index];
        entry.indexes.forEach((targetIndex) => {
          scored[targetIndex] = result;
        });
        if (entry.cacheKey) {
          evaluationCache.set(entry.cacheKey, result);
        }
      }
    }

    const scoreValues = scored.map((item) => Number(item?.score));
    const ranked = population
      .map((individual, index) => ({
        individual,
        score: scoreValues[index],
        meta: scored[index]?.meta || null
      }))
      .sort((left, right) => comparator(left.score, right.score));

    const generationBest = ranked[0];
    const previousBestScore = bestScore;
    if (best === null || comparator(generationBest.score, bestScore) < 0) {
      best = cloneIndividual(generationBest.individual);
      bestScore = generationBest.score;
      bestMeta = generationBest.meta;
      stagnation = 0;
    } else {
      stagnation += 1;
    }

    const improvementDelta =
      best === null || !Number.isFinite(previousBestScore)
        ? null
        : Math.abs(Number(bestScore) - Number(previousBestScore));
    const normalizedMinImprovementEpsilon = Math.max(0, Number(minImprovementEpsilon) || 0);
    const normalizedMinImprovementGenerations = GA_UTILS.clampInt(minImprovementGenerations, 0, 100000);

    if (
      normalizedMinImprovementGenerations > 0 &&
      improvementDelta !== null &&
      improvementDelta <= normalizedMinImprovementEpsilon
    ) {
      lowDeltaStreak += 1;
    } else if (normalizedMinImprovementGenerations > 0 && generation > 1) {
      lowDeltaStreak = 0;
    }

    const generationEntry = {
      generation,
      best_score: bestScore,
      generation_best_score: generationBest.score,
      generation_avg_score: average(ranked.map((item) => item.score)),
      stagnation,
      best_meta: generationBest.meta,
      low_delta_streak: lowDeltaStreak,
      improvement_delta: improvementDelta
    };
    history.push(generationEntry);

    if (typeof onGeneration === 'function') {
      onGeneration(generationEntry);
    }

    const stop = (typeof stopCondition === 'function' ? stopCondition : defaultStop)(
      { generation, bestScore, stagnation, history, lowDeltaStreak, improvementDelta },
      { maxGenerations, stagnationGenerations, minImprovementEpsilon, minImprovementGenerations }
    );
    if (
      !stop?.stop &&
      normalizedMinImprovementGenerations > 0 &&
      lowDeltaStreak >= normalizedMinImprovementGenerations
    ) {
      return {
        best,
        best_score: bestScore,
        best_meta: bestMeta,
        generations: generation,
        stop_reason: 'low_improvement',
        history
      };
    }
    if (stop?.stop) {
      return {
        best,
        best_score: bestScore,
        best_meta: bestMeta,
        generations: generation,
        stop_reason: stop.reason || 'stop_condition',
        history
      };
    }

    const nextPopulation = [];
    for (let index = 0; index < elite; index += 1) {
      nextPopulation.push(cloneIndividual(ranked[index].individual));
    }

    while (nextPopulation.length < popSize) {
      const parentA = tournamentSelect(population, scoreValues, rng, tournamentSize, comparator);
      const parentB = tournamentSelect(population, scoreValues, rng, tournamentSize, comparator);
      if (!parentA || !parentB) break;

      let childA = cloneIndividual(parentA);
      let childB = cloneIndividual(parentB);
      const normalizedMutationProbability = clampProbability(mutationProbability, 0);
      const generationMutationProbability = clampProbability(
        typeof mutationProbabilitySchedule === 'function'
          ? mutationProbabilitySchedule(
            {
              generation,
              bestScore,
              stagnation,
              lowDeltaStreak,
              improvementDelta
            },
            { mutationProbability: normalizedMutationProbability, maxGenerations, stagnationGenerations }
          )
          : normalizedMutationProbability,
        normalizedMutationProbability
      );
      if (rng() < Number(crossoverProbability) && parentA !== parentB) {
        const crossed = crossover(parentA, parentB, rng);
        if (Array.isArray(crossed) && crossed.length === 2) {
          childA = crossed[0];
          childB = crossed[1];
        }
      }
      if (rng() < generationMutationProbability) childA = mutate(childA, rng);
      if (rng() < generationMutationProbability) childB = mutate(childB, rng);

      nextPopulation.push(childA);
      if (nextPopulation.length < popSize) nextPopulation.push(childB);
    }

    population = nextPopulation;
  }

  return {
    best,
    best_score: bestScore,
    best_meta: bestMeta,
    generations: GA_UTILS.clampInt(maxGenerations, 1, 100000),
    stop_reason: 'max_generations',
    history
  };
}
