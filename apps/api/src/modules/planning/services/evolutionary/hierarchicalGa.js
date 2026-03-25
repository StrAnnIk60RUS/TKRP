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

function validatePlanConstraints(plan, constraints = {}) {
  const publications = Array.isArray(plan?.publications) ? plan.publications : [];
  const errors = [];

  if (constraints?.min_publications && publications.length < Number(constraints.min_publications)) {
    errors.push(`min_publications violated: have=${publications.length}, need>=${constraints.min_publications}`);
  }

  return {
    valid: errors.length === 0,
    errors,
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

  const optimizedContentPlan = {
    ...contentPlanResult.optimizedPlan,
    publications: filledPlanResult.publications,
    expected_kpi: {
      ...(contentPlanResult.optimizedPlan.expected_kpi || {}),
      predicted_total_likes: finalPlanPrediction.predictedLikes,
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

