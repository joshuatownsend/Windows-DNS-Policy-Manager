#Requires -Version 5.1
<#
.SYNOPSIS
    Launches the DNS Policy Manager bridge and opens the web UI.
.DESCRIPTION
    Starts bridge.ps1 in background, waits for health check, then starts the Next.js frontend.
    Optionally builds the MCP server and prints a registration command for AI agent integration.
.PARAMETER Port
    Bridge port (default 8650).
.PARAMETER NoBrowser
    Skip opening browser.
.PARAMETER MCP
    Build the MCP server and output a 'claude mcp add ...' registration command for AI agent integration (Claude Code, Cursor, etc.).
#>

param(
    [int]$Port = 8650,
    [switch]$NoBrowser,
    [switch]$MCP
)

$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$bridgeScript = Join-Path $scriptDir 'server\bridge.ps1'
$frontendDir = Join-Path $scriptDir 'dns-manager'

function Invoke-McpBuild {
    param([string]$McpDir, [int]$BridgePort)
    if (-not (Test-Path (Join-Path $McpDir 'package.json'))) {
        Write-Host '  MCP server not found at mcp-server/.' -ForegroundColor Yellow
        return
    }
    if (-not (Test-Path (Join-Path $McpDir 'node_modules'))) {
        Write-Host '  Installing MCP server dependencies...' -ForegroundColor Yellow
        Push-Location $McpDir
        npm install --silent 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) {
            Pop-Location
            Write-Host '  npm install failed. Check network and try again.' -ForegroundColor Red
            return
        }
        Pop-Location
    }
    if (-not (Test-Path (Join-Path $McpDir 'dist\index.js'))) {
        Write-Host '  Building MCP server...' -ForegroundColor Yellow
        Push-Location $McpDir
        npx tsc 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) {
            Pop-Location
            Write-Host '  TypeScript build failed. Run "npx tsc" in mcp-server/ for details.' -ForegroundColor Red
            return
        }
        Pop-Location
    }
    $mcpEntry = Join-Path $McpDir 'dist\index.js'
    Write-Host "  MCP server built: $mcpEntry" -ForegroundColor Green
    Write-Host '  Register with Claude Code:' -ForegroundColor Cyan
    Write-Host "    claude mcp add dns-policy-manager -e BRIDGE_URL=http://127.0.0.1:${BridgePort} -- node `"$mcpEntry`"" -ForegroundColor DarkGray
}

Write-Host ''
Write-Host '  DNS Policy Manager Launcher' -ForegroundColor Cyan
Write-Host '  ------------------------------' -ForegroundColor DarkGray

# Check if bridge is already running
try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:${Port}/api/health" -TimeoutSec 2 -ErrorAction Stop
    if ($health.status -eq 'ok') {
        Write-Host "  Bridge already running on port $Port" -ForegroundColor Green
        if (-not $NoBrowser) {
            Start-Process 'http://localhost:10010'
            Write-Host '  Browser opened.' -ForegroundColor Green
        }
        if ($MCP) {
            Invoke-McpBuild -McpDir (Join-Path $scriptDir 'mcp-server') -BridgePort $Port
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
    Write-Host '  Not elevated - requesting Administrator rights for bridge...' -ForegroundColor Yellow
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

    # Start Next.js frontend (auto-install if needed)
    if (-not (Test-Path (Join-Path $frontendDir 'node_modules'))) {
        Write-Host '  Installing frontend dependencies...' -ForegroundColor Yellow
        Push-Location $frontendDir
        npm install --silent 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) {
            Pop-Location
            Write-Host '  npm install failed. Run manually: cd dns-manager && npm install' -ForegroundColor Red
        } else {
            Pop-Location
        }
    }
    if (Test-Path (Join-Path $frontendDir 'node_modules')) {
        Write-Host '  Starting Next.js frontend...' -ForegroundColor Yellow
        $devCmd = "Set-Location '$frontendDir'; npm run dev; Write-Host 'Frontend exited. Press any key to close.' -ForegroundColor Yellow; pause"
        Start-Process powershell -ArgumentList "-NoProfile -NoExit -Command `"$devCmd`"" -WindowStyle Normal
        Start-Sleep -Milliseconds 3000
    }

    if (-not $NoBrowser) {
        Start-Process 'http://localhost:10010'
        Write-Host '  Browser opened.' -ForegroundColor Green
    }

    # MCP Server (optional)
    if ($MCP) {
        Invoke-McpBuild -McpDir (Join-Path $scriptDir 'mcp-server') -BridgePort $Port
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
Write-Host '  MCP: Start-DNSPolicyManager.ps1 -MCP to build the AI agent server' -ForegroundColor DarkGray
Write-Host '  Press Ctrl+C in the bridge window to stop.' -ForegroundColor DarkGray
Write-Host ''
