const DEFAULT_SPCJ_DIMENSIONS = [
  'audience_relevance',
  'educational_value',
  'evidence_strength',
  'clarity',
  'engagement_potential',
  'brand_fit',
  'timeliness',
  'cta_strength'
];

function clamp01(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  if (numeric < 0) return 0;
  if (numeric > 1) return 1;
  return Number(numeric.toFixed(3));
}

function asString(value, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback;
}

function asNullableString(value) {
  const normalized = asString(value);
  return normalized.length ? normalized : null;
}

function asStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item, index, array) => item.length > 0 && array.indexOf(item) === index);
}

function asNumberOrNull(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

const METRICS_QUALITY_VALUES = ['views_based', 'interaction_proxy', 'unknown'];

function inferMetricsQualitySnapshot(post) {
  const raw = asString(post?.metrics_quality);
  if (raw && METRICS_QUALITY_VALUES.includes(raw)) {
    return raw;
  }
  const views = Number(post?.metrics?.views) || 0;
  if (views > 0) {
    return 'views_based';
  }
  const interactions =
    (Number(post?.metrics?.likes) || 0) +
    (Number(post?.metrics?.comments) || 0) +
    (Number(post?.metrics?.shares) || 0);
  if (interactions > 0) {
    return 'interaction_proxy';
  }
  return 'unknown';
}

function inferPostFormat(post) {
  const attachments = post?.attachments || {};
  if (attachments.has_video) return 'video';
  if (attachments.has_photo) return 'image_post';
  if (attachments.has_document) return 'document_post';
  if (attachments.has_link) return 'link_post';
  return 'text_post';
}

function inferContentType(post) {
  const publicationModel = post?.publication_model || {};
  return (
    asNullableString(publicationModel.type) ||
    asNullableString(post?.content_category) ||
    'other'
  );
}

function inferTone(post) {
  const publicationModel = post?.publication_model || {};
  return asNullableString(publicationModel.tone) || asNullableString(post?.tone) || 'neutral';
}

function inferObjective(post) {
  const publicationModel = post?.publication_model || {};
  return asNullableString(publicationModel.objective) || asNullableString(post?.objective) || 'inform';
}

function buildSpcjDimensions(post) {
  const publicationModel = post?.publication_model || {};
  const sourceDimensions = publicationModel?.spcj?.dimensions || {};

  const dimensions = {};
  DEFAULT_SPCJ_DIMENSIONS.forEach((key) => {
    dimensions[key] = clamp01(sourceDimensions[key]);
  });

  if (post?.analysis?.content_meaning?.has_cta === 1 && dimensions.cta_strength === 0) {
    dimensions.cta_strength = 0.7;
  }

  if (post?.analysis?.content_meaning?.clarity === 2 && dimensions.clarity === 0) {
    dimensions.clarity = 0.9;
  } else if (post?.analysis?.content_meaning?.clarity === 1 && dimensions.clarity === 0) {
    dimensions.clarity = 0.6;
  }

  if (post?.analysis?.structure?.value_density === 2 && dimensions.educational_value === 0) {
    dimensions.educational_value = 0.8;
  } else if (post?.analysis?.structure?.value_density === 1 && dimensions.educational_value === 0) {
    dimensions.educational_value = 0.5;
  }

  if (post?.analysis?.content_meaning?.arguments === 2 && dimensions.evidence_strength === 0) {
    dimensions.evidence_strength = 0.9;
  } else if (post?.analysis?.content_meaning?.arguments === 1 && dimensions.evidence_strength === 0) {
    dimensions.evidence_strength = 0.5;
  }

  if (post?.analysis?.tone_style?.emotional_level === 2 && dimensions.engagement_potential === 0) {
    dimensions.engagement_potential = 0.8;
  } else if (post?.engagement_rate > 0 && dimensions.engagement_potential === 0) {
    dimensions.engagement_potential = clamp01(Math.min(post.engagement_rate * 4, 1));
  }

  // Детерминированный analysis (postDeterministicFeatures) — заполняем нули, если LLM не дал content_meaning
  const det = post?.analysis || {};
  const struct = det.structure || {};
  const head = det.headline || {};
  const fp = det.first_paragraph || {};
  const ts = det.tone_style || {};
  const lit = det.literacy || {};

  if (dimensions.clarity === 0) {
    let score = 0;
    if (Number(head.length_words) > 0) score += 0.22;
    if (struct.has_paragraphs === 1) score += 0.18;
    if (struct.has_lists === 1) score += 0.15;
    if (Number(fp.length_words) >= 15) score += 0.2;
    if (score > 0) {
      dimensions.clarity = clamp01(Math.min(score + 0.12, 0.92));
    }
  }

  if (dimensions.educational_value === 0 && Number(struct.paragraph_count) >= 2) {
    dimensions.educational_value = Number(struct.paragraph_count) >= 4 ? 0.58 : 0.42;
  }

  if (dimensions.evidence_strength === 0 && struct.has_lists === 1) {
    dimensions.evidence_strength = 0.38;
  }

  if (dimensions.engagement_potential === 0) {
    let e = 0;
    if (ts.uses_we === 1 || ts.uses_you === 1) e += 0.28;
    if (Number(lit.hashtags_count) > 0) e += 0.12;
    if (head.is_question === 1) e += 0.15;
    if (e > 0) {
      dimensions.engagement_potential = clamp01(e);
    }
  }

  if (dimensions.cta_strength === 0 && head.is_question === 1) {
    dimensions.cta_strength = 0.42;
  }

  if (dimensions.audience_relevance === 0) {
    const entities = asStringArray(post?.key_entities || publicationModel?.key_entities);
    if (entities.length >= 3) {
      dimensions.audience_relevance = 0.52;
    } else if (entities.length >= 1) {
      dimensions.audience_relevance = 0.36;
    }
  }

  if (dimensions.timeliness === 0) {
    const d = new Date(post?.datetime);
    if (Number.isFinite(d.getTime())) {
      dimensions.timeliness = 0.42;
    }
  }

  if (dimensions.brand_fit === 0) {
    const summaryText = asString(post?.summary || publicationModel?.summary);
    if (summaryText.length >= 40) {
      dimensions.brand_fit = 0.38;
    }
  }

  return dimensions;
}

function buildSpcjVector(dimensions) {
  return DEFAULT_SPCJ_DIMENSIONS.map((key) => clamp01(dimensions[key]));
}

function normalizeKpiEstimate(kpiEstimate = {}, post) {
  return {
    expected_engagement_rate: clamp01(
      kpiEstimate.expected_engagement_rate ?? post?.engagement_rate ?? 0
    ),
    expected_conversion_potential: clamp01(kpiEstimate.expected_conversion_potential),
    expected_lead_generation_potential: clamp01(kpiEstimate.expected_lead_generation_potential),
    expected_reach_potential: clamp01(kpiEstimate.expected_reach_potential)
  };
}

function buildPublicationId(competitor, post, index) {
  return (
    asNullableString(post?.publication_model?.publication_id) ||
    asNullableString(post?.publication_id) ||
    asNullableString(post?.url) ||
    `${competitor?.competitor_id || 'competitor'}_post_${index + 1}`
  );
}

export function normalizePublicationModel(post, competitor = {}, index = 0) {
  const publicationModel = post?.publication_model || {};
  const dimensions = buildSpcjDimensions(post);

  return {
    publication_id: buildPublicationId(competitor, post, index),
    source_type: 'competitor_post',
    platform: asNullableString(publicationModel.platform) || asNullableString(competitor.platform),
    type: inferContentType(post),
    topic: asNullableString(publicationModel.topic) || asNullableString(post?.topic) || 'unspecified',
    audience_segments: asStringArray(publicationModel.audience_segments || post?.target_audience),
    format: asNullableString(publicationModel.format) || inferPostFormat(post),
    content_category:
      asNullableString(publicationModel.content_category) ||
      asNullableString(post?.content_category) ||
      'other',
    tone: inferTone(post),
    funnel_stage: asNullableString(publicationModel.funnel_stage) || 'unknown',
    objective: inferObjective(post),
    summary: asNullableString(publicationModel.summary) || asNullableString(post?.summary),
    key_entities: asStringArray(publicationModel.key_entities || post?.key_entities),
    metrics_snapshot: {
      likes: asNumberOrNull(post?.metrics?.likes) ?? 0,
      comments: asNumberOrNull(post?.metrics?.comments) ?? 0,
      shares: asNumberOrNull(post?.metrics?.shares) ?? 0,
      views: asNumberOrNull(post?.metrics?.views) ?? 0,
      engagement_rate: clamp01(post?.engagement_rate ?? 0),
      metrics_quality: inferMetricsQualitySnapshot(post)
    },
    kpi_estimate: normalizeKpiEstimate(publicationModel.kpi_estimate, post),
    spcj: {
      scale: '0..1',
      dimensions,
      vector: buildSpcjVector(dimensions)
    }
  };
}

const MIN_OBSERVATION_SPAN_MS = 7 * 24 * 60 * 60 * 1000;

function calculatePostingFrequencyPerWeek(posts = []) {
  const datedPosts = posts
    .map((post) => new Date(post.datetime))
    .filter((date) => Number.isFinite(date.getTime()))
    .sort((a, b) => a - b);

  if (datedPosts.length < 2) {
    return datedPosts.length ? datedPosts.length : 0;
  }

  const first = datedPosts[0];
  const last = datedPosts[datedPosts.length - 1];
  // Не оцениваем частоту по окну короче недели — иначе снимок «все посты за день» даёт завышение.
  const diffMs = Math.max(last - first, MIN_OBSERVATION_SPAN_MS);
  const diffWeeks = diffMs / MIN_OBSERVATION_SPAN_MS;
  return Number((datedPosts.length / diffWeeks).toFixed(2));
}

function derivePlanningHorizonDaysFromPosts(posts = []) {
  const dates = posts
    .map((post) => new Date(post?.datetime))
    .filter((date) => Number.isFinite(date.getTime()))
    .sort((a, b) => a - b);
  if (dates.length < 2) {
    return null;
  }
  const spanMs = dates[dates.length - 1] - dates[0];
  return Math.max(1, Math.round(spanMs / 86400000) + 1);
}

function buildContentPlanItems(posts = []) {
  return posts.map((post, index) => ({
    publication_id:
      asNullableString(post?.publication_model?.publication_id) ||
      asNullableString(post?.url) ||
      `publication_${index + 1}`,
    planned_at: asNullableString(post?.datetime),
    topic:
      asNullableString(post?.publication_model?.topic) || asNullableString(post?.topic) || 'unspecified',
    format: asNullableString(post?.publication_model?.format) || inferPostFormat(post),
    objective: asNullableString(post?.publication_model?.objective) || 'inform',
    quality_score: clamp01(
      post?.publication_model?.spcj?.dimensions?.clarity ??
        post?.publication_model?.kpi_estimate?.expected_engagement_rate ??
        post?.engagement_rate ??
        0
    )
  }));
}

function getMostFrequentValue(values = [], fallback = null) {
  const counts = new Map();

  values.filter(Boolean).forEach((value) => {
    counts.set(value, (counts.get(value) || 0) + 1);
  });

  if (!counts.size) {
    return fallback;
  }

  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0][0];
}

