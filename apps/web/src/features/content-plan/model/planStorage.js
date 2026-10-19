import {
  deletePlanSnapshotOnServer,
  getPlanSnapshotFromServer,
  listPlanSnapshotsFromServer,
  savePlanSnapshotToServer
} from '../../../shared/api/enrichmentService'
import { getCurrentUserId } from '../../../shared/api/authService'

const CURRENT_SNAPSHOT_TOKEN_KEY = 'currentContentPlanSnapshotToken'
const CURRENT_HISTORY_ENTRY_KEY = 'currentContentPlanHistoryEntry'
const PLAN_HISTORY_KEY = 'contentPlanHistory'
const MAX_HISTORY_ITEMS = 12

function scopedKey(baseKey) {
  const userId = getCurrentUserId()
  return userId ? `${baseKey}:${userId}` : null
}

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
  const scoped = scopedKey(key)
  if (!scoped) return fallbackValue
  try {
    const raw = localStorage.getItem(scoped)
    return raw ? JSON.parse(raw) : fallbackValue
  } catch (error) {
    console.error(`Ошибка чтения ${scoped}:`, error)
    return fallbackValue
  }
}

function safeWriteJson(key, value) {
  const scoped = scopedKey(key)
  if (!scoped) return false
  try {
    localStorage.setItem(scoped, JSON.stringify(value))
    return true
  } catch (error) {
    console.error(`Ошибка записи ${scoped}:`, error)
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
    const snapshotKey = scopedKey(CURRENT_SNAPSHOT_TOKEN_KEY)
    const entryKey = scopedKey(CURRENT_HISTORY_ENTRY_KEY)
    if (snapshotKey) localStorage.removeItem(snapshotKey)
    if (entryKey) localStorage.removeItem(entryKey)
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

export async function syncPlanHistoryWithServer() {
  try {
    const res = await listPlanSnapshotsFromServer(MAX_HISTORY_ITEMS)
    const serverSnapshots = Array.isArray(res?.snapshots) ? res.snapshots : []
    if (serverSnapshots.length === 0) return getPlanHistory()

    const localHistory = getPlanHistory()
    const localByToken = new Map(localHistory.map((item) => [item.snapshot_token, item]))

    const merged = serverSnapshots.map((snap) => {
      const existing = localByToken.get(snap.token)
      const inferredType =
        snap.type ||
        (snap.summary?.optimization_valid !== null && snap.summary?.optimization_valid !== undefined
          ? 'optimized'
          : 'draft')
      if (existing) {
        return {
          ...existing,
          type: existing.type || inferredType,
          summary: snap.summary || existing.summary
        }
      }
      return {
        id: snap.plan_id || `plan_${Date.parse(snap.saved_at) || Date.now()}`,
        saved_at: snap.saved_at || new Date().toISOString(),
        type: inferredType,
        snapshot_token: snap.token,
        summary: snap.summary || {
          plan_id: snap.plan_id || 'unknown',
          display_name: snap.display_name || null,
          publications_count: snap.publications_count ?? 0
        }
      }
    })

    safeWriteJson(PLAN_HISTORY_KEY, merged.slice(0, MAX_HISTORY_ITEMS))
    return merged.slice(0, MAX_HISTORY_ITEMS)
  } catch (error) {
    console.warn('Не удалось синхронизировать историю планов с сервером:', error)
    return getPlanHistory()
  }
}

export async function getCurrentPlanState() {
  let token = getCurrentSnapshotToken()
  if (!token) {
    const synced = await syncPlanHistoryWithServer()
    if (synced && synced.length > 0) {
      token = synced[0].snapshot_token
      safeWriteJson(CURRENT_SNAPSHOT_TOKEN_KEY, token)
      safeWriteJson(CURRENT_HISTORY_ENTRY_KEY, {
        id: synced[0].id,
        type: synced[0].type || 'draft',
        saved_at: synced[0].saved_at,
        snapshot_token: token
      })
    }
  }

  if (!token) return null
  try {
    const response = await getPlanSnapshotFromServer(token)
    const snapshot = response?.snapshot || null
    if (snapshot?.plan) {
      return {
        plan: snapshot.plan,
        optimization: snapshot.optimization || null,
        token
      }
    }
  } catch (error) {
    console.warn('Серверный snapshot не получен, проверка локального демо-снимка:', error)
  }

  try {
    const localRaw = localStorage.getItem(`demoPlanSnapshot:${token}`)
    if (localRaw) {
      const parsed = JSON.parse(localRaw)
      if (parsed?.plan) {
        return {
          plan: parsed.plan,
          optimization: parsed.optimization || null,
          token
        }
      }
    }
  } catch (e) {
    console.error('Ошибка чтения локального demoPlanSnapshot:', e)
  }

  return null
}

export function getPlanHistory() {
  const history = safeReadJson(PLAN_HISTORY_KEY, [])
  return Array.isArray(history) ? history : []
}

/** @returns {{ id: string, type: string, saved_at: string } | null} */
export function getCurrentHistoryEntry() {
  return safeReadJson(CURRENT_HISTORY_ENTRY_KEY, null)
}

export function getPlanSnapshotToken() {
  return getCurrentSnapshotToken()
}

function removeLocalDemoSnapshot(token) {
  if (!token) return
  try {
    localStorage.removeItem(`demoPlanSnapshot:${token}`)
  } catch {
    /* ignore */
  }
}

export async function savePlanSnapshot(plan, metadata = {}) {
  if (!plan || typeof plan !== 'object') return false

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
  let snapshot = null
  try {
    const saveResponse = await savePlanSnapshotToServer(body)
    snapshot = saveResponse?.snapshot
  } catch (err) {
    console.warn('Сервер недоступен при сохранении snapshot, сохранение локально:', err)
  }

  if (!snapshot?.token) {
    const fallbackToken =
      typeof metadata.token === 'string' && metadata.token.trim()
        ? metadata.token.trim()
        : `local_${Date.now()}`
    snapshot = {
      token: fallbackToken,
      saved_at: new Date().toISOString()
    }
  }

  const history = getPlanHistory()
  const entry = {
    id: planToSave?.plan_id || `plan_${Date.now()}`,
    saved_at: snapshot.saved_at || new Date().toISOString(),
    type: metadata.type || (optimization ? 'optimized' : 'draft'),
    snapshot_token: snapshot.token,
    summary: snapshot.summary || buildHistorySummary(planToSave, optimization)
  }
  const entryFingerprint = buildEntryFingerprint(entry)

  const historyWithoutSameFingerprint = history.filter((item) => buildEntryFingerprint(item) !== entryFingerprint)
  const tokenDeduped = historyWithoutSameFingerprint.filter((item) => item.snapshot_token !== entry.snapshot_token)
  const combinedHistory = [entry, ...tokenDeduped]
  const nextHistory = combinedHistory.slice(0, MAX_HISTORY_ITEMS)
  const keptTokens = new Set(nextHistory.map((item) => item.snapshot_token).filter(Boolean))

  for (const oldItem of history) {
    if (oldItem?.snapshot_token && !keptTokens.has(oldItem.snapshot_token)) {
      removeLocalDemoSnapshot(oldItem.snapshot_token)
    }
  }

  try {
    localStorage.setItem(
      `demoPlanSnapshot:${snapshot.token}`,
      JSON.stringify({ plan: planToSave, optimization })
    )
  } catch (e) {
    console.warn('Квота localStorage при кэшировании demoPlanSnapshot, очистка старых снимков:', e)
    try {
      for (let i = localStorage.length - 1; i >= 0; i -= 1) {
        const k = localStorage.key(i)
        if (k && k.startsWith('demoPlanSnapshot:') && k !== `demoPlanSnapshot:${snapshot.token}`) {
          localStorage.removeItem(k)
        }
      }
      localStorage.setItem(
        `demoPlanSnapshot:${snapshot.token}`,
        JSON.stringify({ plan: planToSave, optimization })
      )
    } catch (retryErr) {
      console.error('Ошибка кэширования demoPlanSnapshot:', retryErr)
    }
  }

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

/**
 * @returns {Promise<{ plan: object, optimization: object|null } | { missingSnapshot: true } | null>}
 */
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
    return null
  }
}

/**
 * Удаляет запись из истории и файл snapshot на сервере.
 * @returns {Promise<{ ok: boolean, loaded?: { plan: object, optimization: object|null } | null }>}
 */
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

  removeLocalDemoSnapshot(entry.snapshot_token)

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
  if (wasCurrent) {
    if (nextHistory.length > 0) {
      const first = nextHistory[0]
      loaded = await loadPlanFromHistory(first.id, first.type, first.saved_at)
      if (!loaded?.plan) {
        clearCurrentPlanPointers()
        loaded = null
      }
    } else {
      clearCurrentPlanPointers()
    }
  }

  return { ok: true, loaded, hadCurrentRemoved: wasCurrent }
}
