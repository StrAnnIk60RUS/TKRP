/**
 * Сервис для обогащения данных конкурентов через DeepSeek (OpenRouter)
 */

const API_URL = import.meta.env.VITE_ENRICHMENT_API_URL || 'http://localhost:3001';

/**
 * Обогащает данные конкурентов через DeepSeek API
 * @param {Object} competitorsData - сырые данные конкурентов от парсера
 * @returns {Promise<Object>} - обогащенные данные
 */
export async function enrichCompetitorsData(competitorsData) {
  try {
    const response = await fetch(`${API_URL}/api/enrich`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        competitors_data: competitorsData
      })
    });

    if (!response.ok) {
      let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
      try {
        const errorData = await response.json();
        errorMessage = errorData.error || errorData.message || errorMessage;
      } catch (e) {
        // Если не удалось распарсить JSON, используем текст ответа
        const text = await response.text().catch(() => 'Неизвестная ошибка');
        errorMessage = text || errorMessage;
      }
      throw new Error(errorMessage);
    }

    const result = await response.json();
    
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
    const response = await fetch(`${API_URL}/api/parse`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url, limit })
    });

    if (!response.ok) {
      let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
      try {
        const errorData = await response.json();
        errorMessage = errorData.error || errorData.message || errorMessage;
      } catch (e) {
        const text = await response.text().catch(() => 'Неизвестная ошибка');
        errorMessage = text || errorMessage;
      }
      throw new Error(errorMessage);
    }

    const result = await response.json();
    return result;
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
    const response = await fetch(`${API_URL}/api/parse-and-enrich`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url })
    });

    if (!response.ok) {
      let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
      try {
        const errorData = await response.json();
        errorMessage = errorData.error || errorData.message || errorMessage;
      } catch (e) {
        const text = await response.text().catch(() => 'Неизвестная ошибка');
        errorMessage = text || errorMessage;
      }
      throw new Error(errorMessage);
    }

    const result = await response.json();
    return result;
  } catch (error) {
    console.error('Ошибка в parseAndEnrichByUrl:', error);
    throw error;
  }
}
