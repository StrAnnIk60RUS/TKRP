import { demoHorizonExampleOptions, initialFormData } from './formConfig'

const operationIds = [
  'parsing',
  'enriching',
  'searchingPrecedents',
  'seedingPrecedents',
  'exportingOntology',
  'loadingOntology',
  'generatingPlan',
  'optimizingPlan'
]

const buildOperationState = () =>
  operationIds.reduce((acc, id) => {
    acc[id] = {
      status: 'idle',
      startedAt: null,
      finishedAt: null,
      durationMs: 0,
      attempt: 0,
      error: ''
    }
    return acc
  }, {})

export const initialWizardState = {
  formData: initialFormData,
  errors: {},
  touched: {},
  toasts: [],
  isEditMode: true,
  precedentsSummary: null,
  precedentSearchQuery: '',
  precedentSearchResults: null,
  aggregatedOntology: null,
  draftPlanResult: null,
  optimizationResult: null,
  currentStep: 1,
  selectedPrecedentItem: null,
  demoHorizonExample: Object.keys(demoHorizonExampleOptions)[3] || 'example_year_plan',
  operations: buildOperationState(),
  operationTelemetry: {
    backend: 'idle',
    python: 'idle',
    llm: 'idle'
  }
}

const nowIso = () => new Date().toISOString()

export function wizardReducer(state, action) {
  switch (action.type) {
    case 'SET_FORM_DATA':
      return { ...state, formData: action.payload }
    case 'PATCH_FORM_DATA':
      return { ...state, formData: { ...state.formData, ...action.payload } }
    case 'SET_ERRORS':
      return { ...state, errors: action.payload || {} }
    case 'PATCH_ERRORS':
      return { ...state, errors: { ...state.errors, ...action.payload } }
    case 'SET_TOUCHED':
      return { ...state, touched: action.payload || {} }
    case 'PATCH_TOUCHED':
      return { ...state, touched: { ...state.touched, ...action.payload } }
    case 'PUSH_TOAST':
      return { ...state, toasts: [...state.toasts, action.payload] }
    case 'REMOVE_TOAST':
      return { ...state, toasts: state.toasts.filter((item) => item.id !== action.payload) }
    case 'SET_CURRENT_STEP':
      return { ...state, currentStep: action.payload }
    case 'SET_PRECEDENTS_SUMMARY':
      return { ...state, precedentsSummary: action.payload }
    case 'SET_PRECEDENT_QUERY':
      return { ...state, precedentSearchQuery: action.payload || '' }
    case 'SET_PRECEDENT_RESULTS':
      return { ...state, precedentSearchResults: action.payload || null }
    case 'SET_AGGREGATED_ONTOLOGY':
      return { ...state, aggregatedOntology: action.payload || null }
    case 'SET_DRAFT_PLAN_RESULT':
      return { ...state, draftPlanResult: action.payload || null }
    case 'SET_OPTIMIZATION_RESULT':
      return { ...state, optimizationResult: action.payload || null }
    case 'SET_SELECTED_PRECEDENT':
      return { ...state, selectedPrecedentItem: action.payload || null }
    case 'SET_DEMO_HORIZON':
      return { ...state, demoHorizonExample: action.payload }
    case 'SET_EDIT_MODE':
      return { ...state, isEditMode: !!action.payload }
    case 'RESET_WIZARD':
      return {
        ...initialWizardState,
        toasts: state.toasts
      }
    case 'OPERATION_START': {
      const current = state.operations[action.payload] || {}
      return {
        ...state,
        operations: {
          ...state.operations,
          [action.payload]: {
            ...current,
            status: 'running',
            startedAt: nowIso(),
            finishedAt: null,
            durationMs: 0,
            attempt: (current.attempt || 0) + 1,
            error: ''
          }
        }
      }
    }
    case 'OPERATION_SUCCESS': {
      const current = state.operations[action.payload] || {}
      const finishedAt = nowIso()
      const durationMs = current.startedAt ? Date.now() - new Date(current.startedAt).getTime() : 0
      return {
        ...state,
        operations: {
          ...state.operations,
          [action.payload]: {
            ...current,
            status: 'success',
            finishedAt,
            durationMs
          }
        }
      }
    }
    case 'OPERATION_CANCEL': {
      const current = state.operations[action.payload] || {}
      const finishedAt = nowIso()
      const durationMs = current.startedAt ? Date.now() - new Date(current.startedAt).getTime() : 0
      return {
        ...state,
        operations: {
          ...state.operations,
          [action.payload]: {
            ...current,
            status: 'cancelled',
            finishedAt,
            durationMs
          }
        }
      }
    }
    case 'OPERATION_ERROR': {
      const { operationId, error } = action.payload
      const current = state.operations[operationId] || {}
      const finishedAt = nowIso()
      const durationMs = current.startedAt ? Date.now() - new Date(current.startedAt).getTime() : 0
      return {
        ...state,
        operations: {
          ...state.operations,
          [operationId]: {
            ...current,
            status: 'error',
            error: error || 'Ошибка операции',
            finishedAt,
            durationMs
          }
        }
      }
    }
    case 'SET_OPERATION_TELEMETRY':
      return {
        ...state,
        operationTelemetry: {
          ...state.operationTelemetry,
          ...action.payload
        }
      }
    default:
      return state
  }
}

export function getCurrentProcessId(operations) {
  if (operations.optimizingPlan?.status === 'running') return 'optimizingPlan'
  if (operations.generatingPlan?.status === 'running') return 'generatingPlan'
  if (operations.enriching?.status === 'running') return 'enriching'
  if (operations.parsing?.status === 'running') return 'parsing'
  if (operations.searchingPrecedents?.status === 'running') return 'searchingPrecedents'
  if (operations.seedingPrecedents?.status === 'running') return 'seedingPrecedents'
  if (operations.exportingOntology?.status === 'running') return 'exportingOntology'
  return null
}
