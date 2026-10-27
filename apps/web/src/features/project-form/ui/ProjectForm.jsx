import React, { useState, useMemo, useEffect, useRef, useReducer, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { ToastContainer } from '../../../shared/ui/Toast'
import CompetitorsStep from './competitors/CompetitorsStep'
import AutoResizeTextarea from '../../../shared/ui/AutoResizeTextarea'
import KeyDatesEditor from './projectForm/KeyDatesEditor'
import WizardHeader from '../../../shared/ui/WizardHeader'
import WizardNavActions from '../../../shared/ui/WizardNavActions'
import WorkflowSummaryPanel from './projectForm/WorkflowSummaryPanel'
import PrecedentSearchPanel from './projectForm/PrecedentSearchPanel'
import FieldHint from './projectForm/FieldHint'
import DraftPlanWorkflowPanel from './projectForm/DraftPlanWorkflowPanel'
import TechnicalDetailsPanel from './projectForm/TechnicalDetailsPanel'
import OnboardingMaster from './projectForm/OnboardingMaster'
import { initialWizardState, wizardReducer } from './projectForm/wizardState'
import { useCompetitorsPipeline } from '../model/useCompetitorsPipeline'
import { buildRetrievalBadge } from '../lib/precedentPresentationUtils'
import {
  planMarketerCombinedWorkflow,
  isGenerationBlockedByBackend
} from '../lib/workflowUiUtils'
import { getCurrentUserId } from '../../../shared/api/authService'
import {
  getAggregatedOntology,
  getPrecedentsSummary,
  searchPrecedents,
  seedDemoPrecedents,
  exportOntologyToExcel,
  generateDraftContentPlan,
  optimizeDraftContentPlan,
  getActiveOptimizationJobId,
  clearActiveOptimizationJobId,
  getJobStatusFromServer,
  trackOptimizationJob,
  getServerDraft,
  saveServerDraft
} from '../../../shared/api/enrichmentService'
import { savePlanSnapshot } from '../../content-plan/model/planStorage'
import PrecedentDetailsModal from './precedents/PrecedentDetailsModal'
import { useUserRole } from '../../../app/providers/UserRoleContext'
import { useInstagramAccess } from '../../../shared/lib/useInstagramAccess'
import {
  STEP_META,
  consumerCategoryOptions,
  contentFormatOptions,
  demoHorizonExampleOptions,
  frequencyOptions,
  getWizardStepIds,
  getWizardSteps,
  initialFormData,
  publicationDayModeOptions,
  platformOptions,
  instagramPlatformOption,
  requiredFields
} from './projectForm/formConfig'
import {
  buildPlanGaConfigFromForm,
  buildPostGaConfigFromForm,
  buildReviewChecklist,
  buildSafeFormInputForGeneration,
  buildSuggestedPrecedentQuery,
  buildTimelineRange,
  competitorsStepRequirementMet,
  hasLocalCompetitorsInForm,
  hasPersistedPrecedentsInDb,
  hasPrecedentsForWorkflow,
  getRecommendedPublicationsByFrequency,
  mapExamplePayloadToFormData,
  parseNumberOrNull,
  validateFieldValue,
  validateFormData
} from './projectForm/formUtils'
import { buildRiskSummary } from './projectForm/riskSummaryUtils'
import './ProjectForm.css'

const getLocalDraftStorageKey = () => {
  const userId = getCurrentUserId()
  return userId ? `projectFormDraft:${userId}` : 'projectFormDraft'
}

const FIELD_LABELS_RU = {
  producerName: 'Наименование производителя',
  producerActivitySpecification: 'Специфика деятельности',
  projectName: 'Наименование IT-проекта',
  projectDescription: 'Описание IT-проекта',
  consumerCategory: 'Категория потребителя',
  contentPlanStartDate: 'Дата начала',
  contentPlanEndDate: 'Дата окончания',
  publicationFrequency: 'Частота публикаций',
  contentFormats: 'Формат публикаций',
  platforms: 'Платформы'
}

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

const buildAudienceSegmentsFromForm = (formData) =>
  Array.from(
    new Set(
      [
        formData.consumerCategory,
        ...String(formData.consumerDemographics || '')
          .split(/[,\n;]/)
          .map((item) => item.trim()),
        ...String(formData.consumerPurchaseGoal || '')
          .split(/[,\n;]/)
          .map((item) => item.trim())
      ].filter(Boolean)
    )
  ).slice(0, 8)

const hasEnrichedCompetitorsData = (competitorsData) => {
  const firstPost = competitorsData?.competitors?.[0]?.posts?.[0]
  return Boolean(firstPost?.publication_model)
}

function buildPinnedPublications(competitorsData) {
  const competitors = Array.isArray(competitorsData?.competitors) ? competitorsData.competitors : []
  const pinned = []
  for (const competitor of competitors) {
    const posts = Array.isArray(competitor?.posts) ? competitor.posts : []
    for (const post of posts) {
      const topic = String(post?.topic || post?.publication_model?.topic || '').trim()
      const content = String(post?.content || post?.summary || post?.publication_model?.summary || '').trim()
      if (topic.toLowerCase() === 'unspecified') continue
      if (!topic && content.length < 40) continue
      pinned.push({
        publication_id: post?.publication_model?.publication_id || null,
        platform: competitor.platform || null,
        competitor_name: competitor.name || null,
        url: post?.url || null,
        content: post?.content || null,
        metrics: post?.metrics || null,
        engagement_rate: post?.engagement_rate ?? null,
        topic,
        summary: post?.summary || post?.publication_model?.summary || content.slice(0, 500),
        objective: post?.objective || post?.publication_model?.objective || null,
        format: post?.format || post?.publication_model?.format || null,
        tone: post?.tone || post?.publication_model?.tone || null,
        publication_model: post?.publication_model || null
      })
      if (pinned.length >= 8) return pinned
    }
  }
  return pinned
}

const ProjectForm = () => {
  const navigate = useNavigate()
  const { isAnalyst, isSmm, isExtendedMode } = useUserRole()
  const allowInstagram = useInstagramAccess()
  const visiblePlatformOptions = useMemo(
    () => (allowInstagram ? [...platformOptions, instagramPlatformOption] : platformOptions),
    [allowInstagram]
  )
  // SMM и Аналитик — основные роли системы
  const [wizardState, dispatch] = useReducer(wizardReducer, initialWizardState)

  const wizardStepIds = getWizardStepIds(isAnalyst)
  const wizardSteps = getWizardSteps(isAnalyst)

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
    operations
  } = wizardState
  const currentStepId = wizardStepIds[currentStep - 1] || wizardStepIds[0]
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
  const restoreDraftCancelledRef = useRef(false)
  const hasRestoredDraftRef = useRef(false)
  const [optimizationLiveProgress, setOptimizationLiveProgress] = useState(null)

  const precedentRetrieval = precedentSearchResults?.retrieval || null

  const retrievalBadge = useMemo(
    () => buildRetrievalBadge(precedentRetrieval, { isAnalyst }),
    [precedentRetrieval, isAnalyst]
  )

  const filledRequired = useMemo(() => {
    return requiredFields.filter(field => {
      const value = formData[field]
      return value && (typeof value === 'string' ? value.trim() !== '' : true)
    }).length
  }, [formData])

  const progress = (filledRequired / requiredFields.length) * 100
  const consumerCategoryLabelMap = useMemo(() => toOptionLabelMap(consumerCategoryOptions), [])
  const platformLabelMap = useMemo(() => toOptionLabelMap(visiblePlatformOptions), [visiblePlatformOptions])
  const contentFormatLabelMap = useMemo(() => toOptionLabelMap(contentFormatOptions), [])

  const riskSummary = useMemo(
    () => {
      const plan =
        optimizationResult?.optimized_content_plan || draftPlanResult?.draft?.draft_content_plan
      return plan ? buildRiskSummary(plan, formData) : []
    },
    [draftPlanResult, optimizationResult, formData]
  )
  const recommendedPublications = useMemo(
    () => getRecommendedPublicationsByFrequency(formData),
    [formData]
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

  const goToStepById = useCallback(
    (stepId) => {
      const idx = wizardStepIds.indexOf(stepId)
      if (idx >= 0) {
        dispatch({ type: 'SET_CURRENT_STEP', payload: idx + 1 })
      }
    },
    [wizardStepIds]
  )

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [currentStep])

  useEffect(() => {
    if (currentStep > wizardSteps.length) {
      dispatch({ type: 'SET_CURRENT_STEP', payload: wizardSteps.length })
    }
  }, [wizardSteps.length, currentStep])

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
      }
    },
    []
  )

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
    canEnrich
  } = useCompetitorsPipeline(addToast, { isAnalyst })

  const reviewChecklist = useMemo(
    () =>
      buildReviewChecklist(formData, competitorsData, precedentSearchResults, draftPlanResult, precedentsSummary),
    [formData, competitorsData, precedentSearchResults, draftPlanResult, precedentsSummary]
  )
  const explainabilitySignals = useMemo(() => {
    const competitorsStepOk = competitorsStepRequirementMet(competitorsData, precedentsSummary)
    const hasLocalCompetitors = hasLocalCompetitorsInForm(competitorsData)
    const projectBasicDone = Boolean(
      formData.producerName?.trim() &&
        formData.producerActivitySpecification?.trim() &&
        formData.projectName?.trim() &&
        formData.projectDescription?.trim()
    )
    const datesAndFreqDone = Boolean(
      formData.contentPlanStartDate && formData.contentPlanEndDate && formData.publicationFrequency
    )
    return [
      {
        key: 'project_description',
        label: projectBasicDone
          ? `Проект: ${formData.projectName} (${formData.producerName})`
          : 'Сведения о проекте и производителе (Шаг 2)',
        done: projectBasicDone
      },
      {
        key: 'audience',
        label: `Аудитория и сроки: ${
          consumerCategoryLabelMap[formData.consumerCategory] || formData.consumerCategory || 'не выбрана'
        }${datesAndFreqDone ? ` · ${formData.contentPlanStartDate} — ${formData.contentPlanEndDate}` : ' · укажите даты и частоту'}`,
        done: Boolean(formData.consumerCategory) && datesAndFreqDone
      },
      {
        key: 'platforms',
        label: `Платформы: ${
          formData.platforms.length
            ? formData.platforms.map((platform) => platformLabelMap[platform] || platform).join(', ')
            : 'не выбраны'
        }`,
        done: formData.platforms.length > 0
      },
      {
        key: 'formats',
        label: `Форматы: ${
          formData.contentFormats.length
            ? formData.contentFormats.map((format) => contentFormatLabelMap[format] || format).join(', ')
            : 'не выбраны'
        }`,
        done: formData.contentFormats.length > 0
      },
      {
        key: 'competitors',
        label: competitorsStepOk
          ? hasLocalCompetitors
            ? 'Есть данные конкурентов в форме'
            : 'База прецедентов готова к использованию'
          : 'Нужна база примеров (прецедентов) или ссылки на конкурентов (Шаг 1)',
        done: competitorsStepOk
      }
    ]
  }, [
    formData,
    competitorsData,
    precedentsSummary,
    consumerCategoryLabelMap,
    platformLabelMap,
    contentFormatLabelMap
  ])

  /** Для SMM: блокировка действий до выполнения пунктов проверки и чеклиста. */
  const { canSearchPrecedents, canGenerateDraft, smmBlockedReasonsForSearch, smmBlockedReasonsForGenerate } =
    useMemo(() => {
      const requiredFieldsDone = reviewChecklist[0]?.done
      const competitorsDone = reviewChecklist[1]?.done
      const precedentsDone = reviewChecklist[2]?.done
      const backendOk = isEnrichmentServerAvailable === true

      const reasonsForSearch = []
      if (!backendOk) reasonsForSearch.push('Сервер недоступен')
      if (!requiredFieldsDone) reasonsForSearch.push('Заполните обязательные поля на шагах 2 и 3')
      if (!competitorsDone) {
        reasonsForSearch.push('Загрузите демо-базу прецедентов или добавьте конкурентов на шаге 1')
      }

      const reasonsForGenerate = [...reasonsForSearch]
      if (!precedentsDone) reasonsForGenerate.push('База прецедентов пуста (нажмите «Обновить демо-базу прецедентов» на шаге 1)')

      const canSearch = backendOk && requiredFieldsDone && competitorsDone
      const canGen = isSmm
        ? Boolean(backendOk && requiredFieldsDone)
        : Boolean(backendOk && requiredFieldsDone && competitorsDone && precedentsDone)

      return {
        canSearchPrecedents: canSearch,
        canGenerateDraft: canGen,
        smmBlockedReasonsForSearch: reasonsForSearch,
        smmBlockedReasonsForGenerate: reasonsForGenerate
      }
    }, [reviewChecklist, isEnrichmentServerAvailable, isSmm])

  const stepStatuses = useMemo(() => {
    const hasCompetitorUrls = competitorUrls.some((url) => typeof url === 'string' && url.trim() !== '')
    const competitorsStepDone = competitorsStepRequirementMet(competitorsData, precedentsSummary)
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
      'publicationFrequency'
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
    const precedentsReady = Boolean(
      precedentSearchResults ||
      (precedentsSummary?.publications_count || 0) + (precedentsSummary?.content_plans_count || 0) > 0
    )
    const projectStepIdx = wizardStepIds.indexOf('project') + 1
    const audienceStepIdx = wizardStepIds.indexOf('audience') + 1
    const statusById = {
      project: projectCompleted
        ? 'completed'
        : projectStarted
          ? currentStep > projectStepIdx
            ? 'attention'
            : 'in_progress'
          : currentStep === projectStepIdx
            ? 'in_progress'
            : 'pending',
      audience: audienceCompleted
        ? 'completed'
        : audienceStarted
          ? currentStep > audienceStepIdx
            ? 'attention'
            : 'in_progress'
          : currentStep === audienceStepIdx
            ? 'in_progress'
            : 'pending',
      competitors:
        isParsingFromUrls || isEnriching || isSeedingPrecedents
          ? 'in_progress'
          : competitorsStepDone
            ? 'completed'
            : hasCompetitorUrls || currentStepId === 'competitors'
              ? 'in_progress'
              : 'pending',
      precedents:
        isSearchingPrecedents || isSeedingPrecedents
          ? 'in_progress'
          : precedentsReady
            ? 'completed'
            : currentStepId === 'precedents'
              ? 'in_progress'
              : 'pending',
      draft: isGeneratingDraftPlan
        ? 'in_progress'
        : hasDraftPlan
          ? 'completed'
          : currentStepId === 'draft' && filledRequired < requiredFields.length
            ? 'attention'
            : currentStepId === 'draft'
              ? 'in_progress'
              : 'pending',
      optimize: isOptimizingPlan
        ? 'in_progress'
        : hasOptimizedPlan
          ? 'completed'
          : currentStepId === 'optimize'
            ? 'in_progress'
            : 'pending'
    }
    return wizardStepIds.map((stepId) => statusById[stepId] || 'pending')
  }, [
    competitorUrls,
    competitorsData,
    precedentsSummary,
    precedentSearchResults,
    currentStep,
    currentStepId,
    wizardStepIds,
    draftPlanResult,
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
    if (isEnrichmentServerAvailable === null) return
    restoreDraftCancelledRef.current = false

    const restoreLocalDraft = () => {
      if (restoreDraftCancelledRef.current) return
      if (hasRestoredDraftRef.current) return

      const scopedKey = getLocalDraftStorageKey()
      const savedDraft =
        localStorage.getItem(scopedKey) ||
        (scopedKey !== 'projectFormDraft' ? localStorage.getItem('projectFormDraft') : null)
      if (!savedDraft) {
        hasRestoredDraftRef.current = true
        return
      }

      try {
        const draft = JSON.parse(savedDraft)
        dispatch({ type: 'SET_FORM_DATA', payload: { ...initialFormData, ...draft } })
      } catch (e) {
        console.error('Ошибка загрузки локального черновика:', e)
      }

      hasRestoredDraftRef.current = true
    }

    const restoreDraft = async () => {
      // Всегда пробуем локальный черновик; серверный — только когда backend подтвержден как доступный.
      if (restoreDraftCancelledRef.current) return
      if (hasRestoredDraftRef.current) return
      if (isEnrichmentServerAvailable !== true) {
        restoreLocalDraft()
        return
      }

      try {
        const serverDraftResponse = await getServerDraft()
        if (restoreDraftCancelledRef.current) return
        const serverDraft = serverDraftResponse?.draft?.formData
        if (serverDraft && typeof serverDraft === 'object') {
          hasRestoredDraftRef.current = true
          dispatch({ type: 'SET_FORM_DATA', payload: { ...initialFormData, ...serverDraft } })
          return
        }
      } catch (error) {
        console.error('Ошибка загрузки server-side черновика:', error)
      }

      restoreLocalDraft()
    }

    restoreDraft()

    return () => {
      restoreDraftCancelledRef.current = true
    }
  }, [isEnrichmentServerAvailable, dispatch])

  useEffect(() => {
    if (isEnrichmentServerAvailable !== true) return

    const loadPrecedentsSummary = async () => {
      try {
        const response = await getPrecedentsSummary()
        setPrecedentsSummary(response.summary || null)
      } catch (error) {
        console.error('Ошибка загрузки сводки прецедентов:', error)
      }
    }

    loadPrecedentsSummary()
  }, [isEnrichmentServerAvailable])

  useEffect(() => {
    dispatch({ type: 'SET_CURRENT_STEP', payload: Math.min(currentStep, wizardSteps.length) })
  }, [currentStep, wizardSteps.length])

  // Восстановление активной задачи оптимизации из sessionStorage (при перезагрузке страницы)
  useEffect(() => {
    const activeJobId = getActiveOptimizationJobId()
    if (!activeJobId || isEnrichmentServerAvailable === false) return

    let cancelled = false
    const checkAndResumeJob = async () => {
      try {
        const res = await getJobStatusFromServer(activeJobId)
        if (cancelled) return
        const job = res?.job
        if (job?.status === 'running' || job?.status === 'queued') {
          addToast(`Восстановлена активная оптимизация плана (ID: ${activeJobId.slice(0, 8)}…)`, 'info')
          goToStepById('optimize')
          setOperationTelemetry({ backend: 'running', python: 'running', llm: 'running' })

          await runTrackedOperation('optimizingPlan', async (signal) => {
            const response = await trackOptimizationJob(activeJobId, {
              signal,
              onProgress: (prog) => {
                if (!cancelled) setOptimizationLiveProgress(prog)
              }
            })
            if (!cancelled) {
              setOptimizationResult(response)
              if (response?.optimized_content_plan) {
                try {
                  await savePlanSnapshot(response.optimized_content_plan, {
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
              setOperationTelemetry({ backend: 'success', python: 'success', llm: 'success' })
            }
          })
        } else if (job?.status === 'completed' && job.result) {
          clearActiveOptimizationJobId()
          setOptimizationResult(job.result)
          addToast('Восстановлен результат завершённой оптимизации плана', 'success')
        } else {
          clearActiveOptimizationJobId()
        }
      } catch (err) {
        clearActiveOptimizationJobId()
        console.warn('Не удалось восстановить активную задачу оптимизации:', err)
      }
    }

    checkAndResumeJob()
    return () => {
      cancelled = true
    }
  }, [isEnrichmentServerAvailable, goToStepById, runTrackedOperation])

  useEffect(() => {
    const firstPost = competitorsData?.competitors?.[0]?.posts?.[0]
    const hasNormalizedPublicationModel = !!firstPost?.publication_model

    if (!hasNormalizedPublicationModel) return
    if (isEnrichmentServerAvailable !== true) return

    const refreshPrecedentsSummary = async () => {
      try {
        const response = await getPrecedentsSummary()
        setPrecedentsSummary(response.summary || null)
      } catch (error) {
        console.error('Ошибка обновления сводки прецедентов:', error)
      }
    }

    refreshPrecedentsSummary()
  }, [competitorsData, isEnrichmentServerAvailable])

  useEffect(() => {
    if (!hasRestoredDraftRef.current) return

    const hasData = Object.values(formData).some(val => 
      Array.isArray(val) ? val.length > 0 : val !== '' && val !== null
    )
    
    if (hasData) {
      const timeoutId = setTimeout(() => {
        const scopedKey = getLocalDraftStorageKey()
        localStorage.setItem(scopedKey, JSON.stringify(formData))
        if (isEnrichmentServerAvailable === true) {
          saveServerDraft({ formData }).catch((error) => {
            console.error('Ошибка сохранения server-side черновика:', error)
          })
        }
      }, 1000)
      return () => clearTimeout(timeoutId)
    }
  }, [formData, isEnrichmentServerAvailable])

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

    const scheduleFields = new Set([
      'contentPlanStartDate',
      'contentPlanEndDate',
      'publicationFrequency'
    ])

    setErrors((prev) => {
      const next = { ...prev }
      if (next[name]) next[name] = ''
      if (scheduleFields.has(name)) {
        next.publicationFrequency = ''
      }
      return next
    })
  }

  const handleBlur = (e) => {
    const { name } = e.target
    setTouched(prev => ({ ...prev, [name]: true }))
    validateField(name, formData[name])
  }

  const validateField = (name, value) => {
    const error = validateFieldValue(name, value ?? '', formData)
    setErrors(prev => ({ ...prev, [name]: error }))
    if (error) {
      addToast(error, 'error')
    }
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
            platforms: formData.platforms,
            audience_segments: buildAudienceSegmentsFromForm(formData)
          },
          { signal }
        )

        setPrecedentSearchResults(response.results || null)
        addToast('Поиск прецедентов завершён', 'success')

        const summaryResponse = await getPrecedentsSummary({ signal })
        setPrecedentsSummary(summaryResponse.summary || null)
      })
      setOperationTelemetry({ backend: 'success', python: 'idle', llm: 'idle' })
      return true
    } catch (error) {
      console.error('Ошибка поиска прецедентов:', error)
      addToast(`Ошибка поиска прецедентов: ${error.message}`, 'error')
      setOperationTelemetry({ backend: 'error', python: 'idle', llm: 'idle' })
      return false
    }
  }

  const handleSearchAndGenerateDraftPlan = async () => {
    const searchCompleted = await handleSearchPrecedents()
    const plan = planMarketerCombinedWorkflow({ searchCompleted })
    if (plan.blocked) return
    await handleGenerateDraftPlan()
  }

  const handleSeedDemoPrecedents = async () => {
    if (isGenerationBlockedByBackend(isEnrichmentServerAvailable)) {
      addToast('Сервер недоступен. Убедитесь, что он запущен.', 'error')
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
    if (isGenerationBlockedByBackend(isEnrichmentServerAvailable)) {
      addToast('Сервер недоступен. Убедитесь, что он запущен.', 'error')
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
    if (isGenerationBlockedByBackend(isEnrichmentServerAvailable)) {
      addToast('Сервер недоступен. Убедитесь, что он запущен.', 'error')
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

  const handleLoadHorizonExample = async (exampleName) => {
    if (!exampleName) return
    if (exampleName === demoHorizonExample) return

    const label = demoHorizonExampleOptions[exampleName] || exampleName
    if (!window.confirm(`Загрузить пример данных (${label})? Текущие данные будут заменены.`)) return

    setDemoHorizonExample(exampleName)
    await loadExample(exampleName)
  }

  const handleApplyTimelinePreset = (months) => {
    const range = buildTimelineRange(months)
    setFormData((prev) => ({
      ...prev,
      contentPlanStartDate: range.startDate,
      contentPlanEndDate: range.endDate,
      publicationFrequency: prev.publicationFrequency || '3-4_per_week'
    }))
    setErrors((prev) => ({
      ...prev,
      contentPlanStartDate: '',
      contentPlanEndDate: '',
      publicationFrequency: ''
    }))
  }

  const handleSelectAllFormats = () => {
    const allValues = contentFormatOptions.map((o) => o.value)
    const allSelected = allValues.every((v) => formData.contentFormats.includes(v))
    setFormData((prev) => ({
      ...prev,
      contentFormats: allSelected ? [] : allValues
    }))
    setErrors((prev) => ({ ...prev, contentFormats: '' }))
  }

  const handleSelectAllPlatforms = () => {
    const allValues = visiblePlatformOptions.map((o) => o.value)
    const allSelected = allValues.every((v) => formData.platforms.includes(v))
    setFormData((prev) => ({
      ...prev,
      platforms: allSelected ? [] : allValues
    }))
    setErrors((prev) => ({ ...prev, platforms: '' }))
  }

  const handleGenerateDraftPlan = async () => {
    const formValidation = validateFormData(formData)
    if (!formValidation.isValid) {
      setErrors(formValidation.errors)
      setTouched(
        Object.keys(formValidation.errors).reduce((acc, key) => ({ ...acc, [key]: true }), {})
      )
      const firstErrorMessage = Object.values(formValidation.errors)[0]
      addToast(firstErrorMessage ? `Ошибка заполнения: ${firstErrorMessage}` : 'Перед генерацией заполните обязательные поля формы', 'error')
      return null
    }

    let effectivePrecedentsSummary = precedentsSummary
    let hasWorkflowPrecedents = hasPrecedentsForWorkflow(precedentSearchResults, effectivePrecedentsSummary)

    // Чтобы цепочка этапов не обрывалась на parse-only: при пустой базе и локальных
    // сырых competitors_data пробуем авто-enrich + persist перед генерацией.
    const hasLocalRawCompetitors = Boolean(competitorsData) && !hasEnrichedCompetitorsData(competitorsData)
    if (!hasWorkflowPrecedents && hasLocalRawCompetitors && isEnrichmentServerAvailable === true) {
      addToast('Нет прецедентов в базе. Запускаю обогащение локальных данных перед генерацией...', 'info')
      const enrichmentOutcome = await handleEnrichCompetitorsData({ skipDownload: true })
      if (enrichmentOutcome?.success) {
        try {
          const summaryResponse = await getPrecedentsSummary()
          effectivePrecedentsSummary = summaryResponse.summary || null
          setPrecedentsSummary(effectivePrecedentsSummary)
          hasWorkflowPrecedents = hasPrecedentsForWorkflow(precedentSearchResults, effectivePrecedentsSummary)
          if (hasPersistedPrecedentsInDb(effectivePrecedentsSummary)) {
            addToast('Прецеденты обновлены. Продолжаю генерацию черновика.', 'success')
          }
        } catch (error) {
          console.error('Ошибка обновления сводки прецедентов после auto-enrich:', error)
        }
      }
    }

    if (!hasWorkflowPrecedents && isSmm && isEnrichmentServerAvailable === true) {
      addToast('В базе нет прецедентов. Автоматически загружаю демо-прецеденты для генерации...', 'info')
      await handleSeedDemoPrecedents()
      try {
        const summaryResponse = await getPrecedentsSummary()
        effectivePrecedentsSummary = summaryResponse.summary || null
        setPrecedentsSummary(effectivePrecedentsSummary)
        hasWorkflowPrecedents = hasPrecedentsForWorkflow(precedentSearchResults, effectivePrecedentsSummary)
      } catch (error) {
        console.error('Ошибка обновления сводки прецедентов после auto-seed:', error)
      }
    }

    if (!hasWorkflowPrecedents) {
      addToast(
        'Перед генерацией нужны прецеденты в базе: загрузите демо-базу на шаге «Конкуренты и база» или запустите поиск.',
        'error'
      )
      return null
    }

    const safeFormInput = buildSafeFormInputForGeneration(formData)

    addToast('Генерация чернового контент-плана по данным формы и прецедентам...', 'info')
    setOperationTelemetry({ backend: 'running', python: 'running', llm: 'running' })
    let generatedResponse = null
    try {
      await runTrackedOperation('generatingPlan', async (signal) => {
        const response = await generateDraftContentPlan(
          {
            form_input: safeFormInput,
            rag_query: precedentSearchQuery || undefined,
            rag_limit: 8,
            pinned_publications: buildPinnedPublications(competitorsData)
          },
          { signal }
        )

        generatedResponse = response
        setDraftPlanResult(response)
        setOptimizationResult(null)
        // Если LLM вернул черновой контент-план, сохраняем его для страницы просмотра
        if (response?.draft?.draft_content_plan) {
          try {
            await savePlanSnapshot(response.draft.draft_content_plan, {
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
      return generatedResponse
    } catch (error) {
      console.error('Ошибка генерации чернового плана:', error)
      addToast(`Ошибка генерации: ${error.message}`, 'error')
      setOperationTelemetry({ backend: 'error', python: 'error', llm: 'error' })
      return null
    }
  }

  const handleOptimizeDraftPlan = async (overrideDraftResponse = null) => {
    const activeDraftResponse =
      overrideDraftResponse && overrideDraftResponse.draft ? overrideDraftResponse : draftPlanResult
    const draft = activeDraftResponse?.draft?.draft_content_plan
    if (!draft) {
      addToast('Сначала сформируйте черновой контент-план', 'error')
      return null
    }

    const activeRag = activeDraftResponse?.rag || precedentSearchResults
    const precedentPubs = Array.isArray(activeRag?.publications)
      ? activeRag.publications.filter(Boolean)
      : []

    const planGaConfig = buildPlanGaConfigFromForm(formData)
    const postGaConfig = buildPostGaConfigFromForm(formData)

    const publicationDayMode = draft?.schedule_preferences?.publication_day_mode || formData.publicationDayMode
    const sharedModeMinPubs =
      publicationDayMode === 'shared'
        ? parseNumberOrNull(draft?.schedule_preferences?.generated_publications) ??
          parseNumberOrNull(draft?.publications?.length) ??
          null
        : null
    const minPubs = sharedModeMinPubs ?? recommendedPublications ?? parseNumberOrNull(draft?.constraints?.min_publications) ?? null

    const qualityMin =
      parseNumberOrNull(draft?.kpi_targets?.avg_engagement_rate) ??
      0
    const explicitPostsPerWeek =
      PUBLICATION_FREQUENCY_TO_WEEKLY[formData.publicationFrequency] ?? null
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
      return null
    }

    if (!derivedPostsPerWeek || derivedPostsPerWeek <= 0) {
      addToast('Выберите частоту публикаций или скорректируйте горизонт планирования', 'error')
      return null
    }

    const lockedFields = {
      platforms: formData.platforms,           // выбранные платформы
      formats: formData.contentFormats,        // выбранные форматы
      publicationFrequency: formData.publicationFrequency,
      publicationDayMode: formData.publicationDayMode,
      // если пользователь захочет зафиксировать конкретные поля
      topic: false,
      format: false,
      objective: false,
      tone: false,
      has_cta: null,
      creativity: null
    }

    const payload = {
      draft_content_plan: draft,
      form_input: buildSafeFormInputForGeneration(formData),
      ragResults: activeRag || null,
      pinned_publications: buildPinnedPublications(competitorsData),
      locked_fields: lockedFields,
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
        ga: planGaConfig
      },
      stage2: {
        constraints: {
          tones_count: null,
          creativity_from_best_plan: null
        },
        ga: postGaConfig
      }
    }

    addToast('Запуск эволюционной оптимизации...', 'info')
    setOperationTelemetry({ backend: 'running', python: 'running', llm: 'running' })
    let optResponse = null
    try {
      await runTrackedOperation('optimizingPlan', async (signal) => {
        const response = await optimizeDraftContentPlan(payload, {
          signal,
          onProgress: (prog) => {
            setOptimizationLiveProgress(prog)
          }
        })
        optResponse = response
        setOptimizationResult(response)

        if (response?.optimized_content_plan) {
          try {
            await savePlanSnapshot(response.optimized_content_plan, {
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
      setOperationTelemetry({ backend: 'success', python: 'success', llm: 'success' })
      return optResponse
    } catch (error) {
      console.error('Ошибка оптимизации:', error)
      addToast(`Ошибка оптимизации: ${error.message}`, 'error')
      setOperationTelemetry({ backend: 'error', python: 'error', llm: 'error' })
      return null
    }
  }

  const handleGenerateAndOptimizePlan = async () => {
    if (isSmm && canSearchPrecedents && !precedentSearchResults?.publications?.length) {
      const searchOk = await handleSearchPrecedents()
      if (!searchOk) return null
    }
    const generated = await handleGenerateDraftPlan()
    if (!generated?.draft?.draft_content_plan) return null
    const optResult = await handleOptimizeDraftPlan(generated)
    return optResult || generated
  }

  const handleSmmGenerateAndNavigate = async () => {
    if (isGenerationBlockedByBackend(isEnrichmentServerAvailable)) {
      addToast('Сервер API (порт 3001) недоступен. Убедитесь, что бэкенд запущен.', 'error')
      return
    }

    const formValidation = validateFormData(formData)
    if (!formValidation.isValid) {
      setErrors(formValidation.errors)
      setTouched(
        Object.keys(formValidation.errors).reduce((acc, key) => ({ ...acc, [key]: true }), {})
      )
      const firstErrorMessage = Object.values(formValidation.errors)[0]
      addToast(
        firstErrorMessage
          ? `Ошибка заполнения: ${firstErrorMessage}`
          : 'Перед генерацией заполните обязательные поля формы',
        'error'
      )
      return
    }

    addToast('Запуск формирования контент-плана: RAG-подбор, генерация и ML-оптимизация...', 'info')
    const outcome = await handleGenerateAndOptimizePlan()
    if (outcome) {
      addToast('Контент-план успешно сформирован и оптимизирован! Открываю готовый план...', 'success')
      navigate('/content-plan')
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

  const isLastStep = currentStep === wizardSteps.length
  const hasGeneratedPlan = Boolean(draftPlanResult?.draft?.draft_content_plan || optimizationResult?.optimized_content_plan)

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

  const currentStepMeta = STEP_META[currentStepId] || null

  return (
    <>
      <ToastContainer toasts={toasts} removeToast={removeToast} />

      <form className="project-form">
        {/* Прогресс-бар и гид по текущему шагу */}
        <WizardHeader
          currentStep={currentStep}
          wizardSteps={wizardSteps}
          onStepClick={goToStep}
          stepStatuses={stepStatuses}
          stepMeta={currentStepMeta}
        />

        {visibleErrorEntries.length > 0 && (
          <section className="form-section" role="alert" aria-live="polite">
            <h2 className="section-title">Проверьте поля формы</h2>
            <div className="workflow-checklist">
              {visibleErrorEntries.map(([fieldName, message]) => (
                <div key={fieldName} className="workflow-checklist-item is-pending">
                  <span className="workflow-checklist-mark">!</span>
                  <span>
                    <strong>{FIELD_LABELS_RU[fieldName] || fieldName}:</strong> {message}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ШАГ 1: КОНКУРЕНТЫ И БАЗА ПРИМЕРОВ */}
        {currentStepId === 'competitors' && (
          <CompetitorsStep
            competitorUrls={competitorUrls}
            competitorsData={competitorsData}
            competitorsFileName={competitorsFileName}
            postsLimit={postsLimit}
            isParsingFromUrls={isParsingFromUrls}
            isEnriching={isEnriching}
            isSeedingPrecedents={isSeedingPrecedents}
            isProcessing={isProcessing}
            isEnrichmentServerAvailable={isEnrichmentServerAvailable}
            canEnrich={canEnrich}
            showEnrichButton={isAnalyst || canEnrich}
            precedentsAlreadyInDb={hasPersistedPrecedentsInDb(precedentsSummary)}
            precedentsSummary={precedentsSummary}
            allowInstagram={allowInstagram}
            onUrlChange={handleCompetitorUrlChange}
            onAddUrl={handleAddCompetitorUrl}
            onRemoveUrl={handleRemoveCompetitorUrl}
            onPostsLimitChange={handlePostsLimitChange}
            onParseFromUrls={handleParseCompetitorsFromUrls}
            onEnrichUploaded={handleEnrichCompetitorsData}
            onRemoveData={handleRemoveCompetitorsData}
            onSeedDemoPrecedents={handleSeedDemoPrecedents}
            onSkipToNextStep={goToNextStep}
          />
        )}

        {/* ШАГ 2: О ПРОЕКТЕ И ПРОИЗВОДИТЕЛЕ */}
        {currentStepId === 'project' && (
          <>
            <OnboardingMaster
              isCompact
              onApplyTemplate={(templateData) => {
                setFormData((prev) => ({ ...prev, ...templateData }))
                setIsEditMode(true)
                addToast('Шаблон типа проекта применён', 'success')
              }}
            />
            {/* Сведения о производителе */}
            <section className="form-section">
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
                <AutoResizeTextarea
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
            </section>

            {/* Сведения об IT-проекте */}
            <section className="form-section">
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
                <AutoResizeTextarea
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
                  Цели проекта <span className="ux-optional-badge">необязательно</span>
                </label>
                <AutoResizeTextarea
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
                  Особенности проекта <span className="ux-optional-badge">необязательно</span>
                </label>
                <AutoResizeTextarea
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
                  Преимущества проекта <span className="ux-optional-badge">необязательно</span>
                </label>
                <AutoResizeTextarea
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
            </section>
          </>
        )}

        {/* ШАГ 2: АУДИТОРИЯ И ПАРАМЕТРЫ КОНТЕНТ-ПЛАНА */}
        {currentStepId === 'audience' && (
          <>
            {/* Профиль потребителя */}
            <section className="form-section">
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
                  Социально-демографические характеристики <span className="ux-optional-badge">необязательно</span>
                </label>
                <AutoResizeTextarea
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
                  Цель приобретения <span className="ux-optional-badge">необязательно</span>
                </label>
                <AutoResizeTextarea
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
                  Стиль жизни и другие характеристики <span className="ux-optional-badge">необязательно</span>
                </label>
                <AutoResizeTextarea
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
            </section>

            {/* Сведения о контент-плане */}
            <section className="form-section">
              <h2 className="section-title">Сведения о контент-плане</h2>

              <div className="ux-timeline-presets-row">
                <span className="ux-timeline-presets-label">Быстрый выбор периода (с завтрашнего дня):</span>
                <div className="ux-preset-chips">
                  <button
                    type="button"
                    className="ux-preset-chip"
                    onClick={() => handleApplyTimelinePreset(1)}
                    disabled={!isEditMode}
                  >
                    На 1 месяц
                  </button>
                  <button
                    type="button"
                    className="ux-preset-chip"
                    onClick={() => handleApplyTimelinePreset(3)}
                    disabled={!isEditMode}
                  >
                    На 3 месяца (рекомендуется)
                  </button>
                  <button
                    type="button"
                    className="ux-preset-chip"
                    onClick={() => handleApplyTimelinePreset(6)}
                    disabled={!isEditMode}
                  >
                    На 6 месяцев
                  </button>
                  <button
                    type="button"
                    className="ux-preset-chip"
                    onClick={() => handleApplyTimelinePreset(12)}
                    disabled={!isEditMode}
                  >
                    На 1 год
                  </button>
                </div>
              </div>
              
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
                <small className="form-hint">
                  Одно значение для чернового плана и для эволюции: средняя интенсивность задаётся выбранным вариантом.
                </small>
                {recommendedPublications !== null && (
                  <div className="ux-schedule-preview" role="status">
                    По выбранному расписанию будет запланировано <strong>~{recommendedPublications} публикаций</strong> на каждую площадку
                  </div>
                )}
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
                <div className="form-label">
                  Ключевые даты и инфоповоды <span className="ux-optional-badge">необязательно</span>
                </div>
                <KeyDatesEditor
                  id="keyDates"
                  value={formData.keyDates}
                  startDate={formData.contentPlanStartDate}
                  endDate={formData.contentPlanEndDate}
                  disabled={!isEditMode}
                  onChange={(keyDates) => setFormData((prev) => ({ ...prev, keyDates }))}
                />
              </div>

              <div className="form-group">
                <div className="ux-label-with-action">
                  <label className="form-label">
                    Формат публикаций <span className="required">*</span>
                  </label>
                  <button
                    type="button"
                    className="ux-inline-select-all-btn"
                    onClick={handleSelectAllFormats}
                    disabled={!isEditMode}
                  >
                    {contentFormatOptions.every((o) => formData.contentFormats.includes(o.value))
                      ? 'Снять выделение'
                      : 'Выбрать все форматы'}
                  </button>
                </div>
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

              <div className="form-group">
                <div className="ux-label-with-action">
                  <label className="form-label">
                    Платформы <span className="required">*</span>
                  </label>
                  <button
                    type="button"
                    className="ux-inline-select-all-btn"
                    onClick={handleSelectAllPlatforms}
                    disabled={!isEditMode}
                  >
                    {visiblePlatformOptions.every((o) => formData.platforms.includes(o.value))
                      ? 'Снять выделение'
                      : 'Выбрать все площадки'}
                  </button>
                </div>
                <div className="checkbox-group">
                  {visiblePlatformOptions.map(option => (
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
            </section>
          </>
        )}

        {currentStepId === 'optimize' && isExtendedMode && <section className="form-section evolution-settings-section">
          <details className="ui-details">
            <summary className="ui-details-summary">Параметры оптимизации (необязательно)</summary>
            <div className="ui-details-body">
          <p className="evolution-settings-lead">
            Эти значения используются только при улучшении плана: сначала структура плана, затем признаки каждой публикации.
          </p>

          <div className="evolution-settings-subblock">
            <h3 className="section-subtitle evolution-settings-subtitle">Контент-план (этап 1)</h3>
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
                  placeholder="32"
                  min="10"
                  max="2000"
                  disabled={!isEditMode}
                />
                <small className="form-hint">Сколько вариантов плана одновременно держит алгоритм</small>
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
                  placeholder="40"
                  min="10"
                  max="2000"
                  disabled={!isEditMode}
                />
                <small className="form-hint">Число итераций на уровне плана</small>
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label htmlFor="evoStagnationGenerations" className="form-label">
                  Порог стагнации (поколений) <FieldHint fieldName="evoStagnationGenerations" />
                </label>
                <input
                  type="number"
                  id="evoStagnationGenerations"
                  name="evoStagnationGenerations"
                  value={formData.evoStagnationGenerations}
                  onChange={handleChange}
                  onBlur={handleBlur}
                  className="form-input"
                  placeholder="12"
                  min="1"
                  max="500"
                  disabled={!isEditMode}
                />
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
                  placeholder="6"
                  min="0"
                  max="20"
                  disabled={!isEditMode}
                />
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
                <small className="form-hint">Одно и то же семя передаётся на этап постов для воспроизводимого прогона</small>
              </div>
            </div>

            <h4 className="evolution-settings-methods-title">Методы отбора и вариации (план)</h4>
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="evoSelectionMethod" className="form-label">
                  Метод отбора <FieldHint fieldName="evoSelectionMethod" />
                </label>
                <select
                  id="evoSelectionMethod"
                  name="evoSelectionMethod"
                  value={formData.evoSelectionMethod || 'tournament'}
                  onChange={handleChange}
                  onBlur={handleBlur}
                  className="form-select"
                  disabled={!isEditMode}
                >
                  <option value="tournament">Турнирный отбор</option>
                  <option value="roulette">Пропорциональный (рулетка)</option>
                  <option value="rank">Ранговый отбор</option>
                </select>
                <small className="form-hint">
                  Как выбираются родители для скрещивания на уровне плана.
                </small>
              </div>
              <div className="form-group">
                <label htmlFor="evoCrossoverMethod" className="form-label">
                  Метод скрещивания <FieldHint fieldName="evoCrossoverMethod" />
                </label>
                <select
                  id="evoCrossoverMethod"
                  name="evoCrossoverMethod"
                  value={formData.evoCrossoverMethod || 'one_point'}
                  onChange={handleChange}
                  onBlur={handleBlur}
                  className="form-select"
                  disabled={!isEditMode}
                >
                  <option value="one_point">Одноточечное</option>
                  <option value="two_point">Двухточечное</option>
                  <option value="uniform">Равномерное</option>
                </select>
                <small className="form-hint">
                  Как комбинируются «гены» двух планов при скрещивании.
                </small>
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
                  value={formData.evoMutationMethod || 'random_replace'}
                  onChange={handleChange}
                  onBlur={handleBlur}
                  className="form-select"
                  disabled={!isEditMode}
                >
                  <option value="random_replace">Битовая (замена значения)</option>
                  <option value="inversion">Инверсия (разворот участка)</option>
                </select>
                <small className="form-hint">
                  Как мутирует представление плана.
                </small>
              </div>
              <div className="form-group" />
            </div>

            <div className="form-row">
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
                  placeholder="0.75"
                  min="0"
                  max="1"
                  step="0.01"
                  disabled={!isEditMode}
                />
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
                  placeholder="0.2"
                  min="0"
                  max="1"
                  step="0.001"
                  disabled={!isEditMode}
                />
              </div>
            </div>
          </div>

          <div className="evolution-settings-subblock">
            <h3 className="section-subtitle evolution-settings-subtitle">Посты (этап 2)</h3>
            <p className="evolution-settings-lead evolution-settings-lead_compact">
              Поиск тона, креативности, призыва, крючка, длины и списков для каждого поста после фиксации структуры плана.
            </p>

            <div className="form-row">
              <div className="form-group">
                <label htmlFor="evoPostPopulationSize" className="form-label">
                  Размер популяции <FieldHint fieldName="evoPostPopulationSize" />
                </label>
                <input
                  type="number"
                  id="evoPostPopulationSize"
                  name="evoPostPopulationSize"
                  value={formData.evoPostPopulationSize}
                  onChange={handleChange}
                  onBlur={handleBlur}
                  className="form-input"
                  placeholder="48"
                  min="10"
                  max="2000"
                  disabled={!isEditMode}
                />
                <small className="form-hint">Вариантов на одну публикацию (параллельно по постам)</small>
              </div>
              <div className="form-group">
                <label htmlFor="evoPostGenerations" className="form-label">
                  Количество поколений <FieldHint fieldName="evoPostGenerations" />
                </label>
                <input
                  type="number"
                  id="evoPostGenerations"
                  name="evoPostGenerations"
                  value={formData.evoPostGenerations}
                  onChange={handleChange}
                  onBlur={handleBlur}
                  className="form-input"
                  placeholder="50"
                  min="10"
                  max="2000"
                  disabled={!isEditMode}
                />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label htmlFor="evoPostStagnationGenerations" className="form-label">
                  Порог стагнации (поколений) <FieldHint fieldName="evoPostStagnationGenerations" />
                </label>
                <input
                  type="number"
                  id="evoPostStagnationGenerations"
                  name="evoPostStagnationGenerations"
                  value={formData.evoPostStagnationGenerations}
                  onChange={handleChange}
                  onBlur={handleBlur}
                  className="form-input"
                  placeholder="12"
                  min="1"
                  max="500"
                  disabled={!isEditMode}
                />
              </div>
              <div className="form-group">
                <label htmlFor="evoPostTournamentSize" className="form-label">
                  Размер турнира <FieldHint fieldName="evoPostTournamentSize" />
                </label>
                <input
                  type="number"
                  id="evoPostTournamentSize"
                  name="evoPostTournamentSize"
                  value={formData.evoPostTournamentSize}
                  onChange={handleChange}
                  onBlur={handleBlur}
                  className="form-input"
                  placeholder="4"
                  min="2"
                  max="20"
                  disabled={!isEditMode}
                />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label htmlFor="evoPostEliteSize" className="form-label">
                  Размер элиты <FieldHint fieldName="evoPostEliteSize" />
                </label>
                <input
                  type="number"
                  id="evoPostEliteSize"
                  name="evoPostEliteSize"
                  value={formData.evoPostEliteSize}
                  onChange={handleChange}
                  onBlur={handleBlur}
                  className="form-input"
                  placeholder="3"
                  min="0"
                  max="20"
                  disabled={!isEditMode}
                />
              </div>
              <div className="form-group" />
            </div>

            <h4 className="evolution-settings-methods-title">Методы отбора и вариации (посты)</h4>
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="evoPostSelectionMethod" className="form-label">
                  Метод отбора <FieldHint fieldName="evoPostSelectionMethod" />
                </label>
                <select
                  id="evoPostSelectionMethod"
                  name="evoPostSelectionMethod"
                  value={formData.evoPostSelectionMethod || 'tournament'}
                  onChange={handleChange}
                  onBlur={handleBlur}
                  className="form-select"
                  disabled={!isEditMode}
                >
                  <option value="tournament">Турнирный отбор</option>
                  <option value="roulette">Пропорциональный (рулетка)</option>
                  <option value="rank">Ранговый отбор</option>
                </select>
              </div>
              <div className="form-group">
                <label htmlFor="evoPostCrossoverMethod" className="form-label">
                  Метод скрещивания <FieldHint fieldName="evoPostCrossoverMethod" />
                </label>
                <select
                  id="evoPostCrossoverMethod"
                  name="evoPostCrossoverMethod"
                  value={formData.evoPostCrossoverMethod || 'one_point'}
                  onChange={handleChange}
                  onBlur={handleBlur}
                  className="form-select"
                  disabled={!isEditMode}
                >
                  <option value="one_point">Одноточечное</option>
                  <option value="two_point">Двухточечное</option>
                  <option value="uniform">Равномерное</option>
                </select>
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label htmlFor="evoPostMutationMethod" className="form-label">
                  Метод мутации <FieldHint fieldName="evoPostMutationMethod" />
                </label>
                <select
                  id="evoPostMutationMethod"
                  name="evoPostMutationMethod"
                  value={formData.evoPostMutationMethod || 'random_replace'}
                  onChange={handleChange}
                  onBlur={handleBlur}
                  className="form-select"
                  disabled={!isEditMode}
                >
                  <option value="random_replace">Битовая (замена значения)</option>
                  <option value="inversion">Инверсия (разворот участка)</option>
                </select>
              </div>
              <div className="form-group" />
            </div>

            <div className="form-row">
              <div className="form-group">
                <label htmlFor="evoPostCrossoverProbability" className="form-label">
                  Вероятность скрещивания <FieldHint fieldName="evoPostCrossoverProbability" />
                </label>
                <input
                  type="number"
                  id="evoPostCrossoverProbability"
                  name="evoPostCrossoverProbability"
                  value={formData.evoPostCrossoverProbability}
                  onChange={handleChange}
                  onBlur={handleBlur}
                  className="form-input"
                  placeholder="0.9"
                  min="0"
                  max="1"
                  step="0.01"
                  disabled={!isEditMode}
                />
              </div>
              <div className="form-group">
                <label htmlFor="evoPostMutationProbability" className="form-label">
                  Вероятность мутации <FieldHint fieldName="evoPostMutationProbability" />
                </label>
                <input
                  type="number"
                  id="evoPostMutationProbability"
                  name="evoPostMutationProbability"
                  value={formData.evoPostMutationProbability}
                  onChange={handleChange}
                  onBlur={handleBlur}
                  className="form-input"
                  placeholder="0.2"
                  min="0"
                  max="1"
                  step="0.001"
                  disabled={!isEditMode}
                />
              </div>
            </div>
          </div>

          <small className="form-hint">
            Если параметры не менять, останутся значения по умолчанию.
          </small>
            </div>
          </details>

          {isSmm && (
            <div className="smm-generate-banner" style={{
              background: 'linear-gradient(135deg, rgba(37,99,235,0.08) 0%, rgba(124,58,237,0.08) 100%)',
              border: '1px solid rgba(99,102,241,0.25)',
              borderRadius: '8px',
              padding: '1.25rem',
              marginTop: '1.5rem',
              marginBottom: '1rem'
            }}>
              <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1.1rem', color: '#1e293b' }}>
                {hasGeneratedPlan ? 'Контент-план уже готов' : 'Финальный шаг: готовый контент-план в один клик'}
              </h3>
              <p style={{ margin: '0 0 1rem 0', color: '#475569', fontSize: '0.9rem' }}>
                {hasGeneratedPlan
                  ? 'Вы можете открыть сформированный контент-план в календаре или пересоздать его с новыми параметрами.'
                  : 'Нажмите кнопку ниже — система автоматически подберёт прецеденты конкурентов, сгенерирует черновик с помощью ИИ и оптимизирует распределение тем и форматов.'}
              </p>
              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="submit-button primary"
                  onClick={handleSmmGenerateAndNavigate}
                  disabled={isGeneratingDraftPlan || isOptimizingPlan || isProcessing || isEnrichmentServerAvailable === false || !canGenerateDraft}
                  style={{ padding: '0.75rem 1.5rem', fontWeight: 600 }}
                >
                  <span>
                    {isGeneratingDraftPlan
                      ? 'ШАГ 1/2: ГЕНЕРАЦИЯ ЧЕРНОВИКА...'
                      : isOptimizingPlan
                        ? 'ШАГ 2/2: ОПТИМИЗАЦИЯ...'
                        : hasGeneratedPlan
                          ? 'ПЕРЕСОЗДАТЬ И ОПТИМИЗИРОВАТЬ ПЛАН'
                          : 'СФОРМИРОВАТЬ КОНТЕНТ-ПЛАН'}
                  </span>
                </button>
                {hasGeneratedPlan && (
                  <button
                    type="button"
                    className="submit-button secondary"
                    onClick={() => navigate('/content-plan')}
                    style={{ padding: '0.75rem 1.25rem' }}
                  >
                    <span>ОТКРЫТЬ ГОТОВЫЙ ПЛАН В КАЛЕНДАРЕ</span>
                  </button>
                )}
              </div>
              {!canGenerateDraft && smmBlockedReasonsForGenerate.length > 0 && (
                <div style={{ marginTop: '0.75rem', fontSize: '0.85rem', color: '#b91c1c' }}>
                  Перед формированием: {smmBlockedReasonsForGenerate.join(' · ')}
                </div>
              )}
            </div>
          )}
        </section>}

        {currentStepId === 'precedents' && (
          <>
            <WorkflowSummaryPanel
              filledRequired={filledRequired}
              requiredCount={requiredFields.length}
              progress={progress}
              competitorsCount={competitorsData?.competitors?.length || 0}
              precedentsSummary={precedentsSummary}
              isEnrichmentServerAvailable={isEnrichmentServerAvailable}
              hasDraftPlan={Boolean(draftPlanResult?.draft?.draft_content_plan)}
              hasOptimizedPlan={Boolean(optimizationResult?.optimized_content_plan)}
              publicationDayMode={formData.publicationDayMode}
              explainabilitySignals={explainabilitySignals}
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
              showDemoButtons={true}
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
          </>
        )}

        {currentStepId === 'draft' && (
          <>
            <WorkflowSummaryPanel
              filledRequired={filledRequired}
              requiredCount={requiredFields.length}
              progress={progress}
              competitorsCount={competitorsData?.competitors?.length || 0}
              precedentsSummary={precedentsSummary}
              isEnrichmentServerAvailable={isEnrichmentServerAvailable}
              hasDraftPlan={Boolean(draftPlanResult?.draft?.draft_content_plan)}
              hasOptimizedPlan={Boolean(optimizationResult?.optimized_content_plan)}
              publicationDayMode={formData.publicationDayMode}
              explainabilitySignals={explainabilitySignals}
              riskSummary={riskSummary}
            />
            <DraftPlanWorkflowPanel
              phase="draft"
              draftPlanResult={draftPlanResult}
              optimizationResult={optimizationResult}
              onGenerateDraftPlan={handleGenerateDraftPlan}
              onGenerateWithPrecedents={handleSearchAndGenerateDraftPlan}
              onGenerateAndOptimizePlan={handleGenerateAndOptimizePlan}
              onOptimizeDraftPlan={() => handleOptimizeDraftPlan()}
              onGoToOptimizeStep={() => goToStepById('optimize')}
              onOpenPlan={() => navigate('/content-plan')}
              isGeneratingDraftPlan={isGeneratingDraftPlan}
              isOptimizingPlan={isOptimizingPlan}
              isProcessing={isProcessing}
              isEnrichmentServerAvailable={isEnrichmentServerAvailable}
              canGenerateDraft={canGenerateDraft}
              smmBlockedReasons={smmBlockedReasonsForGenerate}
              canSearchPrecedents={canSearchPrecedents}
              smmSearchBlockedReasons={smmBlockedReasonsForSearch}
              publicationDayMode={formData.publicationDayMode}
              isAnalyst={isAnalyst}
              combineSearchAndDraft={isSmm}
            />
          </>
        )}

        {currentStepId === 'optimize' && (
          <>
            {isOptimizingPlan && (
              <div
                className="sse-optimization-progress-card"
                style={{
                  marginBottom: '1rem',
                  padding: '16px',
                  background: '#f0f9ff',
                  border: '2px solid #0284c7',
                  borderRadius: '8px'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <strong style={{ color: '#0369a1', fontSize: '0.95rem' }}>
                    ⚡ Потоковая оптимизация генетического алгоритма (SSE):
                  </strong>
                  <span style={{ fontSize: '0.85rem', color: '#0284c7', fontWeight: 600 }}>
                    {optimizationLiveProgress?.generation
                      ? `Поколение ${optimizationLiveProgress.generation} / ${optimizationLiveProgress.max_generations || 40}`
                      : optimizationLiveProgress?.message || 'Инициализация эволюции плана…'}
                  </span>
                </div>

                <div style={{ width: '100%', height: '8px', background: '#e0f2fe', borderRadius: '4px', overflow: 'hidden', marginBottom: '10px' }}>
                  <div
                    style={{
                      height: '100%',
                      width: `${
                        optimizationLiveProgress?.generation
                          ? Math.min(100, Math.round((optimizationLiveProgress.generation / (optimizationLiveProgress.max_generations || 40)) * 100))
                          : 20
                      }%`,
                      background: '#0284c7',
                      transition: 'width 0.3s ease'
                    }}
                  />
                </div>

                {optimizationLiveProgress?.best_score != null && (
                  <div style={{ fontSize: '0.82rem', color: '#334155', display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                    <span>• Лучший фитнес (LCB): <strong>{Number(optimizationLiveProgress.best_score).toFixed(4)}</strong></span>
                    {optimizationLiveProgress?.avg_score != null && (
                      <span>• Средний фитнес популяции: <strong>{Number(optimizationLiveProgress.avg_score).toFixed(4)}</strong></span>
                    )}
                    {optimizationLiveProgress?.summary?.predicted_views != null && (
                      <span>• Прогноз просмотров: <strong>{Number(optimizationLiveProgress.summary.predicted_views).toLocaleString('ru-RU')}</strong></span>
                    )}
                  </div>
                )}
              </div>
            )}
            <DraftPlanWorkflowPanel
              phase="optimize"
              draftPlanResult={draftPlanResult}
              optimizationResult={optimizationResult}
              onGenerateDraftPlan={handleGenerateDraftPlan}
              onGenerateAndOptimizePlan={handleGenerateAndOptimizePlan}
              onOptimizeDraftPlan={() => handleOptimizeDraftPlan()}
              onOpenPlan={() => navigate('/content-plan')}
              isGeneratingDraftPlan={isGeneratingDraftPlan}
              isOptimizingPlan={isOptimizingPlan}
              isProcessing={isProcessing}
              isEnrichmentServerAvailable={isEnrichmentServerAvailable}
              canGenerateDraft={canGenerateDraft}
              smmBlockedReasons={smmBlockedReasonsForGenerate}
              publicationDayMode={formData.publicationDayMode}
              isAnalyst={isAnalyst}
            />
            {isAnalyst && (
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
          onLastStepNext={
            isSmm
              ? hasGeneratedPlan
                ? () => navigate('/content-plan')
                : handleSmmGenerateAndNavigate
              : () => navigate('/content-plan')
          }
          canProceedFromLastStep={
            isSmm
              ? hasGeneratedPlan
                ? true
                : canGenerateDraft &&
                  !isProcessing &&
                  !isGeneratingDraftPlan &&
                  !isOptimizingPlan &&
                  isEnrichmentServerAvailable !== false
              : hasGeneratedPlan
          }
          lastStepNextLabel={
            isSmm
              ? isGeneratingDraftPlan
                ? 'ШАГ 1/2: ГЕНЕРАЦИЯ...'
                : isOptimizingPlan
                  ? 'ШАГ 2/2: ОПТИМИЗАЦИЯ...'
                  : isProcessing
                    ? 'ФОРМИРОВАНИЕ ПЛАНА...'
                    : hasGeneratedPlan
                      ? 'ОТКРЫТЬ ГОТОВЫЙ ПЛАН'
                      : 'СФОРМИРОВАТЬ КОНТЕНТ-ПЛАН'
              : optimizationResult?.optimized_content_plan
                ? 'К ОПТИМИЗИРОВАННОМУ ПЛАНУ'
                : 'К ЧЕРНОВИКУ'
          }
          lastStepNextTitle={
            isSmm
              ? hasGeneratedPlan
                ? 'Открыть готовый план в календаре'
                : !canGenerateDraft
                  ? smmBlockedReasonsForGenerate.join(' · ')
                  : 'Сформировать и оптимизировать контент-план в один клик'
              : !hasGeneratedPlan
                ? 'Сначала сформируйте черновик'
                : optimizationResult?.optimized_content_plan
                  ? 'Открыть план после оптимизации'
                  : 'Открыть черновик без улучшения'
          }
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
          showTechnicalDetails={isAnalyst}
        />
      )}
    </>
  )
}

export default ProjectForm
