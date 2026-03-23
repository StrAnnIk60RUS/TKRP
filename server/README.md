# Сервер обогащения данных через LLM

Node.js сервер для обогащения данных конкурентов через LLM API.

## Установка

```bash
cd server
npm install
```

## Настройка

1. Скопируйте `.env.example` в `.env`:
```bash
cp .env.example .env
```

2. Установите API ключ для LLM в `.env` (см. `.env.example`):
```
PORT=3001
```

## Запуск

### Режим разработки (с автоперезагрузкой)
```bash
npm run dev
```

### Продакшн режим
```bash
npm start
```

Сервер будет доступен на `http://localhost:3001`

## API Endpoints

### `GET /health`
Проверка доступности сервера.

**Ответ:**
```json
{
  "status": "ok",
  "service": "LLM Enrichment Server"
}
```

### `POST /api/enrich`
Обогащение данных конкурентов.

**Тело запроса:**
```json
{
  "competitors_data": {
    "parsing_metadata": {...},
    "competitors": [...]
  }
}
```

**Ответ:**
```json
{
  "success": true,
  "enriched_data": {...},
  "usage": {
    "prompt_tokens": 1234,
    "completion_tokens": 567,
    "total_tokens": 1801
  },
  "metadata": {
    "enriched_at": "2026-02-25T10:00:00Z",
    "model": "llm",
    "engagement_rate_calculated_locally": true
  }
}
```

### `POST /api/plan/generate`
Генерация чернового контент-плана по данным формы и RAG-контексту.

В `form_input` поддерживается поле `publicationDayMode`:

- `spread` - публикации распределяются по горизонту без обязательного совпадения дат между платформами.
- `shared` - каждая выбранная дата формирует пакет публикаций по всем выбранным платформам.

Если выбран режим `shared`, сервер может увеличить итоговое число публикаций до ближайшего числа, кратного количеству платформ, чтобы на каждой общей дате был полный комплект платформ.

**Фрагмент тела запроса:**
```json
{
  "form_input": {
    "contentPlanStartDate": "2026-03-01",
    "contentPlanEndDate": "2026-03-31",
    "platforms": ["vk", "linkedin"],
    "minPublications": "5",
    "publicationDayMode": "shared"
  }
}
```

**Что возвращается дополнительно в плане:**
- `draft_content_plan.schedule_preferences.publication_day_mode`
- `draft_content_plan.schedule_preferences.requested_publications`
- `draft_content_plan.schedule_preferences.generated_publications`
- `draft_content_plan.schedule_preferences.platform_bundle_size`

## Что делает сервер

1. **Вычисляет `engagement_rate`** для всех постов локально (формула: `(likes + comments + shares) / views`)
2. **Отправляет данные в LLM** для определения:
   - `content_category` - категория контента
   - `tone` - тональность текста
   - `category` (B2B/B2C/B2G/unknown) - категория бизнеса (по возможности)
   - `content_strategy` - стратегия контента конкурента
3. **Возвращает обогащенные данные** с добавленными полями

## Переменные окружения

- API ключ для LLM (см. `.env.example`)
- `PORT` - Порт сервера (по умолчанию: 3001)
- `APP_URL` - URL приложения для заголовков (опционально)

## Интеграция с фронтендом

Фронтенд автоматически обращается к серверу на `http://localhost:3001` (или URL из `VITE_ENRICHMENT_API_URL`).

Для изменения URL сервера создайте файл `.env` в корне проекта:
```
=http://localhost:3001
```
