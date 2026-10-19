/**
 * Сервис для обогащения данных конкурентов через LLM
 */

const API_URL =
  import.meta.env.VITE_ENRICHMENT_API_URL !== undefined &&
  import.meta.env.VITE_ENRICHMENT_API_URL !== ''
    ? import.meta.env.VITE_ENRICHMENT_API_URL
    : (import.meta.env.DEV ? 'http://localhost:3001' : '');

const buildFetchErrorMessage = async (response) => {
  let errorMessage = `HTTP ${response.status}: ${response.statusText}`
  try {
    const errorData = await response.json()
    errorMessage = errorData.error || errorData.message || errorMessage
  } catch (e) {
    // Если не удалось распарсить JSON, используем текст ответа
    const text = await response.text().catch(() => 'Неизвестная ошибка')
    errorMessage = text || errorMessage
  }
  return errorMessage
}

import { authHeaders } from './authService.js';

// Network/CORS-level fetch failures (TypeError: "Failed to fetch") are opaque for users;
// convert them into an actionable message. HTTP errors keep their own handling.
const safeFetch = async (endpoint, options = {}) => {
  try {
    return await fetch(endpoint, options);
  } catch (error) {
    if (error?.name === 'TypeError') {
      const serverDesc = API_URL || 'сервер';
      throw new Error(`Не удалось подключиться к серверу (${serverDesc}). Проверьте, что сервер запущен и адрес страницы разрешён.`);
    }
    throw error;
  }
};

const fetchJsonOrThrow = async (endpoint, options = {}) => {
  const headers = { ...(options.headers || {}), ...authHeaders() };
  const response = await safeFetch(endpoint, { ...options, headers });
  if (!response.ok) {
    throw new Error(await buildFetchErrorMessage(response))
  }
  return await response.json()
}

/**
 * Обогащает данные конкурентов через LLM API
 * @param {Object} competitorsData - сырые данные конкурентов от парсера
 * @returns {Promise<Object>} - обогащенные данные
 */
export async function enrichCompetitorsData(competitorsData, requestOptions = {}) {
  try {
    const result = await fetchJsonOrThrow(`${API_URL}/api/enrich`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ competitors_data: competitorsData }),
      signal: requestOptions.signal
    })
    
    // Если есть ошибка и нет даже raw_response, значит реальная ошибка
    if (!result.success && !result.raw_response && result.error) {
      throw new Error(result.error || 'Ошибка при обогащении данных');
    }
    
    // Если success = false, но есть raw_response - это значит JSON невалидный, но данные есть
    // Возвращаем результат для дальнейшей обработки (файл все равно скачается)
    if (!result.success && result.raw_response) {
      console.warn('JSON ответ невалидный, но raw_response получен:', result.raw_response.substring(0, 200));
    }

    return result;
  } catch (error) {
    console.error('Ошибка при обогащении данных:', error);
    throw error;
  }
}

/**
 * Проверяет доступность сервера обогащения
 * @returns {Promise<boolean>} - true если сервер доступен
 */
export async function checkEnrichmentServer(requestOptions = {}) {
  try {
    const response = await fetch(`${API_URL}/health`, {
      method: 'GET',
      signal: requestOptions.signal || AbortSignal.timeout(3000) // 3 секунды таймаут
    });
    return response.ok;
  } catch (error) {
    return false;
  }
}

/**
 * Только парсинг конкурента по URL через backend (без вызова LLM)
 * @param {string} url - ссылка на профиль/пост конкурента
 * @param {number|null} limit - максимальное количество постов (null или undefined = все посты)
 * @returns {Promise<Object>} - результат parse-only
 */
export async function parseCompetitorByUrl(url, limit, requestOptions = {}) {
  try {
    return await fetchJsonOrThrow(`${API_URL}/api/parse`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ url, limit }),
      signal: requestOptions.signal
    })
  } catch (error) {
    console.error('Ошибка в parseCompetitorByUrl:', error);
    throw error;
  }
}

/**
 * Полный цикл: парсинг и обогащение конкурента по URL через backend
 * @param {string} url - ссылка на профиль/пост конкурента
 * @returns {Promise<Object>} - результат пайплайна parse-and-enrich
 */
export async function parseAndEnrichByUrl(url, requestOptions = {}) {
  try {
    return await fetchJsonOrThrow(`${API_URL}/api/parse-and-enrich`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ url }),
      signal: requestOptions.signal
    })
  } catch (error) {
    console.error('Ошибка в parseAndEnrichByUrl:', error);
    throw error;
  }
}

