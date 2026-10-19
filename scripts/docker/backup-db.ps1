# ==============================================================================
# PowerShell-скрипт создания резервной копии базы данных PostgreSQL из контейнера
# Курсовая работа: Раздел 3.1
# ==============================================================================
param (
    [string]$ContainerName = "tkrp-db",
    [string]$DbUser = "postgres",
    [string]$DbName = "tkrp",
    [string]$BackupDir = "./data/backups"
)

$ErrorActionPreference = "Stop"

if (!(Test-Path -Path $BackupDir)) {
    New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null
}

$Timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$BackupFile = Join-Path $BackupDir "dump_tkrp_${Timestamp}.sql"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " [BACKUP] Запуск создания резервной копии БД PostgreSQL..." -ForegroundColor Cyan
Write-Host " Контейнер: $ContainerName" -ForegroundColor Yellow
Write-Host " База:      $DbName" -ForegroundColor Yellow
Write-Host " Файл:      $BackupFile" -ForegroundColor Yellow
Write-Host "==========================================================" -ForegroundColor Cyan

$running = docker ps --filter "name=^/${ContainerName}$" --format "{{.Names}}"
if (-not $running) {
    Write-Error "ОШИБКА: Контейнер '$ContainerName' не запущен!"
    exit 1
}

# Выполнение pg_dump внутри контейнера с записью в файл на хосте
cmd /c "docker exec -i $ContainerName pg_dump -U $DbUser -d $DbName --clean --if-exists > ""$BackupFile"""

if (Test-Path -Path $BackupFile) {
    $item = Get-Item -Path $BackupFile
    Write-Host "✅ Резервная копия успешно создана!" -ForegroundColor Green
    Write-Host "📁 Размер дампа: $([math]::Round($item.Length / 1KB, 2)) КБ" -ForegroundColor Green
    Write-Host "🕒 Время: $(Get-Date)" -ForegroundColor Gray
} else {
    Write-Error "Ошибка при сохранении файла дампа."
}
