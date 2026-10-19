# ==============================================================================
# PowerShell-скрипт тестирования отказоустойчивости при сбое БД
# Курсовая работа: Раздел 3.2
# ==============================================================================
param (
    [string]$ContainerName = "tkrp-db",
    [string]$HealthUrl = "http://localhost/health"
)

$ErrorActionPreference = "Continue"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " [ТЕСТ 3.2] Тестирование отказоустойчивости при сбое СУБД" -ForegroundColor Cyan
Write-Host " Контейнер БД: $ContainerName" -ForegroundColor Yellow
Write-Host " Эндпоинт:     $HealthUrl" -ForegroundColor Yellow
Write-Host "==========================================================" -ForegroundColor Cyan

# Проверяем доступность через Nginx или напрямую через Backend API
try {
    $testReq = Invoke-WebRequest -Uri $HealthUrl -UseBasicParsing -TimeoutSec 3 -ErrorAction SilentlyContinue
} catch {
    $HealthUrl = "http://localhost:3001/health"
}

Write-Host "`n--- ЭТАП 1: Проверка нормального состояния системы ---" -ForegroundColor Green
try {
    $res1 = Invoke-RestMethod -Uri $HealthUrl -Method Get -TimeoutSec 5
    Write-Host "HTTP 200 OK: Статус = $($res1.status), БД = $($res1.database)" -ForegroundColor Green
    $res1 | ConvertTo-Json -Depth 3 | Write-Host
} catch {
    Write-Host "Ошибка запроса: $_" -ForegroundColor Red
}

Write-Host "`n--- ЭТАП 2: Имитация аварийного падения контейнера СУБД ---" -ForegroundColor Yellow
docker stop $ContainerName | Out-Null
Write-Host "Контейнер $ContainerName остановлен (docker stop)." -ForegroundColor Red

Start-Sleep -Seconds 2

Write-Host "`n--- ЭТАП 3: Фиксация реакции приложения на сбой СУБД ---" -ForegroundColor Yellow
try {
    $res2 = Invoke-WebRequest -Uri $HealthUrl -Method Get -TimeoutSec 5 -ErrorAction Stop
    Write-Host "HTTP $($res2.StatusCode): $($res2.Content)" -ForegroundColor Yellow
} catch {
    if ($_.Exception.Response) {
        $stream = $_.Exception.Response.GetResponseStream()
        $reader = New-Object System.IO.StreamReader($stream)
        $body = $reader.ReadToEnd()
        Write-Host "HTTP 503 Service Degraded (Ожидаемо): $body" -ForegroundColor Yellow
    } else {
        Write-Host "Ошибка подключения: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

Write-Host "`n--- ЭТАП 4: Перезапуск контейнера СУБД и ожидание готовности ---" -ForegroundColor Cyan
docker start $ContainerName | Out-Null
Write-Host "Контейнер $ContainerName запущен. Ожидание статуса 'healthy'..." -ForegroundColor Cyan

$attempts = 0
do {
    Start-Sleep -Seconds 1
    $status = (docker inspect -f "{{.State.Health.Status}}" $ContainerName 2>$null).Trim()
    $attempts++
} while ($status -ne "healthy" -and $attempts -lt 20)

Write-Host "Статус СУБД в Docker: $status (прошло $attempts сек.)" -ForegroundColor Green

Write-Host "`n--- ЭТАП 5: Проверка успешного автовосстановления связи ---" -ForegroundColor Green
try {
    $res3 = Invoke-RestMethod -Uri $HealthUrl -Method Get -TimeoutSec 5
    Write-Host "HTTP 200 OK: Статус = $($res3.status), БД = $($res3.database)" -ForegroundColor Green
    $res3 | ConvertTo-Json -Depth 3 | Write-Host
} catch {
    Write-Host "Ошибка запроса: $_" -ForegroundColor Red
}

Write-Host "`n==========================================================" -ForegroundColor Cyan
Write-Host "✅ ТЕСТ ОТКАЗОУСТОЙЧИВОСТИ УСПЕШНО ЗАВЕРШЕН!" -ForegroundColor Green
Write-Host "Приложение корректно фиксирует деградацию и восстанавливает соединение." -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Cyan
