#Requires -Version 5.1
<#
.SYNOPSIS
    DNS Policy Manager - PowerShell HTTP Bridge
.DESCRIPTION
    Local HTTP bridge that exposes DNS Server cmdlets as REST API endpoints.
    Binds only to 127.0.0.1:8600 for security. Zero external dependencies.
.NOTES
    Run with: powershell -ExecutionPolicy Bypass -File bridge.ps1
    Stop with: Ctrl+C
#>

param(
    [int]$Port = 8600
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ── Helpers ──────────────────────────────────────────────────────────────────

function Write-Log {
    param([string]$Message, [string]$Level = 'INFO')
    $ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    Write-Host "[$ts] [$Level] $Message" -ForegroundColor $(
        switch ($Level) {
            'ERROR' { 'Red' }
            'WARN'  { 'Yellow' }
            default { 'Gray' }
        }
    )
}

function ConvertTo-JsonSafe {
    param($InputObject)
    # PowerShell 5.1 compatible JSON conversion
    $InputObject | ConvertTo-Json -Depth 10 -Compress
}

function Send-Response {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [hashtable]$Body,
        [int]$StatusCode = 200
    )
    $json = ConvertTo-JsonSafe $Body
    $buffer = [System.Text.Encoding]::UTF8.GetBytes($json)

    $Response.StatusCode = $StatusCode
    $Response.ContentType = 'application/json; charset=utf-8'
    $Response.ContentLength64 = $buffer.Length

    # CORS headers - safe because localhost-only
    $Response.Headers.Add('Access-Control-Allow-Origin', '*')
    $Response.Headers.Add('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
    $Response.Headers.Add('Access-Control-Allow-Headers', 'Content-Type')

    $Response.OutputStream.Write($buffer, 0, $buffer.Length)
    $Response.OutputStream.Close()
}

function Send-Preflight {
    param([System.Net.HttpListenerResponse]$Response)
    $Response.StatusCode = 204
    $Response.Headers.Add('Access-Control-Allow-Origin', '*')
    $Response.Headers.Add('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
    $Response.Headers.Add('Access-Control-Allow-Headers', 'Content-Type')
    $Response.Headers.Add('Access-Control-Max-Age', '86400')
    $Response.ContentLength64 = 0
    $Response.OutputStream.Close()
}

function Read-RequestBody {
    param([System.Net.HttpListenerRequest]$Request)
    if ($Request.HasEntityBody) {
        $reader = New-Object System.IO.StreamReader($Request.InputStream, $Request.ContentEncoding)
        $body = $reader.ReadToEnd()
        $reader.Close()
        if ($body) {
            return ($body | ConvertFrom-Json)
        }
    }
    return $null
}

function Get-QueryParam {
    param(
        [System.Net.HttpListenerRequest]$Request,
        [string]$Name,
        [string]$Default = ''
    )
    $val = $Request.QueryString[$Name]
    if ($val) { return $val }
    return $Default
}

function Test-DnsModule {
    try {
        $null = Get-Command Get-DnsServerQueryResolutionPolicy -ErrorAction Stop
        return $true
    } catch {
        return $false
    }
}

# ── Credential Infrastructure ────────────────────────────────────────────────

$script:SessionCredentials = @{}
$script:CredStorePath = Join-Path $env:LOCALAPPDATA 'DNSPolicyManager\credentials'

function Resolve-ServerCredential {
    param(
        [string]$ServerId,
        [string]$CredentialMode,
        [string]$Hostname
    )

    $params = @{}
    if ($Hostname -and $Hostname -ne 'localhost' -and $Hostname -ne $env:COMPUTERNAME) {
        $params['ComputerName'] = $Hostname
    }

    switch ($CredentialMode) {
        'savedCredential' {
            $credFile = Join-Path $script:CredStorePath "$ServerId.cred"
            if (-not (Test-Path $credFile)) {
                throw "No saved credential found for server '$ServerId'"
            }
            $credData = Get-Content $credFile -Raw | ConvertFrom-Json
            $securePass = $credData.Password | ConvertTo-SecureString
            $cred = New-Object System.Management.Automation.PSCredential($credData.Username, $securePass)
            $params['Credential'] = $cred
        }
        'session' {
            if ($script:SessionCredentials.ContainsKey($ServerId)) {
                $params['Credential'] = $script:SessionCredentials[$ServerId]
            }
        }
        # 'currentUser' — no credential needed, Kerberos/NTLM handles auth
    }

    return $params
}

function Handle-StoreCredential {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [psobject]$Body
    )

    try {
        if (-not $Body -or -not $Body.serverId -or -not $Body.username -or -not $Body.password) {
            Send-Response -Response $Response -Body @{
                success = $false
                error   = 'serverId, username, and password are required'
            } -StatusCode 400
            return
        }

        # Ensure credential store directory exists
        if (-not (Test-Path $script:CredStorePath)) {
            $null = New-Item -Path $script:CredStorePath -ItemType Directory -Force
        }

        # Encrypt password via DPAPI
        $secureString = ConvertTo-SecureString $Body.password -AsPlainText -Force
        $encrypted = $secureString | ConvertFrom-SecureString

        $credData = @{
            Username = $Body.username
            Password = $encrypted
        }

        $credFile = Join-Path $script:CredStorePath "$($Body.serverId).cred"
        $credData | ConvertTo-Json | Set-Content -Path $credFile -Encoding UTF8 -Force

        Write-Log "Credential stored for server '$($Body.serverId)'"

        Send-Response -Response $Response -Body @{
            success = $true
        }
    } catch {
        Send-Response -Response $Response -Body @{
            success = $false
            error   = $_.Exception.Message
        } -StatusCode 500
    }
}

function Handle-CheckCredential {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [System.Net.HttpListenerRequest]$Request
    )
    $serverId = Get-QueryParam -Request $Request -Name 'serverId'

    if (-not $serverId) {
        Send-Response -Response $Response -Body @{
            success = $false
            error   = 'serverId query parameter is required'
        } -StatusCode 400
        return
    }

    $credFile = Join-Path $script:CredStorePath "$serverId.cred"
    $exists = Test-Path $credFile

    Send-Response -Response $Response -Body @{
        success = $true
        exists  = $exists
    }
}