/**
 * Получает краткую сводку по накопленной базе прецедентов
 * @returns {Promise<Object>}
 */
export async function getPrecedentsSummary(requestOptions = {}) {
  try {
    return await fetchJsonOrThrow(`${API_URL}/api/precedents/summary`, {
      method: 'GET',
      signal: requestOptions.signal
    })
  } catch (error) {
    console.error('Ошибка в getPrecedentsSummary:', error);
    throw error;
  }
}

/**
 * Загружает демо-базу прецедентов (фикстура) для проверки поиска без парсинга/обогащения
 * @returns {Promise<Object>}
 */
export async function seedDemoPrecedents(requestOptions = {}) {
  try {
    return await fetchJsonOrThrow(`${API_URL}/api/precedents/seed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: requestOptions.signal
    })
  } catch (error) {
    console.error('Ошибка в seedDemoPrecedents:', error);
    throw error;
  }
}

/**
 * Выполняет минимальный RAG-поиск по базе прецедентов
 * @param {Object} payload
 * @returns {Promise<Object>}
 */
export async function searchPrecedents(payload, requestOptions = {}) {
  try {
    return await fetchJsonOrThrow(`${API_URL}/api/precedents/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload),
      signal: requestOptions.signal
    })
  } catch (error) {
    console.error('Ошибка в searchPrecedents:', error);
    throw error;
  }
}

/**
 * Получает нормализованную агрегированную онтологию из базы прецедентов
 * @returns {Promise<Object>}
 */
export async function getAggregatedOntology(requestOptions = {}) {
  try {
    return await fetchJsonOrThrow(`${API_URL}/api/precedents/ontology`, {
      method: 'GET',
      signal: requestOptions.signal
    })
  } catch (error) {
    console.error('Ошибка в getAggregatedOntology:', error);
    throw error;
  }
}

/**
 * Скачивает Excel-файл с онтологией (классы, сущности, отношения) из базы прецедентов
 * @returns {Promise<void>}
 */