function getTopFrequentValues(values = [], limit = 3) {
  const counts = new Map();

  values.filter(Boolean).forEach((value) => {
    counts.set(value, (counts.get(value) || 0) + 1);
  });

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([value]) => value);
}

function formatPostingFrequencyLabel(value) {
  if (!Number.isFinite(value) || value <= 0) {
    return 'unknown';
  }
  if (value < 1) {
    return 'реже 1 раза в неделю';
  }
  if (value <= 2) {
    return '1-2 в неделю';
  }
  if (value <= 4) {
    return '3-4 в неделю';
  }
  return '5+ в неделю';
}

function buildContentStrategy(competitor = {}, posts = []) {
  const existing = competitor?.content_strategy || {};
  const postingFrequencyPerWeek = calculatePostingFrequencyPerWeek(posts);
  const readabilityValues = posts
    .map((post) => asNumberOrNull(post?.analysis?.structure?.readability))
    .filter((value) => value !== null);
  const topicWithScores = posts
    .map((post) => ({
      topic: asNullableString(post?.publication_model?.topic) || asNullableString(post?.topic),
      engagementRate: Number(post?.engagement_rate) || 0
    }))
    .filter((item) => item.topic);

  const bestPerformingTopic = topicWithScores.length
    ? topicWithScores.sort((a, b) => b.engagementRate - a.engagementRate)[0].topic
    : null;

  return {
    posting_frequency:
      asNullableString(existing.posting_frequency) || formatPostingFrequencyLabel(postingFrequencyPerWeek),
    dominant_tone:
      asNullableString(existing.dominant_tone) ||
      getMostFrequentValue(posts.map((post) => post?.publication_model?.tone || post?.tone), 'neutral'),
    best_performing_topic:
      asNullableString(existing.best_performing_topic) || bestPerformingTopic || 'unspecified',
    avg_readability:
      asNumberOrNull(existing.avg_readability) ??
      (readabilityValues.length
        ? Number(
            (
              readabilityValues.reduce((sum, value) => sum + value, 0) / readabilityValues.length
            ).toFixed(2)
          )
        : null),
    dominant_formats:
      asStringArray(existing.dominant_formats).length > 0
        ? asStringArray(existing.dominant_formats)
        : getTopFrequentValues(posts.map((post) => post?.publication_model?.format), 3),
    core_audience_segments:
      asStringArray(existing.core_audience_segments).length > 0
        ? asStringArray(existing.core_audience_segments)
        : getTopFrequentValues(
            posts.flatMap((post) => post?.publication_model?.audience_segments || post?.target_audience || []),
            5
          ),
    main_objectives:
      asStringArray(existing.main_objectives).length > 0
        ? asStringArray(existing.main_objectives)
        : getTopFrequentValues(posts.map((post) => post?.publication_model?.objective || post?.objective), 4)
  };
}