function Handle-DeleteCredential {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [string]$ServerId
    )

    $credFile = Join-Path $script:CredStorePath "$ServerId.cred"
    if (Test-Path $credFile) {
        Remove-Item $credFile -Force
        Write-Log "Credential deleted for server '$ServerId'"
    }

    # Also remove from session cache
    if ($script:SessionCredentials.ContainsKey($ServerId)) {
        $script:SessionCredentials.Remove($ServerId)
    }

    Send-Response -Response $Response -Body @{
        success = $true
    }
}

function Handle-SessionCredential {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [psobject]$Body
    )

    try {
        if (-not $Body -or -not $Body.serverId -or -not $Body.username -or -not $Body.password) {
            Send-Response -Response $Response -Body @{
                success = $false
                error   = 'serverId, username, and password are required'
            } -StatusCode 400
            return
        }

        $securePass = ConvertTo-SecureString $Body.password -AsPlainText -Force
        $cred = New-Object System.Management.Automation.PSCredential($Body.username, $securePass)
        $script:SessionCredentials[$Body.serverId] = $cred

        Write-Log "Session credential cached for server '$($Body.serverId)'"

        Send-Response -Response $Response -Body @{
            success = $true
        }
    } catch {
        Send-Response -Response $Response -Body @{
            success = $false
            error   = $_.Exception.Message
        } -StatusCode 500
    }
}

