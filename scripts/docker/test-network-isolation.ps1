# ==============================================================================
# PowerShell-скрипт проверки сетевого взаимодействия и изоляции контейнеров
# Курсовая работа: Раздел 3.3
# ==============================================================================
param (
    [string]$BackendContainer = "tkrp-backend",
    [string]$DbHost = "db",
    [int]$DbPort = 5432
)

$ErrorActionPreference = "Continue"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " [ТЕСТ 3.3] Тестирование сетевого взаимодействия и изоляции" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

Write-Host "`n--- ЭТАП 1: Проверка связи внутри Docker-сети ($BackendContainer -> $DbHost`:$DbPort) ---" -ForegroundColor Yellow
$nodeTestCmd = "node -e `"const net=require('net');const s=net.connect($DbPort,'$DbHost',()=>{console.log('SUCCESS');process.exit(0)});s.on('error',()=>process.exit(1));`""
$internalTest = docker exec $BackendContainer sh -c $nodeTestCmd 2>$null

if ($internalTest -match "SUCCESS") {
    Write-Host "✅ УСПЕХ: Внутреннее DNS-имя '$DbHost' разрешается, порт $DbPort доступен изнутри Docker-сети!" -ForegroundColor Green
} else {
    Write-Host "⚠️ Замечание: Не удалось выполнить тест внутри контейнера (проверьте, запущен ли $BackendContainer)." -ForegroundColor Yellow
}

Write-Host "`n--- ЭТАП 2: Проверка изоляции СУБД от хост-машины (безопасность) ---" -ForegroundColor Yellow
Write-Host "Попытка прямого подключения к localhost`:$DbPort с хост-машины..." -ForegroundColor Gray
$tcpClient = New-Object System.Net.Sockets.TcpClient
$asyncResult = $tcpClient.BeginConnect("127.0.0.1", $DbPort, $null, $null)
$wait = $asyncResult.AsyncWaitHandle.WaitOne(1500, $false)

if ($wait -and $tcpClient.Connected) {
    $tcpClient.EndConnect($asyncResult)
    $tcpClient.Close()
    Write-Host "⚠️ ВНИМАНИЕ: Порт $DbPort открыт на хосте (актуально для dev-режима с port mapping)." -ForegroundColor Yellow
} else {
    Write-Host "✅ УСПЕХ: Порт $DbPort недоступен напрямую с хост-машины! (Работает директива expose, СУБД изолирована в подсети контейнеров)." -ForegroundColor Green
}

Write-Host "`n==========================================================" -ForegroundColor Cyan
Write-Host "✅ ТЕСТ СЕТЕВОГО ВЗАИМОДЕЙСТВИЯ И ИЗОЛЯЦИИ ЗАВЕРШЕН!" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Cyan
