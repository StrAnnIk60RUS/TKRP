/**
 * Хранилище черновиков на диске (persistence между перезапусками сервера).
 * Writes are atomic (tmp file + rename) and serialized per key via an
 * in-process lock chain to avoid interleaved writes.
 */
import { readFile, writeFile, rename, mkdir, unlink } from 'fs/promises'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { recordStorageSample, recordStorageError } from '../../../shared/runtime/storageMetrics.js'
import { isDatabaseEnabled, query } from '../../../shared/db/client.js'

// DB backend (wizard_drafts table, migration 004) is primary when the database
// is enabled; JSON files remain the fallback (never deleted).
const DB_DRAFT_GLOBAL_KEY = 'global'

const __dirname = dirname(fileURLToPath(import.meta.url))
const API_RUNTIME_DIR = join(__dirname, '..', '..', '..', '..', '..', '..', 'data', 'runtime', 'api')
const DRAFT_FILE = join(API_RUNTIME_DIR, 'wizard-draft.json')
const DRAFTS_DIR = join(API_RUNTIME_DIR, 'drafts')

function draftPathForUser(userId) {
  if (!userId || !/^[a-zA-Z0-9_-]{1,64}$/.test(String(userId))) return DRAFT_FILE
  return join(DRAFTS_DIR, `${String(userId)}.json`)
}

async function ensureDataDir(file) {
  await mkdir(dirname(file), { recursive: true })
}

function draftKeyForUser(userId) {
  if (!userId || !/^[a-zA-Z0-9_-]{1,64}$/.test(String(userId))) return DB_DRAFT_GLOBAL_KEY
  return String(userId)
}

async function dbLoadDraft(key) {
  const res = await query('SELECT draft FROM wizard_drafts WHERE draft_key = $1', [key])
  if (!res.rows.length) return null
  const payload = res.rows[0].draft
  return payload?.draft ?? null
}

async function dbSaveDraft(key, draft) {
  const payload = {
    draft,
    updated_at: new Date().toISOString()
  }
  await query(
    'INSERT INTO wizard_drafts (draft_key, draft, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (draft_key) DO UPDATE SET draft = EXCLUDED.draft, updated_at = EXCLUDED.updated_at',
    [key, payload]
  )
}

// Per-key lock chain: writes to the same draft file never overlap.
const lockChains = new Map()

async function withKeyLock(key, fn) {
  const previous = lockChains.get(key) ?? Promise.resolve()
  const current = previous.then(fn).catch(() => undefined)
  lockChains.set(key, current)
  current.then(() => {
    if (lockChains.get(key) === current) lockChains.delete(key)
  })
  await current
}

async function atomicWriteFile(file, contents) {
  const tmpPath = `${file}.${process.pid}.${Date.now()}.tmp`
  try {
    await writeFile(tmpPath, contents, 'utf-8')
    await rename(tmpPath, file)
  } catch (err) {
    try {
      await unlink(tmpPath)
    } catch {
      /* tmp cleanup is best-effort */
    }
    throw err
  }
}

export async function loadDraft(userId = null) {
  if (isDatabaseEnabled()) {
    const started = Date.now()
    try {
      const draft = await dbLoadDraft(draftKeyForUser(userId))
      recordStorageSample('draft.load', Date.now() - started)
      if (draft !== null) return draft
      // DB has no record for this key: fall through to JSON for back-compat.
    } catch (err) {
      recordStorageError('draft.load')
      console.warn('Ошибка loading draft из DB, fallback JSON:', err.message)
    }
  }
  const file = draftPathForUser(userId)
  const started = Date.now()
  try {
    const raw = await readFile(file, 'utf-8')
    recordStorageSample('draft.load', Date.now() - started)
    const data = JSON.parse(raw)
    return data?.draft ?? null
  } catch (err) {
    recordStorageError('draft.load')
    if (err.code === 'ENOENT') return null
    console.error('Ошибка загрузки черновика:', err.message)
    return null
  }
}

export async function saveDraft(draft, userId = null) {
  if (isDatabaseEnabled()) {
    const started = Date.now()
    const key = draftKeyForUser(userId)
    try {
      await withKeyLock(`db:${key}`, async () => {
        await dbSaveDraft(key, draft)
      })
      recordStorageSample('draft.save', Date.now() - started)
      return true
    } catch (err) {
      recordStorageError('draft.save')
      console.warn('Ошибка saving draft to DB, fallback JSON:', err.message)
    }
  }
  const file = draftPathForUser(userId)
  const key = file
  const started = Date.now()
  try {
    await withKeyLock(key, async () => {
      await ensureDataDir(file)
      const payload = {
        draft,
        updated_at: new Date().toISOString()
      }
      await atomicWriteFile(file, JSON.stringify(payload, null, 2))
    })
    recordStorageSample('draft.save', Date.now() - started)
    return true
  } catch (err) {
    recordStorageError('draft.save')
    console.error('Ошибка сохранения черновика:', err.message)
    return false
  }
}
