import {
  average,
  clamp01,
  clampPositive,
  countWords,
  detectConclusion,
  detectCta,
  detectDigit,
  detectEmphasis,
  detectEvidence,
  detectFormattingLists,
  detectIntrigue,
  detectQuestion,
  detectTechQuality,
  estimateGrammarQuality,
  estimateSentenceLengthBucket,
  getLeadParagraph,
  getTitleLine,
  mapTernaryToUnit,
  normalizeByRange,
  pickFirstFinite,
  resolveToneFlags,
  safeNumber,
  splitParagraphs,
  tokenOverlapScore,
  uniqueValues
} from './featureEngineeringUtils.js';

export const POST_FEATURE_NAMES = [
  'paragraphs_exists',
  'paragraphs_count_norm',
  'sentence_length',
  'has_lists',
  'has_emphasis',
  'readability',
  'water_level',
  'title_length_norm',
  'title_has_question',
  'title_has_intrigue',
  'title_has_digit',
  'title_emotionality',
  'title_fits_notif',
  'lead_length_norm',
  'lead_is_hook',
  'lead_connected',
  'lead_introduces',
  'has_main_idea',
  'idea_clarity',
  'is_complete',
  'has_cta',
  'uniqueness',
  'evidence_level',
  'creativity',
  'tone_onehot_0',
  'tone_onehot_1',
  'tone_onehot_2',
  'tone_onehot_3',
  'tone_onehot_4',
  'terminology_level',
  'emotionality',
  'grammar_quality',
  'tech_quality',
  'has_conclusion',
  'tones_count',
  'creativity_from_best_plan'
];

export const PLAN_FEATURE_NAMES = [
  'unique_topics',
  'unique_tones',
  'avg_creativity',
  'cta_share',
  'posts_count',
  'duration_days',
  'format_entropy',
  'objective_entropy',
  'audience_coverage',
  'platform_coverage',
  'topic_recurrence',
  'timeline_density'
];

function getSourceText(source = {}) {
  return (
    source.raw_content ||
    source.content ||
    [source.title, source.summary, source.key_message, source.cta].filter(Boolean).join('\n\n')
  );
}

function getSourceTone(source = {}) {
  return source.tone || source.publication_model?.tone || source.content_strategy_snapshot?.dominant_tone || '';
}

function getSourceFormat(source = {}) {
  return source.format || source.publication_model?.format || '';
}

function getSourceObjective(source = {}) {
  return source.objective || source.publication_model?.objective || '';
}

function getSourcePlatform(source = {}) {
  return source.platform || source.publication_model?.platform || '';
}

function getSourceAudienceSegments(source = {}) {
  const direct = Array.isArray(source.audience_segments) ? source.audience_segments : [];
  const nested = Array.isArray(source.publication_model?.audience_segments) ? source.publication_model.audience_segments : [];
  const legacy = Array.isArray(source.target_audience) ? source.target_audience : [];
  return uniqueValues([...direct, ...nested, ...legacy].filter(Boolean));
}

function getSpcj(source = {}) {
  return source.publication_model?.spcj?.dimensions || source.spcj?.dimensions || {};
}

function normalizeKey(value) {
  return String(value || '').trim().toLowerCase();
}

function buildFrequencyMap(values = []) {
  return values.reduce((acc, value) => {
    const key = normalizeKey(value);
    if (!key) return acc;
    acc.set(key, (acc.get(key) || 0) + 1);
    return acc;
  }, new Map());
}

function calculateNormalizedEntropy(values = []) {
  const frequency = Array.from(buildFrequencyMap(values).values());
  if (frequency.length <= 1) return 0;
  const total = frequency.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return 0;
  const entropy = frequency.reduce((sum, count) => {
    const probability = count / total;
    return probability > 0 ? sum - (probability * Math.log2(probability)) : sum;
  }, 0);
  return clamp01(entropy / Math.log2(frequency.length));
}

