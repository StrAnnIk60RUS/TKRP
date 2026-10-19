/**
 * Предустановленные демонстрационные данные для аккаунта:
 * Проект "DevFlow AI" (SaaS / AI-ассистент разработчика).
 * Содержит контент-план со статусами автопостинга (опубликован, запланирован, черновик)
 * и историческую аналитику роста каналов VK и Telegram.
 */

export const DEMO_USER = {
  user_id: 'demo_user_devflow',
  username: 'demo',
  role: 'smm',
  project_name: 'DevFlow AI'
}

export const DEMO_CONTENT_PLAN = {
  plan_id: 'plan_demo_devflow_2026',
  display_name: 'DevFlow AI — План продвижения (VK + Telegram)',
  platforms: ['vk', 'telegram'],
  planning_horizon: {
    start_date: '2026-10-10',
    end_date: '2026-10-31',
    posts_count: 8
  },
  kpi_targets: {
    avg_engagement_rate: 0.052,
    estimated_conversions: 340,
    expected_reach: 85000
  },
  expected_kpi: {
    total_likes: 920,
    total_shares: 165,
    total_views: 68400
  },
  constraints: {
    max_posts_per_week: 5,
    required_formats: ['infographic', 'case_study', 'interactive', 'meme']
  },
  notes: 'Демонстрационный контент-план с подключенным автопостингом и сбором статистики факта.',
  publications: [
    {
      publication_id: 'pub_demo_001',
      planned_date: '2026-10-11',
      platform: 'telegram',
      topic: 'Релиз DevFlow AI v2.4: автогенерация unit-тестов',
      format: 'release_notes',
      objective: 'product_awareness',
      tone: 'expert',
      key_message: 'Экономьте до 4 часов в неделю на рутинных тестах с помощью локальной LLM',
      summary: 'Выпустили крупное обновление DevFlow AI 2.4! Теперь плагин для VS Code умеет автоматически генерировать тесты под Jest и PyTest прямо в процессе написания кода. Попробуйте бесплатно по ссылке в закрепе.',
      cta: 'Обновите плагин в VS Code Marketplace и делитесь впечатлениями в комментариях',
      media_prompt: 'Современный интерфейс темной темы IDE с кодом и зеленой галочкой успешно пройденных тестов',
      status: 'published',
      published_at: '2026-10-11T10:15:00Z',
      post_url: 'https://t.me/devflow_ai/142',
      remote_post_id: 'tg_142',
      expected_kpi: {
        ml_predicted_likes: 185,
        ml_predicted_shares: 42,
        ml_predicted_views: 4500,
        predicted_likes: 185,
        predicted_shares: 42,
        predicted_views: 4500,
        predicted_likes_source: 'ga_post_metrics_model',
        engagement_rate: 0.051
      },
      actual_kpi: {
        likes: 204,
        shares: 48,
        views: 4920,
        comments: 31,
        er_percent: 5.8
      }
    },
    {
      publication_id: 'pub_demo_002',
      planned_date: '2026-10-13',
      platform: 'vk',
      topic: 'Мем: когда джун запустил скрипт миграции на проде',
      format: 'meme',
      objective: 'community_engagement',
      tone: 'humorous',
      key_message: 'Автоматические бэкапы и CI/CD проверки спасают от ночных инцидентов',
      summary: 'Тот самый момент, когда терминал замолчал на 30 секунд, а база данных перестала отвечать... Но с DevFlow Guard деплой откатится сам за 5 секунд. А у вас бывали такие факапы на проде?',
      cta: 'Пишите свои самые эпичные истории деплоя в комментарии 👇',
      media_prompt: 'Смешной кот в очках перед горящим монитором сервера с надписью Migration Complete',
      status: 'published',
      published_at: '2026-10-13T14:30:00Z',
      post_url: 'https://vk.com/wall-21984201_384',
      remote_post_id: 'vk_384',
      expected_kpi: {
        ml_predicted_likes: 310,
        ml_predicted_shares: 65,
        ml_predicted_views: 8200,
        predicted_likes: 310,
        predicted_shares: 65,
        predicted_views: 8200,
        predicted_likes_source: 'stage2_post_evolution',
        engagement_rate: 0.046
      },
      actual_kpi: {
        likes: 342,
        shares: 71,
        views: 8950,
        comments: 54,
        er_percent: 5.2
      }
    },
    {
      publication_id: 'pub_demo_003',
      planned_date: '2026-10-15',
      platform: 'telegram',
      topic: 'Кейс ФинТех стартапа: ускорение код-ревью в 2.8 раза',
      format: 'case_study',
      objective: 'lead_generation',
      tone: 'analytical',
      key_message: 'Как команда из 40 инженеров внедрила ИИ-ассистента и сократила Time-to-Market',
      summary: 'Подробный разбор кейса финтех-компании: с какими сложностями столкнулись при онбординге новых разработчиков и как автоматический анализ pull request помог отловить 89% архитектурных недочетов до стадии QA.',
      cta: 'Читать полный кейс с метриками и диаграммами в статье на vc.ru',
      media_prompt: 'Инфографика с графиком роста скорости разработки и логотипами стека технологий',
      status: 'published',
      published_at: '2026-10-15T11:00:00Z',
      post_url: 'https://t.me/devflow_ai/145',
      remote_post_id: 'tg_145',
      expected_kpi: {
        ml_predicted_likes: 140,
        ml_predicted_shares: 28,
        ml_predicted_views: 3800,
        predicted_likes: 140,
        predicted_shares: 28,
        predicted_views: 3800,
        predicted_likes_source: 'ga_post_metrics_model',
        engagement_rate: 0.044
      },
      actual_kpi: {
        likes: 132,
        shares: 26,
        views: 3650,
        comments: 18,
        er_percent: 4.8
      }
    },
    {
      publication_id: 'pub_demo_004',
      planned_date: '2026-10-18',
      platform: 'vk',
      topic: 'Инфографика: 7 частых ошибок архитектуры микросервисов',
      format: 'infographic',
      objective: 'expert_authority',
      tone: 'expert',
      key_message: 'Сохраняйте чек-лист по изоляции доменов и снижению связности сервисов',
      summary: 'Собрали на одной схеме типичные архитектурные антипаттерны: общая БД для нескольких микросервисов, распределенные монолиты и синхронные цепочки вызовов. Сохраняйте в закладки!',
      cta: 'Ставьте лайк, если хотите вторую часть с примерами на Go и Node.js',
      media_prompt: 'Стильная векторная схема микросервисной архитектуры с цветовыми акцентами и маркерами ошибок',
      status: 'published',
      published_at: '2026-10-18T16:20:00Z',
      post_url: 'https://vk.com/wall-21984201_389',
      remote_post_id: 'vk_389',
      expected_kpi: {
        ml_predicted_likes: 240,
        ml_predicted_shares: 55,
        ml_predicted_views: 7400,
        predicted_likes: 240,
        predicted_shares: 55,
        predicted_views: 7400,
        predicted_likes_source: 'stage2_post_evolution',
        engagement_rate: 0.048
      },
      actual_kpi: {
        likes: 265,
        shares: 62,
        views: 8100,
        comments: 29,
        er_percent: 5.3
      }
    },
    {
      publication_id: 'pub_demo_005',
      planned_date: '2026-10-21',
      platform: 'telegram',
      topic: 'Интерактивный опрос: какой стек вы используете для Backend в 2026?',
      format: 'interactive',
      objective: 'community_engagement',
      tone: 'friendly',
      key_message: 'Голосуйте и смотрите результаты среза мнений среди 9 000 разработчиков',
      summary: 'Проводим ежегодный опрос нашего комьюнити! Go, Python (FastAPI/Django), Node.js (Nest/Express), Java/Kotlin или Rust? Нажмите на вариант и проверьте, совпадает ли ваш выбор с большинством.',
      cta: 'Примите участие в опросе ниже и аргументируйте выбор в комментариях',
      media_prompt: 'Плашка с иконками популярных языков программирования и карточкой интерактивного голосования',
      status: 'scheduled',
      expected_kpi: {
        ml_predicted_likes: 195,
        ml_predicted_shares: 35,
        ml_predicted_views: 5200,
        predicted_likes: 195,
        predicted_shares: 35,
        predicted_views: 5200,
        predicted_likes_source: 'ga_post_metrics_model',
        engagement_rate: 0.054
      }
    },
    {
      publication_id: 'pub_demo_006',
      planned_date: '2026-10-23',
      platform: 'vk',
      topic: 'Гайд: как настроить локальный RAG над кодовой базой за 15 минут',
      format: 'guide',
      objective: 'product_awareness',
      tone: 'instructional',
      key_message: 'Пошаговая инструкция по векторизации репозитория с embeddings и pgvector',
      summary: 'Разбираем, как с помощью открытых моделей индексировать проект на 100k+ строк кода и запрашивать семантический поиск по функциям и документации без передачи исходников в публичные облака.',
      cta: 'Ссылка на репозиторий с готовым шаблоном Docker Compose в первом комментарии',
      media_prompt: 'Пошаговая визуальная схема передачи кода через embeddings модель в векторную базу данных',
      status: 'scheduled',
      expected_kpi: {
        ml_predicted_likes: 210,
        ml_predicted_shares: 45,
        ml_predicted_views: 6300,
        predicted_likes: 210,
        predicted_shares: 45,
        predicted_views: 6300,
        predicted_likes_source: 'stage2_post_evolution',
        engagement_rate: 0.049
      }
    },
    {
      publication_id: 'pub_demo_007',
      planned_date: '2026-10-26',
      platform: 'telegram',
      topic: 'AMA-сессия с техническим директором DevFlow AI',
      format: 'qa_session',
      objective: 'community_engagement',
      tone: 'conversational',
      key_message: 'Задавайте любые вопросы по архитектуре, нейросетям и оптимизации кода',
      summary: 'В эту пятницу в 18:00 МСК проведем прямой эфир в голосовом чате канала! Тема: "Будущее AI-кодинга: заменит ли LLM разработчиков к 2028 году?". Оставляйте вопросы под этим постом.',
      cta: 'Напишите свой вопрос в комментариях — на 5 самых интересных ответим в первую очередь',
      media_prompt: 'Стильный баннер с микрофоном, неоновым светом и анонсом AMA LIVE',
      status: 'draft',
      expected_kpi: {
        ml_predicted_likes: 160,
        ml_predicted_shares: 22,
        ml_predicted_views: 4100,
        predicted_likes: 160,
        predicted_shares: 22,
        predicted_views: 4100,
        predicted_likes_source: 'ga_post_metrics_model',
        engagement_rate: 0.047
      }
    },
    {
      publication_id: 'pub_demo_008',
      planned_date: '2026-10-29',
      platform: 'vk',
      topic: 'Дайджест лучших инструментов для продуктивности разработчика за октябрь',
      format: 'digest',
      objective: 'expert_authority',
      tone: 'expert',
      key_message: '5 утилит, которые сократят время на рутину и сделают терминал удобнее',
      summary: 'Подготовили подборку полезных CLI-утилит и расширений, которые реально ускоряют повседневную работу: от быстрого поиска по логам до автоматического форматирования diff в git.',
      cta: 'Сохраняйте подборку к себе на стену, чтобы не потерять список',
      media_prompt: 'Темный футуристичный рабочий стол с терминалом и логотипами утилит',
      status: 'draft',
      expected_kpi: {
        ml_predicted_likes: 175,
        ml_predicted_shares: 38,
        ml_predicted_views: 5500,
        predicted_likes: 175,
        predicted_shares: 38,
        predicted_views: 5500,
        predicted_likes_source: 'stage2_post_evolution',
        engagement_rate: 0.045
      }
    }
  ]
}

