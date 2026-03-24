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
    onGeneration
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
  const history = [];

  for (let generation = 1; generation <= GA_UTILS.clampInt(maxGenerations, 1, 100000); generation += 1) {
    const scored = await scorePopulation(population, generation);
    const scoreValues = scored.map((item) => Number(item?.score));
    const ranked = population
      .map((individual, index) => ({
        individual,
        score: scoreValues[index],
        meta: scored[index]?.meta || null
      }))
      .sort((left, right) => comparator(left.score, right.score));

    const generationBest = ranked[0];
    if (best === null || comparator(generationBest.score, bestScore) < 0) {
      best = cloneIndividual(generationBest.individual);
      bestScore = generationBest.score;
      bestMeta = generationBest.meta;
      stagnation = 0;
    } else {
      stagnation += 1;
    }

    const generationEntry = {
      generation,
      best_score: bestScore,
      generation_best_score: generationBest.score,
      generation_avg_score: average(ranked.map((item) => item.score)),
      stagnation,
      best_meta: generationBest.meta
    };
    history.push(generationEntry);

    if (typeof onGeneration === 'function') {
      onGeneration(generationEntry);
    }

    const stop = (typeof stopCondition === 'function' ? stopCondition : defaultStop)(
      { generation, bestScore, stagnation, history },
      { maxGenerations, stagnationGenerations }
    );
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
      if (rng() < Number(crossoverProbability) && parentA !== parentB) {
        const crossed = crossover(parentA, parentB, rng);
        if (Array.isArray(crossed) && crossed.length === 2) {
          childA = crossed[0];
          childB = crossed[1];
        }
      }
      if (rng() < Number(mutationProbability)) childA = mutate(childA, rng);
      if (rng() < Number(mutationProbability)) childB = mutate(childB, rng);

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
