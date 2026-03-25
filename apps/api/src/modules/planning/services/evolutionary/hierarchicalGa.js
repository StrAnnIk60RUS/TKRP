import { optimizeContentPlanEvolution } from './planEvolution.js';
import { fillPlanWithBestPublication, optimizePublicationsEvolution } from './postEvolution.js';
import { buildPlanFeatureMap } from '../../../ml/services/ml/ontologyFeatureEngineering.js';
import { predictContentPlanLikes } from '../../../ml/services/relevancePredictionService.js';

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
  validateOptimizationInputs(draft, stage1Config);
  const contentPlanResult = await optimizeContentPlanEvolution(draft, stage1Config);
  const postResult = await optimizePublicationsEvolution(
    contentPlanResult.optimizedPlan.publications,
    contentPlanResult.planFeatureMap,
    stage2Config
  );
  const filledPlanResult = await fillPlanWithBestPublication(
    contentPlanResult.optimizedPlan.publications,
    postResult.publicationResults,
    contentPlanResult.planFeatureMap,
    stage2Config.ga || stage2Config
  );
  const finalPlanFeatureMap = buildPlanFeatureMap(filledPlanResult.publications, {
    durationDays: contentPlanResult.optimizedPlan?.planning_horizon?.duration_days,
    expectedPlatforms: contentPlanResult.optimizedPlan?.platforms || draft?.platforms || [],
    targetAudience: contentPlanResult.optimizedPlan?.target_audience || draft?.target_audience || []
  });
  const finalPlanPrediction = await predictContentPlanLikes(
    {
      ...contentPlanResult.optimizedPlan,
      publications: filledPlanResult.publications
    },
    {
      forceTrain: false,
      expectedPlatforms: contentPlanResult.optimizedPlan?.platforms || draft?.platforms || [],
      targetAudience: contentPlanResult.optimizedPlan?.target_audience || draft?.target_audience || []
    }
  );

  const rawFinalLikes = finalPlanPrediction?.predictedLikes;
  const numericFinalLikes = Number(rawFinalLikes);
  const safeFinalPredicted = Number.isFinite(numericFinalLikes) ? numericFinalLikes : null;

  const optimizedContentPlan = {
    ...contentPlanResult.optimizedPlan,
    publications: filledPlanResult.publications,
    expected_kpi: {
      ...(contentPlanResult.optimizedPlan.expected_kpi || {}),
      predicted_total_likes: rawFinalLikes,
      predicted_total_likes_source: 'ml_content_plan_likes_model_final'
    },
    plan_features: finalPlanFeatureMap
  };

  return {
    stage1: {
      phase: 'content_plan_evolution',
      predicted_total_likes: contentPlanResult.predictedLikes,
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
    stage2: {
      phase: 'post_evolution',
      /** Итоговый ML-прогноз суммарных лайков по плану (после заполнения постов). Дублирует optimized_content_plan.expected_kpi.predicted_total_likes. */
      predicted_total_likes: safeFinalPredicted,
      /** Устаревшее имя метрики в UI; то же значение, что predicted_total_likes. */
      f_kp: safeFinalPredicted,
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
    optimized_publications: filledPlanResult.publications,
    best_publication: postResult.bestPublication,
    optimized_content_plan: optimizedContentPlan
  };
}