function Handle-PolicyMulti {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [psobject]$Body
    )

    try {
        if (-not $Body -or -not $Body.policy -or -not $Body.servers) {
            Send-Response -Response $Response -Body @{
                success = $false
                error   = 'policy and servers are required'
            } -StatusCode 400
            return
        }

        $policy = $Body.policy
        $results = @()

        foreach ($srv in $Body.servers) {
            $serverResult = @{
                serverId = $srv.id
                hostname = $srv.hostname
                name     = $srv.name
            }

            try {
                $credParams = Resolve-ServerCredential -ServerId $srv.id -CredentialMode $srv.credentialMode -Hostname $srv.hostname

                $splatParams = @{
                    Name     = $policy.name
                    Action   = if ($policy.action) { $policy.action } else { 'IGNORE' }
                    PassThru = $true
                }

                # Merge credential/ComputerName params
                foreach ($key in $credParams.Keys) {
                    $splatParams[$key] = $credParams[$key]
                }

                if ($policy.zoneName) {
                    $splatParams['ZoneName'] = $policy.zoneName
                }

                if ($policy.processingOrder) {
                    $splatParams['ProcessingOrder'] = [int]$policy.processingOrder
                }

                if ($policy.criteria) {
                    foreach ($c in $policy.criteria) {
                        $paramName = $c.type
                        $value = "$($c.operator),$($c.values -join ',')"
                        $splatParams[$paramName] = $value
                    }
                }

                if ($policy.criteria -and $policy.criteria.Count -gt 1 -and $policy.condition) {
                    $splatParams['Condition'] = $policy.condition
                }

                if ($policy.action -eq 'ALLOW' -and $policy.scopes) {
                    $scopeStr = ($policy.scopes | ForEach-Object { "$($_.name),$($_.weight)" }) -join ';'
                    $splatParams['ZoneScope'] = $scopeStr
                }

                $result = Add-DnsServerQueryResolutionPolicy @splatParams -ErrorAction Stop

                $serverResult['success'] = $true
                $serverResult['policy'] = @{
                    Name            = $result.Name
                    Action          = $result.Action
                    ProcessingOrder = $result.ProcessingOrder
                }
            } catch {
                $serverResult['success'] = $false
                $serverResult['error'] = $_.Exception.Message
            }

            $results += $serverResult
        }

        $allSuccess = ($results | Where-Object { -not $_.success }).Count -eq 0

        Send-Response -Response $Response -Body @{
            success = $allSuccess
            results = $results
        }
    } catch {
        Send-Response -Response $Response -Body @{
            success = $false
            error   = $_.Exception.Message
        } -StatusCode 500
    }
}

# ── Route Handlers ───────────────────────────────────────────────────────────

function Handle-Health {
    param([System.Net.HttpListenerResponse]$Response)
    $dnsAvailable = Test-DnsModule
    Send-Response -Response $Response -Body @{
        success            = $true
        status             = 'ok'
        version            = '1.0.0'
        dnsModuleAvailable = $dnsAvailable
        hostname           = $env:COMPUTERNAME
        timestamp          = (Get-Date -Format 'o')
    }
}

function Handle-Connect {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [psobject]$Body
    )
    $server = if ($Body -and $Body.server) { $Body.server } else { 'localhost' }
    $serverId = if ($Body -and $Body.serverId) { $Body.serverId } else { $null }
    $credentialMode = if ($Body -and $Body.credentialMode) { $Body.credentialMode } else { 'currentUser' }

    try {
        # Resolve credentials if serverId provided
        if ($serverId) {
            $params = Resolve-ServerCredential -ServerId $serverId -CredentialMode $credentialMode -Hostname $server
        } else {
            $params = @{}
            if ($server -ne 'localhost' -and $server -ne $env:COMPUTERNAME) {
                $params['ComputerName'] = $server
            }
        }

        $zones = @(Get-DnsServerZone @params -ErrorAction Stop |
            Where-Object { -not $_.IsAutoCreated } |
            Select-Object ZoneName, ZoneType, IsReverseLookupZone, IsDsIntegrated)

        Send-Response -Response $Response -Body @{
            success    = $true
            serverName = $server
            hostname   = $env:COMPUTERNAME
            zones      = $zones
            zoneCount  = $zones.Count
        }
    } catch {
        Send-Response -Response $Response -Body @{
            success = $false
            error   = "Failed to connect to DNS server '$server': $($_.Exception.Message)"
        } -StatusCode 500
    }
}

