#!/usr/bin/env bash
# ==============================================================================
# Скрипт восстановления базы данных PostgreSQL из файла дампа
# Курсовая работа: Раздел 3.1
# ==============================================================================
set -euo pipefail

BACKUP_DIR="./data/backups"
CONTAINER_NAME="tkrp-db"
DB_NAME="${POSTGRES_DB:-tkrp}"
DB_USER="${POSTGRES_USER:-postgres}"

# Если файл дампа не передан аргументом, берем самый свежий из папки
DUMP_FILE="${1:-}"
if [ -z "${DUMP_FILE}" ]; then
  DUMP_FILE=$(ls -t "${BACKUP_DIR}"/dump_tkrp_*.sql 2>/dev/null | head -n 1 || true)
fi

if [ -z "${DUMP_FILE}" ] || [ ! -f "${DUMP_FILE}" ]; then
  echo "ОШИБКА: Файл резервной копии не найден в ${BACKUP_DIR}!" >&2
  exit 1
fi

echo "=========================================================="
echo " [RESTORE] Восстановление базы данных PostgreSQL..."
echo " Контейнер: ${CONTAINER_NAME}"
echo " База:      ${DB_NAME}"
echo " Дамп:      ${DUMP_FILE}"
echo "=========================================================="

if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  echo "ОШИБКА: Контейнер ${CONTAINER_NAME} не запущен!" >&2
  exit 1
fi

cat "${DUMP_FILE}" | docker exec -i "${CONTAINER_NAME}" psql -U "${DB_USER}" -d "${DB_NAME}"

echo "✅ База данных успешно восстановлена из ${DUMP_FILE}!"
echo "🕒 Время завершения: $(date)"
