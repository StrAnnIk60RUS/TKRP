# ==============================================================================
# PowerShell-скрипт восстановления базы данных PostgreSQL из файла дампа
# Курсовая работа: Раздел 3.1
# ==============================================================================
param (
    [string]$ContainerName = "tkrp-db",
    [string]$DbUser = "postgres",
    [string]$DbName = "tkrp",
    [string]$DumpFile = ""
)

$ErrorActionPreference = "Stop"

if (-not $DumpFile) {
    $latest = Get-ChildItem -Path "./data/backups" -Filter "dump_tkrp_*.sql" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($latest) {
        $DumpFile = $latest.FullName
    } else {
        Write-Error "ОШИБКА: Файлы резервных копий не найдены в папке ./data/backups!"
        exit 1
    }
}

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " [RESTORE] Восстановление базы данных PostgreSQL..." -ForegroundColor Cyan
Write-Host " Контейнер: $ContainerName" -ForegroundColor Yellow
Write-Host " База:      $DbName" -ForegroundColor Yellow
Write-Host " Дамп:      $DumpFile" -ForegroundColor Yellow
Write-Host "==========================================================" -ForegroundColor Cyan

$running = docker ps --filter "name=^/${ContainerName}$" --format "{{.Names}}"
if (-not $running) {
    Write-Error "ОШИБКА: Контейнер '$ContainerName' не запущен!"
    exit 1
}

# Восстановление через psql внутри контейнера
cmd /c "docker exec -i $ContainerName psql -U $DbUser -d $DbName < ""$DumpFile"""

Write-Host "✅ База данных успешно восстановлена из '$DumpFile'!" -ForegroundColor Green
Write-Host "🕒 Время: $(Get-Date)" -ForegroundColor Gray
