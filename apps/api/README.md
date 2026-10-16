# API App

`apps/api` содержит Express API и orchestration слой для:

- enrichment конкурентных данных через LLM;
- хранения и поиска прецедентов;
- генерации чернового контент-плана;
- двухуровневой эволюционной оптимизации;
- обучения и инференса локальных ML-моделей.

## Запуск

Установка зависимостей:

```bash
npm ci --prefix apps/api
```

Разработка:

```bash
npm run dev --prefix apps/api
```

Продакшн запуск:

```bash
npm run start --prefix apps/api
```

Health endpoint: `http://localhost:3001/health`

## Структура

```text
apps/api/
  server.js
  openrouter.js
  src/
    app/
    modules/
      enrichment/
      planning/
      precedents/
      ml/
    shared/
```

## Важные пути

- API bootstrap: `apps/api/server.js`
- Router composition root: `apps/api/src/app/apiRoutes.js`
- Parser runtime: `tools/parser`
- ML scripts: `tools/ml`
- Precedents storage: `data/precedents`
- ML artifacts: `data/ml`
- Runtime draft/parser jobs: `data/runtime`

## Основные endpoint-группы

- `GET /health`
- `POST /api/enrich`
- `POST /api/parse`
- `POST /api/parse-and-enrich`
- `POST /api/plan/generate`
- `POST /api/plan/optimize`
- `GET /api/precedents/*`
- `POST /api/ml/*`

## Переменные окружения

- `OPENROUTER_API_KEY`
- `AI_MODEL`
- `PORT`
- `APP_URL`
- `VITE_ENRICHMENT_API_URL`
- `PYTHON_BIN`
- `PARSER_TIMEOUT_MS`
- `ML_SCRIPT_TIMEOUT_MS`
- `CORS_ALLOWED_ORIGINS`
- `SERVER_API_KEY`
- `ADMIN_API_KEY`
