import React, { useState, useMemo, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { ToastContainer } from './Toast'
import CompetitorsStep from './competitors/CompetitorsStep'
import WizardHeader from './WizardHeader'
import WizardNavActions from './WizardNavActions'
import WorkflowSummaryPanel from './projectForm/WorkflowSummaryPanel'
import PrecedentSearchPanel from './projectForm/PrecedentSearchPanel'
import DraftPlanWorkflowPanel from './projectForm/DraftPlanWorkflowPanel'
import TechnicalDetailsPanel from './projectForm/TechnicalDetailsPanel'
import { useCompetitorsPipeline } from '../hooks/useCompetitorsPipeline'
import {
  getPrecedentsSummary,
  searchPrecedents,
  seedDemoPrecedents,
  exportOntologyToExcel,
  generateDraftContentPlan,
  optimizeDraftContentPlan
} from '../services/enrichmentService'
import { savePlanSnapshot } from '../services/planStorage'
import PrecedentDetailsModal from './precedents/PrecedentDetailsModal'
import { useUserRole } from '../context/UserRoleContext'
import {
  consumerCategoryOptions,
  contentFormatOptions,
  demoExampleFormData,
  demoHorizonExampleOptions,
  frequencyOptions,
  getWizardSteps,
  initialFormData,
  platformOptions,
  requiredFields
} from './projectForm/formConfig'
import {
  buildAlphaByDimension,
  buildGaConfigFromForm,
  buildReviewChecklist,
  buildSafeFormInputForGeneration,
  buildSuggestedPrecedentQuery,
  mapExamplePayloadToFormData,
  parseNumberOrNull,
  validateFieldValue,
  validateFormData
} from './projectForm/formUtils'
import './ProjectForm.css'

const ProjectForm = () => {
  const navigate = useNavigate()
  const { isDeveloper } = useUserRole()
  const [formData, setFormData] = useState(initialFormData)

  const wizardSteps = getWizardSteps(isDeveloper)

  const [errors, setErrors] = useState({})
  const [touched, setTouched] = useState({})
  const [toasts, setToasts] = useState([])
  const [isEditMode, setIsEditMode] = useState(true)
  const [precedentsSummary, setPrecedentsSummary] = useState(null)
  const [precedentSearchQuery, setPrecedentSearchQuery] = useState('')
  const [precedentSearchResults, setPrecedentSearchResults] = useState(null)
  const [isSearchingPrecedents, setIsSearchingPrecedents] = useState(false)
  const [isSeedingPrecedents, setIsSeedingPrecedents] = useState(false)
  const [isExportingOntology, setIsExportingOntology] = useState(false)
  const [isGeneratingDraftPlan, setIsGeneratingDraftPlan] = useState(false)
  const [draftPlanResult, setDraftPlanResult] = useState(null)
  const [isOptimizingPlan, setIsOptimizingPlan] = useState(false)
  const [optimizationResult, setOptimizationResult] = useState(null)
  const [currentStep, setCurrentStep] = useState(1)
  // Общий флаг "идет работа" для блокировки неуместных действий.
  const isProcessing =
    isSearchingPrecedents || isSeedingPrecedents || isGeneratingDraftPlan || isOptimizingPlan || isExportingOntology
  const toastCounterRef = useRef(0)
  const [selectedPrecedentItem, setSelectedPrecedentItem] = useState(null)
  const [demoHorizonExample, setDemoHorizonExample] = useState('example_year_plan')

  const precedentRetrieval = precedentSearchResults?.retrieval || null

  const retrievalBadge = useMemo(() => {
    const type = precedentRetrieval?.type
    if (type === 'embedding_cosine') {
      return isDeveloper
        ? {
            label: 'Semantic retrieval',
            hint: precedentRetrieval?.embedding_model ? `${precedentRetrieval.embedding_model}` : 'embeddings',
            tone: 'success'
          }
        : { label: 'Поиск по смыслу', hint: '', tone: 'success' }
    }
    if (type === 'token_overlap_fallback') {
      return isDeveloper
        ? { label: 'Token overlap', hint: 'fallback', tone: 'neutral' }
        : { label: 'Поиск по ключевым словам', hint: '', tone: 'neutral' }
    }
    if (!type) return null
    return { label: type, hint: '', tone: 'neutral' }
  }, [precedentRetrieval, isDeveloper])

  const filledRequired = useMemo(() => {
    return requiredFields.filter(field => {
      const value = formData[field]
      return value && (typeof value === 'string' ? value.trim() !== '' : true)
    }).length
  }, [formData])

  const progress = (filledRequired / requiredFields.length) * 100

  const isValueFilled = (value) => {
    if (Array.isArray(value)) return value.length > 0
    if (typeof value === 'string') return value.trim() !== ''
    return value !== null && value !== undefined
  }

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
  } = useCompetitorsPipeline(addToast, { isDeveloper })

  const reviewChecklist = useMemo(
    () => buildReviewChecklist(formData, competitorsData, precedentSearchResults, draftPlanResult),
    [formData, competitorsData, precedentSearchResults, draftPlanResult]
  )

  const stepStatuses = useMemo(() => {
    const hasCompetitorUrls = competitorUrls.some((url) => typeof url === 'string' && url.trim() !== '')
    const hasCompetitorData = (competitorsData?.competitors?.length || 0) > 0
    const projectFields = [
      'producerName',
      'producerActivitySpecification',
      'projectName',
      'projectDescription'
    ]
    const audienceAndPlanFields = [
      'consumerCategory',
      'contentPlanStartDate',
      'contentPlanEndDate',
      'publicationFrequency',
      'minPublications',
      'totalBudget',
      'maxCostPerPublication'
    ]
    const projectCompleted = projectFields.every((field) => isValueFilled(formData[field]))
    const projectStarted = projectFields.some((field) => isValueFilled(formData[field]))
    const audienceCompleted =
      audienceAndPlanFields.every((field) => isValueFilled(formData[field])) &&
      formData.contentFormats.length > 0 &&
      formData.platforms.length > 0
    const audienceStarted =
      audienceAndPlanFields.some((field) => isValueFilled(formData[field])) ||
      formData.contentFormats.length > 0 ||
      formData.platforms.length > 0
    const hasDraftPlan = Boolean(draftPlanResult?.draft?.draft_content_plan)
    const hasOptimizedPlan = Boolean(optimizationResult?.optimized_content_plan)
    const isOnResultsStep = isDeveloper ? currentStep === 5 : currentStep === 4

    const evolutionStatus =
      hasDraftPlan || hasOptimizedPlan ? 'completed' : currentStep === 4 ? 'in_progress' : 'pending'
    const resultsStatus =
      isSearchingPrecedents || isSeedingPrecedents || isGeneratingDraftPlan || isOptimizingPlan
        ? 'in_progress'
        : hasOptimizedPlan || hasDraftPlan
        ? 'completed'
        : isOnResultsStep && filledRequired < requiredFields.length
        ? 'attention'
        : isOnResultsStep
        ? 'in_progress'
        : 'pending'

    const base = [
      isParsingFromUrls || isEnriching
        ? 'in_progress'
        : hasCompetitorData
        ? 'completed'
        : hasCompetitorUrls
        ? 'in_progress'
        : 'pending',
      projectCompleted ? 'completed' : projectStarted ? (currentStep > 2 ? 'attention' : 'in_progress') : 'pending',
      audienceCompleted
        ? 'completed'
        : audienceStarted
        ? currentStep > 3
          ? 'attention'
          : 'in_progress'
        : 'pending'
    ]
    if (isDeveloper) {
      base.push(evolutionStatus, resultsStatus)
    } else {
      base.push(resultsStatus)
    }
    return base
  }, [
    competitorUrls,
    competitorsData,
    currentStep,
    draftPlanResult,
    isDeveloper,
    filledRequired,
    formData,
    isEnriching,
    isGeneratingDraftPlan,
    isOptimizingPlan,
    isParsingFromUrls,
    isSearchingPrecedents,
    isSeedingPrecedents,
    optimizationResult
  ])

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
    setCurrentStep((prev) => Math.min(prev, wizardSteps.length))
  }, [wizardSteps.length])

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
    const error = validateFieldValue(name, value ?? '', formData)
    setErrors(prev => ({ ...prev, [name]: error }))
    return !error
  }

  const loadExample = async (exampleName) => {
    try {
      const response = await fetch(`/examples/${exampleName}.json`)
      if (!response.ok) throw new Error('Файл не найден')
      const data = await response.json()
      
      // Преобразуем данные из формата экспорта в формат формы
      setFormData(mapExamplePayloadToFormData(data))
      setIsEditMode(true)
      addToast(`Пример "${exampleName.replace('example_', '').replace(/_/g, ' ')}" загружен`, 'success')
    } catch (error) {
      console.error('Ошибка загрузки примера:', error)
      addToast('Ошибка загрузки примера. Убедитесь, что файлы находятся в папке public/examples', 'error')
    }
  }

  const handleSearchPrecedents = async () => {
    const query = buildSuggestedPrecedentQuery(formData).trim()

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

  const handleExportOntologyToExcel = async () => {
    if (isEnrichmentServerAvailable === false) {
      addToast('Сервер недоступен. Запустите backend на порту 3001.', 'error')
      return
    }
    setIsExportingOntology(true)
    try {
      await exportOntologyToExcel()
      addToast('Онтология экспортирована в Excel', 'success')
    } catch (error) {
      console.error('Ошибка экспорта онтологии:', error)
      addToast(`Ошибка: ${error.message}`, 'error')
    } finally {
      setIsExportingOntology(false)
    }
  }

  const handleReset = () => {
    if (window.confirm('Вы уверены, что хотите очистить все поля формы?')) {
      setFormData(initialFormData)
      setErrors({})
      setTouched({})
      clearCompetitors()
      localStorage.removeItem('projectFormDraft')
      addToast('Форма очищена', 'info')
    }
  }

  const handleLoadHorizonExample = async (exampleName) => {
    if (!exampleName) return
    if (exampleName === demoHorizonExample) return

    const label = demoHorizonExampleOptions[exampleName] || exampleName
    if (!window.confirm(`Загрузить пример данных (${label})? Текущие данные будут заменены.`)) return

    setDemoHorizonExample(exampleName)
    await loadExample(exampleName)
  }

  const handleLoadExample = () => {
    if (window.confirm('Загрузить пример данных? Текущие данные будут заменены.')) {
      // Пример данных из project_data_example.json
      setFormData(demoExampleFormData)
      setErrors({})
      setTouched({})
      addToast('Пример данных загружен', 'success')
    }
  }

  const handleGenerateDraftPlan = async () => {
    const formValidation = validateFormData(formData)
    if (!formValidation.isValid) {
      setErrors(formValidation.errors)
      setTouched(
        Object.keys(formValidation.errors).reduce((acc, key) => ({ ...acc, [key]: true }), {})
      )
      addToast('Перед генерацией заполните обязательные поля формы', 'error')
      return
    }

    const safeFormInput = buildSafeFormInputForGeneration(formData)

    setIsGeneratingDraftPlan(true)
    addToast('Генерация чернового контент-плана по данным формы и прецедентам...', 'info')

    try {
      const response = await generateDraftContentPlan({
        form_input: safeFormInput,
        rag_query: precedentSearchQuery || undefined,
        rag_limit: 8
      })

      setDraftPlanResult(response)
      setOptimizationResult(null)
      // Если LLM вернул черновой контент-план, сохраняем его для страницы просмотра
      if (response?.draft?.draft_content_plan) {
        try {
          savePlanSnapshot(response.draft.draft_content_plan, {
            type: 'draft'
          })
        } catch (e) {
          console.error('Не удалось сохранить контент-план в localStorage:', e)
        }
      }
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

  const handleOptimizeDraftPlan = async () => {
    const draft = draftPlanResult?.draft?.draft_content_plan
    if (!draft) {
      addToast('Сначала сформируйте черновой контент-план (RAG → LLM)', 'error')
      return
    }

    const precedentPubs = Array.isArray(precedentSearchResults?.publications)
      ? precedentSearchResults.publications.map((item) => item.data).filter(Boolean)
      : []

    const alphaByDimension = buildAlphaByDimension(precedentPubs, formData.evoOptimizationGoal)
    const gaConfig = buildGaConfigFromForm(formData)

    const totalBudget =
      parseNumberOrNull(formData.evoBudgetLimit) ??
      parseNumberOrNull(formData.totalBudget) ??
      parseNumberOrNull(draft?.constraints?.total_budget) ??
      null
    const maxCost =
      parseNumberOrNull(formData.maxCostPerPublication) ??
      parseNumberOrNull(draft?.constraints?.max_cost_per_publication) ??
      null
    const minPubs =
      parseNumberOrNull(formData.minPublications) ??
      parseNumberOrNull(draft?.constraints?.min_publications) ??
      null

    const qualityMin =
      parseNumberOrNull(draft?.kpi_targets?.avg_engagement_rate) ??
      0

    const payload = {
      draft_content_plan: draft,
      stage1: {
        precedentPublications: precedentPubs,
        alphaByDimension,
        constraints: {
          date_min: formData.contentPlanStartDate || draft?.planning_horizon?.start_date || null,
          date_max: formData.contentPlanEndDate || draft?.planning_horizon?.end_date || null,
          quality_min: qualityMin,
          quality_max: null
        },
        ga: gaConfig
      },
      stage2: {
        constraints: {
          min_publications: minPubs,
          total_budget: totalBudget,
          max_cost_per_publication: maxCost,
          quality_min: qualityMin
        },
        ga: {
          ...gaConfig,
          crossoverMethod: gaConfig.crossoverMethod
        }
      }
    }

    setIsOptimizingPlan(true)
    addToast('Запуск эволюционной оптимизации (2 уровня ГА)...', 'info')
    try {
      const response = await optimizeDraftContentPlan(payload)
      setOptimizationResult(response)

      if (response?.optimized_content_plan) {
        try {
          savePlanSnapshot(response.optimized_content_plan, {
            type: 'optimized',
            optimization: {
              optimized_at: new Date().toISOString(),
              stage1: response.stage1 || null,
              stage2: response.stage2 || null
            }
          })
        } catch (e) {
          console.error('Не удалось сохранить оптимизированный план в localStorage:', e)
        }
      }

      addToast('Оптимизация завершена: план обновлён', 'success')
    } catch (error) {
      console.error('Ошибка оптимизации:', error)
      addToast(`Ошибка оптимизации: ${error.message}`, 'error')
    } finally {
      setIsOptimizingPlan(false)
    }
  }

  const hasError = (fieldName) => touched[fieldName] && errors[fieldName]
  const isFirstStep = currentStep === 1
  const isLastStep = currentStep === wizardSteps.length

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
        <WizardHeader
          currentStep={currentStep}
          wizardSteps={wizardSteps}
          onStepClick={goToStep}
          stepStatuses={stepStatuses}
        />

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
              showEnrichButton={isDeveloper}
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

        {/* Параметры эволюционного моделирования (опционально) — только для специалиста-программиста */}
        {currentStep === 4 && isDeveloper && <section className="form-section">
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

        {((isDeveloper && currentStep === 5) || (!isDeveloper && currentStep === 4)) && (
          <>
            <WorkflowSummaryPanel
              filledRequired={filledRequired}
              requiredCount={requiredFields.length}
              progress={progress}
              competitorsCount={competitorsData?.competitors?.length || 0}
              precedentsSummary={precedentsSummary}
              reviewChecklist={reviewChecklist}
              isEnrichmentServerAvailable={isEnrichmentServerAvailable}
              hasDraftPlan={Boolean(draftPlanResult?.draft?.draft_content_plan)}
              hasOptimizedPlan={Boolean(optimizationResult?.optimized_content_plan)}
            />

            <PrecedentSearchPanel
              precedentsSummary={precedentsSummary}
              precedentSearchQuery={precedentSearchQuery}
              precedentSearchResults={precedentSearchResults}
              demoHorizonExample={demoHorizonExample}
              onLoadHorizonExample={handleLoadHorizonExample}
              onSeedDemoPrecedents={handleSeedDemoPrecedents}
              showDemoButtons={isDeveloper}
              onExportOntologyToExcel={handleExportOntologyToExcel}
              onSearchPrecedents={handleSearchPrecedents}
              isProcessing={isProcessing}
              isExportingOntology={isExportingOntology}
              isGeneratingDraftPlan={isGeneratingDraftPlan}
              isSeedingPrecedents={isSeedingPrecedents}
              isSearchingPrecedents={isSearchingPrecedents}
              isEnrichmentServerAvailable={isEnrichmentServerAvailable}
              retrievalBadge={retrievalBadge}
              precedentRetrieval={precedentRetrieval}
              onSelectPrecedent={setSelectedPrecedentItem}
            />

            <DraftPlanWorkflowPanel
              draftPlanResult={draftPlanResult}
              optimizationResult={optimizationResult}
              onGenerateDraftPlan={handleGenerateDraftPlan}
              onOptimizeDraftPlan={handleOptimizeDraftPlan}
              onOpenPlan={() => navigate('/content-plan')}
              isGeneratingDraftPlan={isGeneratingDraftPlan}
              isOptimizingPlan={isOptimizingPlan}
              isProcessing={isProcessing}
              isEnrichmentServerAvailable={isEnrichmentServerAvailable}
            />

            {isDeveloper && (
              <TechnicalDetailsPanel
                precedentSearchQuery={precedentSearchQuery}
                precedentSearchResults={precedentSearchResults}
                draftPlanResult={draftPlanResult}
                optimizationResult={optimizationResult}
              />
            )}
          </>
        )}

        <WizardNavActions
          goToPrevStep={goToPrevStep}
          goToNextStep={goToNextStep}
          isFirstStep={isFirstStep}
          isLastStep={isLastStep}
          currentStep={currentStep}
          wizardSteps={wizardSteps}
          stepStatuses={stepStatuses}
        />
      </form>

      {!!selectedPrecedentItem && (
        <PrecedentDetailsModal
          item={selectedPrecedentItem}
          retrieval={precedentRetrieval}
          onClose={() => setSelectedPrecedentItem(null)}
          showTechnicalDetails={isDeveloper}
        />
      )}
    </>
  )
}

export default ProjectForm
