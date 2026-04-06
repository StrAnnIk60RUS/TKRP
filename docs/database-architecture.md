# Архитектура базы данных TKRP

## Текущее состояние хранения данных

| Данные | Где хранится | Ограничения |
|--------|--------------|-------------|
| Публикации и контент-планы конкурентов | `data/precedents/publications.json`, `content_plans.json` | Нет транзакций, всё в памяти при загрузке, не масштабируется |
| Эмбеддинги (1536 float) | Внутри publications/content_plans | Поиск: O(n) cosine similarity в памяти |
| ML-модель engagement | `data/ml/*.joblib` | Только файл, без версионирования |
| Черновики и история планов | `localStorage` + снимки на диске API | История в браузере — токены; полный план — `data/runtime/api/plan-snapshots/*.json` |
| Ingestion runs | `data/precedents/ingestion_runs.json` | Только логирование, без аналитики |

---

## Рекомендация: PostgreSQL + pgvector

### Почему PostgreSQL

1. **JSONB** — идеально подходит для `publication_model`, `content_plan_model`, `spcj` без жёсткой денормализации.
2. **pgvector** — нативная поддержка векторного поиска (cosine similarity, L2) вместо ручного O(n) в памяти.
3. **ACID, транзакции** — консистентность при параллельных ingestion/generation.
4. **Один стек** — все сущности в одной БД, проще бэкапы и миграции.
5. **Node.js экосистема** — `pg`, Prisma, Drizzle с хорошей поддержкой.

### Альтернативы

| БД | Плюсы | Минусы |
|----|-------|--------|
| **SQLite** | Файл-БД, zero-config, портативность | Нет pgvector из коробки (есть sqlite-vss, но менее зрело), однопользовательский |
| **MongoDB** | Гибкая схема, JSON-нативно | Vector Search только в Atlas (платно) или отдельный vector store |
| **Supabase** | PostgreSQL + pgvector как сервис | Зависимость от внешнего сервиса |

**Итог:** для локальной разработки и деплоя на VPS/облако PostgreSQL — лучший баланс.

---

## Схема БД

### ER-диаграмма (упрощённо)

```
┌─────────────────┐     ┌──────────────────────┐     ┌─────────────────┐
│ ingestion_runs  │     │ publications         │     │ content_plans   │
├─────────────────┤     ├──────────────────────┤     ├─────────────────┤
│ id              │     │ id (PK)              │     │ id (PK)         │
│ run_id          │     │ publication_id (UQ)  │     │ plan_id (UQ)    │
│ created_at      │     │ competitor_id        │     │ competitor_id   │
│ source          │     │ competitor_name      │     │ competitor_name │
│ competitors_cnt │     │ platform             │     │ platform        │
│ pubs_inserted   │     │ publication_model    │     │ content_plan_md │
│ ...             │     │   (JSONB)            │     │   (JSONB)       │
└─────────────────┘     │ raw_content         │     │ embedding       │
                        │ embedding (vector)  │     │   (vector)      │
                        │ engagement_rate     │     │ collected_at    │
                        │ collected_at        │     └─────────────────┘
                        └──────────────────────┘

┌──────────────────────┐     ┌──────────────────────┐
│ user_plans           │     │ plan_history         │
├──────────────────────┤     ├──────────────────────┤
│ id (PK)              │     │ id (PK)              │
│ plan_id (UQ)         │     │ plan_id (FK)         │
│ plan_json (JSONB)    │     │ saved_at             │
│ optimization (JSONB) │     │ type                 │
│ form_input (JSONB)   │     │ summary (JSONB)      │
│ created_at           │     │ optimization (JSONB) │
└──────────────────────┘     └──────────────────────┘
```

### Таблицы

