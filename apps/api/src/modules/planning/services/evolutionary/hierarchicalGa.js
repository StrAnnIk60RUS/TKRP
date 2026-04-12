import { optimizeContentPlanEvolution, sanitizePlanPublicationsBodies } from './planEvolution.js';
import { fillPlanWithBestPublication, optimizePublicationsEvolution } from './postEvolution.js';
import { buildPlanFeatureMap } from '../../../ml/services/ml/ontologyFeatureEngineering.js';
import { predictContentPlanMetrics } from '../../../ml/services/relevancePredictionService.js';
import { normalizePlanPublicationsFields } from '../../routes/shared/planUtils.js';
import {
  applyPlanDiversityLlmRewrite,
  shouldRunPlanDiversityLlmRewrite
} from '../planDiversityLlmPass.js';

function asNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function validateOptimizationInputs(draft, stage1Config = {}) {
  const durationDays =
    asNumber(stage1Config?.constraints?.duration_days, 0) ||
    asNumber(draft?.planning_horizon?.duration_days, 0);
  const postsPerWeek = asNumber(stage1Config?.constraints?.posts_per_week, 0);

  console.log('[GA:input]', JSON.stringify({
    duration_days: durationDays,
    posts_per_week: postsPerWeek,
    min_publications: stage1Config?.constraints?.min_publications ?? null,
    date_min: stage1Config?.constraints?.date_min ?? null,
    date_max: stage1Config?.constraints?.date_max ?? null
  }));

  if (durationDays <= 0) {
    throw new Error('Для эволюции контент-плана требуется положительная длительность плана (duration_days).');
  }
  if (postsPerWeek <= 0) {
    throw new Error('Для эволюции контент-плана требуется posts_per_week > 0. Проверьте форму и demo-настройки.');
  }
}

