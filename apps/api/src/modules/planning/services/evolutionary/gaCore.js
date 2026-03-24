function mulberry32(seed) {
  let t = seed >>> 0;
  return function next() {
    t += 0x6d2b79f5;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function makeRng(seed) {
  if (seed === null || seed === undefined || seed === '') {
    return Math.random;
  }
  const numeric = Number(seed);
  if (Number.isFinite(numeric)) {
    return mulberry32(Math.floor(numeric));
  }
  let h = 2166136261;
  const str = String(seed);
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return mulberry32(h >>> 0);
}

function clampInt(value, min, max) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function pickOne(arr, rng) {
  if (!Array.isArray(arr) || arr.length === 0) return undefined;
  const idx = Math.floor(rng() * arr.length);
  return arr[Math.min(arr.length - 1, Math.max(0, idx))];
}

function tournamentSelect(population = [], scored = [], rng, tournamentSize, comparator) {
  const size = Math.min(population.length, clampInt(tournamentSize, 2, 64));
  const contenders = [];
  for (let i = 0; i < size; i += 1) {
    const idx = Math.floor(rng() * population.length);
    contenders.push({ individual: population[idx], score: scored[idx] });
  }
  contenders.sort((a, b) => comparator(a.score, b.score));
  return contenders[0]?.individual;
}

function twoRoundTournament(population, scores, rng, tournamentSize, comparator) {
  const winnerA = tournamentSelect(population, scores, rng, tournamentSize, comparator);
  const winnerB = tournamentSelect(population, scores, rng, tournamentSize, comparator);
  if (!winnerA) return winnerB;
  if (!winnerB) return winnerA;
  const scoreA = winnerA.__ga_score;
  const scoreB = winnerB.__ga_score;
  return comparator(scoreA, scoreB) <= 0 ? winnerA : winnerB;
}

function scorePopulation(population, fitnessFn) {
  const scores = new Array(population.length);
  for (let i = 0; i < population.length; i += 1) {
    const score = fitnessFn(population[i]);
    scores[i] = score;
    // memoize for tournament comparison between already-scored winners
    population[i].__ga_score = score;
  }
  return scores;
}

function defaultStopFn(state, config) {
  const maxGenerations = clampInt(config.maxGenerations, 1, 100000);
  if (state.generation >= maxGenerations) return { stop: true, reason: 'max_generations' };
  const stagnation = clampInt(config.stagnationGenerations, 0, 100000);
  if (stagnation > 0 && state.stagnation >= stagnation) {
    return { stop: true, reason: 'stagnation' };
  }
  return { stop: false };
}

function normalizeComparator(direction) {
  const dir = direction === 'min' ? 'min' : 'max';
  if (dir === 'min') {
    return (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  }
  return (a, b) => (a > b ? -1 : a < b ? 1 : 0);
}

export function runGeneticAlgorithm(options = {}) {
  const {
    seed = null,
    populationSize = 50,
    maxGenerations = 100,
    stagnationGenerations = 20,
    eliteSize = 2,
    tournamentSize = 3,
    crossoverProbability = 0.8,
    mutationProbability = 0.05,
    direction = 'max',
    createIndividual,
    cloneIndividual,
    fitness,
    crossover,
    mutate,
    stopCondition
  } = options;

  if (typeof createIndividual !== 'function') {
    throw new Error('GA: createIndividual must be a function');
  }
  if (typeof fitness !== 'function') {
    throw new Error('GA: fitness must be a function');
  }
  if (typeof cloneIndividual !== 'function') {
    throw new Error('GA: cloneIndividual must be a function');
  }
  if (typeof crossover !== 'function') {
    throw new Error('GA: crossover must be a function');
  }
  if (typeof mutate !== 'function') {
    throw new Error('GA: mutate must be a function');
  }

  const rng = makeRng(seed);
  const comparator = normalizeComparator(direction);
  const popSize = clampInt(populationSize, 2, 20000);
  const elite = clampInt(eliteSize, 0, Math.min(2000, popSize));

  let population = Array.from({ length: popSize }, () => createIndividual(rng));
  let best = null;
  let bestScore = direction === 'min' ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
  let stagnation = 0;

  const history = [];

  for (let generation = 1; generation <= clampInt(maxGenerations, 1, 100000); generation += 1) {
    const scores = scorePopulation(population, fitness);
    const ranked = population
      .map((individual, idx) => ({ individual, score: scores[idx] }))
      .sort((a, b) => comparator(a.score, b.score));

    const genBest = ranked[0];
    const improved = comparator(genBest.score, bestScore) < 0;
    if (improved || best === null) {
      best = cloneIndividual(genBest.individual);
      bestScore = genBest.score;
      stagnation = 0;
    } else {
      stagnation += 1;
    }

    history.push({
      generation,
      best_score: bestScore,
      generation_best_score: genBest.score,
      stagnation
    });

    const stopFn = typeof stopCondition === 'function' ? stopCondition : defaultStopFn;
    const stop = stopFn(
      { generation, bestScore, stagnation, history },
      { maxGenerations, stagnationGenerations }
    );
    if (stop?.stop) {
      return {
        best,
        best_score: bestScore,
        generations: generation,
        stop_reason: stop.reason || 'stop_condition',
        history
      };
    }

    const next = [];

    for (let i = 0; i < elite; i += 1) {
      next.push(cloneIndividual(ranked[i].individual));
    }

    while (next.length < popSize) {
      const parentA = twoRoundTournament(population, scores, rng, tournamentSize, comparator);
      const parentB = twoRoundTournament(population, scores, rng, tournamentSize, comparator);
      if (!parentA || !parentB) break;

      let [childA, childB] = [cloneIndividual(parentA), cloneIndividual(parentB)];

      if (rng() < Number(crossoverProbability) && parentA !== parentB) {
        const crossed = crossover(parentA, parentB, rng);
        if (Array.isArray(crossed) && crossed.length === 2) {
          childA = crossed[0];
          childB = crossed[1];
        }
      }

      if (rng() < Number(mutationProbability)) {
        childA = mutate(childA, rng);
      }
      if (rng() < Number(mutationProbability)) {
        childB = mutate(childB, rng);
      }

      next.push(childA);
      if (next.length < popSize) next.push(childB);
    }

    population = next;
  }

  return {
    best,
    best_score: bestScore,
    generations: clampInt(maxGenerations, 1, 100000),
    stop_reason: 'max_generations',
    history
  };
}

export const GA_UTILS = {
  makeRng,
  pickOne,
  clampInt
};

