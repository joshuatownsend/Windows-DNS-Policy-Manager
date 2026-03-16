#Requires -Version 5.1
<#
.SYNOPSIS
    Launches the DNS Policy Manager bridge and opens the web UI.
.DESCRIPTION
    Starts bridge.ps1 in background, waits for health check, then opens index.html.
#>

param(
    [int]$Port = 8600,
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$bridgeScript = Join-Path $scriptDir 'server\bridge.ps1'
$indexFile = Join-Path $scriptDir 'index.html'

Write-Host ''
Write-Host '  DNS Policy Manager Launcher' -ForegroundColor Cyan
Write-Host '  ──────────────────────────────' -ForegroundColor DarkGray

# Check if bridge is already running
try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:${Port}/api/health" -TimeoutSec 2 -ErrorAction Stop
    if ($health.status -eq 'ok') {
        Write-Host "  Bridge already running on port $Port" -ForegroundColor Green
        if (-not $NoBrowser) {
            Start-Process $indexFile
            Write-Host '  Browser opened.' -ForegroundColor Green
        }
        return
    }
} catch {
    # Not running - start it
}

# Start bridge in background
Write-Host "  Starting bridge on port $Port..." -ForegroundColor Yellow
$bridgeJob = Start-Process powershell -ArgumentList "-ExecutionPolicy Bypass -File `"$bridgeScript`" -Port $Port" -PassThru -WindowStyle Normal

# Wait for health check (up to 5 seconds)
$ready = $false
for ($i = 0; $i -lt 10; $i++) {
    Start-Sleep -Milliseconds 500
    try {
        $health = Invoke-RestMethod -Uri "http://127.0.0.1:${Port}/api/health" -TimeoutSec 2 -ErrorAction Stop
        if ($health.status -eq 'ok') {
            $ready = $true
            break
        }
    } catch {
        # Not ready yet
    }
}

if ($ready) {
    Write-Host "  Bridge started (PID: $($bridgeJob.Id))" -ForegroundColor Green
    Write-Host "  DNS Module: $(if ($health.dnsModuleAvailable) { 'Available' } else { 'Not Found' })" -ForegroundColor $(if ($health.dnsModuleAvailable) { 'Green' } else { 'Yellow' })

    if (-not $NoBrowser) {
        Start-Process $indexFile
        Write-Host '  Browser opened.' -ForegroundColor Green
    }
} else {
    Write-Host '  Bridge failed to start within 5 seconds.' -ForegroundColor Red
    Write-Host '  Check the bridge window for errors.' -ForegroundColor Yellow
}

Write-Host ''
Write-Host "  API: http://127.0.0.1:${Port}/api/health" -ForegroundColor DarkGray
Write-Host '  Press Ctrl+C in the bridge window to stop.' -ForegroundColor DarkGray
Write-Host ''
