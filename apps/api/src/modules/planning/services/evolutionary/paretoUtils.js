/**
 * Утилиты многокритериальной оптимизации (NSGA-II / Pareto-фронт)
 * для эволюционного поиска контент-планов.
 */

function asNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

/**
 * Проверка доминирования: p доминирует q (p dominates q), если по всем
 * целям p >= q и хотя бы по одной p > q (для задачи максимизации).
 */
export function dominates(objectivesA, objectivesB) {
  if (!Array.isArray(objectivesA) || !Array.isArray(objectivesB)) return false;
  let strictlyBetter = false;
  const len = Math.min(objectivesA.length, objectivesB.length);
  for (let i = 0; i < len; i += 1) {
    const valA = asNumber(objectivesA[i]);
    const valB = asNumber(objectivesB[i]);
    if (valA < valB) return false;
    if (valA > valB) strictlyBetter = true;
  }
  return strictlyBetter;
}

/**
 * Быстрая недоминируемая сортировка (Fast Non-Dominated Sorting по Дебу / NSGA-II).
 * Разбивает популяцию на фронты Парето: F[0] (ранг 1, не доминируется никем), F[1]...
 *
 * @param {Array} items - Элементы популяции
 * @param {Function} getObjectives - Функция (item) => [f1, f2, ...] (максимизация)
 * @returns {Array<Array>} Массив фронтов Парето
 */
export function fastNonDominatedSort(items = [], getObjectives = (item) => item?.objectives || []) {
  if (!Array.isArray(items) || items.length === 0) return [];

  const n = items.length;
  const dominationCounts = new Array(n).fill(0); // сколько решений доминируют над i
  const dominatedSets = Array.from({ length: n }, () => []); // решения, над которыми доминирует i
  const fronts = [[]];

  const objVectors = items.map((item) => getObjectives(item));

  for (let p = 0; p < n; p += 1) {
    for (let q = p + 1; q < n; q += 1) {
      if (dominates(objVectors[p], objVectors[q])) {
        dominatedSets[p].push(q);
        dominationCounts[q] += 1;
      } else if (dominates(objVectors[q], objVectors[p])) {
        dominatedSets[q].push(p);
        dominationCounts[p] += 1;
      }
    }

    if (dominationCounts[p] === 0) {
      fronts[0].push({ index: p, item: items[p], rank: 0 });
    }
  }

  let currentFront = 0;
  while (fronts[currentFront] && fronts[currentFront].length > 0) {
    const nextFront = [];
    for (const { index: p } of fronts[currentFront]) {
      for (const q of dominatedSets[p]) {
        dominationCounts[q] -= 1;
        if (dominationCounts[q] === 0) {
          nextFront.push({ index: q, item: items[q], rank: currentFront + 1 });
        }
      }
    }
    currentFront += 1;
    if (nextFront.length > 0) {
      fronts.push(nextFront);
    }
  }

  return fronts.map((front) => front.map((entry) => entry.item));
}

/**
 * Расчёт скученности (Crowding Distance) для сохранения разнообразия на фронте Парето.
 */
export function calculateCrowdingDistances(front = [], getObjectives = (item) => item?.objectives || []) {
  if (!Array.isArray(front) || front.length === 0) return [];
  const count = front.length;
  if (count <= 2) {
    return front.map((item) => ({ item, distance: Infinity }));
  }

  const entries = front.map((item, originalIndex) => ({
    item,
    originalIndex,
    objectives: getObjectives(item),
    distance: 0
  }));

  const m = entries[0].objectives.length;

  for (let objIdx = 0; objIdx < m; objIdx += 1) {
    entries.sort((a, b) => asNumber(a.objectives[objIdx]) - asNumber(b.objectives[objIdx]));
    entries[0].distance = Infinity;
    entries[count - 1].distance = Infinity;

    const minVal = asNumber(entries[0].objectives[objIdx]);
    const maxVal = asNumber(entries[count - 1].objectives[objIdx]);
    const range = maxVal - minVal;

    if (range > 0) {
      for (let i = 1; i < count - 1; i += 1) {
        if (Number.isFinite(entries[i].distance)) {
          entries[i].distance +=
            (asNumber(entries[i + 1].objectives[objIdx]) - asNumber(entries[i - 1].objectives[objIdx])) / range;
        }
      }
    }
  }

  return entries
    .sort((a, b) => a.originalIndex - b.originalIndex)
    .map((e) => ({ item: e.item, distance: e.distance }));
}

/**
 * Извлечение трёх опорных решений с Парето-фронта:
 * 1. viral_reach — фокус на виральном охвате и реакциях
 * 2. conversion — фокус на CTA и коммерческой конверсии
 * 3. balanced — сбалансированный брендовый план с максимальным разнообразием
 *
 * @param {Array} paretoFront1 - Первый Парето-фронт (недоминируемые решения)
 * @param {Function} getObjectives - Функция извлечения [f_viral, f_conversion, f_diversity]
 * @returns {Object} { viral_reach, conversion, balanced }
 */
export function extractParetoArchetypes(paretoFront1 = [], getObjectives = (item) => item?.objectives || []) {
  if (!Array.isArray(paretoFront1) || paretoFront1.length === 0) {
    return null;
  }

  const items = paretoFront1.map((item) => {
    const rawObjs = getObjectives(item) || [];
    const viral = asNumber(rawObjs[0], 0);
    const conversion = asNumber(rawObjs[1], 0);
    const diversity = asNumber(rawObjs[2], 0);
    return {
      item,
      viral,
      conversion,
      diversity,
      viralScore: viral * 0.75 + conversion * 0.15 + diversity * 0.10,
      conversionScore: conversion * 0.70 + viral * 0.15 + diversity * 0.15,
      balancedScore: diversity * 0.35 + viral * 0.35 + conversion * 0.30
    };
  });

  const bestViral = [...items].sort((a, b) => b.viralScore - a.viralScore)[0]?.item || items[0].item;
  const bestConversion = [...items].sort((a, b) => b.conversionScore - a.conversionScore)[0]?.item || items[0].item;
  const bestBalanced = [...items].sort((a, b) => b.balancedScore - a.balancedScore)[0]?.item || items[0].item;

  return {
    viral_reach: bestViral,
    conversion: bestConversion,
    balanced: bestBalanced
  };
}
