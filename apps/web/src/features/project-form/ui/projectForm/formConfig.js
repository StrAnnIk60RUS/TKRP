export const initialFormData = {
  producerName: '',
  producerActivitySpecification: '',
  projectName: '',
  projectDescription: '',
  projectGoals: '',
  projectFeatures: '',
  projectBenefits: '',
  consumerCategory: '',
  consumerDemographics: '',
  consumerPurchaseGoal: '',
  consumerLifestyle: '',
  contentPlanStartDate: '',
  contentPlanEndDate: '',
  publicationFrequency: '',
  publicationDayMode: 'spread',
  keyDates: '',
  contentFormats: [],
  platforms: [],
  // GA параметры — оптимальные из бенчмарка
  evoPopulationSize: '32',           // было 64 → 32
  evoGenerations: '40',              // было 80 → 40
  evoStagnationGenerations: '12',    // было 20 → 12
  evoTournamentSize: '3',            // было 5 → 3
  evoEliteSize: '6',                 // было 4 → 6
  evoCrossoverProbability: '0.75',   // было 0.9 → 0.75
  evoMutationProbability: '0.2',
  evoRandomSeed: '',
  // НОВЫЕ поля — выбор методов
  evoSelectionMethod: 'tournament',   // tournament | roulette | rank
  evoCrossoverMethod: 'one_point',    // one_point | two_point | uniform
  evoMutationMethod: 'random_replace', // random_replace | inversion
  // GA этапа постов (stage2) — дефолты ближе к postEvolution.js
  evoPostPopulationSize: '48',
  evoPostGenerations: '50',
  evoPostStagnationGenerations: '12',
  evoPostTournamentSize: '4',
  evoPostEliteSize: '3',
  evoPostCrossoverProbability: '0.9',
  evoPostMutationProbability: '0.2',
  evoPostSelectionMethod: 'tournament',
  evoPostCrossoverMethod: 'one_point',
  evoPostMutationMethod: 'random_replace'
}

const STEP_LABELS = {
  competitors: 'Конкуренты',
  project: 'О проекте',
  audience: 'Аудитория и план',
  precedents: 'Прецеденты',
  draft: 'Черновик плана',
  optimize: 'Улучшение плана'
}

export const STEP_META = {
  competitors: {
    id: 'competitors',
    title: 'Источники примеров и конкуренты',
    shortLabel: 'Конкуренты',
    goal: 'Система строит контент-план на основе реальных публикаций с подтверждённой вовлечённостью. Вы можете сразу использовать уже накопленную базу примеров либо добавить ссылки на сообщества конкурентов.',
    nextHint: 'Если база примеров уже заполнена, парсить новые ссылки не обязательно — сразу переходите к описанию вашего проекта.'
  },
  project: {
    id: 'project',
    title: 'Сведения о производителе и IT-проекте',
    shortLabel: 'О проекте',
    goal: 'Укажите компанию-разработчика и опишите ваш продукт: какую задачу он решает, чем отличается от аналогов и какую пользу приносит клиентам.',
    nextHint: 'На следующем шаге вы выберете целевую аудиторию, площадки и график выхода публикаций.'
  },
  audience: {
    id: 'audience',
    title: 'Целевая аудитория, площадки и график публикаций',
    shortLabel: 'Аудитория и план',
    goal: 'Определите сегмент аудитории (B2B, B2C или B2G), задайте период контент-плана, желаемую частоту выхода постов, форматы и социальные сети.',
    nextHint: 'После заполнения этих параметров система сможет подобрать релевантные примеры и сформировать план.'
  },
  precedents: {
    id: 'precedents',
    title: 'Подбор подходящих примеров (прецедентов)',
    shortLabel: 'Прецеденты',
    goal: 'Запустите поиск по базе знаний, чтобы система отобрала публикации и структуры планов, наиболее близкие к тематике вашего проекта и выбранным площадкам.',
    nextHint: 'Найденные примеры станут опорой для генерации чернового контент-плана на следующем шаге.'
  },
  draft: {
    id: 'draft',
    title: 'Сборка чернового контент-плана',
    shortLabel: 'Черновик плана',
    goal: 'Сформируйте первичный вариант расписания и тем публикаций с помощью искусственного интеллекта или сразу запустите полный цикл создания и алгоритмического улучшения плана.',
    nextHint: 'После генерации вы сможете открыть черновик в календаре или перейти к этапу повышения прогнозируемого отклика.'
  },
  optimize: {
    id: 'optimize',
    title: 'Улучшение контент-плана (прогноз отклика и эволюционный подбор)',
    shortLabel: 'Улучшение плана',
    goal: 'Запустите двухэтапную оптимизацию: прогнозная модель машинного обучения оценит ожидаемые лайки и охват, а генетический алгоритм подберёт лучшее сочетание тем, форматов, тональности и призывов к действию.',
    nextHint: 'По завершении откройте итоговый план, чтобы просмотреть календарь, отредактировать посты или выгрузить документ.'
  }
}