export async function exportOntologyToExcel(requestOptions = {}) {
  const response = await safeFetch(`${API_URL}/api/precedents/ontology/export`, {
    method: 'GET',
    headers: authHeaders(),
    signal: requestOptions.signal
  })
  if (!response.ok) {
    const err = await buildFetchErrorMessage(response)
    throw new Error(err)
  }
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `ontology_${new Date().toISOString().slice(0, 10)}.xlsx`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

/**
 * Скачивает онтологию в формате Turtle/RDF
 * @returns {Promise<void>}
 */
export async function exportOntologyToTurtle(requestOptions = {}) {
  const response = await safeFetch(`${API_URL}/api/precedents/ontology/export/turtle`, {
    method: 'GET',
    headers: authHeaders(),
    signal: requestOptions.signal
  })
  if (!response.ok) {
    const err = await buildFetchErrorMessage(response)
    throw new Error(err)
  }
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `ontology_${new Date().toISOString().slice(0, 10)}.ttl`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

/**
 * Генерирует черновой контент-план на основе формы и прецедентов (RAG -> LLM)
 * @param {Object} payload
 * @returns {Promise<Object>}
 */
export async function generateDraftContentPlan(payload, requestOptions = {}) {
  try {
    return await fetchJsonOrThrow(`${API_URL}/api/plan/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload),
      signal: requestOptions.signal
    })
  } catch (error) {
    console.error('Ошибка в generateDraftContentPlan:', error);
    throw error;
  }
}

/**
 * Запускает 2-уровневую эволюционную оптимизацию (ГА) для чернового контент-плана.
 * @param {Object} payload
 * @returns {Promise<Object>}
 */
function waitForJob(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (signal) signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new DOMException('The operation was aborted.', 'AbortError'))
    }
    if (signal?.aborted) {
      onAbort()
      return
    }
    if (signal) signal.addEventListener('abort', onAbort, { once: true })
  })
}

export async function optimizeDraftContentPlan(payload, requestOptions = {}) {
  try {
    const started = await fetchJsonOrThrow(`${API_URL}/api/plan/optimize:async`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload),
      signal: requestOptions.signal
    })
    const jobId = started?.job_id
    if (!jobId) {
      throw new Error('Сервер не вернул job_id для оптимизации')
    }
    const deadline = Date.now() + 15 * 60 * 1000
    while (Date.now() < deadline) {
      await waitForJob(2000, requestOptions.signal)
      const status = await fetchJsonOrThrow(`${API_URL}/api/plan/jobs/${jobId}`, {
        method: 'GET',
        signal: requestOptions.signal
      })
      const job = status?.job
      if (job?.status === 'completed') {
        return { success: true, ...(job.result || {}) }
      }
      if (job?.status === 'failed') {
        throw new Error(job.error || 'Оптимизация завершилась с ошибкой')
      }
    }
    throw new Error('Оптимизация не завершилась за отведённое время')
  } catch (error) {
    console.error('Ошибка в optimizeDraftContentPlan:', error);
    throw error;
  }
}

export async function getServerDraft(requestOptions = {}) {
  try {
    return await fetchJsonOrThrow(`${API_URL}/api/plan/draft/current`, {
      method: 'GET',
      signal: requestOptions.signal
    })
  } catch (error) {
    console.error('Ошибка в getServerDraft:', error)
    throw error
  }
}

export async function saveServerDraft(payload, requestOptions = {}) {
  try {
    return await fetchJsonOrThrow(`${API_URL}/api/plan/draft/current`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload),
      signal: requestOptions.signal
    })
  } catch (error) {
    console.error('Ошибка в saveServerDraft:', error)
    throw error
  }
}

export async function savePlanSnapshotToServer(payload, requestOptions = {}) {
  try {
    return await fetchJsonOrThrow(`${API_URL}/api/plan/snapshots`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload),
      signal: requestOptions.signal
    })
  } catch (error) {
    console.error('Ошибка в savePlanSnapshotToServer:', error)
    throw error
  }
}

export async function getPlanSnapshotFromServer(token, requestOptions = {}) {
  try {
    return await fetchJsonOrThrow(`${API_URL}/api/plan/snapshots/${encodeURIComponent(token)}`, {
      method: 'GET',
      signal: requestOptions.signal
    })
  } catch (error) {
    console.error('Ошибка в getPlanSnapshotFromServer:', error)
    throw error
  }
}

export async function listPlanSnapshotsFromServer(limit = 50, requestOptions = {}) {
  try {
    return await fetchJsonOrThrow(`${API_URL}/api/plan/snapshots?limit=${encodeURIComponent(limit)}`, {
      method: 'GET',
      signal: requestOptions.signal
    })
  } catch (error) {
    console.error('Ошибка в listPlanSnapshotsFromServer:', error)
    throw error
  }
}

export async function generatePublicationMedia(payload, requestOptions = {}) {
  const started = await fetchJsonOrThrow(`${API_URL}/api/plan/media`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload),
    signal: requestOptions.signal
  })
  const jobId = started?.job_id
  if (!jobId) throw new Error('Сервер не вернул job_id для генерации медиа')
  const deadline = Date.now() + 8 * 60 * 1000
  while (Date.now() < deadline) {
    await waitForJob(2500, requestOptions.signal)
    const status = await fetchJsonOrThrow(`${API_URL}/api/plan/jobs/${jobId}`, {
      method: 'GET',
      signal: requestOptions.signal
    })
    const job = status?.job
    if (job?.status === 'completed') {
      if (!job.result?.url) throw new Error('Сервер не вернул файл медиа')
      return job.result
    }
    if (job?.status === 'failed') {
      throw new Error(job.error || 'Генерация медиа завершилась с ошибкой')
    }
  }
  throw new Error('Генерация медиа превысила время ожидания')
}

export async function fetchPlanMediaBlob(urlPath, requestOptions = {}) {
  const safePath = typeof urlPath === 'string' ? urlPath.trim() : ''
  if (
    !safePath.startsWith('/api/plan/media/files/') ||
    safePath.startsWith('//') ||
    safePath.includes('..') ||
    safePath.includes('@') ||
    safePath.includes('\\')
  ) {
    throw new Error('Недопустимый путь к медиафайлу плана')
  }
  const response = await safeFetch(`${API_URL}${safePath}`, {
    method: 'GET',
    headers: authHeaders(),
    signal: requestOptions.signal
  })
  if (!response.ok) throw new Error(await buildFetchErrorMessage(response))
  return response.blob()
}

export async function deletePlanSnapshotOnServer(token, requestOptions = {}) {
  try {
    return await fetchJsonOrThrow(`${API_URL}/api/plan/snapshots/${encodeURIComponent(token)}`, {
      method: 'DELETE',
      signal: requestOptions.signal
    })
  } catch (error) {
    console.error('Ошибка в deletePlanSnapshotOnServer:', error)
    throw error
  }
}

export async function predictPostMetricsLive(publications, requestOptions = {}) {
  return await fetchJsonOrThrow(`${API_URL}/api/ml/relevance/predict`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ publications }),
    signal: requestOptions.signal
  })
}