#### 1. `publications` — публикации конкурентов

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE publications (
  id              BIGSERIAL PRIMARY KEY,
  publication_id  VARCHAR(512) UNIQUE NOT NULL,  -- бизнес-ключ
  competitor_id   VARCHAR(256),
  competitor_name VARCHAR(256),
  platform        VARCHAR(64),
  source_url      TEXT,
  parsed_at       TIMESTAMPTZ,
  collected_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  publication_model JSONB NOT NULL,              -- тип, topic, format, spcj, kpi и т.д.
  raw_content     TEXT,                          -- обрезано до 6000 символов
  raw_metrics     JSONB,
  engagement_rate REAL,
  content_strategy_snapshot JSONB,
  embedding       vector(1536),                  -- pgvector, dim зависит от модели
  embedding_model VARCHAR(128),
  embedded_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_publications_platform ON publications(platform);
CREATE INDEX idx_publications_collected ON publications(collected_at DESC);
CREATE INDEX idx_publications_embedding ON publications 
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);  -- для ANN search
```

#### 2. `content_plans` — контент-планы конкурентов

```sql
CREATE TABLE content_plans (
  id                  BIGSERIAL PRIMARY KEY,
  plan_id             VARCHAR(512) UNIQUE NOT NULL,
  competitor_id       VARCHAR(256),
  competitor_name     VARCHAR(256),
  platform            VARCHAR(64),
  collected_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  content_plan_model  JSONB NOT NULL,
  content_strategy_snapshot JSONB,
  ontology_support    JSONB,
  embedding           vector(1536),
  embedding_model     VARCHAR(128),
  embedded_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_content_plans_platform ON content_plans(platform);
CREATE INDEX idx_content_plans_embedding ON content_plans 
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 50);
```

#### 3. `ingestion_runs` — журнал загрузок

```sql
CREATE TABLE ingestion_runs (
  id                      BIGSERIAL PRIMARY KEY,
  run_id                  VARCHAR(64) UNIQUE NOT NULL,
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  source                  VARCHAR(64),
  competitors_count       INT,
  publications_processed  INT,
  content_plans_processed INT,
  inserted_publications   INT,
  updated_publications    INT,
  inserted_content_plans  INT,
  updated_content_plans   INT,
  dedup_stats             JSONB,
  embedding_stats         JSONB
);
```

#### 4. `user_plans` — сгенерированные планы (вместо localStorage)

```sql
CREATE TABLE user_plans (
  id              BIGSERIAL PRIMARY KEY,
  plan_id         VARCHAR(128) UNIQUE NOT NULL,
  plan_json       JSONB NOT NULL,
  optimization    JSONB,
  form_input      JSONB,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
```

#### 5. `plan_history` — история оптимизаций

```sql
CREATE TABLE plan_history (
  id           BIGSERIAL PRIMARY KEY,
  plan_id      VARCHAR(128) NOT NULL REFERENCES user_plans(plan_id),
  saved_at     TIMESTAMPTZ DEFAULT NOW(),
  type         VARCHAR(32) DEFAULT 'draft',
  plan         JSONB NOT NULL,
  optimization JSONB,
  summary      JSONB
);

CREATE INDEX idx_plan_history_plan ON plan_history(plan_id);
```

#### 6. `precedents_metadata` — схема и версии

```sql
CREATE TABLE precedents_metadata (
  key           VARCHAR(64) PRIMARY KEY,
  value         JSONB,
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO precedents_metadata (key, value) VALUES 
  ('schema_version', '2'),
  ('embedding_schema_version', '2'),
  ('embedding_model', '"text-embedding-3-small"');
```

---

## Семантический поиск (pgvector)

Текущий fallback на token overlap остаётся, но основной путь — векторный:

```sql
-- Топ-N по cosine similarity (1 - cosine = distance для pgvector)
SELECT id, publication_id, platform, publication_model,
       1 - (embedding <=> $1::vector) AS similarity
FROM publications
WHERE platform = $2 OR $2 IS NULL
ORDER BY embedding <=> $1::vector
LIMIT $3;
```

Для `content_plans` — аналогично. Фильтрация по `audience_segments` — через JSONB-операторы (`?|`, `@>`).

---

## Миграция с JSON-файлов

1. **Экспорт** — скрипт читает `publications.json`, `content_plans.json`, `ingestion_runs.json` и вставляет в БД.
2. **Проверка** — сверка `COUNT`, выборочная проверка записей.
3. **Переключение** — env `USE_DATABASE=true`, `precedentRepository` выбирает реализацию (JSON vs PostgreSQL).
4. **Бэкап** — регулярный `pg_dump` вместо копирования JSON-файлов.

---

## Пошаговый процесс добавления и переноса данных в БД

### Фаза 0. Подготовка

1. **Установить PostgreSQL** (если ещё нет):
   - Windows: [PostgreSQL installer](https://www.postgresql.org/download/windows/)
   - Или Docker: `docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=postgres pgvector/pgvector:pg16`

2. **Создать базу и расширение:**
   ```sql
   CREATE DATABASE tkrp;
   \c tkrp
   CREATE EXTENSION IF NOT EXISTS vector;
   ```

3. **Добавить зависимости** в `apps/api/package.json`: `pg`, опционально `node-pg-migrate`

4. **Добавить в `.env`:**
   ```
   DATABASE_URL=postgresql://user:password@localhost:5432/tkrp
   USE_DATABASE=false
   EMBEDDING_VECTOR_DIM=1536
   ```

---

### Фаза 1. Схема и подключение

5. **Создать папку миграций** `apps/api/migrations/` и файл `001_initial.sql` с DDL из раздела «Таблицы» выше.

6. **Применить DDL** — выполнить SQL против БД `tkrp`.

7. **Создать модуль подключения** `apps/api/src/shared/db/client.js` — экспорт пула `pg.Pool` из `DATABASE_URL`, graceful shutdown.

---

### Фаза 2. Репозиторий прецедентов (БД)

8. **Создать `precedentRepositoryDb.js`** с экспортами: `persistPrecedents`, `getPrecedentsSummary`, `getPrecedentsSnapshot`, `searchPrecedents`, `getOntologyExportData`.

9. **Реализовать `persistPrecedents`** — преобразование competitors → publications/content_plans, upsert (`ON CONFLICT DO UPDATE`), запись в `ingestion_runs`, эмбеддинги в `vector(1536)`.

10. **Реализовать `searchPrecedents`** — эмбеддинг запроса, запрос с `ORDER BY embedding <=> $1::vector`, фильтры по platform/audience_segments (JSONB).

11. **Реализовать остальные методы** — getSummary, getSnapshot, getOntologyExportData.

---

### Фаза 3. Переключатель и миграция данных

12. **Создать фасад** — переименовать текущий репозиторий в `precedentRepositoryJson.js`, в `precedentRepository.js` при `USE_DATABASE=true` реэкспортировать из Db, иначе из Json.

13. **Скрипт миграции** `apps/api/scripts/migrate-json-to-db.js` — читает JSON-файлы, батчами вставляет в БД, embedding как `'[0.1,-0.2,...]'::vector`.

14. **Запуск**: `USE_DATABASE=true node apps/api/scripts/migrate-json-to-db.js`

15. **Проверка** — сравнить `COUNT(*)` с длиной массивов в JSON, выборочно сверить записи.

16. **Включить БД** — `USE_DATABASE=true` в `.env`, перезапуск сервера.

---

### Фаза 4. ML-скрипт

17. **Способ получения данных для Python:**
   - **Вариант A**: endpoint `GET /api/precedents/export-for-ml` отдаёт `{ publications }` с embedding+engagement_rate; Python вызывает HTTP.
   - **Вариант B**: скрипт `export-publications-for-ml.js` при USE_DATABASE читает из БД → пишет `publications_export.json`; Python принимает `--data-path`.

18. **Обновить `engagement_model.py`** — опциональный `--data-path` или вызов endpoint; fallback на `publications.json`.

19. **Обновить `relevancePredictionService.js`** — перед вызовом Python, если USE_DATABASE, выполнить экспорт и передать путь.

---

### Фаза 5. user_plans (замена localStorage)

20. **DDL** для `user_plans`, `plan_history` (если ещё не в миграции).

21. **API** `planStorageRoutes.js`: `POST /save`, `GET /current`, `GET /history`, `POST /load/:id`.

22. **Импорт из localStorage** — однократно: endpoint `POST /import` принимает данные из localStorage, вставляет в БД.

23. **Обновить `planStorage.js`** — при feature flag вызывать API вместо localStorage; fallback на localStorage при недоступности сервера.

24. **Обновить** ContentPlanPage, ProjectForm — работа через planStorage (прозрачно).

---

### Фаза 6. Финализация

25. **README** — раздел «Хранение данных», инструкции по PostgreSQL и миграции.

26. **CI** — service container PostgreSQL для тестов с БД.

27. **Бэкапы** — cron/скрипт `pg_dump tkrp > backup.sql`.

---

### Чеклист (порядок)

| # | Шаг | Зависимости |
|---|-----|-------------|
| 1 | PostgreSQL + pgvector | — |
| 2 | DATABASE_URL, зависимости | 1 |
| 3 | DDL миграции | 1 |
| 4 | db/client.js | 2 |
| 5 | precedentRepositoryDb.js | 3, 4 |
| 6 | precedentRepository фасад (Json/Db) | 5 |
| 7 | migrate-json-to-db.js, запуск | 5 |
| 8 | USE_DATABASE=true | 7 |
| 9 | ML export + engagement_model.py | 8 |
| 10 | plan_storage API + клиент | 3 |
| 11 | README, CI, бэкапы | 8 |

---

## План внедрения (по этапам)

| Этап | Задачи | Оценка |
|------|--------|--------|
| 1 | Добавить `pg`, `pgvector`, миграции (node-pg-migrate / Prisma migrate) | 1–2 дня |
| 2 | Реализовать `precedentRepositoryDb.js` с теми же экспортами (persist, search, getSummary) | 2–3 дня |
| 3 | Миграция данных из JSON в PostgreSQL | 0.5 дня |
| 4 | Feature flag: `USE_DATABASE` для переключения | 0.5 дня |
| 5 | API для user_plans: save/load/history (замена localStorage) | 1–2 дня |
| 6 | Обновить ML-скрипт: читать данные из БД вместо JSON | 0.5 дня |

---

## Конфигурация (.env)

```env
DATABASE_URL=postgresql://user:pass@localhost:5432/tkrp
USE_DATABASE=true
EMBEDDING_VECTOR_DIM=1536
```

---

## Резюме

- **БД:** PostgreSQL + pgvector.
- **Причины:** JSONB для сложных структур, векторный поиск, ACID, один стек.
- **Схема:** `publications`, `content_plans`, `ingestion_runs`, `user_plans`, `plan_history`, `precedents_metadata`.
- **Подход:** поэтапная миграция с feature flag, без поломки текущего JSON-хранилища.