/** Аналитик и разработчик: все 6 шагов, включая отдельный шаг поиска прецедентов. */
export const wizardStepIdsExtended = [
  'competitors',
  'project',
  'audience',
  'precedents',
  'draft',
  'optimize'
]

/** SMM: 5 шагов без отдельного экрана «Прецеденты» — подбор выполняется автоматически перед черновиком. */
export const wizardStepIdsSmm = ['competitors', 'project', 'audience', 'draft', 'optimize']

export const wizardSteps = wizardStepIdsExtended.map((id) => STEP_LABELS[id])
export const wizardStepsSmm = wizardStepIdsSmm.map((id) => STEP_LABELS[id])

/** Быстрый vs расширенный режим онбординга. */
export const ONBOARDING_MODES = {
  quick: { label: 'Быстрый режим', hint: 'Минимум полей, для SMM', roleHint: 'smm' },
  extended: { label: 'Расширенный режим', hint: 'Полная форма, параметры оптимизации', roleHint: 'dev' }
}

export function getWizardStepIds(isDeveloper, isAnalyst = false) {
  return isDeveloper || isAnalyst ? wizardStepIdsExtended : wizardStepIdsSmm
}

export function getWizardSteps(isDeveloper, isAnalyst = false) {
  return getWizardStepIds(isDeveloper, isAnalyst).map((id) => STEP_LABELS[id])
}

export const requiredFields = [
  'producerName',
  'producerActivitySpecification',
  'projectName',
  'projectDescription',
  'consumerCategory',
  'contentPlanStartDate',
  'contentPlanEndDate',
  'publicationFrequency'
]

export const consumerCategoryOptions = [
  { value: 'B2B', label: 'B2B (Business-to-Business) - Бизнес для бизнеса' },
  { value: 'B2C', label: 'B2C (Business-to-Consumer) - Бизнес для потребителя' },
  { value: 'B2G', label: 'B2G (Business-to-Government) - Бизнес для государства' }
]

export const frequencyOptions = [
  { value: 'daily', label: 'Ежедневно' },
  { value: '3-4_per_week', label: '3-4 раза в неделю' },
  { value: '2-3_per_week', label: '2-3 раза в неделю' },
  { value: 'weekly', label: 'Еженедельно' },
  { value: '2_per_week', label: '2 раза в неделю' }
]

export const publicationDayModeOptions = [
  {
    value: 'spread',
    label: 'Разные дни',
    hint: 'Публикации распределяются по горизонту и могут выходить на платформах в разные даты.'
  },
  {
    value: 'shared',
    label: 'Общие дни',
    hint: 'На каждую выбранную дату создается публикация на каждой выбранной платформе.'
  }
]

export const contentFormatOptions = [
  { value: 'text', label: 'Текст' },
  { value: 'video', label: 'Ролик' },
  { value: 'image', label: 'Изображение' },
  { value: 'combined', label: 'Комбинированный' }
]

export const platformOptions = [
  { value: 'vk', label: 'VK (ВКонтакте)' },
  { value: 'linkedin', label: 'LinkedIn' }
]

export const instagramPlatformOption = { value: 'instagram', label: 'Instagram' }

