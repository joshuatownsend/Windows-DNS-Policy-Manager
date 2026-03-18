#Requires -Version 5.1
<#
.SYNOPSIS
    Launches the DNS Policy Manager bridge and opens the web UI.
.DESCRIPTION
    Starts bridge.ps1 in background, waits for health check, then starts the Next.js frontend.
#>

param(
    [int]$Port = 8650,
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$bridgeScript = Join-Path $scriptDir 'server\bridge.ps1'
$frontendDir = Join-Path $scriptDir 'dns-manager'

Write-Host ''
Write-Host '  DNS Policy Manager Launcher' -ForegroundColor Cyan
Write-Host '  ──────────────────────────────' -ForegroundColor DarkGray

# Check if bridge is already running
try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:${Port}/api/health" -TimeoutSec 2 -ErrorAction Stop
    if ($health.status -eq 'ok') {
        Write-Host "  Bridge already running on port $Port" -ForegroundColor Green
        if (-not $NoBrowser) {
            Start-Process 'http://localhost:10010'
            Write-Host '  Browser opened.' -ForegroundColor Green
        }
        return
    }
} catch {
    # Not running - start it
}

# Kill stale bridge process on the same port (if any)
# HttpListener uses HTTP.sys, so a stale registration can block the port
# even after the process dies. Check both TCP connections and HTTP.sys.
$staleKilled = $false
try {
    # Method 1: TCP connection check
    $staleConn = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue |
        Where-Object { $_.State -eq 'Listen' }
    if ($staleConn) {
        $stalePid = $staleConn.OwningProcess
        Write-Host "  Stopping stale bridge (PID: $stalePid) on port $Port..." -ForegroundColor Yellow
        Stop-Process -Id $stalePid -Force -ErrorAction SilentlyContinue
        $staleKilled = $true
    }
} catch {}
try {
    # Method 2: Find orphaned powershell processes running bridge.ps1
    $bridgeProcs = Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -and $_.CommandLine -match 'bridge\.ps1' -and $_.ProcessId -ne $PID }
    foreach ($proc in $bridgeProcs) {
        Write-Host "  Stopping stale bridge process (PID: $($proc.ProcessId))..." -ForegroundColor Yellow
        Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
        $staleKilled = $true
    }
} catch {}
if ($staleKilled) {
    Start-Sleep -Milliseconds 1000
}

# Start bridge in a new window, redirecting output to a log file for diagnostics
$logFile = Join-Path $scriptDir 'bridge.log'
Write-Host "  Starting bridge on port $Port..." -ForegroundColor Yellow

# Check if we're running elevated (HttpListener typically requires it)
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)

$bridgeCmd = "& '$bridgeScript' -Port $Port *>&1 | Tee-Object -FilePath '$logFile'; pause"
$startArgs = @{
    FilePath     = 'powershell'
    ArgumentList = "-NoProfile -ExecutionPolicy Bypass -Command `"$bridgeCmd`""
    PassThru     = $true
    WindowStyle  = 'Normal'
}

if (-not $isAdmin) {
    Write-Host '  Not elevated — requesting Administrator rights for bridge...' -ForegroundColor Yellow
    $startArgs['Verb'] = 'RunAs'
}

try {
    $bridgeJob = Start-Process @startArgs
} catch {
    Write-Host "  Failed to start bridge: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host '  Try running this script from an elevated PowerShell (Run as Administrator).' -ForegroundColor Yellow
    return
}

# Wait for health check (up to 8 seconds)
$ready = $false
for ($i = 0; $i -lt 16; $i++) {
    Start-Sleep -Milliseconds 500
    try {
        $health = Invoke-RestMethod -Uri "http://127.0.0.1:${Port}/api/health" -TimeoutSec 2 -ErrorAction Stop
        if ($health.status -eq 'ok') {
            $ready = $true
            break
        }
    } catch {
        # Check if bridge process has already exited (crashed)
        if ($bridgeJob.HasExited) {
            Write-Host '  Bridge process exited unexpectedly.' -ForegroundColor Red
            break
        }
    }
}

if ($ready) {
    Write-Host "  Bridge started (PID: $($bridgeJob.Id))" -ForegroundColor Green
    Write-Host "  DNS Module: $(if ($health.dnsModuleAvailable) { 'Available' } else { 'Not Found' })" -ForegroundColor $(if ($health.dnsModuleAvailable) { 'Green' } else { 'Yellow' })

    # Start Next.js frontend
    if (Test-Path (Join-Path $frontendDir 'node_modules')) {
        Write-Host '  Starting Next.js frontend...' -ForegroundColor Yellow
        $devCmd = "cd '$frontendDir'; npm run dev"
        Start-Process powershell -ArgumentList "-NoProfile -Command `"$devCmd`"" -WindowStyle Normal
        Start-Sleep -Milliseconds 2000
    } else {
        Write-Host '  Frontend not installed. Run: cd dns-manager && npm install' -ForegroundColor Yellow
    }

    if (-not $NoBrowser) {
        Start-Process 'http://localhost:10010'
        Write-Host '  Browser opened.' -ForegroundColor Green
    }
} else {
    Write-Host '  Bridge failed to start.' -ForegroundColor Red
    # Show the log file contents for diagnostics
    if (Test-Path $logFile) {
        $logContent = Get-Content $logFile -Tail 15 -ErrorAction SilentlyContinue
        if ($logContent) {
            Write-Host ''
            Write-Host '  Bridge output (last 15 lines):' -ForegroundColor Yellow
            foreach ($line in $logContent) {
                Write-Host "    $line" -ForegroundColor DarkGray
            }
        }
    } else {
        Write-Host '  No log file found. The bridge may have failed to launch PowerShell.' -ForegroundColor Yellow
    }
    Write-Host ''
    Write-Host '  Common causes:' -ForegroundColor Yellow
    Write-Host "    - Port $Port already in use (netstat -ano | findstr $Port)" -ForegroundColor DarkGray
    Write-Host '    - DnsServer module not installed (Install-WindowsFeature RSAT-DNS-Server)' -ForegroundColor DarkGray
    Write-Host '    - Insufficient permissions (run as Administrator)' -ForegroundColor DarkGray
}

Write-Host ''
Write-Host "  API: http://127.0.0.1:${Port}/api/health" -ForegroundColor DarkGray
Write-Host '  Press Ctrl+C in the bridge window to stop.' -ForegroundColor DarkGray
Write-Host ''
