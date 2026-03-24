/**
 * Хранилище черновиков на диске (persistence между перезапусками сервера)
 */
import { readFile, writeFile, mkdir } from 'fs/promises'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DRAFT_FILE = join(__dirname, '../../.data', 'wizard-draft.json')

async function ensureDataDir() {
  const dir = dirname(DRAFT_FILE)
  await mkdir(dir, { recursive: true })
}

export async function loadDraft() {
  try {
    const raw = await readFile(DRAFT_FILE, 'utf-8')
    const data = JSON.parse(raw)
    return data?.draft ?? null
  } catch (err) {
    if (err.code === 'ENOENT') return null
    console.error('Ошибка загрузки черновика:', err.message)
    return null
  }
}

export async function saveDraft(draft) {
  try {
    await ensureDataDir()
    const payload = {
      draft,
      updated_at: new Date().toISOString()
    }
    await writeFile(DRAFT_FILE, JSON.stringify(payload, null, 2), 'utf-8')
    return true
  } catch (err) {
    console.error('Ошибка сохранения черновика:', err.message)
    return false
  }
}
