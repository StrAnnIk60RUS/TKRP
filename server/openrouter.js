import axios from 'axios';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek/deepseek-chat';

// Экспортируем для проверки в server.js
export { OPENROUTER_API_KEY, DEEPSEEK_MODEL };

/**
 * Вычисляет engagement_rate для поста
 * @param {Object} metrics - метрики поста
 * @returns {number} - engagement_rate
 */
export function calculateEngagementRate(metrics) {
  const { likes = 0, comments = 0, shares = 0, views = 0 } = metrics;
  
  if (views === 0) {
    return 0;
  }
  
  return Number(((likes + comments + shares) / views).toFixed(4));
}

/**
 * Обогащает сырые данные конкурентов: вычисляет engagement_rate для всех постов
 * @param {Object} competitorsData - сырые данные от парсера
 * @returns {Object} - данные с вычисленным engagement_rate
 */
export function enrichWithEngagementRate(competitorsData) {
  const enriched = JSON.parse(JSON.stringify(competitorsData)); // глубокое копирование
  
  if (enriched.competitors && Array.isArray(enriched.competitors)) {
    enriched.competitors.forEach(competitor => {
      if (competitor.posts && Array.isArray(competitor.posts)) {
        competitor.posts.forEach(post => {
          if (post.metrics) {
            post.engagement_rate = calculateEngagementRate(post.metrics);
          }
        });
      }
    });
  }
  
  return enriched;
}

/**
 * Отправляет запрос к DeepSeek через OpenRouter API
 * @param {string} systemPrompt - системный промпт
 * @param {string} userPrompt - пользовательский промпт
 * @param {Object} options - дополнительные опции
 * @returns {Promise<Object>} - ответ от API
 */
export async function callDeepSeekAPI(systemPrompt, userPrompt, options = {}) {
  if (!OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY не установлен в переменных окружения');
  }

  const {
    temperature = 0.4,
    maxTokens = 100000, // Ограничено доступными кредитами OpenRouter (доступно ~24732)
    responseFormat = null
  } = options;

  const requestBody = {
    model: DEEPSEEK_MODEL,
    messages: [
      {
        role: 'system',
        content: systemPrompt
      },
      {
        role: 'user',
        content: userPrompt
      }
    ],
    temperature,
    max_tokens: maxTokens
  };

  // Если нужен JSON формат ответа
  if (responseFormat === 'json') {
    requestBody.response_format = { type: 'json_object' };
  }

  try {
    console.log(`[OpenRouter] Отправка запроса к ${OPENROUTER_API_URL}`);
    console.log(`[OpenRouter] Модель: ${DEEPSEEK_MODEL}`);
    console.log(`[OpenRouter] Размер промпта: ${(systemPrompt.length + userPrompt.length) / 1024} KB`);
    
    const response = await axios.post(
      OPENROUTER_API_URL,
      requestBody,
      {
        headers: {
          'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': process.env.APP_URL || 'http://localhost:5173',
          'X-Title': 'IT Project Promotion App'
        },
        timeout: 120000 // 2 минуты таймаут
      }
    );

    console.log(`[OpenRouter] Ответ получен. Статус: ${response.status}`);
    console.log(`[OpenRouter] Использовано токенов: ${response.data.usage?.total_tokens || 'N/A'}`);
    
    const content = response.data.choices?.[0]?.message?.content || null;
    if (!content) {
      console.warn('[OpenRouter] Внимание: контент отсутствует в ответе');
      console.log('[OpenRouter] Полный ответ:', JSON.stringify(response.data, null, 2));
    }

    return {
      success: true,
      data: response.data,
      content: content,
      usage: response.data.usage || null
    };
  } catch (error) {
    console.error('Ошибка при вызове OpenRouter API:', error.response?.data || error.message);
    
    let errorMessage = 'Ошибка при обращении к OpenRouter API';
    
    if (error.response?.data?.error) {
      errorMessage = error.response.data.error.message || JSON.stringify(error.response.data.error);
    } else if (error.message) {
      errorMessage = error.message;
    }
    
    // Добавляем дополнительную информацию для отладки
    if (error.response?.status) {
      errorMessage += ` (HTTP ${error.response.status})`;
    }
    
    throw new Error(errorMessage);
  }
}

/**
 * Обогащает данные конкурентов через DeepSeek
 * @param {Object} competitorsData - сырые данные от парсера (уже с engagement_rate)
 * @returns {Promise<Object>} - обогащенные данные
 */
