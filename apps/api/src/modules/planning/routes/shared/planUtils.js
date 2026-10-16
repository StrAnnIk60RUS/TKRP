import { assertValidAgainstJsonSchema } from '../../../../shared/utils/jsonSchemaValidator.js';

const PLAN_FORMAT_ALIASES = {
  text_post: 'text',
  image_post: 'image',
  video_post: 'video',
  reel: 'video',
  short_video: 'video',
  infographic: 'image',
  carousel: 'image'
};
const PLAN_ALLOWED_FORMATS = new Set(['text', 'image', 'video', 'combined']);

export const PLAN_ALLOWED_TONES = ['expert', 'friendly', 'official', 'inspiring', 'humorous', 'neutral'];
const PLAN_ALLOWED_TONE_SET = new Set(PLAN_ALLOWED_TONES);

export function normalizePublicationToneValue(value, fallback = 'expert') {
  const source = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!source) return fallback;

  const normalized = source
    .replace(/[|/,+;]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const aliases = {
    expert: 'expert',
    экспертный: 'expert',
    эксперт: 'expert',
    technical: 'expert',
    tech: 'expert',
    деловой: 'expert',
    деловая: 'expert',
    информативный: 'expert',
    информативная: 'expert',
    информационный: 'expert',
    professional: 'expert',
    businesslike: 'expert',
    friendly: 'friendly',
    friend: 'friendly',
    дружелюбный: 'friendly',
    дружеский: 'friendly',
    warm: 'friendly',
    casual: 'friendly',
    лояльный: 'friendly',
    лояльная: 'friendly',
    supportive: 'friendly',
    поддерживающий: 'friendly',
    поддерживающая: 'friendly',
    official: 'official',
    formal: 'official',
    официальный: 'official',
    корпоративный: 'official',
    уверенный: 'official',
    уверенная: 'official',
    inspiring: 'inspiring',
    inspirational: 'inspiring',
    motivational: 'inspiring',
    вдохновляющий: 'inspiring',
    юмористический: 'humorous',
    humorous: 'humorous',
    humor: 'humorous',
    fun: 'humorous',
    neutral: 'neutral',
    нейтральный: 'neutral'
  };

  const tokens = normalized.split(' ').filter(Boolean);
  for (const token of tokens) {
    const mapped = aliases[token];
    if (mapped && PLAN_ALLOWED_TONE_SET.has(mapped)) return mapped;
  }

  if (PLAN_ALLOWED_TONE_SET.has(normalized)) return normalized;
  return fallback;
}

export function normalizePublicationFormatValue(value, fallback = 'text') {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  const resolved = PLAN_FORMAT_ALIASES[normalized] || normalized;
  return PLAN_ALLOWED_FORMATS.has(resolved) ? resolved : fallback;
}

export function normalizePlanPublicationsFormats(publications) {
  if (!Array.isArray(publications)) return publications;
  return publications.map((pub) => {
    if (!pub || typeof pub !== 'object') return pub;
    return { ...pub, format: normalizePublicationFormatValue(pub.format, 'text') };
  });
}

export function normalizePlanPublicationFields(pub) {
  if (!pub || typeof pub !== 'object') return pub;
  return {
    ...pub,
    format: normalizePublicationFormatValue(pub.format, 'text'),
    tone: normalizePublicationToneValue(pub.tone, 'expert')
  };
}

export function normalizePlanPublicationsFields(publications) {
  if (!Array.isArray(publications)) return publications;
  return publications.map(normalizePlanPublicationFields);
}

