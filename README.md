# TKRP

Локальный R&D-репозиторий для генерации и оптимизации контент-планов IT-проектов на основе данных конкурентов, LLM-enrichment, RAG-поиска прецедентов и ML-оценки вовлеченности.

## Что внутри

```text
TKRP/
  apps/
    web/                  # React + Vite клиент
    api/                  # Express API и orchestration слой
  tools/
    parser/               # Python parser
    ml/                   # Python ML scripts
    scripts/              # repo-level automation
  data/
    input/examples/       # тестовые входные JSON
    precedents/           # локальное хранилище прецедентов
    ml/                   # обученные ML артефакты
    runtime/              # временные и runtime-файлы
  docs/
  dist/web/               # production build frontend
```

Подробные правила размещения файлов описаны в `docs/architecture.md`.

## Локальный запуск

1. Установить Node.js 20+ и Python 3.11+.
2. Установить зависимости:

```bash
npm ci
npm ci --prefix apps/api
pip install -r requirements.txt
```

3. Скопировать `.env.example` в `.env` и заполнить как минимум:
- `OPENROUTER_API_KEY`
- `VITE_ENRICHMENT_API_URL`
- при необходимости `VK_COOKIE` / `LINKEDIN_COOKIE`

4. Запустить проект:

```bash
npm run dev
```

Frontend: `http://localhost:5173`

Backend health: `http://localhost:3001/health`

## Основные команды

- `npm run dev` — frontend + backend одновременно.
- `npm run build` — production build frontend в `dist/web`.
- `npm run preview` — preview frontend build.
- `npm run lint` — быстрые репозиторные проверки структуры и безопасности.
- `npm run test` — frontend/backend unit tests.
- `npm run check` — lint + test + build.

## Хранение данных

- Прецеденты хранятся в `data/precedents/` как коллекции `metadata`, `ingestion_runs`, `publications`, `content_plans`.
- Обученные ML-артефакты находятся в `data/ml/`.
- Runtime-файлы и служебные черновики лежат в `data/runtime/`.
- История просмотренных контент-планов на клиенте сохраняется в `localStorage`.

## Где искать код

- Frontend bootstrap: `apps/web/src/app`
- Frontend страницы: `apps/web/src/pages`
- Frontend feature-модули: `apps/web/src/features`
- Frontend shared-слой: `apps/web/src/shared`
- API composition root: `apps/api/src/app/apiRoutes.js`
- API доменные модули: `apps/api/src/modules`
- Общий infra/backend shared-код: `apps/api/src/shared`

## Безопасность и эксплуатация

- CORS по умолчанию ограничен localhost-origin'ами; внешний доступ настраивается через `CORS_ALLOWED_ORIGINS`.
- Для удаленного использования задайте `SERVER_API_KEY` и отдельно `ADMIN_API_KEY` для чувствительных endpoint'ов.
- Parser и ML запускаются через `PYTHON_BIN`, а таймауты задаются через `PARSER_TIMEOUT_MS` и `ML_SCRIPT_TIMEOUT_MS`.
- Cookie для VK/LinkedIn не должны храниться в коде: используйте переменные окружения.

## Проверено после реорганизации

- `npm run lint`
- `npm run test`
- `npm run build`

## Ограничения

- Хранилище прецедентов локальное, без внешней БД.
- Parser зависит от доступности VK/LinkedIn и валидных cookie.
- ML-модель использует локальные артефакты и требует периодической перепроверки качества.
