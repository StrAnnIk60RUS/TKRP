# UML-диаграммы подсистемы БЯМ / RAG

Исходники в формате [PlantUML](https://plantuml.com/) для экспорта в PNG, SVG или PDF и вставки в статью, тезисы или пояснительную записку.

## Два набора файлов

| Набор | Для чего |
| --- | --- |
| `*.puml` | Полный синтаксис: VS Code PlantUML, `plantuml.jar`, plantuml.com |
| `*-drawio.puml` | **Упрощённый синтаксис для draw.io** (Arrange → Insert → Advanced → PlantUML) |

**Почему draw.io не строит «полные» файлы:** встроенный конвертер diagrams.net поддерживает только часть PlantUML. Не работают (или ломают разбор): `!theme`, сложные `skinparam`, ключевые слова `interface` / `database` / `node`, стрелки `-down->`, многострочные подписи `\n`, стереотипы `<<use>>` / `<<HTTP>>` на связях (подписи тогда не отображаются), типы вроде `String[]`, `...` в именах методов, блоки `note bottom of`. В `*-drawio.puml` на связях — **обычный русский текст** после двоеточия. ER-диаграмма (`entity`) обычно проходит и в полной версии.

| Файл | Тип UML | Содержание |
| --- | --- | --- |
| `er-database.puml` | сущность–связь | 7 таблиц, полная детализация атрибутов |
| `er-database-drawio.puml` | сущность–связь | то же, упрощённо для draw.io |
| `class-diagram.puml` | классы | 10 классов, типы и стереотипы |
| `class-diagram-drawio.puml` | классы | то же, упрощённо для draw.io |
| `component-frontend.puml` | компоненты | фронтенд и REST API |
| `component-frontend-drawio.puml` | компоненты | то же, упрощённо для draw.io |
| `component-backend.puml` | компоненты | бэкенд, хранилище, OpenRouter |
| `component-backend-drawio.puml` | компоненты | то же, упрощённо для draw.io |

## Как получить рисунок

### VS Code / Cursor

1. Установить расширение **PlantUML**.
2. Установить Java и Graphviz (требование PlantUML).
3. Открыть `.puml` → `Alt+D` (предпросмотр) → экспорт PNG/SVG.

### Командная строка (при установленном PlantUML)

```bash
java -jar plantuml.jar -tpng docs/uml/subsystem-bam/*.puml
java -jar plantuml.jar -tsvg docs/uml/subsystem-bam/*.puml
```

### Онлайн

Скопировать содержимое файла на [plantuml.com/plantuml](https://www.plantuml.com/plantuml/uml) и скачать изображение.

## Соответствие коду

Таблицы атрибутов и методов — в `docs/subsystem-bam-enrichment-rag.md` (§1–§2). Диаграммы отражают ту же логическую модель; реализация — модули JavaScript в `apps/api` и `apps/web`.