function parsePlanDate(source = {}) {
  const candidate = source.planned_date || source.planned_at || source.publication_model?.planned_at || null;
  if (!candidate || typeof candidate !== 'string') return null;
  const parsed = new Date(candidate);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function buildCreativityScore(title, lead, text, spcj = {}) {
  const intrigue = detectIntrigue(title) || detectIntrigue(lead);
  const evidence = detectEvidence(text);
  const novelty = clamp01((safeNumber(spcj.timeliness, 0.5) + safeNumber(spcj.educational_value, 0.5)) / 2);
  const expressiveness = detectEmphasis(text) ? 0.75 : 0.25;
  return clamp01(0.35 * intrigue + 0.25 * evidence + 0.25 * novelty + 0.15 * expressiveness);
}

export function buildPostFeatureMap(source = {}, options = {}) {
  const explicitOntologyFeatures =
    source?.ontology_features && typeof source.ontology_features === 'object' ? source.ontology_features : null;
  const text = getSourceText(source);
  const title = getTitleLine(text, source.topic || source.title || source.publication_model?.topic || '');
  const lead = getLeadParagraph(text, source.summary || source.key_message || '');
  const paragraphs = splitParagraphs(text);
  const spcj = getSpcj(source);
  const toneFlags = resolveToneFlags(getSourceTone(source));
  const readability = clamp01(pickFirstFinite(spcj.clarity, spcj.educational_value, 0.7));
  const titleEmotionality = clamp01(detectEmphasis(title) ? 0.75 : 0.25);
  const emotionality = clamp01(detectEmphasis(text) ? 0.75 : 0.4);
  const creativity = buildCreativityScore(title, lead, text, spcj);
  const hasConclusion = detectConclusion(text) || (paragraphs.length > 2 ? 1 : 0);
  const tonesCount = clampPositive(options.tonesCount ?? options.planUniqueTones ?? 1, 1);
  const creativityFromBestPlan = clamp01(options.creativityFromBestPlan ?? options.planAvgCreativity ?? creativity);

  const computedFeatures = {
    paragraphs_exists: paragraphs.length > 1 ? 1 : 0,
    paragraphs_count_norm: clamp01(normalizeByRange(paragraphs.length, 1, 5)),
    sentence_length: estimateSentenceLengthBucket(text),
    has_lists: detectFormattingLists(text),
    has_emphasis: detectEmphasis(text),
    readability,
    water_level: clamp01(1 - safeNumber(spcj.educational_value, 0.5) * 0.5),
    title_length_norm: clamp01(normalizeByRange(countWords(title), 3, 10)),
    title_has_question: detectQuestion(title),
    title_has_intrigue: detectIntrigue(title),
    title_has_digit: detectDigit(title),
    title_emotionality: titleEmotionality,
    title_fits_notif: title.length > 0 && title.length <= 60 ? 1 : 0,
    lead_length_norm: clamp01(normalizeByRange(countWords(lead), 20, 60)),
    lead_is_hook: detectIntrigue(lead) || detectQuestion(lead) || detectDigit(lead),
    lead_connected: tokenOverlapScore(title, lead) >= 0.2 ? 1 : 0,
    lead_introduces: tokenOverlapScore(title, lead) >= 0.35 ? 1 : tokenOverlapScore(title, lead) >= 0.15 ? 0.5 : 0,
    has_main_idea: source.topic || source.publication_model?.summary || lead ? 1 : 0,
    idea_clarity: readability,
    is_complete: hasConclusion ? 1 : clamp01(safeNumber(spcj.clarity, 0.5)),
    has_cta: detectCta(text) || (safeNumber(spcj.cta_strength, 0) >= 0.5 ? 1 : 0),
    uniqueness: clamp01((safeNumber(spcj.timeliness, 0.5) + creativity) / 2),
    evidence_level: clamp01(Math.max(detectEvidence(text), safeNumber(spcj.evidence_strength, 0.4))),
    creativity,
    tone_onehot_0: toneFlags.expert,
    tone_onehot_1: toneFlags.friendly,
    tone_onehot_2: toneFlags.official,
    tone_onehot_3: toneFlags.inspiring,
    tone_onehot_4: toneFlags.humorous,
    terminology_level: clamp01(safeNumber(spcj.brand_fit, 0.5)),
    emotionality,
    grammar_quality: estimateGrammarQuality(text),
    tech_quality: detectTechQuality(text),
    has_conclusion: hasConclusion ? 1 : 0,
    tones_count: tonesCount,
    creativity_from_best_plan: creativityFromBestPlan
  };

  if (!explicitOntologyFeatures) {
    return computedFeatures;
  }

  const merged = {
    ...computedFeatures,
    ...explicitOntologyFeatures,
    tones_count: tonesCount,
    creativity_from_best_plan: creativityFromBestPlan
  };

  return POST_FEATURE_NAMES.reduce((acc, name) => {
    acc[name] = merged[name] ?? 0;
    return acc;
  }, {});
}

export function buildPostFeatureVector(source = {}, options = {}) {
  const featureMap = buildPostFeatureMap(source, options);
  return POST_FEATURE_NAMES.map((name) => featureMap[name] ?? 0);
}

export function buildPostFeatureVectorFromFeatureMap(featureMap = {}) {
  return POST_FEATURE_NAMES.map((name) => featureMap[name] ?? 0);
}

export function buildPlanFeatureMap(publications = [], options = {}) {
  const posts = Array.isArray(publications) ? publications : [];
  const topics = uniqueValues(posts.map((item) => item.topic || item.publication_model?.topic || null));
  const tones = uniqueValues(posts.map((item) => getSourceTone(item) || null));
  const formats = posts.map((item) => getSourceFormat(item));
  const objectives = posts.map((item) => getSourceObjective(item));
  const audiences = uniqueValues(posts.flatMap((item) => getSourceAudienceSegments(item)));
  const platforms = uniqueValues(posts.map((item) => getSourcePlatform(item) || null));
  const postFeatureMaps = posts.map((item) => buildPostFeatureMap(item));
  const startDate = options.startDate ? new Date(options.startDate) : null;
  const endDate = options.endDate ? new Date(options.endDate) : null;
  const explicitDuration = Number(options.durationDays || options.planningHorizonDays);
  const expectedPlatforms = uniqueValues(
    (Array.isArray(options.expectedPlatforms) ? options.expectedPlatforms : []).map((value) => normalizeKey(value))
  );
  const expectedAudience = uniqueValues(
    (Array.isArray(options.targetAudience) ? options.targetAudience : []).map((value) => normalizeKey(value))
  );
  const derivedDuration =
    startDate instanceof Date &&
    Number.isFinite(startDate.getTime()) &&
    endDate instanceof Date &&
    Number.isFinite(endDate.getTime())
      ? Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / 86400000) + 1)
      : null;
  const durationDays = clampPositive(explicitDuration || derivedDuration || posts.length || 1, 1);
  const topicCounts = Array.from(buildFrequencyMap(posts.map((item) => item.topic || item.publication_model?.topic)).values());
  const repeatedTopics = topicCounts.reduce((sum, count) => sum + Math.max(0, count - 1), 0);
  const datedPosts = uniqueValues(
    posts
      .map((item) => {
        const date = parsePlanDate(item);
        return date ? date.toISOString().slice(0, 10) : null;
      })
      .filter(Boolean)
  );
  const audienceCoverage =
    expectedAudience.length > 0
      ? clamp01(
          expectedAudience.filter((segment) => audiences.map((value) => normalizeKey(value)).includes(segment)).length /
            expectedAudience.length
        )
      : clamp01(audiences.length / Math.max(1, posts.length || 1));
  const platformCoverage =
    expectedPlatforms.length > 0
      ? clamp01(
          expectedPlatforms.filter((platform) => platforms.map((value) => normalizeKey(value)).includes(platform)).length /
            expectedPlatforms.length
        )
      : clamp01(platforms.length / Math.max(1, Math.min(3, posts.length || 1)));

  return {
    unique_topics: topics.length,
    unique_tones: Math.max(1, Math.min(5, tones.length || 1)),
    avg_creativity: clamp01(average(postFeatureMaps.map((item) => item.creativity))),
    cta_share: clamp01(average(postFeatureMaps.map((item) => item.has_cta))),
    posts_count: posts.length,
    duration_days: durationDays,
    format_entropy: calculateNormalizedEntropy(formats),
    objective_entropy: calculateNormalizedEntropy(objectives),
    audience_coverage: audienceCoverage,
    platform_coverage: platformCoverage,
    topic_recurrence: posts.length > 0 ? clamp01(repeatedTopics / posts.length) : 0,
    timeline_density: clamp01(datedPosts.length / Math.max(1, durationDays))
  };
}

