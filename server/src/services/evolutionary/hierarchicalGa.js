import { runGeneticAlgorithm, GA_UTILS } from './gaCore.js';
import {
  cloneJson,
  onePointCrossoverArrays,
  orderCrossover,
  randomReplaceMutation,
  swapMutationPermutation
} from './operators.js';

function asNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function parseDateOnly(value) {
  if (!value || typeof value !== 'string') return null;
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d : null;
}

function isDateInRange(date, minDate, maxDate) {
  if (!date || !minDate || !maxDate) return true;
  const t = date.getTime();
  return t >= minDate.getTime() && t <= maxDate.getTime();
}

function sum(arr) {
  return arr.reduce((acc, v) => acc + (Number(v) || 0), 0);
}

function repairPermutation(indices, n) {
  const result = Array.isArray(indices) ? indices.slice(0, n) : [];
  const used = new Set();
  const missing = [];
  for (let i = 0; i < n; i += 1) missing.push(i);

  // Keep first occurrence of each valid index; mark invalid/duplicates as null placeholders
  for (let i = 0; i < result.length; i += 1) {
    const value = result[i];
    const isValid = Number.isInteger(value) && value >= 0 && value < n;
    if (!isValid || used.has(value)) {
      result[i] = null;
    } else {
      used.add(value);
    }
  }

  // Remove used values from missing list
  const missingFiltered = missing.filter((v) => !used.has(v));
  let cursor = 0;
  for (let i = 0; i < result.length; i += 1) {
    if (result[i] !== null) continue;
    result[i] = missingFiltered[cursor] ?? 0;
    cursor += 1;
  }

  // If crossover returned shorter genome, append remaining missing values
  while (result.length < n) {
    result.push(missingFiltered[cursor] ?? result.length);
    cursor += 1;
  }

  return result;
}

function buildAlphaVector(alphaByDimension = {}, dimensionKeys = []) {
  if (!dimensionKeys.length) return [];
  const raw = dimensionKeys.map((key) => asNumber(alphaByDimension?.[key], 0));
  const total = sum(raw);
  if (total <= 0) {
    return dimensionKeys.map(() => 1 / dimensionKeys.length);
  }
  return raw.map((v) => v / total);
}

function averageSpcjDimensions(precedentPublications = []) {
  const dims = {};
  let count = 0;
  precedentPublications.forEach((p) => {
    const d = p?.publication_model?.spcj?.dimensions || p?.spcj?.dimensions || null;
    if (!d || typeof d !== 'object') return;
    Object.entries(d).forEach(([k, v]) => {
      dims[k] = (dims[k] || 0) + clamp01(v);
    });
    count += 1;
  });
  if (count === 0) return { dimensions: {}, keys: [] };
  const keys = Object.keys(dims).sort();
  keys.forEach((k) => {
    dims[k] = dims[k] / count;
  });
  return { dimensions: dims, keys };
}

function estimatePublicationQuality(publication, fallback = 0) {
  const kpi = publication?.expected_kpi || {};
  if (Number.isFinite(Number(kpi.engagement_rate))) return clamp01(kpi.engagement_rate);
  if (Number.isFinite(Number(publication?.quality_score))) return clamp01(publication.quality_score);
  return clamp01(fallback);
}

function penalize(value, penalty) {
  return value - penalty;
}

function buildPublicationGenomeDomains(context) {
  const { precedentPublications = [], draftPublication = {} } = context;
  const topics = new Set();
  const formats = new Set();
  const objectives = new Set();
  const tones = new Set();

  precedentPublications.forEach((p) => {
    const m = p?.publication_model || p || {};
    if (m.topic) topics.add(String(m.topic));
    if (m.format) formats.add(String(m.format));
    if (m.objective) objectives.add(String(m.objective));
    if (m.tone) tones.add(String(m.tone));
  });

  if (draftPublication.topic) topics.add(String(draftPublication.topic));
  if (draftPublication.format) formats.add(String(draftPublication.format));
  if (draftPublication.objective) objectives.add(String(draftPublication.objective));
  if (draftPublication.tone) tones.add(String(draftPublication.tone));

  const topicDomain = Array.from(topics).filter(Boolean).slice(0, 60);
  const formatDomain = Array.from(formats).filter(Boolean).slice(0, 30);
  const objectiveDomain = Array.from(objectives).filter(Boolean).slice(0, 30);
  const toneDomain = Array.from(tones).filter(Boolean).slice(0, 30);

  return [topicDomain, formatDomain, objectiveDomain, toneDomain];
}