export function normalizeContentPlanModel(competitor = {}) {
  const posts = Array.isArray(competitor.posts) ? competitor.posts : [];
  const contentPlanModel = competitor.content_plan_model || {};

  return {
    plan_id:
      asNullableString(contentPlanModel.plan_id) ||
      `${competitor.competitor_id || 'competitor'}_observed_content_plan`,
    plan_type: 'observed_competitor_content_plan',
    platform: asNullableString(contentPlanModel.platform) || asNullableString(competitor.platform),
    audience_segments: asStringArray(contentPlanModel.audience_segments),
    planning_horizon_days:
      asNumberOrNull(contentPlanModel.planning_horizon_days) ||
      derivePlanningHorizonDaysFromPosts(posts) ||
      30,
    posting_frequency_per_week:
      asNumberOrNull(contentPlanModel.posting_frequency_per_week) ||
      calculatePostingFrequencyPerWeek(posts),
    total_publications: posts.length,
    kpi_estimate: {
      avg_engagement_rate:
        asNumberOrNull(contentPlanModel?.kpi_estimate?.avg_engagement_rate) ??
        clamp01(
          posts.length
            ? posts.reduce((sum, post) => sum + (Number(post.engagement_rate) || 0), 0) / posts.length
            : 0
        ),
      best_engagement_rate:
        asNumberOrNull(contentPlanModel?.kpi_estimate?.best_engagement_rate) ??
        clamp01(
          posts.reduce((max, post) => Math.max(max, Number(post.engagement_rate) || 0), 0)
        ),
      estimated_conversion_potential: clamp01(
        contentPlanModel?.kpi_estimate?.estimated_conversion_potential
      )
    },
    publication_schedule: buildContentPlanItems(posts)
  };
}