function Handle-GetZones {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [System.Net.HttpListenerRequest]$Request
    )
    $server = Get-QueryParam -Request $Request -Name 'server' -Default 'localhost'
    $serverId = Get-QueryParam -Request $Request -Name 'serverId'
    $credentialMode = Get-QueryParam -Request $Request -Name 'credentialMode' -Default 'currentUser'

    try {
        if ($serverId) {
            $params = Resolve-ServerCredential -ServerId $serverId -CredentialMode $credentialMode -Hostname $server
        } else {
            $params = @{}
            if ($server -ne 'localhost' -and $server -ne $env:COMPUTERNAME) {
                $params['ComputerName'] = $server
            }
        }

        $zones = @(Get-DnsServerZone @params -ErrorAction Stop |
            Where-Object { -not $_.IsAutoCreated } |
            Select-Object ZoneName, ZoneType, IsReverseLookupZone, IsDsIntegrated)

        Send-Response -Response $Response -Body @{
            success = $true
            zones   = $zones
        }
    } catch {
        Send-Response -Response $Response -Body @{
            success = $false
            error   = $_.Exception.Message
        } -StatusCode 500
    }
}

function Handle-GetPolicies {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [System.Net.HttpListenerRequest]$Request
    )
    $server = Get-QueryParam -Request $Request -Name 'server' -Default 'localhost'
    $zone   = Get-QueryParam -Request $Request -Name 'zone'
    $serverId = Get-QueryParam -Request $Request -Name 'serverId'
    $credentialMode = Get-QueryParam -Request $Request -Name 'credentialMode' -Default 'currentUser'

    try {
        if ($serverId) {
            $params = Resolve-ServerCredential -ServerId $serverId -CredentialMode $credentialMode -Hostname $server
        } else {
            $params = @{}
            if ($server -ne 'localhost' -and $server -ne $env:COMPUTERNAME) {
                $params['ComputerName'] = $server
            }
        }

        $policies = @()
        if ($zone) {
            $policies = @(Get-DnsServerQueryResolutionPolicy -ZoneName $zone @params -ErrorAction Stop |
                Select-Object Name, Action, ProcessingOrder, IsEnabled, Condition,
                    @{N='Level';E={'Zone'}},
                    @{N='ZoneName';E={$zone}})
        } else {
            # Get server-level policies
            $policies = @(Get-DnsServerQueryResolutionPolicy @params -ErrorAction Stop |
                Select-Object Name, Action, ProcessingOrder, IsEnabled, Condition,
                    @{N='Level';E={'Server'}},
                    @{N='ZoneName';E={$null}})
        }

        Send-Response -Response $Response -Body @{
            success  = $true
            policies = $policies
        }
    } catch {
        # No policies returns an error in some PS versions - treat as empty
        if ($_.Exception.Message -match 'not found|does not exist|no.*policy') {
            Send-Response -Response $Response -Body @{
                success  = $true
                policies = @()
            }
        } else {
            Send-Response -Response $Response -Body @{
                success = $false
                error   = $_.Exception.Message
            } -StatusCode 500
        }
    }
}