function applyGenomeToPublication(basePublication, genome) {
  const [topic, format, objective, tone] = Array.isArray(genome) ? genome : [];
  return {
    ...basePublication,
    topic: topic ?? basePublication.topic,
    format: format ?? basePublication.format,
    objective: objective ?? basePublication.objective,
    tone: tone ?? basePublication.tone
  };
}

function scoreFpublFromSpcj(dimensions, alphaVector, keys) {
  if (!keys.length) return 0;
  const vector = keys.map((k) => clamp01(dimensions?.[k]));
  const weights = alphaVector.length === keys.length ? alphaVector : keys.map(() => 1 / keys.length);
  let score = 0;
  for (let i = 0; i < keys.length; i += 1) score += weights[i] * vector[i];
  return score;
}

function filterPrecedentsByGenome(precedents = [], genome = []) {
  const [topic, format, objective, tone] = genome;
  return precedents.filter((p) => {
    const m = p?.publication_model || p || {};
    if (topic && m.topic && String(m.topic) !== String(topic)) return false;
    if (format && m.format && String(m.format) !== String(format)) return false;
    if (objective && m.objective && String(m.objective) !== String(objective)) return false;
    if (tone && m.tone && String(m.tone) !== String(tone)) return false;
    return true;
  });
}

function averageSpcjFromGenome(precedents = [], genome = []) {
  const filtered = filterPrecedentsByGenome(precedents, genome);
  const primary = averageSpcjDimensions(filtered);
  if (primary.keys.length) return primary;
  return averageSpcjDimensions(precedents);
}

export function optimizePublicationStage1(draftPublication, stage1Config = {}) {
  const {
    precedentPublications = [],
    alphaByDimension = {},
    constraints = {},
    ga = {}
  } = stage1Config;

  const domainByIndex = buildPublicationGenomeDomains({
    precedentPublications,
    draftPublication
  });

  const createIndividual = (rng) => [
    GA_UTILS.pickOne(domainByIndex[0], rng),
    GA_UTILS.pickOne(domainByIndex[1], rng),
    GA_UTILS.pickOne(domainByIndex[2], rng),
    GA_UTILS.pickOne(domainByIndex[3], rng)
  ];

  const cloneIndividual = (ind) => cloneJson(ind);
  const crossover = (a, b, rng) => onePointCrossoverArrays(a, b, rng);
  const mutate = (ind, rng) => randomReplaceMutation(ind, domainByIndex, rng);

  const minQuality = constraints?.quality_min ?? null;
  const maxQuality = constraints?.quality_max ?? null;
  const minDate = parseDateOnly(constraints?.date_min ?? null);
  const maxDate = parseDateOnly(constraints?.date_max ?? null);

  const baseDate = parseDateOnly(draftPublication?.planned_date || draftPublication?.planned_at || null);

  const fitness = (genome) => {
    const { dimensions: avgDims, keys } = averageSpcjFromGenome(precedentPublications, genome);
    const alphaVector = buildAlphaVector(alphaByDimension, keys);
    const fpubl = scoreFpublFromSpcj(avgDims, alphaVector, keys);
    let score = fpubl;

    const ql = estimatePublicationQuality(draftPublication, fpubl);
    let penalty = 0;
    if (minQuality !== null && ql < Number(minQuality)) penalty += (Number(minQuality) - ql) * 5;
    if (maxQuality !== null && ql > Number(maxQuality)) penalty += (ql - Number(maxQuality)) * 5;
    if (!isDateInRange(baseDate, minDate, maxDate)) penalty += 2;

    // soft preference for staying close to original draft (stability)
    const applied = applyGenomeToPublication(draftPublication, genome);
    if (draftPublication.topic && applied.topic !== draftPublication.topic) penalty += 0.05;
    if (draftPublication.format && applied.format !== draftPublication.format) penalty += 0.03;
    if (draftPublication.objective && applied.objective !== draftPublication.objective) penalty += 0.03;
    if (draftPublication.tone && applied.tone !== draftPublication.tone) penalty += 0.02;

    return penalize(score, penalty);
  };

  const result = runGeneticAlgorithm({
    direction: 'max',
    seed: ga.seed ?? null,
    populationSize: ga.populationSize ?? 40,
    maxGenerations: ga.maxGenerations ?? 60,
    stagnationGenerations: ga.stagnationGenerations ?? 15,
    eliteSize: ga.eliteSize ?? 2,
    tournamentSize: ga.tournamentSize ?? 3,
    crossoverProbability: ga.crossoverProbability ?? 0.8,
    mutationProbability: ga.mutationProbability ?? 0.05,
    createIndividual,
    cloneIndividual,
    fitness,
    crossover,
    mutate
  });

  const optimized = applyGenomeToPublication(draftPublication, result.best);
  return {
    optimized_publication: optimized,
    f_publ: result.best_score,
    ga: result
  };
}