export function buildPlanFeatureVector(publications = [], options = {}) {
  const featureMap = buildPlanFeatureMap(publications, options);
  return PLAN_FEATURE_NAMES.map((name) => featureMap[name] ?? 0);
}

export function buildPlanFeatureVectorFromFeatureMap(featureMap = {}) {
  return PLAN_FEATURE_NAMES.map((name) => featureMap[name] ?? 0);
}

function getPublicationLikes(item = {}) {
  return pickFirstFinite(item.raw_metrics?.likes, item.publication_model?.metrics_snapshot?.likes, item.likes);
}

function groupSnapshotByContext(snapshot = {}) {
  const groups = new Map();
  const ensureGroup = (key) => {
    if (!groups.has(key)) groups.set(key, { publications: [], contentPlans: [] });
    return groups.get(key);
  };

  (snapshot.publications || []).forEach((publication) => {
    const key = [
      publication.competitor_id || publication.competitor_name || publication.publication_id,
      publication.platform || publication.publication_model?.platform || 'unknown'
    ].join('::');
    ensureGroup(key).publications.push(publication);
  });

  (snapshot.content_plans || []).forEach((contentPlan) => {
    const key = [
      contentPlan.competitor_id || contentPlan.competitor_name || contentPlan.plan_id,
      contentPlan.platform || contentPlan.content_plan_model?.platform || 'unknown'
    ].join('::');
    ensureGroup(key).contentPlans.push(contentPlan);
  });

  return groups;
}

