/**
 * Сервис для обогащения данных конкурентов через DeepSeek (OpenRouter)
 */

const API_URL = import.meta.env.VITE_ENRICHMENT_API_URL || 'http://localhost:3001';

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

const fetchJsonOrThrow = async (endpoint, options) => {
  const response = await fetch(endpoint, options)
  if (!response.ok) {
    throw new Error(await buildFetchErrorMessage(response))
  }
  return await response.json()
}

/**
 * Обогащает данные конкурентов через DeepSeek API
 * @param {Object} competitorsData - сырые данные конкурентов от парсера
 * @returns {Promise<Object>} - обогащенные данные
 */
export async function enrichCompetitorsData(competitorsData) {
  try {
    const result = await fetchJsonOrThrow(`${API_URL}/api/enrich`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ competitors_data: competitorsData })
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
export async function checkEnrichmentServer() {
  try {
    const response = await fetch(`${API_URL}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(3000) // 3 секунды таймаут
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
export async function parseCompetitorByUrl(url, limit) {
  try {
    return await fetchJsonOrThrow(`${API_URL}/api/parse`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ url, limit })
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
export async function parseAndEnrichByUrl(url) {
  try {
    return await fetchJsonOrThrow(`${API_URL}/api/parse-and-enrich`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ url })
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
export async function getPrecedentsSummary() {
  try {
    return await fetchJsonOrThrow(`${API_URL}/api/precedents/summary`, {
      method: 'GET'
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
export async function seedDemoPrecedents() {
  try {
    return await fetchJsonOrThrow(`${API_URL}/api/precedents/seed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
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
export async function searchPrecedents(payload) {
  try {
    return await fetchJsonOrThrow(`${API_URL}/api/precedents/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    })
  } catch (error) {
    console.error('Ошибка в searchPrecedents:', error);
    throw error;
  }
}

/**
 * Скачивает Excel-файл с онтологией (классы, сущности, отношения) из базы прецедентов
 * @returns {Promise<void>}
 */
export async function exportOntologyToExcel() {
  const response = await fetch(`${API_URL}/api/precedents/ontology/export`, { method: 'GET' })
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
 * Генерирует черновой контент-план на основе формы и прецедентов (RAG -> LLM)
 * @param {Object} payload
 * @returns {Promise<Object>}
 */
export async function generateDraftContentPlan(payload) {
  try {
    return await fetchJsonOrThrow(`${API_URL}/api/plan/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
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
export async function optimizeDraftContentPlan(payload) {
  try {
    return await fetchJsonOrThrow(`${API_URL}/api/plan/optimize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    })
  } catch (error) {
    console.error('Ошибка в optimizeDraftContentPlan:', error);
    throw error;
  }
}