function validatePlanConstraints(plan, constraints = {}) {
  const errors = [];
  const pubs = Array.isArray(plan?.publications) ? plan.publications : [];

  const minPubs = constraints?.min_publications ?? null;
  const totalBudget = constraints?.total_budget ?? null;
  const maxCostPerPub = constraints?.max_cost_per_publication ?? null;
  const minQuality = constraints?.quality_min ?? null;

  if (minPubs !== null && pubs.length < Number(minPubs)) {
    errors.push(`min_publications violated: have=${pubs.length}, need>=${minPubs}`);
  }

  const costs = pubs.map((p) => asNumber(p?.estimated_cost, 0));
  const totalCost = sum(costs);
  if (totalBudget !== null && totalCost > Number(totalBudget)) {
    errors.push(`total_budget violated: cost=${totalCost}, limit=${totalBudget}`);
  }
  if (maxCostPerPub !== null) {
    const over = pubs.filter((p) => asNumber(p?.estimated_cost, 0) > Number(maxCostPerPub));
    if (over.length) errors.push(`max_cost_per_publication violated: count=${over.length}`);
  }

  if (minQuality !== null) {
    const qls = pubs.map((p) => estimatePublicationQuality(p, 0));
    const avgQl = qls.length ? sum(qls) / qls.length : 0;
    if (avgQl < Number(minQuality)) {
      errors.push(`quality_min violated: avg=${avgQl.toFixed(3)}, min=${Number(minQuality).toFixed(3)}`);
    }
  }

  const start = parseDateOnly(plan?.planning_horizon?.start_date ?? null);
  const end = parseDateOnly(plan?.planning_horizon?.end_date ?? null);
  if (start && end) {
    const outside = pubs.filter((p) => !isDateInRange(parseDateOnly(p?.planned_date ?? null), start, end));
    if (outside.length) errors.push(`planning_horizon violated: outside_count=${outside.length}`);
  }

  // Unique publication_id is required for consistent downstream processing/UI.
  const ids = pubs.map((p) => (typeof p?.publication_id === 'string' ? p.publication_id : null)).filter(Boolean);
  const uniqueIds = new Set(ids);
  if (ids.length !== uniqueIds.size) {
    errors.push(`publication_id violated: duplicates=${ids.length - uniqueIds.size}`);
  }

  return {
    valid: errors.length === 0,
    errors,
    total_cost: totalCost
  };
}

function computeFkpTotalCost(plan) {
  const pubs = Array.isArray(plan?.publications) ? plan.publications : [];
  return sum(pubs.map((p) => asNumber(p?.estimated_cost, 0)));
}

