import React, { useState, useMemo, useEffect, useRef } from 'react'
import { ToastContainer } from './Toast'
import CompetitorsStep from './competitors/CompetitorsStep'
import { useCompetitorsPipeline } from '../hooks/useCompetitorsPipeline'
import { getPrecedentsSummary, searchPrecedents, seedDemoPrecedents, generateDraftContentPlan } from '../services/enrichmentService'
import './ProjectForm.css'

const formatPrecedentScore = (score) => `${Math.round((Number(score) || 0) * 100)}%`

const renderMatchedTokens = (matchedTokens = []) => {
  if (!matchedTokens.length) return 'Без совпавших токенов'
  return matchedTokens.join(', ')
}

const formatDateISO = (date) => date.toISOString().split('T')[0]

const ProjectForm = () => {
  const [formData, setFormData] = useState({
    // Сведения о производителе
    producerName: '',
    producerActivitySpecification: '',
    
    // Сведения об IT-проекте
    projectName: '',
    projectDescription: '',
    projectGoals: '',
    projectFeatures: '',
    projectBenefits: '',
    
    // Профиль потребителя
    consumerCategory: '', // B2B, B2C, B2G
    consumerDemographics: '',
    consumerPurchaseGoal: '',
    consumerLifestyle: '',
    
    // Сведения о контент-плане
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

    // Параметры эволюционного моделирования (опционально)
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
  })

  const [errors, setErrors] = useState({})
  const [touched, setTouched] = useState({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [toasts, setToasts] = useState([])
  const isProcessing = false
  const [isEditMode, setIsEditMode] = useState(true)
  const [precedentsSummary, setPrecedentsSummary] = useState(null)
  const [precedentSearchQuery, setPrecedentSearchQuery] = useState('')
  const [precedentSearchResults, setPrecedentSearchResults] = useState(null)
  const [isSearchingPrecedents, setIsSearchingPrecedents] = useState(false)
  const [isSeedingPrecedents, setIsSeedingPrecedents] = useState(false)
  const [isGeneratingDraftPlan, setIsGeneratingDraftPlan] = useState(false)
  const [draftPlanResult, setDraftPlanResult] = useState(null)
  const [currentStep, setCurrentStep] = useState(1)
  const toastCounterRef = useRef(0)

  const wizardSteps = [
    'Конкуренты',
    'Проект',
    'Аудитория и план',
    'Настройки и запуск',
    'Результаты'
  ]

  // B2G - Business-to-Government (бизнес для государства)
  const consumerCategoryOptions = [
    { value: 'B2B', label: 'B2B (Business-to-Business) - Бизнес для бизнеса' },
    { value: 'B2C', label: 'B2C (Business-to-Consumer) - Бизнес для потребителя' },
    { value: 'B2G', label: 'B2G (Business-to-Government) - Бизнес для государства' }
  ]

  const frequencyOptions = [
    { value: 'daily', label: 'Ежедневно' },
    { value: '3-4_per_week', label: '3-4 раза в неделю' },
    { value: '2-3_per_week', label: '2-3 раза в неделю' },
    { value: 'weekly', label: 'Еженедельно' },
    { value: '2_per_week', label: '2 раза в неделю' }
  ]

  const contentFormatOptions = [
    { value: 'text', label: 'Текст' },
    { value: 'video', label: 'Ролик' },
    { value: 'image', label: 'Изображение' },
    { value: 'combined', label: 'Комбинированный' }
  ]

  const platformOptions = [
    { value: 'vk', label: 'VK (ВКонтакте)' },
    { value: 'telegram', label: 'Telegram' },
    { value: 'linkedin', label: 'LinkedIn' },
    { value: 'instagram', label: 'Instagram' }
  ]

  // Обязательные поля
  const requiredFields = [
    'producerName', 'producerActivitySpecification',
    'projectName', 'projectDescription',
    'consumerCategory',
    'contentPlanStartDate', 'contentPlanEndDate', 'publicationFrequency',
    'minPublications', 'totalBudget', 'maxCostPerPublication'
  ]

  const filledRequired = useMemo(() => {
    return requiredFields.filter(field => {
      const value = formData[field]
      return value && (typeof value === 'string' ? value.trim() !== '' : true)
    }).length
  }, [formData])

  const progress = (filledRequired / requiredFields.length) * 100

  const addToast = (message, type = 'success') => {
    toastCounterRef.current += 1
    const id = `${Date.now()}-${toastCounterRef.current}-${Math.random().toString(36).substr(2, 9)}`
    setToasts(prev => [...prev, { id, message, type }])
  }

  const {
    competitorsData,
    competitorsFileName,
    isEnrichmentServerAvailable,
    competitorUrls,
    postsLimit,
    isParsingFromUrls,
    isEnriching,
    handleRemoveCompetitorsData,
    handleEnrichCompetitorsData,
    handleCompetitorUrlChange,
    handleAddCompetitorUrl,
    handleRemoveCompetitorUrl,
    handlePostsLimitChange,
    handleParseCompetitorsFromUrls,
    clearCompetitors,
    canEnrich
  } = useCompetitorsPipeline(addToast)

  useEffect(() => {
    const savedDraft = localStorage.getItem('projectFormDraft')
    if (savedDraft) {
      try {
        const draft = JSON.parse(savedDraft)
        setFormData(draft)
        addToast('Черновик загружен', 'info')
      } catch (e) {
        console.error('Ошибка загрузки черновика:', e)
      }
    }
  }, [])

  useEffect(() => {
    const loadPrecedentsSummary = async () => {
      try {
        const response = await getPrecedentsSummary()
        setPrecedentsSummary(response.summary || null)
      } catch (error) {
        console.error('Ошибка загрузки сводки прецедентов:', error)
      }
    }

    loadPrecedentsSummary()
  }, [])

  useEffect(() => {
    const firstPost = competitorsData?.competitors?.[0]?.posts?.[0]
    const hasNormalizedPublicationModel = !!firstPost?.publication_model

    if (!hasNormalizedPublicationModel) return

    const refreshPrecedentsSummary = async () => {
      try {
        const response = await getPrecedentsSummary()
        setPrecedentsSummary(response.summary || null)
      } catch (error) {
        console.error('Ошибка обновления сводки прецедентов:', error)
      }
    }

    refreshPrecedentsSummary()
  }, [competitorsData])

  useEffect(() => {
    const hasData = Object.values(formData).some(val => 
      Array.isArray(val) ? val.length > 0 : val !== '' && val !== null
    )
    
    if (hasData) {
      const timeoutId = setTimeout(() => {
        localStorage.setItem('projectFormDraft', JSON.stringify(formData))
      }, 1000)
      return () => clearTimeout(timeoutId)
    }
  }, [formData])

  const removeToast = (id) => {
    setToasts(prev => prev.filter(toast => toast.id !== id))
  }

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target
    
    if (type === 'checkbox') {
      if (name === 'contentFormats' || name === 'platforms') {
        setFormData(prev => ({
          ...prev,
          [name]: checked
            ? [...prev[name], value]
            : prev[name].filter(item => item !== value)
        }))
      } else {
        // Булевы флаги (например, evoPreserveDiversity, evoUseParallel)
        setFormData(prev => ({
          ...prev,
          [name]: checked
        }))
      }
    } else {
      setFormData(prev => ({
        ...prev,
        [name]: value
      }))
    }

    if (errors[name]) {
      setErrors(prev => ({ ...prev, [name]: '' }))
    }
  }

  const handleBlur = (e) => {
    const { name } = e.target
    setTouched(prev => ({ ...prev, [name]: true }))
    validateField(name, formData[name])
  }

  const validateField = (name, value) => {
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
      case 'minPublications':
        if (!value) error = 'Укажите количество'
        else {
          const num = parseInt(value)
          if (isNaN(num) || num < 1 || num > 1000) error = 'От 1 до 1000'
        }
        break
      case 'totalBudget':
        if (!value) error = 'Укажите бюджет'
        else {
          const num = parseFloat(value)
          if (isNaN(num) || num < 0) error = 'Бюджет должен быть положительным'
        }
        break
      case 'maxCostPerPublication':
        if (!value) error = 'Укажите стоимость'
        else {
          const num = parseFloat(value)
          if (isNaN(num) || num < 0 || num > 1000000) error = 'От 0 до 1 000 000'
        }
        break
      case 'videoDescription':
        if (formData.contentFormats.includes('video') && !value.trim()) {
          error = 'Опишите требования к ролику'
        }
        break
      // Параметры эволюционного моделирования (опционально)
      case 'evoPopulationSize':
      case 'evoGenerations':
        if (value) {
          const num = parseInt(value)
          if (isNaN(num) || num < 10 || num > 2000) error = 'От 10 до 2000'
        }
        break
      case 'evoStagnationGenerations':
        if (value) {
          const num = parseInt(value)
          if (isNaN(num) || num < 1 || num > 500) error = 'От 1 до 500'
        }
        break
      case 'evoBudgetLimit':
        if (value) {
          const num = parseFloat(value)
          if (isNaN(num) || num < 0) error = 'Бюджет должен быть положительным'
        }
        break
      case 'evoTournamentSize':
        if (value) {
          const num = parseInt(value)
          if (isNaN(num) || num < 2 || num > 20) error = 'От 2 до 20'
        }
        break
      case 'evoBestWinProb':
        if (value) {
          const num = parseFloat(value)
          if (isNaN(num) || num < 0.5 || num > 1) error = 'От 0.5 до 1.0'
        }
        break
      case 'evoEliteSize':
        if (value) {
          const num = parseInt(value)
          if (isNaN(num) || num < 0 || num > 20) error = 'От 0 до 20'
        }
        break
      case 'evoCrossoverProbability':
      case 'evoMutationProbability':
        if (value) {
          const num = parseFloat(value)
          if (isNaN(num) || num < 0 || num > 1) error = 'От 0 до 1.0'
        }
        break
      default: break
    }

    setErrors(prev => ({ ...prev, [name]: error }))
    return !error
  }

  const validateForm = () => {
    const newErrors = {}
    let isValid = true

    requiredFields.forEach(field => {
      if (!validateField(field, formData[field])) {
        isValid = false
      }
    })

    if (formData.contentFormats.length === 0) {
      newErrors.contentFormats = 'Выберите хотя бы один формат'
      isValid = false
    }
    if (formData.platforms.length === 0) {
      newErrors.platforms = 'Выберите хотя бы одну платформу'
      isValid = false
    }
    if (formData.contentFormats.includes('video') && !formData.videoDescription.trim()) {
      newErrors.videoDescription = 'Опишите требования к ролику'
      isValid = false
    }

    setErrors(newErrors)
    return isValid
  }


  const loadExample = async (exampleName) => {
    try {
      const response = await fetch(`/examples/${exampleName}.json`)
      if (!response.ok) throw new Error('Файл не найден')
      const data = await response.json()
      
      // Преобразуем данные из формата экспорта в формат формы
      const formDataFromExample = {
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
        minPublications: data.content_plan_info?.min_publications?.toString() || '',
        keyDates: data.content_plan_info?.key_dates || '',
        totalBudget: data.content_plan_info?.total_budget?.toString() || '',
        maxCostPerPublication: data.content_plan_info?.max_cost_per_publication?.toString() || '',
        contentFormats: data.content_plan_info?.content_formats || [],
        videoDescription: data.content_plan_info?.video_requirements || '',
        platforms: data.content_plan_info?.platforms || []
      }
      
      setFormData(formDataFromExample)
      setIsEditMode(true)
      addToast(`Пример "${exampleName.replace('example_', '').replace(/_/g, ' ')}" загружен`, 'success')
    } catch (error) {
      console.error('Ошибка загрузки примера:', error)
      addToast('Ошибка загрузки примера. Убедитесь, что файлы находятся в папке public/examples', 'error')
    }
  }

  const buildSuggestedPrecedentQuery = () => {
    const parts = [
      formData.projectName ? `IT-проект ${formData.projectName}` : '',
      formData.projectDescription ? formData.projectDescription : '',
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

  const buildSafeFormInputForGeneration = () => {
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
      minPublications: formData.minPublications || '8',
      totalBudget: formData.totalBudget || '0',
      maxCostPerPublication: formData.maxCostPerPublication || '0',
      contentFormats: formData.contentFormats.length ? formData.contentFormats : ['text'],
      platforms: formData.platforms.length ? formData.platforms : ['linkedin']
    }
  }

  const handleSearchPrecedents = async () => {
    const query = buildSuggestedPrecedentQuery().trim()

    setIsSearchingPrecedents(true)
    setPrecedentSearchQuery(query)

    try {
      const response = await searchPrecedents({
        query,
        limit: 5,
        platform: formData.platforms[0] || undefined,
        audience_segments: formData.consumerCategory ? [formData.consumerCategory] : []
      })

      setPrecedentSearchResults(response.results || null)
      addToast('Поиск прецедентов завершён', 'success')

      const summaryResponse = await getPrecedentsSummary()
      setPrecedentsSummary(summaryResponse.summary || null)
    } catch (error) {
      console.error('Ошибка поиска прецедентов:', error)
      addToast(`Ошибка поиска прецедентов: ${error.message}`, 'error')
    } finally {
      setIsSearchingPrecedents(false)
    }
  }

  const handleSeedDemoPrecedents = async () => {
    if (isEnrichmentServerAvailable === false) {
      addToast('Сервер недоступен. Запустите backend на порту 3001.', 'error')
      return
    }
    setIsSeedingPrecedents(true)
    try {
      await seedDemoPrecedents()
      const summaryResponse = await getPrecedentsSummary()
      setPrecedentsSummary(summaryResponse.summary || null)
      addToast('Демо-база прецедентов загружена. Можно искать по запросу.', 'success')
    } catch (error) {
      console.error('Ошибка загрузки демо-базы:', error)
      addToast(`Ошибка: ${error.message}`, 'error')
    } finally {
      setIsSeedingPrecedents(false)
    }
  }

  const handleReset = () => {
    if (window.confirm('Вы уверены, что хотите очистить все поля формы?')) {
      setFormData({
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
      })
      setErrors({})
      setTouched({})
      clearCompetitors()
      localStorage.removeItem('projectFormDraft')
      addToast('Форма очищена', 'info')
    }
  }

  const handleLoadExample = () => {
    if (window.confirm('Загрузить пример данных? Текущие данные будут заменены.')) {
      // Пример данных из project_data_example.json
      const exampleData = {
        producerName: 'CloudTech Solutions',
        producerActivitySpecification: 'Разработка и внедрение облачных решений для бизнес-аналитики и управления данными. Специализация на SaaS-платформах для среднего и крупного бизнеса.',
        projectName: 'CloudAnalytics Pro',
        projectDescription: 'Облачная платформа для бизнес-аналитики с использованием искусственного интеллекта. Позволяет компаниям автоматизировать сбор, обработку и визуализацию данных, создавать интерактивные дашборды и получать прогнозы на основе машинного обучения.',
        projectGoals: 'За 3 месяца привлечь 50 новых B2B-клиентов, увеличить узнаваемость бренда в IT-сообществе, позиционировать продукт как лидера в сегменте облачной аналитики для среднего бизнеса.',
        projectFeatures: 'Автоматическая аналитика в реальном времени, интерактивные дашборды, прогнозирование трендов с помощью ML, интеграция с популярными CRM и ERP системами, API для разработчиков, мобильное приложение для iOS и Android.',
        projectBenefits: 'Сокращение времени на подготовку отчетов с 8 часов до 1 часа, увеличение точности прогнозов на 40%, ROI до 250% за первый год использования, масштабируемость от 10 до 10000+ пользователей.',
        consumerCategory: 'B2B',
        consumerDemographics: 'Руководители отделов аналитики, финансовые директора, IT-директора в компаниях среднего бизнеса (50-500 сотрудников). Возраст 35-50 лет, высшее образование, опыт работы с бизнес-аналитикой от 5 лет.',
        consumerPurchaseGoal: 'Автоматизация процессов аналитики, повышение скорости принятия решений, снижение операционных затрат на подготовку отчетов, улучшение качества прогнозирования.',
        consumerLifestyle: 'Профессионалы, ценящие эффективность и технологичность. Активно используют LinkedIn для профессионального развития, посещают отраслевые конференции, читают специализированные издания по бизнес-аналитике и IT.',
        contentPlanStartDate: '2026-03-01',
        contentPlanEndDate: '2026-05-31',
        publicationFrequency: '3-4_per_week',
        minPublications: '70',
        keyDates: '15 марта - запуск бета-версии, 1 апреля - вебинар по внедрению, 15 апреля - кейс-стади с первым клиентом, 1 мая - обновление функционала, 20 мая - итоговая презентация результатов.',
        totalBudget: '150000',
        maxCostPerPublication: '3500',
        contentFormats: ['text', 'image', 'video'],
        videoDescription: 'Короткие ролики (1-3 минуты) с демонстрацией функционала платформы, интервью с клиентами, объяснение сложных концепций простым языком. Профессиональная съемка, субтитры, брендинг CloudTech Solutions.',
        platforms: ['linkedin', 'vk', 'telegram'],
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

      setFormData(exampleData)
      setErrors({})
      setTouched({})
      addToast('Пример данных загружен', 'success')
    }
  }

  const handleGenerateDraftPlan = async () => {
    const safeFormInput = buildSafeFormInputForGeneration()

    setIsGeneratingDraftPlan(true)
    addToast('Генерация чернового контент-плана по данным формы и прецедентам...', 'info')

    try {
      const response = await generateDraftContentPlan({
        form_input: safeFormInput,
        rag_query: precedentSearchQuery || undefined,
        rag_limit: 8
      })

      setDraftPlanResult(response)
      if (response?.rag) {
        setPrecedentSearchResults(response.rag)
      }
      addToast('Черновой контент-план успешно сгенерирован', 'success')
    } catch (error) {
      console.error('Ошибка генерации чернового плана:', error)
      addToast(`Ошибка генерации: ${error.message}`, 'error')
    } finally {
      setIsGeneratingDraftPlan(false)
    }
  }

  const hasError = (fieldName) => touched[fieldName] && errors[fieldName]
  const isFirstStep = currentStep === 1
  const isLastStep = currentStep === wizardSteps.length
  const wizardProgress = (currentStep / wizardSteps.length) * 100

  const goToNextStep = () => {
    if (!isLastStep) setCurrentStep((prev) => prev + 1)
  }

  const goToPrevStep = () => {
    if (!isFirstStep) setCurrentStep((prev) => prev - 1)
  }

  const goToStep = (stepNumber) => {
    if (stepNumber < 1 || stepNumber > wizardSteps.length) return
    setCurrentStep(stepNumber)
  }

  return (
    <>
      <ToastContainer toasts={toasts} removeToast={removeToast} />
      
      <form className="project-form">
        {/* Прогресс-бар */}
        <div className="main-nav wizard-main-nav">
          <div className="progress-bar-container">
            <div className="progress-bar-fill" style={{ width: `${wizardProgress}%` }}></div>
          </div>
          <span className="progress-text">
            Шаг {currentStep} из {wizardSteps.length}: {wizardSteps[currentStep - 1]}
          </span>
          <div className="wizard-step-tabs">
            {wizardSteps.map((stepName, idx) => {
              const stepNumber = idx + 1
              const isActive = currentStep === stepNumber
              return (
                <button
                  key={stepName}
                  type="button"
                  className={`wizard-step-tab ${isActive ? 'active' : ''}`}
                  onClick={() => goToStep(stepNumber)}
                  title={`Перейти к этапу: ${stepName}`}
                >
                  {stepNumber}. {stepName}
                </button>
              )
            })}
          </div>
        </div>

        {currentStep === 1 && (
          <>
            <CompetitorsStep
              competitorUrls={competitorUrls}
              competitorsData={competitorsData}
              competitorsFileName={competitorsFileName}
              postsLimit={postsLimit}
              isParsingFromUrls={isParsingFromUrls}
              isEnriching={isEnriching}
              isProcessing={isProcessing}
              isEnrichmentServerAvailable={isEnrichmentServerAvailable}
              canEnrich={canEnrich}
              onUrlChange={handleCompetitorUrlChange}
              onAddUrl={handleAddCompetitorUrl}
              onRemoveUrl={handleRemoveCompetitorUrl}
              onPostsLimitChange={handlePostsLimitChange}
              onParseFromUrls={handleParseCompetitorsFromUrls}
              onEnrichUploaded={handleEnrichCompetitorsData}
              onRemoveData={handleRemoveCompetitorsData}
            />

          </>
        )}

        {/* Сведения о производителе */}
        {currentStep === 2 && <section className="form-section">
          <h2 className="section-title">Сведения о производителе</h2>
          
          <div className="form-group">
            <label htmlFor="producerName" className="form-label">
              Наименование производителя <span className="required">*</span>
            </label>
            <input
              type="text"
              id="producerName"
              name="producerName"
              value={formData.producerName}
              onChange={handleChange}
              onBlur={handleBlur}
              className={`form-input ${hasError('producerName') ? 'error' : ''}`}
              placeholder="Например: ООО ТехноСофт"
              disabled={!isEditMode}
            />
            {hasError('producerName') && <span className="error-message">{errors.producerName}</span>}
          </div>

          <div className="form-group">
            <label htmlFor="producerActivitySpecification" className="form-label">
              Специфика деятельности <span className="required">*</span>
            </label>
            <textarea
              id="producerActivitySpecification"
              name="producerActivitySpecification"
              value={formData.producerActivitySpecification}
              onChange={handleChange}
              onBlur={handleBlur}
              className={`form-textarea ${hasError('producerActivitySpecification') ? 'error' : ''}`}
              placeholder="Опишите сферу деятельности производителя"
              rows="3"
              disabled={!isEditMode}
            />
            {hasError('producerActivitySpecification') && <span className="error-message">{errors.producerActivitySpecification}</span>}
          </div>
        </section>}

        {/* Сведения об IT-проекте */}
        {currentStep === 2 && <section className="form-section">
          <h2 className="section-title">Сведения об IT-проекте</h2>
          
          <div className="form-group">
            <label htmlFor="projectName" className="form-label">
              Наименование IT-проекта <span className="required">*</span>
            </label>
            <input
              type="text"
              id="projectName"
              name="projectName"
              value={formData.projectName}
              onChange={handleChange}
              onBlur={handleBlur}
              className={`form-input ${hasError('projectName') ? 'error' : ''}`}
              placeholder="Например: CloudAnalytics Pro"
              disabled={!isEditMode}
            />
            {hasError('projectName') && <span className="error-message">{errors.projectName}</span>}
          </div>

          <div className="form-group">
            <label htmlFor="projectDescription" className="form-label">
              Описание IT-проекта <span className="required">*</span>
            </label>
            <textarea
              id="projectDescription"
              name="projectDescription"
              value={formData.projectDescription}
              onChange={handleChange}
              onBlur={handleBlur}
              className={`form-textarea ${hasError('projectDescription') ? 'error' : ''}`}
              placeholder="Основное описание проекта"
              rows="4"
              disabled={!isEditMode}
            />
            {hasError('projectDescription') && <span className="error-message">{errors.projectDescription}</span>}
          </div>

          <div className="form-group">
            <label htmlFor="projectGoals" className="form-label">
              Цели проекта
            </label>
            <textarea
              id="projectGoals"
              name="projectGoals"
              value={formData.projectGoals}
              onChange={handleChange}
              onBlur={handleBlur}
              className="form-textarea"
              placeholder="Какие цели преследует проект?"
              rows="3"
              disabled={!isEditMode}
            />
          </div>

          <div className="form-group">
            <label htmlFor="projectFeatures" className="form-label">
              Особенности проекта
            </label>
            <textarea
              id="projectFeatures"
              name="projectFeatures"
              value={formData.projectFeatures}
              onChange={handleChange}
              onBlur={handleBlur}
              className="form-textarea"
              placeholder="Ключевые особенности и функции"
              rows="3"
              disabled={!isEditMode}
            />
          </div>

          <div className="form-group">
            <label htmlFor="projectBenefits" className="form-label">
              Преимущества проекта
            </label>
            <textarea
              id="projectBenefits"
              name="projectBenefits"
              value={formData.projectBenefits}
              onChange={handleChange}
              onBlur={handleBlur}
              className="form-textarea"
              placeholder="Какие преимущества дает проект?"
              rows="3"
              disabled={!isEditMode}
            />
          </div>
        </section>}

        {/* Профиль потребителя */}
        {currentStep === 3 && <section className="form-section">
          <h2 className="section-title">Профиль потребителя</h2>
          
          <div className="form-group">
            <label htmlFor="consumerCategory" className="form-label">
              Категория потребителя <span className="required">*</span>
            </label>
            <select
              id="consumerCategory"
              name="consumerCategory"
              value={formData.consumerCategory}
              onChange={handleChange}
              onBlur={handleBlur}
              className={`form-select ${hasError('consumerCategory') ? 'error' : ''}`}
              disabled={!isEditMode}
            >
              <option value="">Выберите категорию</option>
              {consumerCategoryOptions.map(option => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            {hasError('consumerCategory') && <span className="error-message">{errors.consumerCategory}</span>}
          </div>

          <div className="form-group">
            <label htmlFor="consumerDemographics" className="form-label">
              Социально-демографические характеристики
            </label>
            <textarea
              id="consumerDemographics"
              name="consumerDemographics"
              value={formData.consumerDemographics}
              onChange={handleChange}
              onBlur={handleBlur}
              className="form-textarea"
              placeholder="Возраст, пол, образование, доход и т.д."
              rows="3"
              disabled={!isEditMode}
            />
          </div>

          <div className="form-group">
            <label htmlFor="consumerPurchaseGoal" className="form-label">
              Цель приобретения
            </label>
            <textarea
              id="consumerPurchaseGoal"
              name="consumerPurchaseGoal"
              value={formData.consumerPurchaseGoal}
              onChange={handleChange}
              onBlur={handleBlur}
              className="form-textarea"
              placeholder="Зачем потребитель приобретает продукт?"
              rows="3"
              disabled={!isEditMode}
            />
          </div>

          <div className="form-group">
            <label htmlFor="consumerLifestyle" className="form-label">
              Стиль жизни и другие характеристики
            </label>
            <textarea
              id="consumerLifestyle"
              name="consumerLifestyle"
              value={formData.consumerLifestyle}
              onChange={handleChange}
              onBlur={handleBlur}
              className="form-textarea"
              placeholder="Стиль жизни, интересы, поведенческие особенности"
              rows="3"
              disabled={!isEditMode}
            />
          </div>
        </section>}

        {/* Сведения о контент-плане */}
        {currentStep === 3 && <section className="form-section">
          <h2 className="section-title">Сведения о контент-плане</h2>
          
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="contentPlanStartDate" className="form-label">
                Дата начала <span className="required">*</span>
              </label>
              <input
                type="date"
                id="contentPlanStartDate"
                name="contentPlanStartDate"
                value={formData.contentPlanStartDate}
                onChange={handleChange}
                onBlur={handleBlur}
                className={`form-input ${hasError('contentPlanStartDate') ? 'error' : ''}`}
                disabled={!isEditMode}
              />
              {hasError('contentPlanStartDate') && <span className="error-message">{errors.contentPlanStartDate}</span>}
            </div>

            <div className="form-group">
              <label htmlFor="contentPlanEndDate" className="form-label">
                Дата окончания <span className="required">*</span>
              </label>
              <input
                type="date"
                id="contentPlanEndDate"
                name="contentPlanEndDate"
                value={formData.contentPlanEndDate}
                onChange={handleChange}
                onBlur={handleBlur}
                className={`form-input ${hasError('contentPlanEndDate') ? 'error' : ''}`}
                disabled={!isEditMode}
              />
              {hasError('contentPlanEndDate') && <span className="error-message">{errors.contentPlanEndDate}</span>}
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="publicationFrequency" className="form-label">
              Частота публикаций <span className="required">*</span>
            </label>
            <select
              id="publicationFrequency"
              name="publicationFrequency"
              value={formData.publicationFrequency}
              onChange={handleChange}
              onBlur={handleBlur}
              className={`form-select ${hasError('publicationFrequency') ? 'error' : ''}`}
              disabled={!isEditMode}
            >
              <option value="">Выберите частоту</option>
              {frequencyOptions.map(option => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            {hasError('publicationFrequency') && <span className="error-message">{errors.publicationFrequency}</span>}
          </div>

          <div className="form-group">
            <label htmlFor="minPublications" className="form-label">
              Минимальное количество публикаций <span className="required">*</span>
            </label>
            <input
              type="number"
              id="minPublications"
              name="minPublications"
              value={formData.minPublications}
              onChange={handleChange}
              onBlur={handleBlur}
              className={`form-input ${hasError('minPublications') ? 'error' : ''}`}
              placeholder="30"
              min="1"
              max="1000"
              disabled={!isEditMode}
            />
            {hasError('minPublications') && <span className="error-message">{errors.minPublications}</span>}
            <small className="form-hint">Можно скорректировать позже</small>
          </div>

          <div className="form-group">
            <label htmlFor="keyDates" className="form-label">
              Ключевые даты
            </label>
            <textarea
              id="keyDates"
              name="keyDates"
              value={formData.keyDates}
              onChange={handleChange}
              onBlur={handleBlur}
              className="form-textarea"
              placeholder="Важные даты, события, праздники (по одной на строку)"
              rows="3"
              disabled={!isEditMode}
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="totalBudget" className="form-label">
                Общий бюджет на продвижение (byn) <span className="required">*</span>
              </label>
              <input
                type="number"
                id="totalBudget"
                name="totalBudget"
                value={formData.totalBudget}
                onChange={handleChange}
                onBlur={handleBlur}
                className={`form-input ${hasError('totalBudget') ? 'error' : ''}`}
                placeholder="100000"
                min="0"
                step="1000"
                disabled={!isEditMode}
              />
              {hasError('totalBudget') && <span className="error-message">{errors.totalBudget}</span>}
            </div>

            <div className="form-group">
              <label htmlFor="maxCostPerPublication" className="form-label">
                Максимальная стоимость 1 публикации (byn) <span className="required">*</span>
              </label>
              <input
                type="number"
                id="maxCostPerPublication"
                name="maxCostPerPublication"
                value={formData.maxCostPerPublication}
                onChange={handleChange}
                onBlur={handleBlur}
                className={`form-input ${hasError('maxCostPerPublication') ? 'error' : ''}`}
                placeholder="5000"
                min="0"
                max="1000000"
                step="100"
                disabled={!isEditMode}
              />
              {hasError('maxCostPerPublication') && <span className="error-message">{errors.maxCostPerPublication}</span>}
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">
              Формат публикаций <span className="required">*</span>
            </label>
            <div className="checkbox-group">
              {contentFormatOptions.map(option => (
                <label key={option.value} className="checkbox-label">
                  <input
                    type="checkbox"
                    name="contentFormats"
                    value={option.value}
                    checked={formData.contentFormats.includes(option.value)}
                    onChange={handleChange}
                    onBlur={handleBlur}
                    disabled={!isEditMode}
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
            {hasError('contentFormats') && <span className="error-message">{errors.contentFormats}</span>}
          </div>

          {formData.contentFormats.includes('video') && (
            <div className="form-group">
              <label htmlFor="videoDescription" className="form-label">
                Требования к ролику <span className="required">*</span>
              </label>
              <textarea
                id="videoDescription"
                name="videoDescription"
                value={formData.videoDescription}
                onChange={handleChange}
                onBlur={handleBlur}
                className={`form-textarea ${hasError('videoDescription') ? 'error' : ''}`}
                placeholder="Опишите требования к ролику"
                rows="3"
                disabled={!isEditMode}
              />
              {hasError('videoDescription') && <span className="error-message">{errors.videoDescription}</span>}
            </div>
          )}

          <div className="form-group">
            <label className="form-label">
              Платформы <span className="required">*</span>
            </label>
            <div className="checkbox-group">
              {platformOptions.map(option => (
                <label key={option.value} className="checkbox-label">
                  <input
                    type="checkbox"
                    name="platforms"
                    value={option.value}
                    checked={formData.platforms.includes(option.value)}
                    onChange={handleChange}
                    onBlur={handleBlur}
                    disabled={!isEditMode}
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
            {hasError('platforms') && <span className="error-message">{errors.platforms}</span>}
          </div>
        </section>}

        {/* Параметры эволюционного моделирования (опционально) */}
        {currentStep === 4 && <section className="form-section">
          <h2 className="section-title">Параметры эволюционного моделирования (опционально)</h2>
          
          {/* Основные параметры */}
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="evoPopulationSize" className="form-label">
                Размер популяции
              </label>
              <input
                type="number"
                id="evoPopulationSize"
                name="evoPopulationSize"
                value={formData.evoPopulationSize}
                onChange={handleChange}
                onBlur={handleBlur}
                className="form-input"
                placeholder="100"
                min="10"
                max="2000"
                disabled={!isEditMode}
              />
              <small className="form-hint">Сколько контент-планов одновременно рассматривает алгоритм</small>
            </div>
            <div className="form-group">
              <label htmlFor="evoGenerations" className="form-label">
                Количество поколений
              </label>
              <input
                type="number"
                id="evoGenerations"
                name="evoGenerations"
                value={formData.evoGenerations}
                onChange={handleChange}
                onBlur={handleBlur}
                className="form-input"
                placeholder="100"
                min="10"
                max="2000"
                disabled={!isEditMode}
              />
              <small className="form-hint">Сколько итераций эволюции выполнить</small>
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="evoStopCriterion" className="form-label">
                Критерий остановки
              </label>
              <select
                id="evoStopCriterion"
                name="evoStopCriterion"
                value={formData.evoStopCriterion}
                onChange={handleChange}
                onBlur={handleBlur}
                className="form-select"
                disabled={!isEditMode}
              >
                <option value="max_generations">Достижение числа поколений</option>
                <option value="stagnation">Стагнация (нет улучшений)</option>
                <option value="target_quality">Достижение целевого качества</option>
                <option value="time_limit">Ограничение по времени</option>
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="evoStagnationGenerations" className="form-label">
                Порог стагнации (поколений)
              </label>
              <input
                type="number"
                id="evoStagnationGenerations"
                name="evoStagnationGenerations"
                value={formData.evoStagnationGenerations}
                onChange={handleChange}
                onBlur={handleBlur}
                className="form-input"
                placeholder="20"
                min="1"
                max="500"
                disabled={!isEditMode}
              />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="evoOptimizationGoal" className="form-label">
                Цель оптимизации
              </label>
              <select
                id="evoOptimizationGoal"
                name="evoOptimizationGoal"
                value={formData.evoOptimizationGoal}
                onChange={handleChange}
                onBlur={handleBlur}
                className="form-select"
                disabled={!isEditMode}
              >
                <option value="max_engagement">Максимум вовлеченности</option>
                <option value="max_reach">Максимум охвата</option>
                <option value="min_budget">Минимум бюджета</option>
                <option value="balanced">Сбалансированная цель</option>
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="evoBudgetLimit" className="form-label">
                Ограничение бюджета для эволюции (byn)
              </label>
              <input
                type="number"
                id="evoBudgetLimit"
                name="evoBudgetLimit"
                value={formData.evoBudgetLimit}
                onChange={handleChange}
                onBlur={handleBlur}
                className="form-input"
                placeholder="Если пусто — используется общий бюджет"
                min="0"
                disabled={!isEditMode}
              />
            </div>
          </div>

          {/* Отбор */}
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="evoSelectionMethod" className="form-label">
                Метод отбора
              </label>
              <select
                id="evoSelectionMethod"
                name="evoSelectionMethod"
                value={formData.evoSelectionMethod}
                onChange={handleChange}
                onBlur={handleBlur}
                className="form-select"
                disabled={!isEditMode}
              >
                <option value="tournament">Турнирный отбор</option>
                <option value="roulette">Пропорциональный (рулетка)</option>
                <option value="rank">Ранговый отбор</option>
                <option value="elite">Элитарный отбор</option>
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="evoTournamentSize" className="form-label">
                Размер турнира
              </label>
              <input
                type="number"
                id="evoTournamentSize"
                name="evoTournamentSize"
                value={formData.evoTournamentSize}
                onChange={handleChange}
                onBlur={handleBlur}
                className="form-input"
                placeholder="3"
                min="2"
                max="20"
                disabled={!isEditMode}
              />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="evoBestWinProb" className="form-label">
                Вероятность победы сильнейшего
              </label>
              <input
                type="number"
                id="evoBestWinProb"
                name="evoBestWinProb"
                value={formData.evoBestWinProb}
                onChange={handleChange}
                onBlur={handleBlur}
                className="form-input"
                placeholder="0.9"
                min="0.5"
                max="1"
                step="0.01"
                disabled={!isEditMode}
              />
            </div>
            <div className="form-group">
              <label htmlFor="evoEliteSize" className="form-label">
                Размер элиты
              </label>
              <input
                type="number"
                id="evoEliteSize"
                name="evoEliteSize"
                value={formData.evoEliteSize}
                onChange={handleChange}
                onBlur={handleBlur}
                className="form-input"
                placeholder="2"
                min="0"
                max="20"
                disabled={!isEditMode}
              />
            </div>
          </div>

          {/* Скрещивание и мутация */}
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="evoCrossoverMethod" className="form-label">
                Метод скрещивания
              </label>
              <select
                id="evoCrossoverMethod"
                name="evoCrossoverMethod"
                value={formData.evoCrossoverMethod}
                onChange={handleChange}
                onBlur={handleBlur}
                className="form-select"
                disabled={!isEditMode}
              >
                <option value="one_point">Одноточечное</option>
                <option value="two_point">Двухточечное</option>
                <option value="uniform">Равномерное</option>
                <option value="arithmetic">Арифметическое</option>
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="evoCrossoverProbability" className="form-label">
                Вероятность скрещивания
              </label>
              <input
                type="number"
                id="evoCrossoverProbability"
                name="evoCrossoverProbability"
                value={formData.evoCrossoverProbability}
                onChange={handleChange}
                onBlur={handleBlur}
                className="form-input"
                placeholder="0.8"
                min="0"
                max="1"
                step="0.01"
                disabled={!isEditMode}
              />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="evoMutationMethod" className="form-label">
                Метод мутации
              </label>
              <select
                id="evoMutationMethod"
                name="evoMutationMethod"
                value={formData.evoMutationMethod}
                onChange={handleChange}
                onBlur={handleBlur}
                className="form-select"
                disabled={!isEditMode}
              >
                <option value="bit_flip">Битовая (замена значения)</option>
                <option value="inversion">Инверсия (разворот)</option>
                <option value="insert_delete">Вставка/Удаление</option>
                <option value="shift">Сдвиг</option>
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="evoMutationProbability" className="form-label">
                Вероятность мутации
              </label>
              <input
                type="number"
                id="evoMutationProbability"
                name="evoMutationProbability"
                value={formData.evoMutationProbability}
                onChange={handleChange}
                onBlur={handleBlur}
                className="form-input"
                placeholder="0.01"
                min="0"
                max="0.5"
                step="0.001"
                disabled={!isEditMode}
              />
            </div>
          </div>

          {/* Дополнительные настройки */}
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">
                Дополнительно
              </label>
              <div className="checkbox-group">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    name="evoPreserveDiversity"
                    checked={!!formData.evoPreserveDiversity}
                    onChange={handleChange}
                    disabled={!isEditMode}
                  />
                  <span>Сохранять разнообразие</span>
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    name="evoUseParallel"
                    checked={!!formData.evoUseParallel}
                    onChange={handleChange}
                    disabled={!isEditMode}
                  />
                  <span>Использовать параллельные вычисления</span>
                </label>
              </div>
            </div>
            <div className="form-group">
              <label htmlFor="evoRandomSeed" className="form-label">
                Семя случайности
              </label>
              <input
                type="number"
                id="evoRandomSeed"
                name="evoRandomSeed"
                value={formData.evoRandomSeed}
                onChange={handleChange}
                onBlur={handleBlur}
                className="form-input"
                placeholder="Оставьте пустым для случайного результата"
                disabled={!isEditMode}
              />
            </div>
          </div>

          <small className="form-hint">
            Если вы не уверены в настройках, оставьте значения по умолчанию — они подобраны для баланса качества и скорости.
          </small>
        </section>}

        {currentStep === 5 && (
        <>
        <div className="form-actions precedent-actions">
          <button
            type="button"
            className="submit-button secondary"
            onClick={handleSeedDemoPrecedents}
            disabled={
              isSubmitting ||
              isProcessing ||
              isGeneratingDraftPlan ||
              isSeedingPrecedents ||
              isEnrichmentServerAvailable === false
            }
            title="Загрузить готовую демо-базу прецедентов, чтобы сразу увидеть рабочий поиск"
          >
            <span>{isSeedingPrecedents ? 'ЗАГРУЗКА ДЕМО...' : 'ЗАГРУЗИТЬ ДЕМО-ПРЕЦЕДЕНТЫ'}</span>
          </button>
          <button
            type="button"
            className="submit-button secondary"
            onClick={handleSearchPrecedents}
            disabled={
              isSubmitting ||
              isProcessing ||
              isGeneratingDraftPlan ||
              isSearchingPrecedents ||
              isEnrichmentServerAvailable === false
            }
            title="Подобрать релевантные публикации и контент-планы по данным формы"
          >
            <span>{isSearchingPrecedents ? 'ПОИСК ПРЕЦЕДЕНТОВ...' : 'ПОДОБРАТЬ ПРЕЦЕДЕНТЫ'}</span>
          </button>
          <button
            type="button"
            className="submit-button primary"
            onClick={handleGenerateDraftPlan}
            disabled={
              isSubmitting || isProcessing || isGeneratingDraftPlan || isEnrichmentServerAvailable === false
            }
          >
            <span>{isGeneratingDraftPlan ? 'ГЕНЕРАЦИЯ...' : 'СФОРМИРОВАТЬ ЧЕРНОВОЙ ПЛАН'}</span>
          </button>
        </div>

        <section className="form-section precedent-workflow-section">
          <h2 className="section-title">Подобранные прецеденты</h2>

          <div className="precedent-summary-panel">
            <div className="precedent-summary-line">
              В базе сейчас: {precedentsSummary?.publications_count || 0} публикаций и{' '}
              {precedentsSummary?.content_plans_count || 0} контент-планов.
            </div>
            <div className="precedent-summary-line">
              Источник запроса: данные текущей формы проекта, аудитории, платформ и преимуществ.
            </div>
            {precedentSearchQuery && (
              <div className="precedent-query-box">
                <strong>Последний автоматически собранный запрос:</strong> {precedentSearchQuery}
              </div>
            )}
          </div>

          {!precedentSearchResults && (
            <div className="precedent-empty-state precedent-empty-state-light">
              Сначала нажмите `Подобрать прецеденты`.
              {precedentsSummary?.publications_count
                ? ' Поиск выполнится по уже накопленной базе.'
                : ' Если база пустая, можно загрузить демо-прецеденты или сначала обогатить конкурентов.'}
            </div>
          )}

          {!!precedentSearchResults && (
            <div className="precedent-results precedent-results-light">
              <div className="precedent-results-header precedent-results-header-light">
                <span className="precedent-results-title precedent-results-title-light">
                  Найдено: {precedentSearchResults.publications?.length || 0} публикаций и{' '}
                  {precedentSearchResults.content_plans?.length || 0} планов
                </span>
                <span className="precedent-results-subtitle precedent-results-subtitle-light">
                  Поиск выполнен по {precedentSearchResults.total_publications_searched || 0} публикациям и{' '}
                  {precedentSearchResults.total_content_plans_searched || 0} планам
                </span>
              </div>

              {(precedentSearchResults.publications?.length || 0) > 0 && (
                <div className="precedent-section">
                  <h3 className="precedent-section-title precedent-section-title-light">Публикации</h3>
                  <div className="precedent-cards">
                    {precedentSearchResults.publications.map((item) => (
                      <div key={item.data.publication_id} className="precedent-card">
                        <div className="precedent-card-header">
                          <span className="precedent-card-title">
                            {item.data.publication_model?.topic || 'Без темы'}
                          </span>
                          <span className="precedent-card-score">{formatPrecedentScore(item.score)}</span>
                        </div>
                        <div className="precedent-card-meta">
                          <span>{item.data.competitor_name || 'Неизвестный конкурент'}</span>
                          <span>{item.data.platform || 'unknown'}</span>
                          <span>{item.data.publication_model?.format || 'unknown'}</span>
                        </div>
                        <div className="precedent-card-body">
                          <div>Тип: {item.data.publication_model?.type || 'other'}</div>
                          <div>Категория: {item.data.publication_model?.content_category || 'other'}</div>
                          <div>
                            Аудитория:{' '}
                            {(item.data.publication_model?.audience_segments || []).join(', ') || 'не указана'}
                          </div>
                          <div>Совпадения: {renderMatchedTokens(item.matched_tokens)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {(precedentSearchResults.content_plans?.length || 0) > 0 && (
                <div className="precedent-section">
                  <h3 className="precedent-section-title precedent-section-title-light">Контент-планы</h3>
                  <div className="precedent-cards">
                    {precedentSearchResults.content_plans.map((item) => (
                      <div key={item.data.plan_id} className="precedent-card">
                        <div className="precedent-card-header">
                          <span className="precedent-card-title">
                            {item.data.competitor_name || item.data.plan_id}
                          </span>
                          <span className="precedent-card-score">{formatPrecedentScore(item.score)}</span>
                        </div>
                        <div className="precedent-card-meta">
                          <span>{item.data.platform || 'unknown'}</span>
                          <span>
                            {item.data.content_plan_model?.posting_frequency_per_week || 0} постов/неделю
                          </span>
                          <span>
                            {item.data.content_plan_model?.total_publications || 0} публикаций
                          </span>
                        </div>
                        <div className="precedent-card-body">
                          <div>
                            Аудитория:{' '}
                            {(item.data.content_plan_model?.audience_segments || []).join(', ') || 'не указана'}
                          </div>
                          <div>
                            Avg engagement:{' '}
                            {formatPrecedentScore(item.data.content_plan_model?.kpi_estimate?.avg_engagement_rate)}
                          </div>
                          <div>Совпадения: {renderMatchedTokens(item.matched_tokens)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {(precedentSearchResults.publications?.length || 0) === 0 &&
                (precedentSearchResults.content_plans?.length || 0) === 0 && (
                  <div className="precedent-empty-state precedent-empty-state-light">
                    По текущим данным формы ничего не найдено. Попробуйте точнее заполнить описание
                    проекта, платформы и преимущества или загрузите демо-прецеденты.
                  </div>
                )}
            </div>
          )}
        </section>
        </>
        )}

        {currentStep === 5 && <section className="form-section precedent-workflow-section">
          <h2 className="section-title">Черновой контент-план (RAG → LLM)</h2>
          {!draftPlanResult?.draft?.draft_content_plan && (
            <div className="precedent-empty-state precedent-empty-state-light">
              После нажатия `Сформировать черновой план` здесь появится структура плана с датами,
              темами, форматами, KPI и ссылками на использованные прецеденты.
            </div>
          )}

          {!!draftPlanResult?.draft?.draft_content_plan && (
            <div className="draft-plan-section">
              <div className="precedent-summary-panel">
                <div className="precedent-summary-line">
                  План: {draftPlanResult.draft.draft_content_plan.plan_id}
                </div>
                <div className="precedent-summary-line">
                  Период: {draftPlanResult.draft.draft_content_plan.planning_horizon?.start_date} -{' '}
                  {draftPlanResult.draft.draft_content_plan.planning_horizon?.end_date}
                </div>
                <div className="precedent-summary-line">
                  Публикаций в черновике: {draftPlanResult.draft.draft_content_plan.publications?.length || 0}
                </div>
              </div>
              <div className="analysis-view">
                <pre>{JSON.stringify(draftPlanResult.draft.draft_content_plan, null, 2)}</pre>
              </div>
            </div>
          )}
        </section>}

        <div className="form-actions wizard-nav-actions">
          <button
            type="button"
            className="submit-button secondary"
            onClick={goToPrevStep}
            disabled={isFirstStep}
          >
            <span>НАЗАД</span>
          </button>
          <button
            type="button"
            className="submit-button primary"
            onClick={goToNextStep}
            disabled={isLastStep}
          >
            <span>ДАЛЕЕ</span>
          </button>
        </div>
      </form>
    </>
  )
}

export default ProjectForm