function createPlanPublicationStub(scheduleItem = {}, contentPlan = {}, linkedPublication = null) {
  const linkedModel = linkedPublication?.publication_model || {};
  const planModel = contentPlan?.content_plan_model || {};
  return {
    ...linkedPublication,
    publication_model: linkedPublication?.publication_model || {
      publication_id: scheduleItem?.publication_id || null,
      topic: scheduleItem?.topic || linkedModel?.topic || null,
      format: scheduleItem?.format || linkedModel?.format || null,
      objective: scheduleItem?.objective || linkedModel?.objective || null,
      tone:
        linkedModel?.tone ||
        linkedPublication?.tone ||
        contentPlan?.content_strategy_snapshot?.dominant_tone ||
        'expert',
      audience_segments:
        linkedModel?.audience_segments ||
        planModel?.audience_segments ||
        contentPlan?.content_strategy_snapshot?.core_audience_segments ||
        [],
      platform: linkedModel?.platform || linkedPublication?.platform || contentPlan?.platform || null
    },
    topic: scheduleItem?.topic || linkedPublication?.topic || linkedModel?.topic || null,
    format: scheduleItem?.format || linkedPublication?.format || linkedModel?.format || null,
    objective: scheduleItem?.objective || linkedPublication?.objective || linkedModel?.objective || null,
    tone:
      linkedPublication?.tone ||
      linkedModel?.tone ||
      contentPlan?.content_strategy_snapshot?.dominant_tone ||
      'expert',
    platform: linkedPublication?.platform || linkedModel?.platform || contentPlan?.platform || null,
    planned_at: scheduleItem?.planned_at || null
  };
}

