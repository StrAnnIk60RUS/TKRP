#!/usr/bin/env bash
# ==============================================================================
# Скрипт проверки сетевого взаимодействия и изоляции контейнеров
# Курсовая работа: Раздел 3.3
# ==============================================================================
set -euo pipefail

BACKEND_CONTAINER="tkrp-backend"
DB_HOST="db"
DB_PORT="5432"

echo "=========================================================="
echo " [ТЕСТ 3.3] Тестирование сетевого взаимодействия и изоляции"
echo "=========================================================="

echo -e "\n--- ЭТАП 1: Проверка связи внутри Docker-сети (${BACKEND_CONTAINER} -> ${DB_HOST}:${DB_PORT}) ---"
if docker exec -t "${BACKEND_CONTAINER}" sh -c "nc -z -v -w 3 ${DB_HOST} ${DB_PORT} 2>/dev/null || timeout 3 bash -c '</dev/tcp/${DB_HOST}/${DB_PORT}' 2>/dev/null || node -e \"const net=require('net');const s=net.connect(${DB_PORT},'${DB_HOST}',()=>{console.log('SUCCESS: Connected to DB via Docker DNS');process.exit(0)});s.on('error',()=>process.exit(1));\""; then
  echo "✅ УСПЕХ: Внутреннее DNS-имя '${DB_HOST}' разрешается, порт ${DB_PORT} доступен изнутри сети!"
else
  echo "❌ ОШИБКА: Сервер приложения не может связаться с базой по имени '${DB_HOST}'!"
  exit 1
fi

echo -e "\n--- ЭТАП 2: Проверка изоляции СУБД от хост-машины (безопасность) ---"
echo "Попытка прямого подключения к localhost:${DB_PORT} с хоста..."
if nc -z -v -w 2 localhost "${DB_PORT}" 2>/dev/null || curl --connect-timeout 2 "http://localhost:${DB_PORT}" 2>/dev/null; then
  echo "⚠️ ВНИМАНИЕ: Порт ${DB_PORT} открыт на хосте! (Для dev-режима это норма, но в production рекомендуется expose)"
else
  echo "✅ УСПЕХ: Порт ${DB_PORT} закрыт на хост-машине! Прямой несанкционированный доступ к СУБД заблокирован."
fi

echo -e "\n=========================================================="
echo "✅ ТЕСТ СЕТЕВОЙ ИЗОЛЯЦИИ И ВЗАИМОДЕЙСТВИЯ ЗАВЕРШЕН!"
echo "=========================================================="
