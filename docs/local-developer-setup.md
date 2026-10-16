# Локальная среда разработчика (без хостинга)

Кратко: **один `npm install` в корне** (через `postinstall` ставит и `apps/api`), **`npm run setup`** для полного bootstrap с Python и `.env`, опционально **Docker Compose** и **Dev Container**.

## Требования

- **Node.js 20+** (вместе с npm)
- **Python 3.11+** и pip (`python -m pip` или `python3 -m pip`)
- Для Docker-варианта: **Docker Desktop** (или Docker Engine + Compose v2.24+ для опции `env_file.required: false`)

---

## Вариант A — только на машине (рекомендуется для ежедневной разработки)

### 1) Один `npm install` в корне

В корне репозитория:

```bash
npm install
```

Скрипт **`postinstall`** вызывает [`tools/scripts/install-api-deps.mjs`](../tools/scripts/install-api-deps.mjs) и выполняет `npm install --prefix apps/api`. Отдельно запускать `npm install --prefix apps/api` не нужно.

**Отключить** установку API при редких сценариях (например, кастомный CI):

```bash
set SKIP_POSTINSTALL=1
npm install
```

(В PowerShell: `$env:SKIP_POSTINSTALL='1'; npm install`)

### 2) Полный bootstrap одной командой

Из корня:

```bash
npm run setup
```

Делает по порядку:

1. `npm install` в корне (и через postinstall — зависимости `apps/api`)
2. `pip install -r requirements.txt` (через найденный `python` / `python3`)
3. если **нет** файла `.env`, копирует `.env.example` → `.env` и напоминает про `OPENROUTER_API_KEY`

После этого:

```bash
npm run dev
```

- фронт: обычно `http://localhost:5173`
- API: `http://localhost:3001` (или `PORT` из `.env`)
- проверка API: `GET http://localhost:3001/health`

В `.env` обязательно укажите реальный **`OPENROUTER_API_KEY`**, иначе LLM/эмбеддинги не заработают (сервер при этом может стартовать).

---

## Вариант B — Docker Compose

Нужен только Docker; Node и Python на хосте не обязательны (всё внутри образа).

1. Создайте `.env` при необходимости:

   ```bash
   cp .env.example .env
   ```

   Укажите ключи (как минимум `OPENROUTER_API_KEY`).

2. Из корня репозитория:

   ```bash
   docker compose build
   docker compose up
   ```

Образ [`Dockerfile.dev`](../Dockerfile.dev): Node 20, Python venv в `/opt/tkrp-py` с зависимостями из `requirements.txt`, переменная **`PYTHON_BIN=/opt/tkrp-py/bin/python`** задана в [`docker-compose.yml`](../docker-compose.yml).

Тома **`root_node_modules`** и **`api_node_modules`** отделяют `node_modules` контейнера от файловой системы хоста (важно на Windows/macOS, чтобы не смешивать нативные модули).

Переменные **`CHOKIDAR_USEPOLLING`** / **`WATCHPACK_POLLING`** помогают hot-reload при монтировании тома.

Если вы **меняете** `requirements.txt`, пересоберите образ:

```bash
docker compose build --no-cache
```

**Старая версия Compose** без `env_file: path / required: false`: либо обновите Docker Desktop, либо заранее создайте файл `.env` (можно пустой с комментариями не подойдёт — нужен реальный файл; скопируйте из `.env.example`).

---

## Вариант C — Dev Container (Cursor / VS Code / GitHub Codespaces)

1. Установите расширение **Dev Containers** (VS Code) / в Cursor используйте встроенную поддержку devcontainer.
2. Откройте репозиторий и выберите **Reopen in Container** / **Open in Dev Container**.

Конфиг: [`.devcontainer/devcontainer.json`](../.devcontainer/devcontainer.json). Используется тот же [`docker-compose.yml`](../docker-compose.yml), сервис **`dev`**.

- **`postCreateCommand`**: если нет `.env`, копирует из `.env.example` (чтобы Compose мог подхватить переменные при следующих запусках).
- Запуск стека: **`Dockerfile.dev`** задаёт **`CMD`**: `npm install && npm run dev` — после старта контейнера поднимаются Vite и API.

Порты **5173** и **3001** проброшены и помечены в `portsAttributes`.

---

## Справка по файлам

| Файл | Назначение |
|------|------------|
| [`package.json`](../package.json) | `postinstall`, скрипт `setup` |
| [`tools/scripts/install-api-deps.mjs`](../tools/scripts/install-api-deps.mjs) | установка `apps/api` после корневого `npm install` |
| [`tools/scripts/setup.mjs`](../tools/scripts/setup.mjs) | npm + pip + `.env` из примера |
| [`Dockerfile.dev`](../Dockerfile.dev) | dev-образ Node + Python |
| [`docker-compose.yml`](../docker-compose.yml) | сервис `dev`, тома для `node_modules` |
| [`.dockerignore`](../.dockerignore) | ускорение сборки образа |
| [`.devcontainer/devcontainer.json`](../.devcontainer/devcontainer.json) | Dev Container / Codespaces |

---

## GitHub (без хостинга приложения)

Публикация репозитория на GitHub **не заменяет** установку Node/Python или Docker: это удобно для **клонирования**, PR и **Codespaces** (если включены). Для Codespaces devcontainer подхватится автоматически при открытии репо в контейнере.

Кратко для нового участника с Git:

```bash
git clone <url> TKRP
cd TKRP
npm run setup
npm run dev
```

(или вместо `setup`: только `npm install` + вручную `pip install -r requirements.txt` + `.env`).