function Handle-CreatePolicy {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [psobject]$Body
    )

    try {
        if (-not $Body -or -not $Body.name) {
            Send-Response -Response $Response -Body @{
                success = $false
                error   = 'Policy name is required'
            } -StatusCode 400
            return
        }

        # Build splatted parameters to avoid command injection
        $splatParams = @{
            Name     = $Body.name
            Action   = if ($Body.action) { $Body.action } else { 'IGNORE' }
            PassThru = $true
        }

        if ($Body.zoneName) {
            $splatParams['ZoneName'] = $Body.zoneName
        }

        # Resolve credentials if serverId provided
        $serverId = if ($Body.serverId) { $Body.serverId } else { $null }
        $credentialMode = if ($Body.credentialMode) { $Body.credentialMode } else { 'currentUser' }
        $serverHost = if ($Body.server) { $Body.server } else { 'localhost' }

        if ($serverId) {
            $credParams = Resolve-ServerCredential -ServerId $serverId -CredentialMode $credentialMode -Hostname $serverHost
            foreach ($key in $credParams.Keys) {
                $splatParams[$key] = $credParams[$key]
            }
        } elseif ($Body.server -and $Body.server -ne 'localhost' -and $Body.server -ne $env:COMPUTERNAME) {
            $splatParams['ComputerName'] = $Body.server
        }

        if ($Body.processingOrder) {
            $splatParams['ProcessingOrder'] = [int]$Body.processingOrder
        }

        # Add criteria parameters
        if ($Body.criteria) {
            foreach ($c in $Body.criteria) {
                $paramName = $c.type
                $value = "$($c.operator),$($c.values -join ',')"
                $splatParams[$paramName] = $value
            }
        }

        # Add condition if multiple criteria
        if ($Body.criteria -and $Body.criteria.Count -gt 1 -and $Body.condition) {
            $splatParams['Condition'] = $Body.condition
        }

        # Add zone scopes
        if ($Body.action -eq 'ALLOW' -and $Body.scopes) {
            $scopeStr = ($Body.scopes | ForEach-Object { "$($_.name),$($_.weight)" }) -join ';'
            $splatParams['ZoneScope'] = $scopeStr
        }

        $result = Add-DnsServerQueryResolutionPolicy @splatParams -ErrorAction Stop

        Send-Response -Response $Response -Body @{
            success = $true
            policy  = @{
                Name            = $result.Name
                Action          = $result.Action
                ProcessingOrder = $result.ProcessingOrder
            }
        }
    } catch {
        Send-Response -Response $Response -Body @{
            success = $false
            error   = $_.Exception.Message
        } -StatusCode 500
    }
}

function Handle-DeletePolicy {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [System.Net.HttpListenerRequest]$Request,
        [string]$PolicyName
    )
    $server = Get-QueryParam -Request $Request -Name 'server' -Default 'localhost'
    $zone   = Get-QueryParam -Request $Request -Name 'zone'
    $serverId = Get-QueryParam -Request $Request -Name 'serverId'
    $credentialMode = Get-QueryParam -Request $Request -Name 'credentialMode' -Default 'currentUser'

    try {
        $params = @{
            Name  = $PolicyName
            Force = $true
        }

        if ($zone) {
            $params['ZoneName'] = $zone
        }

        if ($serverId) {
            $credParams = Resolve-ServerCredential -ServerId $serverId -CredentialMode $credentialMode -Hostname $server
            foreach ($key in $credParams.Keys) {
                $params[$key] = $credParams[$key]
            }
        } elseif ($server -ne 'localhost' -and $server -ne $env:COMPUTERNAME) {
            $params['ComputerName'] = $server
        }

        Remove-DnsServerQueryResolutionPolicy @params -ErrorAction Stop

        Send-Response -Response $Response -Body @{
            success = $true
            removed = $PolicyName
        }
    } catch {
        Send-Response -Response $Response -Body @{
            success = $false
            error   = $_.Exception.Message
        } -StatusCode 500
    }
}