export const demoHorizonExampleOptions = {
  example_month_plan: '1 месяц',
  example_three_month_plan: '3 месяца',
  example_six_month_plan: '6 месяцев',
  example_year_plan: '12 месяцев',
  example_dev_project_saas_unfamiliar_1m: 'DEV: SaaS (1 месяц) — обход чеклиста',
  example_dev_project_edtech_unfamiliar_3m: 'DEV: EdTech (3 месяца) — обход чеклиста',
  example_dev_project_fintech_b2g_unfamiliar_6m: 'DEV: FinTech/B2G (6 месяцев) — обход чеклиста',
  example_dev_project_outsourcing_unfamiliar_1m_daily: 'DEV: Аутсорс/delivery (1 месяц) — обход чеклиста'
}

function buildDefaultDemoDates(months = 3) {
  const start = new Date()
  start.setDate(start.getDate() + 1)
  const end = new Date(start)
  end.setMonth(end.getMonth() + months)
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10)
  }
}

const defaultDemoRange = buildDefaultDemoDates(3)

export const demoExampleFormData = {
  producerName: 'CloudTech Solutions',
  producerActivitySpecification:
    'Разработка и внедрение облачных решений для бизнес-аналитики и управления данными. Специализация на SaaS-платформах для среднего и крупного бизнеса.',
  projectName: 'CloudAnalytics Pro',
  projectDescription:
    'Облачная платформа для бизнес-аналитики с использованием искусственного интеллекта. Позволяет компаниям автоматизировать сбор, обработку и визуализацию данных, создавать интерактивные дашборды и получать прогнозы на основе машинного обучения.',
  projectGoals:
    'За 3 месяца привлечь 50 новых B2B-клиентов, увеличить узнаваемость бренда в IT-сообществе, позиционировать продукт как лидера в сегменте облачной аналитики для среднего бизнеса.',
  projectFeatures:
    'Автоматическая аналитика в реальном времени, интерактивные дашборды, прогнозирование трендов с помощью искусственного интеллекта, интеграция с популярными CRM и ERP системами, API для разработчиков, мобильное приложение для iOS и Android.',
  projectBenefits:
    'Сокращение времени на подготовку отчетов с 8 часов до 1 часа, увеличение точности прогнозов на 40%, ROI до 250% за первый год использования, масштабируемость от 10 до 10000+ пользователей.',
  consumerCategory: 'B2B',
  consumerDemographics:
    'Руководители отделов аналитики, финансовые директора, IT-директора в компаниях среднего бизнеса (50-500 сотрудников). Возраст 35-50 лет, высшее образование, опыт работы с бизнес-аналитикой от 5 лет.',
  consumerPurchaseGoal:
    'Автоматизация процессов аналитики, повышение скорости принятия решений, снижение операционных затрат на подготовку отчетов, улучшение качества прогнозирования.',
  consumerLifestyle:
    'Профессионалы, ценящие эффективность и технологичность. Активно используют LinkedIn для профессионального развития, посещают отраслевые конференции, читают специализированные издания по бизнес-аналитике и IT.',
  contentPlanStartDate: defaultDemoRange.startDate,
  contentPlanEndDate: defaultDemoRange.endDate,
  publicationFrequency: '3-4_per_week',
  publicationDayMode: 'spread',
  keyDates: '',
  contentFormats: ['text', 'image', 'video'],
  platforms: ['linkedin', 'vk'],
  evoPopulationSize: '32',
  evoGenerations: '40',
  evoStagnationGenerations: '12',
  evoTournamentSize: '3',
  evoEliteSize: '6',
  evoCrossoverProbability: '0.75',
  evoMutationProbability: '0.2',
  evoRandomSeed: '',
  evoSelectionMethod: 'tournament',
  evoCrossoverMethod: 'one_point',
  evoMutationMethod: 'random_replace',
  evoPostPopulationSize: '48',
  evoPostGenerations: '50',
  evoPostStagnationGenerations: '12',
  evoPostTournamentSize: '4',
  evoPostEliteSize: '3',
  evoPostCrossoverProbability: '0.9',
  evoPostMutationProbability: '0.2',
  evoPostSelectionMethod: 'tournament',
  evoPostCrossoverMethod: 'one_point',
  evoPostMutationMethod: 'random_replace'
}

