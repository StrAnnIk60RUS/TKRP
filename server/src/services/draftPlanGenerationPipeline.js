import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { callDeepSeekAPI } from '../../openrouter.js';
import { predictEngagementRatesForGeneratedPublications } from './relevancePredictionService.js';
import { parseJsonObjectFromLlmContent } from '../utils/llmJsonParsing.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKELETON_PROMPT_PATH = path.join(
  __dirname,
  '..',
  'prompts',
  'articleDraftPlanSkeletonPrompt.txt'
);
const BATCH_PROMPT_PATH = path.join(
  __dirname,
  '..',
  'prompts',
  'articleDraftPlanBatchPrompt.txt'
);

const ALLOWED_PLATFORMS = ['vk', 'linkedin'];
const ALLOWED_OBJECTIVES = ['inform', 'educate', 'engage', 'convert', 'retain'];
const DEFAULT_FORMATS = ['text', 'image', 'video', 'combined'];

function normalizePublicationDayMode(value) {
  return value === 'shared' ? 'shared' : 'spread';
}

function readPromptFile(filePath) {
  return fs.readFileSync(filePath, 'utf-8');
}

function extractJsonFromLlmContent(content) {
  return parseJsonObjectFromLlmContent(content);
}

function isIsoDateString(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function toIsoDateOnly(value) {
  if (!value) return null;
  if (isIsoDateString(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function daysBetweenInclusive(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  const diff = Math.floor((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
  return diff >= 0 ? diff + 1 : 0;
}

function addDaysIso(startDate, daysToAdd) {
  const date = new Date(`${startDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + daysToAdd);
  return date.toISOString().slice(0, 10);
}

function asNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return min;
  return Math.min(max, Math.max(min, numeric));
}

function clamp01(value) {
  return clamp(value, 0, 1);
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function uniqueStrings(values = []) {
  const seen = new Set();
  return values
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
    .filter((item) => {
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function normalizePlatform(value, fallback = 'linkedin') {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return ALLOWED_PLATFORMS.includes(normalized) ? normalized : fallback;
}

function normalizeObjective(value, fallback = 'inform') {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return ALLOWED_OBJECTIVES.includes(normalized) ? normalized : fallback;
}

function normalizeFormat(value, fallback = 'text') {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  const mapped = {
    text_post: 'text',
    image_post: 'image',
    video_post: 'video',
    reel: 'video',
    short_video: 'video',
    infographic: 'image',
    carousel: 'image'
  };
  const resolved = mapped[normalized] || normalized;
  return DEFAULT_FORMATS.includes(resolved) ? resolved : fallback;
}

function normalizeTone(value, fallback = 'expert') {
  const tone = typeof value === 'string' ? value.trim() : '';
  return tone || fallback;
}

function slugify(value, fallback = 'draft_plan') {
  const source = typeof value === 'string' ? value.trim().toLowerCase() : '';
  const slug = source
    .replace(/[^a-z0-9а-яё]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return slug || fallback;
}

function mergeUsageStats(usageItems = []) {
  return usageItems.reduce(
    (acc, usage) => ({
      prompt_tokens: acc.prompt_tokens + (Number(usage?.prompt_tokens) || 0),
      completion_tokens: acc.completion_tokens + (Number(usage?.completion_tokens) || 0),
      total_tokens: acc.total_tokens + (Number(usage?.total_tokens) || 0)
    }),
    {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0
    }
  );
}

function estimatePublicationCountFromFrequency(formInput = {}) {
  const start = toIsoDateOnly(formInput.contentPlanStartDate);
  const end = toIsoDateOnly(formInput.contentPlanEndDate);
  if (!start || !end) return 8;

  const horizonDays = daysBetweenInclusive(start, end);
  if (horizonDays <= 0) return 8;

  const weeks = horizonDays / 7;
  const frequency = typeof formInput.publicationFrequency === 'string'
    ? formInput.publicationFrequency.trim()
    : '';
  const perWeekMap = {
    daily: 7,
    '3-4_per_week': 3.5,
    '2-3_per_week': 2.5,
    weekly: 1,
    '2_per_week': 2
  };
  const perWeek = perWeekMap[frequency] || 1;
  return Math.max(1, Math.round(weeks * perWeek));
}

function getRequestedPublicationCount(formInput = {}) {
  const explicitMin = asNumber(formInput.minPublications ?? formInput.min_publications, null);
  if (explicitMin !== null && explicitMin > 0) {
    return Math.round(explicitMin);
  }
  return estimatePublicationCountFromFrequency(formInput);
}

function getTargetPublicationCount(formInput = {}) {
  const requestedCount = getRequestedPublicationCount(formInput);
  const publicationDayMode = normalizePublicationDayMode(formInput.publicationDayMode);
  if (publicationDayMode !== 'shared') return requestedCount;

  const platformsCount = uniqueStrings(toArray(formInput.platforms).map((value) => normalizePlatform(value)))
    .filter((value) => ALLOWED_PLATFORMS.includes(value)).length;

  if (platformsCount <= 1) return requestedCount;
  return Math.max(platformsCount, Math.ceil(requestedCount / platformsCount) * platformsCount);
}

function buildCompactPublicationContext(item = {}) {
  const data = item?.data || {};
  const model = data?.publication_model || {};
  const kpi = model?.kpi_estimate || {};
  return {
    publication_id: model.publication_id || data.publication_id || null,
    platform: data.platform || model.platform || null,
    topic: model.topic || data.topic || null,
    format: normalizeFormat(model.format || data.format || 'text'),
    objective: normalizeObjective(model.objective || data.objective || 'inform'),
    tone: normalizeTone(model.tone || data.tone || 'expert'),
    audience_segments: uniqueStrings(model.audience_segments || data.target_audience || []),
    summary: model.summary || data.summary || null,
    expected_kpi: {
      engagement_rate: clamp01(kpi.expected_engagement_rate ?? data.engagement_rate ?? 0.04),
      conversion_potential: clamp01(kpi.expected_conversion_potential ?? 0.1),
      reach_potential: clamp01(kpi.expected_reach_potential ?? 0.3)
    }
  };
}

function buildCompactPlanContext(item = {}) {
  const data = item?.data || {};
  const model = data?.content_plan_model || {};
  const kpi = model?.kpi_estimate || {};
  return {
    plan_id: data.plan_id || model.plan_id || null,
    platform: data.platform || model.platform || null,
    audience_segments: uniqueStrings(model.audience_segments || []),
    total_publications: asNumber(model.total_publications, null),
    posting_frequency_per_week: asNumber(model.posting_frequency_per_week, null),
    avg_engagement_rate: clamp01(kpi.avg_engagement_rate ?? 0.04),
    estimated_conversion_potential: clamp01(kpi.estimated_conversion_potential ?? 0.1)
  };
}

function buildCompactRagContext(ragResults = {}) {
  const publications = toArray(ragResults.publications)
    .slice(0, 8)
    .map(buildCompactPublicationContext);
  const contentPlans = toArray(ragResults.content_plans)
    .slice(0, 5)
    .map(buildCompactPlanContext);

  const precedentIds = uniqueStrings([
    ...publications.map((item) => item.publication_id),
    ...contentPlans.map((item) => item.plan_id)
  ]);

  return {
    retrieval: ragResults.retrieval || null,
    summary: {
      publications_count: publications.length,
      content_plans_count: contentPlans.length,
      total_publications_searched: ragResults.total_publications_searched || 0,
      total_content_plans_searched: ragResults.total_content_plans_searched || 0,
      precedent_ids: precedentIds
    },
    publications,
    content_plans: contentPlans
  };
}

function averagePrecedentKpi(compactRagContext = {}) {
  const publicationItems = toArray(compactRagContext.publications);
  if (!publicationItems.length) {
    return {
      engagement_rate: 0.045,
      conversion_potential: 0.12,
      reach_potential: 0.35
    };
  }

  const totals = publicationItems.reduce(
    (acc, item) => ({
      engagement_rate: acc.engagement_rate + clamp01(item?.expected_kpi?.engagement_rate ?? 0),
      conversion_potential: acc.conversion_potential + clamp01(item?.expected_kpi?.conversion_potential ?? 0),
      reach_potential: acc.reach_potential + clamp01(item?.expected_kpi?.reach_potential ?? 0)
    }),
    {
      engagement_rate: 0,
      conversion_potential: 0,
      reach_potential: 0
    }
  );

  return {
    engagement_rate: clamp01(totals.engagement_rate / publicationItems.length),
    conversion_potential: clamp01(totals.conversion_potential / publicationItems.length),
    reach_potential: clamp01(totals.reach_potential / publicationItems.length)
  };
}

function buildRequestedConstraints(formInput = {}, targetPublicationCount) {
  return {
    min_publications: targetPublicationCount,
    total_budget: asNumber(formInput.totalBudget ?? formInput.total_budget, null),
    max_cost_per_publication: asNumber(
      formInput.maxCostPerPublication ?? formInput.max_cost_per_publication,
      null
    )
  };
}

function buildRequestedAudience(formInput = {}) {
  return uniqueStrings([
    formInput.consumerCategory,
    ...String(formInput.consumerDemographics || '')
      .split(/[,\n;]/)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 3)
  ]);
}

function buildSpreadSchedule(startDate, endDate, count) {
  if (!isIsoDateString(startDate) || !isIsoDateString(endDate) || count <= 0) {
    return Array.from({ length: count }, () => null);
  }

  const spanDays = daysBetweenInclusive(startDate, endDate);
  if (spanDays <= 0) {
    return Array.from({ length: count }, () => startDate);
  }

  if (count === 1) return [startDate];

  return Array.from({ length: count }, (_, idx) => {
    const offset = Math.round((idx * (spanDays - 1)) / Math.max(1, count - 1));
    return addDaysIso(startDate, offset);
  });
}

function buildDefaultSchedule(startDate, endDate, count, publicationDayMode = 'spread', platformsCount = 1) {
  const normalizedMode = normalizePublicationDayMode(publicationDayMode);
  if (normalizedMode !== 'shared' || platformsCount <= 1) {
    return buildSpreadSchedule(startDate, endDate, count);
  }

  const sharedDateCount = Math.max(1, Math.ceil(count / platformsCount));
  const sharedDates = buildSpreadSchedule(startDate, endDate, sharedDateCount);
  return sharedDates.flatMap((date) => Array.from({ length: platformsCount }, () => date)).slice(0, count);
}

function getMonthKey(dateString) {
  const iso = toIsoDateOnly(dateString);
  return iso ? iso.slice(0, 7) : 'unknown-month';
}

function groupSlotsByMonth(slots = []) {
  const monthMap = new Map();
  slots.forEach((slot) => {
    const monthKey = getMonthKey(slot?.planned_date);
    if (!monthMap.has(monthKey)) {
      monthMap.set(monthKey, []);
    }
    monthMap.get(monthKey).push(slot);
  });
  return Array.from(monthMap.entries()).map(([monthKey, monthSlots]) => ({
    monthKey,
    slots: monthSlots
  }));
}

function buildGeneratedPublicationsContext(publications = []) {
  return publications
    .slice(-20)
    .map((item) => ({
      publication_id: item.publication_id,
      planned_date: item.planned_date,
      platform: item.platform,
      objective: item.objective,
      format: item.format,
      topic: item.topic
    }));
}

function buildSlotFallback(idx, config) {
  const platform = config.platforms[idx % config.platforms.length] || 'linkedin';
  const objective = ALLOWED_OBJECTIVES[idx % ALLOWED_OBJECTIVES.length];
  const format = config.formats[idx % config.formats.length] || 'text';
  const tone = config.defaultTone;
  return {
    slot_id: `slot_${String(idx + 1).padStart(3, '0')}`,
    planned_date: config.schedule[idx] || config.startDate,
    platform,
    objective,
    format,
    tone
  };
}

function repairSkeleton(rawSkeleton = {}, formInput = {}, targetPublicationCount, compactRagContext = {}) {
  const projectName = typeof formInput.projectName === 'string' ? formInput.projectName.trim() : 'IT Project';
  const requestedStart = toIsoDateOnly(formInput.contentPlanStartDate) || toIsoDateOnly(rawSkeleton?.planning_horizon?.start_date) || new Date().toISOString().slice(0, 10);
  const requestedEnd = toIsoDateOnly(formInput.contentPlanEndDate) || toIsoDateOnly(rawSkeleton?.planning_horizon?.end_date) || requestedStart;
  const publicationDayMode = normalizePublicationDayMode(
    formInput.publicationDayMode ?? rawSkeleton?.schedule_preferences?.publication_day_mode
  );
  const requestedPlatforms = uniqueStrings(toArray(formInput.platforms).map((value) => normalizePlatform(value)))
    .filter((value) => ALLOWED_PLATFORMS.includes(value));
  const normalizedPlatforms = requestedPlatforms.length
    ? requestedPlatforms
    : uniqueStrings(toArray(rawSkeleton.platforms).map((value) => normalizePlatform(value))).filter(Boolean);
  const platforms = normalizedPlatforms.length ? normalizedPlatforms : ['linkedin'];
  const formats = uniqueStrings(toArray(formInput.contentFormats).map((value) => normalizeFormat(value))).filter(Boolean);
  const resolvedFormats = formats.length ? formats : DEFAULT_FORMATS;
  const schedule = buildDefaultSchedule(
    requestedStart,
    requestedEnd,
    targetPublicationCount,
    publicationDayMode,
    platforms.length
  );
  const requestedPublicationCount = getRequestedPublicationCount(formInput);

  const rawSlots = toArray(rawSkeleton.publication_slots);
  const config = {
    platforms,
    formats: resolvedFormats,
    defaultTone: 'expert',
    schedule,
    startDate: requestedStart,
    publicationDayMode
  };

  const repairedSlots = Array.from({ length: targetPublicationCount }, (_, idx) => {
    const source = rawSlots[idx] || {};
    const fallback = buildSlotFallback(idx, config);
    return {
      slot_id: `slot_${String(idx + 1).padStart(3, '0')}`,
      planned_date: (() => {
        if (publicationDayMode === 'shared') return fallback.planned_date;
        const candidate = toIsoDateOnly(source.planned_date);
        if (!candidate) return fallback.planned_date;
        if (candidate < requestedStart) return requestedStart;
        if (candidate > requestedEnd) return requestedEnd;
        return candidate;
      })(),
      platform: publicationDayMode === 'shared'
        ? fallback.platform
        : normalizePlatform(source.platform, fallback.platform),
      objective: normalizeObjective(source.objective, fallback.objective),
      format: normalizeFormat(source.format, fallback.format),
      tone: normalizeTone(source.tone, fallback.tone)
    };
  });

  const avgKpi = averagePrecedentKpi(compactRagContext);
  const requestedConstraints = buildRequestedConstraints(formInput, targetPublicationCount);

  return {
    plan_id: rawSkeleton.plan_id || `draft_${slugify(projectName, 'it_project')}_001`,
    planning_horizon: {
      start_date: requestedStart,
      end_date: requestedEnd
    },
    platforms,
    target_audience: uniqueStrings([
      ...toArray(rawSkeleton.target_audience),
      ...buildRequestedAudience(formInput)
    ]),
    constraints: requestedConstraints,
    kpi_targets: {
      avg_engagement_rate: clamp01(
        rawSkeleton?.kpi_targets?.avg_engagement_rate ?? avgKpi.engagement_rate
      ),
      estimated_conversions: Math.max(
        0,
        Math.round(asNumber(rawSkeleton?.kpi_targets?.estimated_conversions, targetPublicationCount * 1.1) || 0)
      )
    },
    notes: typeof rawSkeleton.notes === 'string' && rawSkeleton.notes.trim()
      ? rawSkeleton.notes.trim()
      : `Черновой план для ${projectName}, собранный по частям на основе компактного RAG-контекста.`,
    schedule_preferences: {
      ...(rawSkeleton?.schedule_preferences && typeof rawSkeleton.schedule_preferences === 'object'
        ? rawSkeleton.schedule_preferences
        : {}),
      publication_day_mode: publicationDayMode,
      requested_publications: requestedPublicationCount,
      generated_publications: targetPublicationCount,
      platform_bundle_size: platforms.length
    },
    publication_slots: repairedSlots
  };
}

function buildCallToAction(objective, projectName) {
  const actions = {
    inform: `Узнать больше о ${projectName}`,
    educate: `Изучить материалы по ${projectName}`,
    engage: `Обсудить кейс ${projectName}`,
    convert: `Запросить демо ${projectName}`,
    retain: `Посмотреть roadmap ${projectName}`
  };
  return actions[objective] || `Узнать больше о ${projectName}`;
}

function buildFallbackTopic(slot, formInput, index) {
  const projectName = typeof formInput.projectName === 'string' && formInput.projectName.trim()
    ? formInput.projectName.trim()
    : 'IT-проект';
  const topicByObjective = {
    inform: 'обновление продукта',
    educate: 'практика внедрения',
    engage: 'обсуждение кейса',
    convert: 'бизнес-эффект решения',
    retain: 'развитие платформы'
  };
  return `${projectName}: ${topicByObjective[slot.objective] || 'экспертный материал'} ${index + 1}`;
}

function buildFallbackSummary(slot, formInput) {
  const projectDescription = typeof formInput.projectDescription === 'string' && formInput.projectDescription.trim()
    ? formInput.projectDescription.trim()
    : 'Экспертная публикация об IT-проекте и его прикладной ценности для целевой аудитории.';
  return `${projectDescription.slice(0, 220)}${projectDescription.length > 220 ? '...' : ''}`;
}

function buildFallbackKeyMessage(formInput) {
  const source = typeof formInput.projectBenefits === 'string' && formInput.projectBenefits.trim()
    ? formInput.projectBenefits.trim()
    : typeof formInput.projectGoals === 'string' && formInput.projectGoals.trim()
      ? formInput.projectGoals.trim()
      : 'Проект помогает бизнесу быстрее принимать решения на основе данных.';
  return `${source.slice(0, 180)}${source.length > 180 ? '...' : ''}`;
}

function estimatePublicationCost(slot, skeleton, formInput) {
  const maxCost = asNumber(
    formInput.maxCostPerPublication ?? skeleton?.constraints?.max_cost_per_publication,
    null
  );
  const totalBudget = asNumber(formInput.totalBudget ?? skeleton?.constraints?.total_budget, null);
  const slotsCount = toArray(skeleton?.publication_slots).length || 1;
  const budgetBasedCost = totalBudget !== null ? totalBudget / slotsCount : null;

  if (maxCost !== null && budgetBasedCost !== null) {
    return Math.max(0, Math.min(maxCost, Math.round(budgetBasedCost)));
  }
  if (budgetBasedCost !== null) {
    return Math.max(0, Math.round(budgetBasedCost));
  }
  if (maxCost !== null) {
    return Math.max(0, Math.round(maxCost * 0.7));
  }

  const baseByFormat = {
    text: 2500,
    image: 3500,
    video: 6000,
    combined: 5000
  };
  return baseByFormat[slot.format] || 3000;
}

function buildFallbackPublication(slot, formInput, compactRagContext, skeleton, index) {
  const projectName = typeof formInput.projectName === 'string' && formInput.projectName.trim()
    ? formInput.projectName.trim()
    : 'IT Project';
  const avgKpi = averagePrecedentKpi(compactRagContext);
  const precedentIds = toArray(compactRagContext?.summary?.precedent_ids).slice(0, 2);
  return {
    topic: buildFallbackTopic(slot, formInput, index),
    format: slot.format,
    objective: slot.objective,
    tone: slot.tone,
    summary: buildFallbackSummary(slot, formInput),
    key_message: buildFallbackKeyMessage(formInput),
    cta: buildCallToAction(slot.objective, projectName),
    estimated_cost: estimatePublicationCost(slot, skeleton, formInput),
    expected_kpi: {
      engagement_rate: clamp01(avgKpi.engagement_rate),
      conversion_potential: clamp01(avgKpi.conversion_potential),
      reach_potential: clamp01(avgKpi.reach_potential)
    },
    used_precedent_ids: precedentIds
  };
}

function normalizeBatchPublication(rawItem = {}, slot, formInput, compactRagContext, skeleton, index) {
  const fallback = buildFallbackPublication(slot, formInput, compactRagContext, skeleton, index);
  const maxCost = asNumber(skeleton?.constraints?.max_cost_per_publication, null);
  const rawCost = asNumber(rawItem.estimated_cost, fallback.estimated_cost);
  const estimatedCost = maxCost !== null
    ? Math.max(0, Math.min(Math.round(rawCost), Math.round(maxCost)))
    : Math.max(0, Math.round(rawCost));

  return {
    publication_id: `plan_pub_${String(index + 1).padStart(3, '0')}`,
    planned_date: slot.planned_date,
    platform: slot.platform,
    topic: typeof rawItem.topic === 'string' && rawItem.topic.trim() ? rawItem.topic.trim() : fallback.topic,
    format: normalizeFormat(rawItem.format, slot.format),
    objective: normalizeObjective(rawItem.objective, slot.objective),
    tone: normalizeTone(rawItem.tone, slot.tone),
    summary: typeof rawItem.summary === 'string' && rawItem.summary.trim() ? rawItem.summary.trim() : fallback.summary,
    key_message: typeof rawItem.key_message === 'string' && rawItem.key_message.trim()
      ? rawItem.key_message.trim()
      : fallback.key_message,
    cta: typeof rawItem.cta === 'string' && rawItem.cta.trim() ? rawItem.cta.trim() : fallback.cta,
    estimated_cost: estimatedCost,
    expected_kpi: {
      engagement_rate: clamp01(rawItem?.expected_kpi?.engagement_rate ?? fallback.expected_kpi.engagement_rate),
      conversion_potential: clamp01(
        rawItem?.expected_kpi?.conversion_potential ?? fallback.expected_kpi.conversion_potential
      ),
      reach_potential: clamp01(rawItem?.expected_kpi?.reach_potential ?? fallback.expected_kpi.reach_potential)
    },
    used_precedent_ids: uniqueStrings(
      toArray(rawItem.used_precedent_ids).filter((value) => typeof value === 'string')
    ).slice(0, 5)
  };
}

function rebalancePlanCosts(plan = {}) {
  const publications = toArray(plan.publications).map((item) => ({ ...item }));
  const totalBudget = asNumber(plan?.constraints?.total_budget, null);
  const maxCost = asNumber(plan?.constraints?.max_cost_per_publication, null);

  if (!publications.length) {
    return { ...plan, publications };
  }

  publications.forEach((item) => {
    let cost = asNumber(item.estimated_cost, 0) ?? 0;
    if (maxCost !== null) {
      cost = Math.min(cost, maxCost);
    }
    item.estimated_cost = Math.max(0, Math.round(cost));
  });

  if (totalBudget !== null) {
    const currentTotal = publications.reduce((acc, item) => acc + (Number(item.estimated_cost) || 0), 0);
    if (currentTotal > totalBudget && currentTotal > 0) {
      const ratio = totalBudget / currentTotal;
      publications.forEach((item) => {
        item.estimated_cost = Math.max(0, Math.floor((Number(item.estimated_cost) || 0) * ratio));
      });
    }
  }

  return {
    ...plan,
    publications
  };
}

function validateDraftPlan(plan = {}, formInput = {}) {
  const errors = [];
  const publications = toArray(plan.publications);
  const requestedStart = toIsoDateOnly(formInput.contentPlanStartDate) || toIsoDateOnly(plan?.planning_horizon?.start_date);
  const requestedEnd = toIsoDateOnly(formInput.contentPlanEndDate) || toIsoDateOnly(plan?.planning_horizon?.end_date);
  const requestedPlatforms = uniqueStrings(toArray(formInput.platforms).map((value) => normalizePlatform(value)));
  const minPublications = asNumber(formInput.minPublications ?? plan?.constraints?.min_publications, null);
  const totalBudget = asNumber(formInput.totalBudget ?? plan?.constraints?.total_budget, null);
  const maxCost = asNumber(formInput.maxCostPerPublication ?? plan?.constraints?.max_cost_per_publication, null);

  if (!plan || typeof plan !== 'object') {
    errors.push('draft_content_plan отсутствует');
  }

  if (!plan?.plan_id || typeof plan.plan_id !== 'string') {
    errors.push('plan_id отсутствует');
  }

  if (!requestedStart || !requestedEnd) {
    errors.push('planning_horizon отсутствует или невалиден');
  }

  if (minPublications !== null && publications.length < minPublications) {
    errors.push(`min_publications violated: have=${publications.length}, need>=${minPublications}`);
  }

  const ids = new Set();
  publications.forEach((pub, idx) => {
    const prefix = `publication[${idx}]`;
    if (!pub?.publication_id || typeof pub.publication_id !== 'string') {
      errors.push(`${prefix}: publication_id отсутствует`);
    } else if (ids.has(pub.publication_id)) {
      errors.push(`${prefix}: duplicate publication_id=${pub.publication_id}`);
    } else {
      ids.add(pub.publication_id);
    }

    if (!isIsoDateString(pub?.planned_date)) {
      errors.push(`${prefix}: planned_date невалиден`);
    } else {
      if (requestedStart && pub.planned_date < requestedStart) {
        errors.push(`${prefix}: planned_date раньше горизонта`);
      }
      if (requestedEnd && pub.planned_date > requestedEnd) {
        errors.push(`${prefix}: planned_date позже горизонта`);
      }
    }

    if (!ALLOWED_PLATFORMS.includes(pub?.platform)) {
      errors.push(`${prefix}: platform невалидна`);
    }
    if (requestedPlatforms.length && !requestedPlatforms.includes(pub?.platform)) {
      errors.push(`${prefix}: platform не входит в выбранные платформы`);
    }

    if (!pub?.topic || typeof pub.topic !== 'string') errors.push(`${prefix}: topic отсутствует`);
    if (!pub?.summary || typeof pub.summary !== 'string') errors.push(`${prefix}: summary отсутствует`);
    if (!pub?.key_message || typeof pub.key_message !== 'string') errors.push(`${prefix}: key_message отсутствует`);
    if (!pub?.cta || typeof pub.cta !== 'string') errors.push(`${prefix}: cta отсутствует`);

    if (!ALLOWED_OBJECTIVES.includes(pub?.objective)) {
      errors.push(`${prefix}: objective невалиден`);
    }

    if (!DEFAULT_FORMATS.includes(pub?.format)) {
      errors.push(`${prefix}: format невалиден`);
    }

    const estimatedCost = asNumber(pub?.estimated_cost, null);
    if (estimatedCost === null || estimatedCost < 0) {
      errors.push(`${prefix}: estimated_cost невалиден`);
    }
    if (maxCost !== null && estimatedCost !== null && estimatedCost > maxCost) {
      errors.push(`${prefix}: estimated_cost превышает max_cost_per_publication`);
    }

    const engagement = asNumber(pub?.expected_kpi?.engagement_rate, null);
    const conversion = asNumber(pub?.expected_kpi?.conversion_potential, null);
    const reach = asNumber(pub?.expected_kpi?.reach_potential, null);
    if (engagement === null || engagement < 0 || engagement > 1) {
      errors.push(`${prefix}: expected_kpi.engagement_rate невалиден`);
    }
    if (conversion === null || conversion < 0 || conversion > 1) {
      errors.push(`${prefix}: expected_kpi.conversion_potential невалиден`);
    }
    if (reach === null || reach < 0 || reach > 1) {
      errors.push(`${prefix}: expected_kpi.reach_potential невалиден`);
    }
  });

  if (totalBudget !== null) {
    const totalCost = publications.reduce((acc, pub) => acc + (Number(pub?.estimated_cost) || 0), 0);
    if (totalCost > totalBudget) {
      errors.push(`total_budget violated: cost=${totalCost}, limit=${totalBudget}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

async function generateSkeleton(formInput, query, compactRagContext, targetPublicationCount) {
  const systemPrompt = readPromptFile(SKELETON_PROMPT_PATH);
  const userPrompt = `Собери skeleton чернового контент-плана.

Требования проекта:
${JSON.stringify(formInput, null, 2)}

RAG query:
${query}

Компактный RAG-контекст:
${JSON.stringify(compactRagContext, null, 2)}

Целевое число публикаций:
${targetPublicationCount}
`;

  const llmResponse = await callDeepSeekAPI(systemPrompt, userPrompt, {
    temperature: 0.2,
    maxTokens: 12000,
    responseFormat: 'json'
  });
  const parsed = extractJsonFromLlmContent(llmResponse.content || '');
  const skeleton = parsed?.draft_content_plan_skeleton || parsed || {};

  return {
    skeleton,
    usage: llmResponse.usage || null
  };
}

async function generateMonthlyPublications({
  formInput,
  query,
  compactRagContext,
  skeleton,
  monthKey,
  slots,
  previousPublications,
  monthIndex,
  totalMonths
}) {
  const systemPrompt = readPromptFile(BATCH_PROMPT_PATH);
  const userPrompt = `Сгенерируй публикации для одного месяца по skeleton.

Требования проекта:
${JSON.stringify(formInput, null, 2)}

RAG query:
${query}

Skeleton метаданные:
${JSON.stringify({
  plan_id: skeleton.plan_id,
  planning_horizon: skeleton.planning_horizon,
  platforms: skeleton.platforms,
  constraints: skeleton.constraints,
  kpi_targets: skeleton.kpi_targets
}, null, 2)}

Компактный RAG-контекст:
${JSON.stringify(compactRagContext, null, 2)}

Ранее сгенерированные публикации предыдущих месяцев:
${JSON.stringify(buildGeneratedPublicationsContext(previousPublications), null, 2)}

Месяц ${monthIndex + 1} из ${totalMonths}:
${monthKey}

Слоты текущего месяца:
${JSON.stringify(slots, null, 2)}
`;

  const llmResponse = await callDeepSeekAPI(systemPrompt, userPrompt, {
    temperature: 0.25,
    maxTokens: 12000,
    responseFormat: 'json'
  });
  const parsed = extractJsonFromLlmContent(llmResponse.content || '');
  const publications = toArray(parsed?.publications || parsed?.batch_publications || parsed);

  return {
    publications,
    usage: llmResponse.usage || null
  };
}

export async function generateDraftPlanBatched({
  formInput,
  query,
  ragResults,
  ragLimit
}) {
  const compactRagContext = buildCompactRagContext(ragResults);
  const requestedPublicationCount = getRequestedPublicationCount(formInput);
  const targetPublicationCount = getTargetPublicationCount(formInput);

  const usageItems = [];
  const rawSkeletonResult = await generateSkeleton(
    formInput,
    query,
    compactRagContext,
    targetPublicationCount
  );
  if (rawSkeletonResult.usage) usageItems.push(rawSkeletonResult.usage);

  const skeleton = repairSkeleton(
    rawSkeletonResult.skeleton,
    formInput,
    targetPublicationCount,
    compactRagContext
  );

  const monthlyGroups = groupSlotsByMonth(skeleton.publication_slots);
  const publicationMap = new Map();
  const generatedPublications = [];

  for (let monthIndex = 0; monthIndex < monthlyGroups.length; monthIndex += 1) {
    const { monthKey, slots } = monthlyGroups[monthIndex];
    const batchResult = await generateMonthlyPublications({
      formInput,
      query,
      compactRagContext,
      skeleton,
      monthKey,
      slots,
      previousPublications: generatedPublications,
      monthIndex,
      totalMonths: monthlyGroups.length
    });
    if (batchResult.usage) usageItems.push(batchResult.usage);

    const rawItems = toArray(batchResult.publications);
    slots.forEach((slot, localIndex) => {
      const byId = rawItems.find((item) => item?.slot_id === slot.slot_id);
      const byPosition = rawItems[localIndex];
      const resolved = byId || byPosition || null;
      publicationMap.set(slot.slot_id, resolved);
      if (resolved) {
        generatedPublications.push({
          publication_id: slot.slot_id,
          planned_date: slot.planned_date,
          platform: slot.platform,
          objective: normalizeObjective(resolved.objective, slot.objective),
          format: normalizeFormat(resolved.format, slot.format),
          topic: typeof resolved.topic === 'string' ? resolved.topic.trim() : ''
        });
      }
    });
  }

  const mergedPlan = {
    plan_id: skeleton.plan_id,
    planning_horizon: skeleton.planning_horizon,
    platforms: skeleton.platforms,
    target_audience: skeleton.target_audience,
    constraints: skeleton.constraints,
    schedule_preferences: skeleton.schedule_preferences,
    publications: skeleton.publication_slots.map((slot, index) =>
      normalizeBatchPublication(
        publicationMap.get(slot.slot_id) || {},
        slot,
        formInput,
        compactRagContext,
        skeleton,
        index
      )
    ),
    kpi_targets: skeleton.kpi_targets,
    notes: skeleton.notes
  };

  const repairedPlan = rebalancePlanCosts(mergedPlan);

  // ML-предсказание релевантности (engagement_rate) на основе embeddings.
  // Если модель недоступна/не обучена или произошла ошибка — продолжаем с эвристическими expected_kpi.
  try {
    const mlResult = await predictEngagementRatesForGeneratedPublications(repairedPlan.publications, {
      forceTrain: false
    });

    repairedPlan.publications = mlResult.updatedPublications;
    repairedPlan.kpi_targets = {
      ...(repairedPlan.kpi_targets || {}),
      avg_engagement_rate: mlResult.avgEngagementRate,
      avg_engagement_rate_source: 'ml_relevance_prediction'
    };
  } catch (error) {
    console.warn('[relevancePrediction] Failed to predict engagement_rate:', error?.message || error);
  }

  const validation = validateDraftPlan(repairedPlan, formInput);
  if (!validation.valid) {
    const error = new Error(`Итоговый draft_content_plan не прошел валидацию: ${validation.errors.join('; ')}`);
    error.validation_errors = validation.errors;
    throw error;
  }

  return {
    draft: {
      draft_content_plan: repairedPlan
    },
    usage: usageItems.length ? mergeUsageStats(usageItems) : null,
    generation_metadata: {
      mode: 'skeleton_monthly_merge',
      rag_limit: ragLimit,
      requested_publications: requestedPublicationCount,
      target_publications: targetPublicationCount,
      total_months: monthlyGroups.length,
      compact_rag_context: compactRagContext.summary
    }
  };
}
