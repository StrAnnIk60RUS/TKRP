/**
 * Реестр функциональных требований (табл. 2.1, п. 5.1, UI-сценарии п. 2.2).
 * Используется автотестами матрицы FR и отчётом npm run test:fr.
 */

export const FR_REQUIREMENTS = [
  // —— Блок 1: Семантическое обогащение ——
  {
    id: 'FR-2.1-01',
    block: '1. Семантическое обогащение (LLM)',
    layer: 'UI',
    role: 'Маркетолог / аналитик',
    title: 'Загружает файл или JSON — структура конкурентов и постов (экран формы проекта)',
    check: 'checkFr_2_1_01'
  },
  {
    id: 'FR-2.1-02',
    block: '1. Семантическое обогащение (LLM)',
    layer: 'UI',
    role: 'Маркетолог / аналитик',
    title: 'Запускает семантическое обогащение — уведомления и выгрузка JSON результата',
    check: 'checkFr_2_1_02'
  },
  {
    id: 'FR-2.1-03',
    block: '1. Семантическое обогащение (LLM)',
    layer: 'API',
    role: 'Система',
    title: 'POST /api/enrich — проверка лимитов запроса до вызова БЯМ (request_guardrails)',
    check: 'checkFr_2_1_03'
  },
  {
    id: 'FR-2.1-04',
    block: '1. Семантическое обогащение (LLM)',
    layer: 'module',
    role: 'Система',
    title: 'Локальный расчёт engagement_rate и качества метрик до вызова БЯМ',
    check: 'checkFr_2_1_04'
  },
  {
    id: 'FR-2.1-05',
    block: '1. Семантическое обогащение (LLM)',
    layer: 'module',
    role: 'Система',
    title: 'Нарезка постов на батчи (лимиты постов и UTF-8, ENRICH_AUTO_BATCH)',
    check: 'checkFr_2_1_05'
  },
  {
    id: 'FR-2.1-06',
    block: '1. Семантическое обогащение (LLM)',
    layer: 'module',
    role: 'Система',
    title: 'Запрос к БЯМ батчами — JSON-ответ по source_post_id',
    check: 'checkFr_2_1_06'
  },
  {
    id: 'FR-2.1-07',
    block: '1. Семантическое обогащение (LLM)',
    layer: 'module',
    role: 'Система',
    title: 'Слияние и нормализация результатов батчей (частичное слияние)',
    check: 'checkFr_2_1_07'
  },
  // —— Блок 2: Корпус прецедентов и RAG ——
  {
    id: 'FR-2.1-08',
    block: '2. Корпус прецедентов и RAG',
    layer: 'UI',
    role: 'Маркетолог / аналитик',
    title: 'Инициирует поиск прецедентов — POST /api/precedents/search (query, limit, фильтры)',
    check: 'checkFr_2_1_08'
  },
  {
    id: 'FR-2.1-09',
    block: '2. Корпус прецедентов и RAG',
    layer: 'API',
    role: 'Система',
    title: 'searchPrecedents — retrieval, hybrid_weights, reliability на результатах',
    check: 'checkFr_2_1_09'
  },
  {
    id: 'FR-2.1-10',
    block: '2. Корпус прецедентов и RAG',
    layer: 'module',
    role: 'Система',
    title: 'Эмбеддинги текстов — конфигурация EMBEDDING_MODEL и батчирование',
    check: 'checkFr_2_1_10'
  },
  // —— Блок 3: Генерация черновика ——
  {
    id: 'FR-2.1-11',
    block: '3. Генерация черновика (LLM + RAG)',
    layer: 'API',
    role: 'Маркетолог / аналитик',
    title: 'POST /api/plan/generate и /generate-batched — черновой контент-план',
    check: 'checkFr_2_1_11'
  },
  {
    id: 'FR-2.1-12',
    block: '3. Генерация черновика (LLM + RAG)',
    layer: 'UI',
    role: 'Система',
    title: 'Формирование rag_query из form_input (buildSuggestedPrecedentQuery)',
    check: 'checkFr_2_1_12'
  },
  {
    id: 'FR-2.1-13',
    block: '3. Генерация черновика (LLM + RAG)',
    layer: 'API',
    role: 'Система',
    title: 'Фильтрация контекста retrieval — rag_limit, platforms, audience_segments',
    check: 'checkFr_2_1_13'
  },
  {
    id: 'FR-2.1-14',
    block: '3. Генерация черновика (LLM + RAG)',
    layer: 'module',
    role: 'Система',
    title: 'Сжатие RAG-контекста для промпта (компактный контекст в generation_metadata)',
    check: 'checkFr_2_1_14'
  },
  {
    id: 'FR-2.1-15',
    block: '3. Генерация черновика (LLM + RAG)',
    layer: 'module',
    role: 'Система',
    title: 'JSON-скелет чернового контент-плана (этап 1 LLM)',
    check: 'checkFr_2_1_15'
  },
  {
    id: 'FR-2.1-16',
    block: '3. Генерация черновика (LLM + RAG)',
    layer: 'module',
    role: 'Система',
    title: 'Помесячная генерация публикаций по слотам (этап 2 LLM)',
    check: 'checkFr_2_1_16'
  },
  {
    id: 'FR-2.1-17',
    block: '3. Генерация черновика (LLM + RAG)',
    layer: 'API',
    role: 'Система',
    title: 'HTTP-ответ: success, rag, draft, usage, generation_metadata',
    check: 'checkFr_2_1_17'
  },
  // —— Блок 4: Конфигурация и отказоустойчивость ——
  {
    id: 'FR-2.1-18',
    block: '4. Конфигурация и отказоустойчивость',
    layer: 'module',
    role: 'Система',
    title: 'Конфигурация через окружение — лимиты enrichment и модели OpenRouter',
    check: 'checkFr_2_1_18'
  },
  {
    id: 'FR-2.1-19',
    block: '4. Конфигурация и отказоустойчивость',
    layer: 'API',
    role: 'Система',
    title: 'Обработка отказа — 400/413, request_id, сообщения об ошибках',
    check: 'checkFr_2_1_19'
  },
  // —— П. 5.1 План функционального тестирования ——
  {
    id: 'FR-5.1-01',
    block: '5.1 План тестирования',
    layer: 'UI',
    role: 'Мастер проекта',
    title: 'Мастер проекта и сохранение черновика (валидация form_input)',
    check: 'checkFr_5_1_01'
  },
  {
    id: 'FR-5.1-02',
    block: '5.1 План тестирования',
    layer: 'API',
    role: 'Генерация',
    title: 'Модуль генерации черновика — контракт draft и rag_limit',
    check: 'checkFr_5_1_02'
  },
  {
    id: 'FR-5.1-03',
    block: '5.1 План тестирования',
    layer: 'module',
    role: 'БЯМ',
    title: 'Приёмка и нормализация JSON-ответа БЯМ (семантика и черновик)',
    check: 'checkFr_5_1_03'
  },
  {
    id: 'FR-5.1-04',
    block: '5.1 План тестирования',
    layer: 'UI',
    role: 'Обратная связь',
    title: 'Частичный успех обогащения — toast и metadata.partial_enrichment',
    check: 'checkFr_5_1_04'
  },
  {
    id: 'FR-5.1-05',
    block: '5.1 План тестирования',
    layer: 'API',
    role: 'Хранилище',
    title: 'Снимки плана и корпус прецедентов (snapshots, summary)',
    check: 'checkFr_5_1_05'
  },
  {
    id: 'FR-5.1-06',
    block: '5.1 План тестирования',
    layer: 'module',
    role: 'Журналирование',
    title: 'Журналирование enrichment — metadata.batching и usage',
    check: 'checkFr_5_1_06'
  },
  {
    id: 'FR-5.1-07',
    block: '5.1 План тестирования',
    layer: 'module',
    role: 'Лимиты',
    title: 'Ограничение размера запроса enrich — MAX_ENRICH_REQUEST_BYTES',
    check: 'checkFr_5_1_07'
  },
  {
    id: 'FR-5.1-08',
    block: '5.1 План тестирования',
    layer: 'API',
    role: 'Retrieval',
    title: 'Ограничение контекста — rag_limit и валидация query',
    check: 'checkFr_5_1_08'
  },
  {
    id: 'FR-5.1-09',
    block: '5.1 План тестирования',
    layer: 'UI',
    role: 'Правки плана',
    title: 'Сохранение notes и повторное сохранение snapshot',
    check: 'checkFr_5_1_09'
  },
  {
    id: 'FR-5.1-10',
    block: '5.1 План тестирования',
    layer: 'UI',
    role: 'Качество',
    title: 'Предупреждения качества плана — buildRiskSummary',
    check: 'checkFr_5_1_10'
  },
  // —— UI-сценарии п. 2.2 ——
  {
    id: 'FR-UI-SC-01',
    block: '2.2 Сценарии UI',
    layer: 'UI',
    role: 'Аналитик',
    title: 'Просмотр карточек прецедентов — score, reliability, режим retrieval',
    check: 'checkFr_ui_sc_01'
  },
  {
    id: 'FR-UI-SC-02',
    block: '2.2 Сценарии UI',
    layer: 'UI',
    role: 'Маркетолог',
    title: 'Упрощённый поток — поиск прецедентов затем генерация черновика',
    check: 'checkFr_ui_sc_02'
  },
  {
    id: 'FR-UI-SC-03',
    block: '2.2 Сценарии UI',
    layer: 'UI',
    role: 'Система',
    title: 'Блок готовности к генерации — чек-лист и сводка рисков',
    check: 'checkFr_ui_sc_03'
  },
  {
    id: 'FR-UI-SC-04',
    block: '2.2 Сценарии UI',
    layer: 'UI',
    role: 'Система',
    title: 'Блокировка операций при недоступном backend',
    check: 'checkFr_ui_sc_04'
  },
  {
    id: 'FR-UI-SC-05',
    block: '2.2 Сценарии UI',
    layer: 'UI',
    role: 'Пользователь',
    title: 'История снимков контент-плана в localStorage',
    check: 'checkFr_ui_sc_05'
  },
  {
    id: 'FR-UI-SC-06',
    block: '2.2 Сценарии UI',
    layer: 'UI',
    role: 'Пользователь',
    title: 'Экспорт контент-плана — структура данных для Excel/PDF',
    check: 'checkFr_ui_sc_06'
  }
]
