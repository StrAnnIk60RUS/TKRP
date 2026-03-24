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
  'duration_days'
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

function getSpcj(source = {}) {
  return source.publication_model?.spcj?.dimensions || source.spcj?.dimensions || {};
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
  const postFeatureMaps = posts.map((item) => buildPostFeatureMap(item));
  const startDate = options.startDate ? new Date(options.startDate) : null;
  const endDate = options.endDate ? new Date(options.endDate) : null;
  const explicitDuration = Number(options.durationDays || options.planningHorizonDays);
  const derivedDuration =
    startDate instanceof Date &&
    Number.isFinite(startDate.getTime()) &&
    endDate instanceof Date &&
    Number.isFinite(endDate.getTime())
      ? Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / 86400000) + 1)
      : null;

  return {
    unique_topics: topics.length,
    unique_tones: tones.length || 1,
    avg_creativity: clamp01(average(postFeatureMaps.map((item) => item.creativity))),
    cta_share: clamp01(average(postFeatureMaps.map((item) => item.has_cta))),
    posts_count: posts.length,
    duration_days: clampPositive(explicitDuration || derivedDuration || posts.length || 1, 1)
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

function groupSnapshotByCompetitor(snapshot = {}) {
  const groups = new Map();
  const ensureGroup = (key) => {
    if (!groups.has(key)) groups.set(key, { publications: [], contentPlan: null });
    return groups.get(key);
  };

  (snapshot.publications || []).forEach((publication) => {
    const key = publication.competitor_id || publication.competitor_name || publication.publication_id;
    ensureGroup(key).publications.push(publication);
  });

  (snapshot.content_plans || []).forEach((contentPlan) => {
    const key = contentPlan.competitor_id || contentPlan.competitor_name || contentPlan.plan_id;
    ensureGroup(key).contentPlan = contentPlan;
  });

  return groups;
}

export function buildMlTrainingDatasets(snapshot = {}) {
  const postFeatures = [];
  const postTargets = [];
  const planFeatures = [];
  const planTargets = [];
  const groups = groupSnapshotByCompetitor(snapshot);

  groups.forEach(({ publications, contentPlan }) => {
    if (!publications.length) return;
    const planModel = contentPlan?.content_plan_model || {};
    const planFeatureMap = buildPlanFeatureMap(publications, {
      durationDays: planModel.planning_horizon_days
    });
    const totalLikes = publications.reduce((sum, item) => sum + clampPositive(getPublicationLikes(item), 0), 0);

    planFeatures.push(PLAN_FEATURE_NAMES.map((name) => planFeatureMap[name] ?? 0));
    planTargets.push(totalLikes);

    publications.forEach((publication) => {
      const likes = getPublicationLikes(publication);
      if (!Number.isFinite(likes)) return;
      const featureVector = buildPostFeatureVector(publication, {
        tonesCount: planFeatureMap.unique_tones,
        creativityFromBestPlan: planFeatureMap.avg_creativity
      });
      postFeatures.push(featureVector);
      postTargets.push(clampPositive(likes, 0));
    });
  });

  return {
    postDataset: {
      featureNames: POST_FEATURE_NAMES,
      features: postFeatures,
      targets: postTargets
    },
    contentPlanDataset: {
      featureNames: PLAN_FEATURE_NAMES,
      features: planFeatures,
      targets: planTargets
    }
  };
}