export function isIsoDateString(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function toIsoDateOnly(value) {
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

// Contract schema для raw draft из LLM-пipeline: envelope + базовая types.
// Strict (throw + raw_value), потому что pipeline уже validated repairedPlan;
// здесь мы guard route contract (e.g. /generate_llm direct path).
const DRAFT_PLAN_ENVELOPE_SCHEMA = {
  type: 'object',
  required: ['draft_content_plan'],
  properties: {
    draft_content_plan: {
      type: 'object',
      required: ['publications'],
      properties: {
        publications: {
          type: 'array',
          items: {
            type: 'object',
            required: ['platform', 'topic'],
            properties: {
              publication_id: { type: 'string' },
              platform: { type: 'string', minLength: 1 },
              planned_date: { type: 'string' },
              topic: { type: 'string', minLength: 1 },
              format: { type: 'string' },
              objective: { type: 'string' }
            }
          }
        }
      }
    }
  }
};

export function normalizeDraftPlanResponse(parsedDraft, formInput) {
  if (!parsedDraft || typeof parsedDraft !== 'object') return parsedDraft;

  assertValidAgainstJsonSchema(parsedDraft, DRAFT_PLAN_ENVELOPE_SCHEMA, 'draft plan envelope');
  const plan = parsedDraft?.draft_content_plan;
  if (!plan || typeof plan !== 'object') return parsedDraft;

  const requestedStart = toIsoDateOnly(formInput?.contentPlanStartDate) || null;
  const requestedEnd = toIsoDateOnly(formInput?.contentPlanEndDate) || null;
  const requestedPlatforms = Array.isArray(formInput?.platforms) ? formInput.platforms : [];
  const publicationDayMode =
    formInput?.publicationDayMode === 'shared' || plan?.schedule_preferences?.publication_day_mode === 'shared'
      ? 'shared'
      : 'spread';

  const normalized = JSON.parse(JSON.stringify(parsedDraft));
  const normalizedPlan = normalized.draft_content_plan;
  normalizedPlan.schedule_preferences = {
    ...(normalizedPlan?.schedule_preferences && typeof normalizedPlan.schedule_preferences === 'object'
      ? normalizedPlan.schedule_preferences
      : {}),
    publication_day_mode: publicationDayMode
  };

  if (requestedStart && requestedEnd) {
    normalizedPlan.planning_horizon = { start_date: requestedStart, end_date: requestedEnd };
  } else {
    const start = toIsoDateOnly(normalizedPlan?.planning_horizon?.start_date);
    const end = toIsoDateOnly(normalizedPlan?.planning_horizon?.end_date);
    normalizedPlan.planning_horizon = {
      start_date: start || (requestedStart ?? null),
      end_date: end || (requestedEnd ?? null)
    };
  }

  if (requestedPlatforms.length) {
    normalizedPlan.platforms = requestedPlatforms;
  }

  const contentVertical =
    typeof formInput?.content_vertical === 'string' && formInput.content_vertical.trim()
      ? formInput.content_vertical.trim()
      : typeof formInput?.industry === 'string' && formInput.industry.trim()
        ? formInput.industry.trim()
        : '';
  const contentProfile = {
    content_vertical: contentVertical || null,
    industry:
      typeof formInput?.industry === 'string' && formInput.industry.trim()
        ? formInput.industry.trim()
        : null,
    brand_voice:
      typeof formInput?.brandVoice === 'string' && formInput.brandVoice.trim()
        ? formInput.brandVoice.trim()
        : null
  };
  normalizedPlan.content_profile = {
    ...(normalizedPlan.content_profile && typeof normalizedPlan.content_profile === 'object'
      ? normalizedPlan.content_profile
      : {}),
    ...contentProfile
  };

  const publications = Array.isArray(normalizedPlan.publications) ? normalizedPlan.publications : [];
  const seen = new Set();
  const deduped = [];

  publications.forEach((pub) => {
    if (!pub || typeof pub !== 'object') return;
    const key = [
      String(pub.platform || '').toLowerCase(),
      toIsoDateOnly(pub.planned_date) || '',
      String(pub.topic || '').trim().toLowerCase(),
      String(pub.format || '').trim().toLowerCase(),
      String(pub.objective || '').trim().toLowerCase()
    ].join('|');
    if (!key || seen.has(key)) return;
    seen.add(key);
    deduped.push(pub);
  });

  const usedIds = new Set();
  deduped.forEach((pub, idx) => {
    const current = typeof pub.publication_id === 'string' ? pub.publication_id.trim() : '';
    let nextId = current;
    if (!nextId || usedIds.has(nextId)) {
      nextId = `plan_pub_${idx + 1}`;
    }
    while (usedIds.has(nextId)) {
      nextId = `${nextId}_${idx + 1}`;
    }
    usedIds.add(nextId);
    pub.publication_id = nextId;
  });

  const startDate = normalizedPlan?.planning_horizon?.start_date;
  const endDate = normalizedPlan?.planning_horizon?.end_date;
  if (isIsoDateString(startDate) && isIsoDateString(endDate) && deduped.length) {
    const spanDays = daysBetweenInclusive(startDate, endDate);
    const normalizedDates = deduped.map((p) => toIsoDateOnly(p.planned_date)).filter(Boolean);
    const uniqueDates = new Set(normalizedDates);

    deduped.forEach((pub) => {
      const normalizedDate = toIsoDateOnly(pub.planned_date);
      if (!normalizedDate) return;
      if (normalizedDate < startDate) pub.planned_date = startDate;
      if (normalizedDate > endDate) pub.planned_date = endDate;
    });

    if (spanDays > 0 && uniqueDates.size <= 1 && publicationDayMode !== 'shared') {
      const step = Math.max(1, Math.floor(spanDays / Math.max(1, deduped.length)));
      deduped.forEach((pub, idx) => {
        const offset = Math.min(spanDays - 1, idx * step);
        pub.planned_date = addDaysIso(startDate, offset);
      });
    }
  }

  normalizedPlan.publications = normalizePlanPublicationsFields(deduped);
  return normalized;
}

export function buildRagQueryFromForm(formInput = {}) {
  const vertical =
    typeof formInput.content_vertical === 'string' && formInput.content_vertical.trim()
      ? formInput.content_vertical.trim()
      : typeof formInput.industry === 'string' && formInput.industry.trim()
        ? formInput.industry.trim()
        : '';
  const parts = [
    formInput.projectName ? `Проект ${formInput.projectName}` : '',
    vertical ? `Вертикаль: ${vertical}` : '',
    formInput.projectDescription || '',
    formInput.projectBenefits ? `Преимущества: ${formInput.projectBenefits}` : '',
    formInput.consumerCategory ? `Аудитория: ${formInput.consumerCategory}` : '',
    Array.isArray(formInput.platforms) && formInput.platforms.length
      ? `Платформы: ${formInput.platforms.join(', ')}`
      : '',
    Array.isArray(formInput.contentFormats) && formInput.contentFormats.length
      ? `Форматы: ${formInput.contentFormats.join(', ')}`
      : ''
  ];

  return parts.filter(Boolean).join('. ');
}

function pinnedRecordFromInput(item) {
  if (!item || typeof item !== 'object') return null;
  if (item.type === 'publication' && item.data && typeof item.data === 'object') {
    return {
      ...item,
      score: Math.max(Number(item.score) || 0, 0.99),
      pinned: true
    };
  }
  const model = item.publication_model && typeof item.publication_model === 'object' ? item.publication_model : {};
  const topic = String(model.topic || item.topic || '').trim();
  const summary = String(model.summary || item.summary || item.content || '').trim();
  if (topic.toLowerCase() === 'unspecified') return null;
  if (!topic && summary.length < 40) return null;
  return {
    type: 'publication',
    score: 1,
    pinned: true,
    matched_tokens: [],
    data: {
      publication_id: model.publication_id || item.publication_id || null,
      platform: item.platform || model.platform || null,
      competitor_name: item.competitor_name || item.name || null,
      source_url: item.url || item.source_url || null,
      raw_content: typeof item.content === 'string' ? item.content : item.raw_content || null,
      raw_metrics: item.metrics || item.raw_metrics || null,
      engagement_rate: item.engagement_rate ?? null,
      publication_model: {
        ...model,
        topic: topic || null,
        summary: summary.slice(0, 1200) || null,
        objective: model.objective || item.objective || null,
        format: model.format || item.format || null,
        tone: model.tone || item.tone || null,
        publication_id: model.publication_id || item.publication_id || null
      }
    }
  };
}

/** Current competitor posts stay in the generation context ahead of the general search. */
export function mergePinnedPublications(ragResults = {}, pinned = [], limit = 8) {
  const pinnedItems = (Array.isArray(pinned) ? pinned : [])
    .map(pinnedRecordFromInput)
    .filter(Boolean)
    .slice(0, 8);
  const seen = new Set(pinnedItems.map((item) => item.data?.publication_id).filter(Boolean));
  const seenUrls = new Set(pinnedItems.map((item) => item.data?.source_url).filter(Boolean));
  const rest = (Array.isArray(ragResults?.publications) ? ragResults.publications : []).filter((item) => {
    const id = item?.data?.publication_id;
    const url = item?.data?.source_url;
    if (id && seen.has(id)) return false;
    if (url && seenUrls.has(url)) return false;
    return true;
  });
  const cap = Math.max(Number(limit) || 8, pinnedItems.length);
  return {
    ...ragResults,
    publications: [...pinnedItems, ...rest].slice(0, cap + 4)
  };
}
