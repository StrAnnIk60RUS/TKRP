import {
  deletePlanSnapshotOnServer,
  getPlanSnapshotFromServer,
  savePlanSnapshotToServer
} from '../../../shared/api/enrichmentService'

const CURRENT_SNAPSHOT_TOKEN_KEY = 'currentContentPlanSnapshotToken'
const CURRENT_HISTORY_ENTRY_KEY = 'currentContentPlanHistoryEntry'
const PLAN_HISTORY_KEY = 'contentPlanHistory'

/** Локальная история в браузере (токены + метаданные). На сервере лимит файлов — env PLAN_SNAPSHOT_MAX_FILES (по умолчанию 200). */
export const MAX_LOCAL_PLAN_HISTORY_ENTRIES = 12

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

function normalizePlanDisplayName(plan) {
  if (!plan || typeof plan !== 'object') return plan
  const raw = plan.display_name
  if (raw === undefined || raw === null) return plan
  if (typeof raw !== 'string') {
    const next = { ...plan }
    delete next.display_name
    return next
  }
  const t = raw.trim().slice(0, 120)
  const next = { ...plan }
  if (!t) delete next.display_name
  else next.display_name = t
  return next
}

function buildHistorySummary(plan, optimization = null) {
  const publications = Array.isArray(plan?.publications) ? plan.publications : []
  const formats = Array.from(new Set(publications.map((item) => item?.format).filter(Boolean)))
  const dn =
    typeof plan?.display_name === 'string' && plan.display_name.trim()
      ? plan.display_name.trim().slice(0, 120)
      : null
  return {
    plan_id: plan?.plan_id || 'unknown',
    display_name: dn,
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

function clearCurrentPlanPointers() {
  try {
    localStorage.removeItem(CURRENT_SNAPSHOT_TOKEN_KEY)
    localStorage.removeItem(CURRENT_HISTORY_ENTRY_KEY)
  } catch (error) {
    console.error('Ошибка сброса текущего плана:', error)
  }
}

function historyEntryMatches(a, b) {
  if (!a || !b) return false
  return (
    a.id === b.id &&
    a.type === b.type &&
    a.saved_at === b.saved_at &&
    a.snapshot_token === b.snapshot_token
  )
}

function removeHistoryEntryFromLocalList(entry) {
  if (!entry?.snapshot_token) return false
  const history = getPlanHistory()
  const nextHistory = history.filter(
    (item) =>
      !(
        item?.id === entry.id &&
        item?.type === entry.type &&
        item?.saved_at === entry.saved_at &&
        item?.snapshot_token === entry.snapshot_token
      )
  )
  if (nextHistory.length === history.length) return false
  safeWriteJson(PLAN_HISTORY_KEY, nextHistory)
  return true
}

function isSnapshotNotFoundError(error) {
  const msg = String(error?.message || '')
  return msg.includes('Snapshot не найден')
}

export function formatPlanSnapshotApiError(error) {
  const msg = String(error?.message || error || '')
  if (/Failed to fetch|NetworkError|Network request failed|ECONNREFUSED|load failed/i.test(msg)) {
    return 'Нет соединения с сервером API. Запустите backend (порт 3001) и проверьте VITE_ENRICHMENT_API_URL.'
  }
  if (/\b413\b|слишком большой|too large|payload/i.test(msg)) {
    return 'План слишком большой для сохранения на сервере. Уменьшите объём данных или увеличьте PLAN_SNAPSHOT_MAX_PAYLOAD_BYTES на API.'
  }
  return msg || 'Не удалось выполнить операцию со снимком плана.'
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

export function getCurrentHistoryEntry() {
  return safeReadJson(CURRENT_HISTORY_ENTRY_KEY, null)
}

export function getPlanSnapshotToken() {
  return getCurrentSnapshotToken()
}

export async function savePlanSnapshot(plan, metadata = {}) {
  if (!plan || typeof plan !== 'object') return { ok: false, message: 'Некорректный план' }

  const planToSave = normalizePlanDisplayName(plan)

  const optimization = Object.prototype.hasOwnProperty.call(metadata, 'optimization')
    ? metadata.optimization || null
    : null
  const body = {
    plan: planToSave,
    optimization
  }
  if (typeof metadata.token === 'string' && metadata.token.trim()) {
    body.token = metadata.token.trim()
  }

  let saveResponse
  try {
    saveResponse = await savePlanSnapshotToServer(body)
  } catch (error) {
    console.error('Ошибка savePlanSnapshotToServer:', error)
    return { ok: false, message: formatPlanSnapshotApiError(error) }
  }

  const snapshot = saveResponse?.snapshot
  if (!snapshot?.token) return { ok: false, message: 'Сервер не вернул токен снимка' }

  const entry = {
    id: planToSave?.plan_id || `plan_${Date.now()}`,
    saved_at: snapshot.saved_at || new Date().toISOString(),
    type: metadata.type || 'draft',
    snapshot_token: snapshot.token,
    summary: snapshot.summary || buildHistorySummary(planToSave, optimization)
  }
  const history = getPlanHistory()
  const entryFingerprint = buildEntryFingerprint(entry)

  const historyWithoutSameFingerprint = history.filter((item) => buildEntryFingerprint(item) !== entryFingerprint)
  const tokenDeduped = historyWithoutSameFingerprint.filter((item) => item.snapshot_token !== entry.snapshot_token)
  const nextHistory = [entry, ...tokenDeduped].slice(0, MAX_LOCAL_PLAN_HISTORY_ENTRIES)

  safeWriteJson(CURRENT_SNAPSHOT_TOKEN_KEY, snapshot.token)
  safeWriteJson(CURRENT_HISTORY_ENTRY_KEY, {
    id: entry.id,
    type: entry.type,
    saved_at: entry.saved_at,
    snapshot_token: entry.snapshot_token
  })
  const historySaved = safeWriteJson(PLAN_HISTORY_KEY, nextHistory)
  if (!historySaved) return { ok: false, message: 'Не удалось записать историю в localStorage' }
  return { ok: true }
}

export async function openSnapshotByToken(rawToken) {
  const token = typeof rawToken === 'string' ? rawToken.trim() : ''
  if (!token) return null
  try {
    const response = await getPlanSnapshotFromServer(token)
    const snapshot = response?.snapshot || null
    if (!snapshot?.plan) return null
    const optimization = snapshot.optimization || null
    const type = optimization ? 'optimized' : 'draft'
    const plan = snapshot.plan
    const entry = {
      id: plan?.plan_id || `plan_${Date.now()}`,
      saved_at: snapshot.saved_at || new Date().toISOString(),
      type,
      snapshot_token: token,
      summary: snapshot.summary || buildHistorySummary(plan, optimization)
    }
    const history = getPlanHistory()
    const tokenDeduped = history.filter((item) => item?.snapshot_token !== token)
    const nextHistory = [entry, ...tokenDeduped].slice(0, MAX_LOCAL_PLAN_HISTORY_ENTRIES)
    safeWriteJson(CURRENT_SNAPSHOT_TOKEN_KEY, token)
    safeWriteJson(CURRENT_HISTORY_ENTRY_KEY, {
      id: entry.id,
      type: entry.type,
      saved_at: entry.saved_at,
      snapshot_token: token
    })
    safeWriteJson(PLAN_HISTORY_KEY, nextHistory)
    return { plan, optimization }
  } catch (error) {
    console.error('Ошибка openSnapshotByToken:', error)
    if (isSnapshotNotFoundError(error)) return { missingSnapshot: true }
    return { networkError: true, message: formatPlanSnapshotApiError(error) }
  }
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
  try {
    const response = await getPlanSnapshotFromServer(entry.snapshot_token)
    const snapshot = response?.snapshot || null
    if (!snapshot?.plan) {
      removeHistoryEntryFromLocalList(entry)
      return { missingSnapshot: true }
    }
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
  } catch (error) {
    console.error('Ошибка загрузки snapshot из истории:', error)
    if (isSnapshotNotFoundError(error)) {
      removeHistoryEntryFromLocalList(entry)
      return { missingSnapshot: true }
    }
    return { networkError: true, message: formatPlanSnapshotApiError(error) }
  }
}

export async function removePlanFromHistory(entryId, entryType, savedAt) {
  const history = getPlanHistory()
  const entry = history.find((item) => {
    if (item?.id !== entryId) return false
    if (item?.type !== entryType) return false
    return item?.saved_at === savedAt
  })
  if (!entry?.snapshot_token) {
    return { ok: false }
  }

  const current = getCurrentHistoryEntry()
  const wasCurrent = historyEntryMatches(current, entry)

  try {
    await deletePlanSnapshotOnServer(entry.snapshot_token)
  } catch (error) {
    console.warn('Не удалось удалить snapshot на сервере, запись убрана из истории локально:', error)
  }

  const nextHistory = history.filter(
    (item) =>
      !(
        item?.id === entry.id &&
        item?.type === entry.type &&
        item?.saved_at === entry.saved_at &&
        item?.snapshot_token === entry.snapshot_token
      )
  )
  safeWriteJson(PLAN_HISTORY_KEY, nextHistory)

  let loaded = null
  let loadNetworkError = null
  if (wasCurrent) {
    if (nextHistory.length > 0) {
      const first = nextHistory[0]
      loaded = await loadPlanFromHistory(first.id, first.type, first.saved_at)
      if (loaded?.networkError) {
        loadNetworkError = loaded.message
        clearCurrentPlanPointers()
        loaded = null
      } else if (!loaded?.plan) {
        clearCurrentPlanPointers()
        loaded = null
      }
    } else {
      clearCurrentPlanPointers()
    }
  }

  return { ok: true, loaded, hadCurrentRemoved: wasCurrent, loadNetworkError }
}
