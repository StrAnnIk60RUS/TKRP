import { GA_UTILS } from './gaCore.js';

function stripGaMeta(individual) {
  if (!individual || typeof individual !== 'object') return individual;
  if (!Object.prototype.hasOwnProperty.call(individual, '__ga_score')) return individual;
  if (Array.isArray(individual)) {
    const next = individual.slice();
    // eslint-disable-next-line no-underscore-dangle
    delete next.__ga_score;
    return next;
  }
  const { __ga_score, ...rest } = individual;
  return rest;
}

export function cloneJson(obj) {
  return stripGaMeta(JSON.parse(JSON.stringify(obj)));
}

export function onePointCrossoverArrays(parentA = [], parentB = [], rng) {
  if (!Array.isArray(parentA) || !Array.isArray(parentB) || parentA.length !== parentB.length) {
    return [cloneJson(parentA), cloneJson(parentB)];
  }
  if (parentA.length < 2) return [cloneJson(parentA), cloneJson(parentB)];
  const cut = 1 + Math.floor(rng() * (parentA.length - 1));
  const childA = parentA.slice(0, cut).concat(parentB.slice(cut));
  const childB = parentB.slice(0, cut).concat(parentA.slice(cut));
  return [childA, childB];
}

// OX (order crossover) for permutations without duplicates.
export function orderCrossover(parentA = [], parentB = [], rng) {
  if (!Array.isArray(parentA) || !Array.isArray(parentB) || parentA.length !== parentB.length) {
    return [cloneJson(parentA), cloneJson(parentB)];
  }
  const n = parentA.length;
  if (n < 2) return [cloneJson(parentA), cloneJson(parentB)];

  const i = Math.floor(rng() * n);
  const j = Math.floor(rng() * n);
  const start = Math.min(i, j);
  const end = Math.max(i, j);

  const sliceA = parentA.slice(start, end + 1);
  const sliceB = parentB.slice(start, end + 1);

  const fillChild = (slice, otherParent) => {
    const child = new Array(n).fill(null);
    for (let k = start; k <= end; k += 1) child[k] = slice[k - start];
    const used = new Set(slice);
    let writeIdx = (end + 1) % n;
    for (let p = 0; p < n; p += 1) {
      const gene = otherParent[(end + 1 + p) % n];
      if (used.has(gene)) continue;
      while (child[writeIdx] !== null) writeIdx = (writeIdx + 1) % n;
      child[writeIdx] = gene;
      used.add(gene);
    }
    return child;
  };

  return [fillChild(sliceA, parentB), fillChild(sliceB, parentA)];
}

export function swapMutationPermutation(individual = [], rng) {
  if (!Array.isArray(individual) || individual.length < 2) return cloneJson(individual);
  const next = individual.slice();
  const i = Math.floor(rng() * next.length);
  let j = Math.floor(rng() * next.length);
  if (j === i) j = (j + 1) % next.length;
  const tmp = next[i];
  next[i] = next[j];
  next[j] = tmp;
  return next;
}

export function randomReplaceMutation(individual = [], domainByIndex = [], rng) {
  if (!Array.isArray(individual) || individual.length === 0) return cloneJson(individual);
  const idx = Math.floor(rng() * individual.length);
  const domain = Array.isArray(domainByIndex[idx]) ? domainByIndex[idx] : [];
  if (domain.length < 2) return cloneJson(individual);
  const next = individual.slice();
  const current = next[idx];
  let candidate = GA_UTILS.pickOne(domain, rng);
  let guard = 0;
  while (candidate === current && guard < 8) {
    candidate = GA_UTILS.pickOne(domain, rng);
    guard += 1;
  }
  next[idx] = candidate;
  return next;
}

// ========== НОВЫЕ МЕТОДЫ КРОССОВЕРА ==========

/**
 * Двухточечный кроссовер для массивов
 */
export function twoPointCrossoverArrays(parentA = [], parentB = [], rng) {
  if (!Array.isArray(parentA) || !Array.isArray(parentB) || parentA.length !== parentB.length) {
    return [cloneJson(parentA), cloneJson(parentB)];
  }
  const len = parentA.length;
  if (len < 2) return [cloneJson(parentA), cloneJson(parentB)];
  
  const point1 = Math.floor(rng() * len);
  let point2 = Math.floor(rng() * len);
  if (point1 === point2) point2 = (point2 + 1) % len;
  const start = Math.min(point1, point2);
  const end = Math.max(point1, point2);
  
  const childA = [
    ...parentA.slice(0, start),
    ...parentB.slice(start, end),
    ...parentA.slice(end)
  ];
  const childB = [
    ...parentB.slice(0, start),
    ...parentA.slice(start, end),
    ...parentB.slice(end)
  ];
  return [childA, childB];
}

/**
 * Равномерный кроссовер для массивов (каждый ген с вероятностью 0.5 от родителя)
 */
export function uniformCrossoverArrays(parentA = [], parentB = [], rng) {
  if (!Array.isArray(parentA) || !Array.isArray(parentB) || parentA.length !== parentB.length) {
    return [cloneJson(parentA), cloneJson(parentB)];
  }
  const childA = [];
  const childB = [];
  for (let i = 0; i < parentA.length; i++) {
    if (rng() < 0.5) {
      childA[i] = cloneJson(parentA[i]);
      childB[i] = cloneJson(parentB[i]);
    } else {
      childA[i] = cloneJson(parentB[i]);
      childB[i] = cloneJson(parentA[i]);
    }
  }
  return [childA, childB];
}

// ========== НОВЫЕ МЕТОДЫ МУТАЦИИ ==========

/**
 * Инверсия (разворот случайного участка) — для генома плана (массив слотов)
 */
export function inversionMutation(individual = [], rng) {
  if (!Array.isArray(individual) || individual.length < 2) return cloneJson(individual);
  const len = individual.length;
  const start = Math.floor(rng() * len);
  let end = Math.floor(rng() * len);
  if (start === end) end = (end + 1) % len;
  const s = Math.min(start, end);
  const e = Math.max(start, end);
  const next = cloneJson(individual);
  const reversed = next.slice(s, e + 1).reverse();
  for (let i = s; i <= e; i++) {
    next[i] = reversed[i - s];
  }
  return next;
}