function toIsoDateOnly(date) {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function daysBetweenInclusiveDates(start, end) {
  if (!(start instanceof Date) || !(end instanceof Date)) return 0;
  const diff = Math.floor((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
  return diff >= 0 ? diff + 1 : 0;
}

function addDays(date, daysToAdd) {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) return null;
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + daysToAdd);
  return next;
}

function buildExpandedPublicationSet(plan, minPublications) {
  const pubs = Array.isArray(plan?.publications) ? plan.publications : [];
  const targetCount = Number(minPublications) || pubs.length;
  if (!pubs.length || pubs.length >= targetCount) return pubs;

  const horizonStart = parseDateOnly(plan?.planning_horizon?.start_date ?? null);
  const horizonEnd = parseDateOnly(plan?.planning_horizon?.end_date ?? null);
  const spanDays = daysBetweenInclusiveDates(horizonStart, horizonEnd);
  const canSpreadAcrossHorizon = spanDays > 0;

  const expanded = Array.from({ length: targetCount }, (_, idx) => {
    const base = cloneJson(pubs[idx % pubs.length]);
    const baseId = typeof base?.publication_id === 'string' && base.publication_id.trim()
      ? base.publication_id.trim()
      : `pub_${idx + 1}`;

    let plannedDate = base?.planned_date ?? null;
    if (canSpreadAcrossHorizon) {
      const offset = targetCount === 1
        ? 0
        : Math.round((idx * (spanDays - 1)) / Math.max(1, targetCount - 1));
      plannedDate = toIsoDateOnly(addDays(horizonStart, offset)) ?? plannedDate;
    }

    return {
      ...base,
      publication_id: `${baseId}_slot_${String(idx + 1).padStart(3, '0')}`,
      planned_date: plannedDate
    };
  });

  return expanded;
}

export function optimizeContentPlanStage2(draftContentPlan, stage2Config = {}) {
  const {
    constraints = {},
    ga = {}
  } = stage2Config;

  const basePubs = Array.isArray(draftContentPlan?.publications) ? draftContentPlan.publications : [];
  const minRequired = Number(constraints?.min_publications ?? basePubs.length ?? 1) || 1;
  const requiresExpansion = minRequired > basePubs.length;
  const desiredCount = requiresExpansion
    ? (basePubs.length || 1)
    : Math.max(1, Math.min(basePubs.length || 1, minRequired));

  // Genome is a permutation of indices. The phenotype is first desiredCount items.
  const n = basePubs.length;
  const baseIndices = Array.from({ length: n }, (_, i) => i);

  const createIndividual = (rng) => {
    const arr = baseIndices.slice();
    for (let i = arr.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  };
  const cloneIndividual = (ind) => cloneJson(ind);

  // IMPORTANT: this is a permutation GA. One-point crossover breaks permutation validity and causes duplicates.
  const crossover = (a, b, rng) => repairPermutation(orderCrossover(a, b, rng), n);

  const mutate = (ind, rng) => repairPermutation(swapMutationPermutation(ind, rng), n);

  const fitness = (genome) => {
    const indices = repairPermutation(genome, n);
    const selected = indices.slice(0, desiredCount).map((idx) => basePubs[idx]).filter(Boolean);

    const candidate = {
      ...draftContentPlan,
      publications: selected
    };

    const fkp = computeFkpTotalCost(candidate); // minimize
    const validation = validatePlanConstraints(candidate, constraints);
    let penalty = 0;
    if (!validation.valid) {
      // strong penalty for infeasible solutions
      penalty = validation.errors.length * 1e6;
    }
    // soft penalty for budget usage (prefer cheaper even if within budget)
    const budgetLimit = constraints?.total_budget ?? null;
    if (budgetLimit !== null && fkp <= Number(budgetLimit)) {
      penalty += (fkp / Math.max(1, Number(budgetLimit))) * 10;
    }

    return fkp + penalty;
  };

  const result = runGeneticAlgorithm({
    direction: 'min',
    seed: ga.seed ?? null,
    populationSize: ga.populationSize ?? 60,
    maxGenerations: ga.maxGenerations ?? 80,
    stagnationGenerations: ga.stagnationGenerations ?? 20,
    eliteSize: ga.eliteSize ?? 2,
    tournamentSize: ga.tournamentSize ?? 3,
    crossoverProbability: ga.crossoverProbability ?? 0.8,
    mutationProbability: ga.mutationProbability ?? 0.05,
    createIndividual,
    cloneIndividual,
    fitness,
    crossover,
    mutate
  });

  const bestIndices = repairPermutation(Array.isArray(result.best) ? result.best : baseIndices, n);
  const bestSelected = bestIndices.slice(0, desiredCount).map((idx) => basePubs[idx]).filter(Boolean);
  const selectedPlan = {
    ...draftContentPlan,
    publications: bestSelected
  };
  const optimizedPlan = {
    ...selectedPlan,
    publications: buildExpandedPublicationSet(selectedPlan, minRequired)
  };
  const validation = validatePlanConstraints(optimizedPlan, constraints);

  return {
    optimized_plan: optimizedPlan,
    f_kp: computeFkpTotalCost(optimizedPlan),
    constraints_check: validation,
    ga: result
  };
}

export function runHierarchicalOptimization(payload = {}) {
  const draft = payload?.draft_content_plan || payload?.draftContentPlan || null;
  if (!draft || typeof draft !== 'object') {
    throw new Error('Отсутствует draft_content_plan');
  }

  const stage1 = payload?.stage1 || {};
  const stage2 = payload?.stage2 || {};

  const pubs = Array.isArray(draft.publications) ? draft.publications : [];
  const stage1Results = pubs.map((pub) =>
    optimizePublicationStage1(pub, stage1)
  );
  const optimizedDraft = {
    ...draft,
    publications: stage1Results.map((r) => r.optimized_publication)
  };

  const stage2Result = optimizeContentPlanStage2(optimizedDraft, stage2);

  return {
    stage1: {
      publications: stage1Results.map((r) => ({
        publication_id: r.optimized_publication?.publication_id ?? null,
        f_publ: r.f_publ,
        optimized_publication: r.optimized_publication,
        ga: {
          best_score: r.ga.best_score,
          generations: r.ga.generations,
          stop_reason: r.ga.stop_reason
        }
      })),
      optimized_publications: stage1Results.map((r) => r.optimized_publication)
    },
    stage2: {
      f_kp: stage2Result.f_kp,
      constraints_check: stage2Result.constraints_check,
      ga: {
        best_score: stage2Result.ga.best_score,
        generations: stage2Result.ga.generations,
        stop_reason: stage2Result.ga.stop_reason
      }
    },
    optimized_content_plan: stage2Result.optimized_plan
  };
}

