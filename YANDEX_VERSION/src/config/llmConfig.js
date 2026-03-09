/**
 * Конфигурация для LLM модуля
 */

// Получаем настройки из переменных окружения или используем значения по умолчанию
export const LLM_CONFIG = {
  apiKey: import.meta.env.VITE_YANDEX_CLOUD_API_KEY || '',
  project: import.meta.env.VITE_YANDEX_CLOUD_PROJECT || '',
  model: import.meta.env.VITE_YANDEX_CLOUD_MODEL || ''
};

/**
 * Проверяет, что все необходимые настройки заполнены
 */
export function validateConfig() {
  if (!LLM_CONFIG.apiKey) {
    throw new Error('YANDEX_CLOUD_API_KEY не установлен. Добавьте VITE_YANDEX_CLOUD_API_KEY в .env файл');
  }
  if (!LLM_CONFIG.project) {
    throw new Error('YANDEX_CLOUD_PROJECT не установлен. Добавьте VITE_YANDEX_CLOUD_PROJECT в .env файл');
  }
  if (!LLM_CONFIG.model) {
    throw new Error('YANDEX_CLOUD_MODEL не установлен. Добавьте VITE_YANDEX_CLOUD_MODEL в .env файл');
  }
  return true;
}
