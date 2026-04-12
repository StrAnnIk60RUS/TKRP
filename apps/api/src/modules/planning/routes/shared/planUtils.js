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

export function normalizeDraftPlanResponse(parsedDraft, formInput) {
  if (!parsedDraft || typeof parsedDraft !== 'object') return parsedDraft;
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