export function normalizeCompetitorsContentData(competitorsData) {
  if (!competitorsData || typeof competitorsData !== 'object') {
    return competitorsData;
  }

  const cloned = JSON.parse(JSON.stringify(competitorsData));

  if (!Array.isArray(cloned.competitors)) {
    return cloned;
  }

  cloned.competitors = cloned.competitors.map((competitor) => {
    const posts = Array.isArray(competitor.posts) ? competitor.posts : [];
    const normalizedPosts = posts.map((post, index) => {
      const publicationModel = normalizePublicationModel(post, competitor, index);

      return {
        ...post,
        content_category: publicationModel.content_category,
        tone: publicationModel.tone,
        topic: publicationModel.topic,
        target_audience: publicationModel.audience_segments,
        publication_model: publicationModel
      };
    });

    return {
      ...competitor,
      posts: normalizedPosts,
      content_strategy: buildContentStrategy(
        {
          ...competitor,
          posts: normalizedPosts
        },
        normalizedPosts
      ),
      content_plan_model: normalizeContentPlanModel({
        ...competitor,
        posts: normalizedPosts
      })
    };
  });

  return cloned;
}

export const CONTENT_MODEL_SPEC = {
  publication_model: {
    required_fields: [
      'publication_id',
      'source_type',
      'platform',
      'type',
      'topic',
      'audience_segments',
      'format',
      'content_category',
      'tone',
      'objective',
      'kpi_estimate',
      'spcj'
    ],
    spcj_dimensions: DEFAULT_SPCJ_DIMENSIONS
  },
  content_plan_model: {
    required_fields: [
      'plan_id',
      'plan_type',
      'platform',
      'planning_horizon_days',
      'posting_frequency_per_week',
      'total_publications',
      'kpi_estimate',
      'publication_schedule'
    ]
  }
};
