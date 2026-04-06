export function buildExportPayload(formData, competitorsData, competitorsFileName) {
  const frequencyToWeekly = {
    daily: 7,
    '3-4_per_week': 3.5,
    '2-3_per_week': 2.5,
    weekly: 1,
    '2_per_week': 2
  }
  const startDate = new Date(formData.contentPlanStartDate)
  const endDate = new Date(formData.contentPlanEndDate)
  const horizonDays = Number.isFinite(startDate.getTime()) && Number.isFinite(endDate.getTime())
    ? Math.max(1, Math.round((endDate - startDate) / (24 * 60 * 60 * 1000)) + 1)
    : 30
  const postsPerWeek = frequencyToWeekly[formData.publicationFrequency] ?? 1
  const minPublications = Math.max(1, Math.round((postsPerWeek * horizonDays) / 7))

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
      min_publications: minPublications,
      key_dates: formData.keyDates.trim() || null,
      content_formats: formData.contentFormats,
      video_requirements: formData.contentFormats.includes('video') ? formData.videoDescription.trim() : null,
      platforms: formData.platforms
    },
    ontology: {},
    evolution_settings: {
      population_size: parseInt(formData.evoPopulationSize) || 100,
      generations: parseInt(formData.evoGenerations) || 100,
      stagnation_generations: formData.evoStagnationGenerations
        ? parseInt(formData.evoStagnationGenerations)
        : 20,
      tournament_size: formData.evoTournamentSize
        ? parseInt(formData.evoTournamentSize)
        : 3,
      elite_size: formData.evoEliteSize
        ? parseInt(formData.evoEliteSize)
        : 2,
      crossover_method: 'one_point',
      crossover_probability: formData.evoCrossoverProbability
        ? parseFloat(formData.evoCrossoverProbability)
        : 0.8,
      mutation_method: 'bit_flip',
      mutation_probability: formData.evoMutationProbability
        ? parseFloat(formData.evoMutationProbability)
        : 0.01,
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