export async function enrichCompetitorsData(competitorsData) {
  // Сначала вычисляем engagement_rate
  const dataWithEngagementRate = enrichWithEngagementRate(competitorsData);

  // Читаем системный промпт из файла
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  
  const stage1PromptPath = path.join(__dirname, '..', 'YANDEX_CLOUD_AGENT_STAGE1.txt');
  let systemPrompt;
  
  const fileContent = fs.readFileSync(stage1PromptPath, 'utf-8');
  systemPrompt = fileContent;
  // Проверяем размер данных
  const dataSize = JSON.stringify(dataWithEngagementRate).length;
  console.log(`Размер данных для отправки: ${(dataSize / 1024).toFixed(2)} KB`);
  
  if (dataSize > 1000000) { // Больше 1MB
    console.warn('Внимание: данные очень большие, это может вызвать проблемы с API');
  }

  // Формируем пользовательский промпт
  const userPrompt = `Обогати следующие данные конкурентов. 

Данные:
${JSON.stringify(dataWithEngagementRate, null, 2)}

КРИТИЧЕСКИ ВАЖНО: 
Верни ТОЛЬКО валидный JSON объект. 
НЕ используй markdown блоки (тройные обратные кавычки).
НЕ добавляй никакого текста до или после JSON.
Просто верни чистый JSON объект, начинающийся с { и заканчивающийся }.`;

  // Вызываем API
  let response;
  try {
    // DeepSeek может не поддерживать response_format, пробуем без него сначала
    response = await callDeepSeekAPI(systemPrompt, userPrompt, {
      temperature: 0.4,
      maxTokens: 100000, // Ограничено доступными кредитами OpenRouter (доступно ~24732)
      responseFormat: null // Не используем response_format, так как DeepSeek может не поддерживать
    });
  } catch (error) {
    console.error('Ошибка при вызове DeepSeek API:', error);
    throw error;
  }
  
  if (!response || !response.success) {
    throw new Error('API вернул неуспешный ответ');
  }

  // Парсим JSON ответ
  let enrichedData = null;
  let parseError = null;
  let rawContent = null;
  
  try {
    if (!response.content) {
      throw new Error('LLM не вернул контент в ответе. Проверьте API ключ и модель.');
    }
    
    const content = response.content.trim();
    rawContent = content;
    
    if (!content) {
      throw new Error('LLM вернул пустой ответ.');
    }
    
    // Улучшенное извлечение JSON из markdown блоков
    let jsonString = content;
    
    // Вариант 1: ```json ... ``` (ищем от первого ```json до последнего ```)
    const jsonStartMarker = content.indexOf('```json');
    if (jsonStartMarker !== -1) {
      const startPos = jsonStartMarker + 7; // Позиция после ```json
      const endPos = content.lastIndexOf('```');
      if (endPos > startPos) {
        jsonString = content.substring(startPos, endPos).trim();
      }
    } else {
      // Вариант 2: ``` ... ``` (без указания языка)
      const codeBlockStart = content.indexOf('```');
      if (codeBlockStart !== -1) {
        const startPos = content.indexOf('\n', codeBlockStart);
        const endPos = content.lastIndexOf('```');
        if (startPos !== -1 && endPos > startPos) {
          jsonString = content.substring(startPos + 1, endPos).trim();
          // Убираем возможный "json" в начале строки
          if (jsonString.startsWith('json\n') || jsonString.startsWith('json\r\n')) {
            jsonString = jsonString.replace(/^json[\r\n]+/, '');
          }
        }
      } else {
        // Вариант 3: Ищем JSON объект напрямую (начинается с { и заканчивается })
        const jsonStart = content.indexOf('{');
        const jsonEnd = content.lastIndexOf('}');
        if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
          jsonString = content.substring(jsonStart, jsonEnd + 1);
        }
      }
    }
    
    // Очищаем jsonString от возможных лишних символов
    jsonString = jsonString.trim();
    
    // Убираем возможные префиксы/суффиксы еще раз
    jsonString = jsonString.replace(/^```[a-z]*\s*/i, '').replace(/\s*```$/i, '');
    jsonString = jsonString.replace(/^json[\r\n]+/i, '').trim();
    
    try {
      enrichedData = JSON.parse(jsonString);
      console.log('✅ JSON успешно распарсен, размер:', jsonString.length, 'символов');
    } catch (parseErr) {
      // Попытка восстановить неполный JSON (если обрезан)
      let fixedJson = jsonString;
      const errorMsg = parseErr.message.toLowerCase();
      
      // Если ошибка связана с неполным JSON (ожидается ',' или '}' после значения)
      if (errorMsg.includes('expected') && (errorMsg.includes("'}'") || errorMsg.includes("','"))) {
        console.log('⚠️ Попытка восстановить неполный JSON...');
        
        // Подсчитываем открывающие и закрывающие скобки
        const openBraces = (jsonString.match(/\{/g) || []).length;
        const closeBraces = (jsonString.match(/\}/g) || []).length;
        const openBrackets = (jsonString.match(/\[/g) || []).length;
        const closeBrackets = (jsonString.match(/\]/g) || []).length;
        
        // Если JSON обрезан, добавляем недостающие закрывающие скобки
        if (openBraces > closeBraces || openBrackets > closeBrackets) {
          // Удаляем последнюю незавершенную запись (если есть запятая в конце)
          fixedJson = jsonString.replace(/,\s*$/, '');
          
          // Добавляем недостающие закрывающие скобки
          for (let i = 0; i < openBrackets - closeBrackets; i++) {
            fixedJson += ']';
          }
          for (let i = 0; i < openBraces - closeBraces; i++) {
            fixedJson += '}';
          }
          
          // Пробуем распарсить восстановленный JSON
          try {
            enrichedData = JSON.parse(fixedJson);
            console.log('✅ JSON успешно восстановлен и распарсен!');
            parseError = {
              message: 'JSON был обрезан, но успешно восстановлен',
              was_fixed: true,
              original_error: parseErr.message
            };
          } catch (fixErr) {
            // Восстановление не помогло, сохраняем оригинальную ошибку
            console.error('❌ Не удалось восстановить JSON:', fixErr.message);
            parseError = {
              message: parseErr.message,
              fix_attempted: true,
              fix_error: fixErr.message,
              raw_content: content.substring(0, 3000),
              json_string_attempt: jsonString.substring(0, 2000),
              json_string_length: jsonString.length,
              content_length: content.length,
              json_start_index: content.indexOf('{'),
              json_end_index: content.lastIndexOf('}'),
              open_braces: openBraces,
              close_braces: closeBraces,
              open_brackets: openBrackets,
              close_brackets: closeBrackets
            };
          }
        } else {
          // Обычная ошибка парсинга (не обрезанный JSON)
          parseError = {
            message: parseErr.message,
            raw_content: content.substring(0, 3000),
            json_string_attempt: jsonString.substring(0, 2000),
            json_string_length: jsonString.length,
            content_length: content.length,
            json_start_index: content.indexOf('{'),
            json_end_index: content.lastIndexOf('}')
          };
        }
      } else {
        // Другая ошибка парсинга
        parseError = {
          message: parseErr.message,
          raw_content: content.substring(0, 3000),
          json_string_attempt: jsonString.substring(0, 2000),
          json_string_length: jsonString.length,
          content_length: content.length,
          json_start_index: content.indexOf('{'),
          json_end_index: content.lastIndexOf('}')
        };
      }
      
      if (!enrichedData) {
        console.error('❌ Ошибка парсинга JSON ответа:', parseErr.message);
        console.log('📝 Первые 500 символов сырого контента:', content.substring(0, 500));
        console.log('📝 Первые 500 символов попытки парсинга:', jsonString.substring(0, 500));
        console.log('📝 Последние 200 символов попытки парсинга:', jsonString.substring(Math.max(0, jsonString.length - 200)));
      }
    }
  } catch (error) {
    console.error('Ошибка обработки ответа:', error);
    parseError = {
      message: error.message,
      raw_content: response.content ? response.content.substring(0, 2000) : null
    };
  }

  // ВСЕГДА возвращаем результат, даже если JSON невалидный
  return {
    enriched_data: enrichedData, // null если не удалось распарсить
    raw_response: rawContent, // Сырой ответ от LLM для отладки
    parse_error: parseError, // Информация об ошибке парсинга, если была
    usage: response.usage,
    metadata: {
      enriched_at: new Date().toISOString(),
      model: DEEPSEEK_MODEL,
      engagement_rate_calculated_locally: true,
      parse_successful: enrichedData !== null
    }
  };
}
