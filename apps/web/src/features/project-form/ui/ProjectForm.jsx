import React, { useState, useMemo, useEffect, useRef, useReducer, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { ToastContainer } from '../../../shared/ui/Toast'
import CompetitorsStep from './competitors/CompetitorsStep'
import ProcessIndicator from '../../../shared/ui/ProcessIndicator'
import WizardHeader from '../../../shared/ui/WizardHeader'
import WizardNavActions from '../../../shared/ui/WizardNavActions'
import WorkflowSummaryPanel from './projectForm/WorkflowSummaryPanel'
import PrecedentSearchPanel from './projectForm/PrecedentSearchPanel'
import OnboardingMaster from './projectForm/OnboardingMaster'
import FieldHint from './projectForm/FieldHint'
import DraftPlanWorkflowPanel from './projectForm/DraftPlanWorkflowPanel'
import OptimizationTracePanel from './projectForm/OptimizationTracePanel'
import TechnicalDetailsPanel from './projectForm/TechnicalDetailsPanel'
import OperationStatusPanel from './projectForm/OperationStatusPanel'
import { getCurrentProcessId, initialWizardState, wizardReducer } from './projectForm/wizardState'
import { useCompetitorsPipeline } from '../model/useCompetitorsPipeline'
import {
  getAggregatedOntology,
  getPrecedentsSummary,
  searchPrecedents,
  seedDemoPrecedents,
  exportOntologyToExcel,
  generateDraftContentPlan,
  optimizeDraftContentPlan,
  getServerDraft,
  saveServerDraft
} from '../../../shared/api/enrichmentService'
import { savePlanSnapshot } from '../../content-plan/model/planStorage'
import PrecedentDetailsModal from './precedents/PrecedentDetailsModal'
import { useUserRole } from '../../../app/providers/UserRoleContext'
import {
  consumerCategoryOptions,
  contentFormatOptions,
  demoExampleFormData,
  demoHorizonExampleOptions,
  frequencyOptions,
  getWizardSteps,
  initialFormData,
  publicationDayModeOptions,
  platformOptions,
  requiredFields
} from './projectForm/formConfig'
import {
  buildGaConfigFromForm,
  buildReviewChecklist,
  buildSafeFormInputForGeneration,
  buildSuggestedPrecedentQuery,
  mapExamplePayloadToFormData,
  parseNumberOrNull,
  validateFieldValue,
  validateFormData
} from './projectForm/formUtils'
import { buildRiskSummary } from './projectForm/riskSummaryUtils'
import './ProjectForm.css'

const PUBLICATION_FREQUENCY_TO_WEEKLY = {
  daily: 7,
  '3-4_per_week': 3.5,
  '2-3_per_week': 2.5,
  weekly: 1,
  '2_per_week': 2
}

const toOptionLabelMap = (options = []) =>
  options.reduce((acc, option) => {
    acc[option.value] = option.label
    return acc
  }, {})

const ProjectForm = () => {
  const navigate = useNavigate()
  const { isDeveloper, isAnalyst, isExtendedMode } = useUserRole()
  const [wizardState, dispatch] = useReducer(wizardReducer, initialWizardState)

  const wizardSteps = getWizardSteps(isDeveloper, isAnalyst)

  const {
    formData,
    errors,
    touched,
    toasts,
    isEditMode,
    precedentsSummary,
    precedentSearchQuery,
    precedentSearchResults,
    aggregatedOntology,
    draftPlanResult,
    optimizationResult,
    currentStep,
    selectedPrecedentItem,
    demoHorizonExample,
    operations,
    operationTelemetry,
    reviewChecklistChecked
  } = wizardState
  const isLoadingOntology = operations.loadingOntology?.status === 'running'
  const isSearchingPrecedents = operations.searchingPrecedents?.status === 'running'
  const isSeedingPrecedents = operations.seedingPrecedents?.status === 'running'
  const isExportingOntology = operations.exportingOntology?.status === 'running'
  const isGeneratingDraftPlan = operations.generatingPlan?.status === 'running'
  const isOptimizingPlan = operations.optimizingPlan?.status === 'running'
  // Общий флаг "идет работа" для блокировки неуместных действий.
  const isProcessing =
    isSearchingPrecedents || isSeedingPrecedents || isGeneratingDraftPlan || isOptimizingPlan || isExportingOntology
  const toastCounterRef = useRef(0)
  const operationControllersRef = useRef({})
  const operationRetryRef = useRef({})
  const restoreDraftCancelledRef = useRef(false)

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
  const consumerCategoryLabelMap = useMemo(() => toOptionLabelMap(consumerCategoryOptions), [])
  const platformLabelMap = useMemo(() => toOptionLabelMap(platformOptions), [])
  const contentFormatLabelMap = useMemo(() => toOptionLabelMap(contentFormatOptions), [])

  const riskSummary = useMemo(
    () => {
      const plan =
        optimizationResult?.optimized_content_plan || draftPlanResult?.draft?.draft_content_plan
      return plan ? buildRiskSummary(plan, formData) : []
    },
    [draftPlanResult, optimizationResult, formData]
  )

  const isValueFilled = (value) => {
    if (Array.isArray(value)) return value.length > 0
    if (typeof value === 'string') return value.trim() !== ''
    return value !== null && value !== undefined
  }

  const setFormData = (updater) => {
    const next = typeof updater === 'function' ? updater(formData) : updater
    dispatch({ type: 'SET_FORM_DATA', payload: next })
  }
  const setErrors = (payload) => dispatch({ type: 'SET_ERRORS', payload: typeof payload === 'function' ? payload(errors) : payload })
  const setTouched = (payload) =>
    dispatch({ type: 'SET_TOUCHED', payload: typeof payload === 'function' ? payload(touched) : payload })
  const setPrecedentsSummary = (payload) => dispatch({ type: 'SET_PRECEDENTS_SUMMARY', payload })
  const setPrecedentSearchQuery = (payload) => dispatch({ type: 'SET_PRECEDENT_QUERY', payload })
  const setPrecedentSearchResults = (payload) => dispatch({ type: 'SET_PRECEDENT_RESULTS', payload })
  const setAggregatedOntology = (payload) => dispatch({ type: 'SET_AGGREGATED_ONTOLOGY', payload })
  const setDraftPlanResult = (payload) => dispatch({ type: 'SET_DRAFT_PLAN_RESULT', payload })
  const setOptimizationResult = (payload) => dispatch({ type: 'SET_OPTIMIZATION_RESULT', payload })
  const setCurrentStep = (payload) =>
    dispatch({ type: 'SET_CURRENT_STEP', payload: typeof payload === 'function' ? payload(currentStep) : payload })
  const setSelectedPrecedentItem = (payload) => dispatch({ type: 'SET_SELECTED_PRECEDENT', payload })
  const setDemoHorizonExample = (payload) => dispatch({ type: 'SET_DEMO_HORIZON', payload })
  const setIsEditMode = (payload) => dispatch({ type: 'SET_EDIT_MODE', payload })
  const toggleReviewChecklistItem = (id) => dispatch({ type: 'TOGGLE_REVIEW_CHECKLIST_ITEM', payload: id })

  const addToast = (message, type = 'success') => {
    toastCounterRef.current += 1
    const id = `${Date.now()}-${toastCounterRef.current}-${Math.random().toString(36).substr(2, 9)}`
    dispatch({ type: 'PUSH_TOAST', payload: { id, message, type } })
  }

  const setOperationTelemetry = (payload) => dispatch({ type: 'SET_OPERATION_TELEMETRY', payload })

  const startOperation = (operationId) => dispatch({ type: 'OPERATION_START', payload: operationId })
  const finishOperationSuccess = (operationId) => dispatch({ type: 'OPERATION_SUCCESS', payload: operationId })
  const finishOperationError = (operationId, error) =>
    dispatch({ type: 'OPERATION_ERROR', payload: { operationId, error } })

  const runTrackedOperation = useCallback(
    async (operationId, operationFn) => {
      const controller = new AbortController()
      operationControllersRef.current[operationId] = controller
      operationRetryRef.current[operationId] = () => runTrackedOperation(operationId, operationFn)
      startOperation(operationId)
      try {
        await operationFn(controller.signal)
        finishOperationSuccess(operationId)
      } catch (error) {
        if (error?.name === 'AbortError') {
          dispatch({ type: 'OPERATION_CANCEL', payload: operationId })
          return
        }
        finishOperationError(operationId, error?.message || 'Ошибка выполнения')
        throw error
      } finally {
        delete operationControllersRef.current[operationId]
      }
    },
    []
  )

  const cancelOperation = (operationId) => {
    const controller = operationControllersRef.current[operationId]
    if (controller) {
      controller.abort()
      addToast(`Операция отменена: ${operationId}`, 'info')
    }
  }

  const retryOperation = async (operationId) => {
    const retryFn = operationRetryRef.current[operationId]
    if (!retryFn) return
    try {
      await retryFn()
      addToast(`Операция повторена: ${operationId}`, 'success')
    } catch (error) {
      addToast(`Повтор не удался: ${error.message}`, 'error')
    }
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
    () =>
      buildReviewChecklist(
        formData,
        competitorsData,
        precedentSearchResults,
        draftPlanResult,
        reviewChecklistChecked
      ),
    [formData, competitorsData, precedentSearchResults, draftPlanResult, reviewChecklistChecked]
  )
  const explainabilitySignals = useMemo(
    () => [
      formData.projectDescription ? 'Описание проекта' : null,
      formData.consumerCategory
        ? `Аудитория: ${consumerCategoryLabelMap[formData.consumerCategory] || formData.consumerCategory}`
        : null,
      formData.platforms.length
        ? `Платформы: ${formData.platforms
            .map((platform) => platformLabelMap[platform] || platform)
            .join(', ')}`
        : null,
      formData.contentFormats.length
        ? `Форматы: ${formData.contentFormats
            .map((format) => contentFormatLabelMap[format] || format)
            .join(', ')}`
        : null,
      precedentSearchQuery ? 'RAG-запрос по данным формы' : null,
      (precedentSearchResults?.publications?.length || 0) > 0 ? 'Сигналы из релевантных публикаций' : null
    ].filter(Boolean),
    [
      formData,
      precedentSearchQuery,
      precedentSearchResults,
      consumerCategoryLabelMap,
      platformLabelMap,
      contentFormatLabelMap
    ]
  )

  /** Для SMM: блокировка действий до выполнения пунктов проверки и чеклиста. */
  const { canSearchPrecedents, canGenerateDraft, smmBlockedReasonsForSearch, smmBlockedReasonsForGenerate } =
    useMemo(() => {
      const requiredFieldsDone = reviewChecklist[0]?.done
      const competitorsDone = reviewChecklist[1]?.done
      const precedentsDone = reviewChecklist[2]?.done
      const checklistReviewed = !!reviewChecklistChecked?.reviewed
      const backendOk = isEnrichmentServerAvailable === true

      const reasonsForSearch = []
      if (!backendOk) reasonsForSearch.push('Backend недоступен')
      if (!requiredFieldsDone) reasonsForSearch.push('Обязательные поля формы не заполнены')
      if (!competitorsDone) reasonsForSearch.push('Нет данных конкурентов')

      const reasonsForGenerate = [...reasonsForSearch]
      if (!precedentsDone) reasonsForGenerate.push('Прецеденты не подобраны')
      if (!checklistReviewed) reasonsForGenerate.push('Отметьте «Проверено перед генерацией» в чеклисте')

      const canSearch = backendOk && requiredFieldsDone && competitorsDone
      const canGen =
        backendOk && requiredFieldsDone && competitorsDone && precedentsDone && checklistReviewed

      return {
        canSearchPrecedents: isDeveloper ? true : canSearch,
        canGenerateDraft: isDeveloper ? true : canGen,
        smmBlockedReasonsForSearch: reasonsForSearch,
        smmBlockedReasonsForGenerate: reasonsForGenerate
      }
    }, [reviewChecklist, reviewChecklistChecked, isEnrichmentServerAvailable, isDeveloper])

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
      'minPublications'
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
    const isOnResultsStep = isExtendedMode ? currentStep === 5 : currentStep === 4

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
    if (isExtendedMode) {
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
    isExtendedMode,
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
    const restoreDraft = async () => {
      try {
        const serverDraftResponse = await getServerDraft()
        if (restoreDraftCancelledRef.current) return
        const serverDraft = serverDraftResponse?.draft?.formData
        if (serverDraft && typeof serverDraft === 'object') {
          setFormData(serverDraft)
          return
        }
      } catch (error) {
        console.error('Ошибка загрузки server-side черновика:', error)
      }
      if (restoreDraftCancelledRef.current) return

      const savedDraft = localStorage.getItem('projectFormDraft')
      if (savedDraft) {
        try {
          const draft = JSON.parse(savedDraft)
          setFormData(draft)
        } catch (e) {
          console.error('Ошибка загрузки локального черновика:', e)
        }
      }
    }

    restoreDraft()
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
        saveServerDraft({ formData }).catch((error) => {
          console.error('Ошибка сохранения server-side черновика:', error)
        })
      }, 1000)
      return () => clearTimeout(timeoutId)
    }
  }, [formData])

  const removeToast = (id) => {
    dispatch({ type: 'REMOVE_TOAST', payload: id })
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

    setPrecedentSearchQuery(query)
    setOperationTelemetry({ backend: 'running', python: 'idle', llm: 'idle' })
    try {
      await runTrackedOperation('searchingPrecedents', async (signal) => {
        const response = await searchPrecedents(
          {
            query,
            limit: 5,
            platform: formData.platforms[0] || undefined,
            audience_segments: formData.consumerCategory ? [formData.consumerCategory] : []
          },
          { signal }
        )

        setPrecedentSearchResults(response.results || null)
        addToast('Поиск прецедентов завершён', 'success')

        const summaryResponse = await getPrecedentsSummary({ signal })
        setPrecedentsSummary(summaryResponse.summary || null)
      })
      setOperationTelemetry({ backend: 'success', python: 'idle', llm: 'idle' })
    } catch (error) {
      console.error('Ошибка поиска прецедентов:', error)
      addToast(`Ошибка поиска прецедентов: ${error.message}`, 'error')
      setOperationTelemetry({ backend: 'error', python: 'idle', llm: 'idle' })
    }
  }

  const handleSeedDemoPrecedents = async () => {
    if (isEnrichmentServerAvailable === false) {
      addToast('Сервер недоступен. Убедитесь, что backend запущен и доступен по VITE_ENRICHMENT_API_URL.', 'error')
      return
    }
    setOperationTelemetry({ backend: 'running', python: 'idle', llm: 'idle' })
    try {
      await runTrackedOperation('seedingPrecedents', async (signal) => {
        await seedDemoPrecedents({ signal })
        const summaryResponse = await getPrecedentsSummary({ signal })
        setPrecedentsSummary(summaryResponse.summary || null)
        setAggregatedOntology(null)
        addToast('Демо-база прецедентов загружена. Можно искать по запросу.', 'success')
      })
      setOperationTelemetry({ backend: 'success', python: 'idle', llm: 'idle' })
    } catch (error) {
      console.error('Ошибка загрузки демо-базы:', error)
      addToast(`Ошибка: ${error.message}`, 'error')
      setOperationTelemetry({ backend: 'error', python: 'idle', llm: 'idle' })
    }
  }

  const handleExportOntologyToExcel = async () => {
    if (isEnrichmentServerAvailable === false) {
      addToast('Сервер недоступен. Убедитесь, что backend запущен и доступен по VITE_ENRICHMENT_API_URL.', 'error')
      return
    }
    setOperationTelemetry({ backend: 'running', python: 'idle', llm: 'idle' })
    try {
      await runTrackedOperation('exportingOntology', async (signal) => {
        await exportOntologyToExcel({ signal })
      })
      addToast('Онтология экспортирована в Excel', 'success')
      setOperationTelemetry({ backend: 'success', python: 'idle', llm: 'idle' })
    } catch (error) {
      console.error('Ошибка экспорта онтологии:', error)
      addToast(`Ошибка: ${error.message}`, 'error')
      setOperationTelemetry({ backend: 'error', python: 'idle', llm: 'idle' })
    }
  }

  const handleLoadOntology = async () => {
    if (isEnrichmentServerAvailable === false) {
      addToast('Сервер недоступен. Убедитесь, что backend запущен и доступен по VITE_ENRICHMENT_API_URL.', 'error')
      return
    }
    setOperationTelemetry({ backend: 'running', python: 'idle', llm: 'idle' })
    try {
      await runTrackedOperation('loadingOntology', async (signal) => {
        const response = await getAggregatedOntology({ signal })
        setAggregatedOntology(response.ontology || null)
      })
      addToast('Онтология загружена', 'success')
      setOperationTelemetry({ backend: 'success', python: 'idle', llm: 'idle' })
    } catch (error) {
      console.error('Ошибка загрузки онтологии:', error)
      addToast(`Ошибка загрузки онтологии: ${error.message}`, 'error')
      setOperationTelemetry({ backend: 'error', python: 'idle', llm: 'idle' })
    }
  }

  const handleReset = () => {
    if (window.confirm('Вы уверены, что хотите очистить все поля формы?')) {
      setFormData(initialFormData)
      setErrors({})
      setTouched({})
      clearCompetitors()
      localStorage.removeItem('projectFormDraft')
      saveServerDraft({ formData: initialFormData }).catch((error) => {
        console.error('Ошибка очистки server-side черновика:', error)
      })
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

    if (!isDeveloper) {
      const hasCompetitors = Array.isArray(competitorsData?.competitors) && competitorsData.competitors.length > 0
      const hasPrecedents =
        (precedentSearchResults?.publications?.length || 0) > 0 ||
        (precedentSearchResults?.content_plans?.length || 0) > 0
      if (!hasCompetitors) {
        addToast('Перед генерацией добавьте и обогатите конкурентов', 'error')
        return
      }
      if (!hasPrecedents) {
        addToast('Перед генерацией подберите прецеденты (кнопка «Подобрать прецеденты»)', 'error')
        return
      }
    }

    const safeFormInput = buildSafeFormInputForGeneration(formData)

    addToast('Генерация чернового контент-плана по данным формы и прецедентам...', 'info')
    setOperationTelemetry({ backend: 'running', python: 'running', llm: 'running' })
    try {
      await runTrackedOperation('generatingPlan', async (signal) => {
        const response = await generateDraftContentPlan(
          {
            form_input: safeFormInput,
            rag_query: precedentSearchQuery || undefined,
            rag_limit: 8
          },
          { signal }
        )

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
      })
      addToast('Черновой контент-план успешно сгенерирован', 'success')
      setOperationTelemetry({ backend: 'success', python: 'success', llm: 'success' })
    } catch (error) {
      console.error('Ошибка генерации чернового плана:', error)
      addToast(`Ошибка генерации: ${error.message}`, 'error')
      setOperationTelemetry({ backend: 'error', python: 'error', llm: 'error' })
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

    const gaConfig = buildGaConfigFromForm(formData)

    const publicationDayMode = draft?.schedule_preferences?.publication_day_mode || formData.publicationDayMode
    const sharedModeMinPubs =
      publicationDayMode === 'shared'
        ? parseNumberOrNull(draft?.schedule_preferences?.generated_publications) ??
          parseNumberOrNull(draft?.publications?.length) ??
          null
        : null
    const minPubs =
      sharedModeMinPubs ??
      parseNumberOrNull(formData.minPublications) ??
      parseNumberOrNull(draft?.constraints?.min_publications) ??
      null

    const qualityMin =
      parseNumberOrNull(draft?.kpi_targets?.avg_engagement_rate) ??
      0
    const explicitPostsPerWeek =
      parseNumberOrNull(formData.postsPerWeek) ??
      PUBLICATION_FREQUENCY_TO_WEEKLY[formData.publicationFrequency] ??
      null
    const dateStart = formData.contentPlanStartDate || draft?.planning_horizon?.start_date || null
    const dateEnd = formData.contentPlanEndDate || draft?.planning_horizon?.end_date || null
    const horizonDays =
      dateStart && dateEnd
        ? Math.max(1, Math.round((new Date(dateEnd) - new Date(dateStart)) / (24 * 60 * 60 * 1000)) + 1)
        : null
    const derivedPostsPerWeek =
      explicitPostsPerWeek ??
      (horizonDays && minPubs ? Number(((minPubs * 7) / horizonDays).toFixed(2)) : null)

    if (!horizonDays || horizonDays <= 0) {
      addToast('Для эволюции нужна положительная длительность контент-плана', 'error')
      return
    }

    if (!derivedPostsPerWeek || derivedPostsPerWeek <= 0) {
      addToast('Укажите posts per week или выберите частоту публикаций', 'error')
      return
    }

    const payload = {
      draft_content_plan: draft,
      stage1: {
        precedentPublications: precedentPubs,
        constraints: {
          date_min: dateStart,
          date_max: dateEnd,
          duration_days: horizonDays,
          posts_per_week: derivedPostsPerWeek,
          posts_per_week_tolerance: 0.35,
          min_publications: minPubs,
          quality_min: qualityMin,
          quality_max: null
        },
        ga: gaConfig
      },
      stage2: {
        constraints: {
          tones_count: null,
          creativity_from_best_plan: null
        },
        ga: {
          ...gaConfig,
          crossoverMethod: gaConfig.crossoverMethod
        }
      }
    }

    addToast('Запуск эволюционной оптимизации (2 уровня ГА)...', 'info')
    setOperationTelemetry({ backend: 'running', python: 'running', llm: 'idle' })
    try {
      await runTrackedOperation('optimizingPlan', async (signal) => {
        const response = await optimizeDraftContentPlan(payload, { signal })
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
      })
      addToast('Оптимизация завершена: план обновлён', 'success')
      setOperationTelemetry({ backend: 'success', python: 'success', llm: 'idle' })
    } catch (error) {
      console.error('Ошибка оптимизации:', error)
      addToast(`Ошибка оптимизации: ${error.message}`, 'error')
      setOperationTelemetry({ backend: 'error', python: 'error', llm: 'idle' })
    }
  }

  const hasError = (fieldName) => touched[fieldName] && errors[fieldName]
  const visibleErrorEntries = useMemo(
    () =>
      Object.entries(errors).filter(
        ([fieldName, message]) => touched[fieldName] && typeof message === 'string' && message.trim().length > 0
      ),
    [errors, touched]
  )
  const isFirstStep = currentStep === 1

  const currentProcessId = useMemo(() => getCurrentProcessId(operations), [operations])
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
      <ProcessIndicator active={!!currentProcessId} processId={currentProcessId} />
      <OperationStatusPanel
        operations={operations}
        telemetry={operationTelemetry}
        onCancel={cancelOperation}
        onRetry={retryOperation}
        isDeveloper={isDeveloper}
      />

      <form className="project-form">
        {/* Прогресс-бар */}
        <WizardHeader
          currentStep={currentStep}
          wizardSteps={wizardSteps}
          onStepClick={goToStep}
          stepStatuses={stepStatuses}
        />

        {visibleErrorEntries.length > 0 && (
          <section className="form-section" role="alert" aria-live="polite">
            <h2 className="section-title">Ошибки формы</h2>
            <div className="workflow-checklist">
              {visibleErrorEntries.map(([fieldName, message]) => (
                <div key={fieldName} className="workflow-checklist-item is-pending">
                  <span className="workflow-checklist-mark">•</span>
                  <span>
                    {fieldName}: {message}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {currentStep === 1 && (
          <>
            <OnboardingMaster
              currentRole={isDeveloper ? 'developer' : isAnalyst ? 'analyst' : 'smm'}
              onApplyTemplate={(formData) => {
                restoreDraftCancelledRef.current = true
                setFormData(formData)
                setCurrentStep(2)
                addToast('Шаблон применён. Заполните наименования и даты при необходимости.', 'success')
              }}
              isCompact={true}
            />
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

          <div className="form-row">
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
              <label htmlFor="postsPerWeek" className="form-label">
                Постов в неделю <FieldHint fieldName="postsPerWeek" />
              </label>
              <input
                type="number"
                id="postsPerWeek"
                name="postsPerWeek"
                value={formData.postsPerWeek}
                onChange={handleChange}
                onBlur={handleBlur}
                className={`form-input ${hasError('postsPerWeek') ? 'error' : ''}`}
                placeholder="Например, 3.5"
                min="0.1"
                max="30"
                step="0.1"
                disabled={!isEditMode}
              />
              {hasError('postsPerWeek') && <span className="error-message">{errors.postsPerWeek}</span>}
              <small className="form-hint">
                Переопределяет частоту выше и идет как явная константа в GA контент-плана.
              </small>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Режим дат публикации</label>
            <div className="publication-day-mode-toggle" role="radiogroup" aria-label="Режим дат публикации">
              {publicationDayModeOptions.map((option) => {
                const isActive = formData.publicationDayMode === option.value
                return (
                  <label
                    key={option.value}
                    className={`publication-day-mode-option ${isActive ? 'is-active' : ''}`}
                  >
                    <input
                      type="radio"
                      name="publicationDayMode"
                      value={option.value}
                      checked={isActive}
                      onChange={handleChange}
                      onBlur={handleBlur}
                      disabled={!isEditMode}
                    />
                    <span className="publication-day-mode-option-title">{option.label}</span>
                    <span className="publication-day-mode-option-hint">{option.hint}</span>
                  </label>
                )
              })}
            </div>
            <small className="form-hint">
              Если результат не подойдет, даты потом можно вручную поправить в календаре плана.
            </small>
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

        {/* Параметры эволюционного моделирования (опционально) — для разработчика и аналитика */}
        {currentStep === 4 && isExtendedMode && <section className="form-section">
          <h2 className="section-title">Параметры эволюционного моделирования (опционально)</h2>
          
          {/* Основные параметры */}
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="evoPopulationSize" className="form-label">
                Размер популяции <FieldHint fieldName="evoPopulationSize" />
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
                Количество поколений <FieldHint fieldName="evoGenerations" />
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
                Критерий остановки <FieldHint fieldName="evoStopCriterion" />
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
                Цель оптимизации <FieldHint fieldName="evoOptimizationGoal" />
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
                <option value="balanced">Сбалансированная цель</option>
              </select>
            </div>
          </div>

          {/* Отбор */}
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="evoSelectionMethod" className="form-label">
                Метод отбора <FieldHint fieldName="evoSelectionMethod" />
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
                Размер турнира <FieldHint fieldName="evoTournamentSize" />
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
                Вероятность победы сильнейшего <FieldHint fieldName="evoBestWinProb" />
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
                Размер элиты <FieldHint fieldName="evoEliteSize" />
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
                Метод скрещивания <FieldHint fieldName="evoCrossoverMethod" />
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
                Вероятность скрещивания <FieldHint fieldName="evoCrossoverProbability" />
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
                Метод мутации <FieldHint fieldName="evoMutationMethod" />
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
                Вероятность мутации <FieldHint fieldName="evoMutationProbability" />
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
                  <span>Сохранять разнообразие <FieldHint fieldName="evoPreserveDiversity" /></span>
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    name="evoUseParallel"
                    checked={!!formData.evoUseParallel}
                    onChange={handleChange}
                    disabled={!isEditMode}
                  />
                  <span>Использовать параллельные вычисления <FieldHint fieldName="evoUseParallel" /></span>
                </label>
              </div>
            </div>
            <div className="form-group">
              <label htmlFor="evoRandomSeed" className="form-label">
                Семя случайности <FieldHint fieldName="evoRandomSeed" />
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

        {((isExtendedMode && currentStep === 5) || (!isExtendedMode && currentStep === 4)) && (
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
              publicationDayMode={formData.publicationDayMode}
              explainabilitySignals={explainabilitySignals}
              onChecklistToggle={toggleReviewChecklistItem}
              riskSummary={riskSummary}
            />

            <PrecedentSearchPanel
              precedentsSummary={precedentsSummary}
              precedentSearchQuery={precedentSearchQuery}
              precedentSearchResults={precedentSearchResults}
              aggregatedOntology={aggregatedOntology}
              demoHorizonExample={demoHorizonExample}
              onLoadHorizonExample={handleLoadHorizonExample}
              onSeedDemoPrecedents={handleSeedDemoPrecedents}
              showDemoButtons={isDeveloper}
              onExportOntologyToExcel={handleExportOntologyToExcel}
              onLoadOntology={handleLoadOntology}
              onSearchPrecedents={handleSearchPrecedents}
              isProcessing={isProcessing}
              isLoadingOntology={isLoadingOntology}
              isExportingOntology={isExportingOntology}
              isGeneratingDraftPlan={isGeneratingDraftPlan}
              isSeedingPrecedents={isSeedingPrecedents}
              isSearchingPrecedents={isSearchingPrecedents}
              isEnrichmentServerAvailable={isEnrichmentServerAvailable}
              canSearchPrecedents={canSearchPrecedents}
              smmBlockedReasons={smmBlockedReasonsForSearch}
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
              canGenerateDraft={canGenerateDraft}
              smmBlockedReasons={smmBlockedReasonsForGenerate}
              publicationDayMode={formData.publicationDayMode}
              isDeveloper={isDeveloper}
            />

            {!!optimizationResult?.optimized_content_plan && (
              <OptimizationTracePanel optimizationResult={optimizationResult} />
            )}

            {(draftPlanResult?.draft?.draft_content_plan || optimizationResult?.optimized_content_plan) && (
              <section className="form-section precedent-workflow-section">
                <div className="workflow-section-heading">
                  <div>
                    <h2 className="section-title">Планирование публикаций</h2>
                    <p className="workflow-section-subtitle">
                      Для удобного планирования откройте отдельный экран календаря: там есть режимы
                      Карточки/Таблица/Календарь и drag-and-drop по датам и платформам.
                    </p>
                  </div>
                </div>
                <div className="workflow-action-row">
                  <button type="button" className="submit-button secondary" onClick={() => navigate('/content-plan')}>
                    <span>ОТКРЫТЬ КАЛЕНДАРЬ ПЛАНА</span>
                  </button>
                </div>
              </section>
            )}

            {isExtendedMode && (
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
