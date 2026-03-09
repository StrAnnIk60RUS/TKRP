/**
 * Сервис для работы с Yandex Cloud AI API
 */
import { LLM_CONFIG, validateConfig } from '../config/llmConfig';

/**
 * Отправляет простой тестовый запрос в Yandex Cloud AI API
 * @returns {Promise<{success: boolean, text?: string, error?: string}>}
 */
export async function processLLMData() {
  try {
    validateConfig();
    const { apiKey, project, model } = LLM_CONFIG;

    // Формируем модель в формате gpt://{folder}/{model}
    // Если модель уже содержит полный путь, используем её как есть
    const modelPath = model.startsWith('gpt://') 
      ? model 
      : `gpt://${project}/${model}`;

    // Захардкоженные тестовые данные из combined_data_example.json
    const testData = {
      project_input: {
        producer_info: {
          name: "CloudTech Solutions",
          activity_specification: "Разработка и внедрение облачных решений для бизнес-аналитики и управления данными. Специализация на SaaS-платформах для среднего и крупного бизнеса."
        },
        it_project_info: {
          name: "CloudAnalytics Pro",
          description: "Облачная платформа для бизнес-аналитики с использованием искусственного интеллекта. Позволяет компаниям автоматизировать сбор, обработку и визуализацию данных, создавать интерактивные дашборды и получать прогнозы на основе машинного обучения.",
          goals: "За 3 месяца привлечь 50 новых B2B-клиентов, увеличить узнаваемость бренда в IT-сообществе, позиционировать продукт как лидера в сегменте облачной аналитики для среднего бизнеса.",
          features: "Автоматическая аналитика в реальном времени, интерактивные дашборды, прогнозирование трендов с помощью ML, интеграция с популярными CRM и ERP системами, API для разработчиков, мобильное приложение для iOS и Android.",
          benefits: "Сокращение времени на подготовку отчетов с 8 часов до 1 часа, увеличение точности прогнозов на 40%, ROI до 250% за первый год использования, масштабируемость от 10 до 10000+ пользователей."
        },
        consumer_profile: {
          category: "B2B",
          demographics: "Руководители отделов аналитики, финансовые директора, IT-директора в компаниях среднего бизнеса (50-500 сотрудников). Возраст 35-50 лет, высшее образование, опыт работы с бизнес-аналитикой от 5 лет.",
          purchase_goal: "Автоматизация процессов аналитики, повышение скорости принятия решений, снижение операционных затрат на подготовку отчетов, улучшение качества прогнозирования.",
          lifestyle: "Профессионалы, ценящие эффективность и технологичность. Активно используют LinkedIn для профессионального развития, посещают отраслевые конференции, читают специализированные издания по бизнес-аналитике и IT."
        },
        content_plan_info: {
          timeline: {
            start_date: "2026-03-01",
            end_date: "2026-05-31"
          },
          publication_frequency: "3-4_per_week",
          min_publications: "70",
          key_dates: "15 марта - запуск бета-версии, 1 апреля - вебинар по внедрению, 15 апреля - кейс-стади с первым клиентом, 1 мая - обновление функционала, 20 мая - итоговая презентация результатов.",
          total_budget: "150000",
          max_cost_per_publication: "3500",
          content_formats: ["text", "image", "video"],
          video_requirements: "Короткие ролики (1-3 минуты) с демонстрацией функционала платформы, интервью с клиентами, объяснение сложных концепций простым языком. Профессиональная съемка, субтитры, брендинг CloudTech Solutions.",
          platforms: ["linkedin", "vk", "telegram"]
        }
      },
      competitors_data: {
        parsing_metadata: {
          parsed_at: "2026-02-25T10:00:00Z",
          competitors_count: 4,
          total_posts: 127,
          platforms: ["linkedin", "vk", "telegram"],
          date_range: {
            start: "2025-12-01",
            end: "2026-02-20"
          }
        },
        competitors: [
          {
            competitor_id: "competitor_analyticshub",
            name: "AnalyticsHub",
            description: "Платформа для бизнес-аналитики с фокусом на визуализацию данных",
            platform: "linkedin",
            category: "B2B",
            follower_count: 12500,
            posts: [
              {
                post_id: "ah_linkedin_001",
                content: "Как мы помогли компании X увеличить эффективность аналитики на 45% за 3 месяца.\n\nКомпания X внедрила AnalyticsHub в ноябре 2025 года. За этот период:\n✅ Время на подготовку отчетов сократилось с 6 часов до 1.5 часов\n✅ Точность прогнозов выросла на 35%\n✅ ROI составил 220%\n\nКлючевые факторы успеха:\n1. Автоматизация рутинных процессов\n2. Интеграция с существующими системами\n3. Обучение команды работе с платформой\n\nПодробный разбор кейса в комментариях 👇\n\n#БизнесАналитика #КейсСтади #DataScience #ROI",
                post_type: "text_with_image",
                publication_date: "2026-02-15T09:00:00",
                metrics: {
                  likes: 234,
                  views: 8500,
                  comments: 42,
                  shares: 18,
                  engagement_rate: 0.034,
                  click_through_rate: 0.012
                },
                hashtags: ["#БизнесАналитика", "#КейсСтади", "#DataScience", "#ROI"],
                content_category: "case_study",
                tone: "профессиональный"
              }
            ],
            content_strategy: {
              posting_frequency: "3-4 раза в неделю",
              content_types: ["text", "text_with_image", "video"],
              themes: ["case_study", "expert_opinion", "product_updates", "events"],
              optimal_posting_times: ["09:00", "14:00", "18:00"],
              average_engagement_rate: 0.036,
              most_successful_category: "case_study"
            }
          }
        ]
      }
    };

    // Формируем промпт с данными
    const prompt = `Проанализируй данные проекта и конкурентов, создай онтологию и сгенерируй контент-план.

Входные данные:
${JSON.stringify(testData, null, 2)}

Верни полный контент-план с онтологией, анализом конкурентов и списком публикаций в формате JSON согласно инструкции.`;

    const requestBody = {
      model: modelPath,
      input: prompt
    };

    console.log('Отправка запроса с тестовыми данными:', JSON.stringify(requestBody, null, 2));

    // Используем прокси через Vite для обхода CORS
    const response = await fetch('/api/yandex/responses', {
      method: 'POST',
      headers: {
        'Authorization': `Api-Key ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = `HTTP ${response.status}: ${errorText}`;
      
      // Парсим JSON ошибки, если возможно
      try {
        const errorJson = JSON.parse(errorText);
        console.error('Ошибка API:', errorJson);
        if (errorJson.message) {
          errorMessage = errorJson.message;
        }
        if (errorJson.error) {
          errorMessage = errorJson.error;
        }
        if (response.status === 403) {
          errorMessage += '\n\nПроверьте:\n' +
            '1. Правильность API ключа (VITE_YANDEX_CLOUD_API_KEY)\n' +
            '2. Права доступа к папке в Yandex Cloud (нужна роль ai.languageModels.user или editor)\n' +
            '3. Правильность ID проекта (VITE_YANDEX_CLOUD_PROJECT)';
        }
      } catch (e) {
        // Если не JSON, используем текст как есть
        console.error('Текст ошибки:', errorText);
      }
      
      throw new Error(errorMessage);
    }

    const result = await response.json();

    // Извлекаем текст ответа
    if (result.alternatives && Array.isArray(result.alternatives) && result.alternatives.length > 0) {
      const firstAlternative = result.alternatives[0];
      if (firstAlternative.text) {
        return { success: true, data: { text: firstAlternative.text } };
      }
    }
    
    // Альтернативный формат: response.output[0].content[0].text
    if (result.output && Array.isArray(result.output) && result.output.length > 0) {
      const firstOutput = result.output[0];
      if (firstOutput.content && Array.isArray(firstOutput.content) && firstOutput.content.length > 0) {
        const firstContent = firstOutput.content[0];
        if (firstContent.text) {
          return { success: true, data: { text: firstContent.text } };
        }
      }
    }
    
    // Fallback для других форматов ответа
    if (result.output_text) {
      return { success: true, data: { text: result.output_text } };
    } else if (result.output) {
      return { success: true, data: { text: typeof result.output === 'string' ? result.output : JSON.stringify(result.output) } };
    } else {
      return { success: false, error: 'Неожиданный формат ответа от API: ' + JSON.stringify(result) };
    }
  } catch (error) {
    return { success: false, error: error.message || 'Ошибка запроса к API' };
  }
}