export const DEMO_ANALYTICS_DATA = {
  summary: {
    total_subscribers: 24270,
    subscribers_growth_30d: 2890,
    growth_rate_percent: 13.5,
    total_views_30d: 240800,
    total_likes_30d: 4610,
    total_shares_30d: 870,
    avg_engagement_rate_percent: 5.2,
    ml_prediction_accuracy_percent: 91.8
  },
  platforms: {
    vk: {
      account_name: 'DevFlow AI | Разработка & AI',
      account_url: 'https://vk.com/devflow_ai',
      subscribers: 14850,
      subscribers_growth: 1240,
      growth_percent: 9.1,
      total_views: 142500,
      avg_post_reach: 7800,
      avg_er_percent: 4.8,
      posts_published_count: 14
    },
    telegram: {
      account_name: '@devflow_ai (Канал инженеров)',
      account_url: 'https://t.me/devflow_ai',
      subscribers: 9420,
      subscribers_growth: 1650,
      growth_percent: 21.2,
      total_views: 98300,
      avg_post_reach: 4200,
      avg_er_percent: 5.6,
      posts_published_count: 16
    }
  },
  // Динамика роста за 5 недель
  timeline_growth: [
    { week: '15-21 сен', vk: 13610, telegram: 7770, total: 21380, views: 42000 },
    { week: '22-28 сен', vk: 13950, telegram: 8150, total: 22100, views: 48500 },
    { week: '29 сен - 5 окт', vk: 14280, telegram: 8600, total: 22880, views: 51200 },
    { week: '6-12 окт', vk: 14590, telegram: 9020, total: 23610, views: 54600 },
    { week: '13-19 окт', vk: 14850, telegram: 9420, total: 24270, views: 57500 }
  ],
  // Данные валидации модели ML: План vs Факт
  ml_vs_actual_stats: {
    evaluated_posts_count: 4,
    mae_likes: 16.5,
    mean_accuracy_percent: 91.8,
    status: 'ready_for_retraining',
    message: 'Собрано достаточное число подтвержденных фактов. Данные пригодны для дообучения ML-модели.',
    posts: [
      {
        id: 'pub_demo_001',
        title: 'Релиз DevFlow AI v2.4: автогенерация unit-тестов',
        platform: 'telegram',
        predicted_likes: 185,
        actual_likes: 204,
        delta_likes: '+19 (+10.2%)',
        predicted_views: 4500,
        actual_views: 4920,
        delta_views: '+420 (+9.3%)',
        accuracy_percent: 90.7
      },
      {
        id: 'pub_demo_002',
        title: 'Мем: когда джун запустил скрипт миграции на проде',
        platform: 'vk',
        predicted_likes: 310,
        actual_likes: 342,
        delta_likes: '+32 (+10.3%)',
        predicted_views: 8200,
        actual_views: 8950,
        delta_views: '+750 (+9.1%)',
        accuracy_percent: 90.1
      },
      {
        id: 'pub_demo_003',
        title: 'Кейс ФинТех стартапа: ускорение код-ревью в 2.8 раза',
        platform: 'telegram',
        predicted_likes: 140,
        actual_likes: 132,
        delta_likes: '-8 (-5.7%)',
        predicted_views: 3800,
        actual_views: 3650,
        delta_views: '-150 (-3.9%)',
        accuracy_percent: 94.3
      },
      {
        id: 'pub_demo_004',
        title: 'Инфографика: 7 частых ошибок архитектуры микросервисов',
        platform: 'vk',
        predicted_likes: 240,
        actual_likes: 265,
        delta_likes: '+25 (+10.4%)',
        predicted_views: 7400,
        actual_views: 8100,
        delta_views: '+700 (+9.4%)',
        accuracy_percent: 92.1
      }
    ]
  }
}

