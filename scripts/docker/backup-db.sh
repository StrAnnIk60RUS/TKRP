#!/usr/bin/env bash
# ==============================================================================
# Скрипт создания резервной копии базы данных PostgreSQL из Docker-контейнера
# Курсовая работа: Раздел 3.1
# ==============================================================================
set -euo pipefail

BACKUP_DIR="./data/backups"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="${BACKUP_DIR}/dump_tkrp_${TIMESTAMP}.sql"
CONTAINER_NAME="tkrp-db"
DB_NAME="${POSTGRES_DB:-tkrp}"
DB_USER="${POSTGRES_USER:-postgres}"

mkdir -p "${BACKUP_DIR}"

echo "=========================================================="
echo " [BACKUP] Запуск создания резервной копии БД PostgreSQL..."
echo " Контейнер: ${CONTAINER_NAME}"
echo " База:      ${DB_NAME}"
echo " Файл:      ${BACKUP_FILE}"
echo "=========================================================="

if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  echo "ОШИБКА: Контейнер ${CONTAINER_NAME} не запущен!" >&2
  exit 1
fi

docker exec -t "${CONTAINER_NAME}" pg_dump -U "${DB_USER}" -d "${DB_NAME}" --clean --if-exists > "${BACKUP_FILE}"

FILE_SIZE=$(du -h "${BACKUP_FILE}" | cut -f1)
echo "✅ Резервная копия успешно создана!"
echo "📁 Размер дампа: ${FILE_SIZE}"
echo "🕒 Время завершения: $(date)"
