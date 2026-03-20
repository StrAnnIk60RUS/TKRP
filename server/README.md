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
VITE_ENRICHMENT_API_URL=http://localhost:3001
```