/**
 * Инициализирует локальное состояние браузера под демонстрационного пользователя,
 * создавая сессию и записывая готовый контент-план DevFlow AI в историю.
 */
export function setupDemoSession() {
  const token = 'demo_session_token_' + Date.now()
  localStorage.setItem('tkrp_session', token)
  localStorage.setItem('tkrp_user_id', DEMO_USER.user_id)

  const tokenKey = `currentContentPlanSnapshotToken:${DEMO_USER.user_id}`
  const entryKey = `currentContentPlanHistoryEntry:${DEMO_USER.user_id}`
  const historyKey = `contentPlanHistory:${DEMO_USER.user_id}`
  const demoSnapshotKey = `cachedSnapshot:${DEMO_USER.plan_id || 'demo_plan'}`

  const snapshotToken = 'token_demo_snapshot_2026'
  localStorage.setItem(tokenKey, JSON.stringify(snapshotToken))

  const entry = {
    id: DEMO_CONTENT_PLAN.plan_id,
    type: 'draft',
    saved_at: new Date().toISOString(),
    snapshot_token: snapshotToken,
    summary: {
      plan_id: DEMO_CONTENT_PLAN.plan_id,
      display_name: DEMO_CONTENT_PLAN.display_name,
      publications_count: DEMO_CONTENT_PLAN.publications.length,
      platforms: DEMO_CONTENT_PLAN.platforms
    }
  }

  localStorage.setItem(entryKey, JSON.stringify(entry))
  localStorage.setItem(historyKey, JSON.stringify([entry]))
  localStorage.setItem(
    `demoPlanSnapshot:${snapshotToken}`,
    JSON.stringify({ plan: DEMO_CONTENT_PLAN, optimization: null })
  )

  return DEMO_USER
}