function estimatePlanTargetLikes(schedulePublications = [], contextPublications = [], contentPlan = {}) {
  const scheduleLikes = schedulePublications
    .map((item) => clampPositive(getPublicationLikes(item), 0))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (scheduleLikes.length > 0) {
    return scheduleLikes.reduce((sum, value) => sum + value, 0);
  }

  const contextLikes = contextPublications
    .map((item) => clampPositive(getPublicationLikes(item), 0))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (contextLikes.length > 0 && schedulePublications.length > 0) {
    return average(contextLikes) * schedulePublications.length;
  }

  const avgEngagement = clampPositive(contentPlan?.content_plan_model?.kpi_estimate?.avg_engagement_rate, 0);
  const scheduleSize = schedulePublications.length || contextPublications.length || 1;
  return avgEngagement * 100 * scheduleSize;
}

export function buildMlTrainingDatasets(snapshot = {}) {
  const postFeatures = [];
  const postTargets = [];      // Будет массивом [likes, shares, views]
  const planFeatures = [];
  const planTargets = [];      // Будет массивом [total_likes, total_shares, total_views]

  const groups = groupSnapshotByContext(snapshot);

  groups.forEach(({ publications, contentPlans }) => {
    if (!publications.length) return;
    
    const planFeatureMap = buildPlanFeatureMap(publications, {
      durationDays: null
    });

    // ========== СБОР ДЛЯ МОДЕЛИ ПОСТОВ ==========
    publications.forEach((publication) => {
      // Получаем метрики
      const rawMetrics = publication?.raw_metrics || {};
      const likes = clampPositive(rawMetrics.likes ?? 0);
      const shares = clampPositive(rawMetrics.shares ?? 0);
      const views = clampPositive(rawMetrics.views ?? 0);
      
      // Пропускаем если нет ни одной значимой метрики
      if (likes === 0 && shares === 0 && views === 0) return;
      
      const featureVector = buildPostFeatureVector(publication, {
        tonesCount: planFeatureMap.unique_tones,
        creativityFromBestPlan: planFeatureMap.avg_creativity
      });
      
      postFeatures.push(featureVector);
      // Таргет — массив из 3 значений
      postTargets.push([likes, shares, views]);
    });

    // ========== СБОР ДЛЯ МОДЕЛИ ПЛАНОВ ==========
    // Агрегируем метрики по всем публикациям конкурента
    const totalLikes = publications.reduce((sum, p) => sum + clampPositive(p?.raw_metrics?.likes ?? 0), 0);
    const totalShares = publications.reduce((sum, p) => sum + clampPositive(p?.raw_metrics?.shares ?? 0), 0);
    const totalViews = publications.reduce((sum, p) => sum + clampPositive(p?.raw_metrics?.views ?? 0), 0);
    
    if (totalLikes > 0 || totalShares > 0 || totalViews > 0) {
      const planFeatureVector = buildPlanFeatureVector(publications, {});
      planFeatures.push(planFeatureVector);
      planTargets.push([totalLikes, totalShares, totalViews]);
    }
  });

  // Если нет планов, создаём fallback
  if (planFeatures.length === 0) {
    groups.forEach(({ publications }) => {
      const totalLikes = publications.reduce((sum, p) => sum + clampPositive(p?.raw_metrics?.likes ?? 0), 0);
      const totalShares = publications.reduce((sum, p) => sum + clampPositive(p?.raw_metrics?.shares ?? 0), 0);
      const totalViews = publications.reduce((sum, p) => sum + clampPositive(p?.raw_metrics?.views ?? 0), 0);
      
      const fallbackPlanFeatureMap = buildPlanFeatureMap(publications, {});
      planFeatures.push(PLAN_FEATURE_NAMES.map((name) => fallbackPlanFeatureMap[name] ?? 0));
      planTargets.push([totalLikes, totalShares, totalViews]);
    });
  }

  return {
    postDataset: {
      featureNames: POST_FEATURE_NAMES,
      features: postFeatures,
      targets: postTargets,        // массив массивов [likes, shares, views]
      targetNames: ['likes', 'shares', 'views']
    },
    contentPlanDataset: {
      featureNames: PLAN_FEATURE_NAMES,
      features: planFeatures,
      targets: planTargets,        // массив массивов [total_likes, total_shares, total_views]
      targetNames: ['total_likes', 'total_shares', 'total_views']
    }
  };
}
