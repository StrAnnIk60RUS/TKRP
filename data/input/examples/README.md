# Примеры входных данных

Эта папка содержит JSON-примеры для ручного тестирования пайплайна enrichment и генерации плана.

## Файлы

- `competitors_data_small.json` — небольшой тестовый набор для быстрых проверок UI и API.
- `competitors_data_large.json` — большой набор для стресс-теста enrichment.
- `README_LARGE.md` — инструкция по большому примеру.

## Где используются

- Через UI: загрузка конкурентных данных в мастере генерации.
- Через API: отправка payload в `POST /api/enrich`.
- Через скрипты: генерация большого файла из `apps/api/generate-large-test-data.js`.

## Примечание

Это именно входные fixture-данные. Production-хранилища и артефакты находятся не здесь, а в:

- `data/precedents`
- `data/ml`
- `data/runtime`
