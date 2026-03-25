import { getPlanSnapshotFromServer, savePlanSnapshotToServer } from '../../../shared/api/enrichmentService'

const CURRENT_SNAPSHOT_TOKEN_KEY = 'currentContentPlanSnapshotToken'
const CURRENT_HISTORY_ENTRY_KEY = 'currentContentPlanHistoryEntry'
const PLAN_HISTORY_KEY = 'contentPlanHistory'
const MAX_HISTORY_ITEMS = 12

function stableSerialize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((item) => stableSerialize(item)).join(',')}]`
  const keys = Object.keys(value).sort()
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(',')}}`
}

function buildEntryFingerprint(entry) {
  const payload = {
    id: entry?.id || null,
    type: entry?.type || null,
    summary: entry?.summary || null,
    snapshot_token: entry?.snapshot_token || null
  }
  return stableSerialize(payload)
}

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

function buildHistorySummary(plan, optimization = null) {
  const publications = Array.isArray(plan?.publications) ? plan.publications : []
  const formats = Array.from(new Set(publications.map((item) => item?.format).filter(Boolean)))
  return {
    plan_id: plan?.plan_id || 'unknown',
    publications_count: publications.length,
    platforms: Array.isArray(plan?.platforms) ? plan.platforms : [],
    start_date: plan?.planning_horizon?.start_date || null,
    end_date: plan?.planning_horizon?.end_date || null,
    formats,
    avg_engagement_rate: plan?.kpi_targets?.avg_engagement_rate ?? null,
    estimated_conversions: plan?.kpi_targets?.estimated_conversions ?? null,
    has_notes: Boolean(plan?.notes),
    optimization_valid: optimization?.stage2?.constraints_check?.valid ?? null,
    optimization_messages: Array.isArray(optimization?.stage2?.constraints_check?.messages)
      ? optimization.stage2.constraints_check.messages
      : null
  }
}

function getCurrentSnapshotToken() {
  return safeReadJson(CURRENT_SNAPSHOT_TOKEN_KEY, null)
}

export async function getCurrentPlanState() {
  const token = getCurrentSnapshotToken()
  if (!token) return null
  try {
    const response = await getPlanSnapshotFromServer(token)
    const snapshot = response?.snapshot || null
    if (!snapshot?.plan) return null
    return {
      plan: snapshot.plan,
      optimization: snapshot.optimization || null,
      token
    }
  } catch (error) {
    console.error('Ошибка загрузки текущего snapshot плана:', error)
    return null
  }
}

export function getPlanHistory() {
  const history = safeReadJson(PLAN_HISTORY_KEY, [])
  return Array.isArray(history) ? history : []
}

/** @returns {{ id: string, type: string, saved_at: string } | null} */
export function getCurrentHistoryEntry() {
  return safeReadJson(CURRENT_HISTORY_ENTRY_KEY, null)
}

export async function savePlanSnapshot(plan, metadata = {}) {
  if (!plan || typeof plan !== 'object') return false

  const optimization = Object.prototype.hasOwnProperty.call(metadata, 'optimization')
    ? metadata.optimization || null
    : null
  const saveResponse = await savePlanSnapshotToServer({
    plan,
    optimization
  })
  const snapshot = saveResponse?.snapshot
  if (!snapshot?.token) return false
  const entry = {
    id: plan?.plan_id || `plan_${Date.now()}`,
    saved_at: snapshot.saved_at || new Date().toISOString(),
    type: metadata.type || 'draft',
    snapshot_token: snapshot.token,
    summary: snapshot.summary || buildHistorySummary(plan, optimization)
  }
  const history = getPlanHistory()
  const entryFingerprint = buildEntryFingerprint(entry)

  const historyWithoutSameFingerprint = history.filter((item) => buildEntryFingerprint(item) !== entryFingerprint)
  const nextHistory = [entry, ...historyWithoutSameFingerprint].slice(0, MAX_HISTORY_ITEMS)

  safeWriteJson(CURRENT_SNAPSHOT_TOKEN_KEY, snapshot.token)
  safeWriteJson(CURRENT_HISTORY_ENTRY_KEY, {
    id: entry.id,
    type: entry.type,
    saved_at: entry.saved_at,
    snapshot_token: entry.snapshot_token
  })
  const historySaved = safeWriteJson(PLAN_HISTORY_KEY, nextHistory)
  return historySaved
}

export async function loadPlanFromHistory(entryId, entryType = null, savedAt = null) {
  const entry = getPlanHistory().find((item) => {
    if (item?.id !== entryId) return false
    if (entryType === null) return true
    if (item?.type !== entryType) return false
    if (savedAt === null) return true
    return item?.saved_at === savedAt
  })
  if (!entry?.snapshot_token) return null
  const response = await getPlanSnapshotFromServer(entry.snapshot_token)
  const snapshot = response?.snapshot || null
  if (!snapshot?.plan) return null
  safeWriteJson(CURRENT_SNAPSHOT_TOKEN_KEY, entry.snapshot_token)
  safeWriteJson(CURRENT_HISTORY_ENTRY_KEY, {
    id: entry.id,
    type: entry.type || 'draft',
    saved_at: entry.saved_at,
    snapshot_token: entry.snapshot_token
  })
  return {
    plan: snapshot.plan,
    optimization: snapshot.optimization || null
  }
}