function Handle-Backup {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [psobject]$Body
    )
    $server       = if ($Body -and $Body.server) { $Body.server } else { 'localhost' }
    $includeZone  = if ($Body -and $null -ne $Body.includeZone) { $Body.includeZone } else { $true }
    $includeServer = if ($Body -and $null -ne $Body.includeServer) { $Body.includeServer } else { $true }
    $serverId = if ($Body -and $Body.serverId) { $Body.serverId } else { $null }
    $credentialMode = if ($Body -and $Body.credentialMode) { $Body.credentialMode } else { 'currentUser' }

    try {
        if ($serverId) {
            $params = Resolve-ServerCredential -ServerId $serverId -CredentialMode $credentialMode -Hostname $server
        } else {
            $params = @{}
            if ($server -ne 'localhost' -and $server -ne $env:COMPUTERNAME) {
                $params['ComputerName'] = $server
            }
        }

        $allPolicies = @()

        # Server-level policies
        if ($includeServer) {
            try {
                $serverPolicies = @(Get-DnsServerQueryResolutionPolicy @params -ErrorAction Stop |
                    Select-Object Name, Action, ProcessingOrder, IsEnabled, Condition,
                        @{N='Level';E={'Server'}},
                        @{N='ZoneName';E={$null}})
                $allPolicies += $serverPolicies
            } catch {
                if ($_.Exception.Message -notmatch 'not found|does not exist|no.*policy') {
                    throw
                }
            }
        }

        # Zone-level policies
        if ($includeZone) {
            $zones = @(Get-DnsServerZone @params -ErrorAction Stop |
                Where-Object { -not $_.IsAutoCreated -and -not $_.IsReverseLookupZone })

            foreach ($z in $zones) {
                try {
                    $zonePolicies = @(Get-DnsServerQueryResolutionPolicy -ZoneName $z.ZoneName @params -ErrorAction Stop |
                        Select-Object Name, Action, ProcessingOrder, IsEnabled, Condition,
                            @{N='Level';E={'Zone'}},
                            @{N='ZoneName';E={$z.ZoneName}})
                    $allPolicies += $zonePolicies
                } catch {
                    # Zone might have no policies - skip
                    continue
                }
            }
        }

        Send-Response -Response $Response -Body @{
            success    = $true
            backup     = @{
                backupDate = (Get-Date -Format 'o')
                server     = $server
                version    = '1.0'
                policies   = $allPolicies
            }
        }
    } catch {
        Send-Response -Response $Response -Body @{
            success = $false
            error   = $_.Exception.Message
        } -StatusCode 500
    }
}

function Handle-Execute {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [psobject]$Body
    )

    if (-not $Body -or -not $Body.command) {
        Send-Response -Response $Response -Body @{
            success = $false
            error   = 'Command is required'
        } -StatusCode 400
        return
    }

    # Security: only allow DNS-related commands
    $command = $Body.command
    $allowedVerbs = @(
        'Get-DnsServer', 'Add-DnsServer', 'Remove-DnsServer', 'Set-DnsServer',
        'Get-DnsClientServerAddress', 'Test-NetConnection', 'Test-DnsServer',
        'Resolve-DnsName', 'Get-Service'
    )

    $isAllowed = $false
    foreach ($verb in $allowedVerbs) {
        if ($command -match "^\s*$([regex]::Escape($verb))") {
            $isAllowed = $true
            break
        }
    }

    if (-not $isAllowed) {
        Send-Response -Response $Response -Body @{
            success = $false
            error   = 'Command not allowed. Only DNS-related cmdlets are permitted.'
        } -StatusCode 403
        return
    }

    try {
        $output = Invoke-Expression $command 2>&1 | Out-String
        Send-Response -Response $Response -Body @{
            success = $true
            output  = $output
        }
    } catch {
        Send-Response -Response $Response -Body @{
            success = $false
            error   = $_.Exception.Message
        } -StatusCode 500
    }
}

# ── Router ───────────────────────────────────────────────────────────────────

