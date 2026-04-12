import { initialFormData, requiredFields } from './formConfig.js'

export const formatDateISO = (date) => date.toISOString().split('T')[0]

const FREQUENCY_TO_WEEKLY_RECOMMENDED = {
  daily: 7,
  '3-4_per_week': 3.5,
  '2-3_per_week': 2.5,
  weekly: 1,
  '2_per_week': 2
}

export const parseNumberOrNull = (value) => {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' && value.trim() === '') return null
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function getHorizonDays(startDate, endDate) {
  if (!startDate || !endDate) return null
  const start = new Date(startDate)
  const end = new Date(endDate)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return null
  return Math.max(1, Math.round((end - start) / (24 * 60 * 60 * 1000)) + 1)
}

export function getRecommendedPublicationsByFrequency(formData = {}) {
  const postsPerWeek = FREQUENCY_TO_WEEKLY_RECOMMENDED[formData.publicationFrequency]
  const horizonDays = getHorizonDays(formData.contentPlanStartDate, formData.contentPlanEndDate)
  if (!postsPerWeek || !horizonDays) return null
  return Math.max(1, Math.round((postsPerWeek * horizonDays) / 7))
}

export const mapExamplePayloadToFormData = (data = {}) => ({
  ...initialFormData,
  producerName: data.producer_info?.name || '',
  producerActivitySpecification: data.producer_info?.activity_specification || '',
  projectName: data.it_project_info?.name || '',
  projectDescription: data.it_project_info?.description || '',
  projectGoals: data.it_project_info?.goals || '',
  projectFeatures: data.it_project_info?.features || '',
  projectBenefits: data.it_project_info?.benefits || '',
  consumerCategory: data.consumer_profile?.category || '',
  consumerDemographics: data.consumer_profile?.demographics || '',
  consumerPurchaseGoal: data.consumer_profile?.purchase_goal || '',
  consumerLifestyle: data.consumer_profile?.lifestyle || '',
  contentPlanStartDate: data.content_plan_info?.timeline?.start_date || '',
  contentPlanEndDate: data.content_plan_info?.timeline?.end_date || '',
  publicationFrequency: data.content_plan_info?.publication_frequency || '',
  publicationDayMode: data.content_plan_info?.publication_day_mode === 'shared' ? 'shared' : 'spread',
  keyDates: data.content_plan_info?.key_dates || '',
  contentFormats: data.content_plan_info?.content_formats || [],
  videoDescription: data.content_plan_info?.video_requirements || '',
  platforms: data.content_plan_info?.platforms || []
})

export function validateFieldValue(name, value, formData) {
  let error = ''

  switch (name) {
    case 'producerName':
      if (!value.trim()) error = 'Наименование производителя обязательно'
      else if (value.trim().length < 3) error = 'Минимум 3 символа'
      break
    case 'producerActivitySpecification':
      if (!value.trim()) error = 'Специфика деятельности обязательна'
      else if (value.trim().length < 10) error = 'Минимум 10 символов'
      break
    case 'projectName':
      if (!value.trim()) error = 'Наименование проекта обязательно'
      else if (value.trim().length < 3) error = 'Минимум 3 символа'
      break
    case 'projectDescription':
      if (!value.trim()) error = 'Описание проекта обязательно'
      else if (value.trim().length < 20) error = 'Минимум 20 символов'
      break
    case 'consumerCategory':
      if (!value) error = 'Выберите категорию потребителя'
      break
    case 'contentPlanStartDate':
      if (!value) error = 'Укажите дату начала'
      else {
        const start = new Date(value)
        const today = new Date()
        today.setHours(0, 0, 0, 0)
        if (start < today) error = 'Дата не может быть в прошлом'
      }
      break
    case 'contentPlanEndDate':
      if (!value) error = 'Укажите дату окончания'
      else {
        const end = new Date(value)
        const start = formData.contentPlanStartDate ? new Date(formData.contentPlanStartDate) : null
        if (start && end < start) error = 'Не может быть раньше даты начала'
      }
      break
    case 'publicationFrequency':
      if (!value) error = 'Выберите частоту публикаций'
      break
    case 'videoDescription':
      if (formData.contentFormats.includes('video') && !value.trim()) {
        error = 'Опишите требования к ролику'
      }
      break
    case 'evoPopulationSize':
    case 'evoGenerations':
    case 'evoPostPopulationSize':
    case 'evoPostGenerations':
      if (value) {
        const num = parseInt(value, 10)
        if (Number.isNaN(num) || num < 10 || num > 2000) error = 'От 10 до 2000'
      }
      break
    case 'evoStagnationGenerations':
    case 'evoPostStagnationGenerations':
      if (value) {
        const num = parseInt(value, 10)
        if (Number.isNaN(num) || num < 1 || num > 500) error = 'От 1 до 500'
      }
      break
    case 'evoTournamentSize':
    case 'evoPostTournamentSize':
      if (value) {
        const num = parseInt(value, 10)
        if (Number.isNaN(num) || num < 2 || num > 20) error = 'От 2 до 20'
      }
      break
    case 'evoEliteSize':
    case 'evoPostEliteSize':
      if (value) {
        const num = parseInt(value, 10)
        if (Number.isNaN(num) || num < 0 || num > 20) error = 'От 0 до 20'
      }
      break
    case 'evoCrossoverProbability':
    case 'evoMutationProbability':
    case 'evoPostCrossoverProbability':
    case 'evoPostMutationProbability':
      if (value) {
        const num = parseFloat(value)
        if (Number.isNaN(num) || num < 0 || num > 1) error = 'От 0 до 1.0'
      }
      break
    default:
      break
  }

  return error
}

export function validateFormData(formData) {
  const nextErrors = {}

  requiredFields.forEach((field) => {
    const error = validateFieldValue(field, formData[field] ?? '', formData)
    if (error) nextErrors[field] = error
  })

  if (formData.contentFormats.length === 0) {
    nextErrors.contentFormats = 'Выберите хотя бы один формат'
  }
  if (formData.platforms.length === 0) {
    nextErrors.platforms = 'Выберите хотя бы одну платформу'
  }
  if (formData.contentFormats.includes('video') && !formData.videoDescription.trim()) {
    nextErrors.videoDescription = 'Опишите требования к ролику'
  }

  return {
    isValid: Object.keys(nextErrors).length === 0,
    errors: nextErrors
  }
}

export function buildSuggestedPrecedentQuery(formData) {
  const parts = [
    formData.projectName ? `IT-проект ${formData.projectName}` : '',
    formData.projectDescription || '',
    formData.consumerCategory ? `аудитория ${formData.consumerCategory}` : '',
    formData.platforms.length ? `платформы ${formData.platforms.join(', ')}` : '',
    formData.contentFormats.length ? `форматы ${formData.contentFormats.join(', ')}` : '',
    formData.projectBenefits ? `ключевые преимущества: ${formData.projectBenefits}` : ''
  ].filter(Boolean)

  if (parts.length === 0) {
    return 'продвижение IT-проекта в социальных сетях, B2B, экспертный контент, кейсы внедрения'
  }

  return parts.join('. ')
}

export function buildSafeFormInputForGeneration(formData) {
  const now = new Date()
  const end = new Date(now)
  end.setDate(now.getDate() + 30)

  return {
    ...formData,
    producerName: formData.producerName || 'Unknown producer',
    producerActivitySpecification:
      formData.producerActivitySpecification || 'IT-project development and promotion.',
    projectName: formData.projectName || 'IT Project',
    projectDescription:
      formData.projectDescription ||
      'Draft generation request for IT project promotion in social networks.',
    consumerCategory: formData.consumerCategory || 'B2B',
    contentPlanStartDate: formData.contentPlanStartDate || formatDateISO(now),
    contentPlanEndDate: formData.contentPlanEndDate || formatDateISO(end),
    publicationFrequency: formData.publicationFrequency || 'weekly',
    publicationDayMode: formData.publicationDayMode === 'shared' ? 'shared' : 'spread',
    contentFormats: formData.contentFormats.length ? formData.contentFormats : ['text'],
    platforms: formData.platforms.length ? formData.platforms : ['linkedin']
  }
}

export function buildAlphaByDimension(precedentPubs = [], optimizationGoal) {
  const dims = precedentPubs?.[0]?.publication_model?.spcj?.dimensions
  const keys = dims && typeof dims === 'object' ? Object.keys(dims) : []
  if (!keys.length) {
    return {
      audience_relevance: 1,
      educational_value: 1,
      evidence_strength: 1,
      clarity: 1,
      engagement_potential: 1,
      brand_fit: 1,
      timeliness: 1,
      cta_strength: 1
    }
  }

  const base = keys.reduce((acc, key) => ({ ...acc, [key]: 1 }), {})
  if (optimizationGoal === 'max_engagement') {
    if (base.engagement_potential !== undefined) base.engagement_potential = 2
    if (base.cta_strength !== undefined) base.cta_strength = 1.5
    if (base.audience_relevance !== undefined) base.audience_relevance = 1.25
  } else if (optimizationGoal === 'max_reach') {
    if (base.timeliness !== undefined) base.timeliness = 2
    if (base.audience_relevance !== undefined) base.audience_relevance = 1.5
    if (base.clarity !== undefined) base.clarity = 1.25
  } else if (optimizationGoal === 'balanced') {
    if (base.audience_relevance !== undefined) base.audience_relevance = 1.2
    if (base.clarity !== undefined) base.clarity = 1.2
    if (base.brand_fit !== undefined) base.brand_fit = 1.1
  }

  return base
}

/** GA этапа контент-плана (stage1 / optimizeContentPlanEvolution). */
export function buildPlanGaConfigFromForm(formData) {
  const seed = formData.evoRandomSeed && formData.evoRandomSeed.trim() ? formData.evoRandomSeed.trim() : null
  return {
    seed,
    populationSize: parseNumberOrNull(formData.evoPopulationSize) ?? 32,
    maxGenerations: parseNumberOrNull(formData.evoGenerations) ?? 40,
    stagnationGenerations: parseNumberOrNull(formData.evoStagnationGenerations) ?? 12,
    eliteSize: parseNumberOrNull(formData.evoEliteSize) ?? 6,
    tournamentSize: parseNumberOrNull(formData.evoTournamentSize) ?? 3,
    crossoverProbability: parseNumberOrNull(formData.evoCrossoverProbability) ?? 0.75,
    mutationProbability: parseNumberOrNull(formData.evoMutationProbability) ?? 0.12,
    selectionMethod: formData.evoSelectionMethod || 'tournament',
    crossoverMethod: formData.evoCrossoverMethod || 'one_point',
    mutationMethod: formData.evoMutationMethod || 'random_replace'
  }
}

/** GA этапа постов (stage2 / optimizePublicationsEvolution). Семя — то же, что у плана. */
export function buildPostGaConfigFromForm(formData) {
  const seed = formData.evoRandomSeed && formData.evoRandomSeed.trim() ? formData.evoRandomSeed.trim() : null
  return {
    seed,
    populationSize: parseNumberOrNull(formData.evoPostPopulationSize) ?? 48,
    maxGenerations: parseNumberOrNull(formData.evoPostGenerations) ?? 50,
    stagnationGenerations: parseNumberOrNull(formData.evoPostStagnationGenerations) ?? 12,
    eliteSize: parseNumberOrNull(formData.evoPostEliteSize) ?? 3,
    tournamentSize: parseNumberOrNull(formData.evoPostTournamentSize) ?? 4,
    crossoverProbability: parseNumberOrNull(formData.evoPostCrossoverProbability) ?? 0.9,
    mutationProbability: parseNumberOrNull(formData.evoPostMutationProbability) ?? 0.12,
    selectionMethod: formData.evoPostSelectionMethod || 'tournament',
    crossoverMethod: formData.evoPostCrossoverMethod || 'one_point',
    mutationMethod: formData.evoPostMutationMethod || 'random_replace'
  }
}

/** @deprecated Используйте buildPlanGaConfigFromForm; оставлено для тестов и обратной совместимости. */
export function buildGaConfigFromForm(formData) {
  return buildPlanGaConfigFromForm(formData)
}

/**
 * Прецеденты «готовы» для шагов SMM: есть хиты поиска ИЛИ в базе непустая сводка (после seed / до первого поиска).
 * Генерация на сервере всё равно делает свой RAG — не требуем отдельного клика «Подобрать», если база уже есть.
 */
export function hasPrecedentsForWorkflow(precedentSearchResults, precedentsSummary) {
  const fromSearch =
    (precedentSearchResults?.publications?.length || 0) > 0 ||
    (precedentSearchResults?.content_plans?.length || 0) > 0
  if (fromSearch) return true
  const pubs = Number(precedentsSummary?.publications_count) || 0
  const plans = Number(precedentsSummary?.content_plans_count) || 0
  return pubs + plans > 0
}

export function hasLocalCompetitorsInForm(competitorsData) {
  return Array.isArray(competitorsData?.competitors) && competitorsData.competitors.length > 0
}

export function hasPersistedPrecedentsInDb(precedentsSummary) {
  const pubs = Number(precedentsSummary?.publications_count) || 0
  const plans = Number(precedentsSummary?.content_plans_count) || 0
  return pubs + plans > 0
}

/**
 * Парсинг/обогащение на шаге 1 не обязательны, если прецеденты уже накоплены в БД (прошлые запуски).
 */
export function competitorsStepRequirementMet(competitorsData, precedentsSummary) {
  return hasLocalCompetitorsInForm(competitorsData) || hasPersistedPrecedentsInDb(precedentsSummary)
}

export function buildReviewChecklist(
  formData,
  competitorsData,
  precedentSearchResults,
  draftPlanResult,
  precedentsSummary = null
) {
  const isFilled = (value) => {
    if (Array.isArray(value)) return value.length > 0
    if (typeof value === 'string') return value.trim() !== ''
    return value !== null && value !== undefined
  }
  const requiredFieldsFilled = requiredFields.every((field) => isFilled(formData?.[field]))
  const formatsFilled = isFilled(formData?.contentFormats)
  const platformsFilled = isFilled(formData?.platforms)
  const videoRequirementFilled =
    !Array.isArray(formData?.contentFormats) ||
    !formData.contentFormats.includes('video') ||
    isFilled(formData?.videoDescription)

  const base = [
    {
      id: 'required_fields',
      label: 'Обязательные поля формы заполнены',
      done: requiredFieldsFilled && formatsFilled && platformsFilled && videoRequirementFilled
    },
    {
      id: 'competitors',
      label:
        'Конкуренты в форме или база прецедентов уже заполнена (повторный парсинг/обогащение не требуются)',
      done: competitorsStepRequirementMet(competitorsData, precedentsSummary)
    },
    {
      id: 'precedents',
      label: 'Подобраны прецеденты или в базе есть публикации/планы',
      done: hasPrecedentsForWorkflow(precedentSearchResults, precedentsSummary)
    },
    {
      id: 'draft',
      label: 'Черновой план уже сформирован',
      done: Boolean(draftPlanResult?.draft?.draft_content_plan)
    }
  ]
  return base
}
