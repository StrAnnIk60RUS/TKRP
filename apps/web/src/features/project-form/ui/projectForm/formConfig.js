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
  postsPerWeek: '',
  publicationDayMode: 'spread',
  minPublications: '',
  keyDates: '',
  contentFormats: [],
  videoDescription: '',
  platforms: [],
  evoPopulationSize: '64',
  evoGenerations: '80',
  evoStagnationGenerations: '20',
  evoTournamentSize: '5',
  evoEliteSize: '4',
  evoCrossoverProbability: '0.9',
  evoMutationProbability: '0.08',
  evoRandomSeed: ''
}

export const wizardSteps = [
  'Конкуренты',
  'Проект',
  'Аудитория и план',
  'Настройки и запуск',
  'Результаты'
]

/** Шаги для быстрого режима (SMM) — без параметров эволюции. */
export const wizardStepsSmm = [
  'Конкуренты',
  'Проект',
  'Аудитория и план',
  'Результаты'
]

/** Быстрый vs расширенный режим онбординга. */
export const ONBOARDING_MODES = {
  quick: { label: 'Быстрый режим', hint: 'Минимум полей, для SMM', roleHint: 'smm' },
  extended: { label: 'Расширенный режим', hint: 'Полная форма, параметры GA/ML', roleHint: 'dev' }
}

export function getWizardSteps(isDeveloper, isAnalyst = false) {
  return isDeveloper || isAnalyst ? wizardSteps : wizardStepsSmm
}

export const requiredFields = [
  'producerName',
  'producerActivitySpecification',
  'projectName',
  'projectDescription',
  'consumerCategory',
  'contentPlanStartDate',
  'contentPlanEndDate',
  'publicationFrequency',
  'minPublications'
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

export const demoHorizonExampleOptions = {
  example_month_plan: '1 месяц',
  example_three_month_plan: '3 месяца',
  example_six_month_plan: '6 месяцев',
  example_year_plan: '12 месяцев'
}

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
    'Автоматическая аналитика в реальном времени, интерактивные дашборды, прогнозирование трендов с помощью ML, интеграция с популярными CRM и ERP системами, API для разработчиков, мобильное приложение для iOS и Android.',
  projectBenefits:
    'Сокращение времени на подготовку отчетов с 8 часов до 1 часа, увеличение точности прогнозов на 40%, ROI до 250% за первый год использования, масштабируемость от 10 до 10000+ пользователей.',
  consumerCategory: 'B2B',
  consumerDemographics:
    'Руководители отделов аналитики, финансовые директора, IT-директора в компаниях среднего бизнеса (50-500 сотрудников). Возраст 35-50 лет, высшее образование, опыт работы с бизнес-аналитикой от 5 лет.',
  consumerPurchaseGoal:
    'Автоматизация процессов аналитики, повышение скорости принятия решений, снижение операционных затрат на подготовку отчетов, улучшение качества прогнозирования.',
  consumerLifestyle:
    'Профессионалы, ценящие эффективность и технологичность. Активно используют LinkedIn для профессионального развития, посещают отраслевые конференции, читают специализированные издания по бизнес-аналитике и IT.',
  contentPlanStartDate: '2026-03-01',
  contentPlanEndDate: '2026-05-31',
  publicationFrequency: '3-4_per_week',
  postsPerWeek: '3.5',
  publicationDayMode: 'spread',
  minPublications: '46',
  keyDates:
    '15 марта - запуск бета-версии, 1 апреля - вебинар по внедрению, 15 апреля - кейс-стади с первым клиентом, 1 мая - обновление функционала, 20 мая - итоговая презентация результатов.',
  contentFormats: ['text', 'image', 'video'],
  videoDescription:
    'Короткие ролики (1-3 минуты) с демонстрацией функционала платформы, интервью с клиентами, объяснение сложных концепций простым языком. Профессиональная съемка, субтитры, брендинг CloudTech Solutions.',
  platforms: ['linkedin', 'vk'],
  evoPopulationSize: '64',
  evoGenerations: '80',
  evoStagnationGenerations: '20',
  evoTournamentSize: '5',
  evoEliteSize: '4',
  evoCrossoverProbability: '0.9',
  evoMutationProbability: '0.08',
  evoRandomSeed: ''
}
