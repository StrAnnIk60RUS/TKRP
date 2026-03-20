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
  minPublications: '',
  keyDates: '',
  totalBudget: '',
  maxCostPerPublication: '',
  contentFormats: [],
  videoDescription: '',
  platforms: [],
  evoPopulationSize: '100',
  evoGenerations: '100',
  evoStopCriterion: 'max_generations',
  evoStagnationGenerations: '20',
  evoOptimizationGoal: 'max_engagement',
  evoBudgetLimit: '',
  evoSelectionMethod: 'tournament',
  evoTournamentSize: '3',
  evoBestWinProb: '0.9',
  evoEliteSize: '2',
  evoCrossoverMethod: 'one_point',
  evoCrossoverProbability: '0.8',
  evoMutationMethod: 'bit_flip',
  evoMutationProbability: '0.01',
  evoPreserveDiversity: true,
  evoUseParallel: false,
  evoRandomSeed: ''
}

export const wizardSteps = [
  'Конкуренты',
  'Проект',
  'Аудитория и план',
  'Настройки и запуск',
  'Результаты'
]

/** Шаги для SMM (без параметров эволюции). */
export const wizardStepsSmm = [
  'Конкуренты',
  'Проект',
  'Аудитория и план',
  'Результаты'
]

export function getWizardSteps(isDeveloper) {
  return isDeveloper ? wizardSteps : wizardStepsSmm
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
  'minPublications',
  'totalBudget',
  'maxCostPerPublication'
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
  minPublications: '70',
  keyDates:
    '15 марта - запуск бета-версии, 1 апреля - вебинар по внедрению, 15 апреля - кейс-стади с первым клиентом, 1 мая - обновление функционала, 20 мая - итоговая презентация результатов.',
  totalBudget: '150000',
  maxCostPerPublication: '3500',
  contentFormats: ['text', 'image', 'video'],
  videoDescription:
    'Короткие ролики (1-3 минуты) с демонстрацией функционала платформы, интервью с клиентами, объяснение сложных концепций простым языком. Профессиональная съемка, субтитры, брендинг CloudTech Solutions.',
  platforms: ['linkedin', 'vk'],
  evoPopulationSize: '100',
  evoGenerations: '100',
  evoStopCriterion: 'max_generations',
  evoStagnationGenerations: '20',
  evoOptimizationGoal: 'max_engagement',
  evoBudgetLimit: '150000',
  evoSelectionMethod: 'tournament',
  evoTournamentSize: '3',
  evoBestWinProb: '0.9',
  evoEliteSize: '2',
  evoCrossoverMethod: 'one_point',
  evoCrossoverProbability: '0.8',
  evoMutationMethod: 'bit_flip',
  evoMutationProbability: '0.01',
  evoPreserveDiversity: true,
  evoUseParallel: false,
  evoRandomSeed: ''
}
