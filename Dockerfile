# ==============================================================================
# Multi-Stage Dockerfile для Backend API (Node.js 20 ESM + Python 3.11 ML Runtime)
# ЭТАП 1: Сборка и подготовка зависимостей (Builder Stage)
# ==============================================================================
FROM node:20-bookworm-slim AS builder

WORKDIR /build

# Установка системных утилит сборки Python
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-venv \
    python3-pip \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Создаем изолированное виртуальное окружение Python
RUN python3 -m venv /opt/tkrp-py
ENV PATH="/opt/tkrp-py/bin:$PATH"

# Устанавливаем Python-зависимости (ML-инструменты и парсеры)
COPY requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r /tmp/requirements.txt

# Устанавливаем Node.js зависимости только для production
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
ENV NODE_ENV=production
ENV SKIP_POSTINSTALL=1
RUN npm ci --omit=dev --prefer-offline --no-audit && \
    npm ci --prefix apps/api --omit=dev --prefer-offline --no-audit

# ==============================================================================
# ЭТАП 2: Продакшн образ выполнения (Final Runtime Stage)
# Минимальный размер, изоляция, запуск от непривилегированного пользователя node
# ==============================================================================
FROM node:20-bookworm-slim AS runner

WORKDIR /app

# Устанавливаем только минимальный рантайм Python без сборочных утилит (gcc/build-essential)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    curl \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# Копируем скомпилированное виртуальное окружение Python из builder
COPY --from=builder /opt/tkrp-py /opt/tkrp-py
ENV PATH="/opt/tkrp-py/bin:$PATH"
ENV PYTHON_BIN="/opt/tkrp-py/bin/python"

# Копируем установленные production node_modules
COPY --from=builder /build/node_modules ./node_modules
COPY --from=builder /build/apps/api/node_modules ./apps/api/node_modules
COPY package.json ./
COPY apps/api ./apps/api
COPY tools ./tools
COPY data ./data

# Настраиваем окружение Node.js
ENV NODE_ENV=production
ENV PORT=3001

# Обеспечение безопасности: создаем директории для runtime и отдаем права пользователю node
RUN mkdir -p /app/data/runtime /app/apps/api/.data && \
    chown -R node:node /app

# Запуск от непривилегированного пользователя (согласно требованиям ИБ)
USER node

# Порт Express API
EXPOSE 3001

# Встроенная проверка работоспособности (Health Check)
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:3001/health || exit 1

# Точка входа
CMD ["node", "apps/api/server.js"]
