# Postman: коллекция API TKRP

Коллекция [`TKRP-API.postman_collection.json`](./TKRP-API.postman_collection.json) покрывает **функциональные требования табл. 2.1** (подсистема БЯМ/RAG). На вкладке **Tests** у каждого запроса тесты помечены тегами `[FR-…]`.

## Импорт

1. Postman → **Import** → файл `TKRP-API.postman_collection.json`.
2. При необходимости измените переменную коллекции **`baseUrl`** (по умолчанию `http://localhost:3001`).

## Запуск API

Из корня репозитория: `npm run dev:server` **или** `cd apps/api && npm start`. Порт: **`PORT`** в окружении, иначе **3001**.

## Папки коллекции

| Папка | Нужен OpenRouter | Что проверяет |
| --- | --- | --- |
| **00** Матрица FR (сводка) | Нет | **35 тестов** на вкладке Tests — все строки табл. 2.1 + п. 5.1 + UI (для скриншота в ПЗ) |
| **01** Служебные и смоук | Нет | `GET /health`, `GET /api/precedents/summary` |
| **02** Блок 1 — Обогащение | Да (кроме 400/413) | `POST /api/enrich` |
| **03** Блок 2 — RAG | Да (поиск) | `POST /api/precedents/search`, `GET /api/precedents` |
| **04** Блок 3 — Генерация | Да | `POST /api/plan/generate`, `generate-batched` |
| **05** Блок 4 — Отказоустойчивость | Нет | 400-валидация, `seed` |
| **06** Хранилище | Нет | `draft/current`, `snapshots` |

**Для ПЗ (минимум):** Collection Runner — только папка **00** (все FR зелёные) + терминал `npm run test:fr`.

**Расширенный прогон без ключа:** `00` → `01` → `05` → `06`.

## Автотесты матрицы FR (Node.js)

```bash
npm run test:fr          # прогон + отчёт apps/api/test-results/fr-matrix-report.txt
npm run test:fr:spec     # только вывод spec в консоль
```

Реестр требований: [`tools/testing/fr-requirements.mjs`](../testing/fr-requirements.mjs).

## Newman (CLI)

Сводка FR без LLM:

```bash
npx newman run tools/postman/TKRP-API.postman_collection.json \
  --folder "00 Матрица FR (сводка, без LLM)" \
  --env-var "baseUrl=http://localhost:3001"
```

Контракты API без БЯМ:

```bash
npx newman run tools/postman/TKRP-API.postman_collection.json \
  --folder "01 Служебные и смоук" \
  --folder "05 Блок 4 — Конфигурация и отказоустойчивость" \
  --folder "06 Хранилище — черновик формы и snapshots плана" \
  --env-var "baseUrl=http://localhost:3001"
```

## Скриншоты для ПЗ

1. **Postman** — папка `00`, вкладка Tests (38 зелёных проверок).
2. **Терминал** — `npm run test:fr` (итог PASS, 35 требований).
3. **Файл** — `apps/api/test-results/fr-matrix-report.txt` (таблица ID → PASS).
