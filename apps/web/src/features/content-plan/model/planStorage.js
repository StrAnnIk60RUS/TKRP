const CURRENT_PLAN_KEY = 'currentContentPlan'
const CURRENT_OPTIMIZATION_KEY = 'currentContentPlanOptimization'
const CURRENT_HISTORY_ENTRY_KEY = 'currentContentPlanHistoryEntry'
const PLAN_HISTORY_KEY = 'contentPlanHistory'
const MAX_HISTORY_ITEMS = 12
const DEDUP_WINDOW_MS = 15_000 // если та же plan_id+type сохранена повторно в течение 15 сек — заменяем

function safeReadJson(key, fallbackValue) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallbackValue
  } catch (error) {
    console.error(`Ошибка чтения ${key}:`, error)
    return fallbackValue
  }
}

function safeWriteJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch (error) {
    console.error(`Ошибка записи ${key}:`, error)
    return false
  }
}

function saveCurrentSnapshot(plan, metadata = {}) {
  const currentSaved = safeWriteJson(CURRENT_PLAN_KEY, plan)
  const shouldUpdateOptimization = Object.prototype.hasOwnProperty.call(metadata, 'optimization')
  let optimizationSaved = true

  if (shouldUpdateOptimization) {
    if (metadata.optimization === null) {
      try {
        localStorage.removeItem(CURRENT_OPTIMIZATION_KEY)
        optimizationSaved = true
      } catch (error) {
        console.error(`Ошибка удаления ${CURRENT_OPTIMIZATION_KEY}:`, error)
        optimizationSaved = false
      }
    } else {
      optimizationSaved = safeWriteJson(CURRENT_OPTIMIZATION_KEY, metadata.optimization)
    }
  }

  return { currentSaved, optimizationSaved }
}

function buildHistoryEntry(plan, metadata = {}) {
  const publications = Array.isArray(plan?.publications) ? plan.publications : []
  const formats = Array.from(new Set(publications.map((item) => item?.format).filter(Boolean)))

  return {
    id: plan?.plan_id || `plan_${Date.now()}`,
    saved_at: new Date().toISOString(),
    type: metadata.type || 'draft',
    plan,
    optimization: metadata.optimization || null,
    summary: {
      plan_id: plan?.plan_id || 'unknown',
      publications_count: publications.length,
      platforms: Array.isArray(plan?.platforms) ? plan.platforms : [],
      start_date: plan?.planning_horizon?.start_date || null,
      end_date: plan?.planning_horizon?.end_date || null,
      formats,
      avg_engagement_rate: plan?.kpi_targets?.avg_engagement_rate ?? null,
      estimated_conversions: plan?.kpi_targets?.estimated_conversions ?? null,
      total_budget: plan?.constraints?.total_budget ?? null,
      max_cost_per_publication: plan?.constraints?.max_cost_per_publication ?? null,
      has_notes: Boolean(plan?.notes),
      optimization_valid: metadata.optimization?.stage2?.constraints_check?.valid ?? null
    }
  }
}

export function getCurrentPlan() {
  return safeReadJson(CURRENT_PLAN_KEY, null)
}

export function getCurrentOptimization() {
  return safeReadJson(CURRENT_OPTIMIZATION_KEY, null)
}

export function getPlanHistory() {
  const history = safeReadJson(PLAN_HISTORY_KEY, [])
  return Array.isArray(history) ? history : []
}

/** @returns {{ id: string, type: string, saved_at: string } | null} */
export function getCurrentHistoryEntry() {
  return safeReadJson(CURRENT_HISTORY_ENTRY_KEY, null)
}

export function savePlanSnapshot(plan, metadata = {}) {
  if (!plan || typeof plan !== 'object') return false

  const { currentSaved, optimizationSaved } = saveCurrentSnapshot(plan, metadata)

  const entry = buildHistoryEntry(plan, metadata)
  const history = getPlanHistory()
  const now = Date.now()
  const last = history[0]

  let nextHistory
  if (
    last &&
    last.id === entry.id &&
    last.type === entry.type &&
    now - new Date(last.saved_at).getTime() < DEDUP_WINDOW_MS
  ) {
    nextHistory = [entry, ...history.slice(1)].slice(0, MAX_HISTORY_ITEMS)
  } else {
    nextHistory = [entry, ...history].slice(0, MAX_HISTORY_ITEMS)
  }

  safeWriteJson(CURRENT_HISTORY_ENTRY_KEY, {
    id: entry.id,
    type: entry.type,
    saved_at: entry.saved_at
  })
  const historySaved = safeWriteJson(PLAN_HISTORY_KEY, nextHistory)
  return currentSaved && optimizationSaved && historySaved
}

export function loadPlanFromHistory(entryId, entryType = null, savedAt = null) {
  const entry = getPlanHistory().find((item) => {
    if (item?.id !== entryId) return false
    if (entryType === null) return true
    if (item?.type !== entryType) return false
    if (savedAt === null) return true
    return item?.saved_at === savedAt
  })
  if (!entry?.plan) return null
  saveCurrentSnapshot(entry.plan, {
    type: entry.type || 'draft',
    optimization: entry.optimization || null
  })
  safeWriteJson(CURRENT_HISTORY_ENTRY_KEY, {
    id: entry.id,
    type: entry.type || 'draft',
    saved_at: entry.saved_at
  })
  return entry.plan
}