function Route-Request {
    param(
        [System.Net.HttpListenerContext]$Context
    )
    $request  = $Context.Request
    $response = $Context.Response
    $method   = $request.HttpMethod
    $path     = $request.Url.LocalPath

    # Handle CORS preflight
    if ($method -eq 'OPTIONS') {
        Send-Preflight -Response $response
        return
    }

    Write-Log "$method $path"

    try {
        switch -Regex ($path) {
            '^/api/health$' {
                Handle-Health -Response $response
            }
            '^/api/connect$' {
                if ($method -eq 'POST') {
                    $body = Read-RequestBody -Request $request
                    Handle-Connect -Response $response -Body $body
                } else {
                    Send-Response -Response $response -Body @{ success = $false; error = 'Method not allowed' } -StatusCode 405
                }
            }
            '^/api/zones$' {
                Handle-GetZones -Response $response -Request $request
            }
            '^/api/credentials/store$' {
                if ($method -eq 'POST') {
                    $body = Read-RequestBody -Request $request
                    Handle-StoreCredential -Response $response -Body $body
                } else {
                    Send-Response -Response $response -Body @{ success = $false; error = 'Method not allowed' } -StatusCode 405
                }
            }
            '^/api/credentials/check$' {
                Handle-CheckCredential -Response $response -Request $request
            }
            '^/api/credentials/session$' {
                if ($method -eq 'POST') {
                    $body = Read-RequestBody -Request $request
                    Handle-SessionCredential -Response $response -Body $body
                } else {
                    Send-Response -Response $response -Body @{ success = $false; error = 'Method not allowed' } -StatusCode 405
                }
            }
            '^/api/credentials/([^/]+)$' {
                if ($method -eq 'DELETE') {
                    $serverId = [System.Uri]::UnescapeDataString($Matches[1])
                    Handle-DeleteCredential -Response $response -ServerId $serverId
                } else {
                    Send-Response -Response $response -Body @{ success = $false; error = 'Method not allowed' } -StatusCode 405
                }
            }
            '^/api/policies/multi$' {
                if ($method -eq 'POST') {
                    $body = Read-RequestBody -Request $request
                    Handle-PolicyMulti -Response $response -Body $body
                } else {
                    Send-Response -Response $response -Body @{ success = $false; error = 'Method not allowed' } -StatusCode 405
                }
            }
            '^/api/policies$' {
                switch ($method) {
                    'GET' {
                        Handle-GetPolicies -Response $response -Request $request
                    }
                    'POST' {
                        $body = Read-RequestBody -Request $request
                        Handle-CreatePolicy -Response $response -Body $body
                    }
                    default {
                        Send-Response -Response $response -Body @{ success = $false; error = 'Method not allowed' } -StatusCode 405
                    }
                }
            }
            '^/api/policies/(.+)$' {
                if ($method -eq 'DELETE') {
                    $policyName = [System.Uri]::UnescapeDataString($Matches[1])
                    Handle-DeletePolicy -Response $response -Request $request -PolicyName $policyName
                } else {
                    Send-Response -Response $response -Body @{ success = $false; error = 'Method not allowed' } -StatusCode 405
                }
            }
            '^/api/backup$' {
                if ($method -eq 'POST') {
                    $body = Read-RequestBody -Request $request
                    Handle-Backup -Response $response -Body $body
                } else {
                    Send-Response -Response $response -Body @{ success = $false; error = 'Method not allowed' } -StatusCode 405
                }
            }
            '^/api/execute$' {
                if ($method -eq 'POST') {
                    $body = Read-RequestBody -Request $request
                    Handle-Execute -Response $response -Body $body
                } else {
                    Send-Response -Response $response -Body @{ success = $false; error = 'Method not allowed' } -StatusCode 405
                }
            }
            default {
                Send-Response -Response $response -Body @{ success = $false; error = "Not found: $path" } -StatusCode 404
            }
        }
    } catch {
        Write-Log "Unhandled error: $($_.Exception.Message)" 'ERROR'
        try {
            Send-Response -Response $response -Body @{
                success = $false
                error   = "Internal server error: $($_.Exception.Message)"
            } -StatusCode 500
        } catch {
            # Response may already be closed
        }
    }
}

# ── Main ─────────────────────────────────────────────────────────────────────

$prefix = "http://127.0.0.1:${Port}/"
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($prefix)

try {
    $listener.Start()
    Write-Host ''
    Write-Host '  DNS Policy Manager - PowerShell Bridge' -ForegroundColor Cyan
    Write-Host "  Listening on $prefix" -ForegroundColor Green
    Write-Host "  DNS Module: $(if (Test-DnsModule) { 'Available' } else { 'Not Found' })" -ForegroundColor $(if (Test-DnsModule) { 'Green' } else { 'Yellow' })
    Write-Host '  Press Ctrl+C to stop' -ForegroundColor DarkGray
    Write-Host ''

    while ($listener.IsListening) {
        $context = $listener.GetContext()
        Route-Request -Context $context
    }
} catch [System.Net.HttpListenerException] {
    if ($_.Exception.ErrorCode -ne 995) {
        # 995 = operation aborted (Ctrl+C) - expected
        Write-Log "Listener error: $($_.Exception.Message)" 'ERROR'
    }
} finally {
    Write-Log 'Shutting down bridge...'
    if ($listener.IsListening) {
        $listener.Stop()
    }
    $listener.Close()
    Write-Log 'Bridge stopped.'
}
