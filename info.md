# TKRP / info.md (короткая памятка)

Этот файл нужен, чтобы быстро сверяться по проекту: что делаем, как устроены ключевые пайплайны и какие API/артефакты задействованы. Полная теоретическая база вынесена в `PROJECT_MEMO.md`.

## Цель проекта

Автоматизировать формирование контент-плана продвижения **IT-проектов в соцсетях** за счёт:
- RAG/«прецедентов» (поиск релевантных примеров в базе),
- генерации черновика контент-плана и публикаций LLM’ом,
- иерархической оптимизации (ур. 1/ур. 2) + ML-предсказания ожидаемого `engagement_rate`.

## Краткая логика решения

1. Получение/обогащение данных конкурентов (парсинг → LLM обогащение).
2. Построение базы прецедентов (индексация/поиск по embeddings).
3. RAG-поиск по запросу из данных формы пользователя.
4. Генерация черновика контент-плана (skeleton → по месяцам → по слотам).
5. Нормализация/repair (даты по горизонту, дедупликация, кламп бюджета, валидация).
6. ML-предсказание релевантности (`engagement_rate`) для публикаций.
7. Опционально: вызов оптимизатора плана (иерархический GA) отдельным endpoint’ом.

## Backend: ключевой API

HTTP API монтируется в `apps/api/src/app/apiRoutes.js` как префикс `/api` (см. `apps/api/server.js`). Обогащение: `apps/api/src/modules/enrichment/routes/enrichmentRoutes.js`; план: `apps/api/src/modules/planning/routes/planRoutes.js`.

### Состояние сервиса
- `GET /api/health`

### Прецеденты (база примеров)
- `GET /api/precedents/summary`
- `GET /api/precedents`
- `POST /api/precedents/seed` (загрузка demo-фикстуры)
- `POST /api/precedents/search` (RAG-поиск по query)
- `GET /api/precedents/ontology` (агрегированная нормализованная онтология: classes, entities, entity_class_links, relation_templates, triples, hierarchy, synonyms, meta_entities)
- `GET /api/precedents/ontology/export` (Excel-export онтологии)
- `GET /api/precedents/ontology/export/turtle` (OWL/RDF-представление в Turtle)

### Парсинг / обогащение
- `POST /api/parse` (parse-only для `url`)
- `POST /api/parse-and-enrich` (parse + enrich для `url`)
- `POST /api/enrich` (enrich по `competitors_data` из тела запроса)

### Генерация контент-плана
- `POST /api/plan/generate` (генерация draft-плана с учётом RAG)
- `POST /api/plan/generate-batched` (батчи по месяцам/слотам)
- `POST /api/plan/optimize` (иерархический оптимизатор, GA)

### ML (релевантность / engagement_rate)
- `POST /api/ml/relevance/train` (обучение модели)
- `POST /api/ml/relevance/predict` (прогноз для списка публикаций)

## Настройки (.env)

Файл `./.env` (в корне проекта) подхватывается `apps/api/server.js` (через `dotenv`) и `apps/api/openrouter.js`.

Ключи (без значений):
- `OPENROUTER_API_KEY`
- `AI_MODEL`
- `APP_URL`
- `TEMPERATURE`, `LLM_MAX_TOKENS`
- enrichment лимиты: `MAX_POSTS_PER_ENRICH_REQUEST`, `MAX_ENRICH_PAYLOAD_BYTES`, `MAX_ENRICH_REQUEST_BYTES`, `MAX_ENRICH_POST_CONTENT_CHARS`, `ENRICH_AUTO_BATCH`, `ENRICH_RETRY_ON_INVALID`
- семантическая дедупликация при индексации: `DEDUP_SEMANTIC_ENABLED` (default true), `DEDUP_SIMILARITY_THRESHOLD` (default 0.95, cosine similarity ≥ threshold = дубликат)
- онтология / RDF-export: отдельный этап агрегации строится rule-based поверх `ontology_support`, `publication_model`, `content_plan_model`; при необходимости может быть расширен отдельным LLM-рефайнментом
- снимки контент-планов (файлы JSON): `PLAN_SNAPSHOT_MAX_FILES` (по умолчанию 200), `PLAN_SNAPSHOT_MAX_PAYLOAD_BYTES` (по умолчанию 5 MiB); каталог `data/runtime/api/plan-snapshots/`

## Артефакты и где лежат

- База прецедентов: `apps/api/src/modules/precedents/repositories/precedentRepository.js`
- Извлечение метасущностей: `apps/api/src/modules/precedents/services/metaEntityExtractionService.js`
- Агрегация / сериализация онтологии: `apps/api/src/modules/precedents/services/ontologyAggregationService.js`
- Demo-фикстура для seed: `apps/api/src/modules/precedents/fixtures/demoPrecedents.json`
- Данные прецедентов на диске: `data/precedents/*.json`
- ML:
  - Python-скрипт: `tools/ml/engagement_model.py`
  - модель: `data/ml/*.joblib`

## Что осталось сделать (TODO)

Заполняй по ходу разработки/сверок:
- Проверить корректность `draft_content_plan` после repair/валидации на всех выбранных `platforms`.
- Прогнать end-to-end: `parse-and-enrich` → seed/индексация → `plan/generate-batched`.
- Уточнить/доделать UI-поля формы под реальные поля `form_input` в backend.