function pickPositiveInt(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

function isoDateSlice(value) {
  if (value == null || value === '') return '';
  return String(value).slice(0, 10);
}

/**
 * Проверка итогового плана после эволюции. Сообщения — на русском для UI.
 * Правила: минимум публикаций; даты в горизонте (если есть planned_date);
 * платформа каждой публикации входит в plan.platforms.
 */
function validatePlanConstraints(plan, constraints = {}) {
  const publications = Array.isArray(plan?.publications) ? plan.publications : [];
  const messages = [];

  const minRequired =
    pickPositiveInt(constraints.min_publications) ?? pickPositiveInt(plan?.constraints?.min_publications);

  if (minRequired != null && publications.length < minRequired) {
    messages.push(
      `Минимум публикаций: требуется не менее ${minRequired}, в плане сейчас ${publications.length}.`
    );
  }

  const horizonStart = isoDateSlice(constraints.date_min ?? plan?.planning_horizon?.start_date);
  const horizonEnd = isoDateSlice(constraints.date_max ?? plan?.planning_horizon?.end_date);

  if (horizonStart && horizonEnd) {
    const dated = publications.filter((p) => p?.planned_date);
    if (dated.length > 0) {
      let outOfRange = 0;
      for (const p of dated) {
        const d = isoDateSlice(p.planned_date);
        if (!d || d < horizonStart || d > horizonEnd) outOfRange += 1;
      }
      if (outOfRange > 0) {
        messages.push(
          `Даты публикаций: ${outOfRange} из ${dated.length} с датой выходят за период плана (${horizonStart} — ${horizonEnd}).`
        );
      }
    }
  }

  const allowed = new Set(
    (Array.isArray(plan?.platforms) ? plan.platforms : [])
      .map((p) => String(p || '').trim().toLowerCase())
      .filter(Boolean)
  );
  if (allowed.size > 0) {
    const bad = publications.filter(
      (p) => p?.platform && !allowed.has(String(p.platform).trim().toLowerCase())
    );
    if (bad.length > 0) {
      messages.push(
        `Платформы: у ${bad.length} публикаций указана платформа вне списка плана (${[...allowed].join(', ')}).`
      );
    }
  }

  return {
    valid: messages.length === 0,
    messages,
    errors: messages,
    total_cost: null
  };
}

export async function runHierarchicalOptimization(payload = {}) {
  const draft = payload?.draft_content_plan || payload?.draftContentPlan || null;
  if (!draft || typeof draft !== 'object') {
    throw new Error('Отсутствует draft_content_plan');
  }

  const stage1Config = payload?.stage1 || {};
  const stage2Config = payload?.stage2 || {};
  const stage3Config = payload?.stage3 && typeof payload.stage3 === 'object' ? payload.stage3 : {};
  const lockedFields = payload?.locked_fields || {};
  
  validateOptimizationInputs(draft, stage1Config);
  
  // Stage 1: эволюция структуры плана
  const contentPlanResult = await optimizeContentPlanEvolution(draft, {
    ...stage1Config,
    lockedFields
  });
  
  // Подготовка lockedFields для stage2 на основе результатов stage1
  const planFeatureMap = contentPlanResult.planFeatureMap;
  const stage2LockedFields = {
    ...lockedFields,
    // Если в lockedFields не указано иное, берём из результатов эволюции плана
    has_cta: lockedFields.has_cta !== undefined ? lockedFields.has_cta : null,
    targetToneIndex: lockedFields.targetToneIndex !== undefined ? lockedFields.targetToneIndex : null,
    targetCtaShare: planFeatureMap.cta_share,
    targetAvgCreativity: planFeatureMap.avg_creativity,
    targetUniqueTones: planFeatureMap.unique_tones
  };
  
  // Stage 2: эволюция признаков каждого поста
  const postResult = await optimizePublicationsEvolution(
    contentPlanResult.optimizedPlan.publications,
    contentPlanResult.planFeatureMap,
    {
      ...stage2Config,
      lockedFields: stage2LockedFields
    }
  );
  
  // Заполнение плана лучшими постами с распределением CTA по приоритету
  const filledPlanResult = await fillPlanWithBestPublication(
    contentPlanResult.optimizedPlan.publications,
    postResult.publicationResults,
    contentPlanResult.planFeatureMap,
    {
      ...(stage2Config.ga || stage2Config),
      targetCtaShare: planFeatureMap.cta_share
    }
  );

  let publicationsAfterRewrite = filledPlanResult.publications;
  let stage3LlmMeta = {
    llm_diversity_rewrite: false,
    skipped: true,
    reason: 'not_requested'
  };

  if (shouldRunPlanDiversityLlmRewrite(payload, stage3Config)) {
    try {
      const rewriteResult = await applyPlanDiversityLlmRewrite(
        {
          plan_id: draft?.plan_id || contentPlanResult.optimizedPlan?.plan_id || null,
          content_profile: draft?.content_profile || contentPlanResult.optimizedPlan?.content_profile || null,
          publications: publicationsAfterRewrite
        },
        stage3Config
      );
      publicationsAfterRewrite = rewriteResult.publications;
      stage3LlmMeta = {
        llm_diversity_rewrite: true,
        skipped: Boolean(rewriteResult.meta?.skipped),
        reason: rewriteResult.meta?.reason || null,
        usage: rewriteResult.meta?.usage || null
      };
    } catch (err) {
      stage3LlmMeta = {
        llm_diversity_rewrite: true,
        skipped: true,
        reason: 'error',
        error: String(err?.message || err)
      };
    }
  }

  const normalizedPublications = normalizePlanPublicationsFields(publicationsAfterRewrite);
  const bodySanitizedPublications = sanitizePlanPublicationsBodies(normalizedPublications);

  // Финальные метаданные плана
  const finalPlanFeatureMap = buildPlanFeatureMap(bodySanitizedPublications, {
    durationDays: contentPlanResult.optimizedPlan?.planning_horizon?.duration_days,
    expectedPlatforms: contentPlanResult.optimizedPlan?.platforms || draft?.platforms || [],
    targetAudience: contentPlanResult.optimizedPlan?.target_audience || draft?.target_audience || []
  });
  
  // Финальное предсказание метрик плана (используем новую multi-output функцию)
  const finalPlanPrediction = await predictContentPlanMetrics(
    {
      ...contentPlanResult.optimizedPlan,
      publications: bodySanitizedPublications
    },
    {
      forceTrain: false,
      expectedPlatforms: contentPlanResult.optimizedPlan?.platforms || draft?.platforms || [],
      targetAudience: contentPlanResult.optimizedPlan?.target_audience || draft?.target_audience || []
    }
  );

  const rawFinalLikes = finalPlanPrediction?.predictedLikes;
  const rawFinalShares = finalPlanPrediction?.predictedShares;
  const rawFinalViews = finalPlanPrediction?.predictedViews;
  const numericFinalLikes = Number(rawFinalLikes);
  const numericFinalShares = Number(rawFinalShares);
  const numericFinalViews = Number(rawFinalViews);
  const safeFinalPredictedLikes = Number.isFinite(numericFinalLikes) ? numericFinalLikes : null;
  const safeFinalPredictedShares = Number.isFinite(numericFinalShares) ? numericFinalShares : null;
  const safeFinalPredictedViews = Number.isFinite(numericFinalViews) ? numericFinalViews : null;

  const optimizedContentPlan = {
    ...contentPlanResult.optimizedPlan,
    publications: bodySanitizedPublications,
    expected_kpi: {
      ...(contentPlanResult.optimizedPlan.expected_kpi || {}),
      predicted_total_likes: safeFinalPredictedLikes,
      predicted_total_shares: safeFinalPredictedShares,
      predicted_total_views: safeFinalPredictedViews,
      predicted_total_likes_source: 'ml_content_plan_metrics_model_final'
    },
    plan_features: finalPlanFeatureMap
  };

  return {
    stage1: {
      phase: 'content_plan_evolution',
      predicted_total_likes: contentPlanResult.predictedLikes,
      predicted_total_shares: contentPlanResult.predictedShares,
      predicted_total_views: contentPlanResult.predictedViews,
      target_posts_count: contentPlanResult.planFeatureMap.posts_count,
      plan_features: contentPlanResult.planFeatureMap,
      ga: {
        best_score: contentPlanResult.ga.best_score,
        best_meta: contentPlanResult.ga.best_meta || null,
        generations: contentPlanResult.ga.generations,
        stop_reason: contentPlanResult.ga.stop_reason,
        history: contentPlanResult.ga.history
      }
    },
    stage3: {
      phase: 'plan_text_diversity_llm',
      ...stage3LlmMeta
    },
    stage2: {
      phase: 'post_evolution',
      predicted_total_likes: safeFinalPredictedLikes,
      predicted_total_shares: safeFinalPredictedShares,
      predicted_total_views: safeFinalPredictedViews,
      f_kp: safeFinalPredictedLikes,
      best_post: postResult.bestPublication,
      archetypes: postResult.archetypes,
      cta_distribution: {
        target_share: finalPlanFeatureMap.cta_share,
        target_count: filledPlanResult.ctaTargetCount,
        assigned_count: filledPlanResult.ctaAssignedCount
      },
      publications: postResult.publicationResults.map((item) => ({
        publication_id: item.optimizedPublication?.publication_id || null,
        predicted_likes: item.predictedLikes,
        predicted_shares: item.predictedShares,
        predicted_views: item.predictedViews,
        fitness: item.fitness,
        ga: {
          best_score: item.ga.best_score,
          best_meta: item.ga.best_meta || null,
          generations: item.ga.generations,
          stop_reason: item.ga.stop_reason,
          history: item.ga.history
        }
      })),
      constraints_check: validatePlanConstraints(optimizedContentPlan, stage1Config.constraints || {})
    },
    optimized_publications: bodySanitizedPublications,
    best_publication: postResult.bestPublication,
    optimized_content_plan: optimizedContentPlan
  };
}