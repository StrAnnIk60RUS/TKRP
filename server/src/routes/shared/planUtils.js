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

  const normalized = JSON.parse(JSON.stringify(parsedDraft));
  const normalizedPlan = normalized.draft_content_plan;

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

    if (spanDays > 0 && uniqueDates.size <= 1) {
      const step = Math.max(1, Math.floor(spanDays / Math.max(1, deduped.length)));
      deduped.forEach((pub, idx) => {
        const offset = Math.min(spanDays - 1, idx * step);
        pub.planned_date = addDaysIso(startDate, offset);
      });
    }
  }

  normalizedPlan.publications = deduped;
  return normalized;
}

export function buildRagQueryFromForm(formInput = {}) {
  const parts = [
    formInput.projectName ? `IT-проект ${formInput.projectName}` : '',
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
