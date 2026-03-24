export function buildExportPayload(formData, competitorsData, competitorsFileName) {
  const projectData = {
    producer_info: {
      name: formData.producerName.trim(),
      activity_specification: formData.producerActivitySpecification.trim()
    },
    it_project_info: {
      name: formData.projectName.trim(),
      description: formData.projectDescription.trim(),
      goals: formData.projectGoals.trim() || null,
      features: formData.projectFeatures.trim() || null,
      benefits: formData.projectBenefits.trim() || null
    },
    consumer_profile: {
      category: formData.consumerCategory,
      demographics: formData.consumerDemographics.trim() || null,
      purchase_goal: formData.consumerPurchaseGoal.trim() || null,
      lifestyle: formData.consumerLifestyle.trim() || null
    },
    content_plan_info: {
      timeline: {
        start_date: formData.contentPlanStartDate,
        end_date: formData.contentPlanEndDate
      },
      publication_frequency: formData.publicationFrequency,
      min_publications: parseInt(formData.minPublications),
      key_dates: formData.keyDates.trim() || null,
      total_budget: parseFloat(formData.totalBudget),
      max_cost_per_publication: parseFloat(formData.maxCostPerPublication),
      content_formats: formData.contentFormats,
      video_requirements: formData.contentFormats.includes('video') ? formData.videoDescription.trim() : null,
      platforms: formData.platforms
    },
    ontology: {},
    evolution_settings: {
      population_size: parseInt(formData.evoPopulationSize) || 100,
      generations: parseInt(formData.evoGenerations) || 100,
      stop_criterion: formData.evoStopCriterion || 'max_generations',
      stagnation_generations: formData.evoStagnationGenerations
        ? parseInt(formData.evoStagnationGenerations)
        : 20,
      optimization_goal: formData.evoOptimizationGoal || 'max_engagement',
      budget_limit: formData.evoBudgetLimit
        ? parseFloat(formData.evoBudgetLimit)
        : (formData.totalBudget ? parseFloat(formData.totalBudget) : null),
      selection_method: formData.evoSelectionMethod || 'tournament',
      tournament_size: formData.evoTournamentSize
        ? parseInt(formData.evoTournamentSize)
        : 3,
      best_win_prob: formData.evoBestWinProb
        ? parseFloat(formData.evoBestWinProb)
        : 0.9,
      elite_size: formData.evoEliteSize
        ? parseInt(formData.evoEliteSize)
        : 2,
      crossover_method: formData.evoCrossoverMethod || 'one_point',
      crossover_probability: formData.evoCrossoverProbability
        ? parseFloat(formData.evoCrossoverProbability)
        : 0.8,
      mutation_method: formData.evoMutationMethod || 'bit_flip',
      mutation_probability: formData.evoMutationProbability
        ? parseFloat(formData.evoMutationProbability)
        : 0.01,
      preserve_diversity: !!formData.evoPreserveDiversity,
      use_parallel: !!formData.evoUseParallel,
      random_seed: formData.evoRandomSeed?.trim() || null
    },
    metadata: {
      created_at: new Date().toISOString(),
      version: '1.0'
    }
  };

  if (competitorsData) {
    return {
      project_input: projectData,
      competitors_data: competitorsData,
      processing_metadata: {
        combined_at: new Date().toISOString(),
        competitors_file: competitorsFileName,
        version: '1.0'
      }
    };
  }

  return projectData;
}
