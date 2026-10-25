---
description: User-Centric UI/UX, Plain Language, and Contextual Explanations
globs: "apps/web/**/*"
alwaysApply: true
---

# Rule: User-Centric UI/UX & Plain Language

## 1. User Perspective First
- Design and modify every screen, block, form, and button strictly from the viewpoint of the end user (marketing specialist, SMM manager, content planner), **never from the viewpoint of an internal backend/ML developer**.
- The interface must be intuitively understandable: a user without a technical or data science background should instantly comprehend:
  - What this block or metric means.
  - What action will be triggered when clicking a button.
  - What status or progress is currently happening.
- Never expose internal system machinery (raw job IDs, technical pipeline statuses, genetic algorithm telemetry, internal flags) in the standard user workflow.

## 2. Plain Language & Prohibition of Obscure Jargon
- **No Unexplained Technical Slang**: Do not use raw engineering terms or cryptic abbreviations in user-facing texts (e.g. avoid bare "RAG", "Embeddings", "Cosine Similarity", "GA pass", "Preflight", "Ontology serialization").
- **Business-Oriented Terminology**: Replace developer jargon with clear, natural language:
  - Instead of *"Precedent embedding similarity retrieval"* → *"Поиск похожих публикаций конкурентов"*.
  - Instead of *"Genetic algorithm optimization pass"* → *"Оптимизация контент-плана"*.
  - Instead of *"Ontology knowledge graph"* → *"База тематик и трендов ниши"*.
- **Mandatory Explanations for Domain Terms**: When a specialized metric or professional concept is necessary (e.g., *ER*, *Доверительный интервал (LCB)*, *Семантический охват*):
  - Always provide a concise inline hint (`FieldHint`), subtitle, or tooltip explaining **what it means in plain Russian and how the user should interpret it**.
  - Example: *"ER (Engagement Rate) — показатель вовлечённости аудитории. Чем выше процент, тем активнее подписчики реагируют на публикацию."*

## 3. Actionable Guidance, Empty States & Errors
- **Explicit Action Labels**: Buttons and interactive controls must clearly state the outcome (e.g., *"Сгенерировать черновик плана"*, *"Найти примеры"*, *"Экспортировать в Excel"* instead of ambiguous *"Запуск"*, *"Обработать"*, *"Старт"*).
- **Constructive Empty States**: Lists, tables, and boards without items must never display a bare *"Нет данных"*. Always explain **why** it is empty and **what specific action** will populate it (e.g., *"Примеры публикаций ещё не найдены. Введите тему проекта или загрузите демо-базу прецедентов"*).
- **Human-Friendly Error Messages**: Never display raw error stack traces, unhandled promise rejections, or raw HTTP status codes. Provide a clear explanation of what went wrong and what the user can do to resolve it (e.g., *"Не удалось подключиться к серверу. Убедитесь, что сервер запущен, и повторите попытку"*).
