# Architecture

## Top-level layout

```text
TKRP/
  apps/
    web/
    api/
  tools/
    parser/
    ml/
    scripts/
  data/
    input/examples/
    precedents/
    ml/
    runtime/
  docs/
  dist/
```

## Placement rules

- `apps/web` содержит только frontend runtime и его исходники.
- `apps/api` содержит только backend runtime и его исходники.
- `tools/parser` и `tools/ml` содержат Python-утилиты и не смешиваются с Node-кодом приложений.
- `tools/scripts` содержит repo-level automation и служебные проверки.
- `data/input/examples` хранит только fixture/input JSON для ручного тестирования.
- `data/precedents` хранит локальную базу прецедентов.
- `data/ml` хранит обученные модели и metadata.
- `data/runtime` хранит временные и runtime-файлы вроде draft storage и parser jobs.
- `dist/web` содержит production build frontend.

## Frontend

`apps/web/src` организован по схеме `app / pages / features / shared`.

- `app` — bootstrap, router, providers, global styles.
- `pages` — route-level экраны.
- `features` — бизнес-фичи (`project-form`, `content-plan`).
- `shared` — общие UI-компоненты, API client и утилиты.

Правило:

- shared-код не должен зависеть от feature-модулей.
- cross-feature доступ допускается только к явно выделенным model/lib/api entry points.

## Backend

`apps/api/src` организован по схеме `app / modules / shared`.

- `app` — composition root и wiring роутов.
- `modules/enrichment` — parser + enrichment pipeline.
- `modules/planning` — draft generation, draft persistence, evolutionary optimization.
- `modules/precedents` — хранилище, поиск, онтология, export.
- `modules/ml` — train/predict orchestration.
- `shared` — security, runtime helpers, модели и общие utils.

Правило:

- доменные модули не должны импортировать друг друга хаотично;
- общая инфраструктура живет в `shared`;
- Python subprocess paths должны идти через `tools/*`, а не через внутренние каталоги приложения.

## Adding new code

- Новый экран frontend добавляется в `apps/web/src/pages/<page>/ui`.
- Новая бизнес-фича frontend добавляется в `apps/web/src/features/<feature>`.
- Новый backend endpoint добавляется в соответствующий `apps/api/src/modules/<module>/routes`.
- Новый backend service кладется рядом со своим модулем, а не в общий `services/`.
- Общие backend утилиты разрешены только в `apps/api/src/shared`.

## Anti-patterns

- Не создавать снова корневые папки `src`, `server`, `parser` вне `apps/` и `tools/`.
- Не складывать runtime JSON рядом с исходниками.
- Не помещать shared helper в feature/module, если он используется несколькими bounded contexts.
