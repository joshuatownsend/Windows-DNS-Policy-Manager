#Requires -Version 5.1
<#
.SYNOPSIS
    DNS Policy Manager - PowerShell HTTP Bridge
.DESCRIPTION
    Local HTTP bridge that exposes DNS Server cmdlets as REST API endpoints.
    Binds to 127.0.0.1 by default (port 8650) for security. Zero external dependencies.
    Use -BindAddress 0.0.0.0 to listen on all interfaces (required for Docker networking).
.NOTES
    Run with: powershell -ExecutionPolicy Bypass -File bridge.ps1
    Stop with: Ctrl+C
#>

param(
    [int]$Port = 8650,
    [string]$BindAddress = '127.0.0.1'
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
    $Response.Headers.Add('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
    $Response.Headers.Add('Access-Control-Allow-Headers', 'Content-Type')

    $Response.OutputStream.Write($buffer, 0, $buffer.Length)
    $Response.OutputStream.Close()
}

function Send-Preflight {
    param([System.Net.HttpListenerResponse]$Response)
    $Response.StatusCode = 204
    $Response.Headers.Add('Access-Control-Allow-Origin', '*')
    $Response.Headers.Add('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
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

function Handle-CopyPolicies {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [psobject]$Body
    )

    try {
        if (-not $Body -or -not $Body.sourceServer -or -not $Body.targetServers) {
            Send-Response -Response $Response -Body @{
                success = $false
                error   = 'sourceServer and targetServers are required'
            } -StatusCode 400
            return
        }

        $zone = if ($Body.zone) { $Body.zone } else { $null }
        $policyType = if ($Body.policyType) { $Body.policyType } else { 'QueryResolution' }
        $sourceServerId = if ($Body.sourceServerId) { $Body.sourceServerId } else { $null }
        $sourceCredMode = if ($Body.sourceCredentialMode) { $Body.sourceCredentialMode } else { 'currentUser' }

        # Build params for source server
        $getSplatParams = @{}
        if ($sourceServerId) {
            $credParams = Resolve-ServerCredential -ServerId $sourceServerId -CredentialMode $sourceCredMode -Hostname $Body.sourceServer
            foreach ($key in $credParams.Keys) { $getSplatParams[$key] = $credParams[$key] }
        } elseif ($Body.sourceServer -ne 'localhost' -and $Body.sourceServer -ne $env:COMPUTERNAME) {
            $getSplatParams['ComputerName'] = $Body.sourceServer
        }
        if ($zone) { $getSplatParams['ZoneName'] = $zone }

        # Get policies from source (returns empty array if none exist)
        if ($policyType -eq 'ZoneTransfer') {
            $policies = @(Get-DnsServerZoneTransferPolicy @getSplatParams -ErrorAction SilentlyContinue)
        } else {
            $policies = @(Get-DnsServerQueryResolutionPolicy @getSplatParams -ErrorAction SilentlyContinue)
        }

        $results = @()
        foreach ($targetObj in $Body.targetServers) {
            $targetHost = if ($targetObj.hostname) { $targetObj.hostname } else { $targetObj }
            $targetServerId = if ($targetObj.serverId) { $targetObj.serverId } else { $null }
            $targetCredMode = if ($targetObj.credentialMode) { $targetObj.credentialMode } else { 'currentUser' }

            try {
                $copiedCount = 0
                foreach ($policy in $policies) {
                    $addSplatParams = @{
                        Name            = $policy.Name
                        Action          = $policy.Action.ToString()
                        ProcessingOrder = $policy.ProcessingOrder
                    }

                    if ($targetServerId) {
                        $tCredParams = Resolve-ServerCredential -ServerId $targetServerId -CredentialMode $targetCredMode -Hostname $targetHost
                        foreach ($key in $tCredParams.Keys) { $addSplatParams[$key] = $tCredParams[$key] }
                    } elseif ($targetHost -ne 'localhost' -and $targetHost -ne $env:COMPUTERNAME) {
                        $addSplatParams['ComputerName'] = $targetHost
                    }

                    if ($zone) { $addSplatParams['ZoneName'] = $zone }
                    if ($policy.IsEnabled -eq $false) { $addSplatParams['IsEnabled'] = $false }
                    if ($policy.Condition) { $addSplatParams['Condition'] = $policy.Condition.ToString() }

                    # Recursion-specific fields (split-brain / recursion policies)
                    if ($policy.ApplyOnRecursion) { $addSplatParams['ApplyOnRecursion'] = $true }
                    if ($policy.RecursionScope) { $addSplatParams['RecursionScope'] = $policy.RecursionScope }

                    # Copy criteria
                    if ($policy.ClientSubnet) { $addSplatParams['ClientSubnet'] = $policy.ClientSubnet }
                    if ($policy.FQDN) { $addSplatParams['FQDN'] = $policy.FQDN }
                    if ($policy.ServerInterfaceIP) { $addSplatParams['ServerInterfaceIP'] = $policy.ServerInterfaceIP }
                    if ($policy.QType) { $addSplatParams['QType'] = $policy.QType }
                    if ($policy.TimeOfDay) { $addSplatParams['TimeOfDay'] = $policy.TimeOfDay }
                    if ($policy.TransportProtocol) { $addSplatParams['TransportProtocol'] = $policy.TransportProtocol }
                    if ($policy.InternetProtocol) { $addSplatParams['InternetProtocol'] = $policy.InternetProtocol }

                    # Copy zone scopes if present
                    if ($policy.ZoneScope) { $addSplatParams['ZoneScope'] = $policy.ZoneScope }

                    if ($policyType -eq 'ZoneTransfer') {
                        Add-DnsServerZoneTransferPolicy @addSplatParams -ErrorAction Stop
                    } else {
                        Add-DnsServerQueryResolutionPolicy @addSplatParams -ErrorAction Stop
                    }
                    $copiedCount++
                }

                $results += @{
                    hostname = $targetHost
                    success  = $true
                    copied   = $copiedCount
                }
            } catch {
                $results += @{
                    hostname = $targetHost
                    success  = $false
                    error    = $_.Exception.Message
                }
            }
        }

        Send-Response -Response $Response -Body @{
            success    = $true
            results    = $results
            totalFound = @($policies).Count
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

                if ($policy.action -eq 'ALLOW' -and $policy.scopes -and -not $policy.applyOnRecursion) {
                    $scopeStr = ($policy.scopes | ForEach-Object { "$($_.name),$($_.weight)" }) -join ';'
                    $splatParams['ZoneScope'] = $scopeStr
                }

                # Recursion policy support
                if ($policy.applyOnRecursion) {
                    $splatParams['ApplyOnRecursion'] = $true
                    if ($policy.recursionScope) {
                        $splatParams['RecursionScope'] = $policy.recursionScope
                    }
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

# ── Client Subnet Handlers ───────────────────────────────────────────────────

function Handle-GetSubnets {
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

        $subnets = @(Get-DnsServerClientSubnet @params -ErrorAction Stop |
            Select-Object Name, IPv4Subnet, IPv6Subnet)

        Send-Response -Response $Response -Body @{
            success = $true
            subnets = $subnets
        }
    } catch {
        if ($_.Exception.Message -match 'not found|does not exist|no.*subnet') {
            Send-Response -Response $Response -Body @{
                success = $true
                subnets = @()
            }
        } else {
            Send-Response -Response $Response -Body @{
                success = $false
                error   = $_.Exception.Message
            } -StatusCode 500
        }
    }
}

function Handle-CreateSubnet {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [psobject]$Body
    )

    try {
        if (-not $Body -or -not $Body.name) {
            Send-Response -Response $Response -Body @{
                success = $false
                error   = 'Subnet name is required'
            } -StatusCode 400
            return
        }

        $serverId = if ($Body.serverId) { $Body.serverId } else { $null }
        $credentialMode = if ($Body.credentialMode) { $Body.credentialMode } else { 'currentUser' }
        $serverHost = if ($Body.server) { $Body.server } else { 'localhost' }

        $splatParams = @{
            Name = $Body.name
        }

        if ($serverId) {
            $credParams = Resolve-ServerCredential -ServerId $serverId -CredentialMode $credentialMode -Hostname $serverHost
            foreach ($key in $credParams.Keys) {
                $splatParams[$key] = $credParams[$key]
            }
        } elseif ($serverHost -ne 'localhost' -and $serverHost -ne $env:COMPUTERNAME) {
            $splatParams['ComputerName'] = $serverHost
        }

        if ($Body.ipv4Subnet) {
            $splatParams['IPv4Subnet'] = @($Body.ipv4Subnet -split ',\s*')
        }
        if ($Body.ipv6Subnet) {
            $splatParams['IPv6Subnet'] = @($Body.ipv6Subnet -split ',\s*')
        }

        Add-DnsServerClientSubnet @splatParams -PassThru -ErrorAction Stop

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

function Handle-DeleteSubnet {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [System.Net.HttpListenerRequest]$Request,
        [string]$SubnetName
    )
    $server = Get-QueryParam -Request $Request -Name 'server' -Default 'localhost'
    $serverId = Get-QueryParam -Request $Request -Name 'serverId'
    $credentialMode = Get-QueryParam -Request $Request -Name 'credentialMode' -Default 'currentUser'

    try {
        $params = @{
            Name  = $SubnetName
            Force = $true
        }

        if ($serverId) {
            $credParams = Resolve-ServerCredential -ServerId $serverId -CredentialMode $credentialMode -Hostname $server
            foreach ($key in $credParams.Keys) {
                $params[$key] = $credParams[$key]
            }
        } elseif ($server -ne 'localhost' -and $server -ne $env:COMPUTERNAME) {
            $params['ComputerName'] = $server
        }

        Remove-DnsServerClientSubnet @params -ErrorAction Stop

        Send-Response -Response $Response -Body @{
            success = $true
            removed = $SubnetName
        }
    } catch {
        Send-Response -Response $Response -Body @{
            success = $false
            error   = $_.Exception.Message
        } -StatusCode 500
    }
}

# ── Zone Scope Handlers ──────────────────────────────────────────────────────

function Handle-GetZoneScopes {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [System.Net.HttpListenerRequest]$Request
    )
    $zone = Get-QueryParam -Request $Request -Name 'zone'
    $server = Get-QueryParam -Request $Request -Name 'server' -Default 'localhost'
    $serverId = Get-QueryParam -Request $Request -Name 'serverId'
    $credentialMode = Get-QueryParam -Request $Request -Name 'credentialMode' -Default 'currentUser'

    if (-not $zone) {
        Send-Response -Response $Response -Body @{
            success = $false
            error   = 'zone query parameter is required'
        } -StatusCode 400
        return
    }

    try {
        if ($serverId) {
            $params = Resolve-ServerCredential -ServerId $serverId -CredentialMode $credentialMode -Hostname $server
        } else {
            $params = @{}
            if ($server -ne 'localhost' -and $server -ne $env:COMPUTERNAME) {
                $params['ComputerName'] = $server
            }
        }

        $scopes = @(Get-DnsServerZoneScope -ZoneName $zone @params -ErrorAction Stop |
            Select-Object ZoneScope, FileName)

        Send-Response -Response $Response -Body @{
            success = $true
            scopes  = $scopes
        }
    } catch {
        if ($_.Exception.Message -match 'not found|does not exist') {
            Send-Response -Response $Response -Body @{
                success = $true
                scopes  = @()
            }
        } else {
            Send-Response -Response $Response -Body @{
                success = $false
                error   = $_.Exception.Message
            } -StatusCode 500
        }
    }
}

function Handle-CreateZoneScope {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [psobject]$Body
    )

    try {
        if (-not $Body -or -not $Body.zoneName -or -not $Body.name) {
            Send-Response -Response $Response -Body @{
                success = $false
                error   = 'zoneName and name are required'
            } -StatusCode 400
            return
        }

        $serverId = if ($Body.serverId) { $Body.serverId } else { $null }
        $credentialMode = if ($Body.credentialMode) { $Body.credentialMode } else { 'currentUser' }
        $serverHost = if ($Body.server) { $Body.server } else { 'localhost' }

        $splatParams = @{
            ZoneName = $Body.zoneName
            Name     = $Body.name
        }

        if ($serverId) {
            $credParams = Resolve-ServerCredential -ServerId $serverId -CredentialMode $credentialMode -Hostname $serverHost
            foreach ($key in $credParams.Keys) {
                $splatParams[$key] = $credParams[$key]
            }
        } elseif ($serverHost -ne 'localhost' -and $serverHost -ne $env:COMPUTERNAME) {
            $splatParams['ComputerName'] = $serverHost
        }

        Add-DnsServerZoneScope @splatParams -PassThru -ErrorAction Stop

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

function Handle-DeleteZoneScope {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [System.Net.HttpListenerRequest]$Request,
        [string]$ScopeName
    )
    $zone = Get-QueryParam -Request $Request -Name 'zone'
    $server = Get-QueryParam -Request $Request -Name 'server' -Default 'localhost'
    $serverId = Get-QueryParam -Request $Request -Name 'serverId'
    $credentialMode = Get-QueryParam -Request $Request -Name 'credentialMode' -Default 'currentUser'

    if (-not $zone) {
        Send-Response -Response $Response -Body @{
            success = $false
            error   = 'zone query parameter is required'
        } -StatusCode 400
        return
    }

    try {
        $params = @{
            ZoneName = $zone
            Name     = $ScopeName
            Force    = $true
        }

        if ($serverId) {
            $credParams = Resolve-ServerCredential -ServerId $serverId -CredentialMode $credentialMode -Hostname $server
            foreach ($key in $credParams.Keys) {
                $params[$key] = $credParams[$key]
            }
        } elseif ($server -ne 'localhost' -and $server -ne $env:COMPUTERNAME) {
            $params['ComputerName'] = $server
        }

        Remove-DnsServerZoneScope @params -ErrorAction Stop

        Send-Response -Response $Response -Body @{
            success = $true
            removed = $ScopeName
        }
    } catch {
        Send-Response -Response $Response -Body @{
            success = $false
            error   = $_.Exception.Message
        } -StatusCode 500
    }
}

function Handle-AddZoneScopeRecord {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [psobject]$Body
    )

    try {
        if (-not $Body -or -not $Body.zoneName -or -not $Body.scopeName -or -not $Body.recordName) {
            Send-Response -Response $Response -Body @{
                success = $false
                error   = 'zoneName, scopeName, and recordName are required'
            } -StatusCode 400
            return
        }

        $serverId = if ($Body.serverId) { $Body.serverId } else { $null }
        $credentialMode = if ($Body.credentialMode) { $Body.credentialMode } else { 'currentUser' }
        $serverHost = if ($Body.server) { $Body.server } else { 'localhost' }

        $splatParams = @{
            ZoneName  = $Body.zoneName
            ZoneScope = $Body.scopeName
            Name      = $Body.recordName
        }

        if ($serverId) {
            $credParams = Resolve-ServerCredential -ServerId $serverId -CredentialMode $credentialMode -Hostname $serverHost
            foreach ($key in $credParams.Keys) {
                $splatParams[$key] = $credParams[$key]
            }
        } elseif ($serverHost -ne 'localhost' -and $serverHost -ne $env:COMPUTERNAME) {
            $splatParams['ComputerName'] = $serverHost
        }

        $recordType = if ($Body.recordType) { $Body.recordType } else { 'A' }

        switch ($recordType) {
            'A' {
                $splatParams['A'] = $true
                $splatParams['IPv4Address'] = $Body.recordValue
            }
            'AAAA' {
                $splatParams['AAAA'] = $true
                $splatParams['IPv6Address'] = $Body.recordValue
            }
            'CNAME' {
                $splatParams['CName'] = $true
                $splatParams['HostNameAlias'] = $Body.recordValue
            }
        }

        # Optional TTL (in seconds)
        if ($Body.ttl -and [int]$Body.ttl -gt 0) {
            $splatParams['TimeToLive'] = [System.TimeSpan]::FromSeconds([int]$Body.ttl)
        }

        Add-DnsServerResourceRecord @splatParams -ErrorAction Stop

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

# ── Zone Detail & Record Handlers ────────────────────────────────────────────

function Handle-GetZoneDetails {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [System.Net.HttpListenerRequest]$Request,
        [string]$ZoneName
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

        $zone = Get-DnsServerZone -Name $ZoneName @params -ErrorAction Stop |
            Select-Object ZoneName, ZoneType, IsDsIntegrated, IsReverseLookupZone,
                IsSigned, DynamicUpdate, ReplicationScope, DirectoryPartitionName,
                ZoneFile, Notify, SecureSecondaries, MasterServers, IsAutoCreated

        Send-Response -Response $Response -Body @{
            success = $true
            zone    = $zone
        }
    } catch {
        Send-Response -Response $Response -Body @{
            success = $false
            error   = $_.Exception.Message
        } -StatusCode 500
    }
}

function Handle-GetZoneRecords {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [System.Net.HttpListenerRequest]$Request,
        [string]$ZoneName
    )
    $server = Get-QueryParam -Request $Request -Name 'server' -Default 'localhost'
    $serverId = Get-QueryParam -Request $Request -Name 'serverId'
    $credentialMode = Get-QueryParam -Request $Request -Name 'credentialMode' -Default 'currentUser'
    $typeFilter = Get-QueryParam -Request $Request -Name 'type'
    $nameFilter = Get-QueryParam -Request $Request -Name 'name'

    try {
        if ($serverId) {
            $params = Resolve-ServerCredential -ServerId $serverId -CredentialMode $credentialMode -Hostname $server
        } else {
            $params = @{}
            if ($server -ne 'localhost' -and $server -ne $env:COMPUTERNAME) {
                $params['ComputerName'] = $server
            }
        }

        $splatParams = @{ ZoneName = $ZoneName }
        foreach ($key in $params.Keys) { $splatParams[$key] = $params[$key] }

        if ($typeFilter) {
            $splatParams['RRType'] = $typeFilter
        }
        if ($nameFilter) {
            $splatParams['Name'] = $nameFilter
        }

        $rawRecords = @(Get-DnsServerResourceRecord @splatParams -ErrorAction Stop)

        $records = @($rawRecords | ForEach-Object {
            $rec = $_
            $data = ''
            $dataObj = @{}
            switch ($rec.RecordType) {
                'A' {
                    $data = $rec.RecordData.IPv4Address.IPAddressToString
                    $dataObj = @{ IPv4Address = $data }
                }
                'AAAA' {
                    $data = $rec.RecordData.IPv6Address.IPAddressToString
                    $dataObj = @{ IPv6Address = $data }
                }
                'CNAME' {
                    $data = $rec.RecordData.HostNameAlias
                    $dataObj = @{ HostNameAlias = $data }
                }
                'MX' {
                    $data = "$($rec.RecordData.MailExchange) (preference $($rec.RecordData.Preference))"
                    $dataObj = @{ MailExchange = $rec.RecordData.MailExchange; Preference = $rec.RecordData.Preference }
                }
                'SRV' {
                    $data = "$($rec.RecordData.DomainName) :$($rec.RecordData.Port) p=$($rec.RecordData.Priority) w=$($rec.RecordData.Weight)"
                    $dataObj = @{
                        DomainName = $rec.RecordData.DomainName
                        Port = $rec.RecordData.Port
                        Priority = $rec.RecordData.Priority
                        Weight = $rec.RecordData.Weight
                    }
                }
                'TXT' {
                    $data = ($rec.RecordData.DescriptiveText -join '; ')
                    $dataObj = @{ DescriptiveText = $rec.RecordData.DescriptiveText }
                }
                'NS' {
                    $data = $rec.RecordData.NameServer
                    $dataObj = @{ NameServer = $data }
                }
                'PTR' {
                    $data = $rec.RecordData.PtrDomainName
                    $dataObj = @{ PtrDomainName = $data }
                }
                'SOA' {
                    $data = "Primary=$($rec.RecordData.PrimaryServer) Admin=$($rec.RecordData.ResponsiblePerson) Serial=$($rec.RecordData.SerialNumber)"
                    $dataObj = @{
                        PrimaryServer = $rec.RecordData.PrimaryServer
                        ResponsiblePerson = $rec.RecordData.ResponsiblePerson
                        SerialNumber = $rec.RecordData.SerialNumber
                        RefreshInterval = $rec.RecordData.RefreshInterval.TotalSeconds
                        RetryDelay = $rec.RecordData.RetryDelay.TotalSeconds
                        ExpireLimit = $rec.RecordData.ExpireLimit.TotalSeconds
                        MinimumTimeToLive = $rec.RecordData.MinimumTimeToLive.TotalSeconds
                    }
                }
                default {
                    $data = $rec.RecordData.ToString()
                    $dataObj = @{}
                }
            }

            $ttlSeconds = 0
            if ($rec.TimeToLive) {
                $ttlSeconds = [int]$rec.TimeToLive.TotalSeconds
            }

            @{
                HostName   = $rec.HostName
                RecordType = [string]$rec.RecordType
                TTL        = $ttlSeconds
                Timestamp  = if ($rec.Timestamp) { $rec.Timestamp.ToString('o') } else { $null }
                Data       = $data
                RecordData = $dataObj
            }
        })

        Send-Response -Response $Response -Body @{
            success = $true
            records = $records
            count   = $records.Count
        }
    } catch {
        Send-Response -Response $Response -Body @{
            success = $false
            error   = $_.Exception.Message
        } -StatusCode 500
    }
}

function Handle-AddZoneRecord {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [psobject]$Body
    )

    try {
        if (-not $Body -or -not $Body.zoneName -or -not $Body.recordName -or -not $Body.recordType) {
            Send-Response -Response $Response -Body @{
                success = $false
                error   = 'zoneName, recordName, and recordType are required'
            } -StatusCode 400
            return
        }

        $serverId = if ($Body.serverId) { $Body.serverId } else { $null }
        $credentialMode = if ($Body.credentialMode) { $Body.credentialMode } else { 'currentUser' }
        $serverHost = if ($Body.server) { $Body.server } else { 'localhost' }

        $splatParams = @{
            ZoneName = $Body.zoneName
            Name     = $Body.recordName
        }

        if ($serverId) {
            $credParams = Resolve-ServerCredential -ServerId $serverId -CredentialMode $credentialMode -Hostname $serverHost
            foreach ($key in $credParams.Keys) { $splatParams[$key] = $credParams[$key] }
        } elseif ($serverHost -ne 'localhost' -and $serverHost -ne $env:COMPUTERNAME) {
            $splatParams['ComputerName'] = $serverHost
        }

        $rd = $Body.recordData

        switch ($Body.recordType) {
            'A' {
                $splatParams['A'] = $true
                $splatParams['IPv4Address'] = $rd.ipv4Address
            }
            'AAAA' {
                $splatParams['AAAA'] = $true
                $splatParams['IPv6Address'] = $rd.ipv6Address
            }
            'CNAME' {
                $splatParams['CName'] = $true
                $splatParams['HostNameAlias'] = $rd.hostNameAlias
            }
            'MX' {
                $splatParams['MX'] = $true
                $splatParams['MailExchange'] = $rd.mailExchange
                $splatParams['Preference'] = [int]$rd.preference
            }
            'SRV' {
                $splatParams['Srv'] = $true
                $splatParams['DomainName'] = $rd.domainName
                $splatParams['Priority'] = [int]$rd.priority
                $splatParams['Weight'] = [int]$rd.weight
                $splatParams['Port'] = [int]$rd.port
            }
            'TXT' {
                $splatParams['Txt'] = $true
                $splatParams['DescriptiveText'] = $rd.descriptiveText
            }
            'NS' {
                $splatParams['NS'] = $true
                $splatParams['NameServer'] = $rd.nameServer
            }
            'PTR' {
                $splatParams['Ptr'] = $true
                $splatParams['PtrDomainName'] = $rd.ptrDomainName
            }
            default {
                Send-Response -Response $Response -Body @{
                    success = $false
                    error   = "Unsupported record type: $($Body.recordType)"
                } -StatusCode 400
                return
            }
        }

        if ($Body.ttl -and [int]$Body.ttl -gt 0) {
            $splatParams['TimeToLive'] = [System.TimeSpan]::FromSeconds([int]$Body.ttl)
        }

        Add-DnsServerResourceRecord @splatParams -ErrorAction Stop

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

function Handle-RemoveZoneRecord {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [psobject]$Body,
        [string]$ZoneName
    )

    try {
        if (-not $Body -or -not $Body.recordName -or -not $Body.recordType) {
            Send-Response -Response $Response -Body @{
                success = $false
                error   = 'recordName and recordType are required'
            } -StatusCode 400
            return
        }

        $serverId = if ($Body.serverId) { $Body.serverId } else { $null }
        $credentialMode = if ($Body.credentialMode) { $Body.credentialMode } else { 'currentUser' }
        $serverHost = if ($Body.server) { $Body.server } else { 'localhost' }

        $fetchParams = @{ ZoneName = $ZoneName; RRType = $Body.recordType; Name = $Body.recordName }

        if ($serverId) {
            $credParams = Resolve-ServerCredential -ServerId $serverId -CredentialMode $credentialMode -Hostname $serverHost
            foreach ($key in $credParams.Keys) { $fetchParams[$key] = $credParams[$key] }
        } elseif ($serverHost -ne 'localhost' -and $serverHost -ne $env:COMPUTERNAME) {
            $fetchParams['ComputerName'] = $serverHost
        }

        $existing = @(Get-DnsServerResourceRecord @fetchParams -ErrorAction Stop)

        # Match the specific record by data
        $rd = $Body.recordData
        $target = $null
        foreach ($rec in $existing) {
            $match = $false
            switch ($Body.recordType) {
                'A'     { $match = ($rec.RecordData.IPv4Address.IPAddressToString -eq $rd.IPv4Address) }
                'AAAA'  { $match = ($rec.RecordData.IPv6Address.IPAddressToString -eq $rd.IPv6Address) }
                'CNAME' { $match = ($rec.RecordData.HostNameAlias -eq $rd.HostNameAlias) }
                'MX'    { $match = ($rec.RecordData.MailExchange -eq $rd.MailExchange -and $rec.RecordData.Preference -eq [int]$rd.Preference) }
                'SRV'   { $match = ($rec.RecordData.DomainName -eq $rd.DomainName -and $rec.RecordData.Port -eq [int]$rd.Port) }
                'TXT'   { $match = (($rec.RecordData.DescriptiveText -join '; ') -eq ($rd.DescriptiveText -join '; ')) }
                'NS'    { $match = ($rec.RecordData.NameServer -eq $rd.NameServer) }
                'PTR'   { $match = ($rec.RecordData.PtrDomainName -eq $rd.PtrDomainName) }
            }
            if ($match) { $target = $rec; break }
        }

        if (-not $target) {
            Send-Response -Response $Response -Body @{
                success = $false
                error   = 'Record not found matching the specified data'
            } -StatusCode 404
            return
        }

        $removeParams = @{ ZoneName = $ZoneName; InputObject = $target; Force = $true }
        if ($fetchParams.ContainsKey('ComputerName')) { $removeParams['ComputerName'] = $fetchParams['ComputerName'] }
        if ($fetchParams.ContainsKey('Credential'))   { $removeParams['Credential'] = $fetchParams['Credential'] }

        Remove-DnsServerResourceRecord @removeParams -ErrorAction Stop

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

function Handle-UpdateZoneRecord {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [psobject]$Body,
        [string]$ZoneName
    )

    try {
        if (-not $Body -or -not $Body.recordName -or -not $Body.recordType) {
            Send-Response -Response $Response -Body @{
                success = $false
                error   = 'recordName and recordType are required'
            } -StatusCode 400
            return
        }

        # Step 1: Delete old record
        $deleteBody = @{
            recordName     = $Body.recordName
            recordType     = $Body.recordType
            recordData     = $Body.oldRecordData
            server         = if ($Body.server) { $Body.server } else { 'localhost' }
            serverId       = if ($Body.serverId) { $Body.serverId } else { $null }
            credentialMode = if ($Body.credentialMode) { $Body.credentialMode } else { 'currentUser' }
        }
        # Reuse internal logic — build delete params manually
        $serverId = if ($Body.serverId) { $Body.serverId } else { $null }
        $credentialMode = if ($Body.credentialMode) { $Body.credentialMode } else { 'currentUser' }
        $serverHost = if ($Body.server) { $Body.server } else { 'localhost' }

        $fetchParams = @{ ZoneName = $ZoneName; RRType = $Body.recordType; Name = $Body.recordName }
        if ($serverId) {
            $credParams = Resolve-ServerCredential -ServerId $serverId -CredentialMode $credentialMode -Hostname $serverHost
            foreach ($key in $credParams.Keys) { $fetchParams[$key] = $credParams[$key] }
        } elseif ($serverHost -ne 'localhost' -and $serverHost -ne $env:COMPUTERNAME) {
            $fetchParams['ComputerName'] = $serverHost
        }

        $existing = @(Get-DnsServerResourceRecord @fetchParams -ErrorAction Stop)

        $oldRd = $Body.oldRecordData
        $oldTarget = $null
        foreach ($rec in $existing) {
            $match = $false
            switch ($Body.recordType) {
                'A'     { $match = ($rec.RecordData.IPv4Address.IPAddressToString -eq $oldRd.IPv4Address) }
                'AAAA'  { $match = ($rec.RecordData.IPv6Address.IPAddressToString -eq $oldRd.IPv6Address) }
                'CNAME' { $match = ($rec.RecordData.HostNameAlias -eq $oldRd.HostNameAlias) }
                'MX'    { $match = ($rec.RecordData.MailExchange -eq $oldRd.MailExchange -and $rec.RecordData.Preference -eq [int]$oldRd.Preference) }
                'SRV'   { $match = ($rec.RecordData.DomainName -eq $oldRd.DomainName -and $rec.RecordData.Port -eq [int]$oldRd.Port) }
                'TXT'   { $match = (($rec.RecordData.DescriptiveText -join '; ') -eq ($oldRd.DescriptiveText -join '; ')) }
                'NS'    { $match = ($rec.RecordData.NameServer -eq $oldRd.NameServer) }
                'PTR'   { $match = ($rec.RecordData.PtrDomainName -eq $oldRd.PtrDomainName) }
            }
            if ($match) { $oldTarget = $rec; break }
        }

        if (-not $oldTarget) {
            Send-Response -Response $Response -Body @{
                success = $false
                error   = 'Original record not found for update'
            } -StatusCode 404
            return
        }

        # Remove old record
        $removeParams = @{ ZoneName = $ZoneName; InputObject = $oldTarget; Force = $true }
        if ($fetchParams.ContainsKey('ComputerName')) { $removeParams['ComputerName'] = $fetchParams['ComputerName'] }
        if ($fetchParams.ContainsKey('Credential'))   { $removeParams['Credential'] = $fetchParams['Credential'] }

        Remove-DnsServerResourceRecord @removeParams -ErrorAction Stop

        # Step 2: Add new record
        $addParams = @{ ZoneName = $ZoneName; Name = $Body.recordName }
        if ($fetchParams.ContainsKey('ComputerName')) { $addParams['ComputerName'] = $fetchParams['ComputerName'] }
        if ($fetchParams.ContainsKey('Credential'))   { $addParams['Credential'] = $fetchParams['Credential'] }

        $newRd = $Body.newRecordData

        try {
            switch ($Body.recordType) {
                'A' {
                    $addParams['A'] = $true
                    $addParams['IPv4Address'] = $newRd.ipv4Address
                }
                'AAAA' {
                    $addParams['AAAA'] = $true
                    $addParams['IPv6Address'] = $newRd.ipv6Address
                }
                'CNAME' {
                    $addParams['CName'] = $true
                    $addParams['HostNameAlias'] = $newRd.hostNameAlias
                }
                'MX' {
                    $addParams['MX'] = $true
                    $addParams['MailExchange'] = $newRd.mailExchange
                    $addParams['Preference'] = [int]$newRd.preference
                }
                'SRV' {
                    $addParams['Srv'] = $true
                    $addParams['DomainName'] = $newRd.domainName
                    $addParams['Priority'] = [int]$newRd.priority
                    $addParams['Weight'] = [int]$newRd.weight
                    $addParams['Port'] = [int]$newRd.port
                }
                'TXT' {
                    $addParams['Txt'] = $true
                    $addParams['DescriptiveText'] = $newRd.descriptiveText
                }
                'NS' {
                    $addParams['NS'] = $true
                    $addParams['NameServer'] = $newRd.nameServer
                }
                'PTR' {
                    $addParams['Ptr'] = $true
                    $addParams['PtrDomainName'] = $newRd.ptrDomainName
                }
            }

            if ($Body.newTtl -and [int]$Body.newTtl -gt 0) {
                $addParams['TimeToLive'] = [System.TimeSpan]::FromSeconds([int]$Body.newTtl)
            }

            Add-DnsServerResourceRecord @addParams -ErrorAction Stop

            Send-Response -Response $Response -Body @{
                success = $true
            }
        } catch {
            # Rollback: re-add old record
            Write-Log "Update failed, rolling back: $($_.Exception.Message)" 'WARN'
            try {
                $rollbackParams = @{ ZoneName = $ZoneName; Name = $Body.recordName }
                if ($fetchParams.ContainsKey('ComputerName')) { $rollbackParams['ComputerName'] = $fetchParams['ComputerName'] }
                if ($fetchParams.ContainsKey('Credential'))   { $rollbackParams['Credential'] = $fetchParams['Credential'] }

                switch ($Body.recordType) {
                    'A' {
                        $rollbackParams['A'] = $true
                        $rollbackParams['IPv4Address'] = $oldRd.IPv4Address
                    }
                    'AAAA' {
                        $rollbackParams['AAAA'] = $true
                        $rollbackParams['IPv6Address'] = $oldRd.IPv6Address
                    }
                    'CNAME' {
                        $rollbackParams['CName'] = $true
                        $rollbackParams['HostNameAlias'] = $oldRd.HostNameAlias
                    }
                    'MX' {
                        $rollbackParams['MX'] = $true
                        $rollbackParams['MailExchange'] = $oldRd.MailExchange
                        $rollbackParams['Preference'] = [int]$oldRd.Preference
                    }
                    'SRV' {
                        $rollbackParams['Srv'] = $true
                        $rollbackParams['DomainName'] = $oldRd.DomainName
                        $rollbackParams['Priority'] = [int]$oldRd.Priority
                        $rollbackParams['Weight'] = [int]$oldRd.Weight
                        $rollbackParams['Port'] = [int]$oldRd.Port
                    }
                    'TXT' {
                        $rollbackParams['Txt'] = $true
                        $rollbackParams['DescriptiveText'] = $oldRd.DescriptiveText
                    }
                    'NS' {
                        $rollbackParams['NS'] = $true
                        $rollbackParams['NameServer'] = $oldRd.NameServer
                    }
                    'PTR' {
                        $rollbackParams['Ptr'] = $true
                        $rollbackParams['PtrDomainName'] = $oldRd.PtrDomainName
                    }
                }

                if ($oldTarget.TimeToLive) {
                    $rollbackParams['TimeToLive'] = $oldTarget.TimeToLive
                }

                Add-DnsServerResourceRecord @rollbackParams -ErrorAction Stop
                Write-Log "Rollback successful" 'INFO'
            } catch {
                Write-Log "Rollback also failed: $($_.Exception.Message)" 'ERROR'
            }

            Send-Response -Response $Response -Body @{
                success = $false
                error   = "Update failed: $($_.Exception.Message)"
            } -StatusCode 500
        }
    } catch {
        Send-Response -Response $Response -Body @{
            success = $false
            error   = $_.Exception.Message
        } -StatusCode 500
    }
}

function Handle-SetZoneSettings {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [psobject]$Body,
        [string]$ZoneName
    )

    try {
        if (-not $Body) {
            Send-Response -Response $Response -Body @{
                success = $false
                error   = 'Request body is required'
            } -StatusCode 400
            return
        }

        $serverId = if ($Body.serverId) { $Body.serverId } else { $null }
        $credentialMode = if ($Body.credentialMode) { $Body.credentialMode } else { 'currentUser' }
        $serverHost = if ($Body.server) { $Body.server } else { 'localhost' }

        $splatParams = @{ Name = $ZoneName }

        if ($serverId) {
            $credParams = Resolve-ServerCredential -ServerId $serverId -CredentialMode $credentialMode -Hostname $serverHost
            foreach ($key in $credParams.Keys) { $splatParams[$key] = $credParams[$key] }
        } elseif ($serverHost -ne 'localhost' -and $serverHost -ne $env:COMPUTERNAME) {
            $splatParams['ComputerName'] = $serverHost
        }

        if ($Body.dynamicUpdate) {
            $splatParams['DynamicUpdate'] = $Body.dynamicUpdate
        }
        if ($Body.replicationScope) {
            $splatParams['ReplicationScope'] = $Body.replicationScope
        }

        Set-DnsServerPrimaryZone @splatParams -ErrorAction Stop

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

# ── Recursion Scope Handlers ─────────────────────────────────────────────────

function Handle-GetRecursionScopes {
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

        $scopes = @(Get-DnsServerRecursionScope @params -ErrorAction Stop |
            Select-Object Name, EnableRecursion, Forwarder)

        Send-Response -Response $Response -Body @{
            success = $true
            scopes  = $scopes
        }
    } catch {
        if ($_.Exception.Message -match 'not found|does not exist') {
            Send-Response -Response $Response -Body @{
                success = $true
                scopes  = @()
            }
        } else {
            Send-Response -Response $Response -Body @{
                success = $false
                error   = $_.Exception.Message
            } -StatusCode 500
        }
    }
}

function Handle-CreateRecursionScope {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [psobject]$Body
    )

    try {
        if (-not $Body -or -not $Body.name) {
            Send-Response -Response $Response -Body @{
                success = $false
                error   = 'Recursion scope name is required'
            } -StatusCode 400
            return
        }

        $serverId = if ($Body.serverId) { $Body.serverId } else { $null }
        $credentialMode = if ($Body.credentialMode) { $Body.credentialMode } else { 'currentUser' }
        $serverHost = if ($Body.server) { $Body.server } else { 'localhost' }

        $splatParams = @{
            Name = $Body.name
        }

        if ($null -ne $Body.enableRecursion) {
            $splatParams['EnableRecursion'] = [bool]$Body.enableRecursion
        }

        if ($Body.forwarder) {
            $splatParams['Forwarder'] = @($Body.forwarder -split ',\s*')
        }

        if ($serverId) {
            $credParams = Resolve-ServerCredential -ServerId $serverId -CredentialMode $credentialMode -Hostname $serverHost
            foreach ($key in $credParams.Keys) {
                $splatParams[$key] = $credParams[$key]
            }
        } elseif ($serverHost -ne 'localhost' -and $serverHost -ne $env:COMPUTERNAME) {
            $splatParams['ComputerName'] = $serverHost
        }

        Add-DnsServerRecursionScope @splatParams -PassThru -ErrorAction Stop

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

function Handle-SetRecursionScope {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [psobject]$Body,
        [string]$ScopeName
    )

    try {
        $serverId = if ($Body.serverId) { $Body.serverId } else { $null }
        $credentialMode = if ($Body.credentialMode) { $Body.credentialMode } else { 'currentUser' }
        $serverHost = if ($Body.server) { $Body.server } else { 'localhost' }

        $splatParams = @{
            Name = $ScopeName
        }

        if ($null -ne $Body.enableRecursion) {
            $splatParams['EnableRecursion'] = [bool]$Body.enableRecursion
        }

        if ($Body.forwarder) {
            $splatParams['Forwarder'] = @($Body.forwarder -split ',\s*')
        }

        if ($serverId) {
            $credParams = Resolve-ServerCredential -ServerId $serverId -CredentialMode $credentialMode -Hostname $serverHost
            foreach ($key in $credParams.Keys) {
                $splatParams[$key] = $credParams[$key]
            }
        } elseif ($serverHost -ne 'localhost' -and $serverHost -ne $env:COMPUTERNAME) {
            $splatParams['ComputerName'] = $serverHost
        }

        Set-DnsServerRecursionScope @splatParams -PassThru -ErrorAction Stop

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

function Handle-DeleteRecursionScope {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [System.Net.HttpListenerRequest]$Request,
        [string]$ScopeName
    )
    $server = Get-QueryParam -Request $Request -Name 'server' -Default 'localhost'
    $serverId = Get-QueryParam -Request $Request -Name 'serverId'
    $credentialMode = Get-QueryParam -Request $Request -Name 'credentialMode' -Default 'currentUser'

    try {
        $params = @{
            Name  = $ScopeName
            Force = $true
        }

        if ($serverId) {
            $credParams = Resolve-ServerCredential -ServerId $serverId -CredentialMode $credentialMode -Hostname $server
            foreach ($key in $credParams.Keys) {
                $params[$key] = $credParams[$key]
            }
        } elseif ($server -ne 'localhost' -and $server -ne $env:COMPUTERNAME) {
            $params['ComputerName'] = $server
        }

        Remove-DnsServerRecursionScope @params -ErrorAction Stop

        Send-Response -Response $Response -Body @{
            success = $true
            removed = $ScopeName
        }
    } catch {
        Send-Response -Response $Response -Body @{
            success = $false
            error   = $_.Exception.Message
        } -StatusCode 500
    }
}

# ── Zone Transfer Policy Handlers ────────────────────────────────────────────

function Handle-GetZoneTransferPolicies {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [System.Net.HttpListenerRequest]$Request
    )
    $server = Get-QueryParam -Request $Request -Name 'server' -Default 'localhost'
    $zone = Get-QueryParam -Request $Request -Name 'zone'
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
            $policies = @(Get-DnsServerZoneTransferPolicy -ZoneName $zone @params -ErrorAction Stop |
                Select-Object Name, Action, ProcessingOrder, IsEnabled, Condition,
                    @{N='Level';E={'Zone'}},
                    @{N='ZoneName';E={$zone}})
        } else {
            $policies = @(Get-DnsServerZoneTransferPolicy @params -ErrorAction Stop |
                Select-Object Name, Action, ProcessingOrder, IsEnabled, Condition,
                    @{N='Level';E={'Server'}},
                    @{N='ZoneName';E={$null}})
        }

        Send-Response -Response $Response -Body @{
            success  = $true
            policies = $policies
        }
    } catch {
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

function Handle-CreateZoneTransferPolicy {
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

        $splatParams = @{
            Name     = $Body.name
            Action   = if ($Body.action) { $Body.action } else { 'DENY' }
            PassThru = $true
        }

        $serverId = if ($Body.serverId) { $Body.serverId } else { $null }
        $credentialMode = if ($Body.credentialMode) { $Body.credentialMode } else { 'currentUser' }
        $serverHost = if ($Body.server) { $Body.server } else { 'localhost' }

        if ($serverId) {
            $credParams = Resolve-ServerCredential -ServerId $serverId -CredentialMode $credentialMode -Hostname $serverHost
            foreach ($key in $credParams.Keys) {
                $splatParams[$key] = $credParams[$key]
            }
        } elseif ($serverHost -ne 'localhost' -and $serverHost -ne $env:COMPUTERNAME) {
            $splatParams['ComputerName'] = $serverHost
        }

        if ($Body.zoneName) {
            $splatParams['ZoneName'] = $Body.zoneName
        }

        if ($Body.processingOrder) {
            $splatParams['ProcessingOrder'] = [int]$Body.processingOrder
        }

        if ($Body.criteria) {
            foreach ($c in $Body.criteria) {
                $paramName = $c.type
                $value = "$($c.operator),$($c.values -join ',')"
                $splatParams[$paramName] = $value
            }
        }

        if ($Body.criteria -and $Body.criteria.Count -gt 1 -and $Body.condition) {
            $splatParams['Condition'] = $Body.condition
        }

        $result = Add-DnsServerZoneTransferPolicy @splatParams -ErrorAction Stop

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

function Handle-DeleteZoneTransferPolicy {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [System.Net.HttpListenerRequest]$Request,
        [string]$PolicyName
    )
    $server = Get-QueryParam -Request $Request -Name 'server' -Default 'localhost'
    $zone = Get-QueryParam -Request $Request -Name 'zone'
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

        Remove-DnsServerZoneTransferPolicy @params -ErrorAction Stop

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

# ── Policy State Handler ─────────────────────────────────────────────────────

function Handle-SetPolicyState {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [System.Net.HttpListenerRequest]$Request,
        [psobject]$Body,
        [string]$PolicyName
    )
    $server = Get-QueryParam -Request $Request -Name 'server' -Default 'localhost'
    $zone = Get-QueryParam -Request $Request -Name 'zone'
    $policyType = Get-QueryParam -Request $Request -Name 'type'
    $serverId = Get-QueryParam -Request $Request -Name 'serverId'
    $credentialMode = Get-QueryParam -Request $Request -Name 'credentialMode' -Default 'currentUser'

    try {
        $params = @{
            Name = $PolicyName
        }

        if ($null -ne $Body -and $null -ne $Body.isEnabled) {
            $params['IsEnabled'] = [string]$Body.isEnabled
        }

        if ($null -ne $Body -and $null -ne $Body.processingOrder) {
            $params['ProcessingOrder'] = [int]$Body.processingOrder
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

        if ($policyType -eq 'transfer') {
            Set-DnsServerZoneTransferPolicy @params -ErrorAction Stop
        } else {
            Set-DnsServerQueryResolutionPolicy @params -ErrorAction Stop
        }

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

# ── Route Handlers ───────────────────────────────────────────────────────────

# ── Server Configuration Handlers ─────────────────────────────────────────

function Resolve-ServerConfigParams {
    param([System.Net.HttpListenerRequest]$Request)
    $qs = $Request.QueryString
    $server = $qs['server']
    $serverId = $qs['serverId']
    $credentialMode = $qs['credentialMode']
    if ($serverId) {
        return Resolve-ServerCredential -ServerId $serverId -CredentialMode ($credentialMode ?? 'currentUser') -Hostname $server
    }
    $params = @{}
    if ($server -and $server -ne 'localhost' -and $server -ne $env:COMPUTERNAME) {
        $params['ComputerName'] = $server
    }
    return $params
}

function Handle-GetServerSettings {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [System.Net.HttpListenerRequest]$Request
    )
    try {
        $p = Resolve-ServerConfigParams -Request $Request
        $settings = Get-DnsServerSetting @p -ErrorAction Stop -All
        Send-Response -Response $Response -Body @{
            success  = $true
            settings = $settings
        }
    } catch {
        Send-Response -Response $Response -Body @{ success = $false; error = $_.Exception.Message } -StatusCode 500
    }
}

function Handle-SetServerSettings {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [System.Net.HttpListenerRequest]$Request,
        [psobject]$Body
    )
    try {
        $p = Resolve-ServerConfigParams -Request $Request
        $splatParams = @{}
        foreach ($key in $p.Keys) { $splatParams[$key] = $p[$key] }
        if ($null -ne $Body.RoundRobin) { $splatParams['RoundRobin'] = [bool]$Body.RoundRobin }
        if ($null -ne $Body.BindSecondaries) { $splatParams['BindSecondaries'] = [bool]$Body.BindSecondaries }
        if ($null -ne $Body.StrictFileParsing) { $splatParams['StrictFileParsing'] = [bool]$Body.StrictFileParsing }
        if ($null -ne $Body.LocalNetPriority) { $splatParams['LocalNetPriority'] = [bool]$Body.LocalNetPriority }
        if ($Body.ListeningIPAddress) { $splatParams['ListeningIPAddress'] = $Body.ListeningIPAddress }
        Set-DnsServerSetting @splatParams -ErrorAction Stop
        Send-Response -Response $Response -Body @{ success = $true }
    } catch {
        Send-Response -Response $Response -Body @{ success = $false; error = $_.Exception.Message } -StatusCode 500
    }
}

function Handle-GetForwarders {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [System.Net.HttpListenerRequest]$Request
    )
    try {
        $p = Resolve-ServerConfigParams -Request $Request
        $forwarders = Get-DnsServerForwarder @p -ErrorAction Stop
        Send-Response -Response $Response -Body @{
            success    = $true
            forwarders = $forwarders
        }
    } catch {
        Send-Response -Response $Response -Body @{ success = $false; error = $_.Exception.Message } -StatusCode 500
    }
}

function Handle-AddForwarder {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [System.Net.HttpListenerRequest]$Request,
        [psobject]$Body
    )
    try {
        $p = Resolve-ServerConfigParams -Request $Request
        $splatParams = @{ IPAddress = $Body.ipAddress }
        foreach ($key in $p.Keys) { $splatParams[$key] = $p[$key] }
        Add-DnsServerForwarder @splatParams -ErrorAction Stop
        Send-Response -Response $Response -Body @{ success = $true }
    } catch {
        Send-Response -Response $Response -Body @{ success = $false; error = $_.Exception.Message } -StatusCode 500
    }
}

function Handle-RemoveForwarder {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [System.Net.HttpListenerRequest]$Request,
        [psobject]$Body
    )
    try {
        $p = Resolve-ServerConfigParams -Request $Request
        $splatParams = @{ IPAddress = $Body.ipAddress }
        foreach ($key in $p.Keys) { $splatParams[$key] = $p[$key] }
        Remove-DnsServerForwarder @splatParams -Force -ErrorAction Stop
        Send-Response -Response $Response -Body @{ success = $true }
    } catch {
        Send-Response -Response $Response -Body @{ success = $false; error = $_.Exception.Message } -StatusCode 500
    }
}

function Handle-SetForwarders {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [System.Net.HttpListenerRequest]$Request,
        [psobject]$Body
    )
    try {
        $p = Resolve-ServerConfigParams -Request $Request
        $splatParams = @{}
        foreach ($key in $p.Keys) { $splatParams[$key] = $p[$key] }
        if ($Body.ipAddresses) { $splatParams['IPAddress'] = $Body.ipAddresses }
        if ($null -ne $Body.useRootHint) { $splatParams['UseRootHint'] = [bool]$Body.useRootHint }
        if ($Body.timeout) { $splatParams['Timeout'] = [int]$Body.timeout }
        Set-DnsServerForwarder @splatParams -ErrorAction Stop
        Send-Response -Response $Response -Body @{ success = $true }
    } catch {
        Send-Response -Response $Response -Body @{ success = $false; error = $_.Exception.Message } -StatusCode 500
    }
}

function Handle-GetCache {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [System.Net.HttpListenerRequest]$Request
    )
    try {
        $p = Resolve-ServerConfigParams -Request $Request
        $cache = Get-DnsServerCache @p -ErrorAction Stop
        Send-Response -Response $Response -Body @{
            success = $true
            cache   = $cache
        }
    } catch {
        Send-Response -Response $Response -Body @{ success = $false; error = $_.Exception.Message } -StatusCode 500
    }
}

function Handle-ClearCache {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [System.Net.HttpListenerRequest]$Request
    )
    try {
        $p = Resolve-ServerConfigParams -Request $Request
        Clear-DnsServerCache @p -Force -ErrorAction Stop
        Send-Response -Response $Response -Body @{ success = $true }
    } catch {
        Send-Response -Response $Response -Body @{ success = $false; error = $_.Exception.Message } -StatusCode 500
    }
}

function Handle-GetRecursionSettings {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [System.Net.HttpListenerRequest]$Request
    )
    try {
        $p = Resolve-ServerConfigParams -Request $Request
        $recursion = Get-DnsServerRecursion @p -ErrorAction Stop
        Send-Response -Response $Response -Body @{
            success   = $true
            recursion = $recursion
        }
    } catch {
        Send-Response -Response $Response -Body @{ success = $false; error = $_.Exception.Message } -StatusCode 500
    }
}

function Handle-SetRecursionSettings {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [System.Net.HttpListenerRequest]$Request,
        [psobject]$Body
    )
    try {
        $p = Resolve-ServerConfigParams -Request $Request
        $splatParams = @{}
        foreach ($key in $p.Keys) { $splatParams[$key] = $p[$key] }
        if ($null -ne $Body.enable) { $splatParams['Enable'] = [bool]$Body.enable }
        if ($Body.timeout) { $splatParams['Timeout'] = $Body.timeout }
        if ($null -ne $Body.additionalTimeout) { $splatParams['AdditionalTimeout'] = [int]$Body.additionalTimeout }
        if ($null -ne $Body.retries) { $splatParams['Retries'] = [int]$Body.retries }
        if ($null -ne $Body.secureResponse) { $splatParams['SecureResponse'] = [bool]$Body.secureResponse }
        Set-DnsServerRecursion @splatParams -ErrorAction Stop
        Send-Response -Response $Response -Body @{ success = $true }
    } catch {
        Send-Response -Response $Response -Body @{ success = $false; error = $_.Exception.Message } -StatusCode 500
    }
}

function Handle-GetBlockList {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [System.Net.HttpListenerRequest]$Request
    )
    try {
        $p = Resolve-ServerConfigParams -Request $Request
        $blocklist = Get-DnsServerGlobalQueryBlockList @p -ErrorAction Stop
        Send-Response -Response $Response -Body @{
            success   = $true
            blocklist = $blocklist
        }
    } catch {
        Send-Response -Response $Response -Body @{ success = $false; error = $_.Exception.Message } -StatusCode 500
    }
}

function Handle-SetBlockList {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [System.Net.HttpListenerRequest]$Request,
        [psobject]$Body
    )
    try {
        $p = Resolve-ServerConfigParams -Request $Request
        $splatParams = @{}
        foreach ($key in $p.Keys) { $splatParams[$key] = $p[$key] }
        if ($Body.list) { $splatParams['List'] = [string[]]$Body.list }
        if ($null -ne $Body.enable) { $splatParams['Enable'] = [bool]$Body.enable }
        Set-DnsServerGlobalQueryBlockList @splatParams -ErrorAction Stop
        Send-Response -Response $Response -Body @{ success = $true }
    } catch {
        Send-Response -Response $Response -Body @{ success = $false; error = $_.Exception.Message } -StatusCode 500
    }
}

function Handle-GetDiagnostics {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [System.Net.HttpListenerRequest]$Request
    )
    try {
        $p = Resolve-ServerConfigParams -Request $Request
        $diag = Get-DnsServerDiagnostics @p -ErrorAction Stop
        Send-Response -Response $Response -Body @{
            success     = $true
            diagnostics = $diag
        }
    } catch {
        Send-Response -Response $Response -Body @{ success = $false; error = $_.Exception.Message } -StatusCode 500
    }
}

function Handle-SetDiagnostics {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [System.Net.HttpListenerRequest]$Request,
        [psobject]$Body
    )
    try {
        $p = Resolve-ServerConfigParams -Request $Request
        $splatParams = @{}
        foreach ($key in $p.Keys) { $splatParams[$key] = $p[$key] }
        # Map common diagnostic toggles
        $toggles = @('Answers','EventLogLevel','FullPackets','Notifications',
                      'Queries','QuestionTransactions','ReceivePackets','SendPackets',
                      'TcpPackets','UdpPackets','UnmatchedResponse','Update','WriteThrough',
                      'EnableLogFileRollover','UseSystemEventLog','EnableLoggingToFile')
        foreach ($t in $toggles) {
            $camel = $t.Substring(0,1).ToLower() + $t.Substring(1)
            if ($null -ne $Body.$camel) { $splatParams[$t] = [bool]$Body.$camel }
        }
        if ($Body.logFilePath) { $splatParams['LogFilePath'] = $Body.logFilePath }
        if ($Body.maxMBFileSize) { $splatParams['MaxMBFileSize'] = [int]$Body.maxMBFileSize }
        Set-DnsServerDiagnostics @splatParams -ErrorAction Stop
        Send-Response -Response $Response -Body @{ success = $true }
    } catch {
        Send-Response -Response $Response -Body @{ success = $false; error = $_.Exception.Message } -StatusCode 500
    }
}

function Handle-GetStatistics {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [System.Net.HttpListenerRequest]$Request
    )
    try {
        $p = Resolve-ServerConfigParams -Request $Request
        $stats = Get-DnsServerStatistics @p -ErrorAction Stop
        Send-Response -Response $Response -Body @{
            success    = $true
            statistics = $stats
        }
    } catch {
        Send-Response -Response $Response -Body @{ success = $false; error = $_.Exception.Message } -StatusCode 500
    }
}

function Handle-ClearStatistics {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [System.Net.HttpListenerRequest]$Request
    )
    try {
        $p = Resolve-ServerConfigParams -Request $Request
        Clear-DnsServerStatistics @p -Force -ErrorAction Stop
        Send-Response -Response $Response -Body @{ success = $true }
    } catch {
        Send-Response -Response $Response -Body @{ success = $false; error = $_.Exception.Message } -StatusCode 500
    }
}

# ── RRL, Scavenging & Test Handlers ───────────────────────────────────────

function Handle-GetRRL {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [System.Net.HttpListenerRequest]$Request
    )
    try {
        $p = Resolve-ServerConfigParams -Request $Request
        $rrl = Get-DnsServerResponseRateLimiting @p -ErrorAction Stop
        Send-Response -Response $Response -Body @{ success = $true; rrl = $rrl }
    } catch {
        Send-Response -Response $Response -Body @{ success = $false; error = $_.Exception.Message } -StatusCode 500
    }
}

function Handle-SetRRL {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [System.Net.HttpListenerRequest]$Request,
        [psobject]$Body
    )
    try {
        $p = Resolve-ServerConfigParams -Request $Request
        $splatParams = @{}
        foreach ($key in $p.Keys) { $splatParams[$key] = $p[$key] }
        $intFields = @('ResponsesPerSec','ErrorsPerSec','WindowInSec','IPv4PrefixLength','IPv6PrefixLength',
                       'LeakRate','TruncateRate','MaximumResponsesPerWindow','TCRate')
        foreach ($f in $intFields) {
            $camel = $f.Substring(0,1).ToLower() + $f.Substring(1)
            if ($null -ne $Body.$camel) { $splatParams[$f] = [int]$Body.$camel }
        }
        if ($null -ne $Body.mode) { $splatParams['Mode'] = $Body.mode }
        Set-DnsServerResponseRateLimiting @splatParams -Force -ErrorAction Stop
        Send-Response -Response $Response -Body @{ success = $true }
    } catch {
        Send-Response -Response $Response -Body @{ success = $false; error = $_.Exception.Message } -StatusCode 500
    }
}

function Handle-GetRRLExceptions {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [System.Net.HttpListenerRequest]$Request
    )
    try {
        $p = Resolve-ServerConfigParams -Request $Request
        $exceptions = @(Get-DnsServerResponseRateLimitingExceptionlist @p -ErrorAction SilentlyContinue)
        Send-Response -Response $Response -Body @{ success = $true; exceptions = $exceptions }
    } catch {
        Send-Response -Response $Response -Body @{ success = $false; error = $_.Exception.Message } -StatusCode 500
    }
}

function Handle-AddRRLException {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [System.Net.HttpListenerRequest]$Request,
        [psobject]$Body
    )
    try {
        $p = Resolve-ServerConfigParams -Request $Request
        $splatParams = @{ Name = $Body.name }
        foreach ($key in $p.Keys) { $splatParams[$key] = $p[$key] }
        if ($Body.fqdn) { $splatParams['Fqdn'] = $Body.fqdn }
        if ($Body.clientSubnet) { $splatParams['ClientSubnet'] = $Body.clientSubnet }
        if ($Body.serverInterfaceIP) { $splatParams['ServerInterfaceIP'] = $Body.serverInterfaceIP }
        Add-DnsServerResponseRateLimitingExceptionlist @splatParams -ErrorAction Stop
        Send-Response -Response $Response -Body @{ success = $true }
    } catch {
        Send-Response -Response $Response -Body @{ success = $false; error = $_.Exception.Message } -StatusCode 500
    }
}

function Handle-RemoveRRLException {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [System.Net.HttpListenerRequest]$Request,
        [string]$Name
    )
    try {
        $p = Resolve-ServerConfigParams -Request $Request
        $splatParams = @{ Name = $Name }
        foreach ($key in $p.Keys) { $splatParams[$key] = $p[$key] }
        Remove-DnsServerResponseRateLimitingExceptionlist @splatParams -Force -ErrorAction Stop
        Send-Response -Response $Response -Body @{ success = $true }
    } catch {
        Send-Response -Response $Response -Body @{ success = $false; error = $_.Exception.Message } -StatusCode 500
    }
}

function Handle-GetScavenging {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [System.Net.HttpListenerRequest]$Request
    )
    try {
        $p = Resolve-ServerConfigParams -Request $Request
        $scav = Get-DnsServerScavenging @p -ErrorAction Stop
        Send-Response -Response $Response -Body @{ success = $true; scavenging = $scav }
    } catch {
        Send-Response -Response $Response -Body @{ success = $false; error = $_.Exception.Message } -StatusCode 500
    }
}

function Handle-SetScavenging {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [System.Net.HttpListenerRequest]$Request,
        [psobject]$Body
    )
    try {
        $p = Resolve-ServerConfigParams -Request $Request
        $splatParams = @{}
        foreach ($key in $p.Keys) { $splatParams[$key] = $p[$key] }
        if ($null -ne $Body.scavengingState) { $splatParams['ScavengingState'] = [bool]$Body.scavengingState }
        if ($Body.scavengingInterval) { $splatParams['ScavengingInterval'] = $Body.scavengingInterval }
        if ($Body.refreshInterval) { $splatParams['RefreshInterval'] = $Body.refreshInterval }
        if ($Body.noRefreshInterval) { $splatParams['NoRefreshInterval'] = $Body.noRefreshInterval }
        Set-DnsServerScavenging @splatParams -ErrorAction Stop
        Send-Response -Response $Response -Body @{ success = $true }
    } catch {
        Send-Response -Response $Response -Body @{ success = $false; error = $_.Exception.Message } -StatusCode 500
    }
}

function Handle-StartScavenging {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [System.Net.HttpListenerRequest]$Request
    )
    try {
        $p = Resolve-ServerConfigParams -Request $Request
        Start-DnsServerScavenging @p -Force -ErrorAction Stop
        Send-Response -Response $Response -Body @{ success = $true }
    } catch {
        Send-Response -Response $Response -Body @{ success = $false; error = $_.Exception.Message } -StatusCode 500
    }
}

function Handle-TestDnsServer {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [System.Net.HttpListenerRequest]$Request
    )
    try {
        $p = Resolve-ServerConfigParams -Request $Request
        $result = Test-DnsServer @p -ErrorAction Stop
        Send-Response -Response $Response -Body @{ success = $true; result = $result }
    } catch {
        Send-Response -Response $Response -Body @{ success = $false; error = $_.Exception.Message } -StatusCode 500
    }
}

# ── BPA & DoH Handlers ────────────────────────────────────────────────────

function Handle-RunBpa {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [System.Net.HttpListenerRequest]$Request
    )
    try {
        $p = Resolve-ServerConfigParams -Request $Request
        $modelId = 'Microsoft/Windows/DNSServer'

        # Invoke the BPA model
        try {
            Invoke-BpaModel -ModelId $modelId @p -ErrorAction Stop | Out-Null
        } catch {
            # BPA model may not be available on all systems
            Send-Response -Response $Response -Body @{
                success = $false
                error   = "BPA model not available: $($_.Exception.Message). Ensure the DNS Server role is installed."
            } -StatusCode 500
            return
        }

        # Get results
        $results = @(Get-BpaResult -ModelId $modelId @p -ErrorAction Stop)

        # Categorize
        $findings = $results | ForEach-Object {
            @{
                Severity    = $_.Severity.ToString()
                Category    = $_.Category.ToString()
                Title       = $_.Title
                Problem     = $_.Problem
                Impact      = $_.Impact
                Resolution  = $_.Resolution
                Compliance  = $_.Compliance.ToString()
                Source      = $_.Source
                ResultId    = $_.ResultId
            }
        }

        $summary = @{
            errors      = @($findings | Where-Object { $_.Severity -eq 'Error' }).Count
            warnings    = @($findings | Where-Object { $_.Severity -eq 'Warning' }).Count
            information = @($findings | Where-Object { $_.Severity -eq 'Information' }).Count
        }

        Send-Response -Response $Response -Body @{
            success  = $true
            findings = $findings
            summary  = $summary
            scannedAt = (Get-Date -Format 'o')
        }
    } catch {
        Send-Response -Response $Response -Body @{ success = $false; error = $_.Exception.Message } -StatusCode 500
    }
}

function Handle-GetEncryptionProtocol {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [System.Net.HttpListenerRequest]$Request
    )
    try {
        $p = Resolve-ServerConfigParams -Request $Request
        $proto = Get-DnsServerEncryptionProtocol @p -ErrorAction Stop
        Send-Response -Response $Response -Body @{ success = $true; protocol = $proto }
    } catch {
        # Server 2025+ only — graceful fallback
        if ($_.Exception.Message -match 'not recognized|CommandNotFoundException') {
            Send-Response -Response $Response -Body @{
                success = $false
                error   = 'Get-DnsServerEncryptionProtocol is not available on this server version (requires Server 2025+).'
                unsupported = $true
            }
        } else {
            Send-Response -Response $Response -Body @{ success = $false; error = $_.Exception.Message } -StatusCode 500
        }
    }
}

function Handle-SetEncryptionProtocol {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [System.Net.HttpListenerRequest]$Request,
        [psobject]$Body
    )
    try {
        $p = Resolve-ServerConfigParams -Request $Request
        $splatParams = @{}
        foreach ($key in $p.Keys) { $splatParams[$key] = $p[$key] }
        if ($null -ne $Body.dohEnabled) { $splatParams['DohEnabled'] = [bool]$Body.dohEnabled }
        if ($null -ne $Body.dotEnabled) { $splatParams['DotEnabled'] = [bool]$Body.dotEnabled }
        if ($Body.certificateSubjectName) { $splatParams['CertificateSubjectName'] = $Body.certificateSubjectName }
        Set-DnsServerEncryptionProtocol @splatParams -ErrorAction Stop
        Send-Response -Response $Response -Body @{ success = $true }
    } catch {
        Send-Response -Response $Response -Body @{ success = $false; error = $_.Exception.Message } -StatusCode 500
    }
}

# ── DNSSEC Handlers ───────────────────────────────────────────────────────

function Handle-GetDnssecSettings {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [System.Net.HttpListenerRequest]$Request,
        [string]$ZoneName
    )
    try {
        $p = Resolve-ServerConfigParams -Request $Request
        $splatParams = @{ ZoneName = $ZoneName }
        foreach ($key in $p.Keys) { $splatParams[$key] = $p[$key] }
        $settings = Get-DnsServerDnsSecZoneSetting @splatParams -ErrorAction Stop
        Send-Response -Response $Response -Body @{ success = $true; settings = $settings }
    } catch {
        Send-Response -Response $Response -Body @{ success = $false; error = $_.Exception.Message } -StatusCode 500
    }
}

function Handle-SetDnssecSettings {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [System.Net.HttpListenerRequest]$Request,
        [string]$ZoneName,
        [psobject]$Body
    )
    try {
        $p = Resolve-ServerConfigParams -Request $Request
        $splatParams = @{ ZoneName = $ZoneName }
        foreach ($key in $p.Keys) { $splatParams[$key] = $p[$key] }
        if ($Body.nsecMode) { $splatParams['NSec3OptOut'] = ($Body.nsecMode -eq 'NSec3OptOut') }
        if ($null -ne $Body.isKeyMasterServer) { $splatParams['IsKeyMasterServer'] = [bool]$Body.isKeyMasterServer }
        if ($Body.distributeTrustAnchor) { $splatParams['DistributeTrustAnchor'] = $Body.distributeTrustAnchor }
        Set-DnsServerDnsSecZoneSetting @splatParams -ErrorAction Stop
        Send-Response -Response $Response -Body @{ success = $true }
    } catch {
        Send-Response -Response $Response -Body @{ success = $false; error = $_.Exception.Message } -StatusCode 500
    }
}

function Handle-GetSigningKeys {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [System.Net.HttpListenerRequest]$Request,
        [string]$ZoneName
    )
    try {
        $p = Resolve-ServerConfigParams -Request $Request
        $splatParams = @{ ZoneName = $ZoneName }
        foreach ($key in $p.Keys) { $splatParams[$key] = $p[$key] }
        $keys = @(Get-DnsServerSigningKey @splatParams -ErrorAction SilentlyContinue)
        Send-Response -Response $Response -Body @{ success = $true; keys = $keys }
    } catch {
        Send-Response -Response $Response -Body @{ success = $false; error = $_.Exception.Message } -StatusCode 500
    }
}

function Handle-AddSigningKey {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [System.Net.HttpListenerRequest]$Request,
        [string]$ZoneName,
        [psobject]$Body
    )
    try {
        $p = Resolve-ServerConfigParams -Request $Request
        $splatParams = @{ ZoneName = $ZoneName }
        foreach ($key in $p.Keys) { $splatParams[$key] = $p[$key] }
        if ($Body.keyType) { $splatParams['Type'] = $Body.keyType }  # KeySigningKey or ZoneSigningKey
        if ($Body.cryptoAlgorithm) { $splatParams['CryptoAlgorithm'] = $Body.cryptoAlgorithm }
        if ($Body.keyLength) { $splatParams['KeyLength'] = [int]$Body.keyLength }
        Add-DnsServerSigningKey @splatParams -ErrorAction Stop
        Send-Response -Response $Response -Body @{ success = $true }
    } catch {
        Send-Response -Response $Response -Body @{ success = $false; error = $_.Exception.Message } -StatusCode 500
    }
}

function Handle-RemoveSigningKey {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [System.Net.HttpListenerRequest]$Request,
        [string]$ZoneName,
        [string]$KeyId
    )
    try {
        $p = Resolve-ServerConfigParams -Request $Request
        $splatParams = @{ ZoneName = $ZoneName; KeyId = [guid]$KeyId }
        foreach ($key in $p.Keys) { $splatParams[$key] = $p[$key] }
        Remove-DnsServerSigningKey @splatParams -Force -ErrorAction Stop
        Send-Response -Response $Response -Body @{ success = $true }
    } catch {
        Send-Response -Response $Response -Body @{ success = $false; error = $_.Exception.Message } -StatusCode 500
    }
}

function Handle-SignZone {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [System.Net.HttpListenerRequest]$Request,
        [string]$ZoneName
    )
    try {
        $p = Resolve-ServerConfigParams -Request $Request
        $splatParams = @{ ZoneName = $ZoneName }
        foreach ($key in $p.Keys) { $splatParams[$key] = $p[$key] }
        Invoke-DnsServerZoneSign @splatParams -Force -ErrorAction Stop
        Send-Response -Response $Response -Body @{ success = $true }
    } catch {
        Send-Response -Response $Response -Body @{ success = $false; error = $_.Exception.Message } -StatusCode 500
    }
}

function Handle-UnsignZone {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [System.Net.HttpListenerRequest]$Request,
        [string]$ZoneName
    )
    try {
        $p = Resolve-ServerConfigParams -Request $Request
        $splatParams = @{ ZoneName = $ZoneName }
        foreach ($key in $p.Keys) { $splatParams[$key] = $p[$key] }
        Invoke-DnsServerZoneUnsign @splatParams -Force -ErrorAction Stop
        Send-Response -Response $Response -Body @{ success = $true }
    } catch {
        Send-Response -Response $Response -Body @{ success = $false; error = $_.Exception.Message } -StatusCode 500
    }
}

function Handle-ExportDnssecKey {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [System.Net.HttpListenerRequest]$Request,
        [string]$ZoneName
    )
    try {
        $p = Resolve-ServerConfigParams -Request $Request
        $splatParams = @{ ZoneName = $ZoneName }
        foreach ($key in $p.Keys) { $splatParams[$key] = $p[$key] }
        $result = Export-DnsServerDnsSecPublicKey @splatParams -ErrorAction Stop
        Send-Response -Response $Response -Body @{ success = $true; publicKey = $result }
    } catch {
        Send-Response -Response $Response -Body @{ success = $false; error = $_.Exception.Message } -StatusCode 500
    }
}

function Handle-GetTrustAnchors {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [System.Net.HttpListenerRequest]$Request
    )
    try {
        $p = Resolve-ServerConfigParams -Request $Request
        $anchors = @(Get-DnsServerTrustAnchor @p -Name '.' -ErrorAction SilentlyContinue)
        Send-Response -Response $Response -Body @{ success = $true; anchors = $anchors }
    } catch {
        Send-Response -Response $Response -Body @{ success = $false; error = $_.Exception.Message } -StatusCode 500
    }
}

function Handle-AddTrustAnchor {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [System.Net.HttpListenerRequest]$Request,
        [psobject]$Body
    )
    try {
        $p = Resolve-ServerConfigParams -Request $Request
        $splatParams = @{ Name = $Body.name }
        foreach ($key in $p.Keys) { $splatParams[$key] = $p[$key] }
        if ($Body.keyTag) { $splatParams['KeyTag'] = [int]$Body.keyTag }
        if ($Body.cryptoAlgorithm) { $splatParams['CryptoAlgorithm'] = $Body.cryptoAlgorithm }
        if ($Body.digestType) { $splatParams['DigestType'] = $Body.digestType }
        if ($Body.digest) { $splatParams['Digest'] = $Body.digest }
        Add-DnsServerTrustAnchor @splatParams -ErrorAction Stop
        Send-Response -Response $Response -Body @{ success = $true }
    } catch {
        Send-Response -Response $Response -Body @{ success = $false; error = $_.Exception.Message } -StatusCode 500
    }
}

function Handle-RemoveTrustAnchor {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [System.Net.HttpListenerRequest]$Request,
        [string]$Name
    )
    try {
        $p = Resolve-ServerConfigParams -Request $Request
        $splatParams = @{ Name = $Name }
        foreach ($key in $p.Keys) { $splatParams[$key] = $p[$key] }
        Remove-DnsServerTrustAnchor @splatParams -Force -ErrorAction Stop
        Send-Response -Response $Response -Body @{ success = $true }
    } catch {
        Send-Response -Response $Response -Body @{ success = $false; error = $_.Exception.Message } -StatusCode 500
    }
}

function Handle-GetTrustPoints {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [System.Net.HttpListenerRequest]$Request
    )
    try {
        $p = Resolve-ServerConfigParams -Request $Request
        $points = @(Get-DnsServerTrustPoint @p -ErrorAction SilentlyContinue)
        Send-Response -Response $Response -Body @{ success = $true; points = $points }
    } catch {
        Send-Response -Response $Response -Body @{ success = $false; error = $_.Exception.Message } -StatusCode 500
    }
}

function Handle-UpdateTrustPoint {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [System.Net.HttpListenerRequest]$Request,
        [string]$Name
    )
    try {
        $p = Resolve-ServerConfigParams -Request $Request
        $splatParams = @{ Name = $Name }
        foreach ($key in $p.Keys) { $splatParams[$key] = $p[$key] }
        Update-DnsServerTrustPoint @splatParams -Force -ErrorAction Stop
        Send-Response -Response $Response -Body @{ success = $true }
    } catch {
        Send-Response -Response $Response -Body @{ success = $false; error = $_.Exception.Message } -StatusCode 500
    }
}

# ── Niche Feature Handlers ─────────────────────────────────────────────────

function Handle-GetRootHints {
    param([System.Net.HttpListenerResponse]$Response, [System.Net.HttpListenerRequest]$Request)
    try {
        $p = Resolve-ServerConfigParams -Request $Request
        $hints = @(Get-DnsServerRootHint @p -ErrorAction SilentlyContinue)
        Send-Response -Response $Response -Body @{ success = $true; rootHints = $hints }
    } catch {
        Send-Response -Response $Response -Body @{ success = $false; error = $_.Exception.Message } -StatusCode 500
    }
}

function Handle-GetEDns {
    param([System.Net.HttpListenerResponse]$Response, [System.Net.HttpListenerRequest]$Request)
    try {
        $p = Resolve-ServerConfigParams -Request $Request
        $edns = Get-DnsServerEDns @p -ErrorAction Stop
        Send-Response -Response $Response -Body @{ success = $true; edns = $edns }
    } catch {
        Send-Response -Response $Response -Body @{ success = $false; error = $_.Exception.Message } -StatusCode 500
    }
}

function Handle-SetEDns {
    param([System.Net.HttpListenerResponse]$Response, [System.Net.HttpListenerRequest]$Request, [psobject]$Body)
    try {
        $p = Resolve-ServerConfigParams -Request $Request
        $splatParams = @{}
        foreach ($key in $p.Keys) { $splatParams[$key] = $p[$key] }
        if ($null -ne $Body.enableReception) { $splatParams['EnableReception'] = [bool]$Body.enableReception }
        if ($null -ne $Body.enableProbes) { $splatParams['EnableProbes'] = [bool]$Body.enableProbes }
        if ($Body.cacheTimeout) { $splatParams['CacheTimeout'] = $Body.cacheTimeout }
        Set-DnsServerEDns @splatParams -ErrorAction Stop
        Send-Response -Response $Response -Body @{ success = $true }
    } catch {
        Send-Response -Response $Response -Body @{ success = $false; error = $_.Exception.Message } -StatusCode 500
    }
}

function Handle-GetDsSetting {
    param([System.Net.HttpListenerResponse]$Response, [System.Net.HttpListenerRequest]$Request)
    try {
        $p = Resolve-ServerConfigParams -Request $Request
        $ds = Get-DnsServerDsSetting @p -ErrorAction Stop
        Send-Response -Response $Response -Body @{ success = $true; dsSetting = $ds }
    } catch {
        Send-Response -Response $Response -Body @{ success = $false; error = $_.Exception.Message } -StatusCode 500
    }
}

function Handle-GetGlobalNameZone {
    param([System.Net.HttpListenerResponse]$Response, [System.Net.HttpListenerRequest]$Request)
    try {
        $p = Resolve-ServerConfigParams -Request $Request
        $gnz = Get-DnsServerGlobalNameZone @p -ErrorAction Stop
        Send-Response -Response $Response -Body @{ success = $true; globalNameZone = $gnz }
    } catch {
        Send-Response -Response $Response -Body @{ success = $false; error = $_.Exception.Message } -StatusCode 500
    }
}

function Handle-SetGlobalNameZone {
    param([System.Net.HttpListenerResponse]$Response, [System.Net.HttpListenerRequest]$Request, [psobject]$Body)
    try {
        $p = Resolve-ServerConfigParams -Request $Request
        $splatParams = @{}
        foreach ($key in $p.Keys) { $splatParams[$key] = $p[$key] }
        if ($null -ne $Body.enable) { $splatParams['Enable'] = [bool]$Body.enable }
        Set-DnsServerGlobalNameZone @splatParams -ErrorAction Stop
        Send-Response -Response $Response -Body @{ success = $true }
    } catch {
        Send-Response -Response $Response -Body @{ success = $false; error = $_.Exception.Message } -StatusCode 500
    }
}

function Handle-GetZoneDelegation {
    param([System.Net.HttpListenerResponse]$Response, [System.Net.HttpListenerRequest]$Request, [string]$ZoneName)
    try {
        $p = Resolve-ServerConfigParams -Request $Request
        $splatParams = @{ Name = $ZoneName }
        foreach ($key in $p.Keys) { $splatParams[$key] = $p[$key] }
        $delegations = @(Get-DnsServerZoneDelegation @splatParams -ErrorAction SilentlyContinue)
        Send-Response -Response $Response -Body @{ success = $true; delegations = $delegations }
    } catch {
        Send-Response -Response $Response -Body @{ success = $false; error = $_.Exception.Message } -StatusCode 500
    }
}

# ── Core Handlers ─────────────────────────────────────────────────────────

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

# ── Zone Lifecycle Handlers ────────────────────────────────────────────────

function Handle-CreateZone {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [psobject]$Body
    )
    try {
        $p = @{}
        if ($Body.server) {
            if ($Body.serverId) {
                $p = Resolve-ServerCredential -ServerId $Body.serverId -CredentialMode ($Body.credentialMode ?? 'currentUser') -Hostname $Body.server
            } elseif ($Body.server -ne 'localhost' -and $Body.server -ne $env:COMPUTERNAME) {
                $p['ComputerName'] = $Body.server
            }
        }
        $zoneType = $Body.zoneType  # 'Primary', 'Secondary', 'Stub', 'ConditionalForwarder'
        switch ($zoneType) {
            'Primary' {
                $splatParams = @{ Name = $Body.zoneName }
                foreach ($key in $p.Keys) { $splatParams[$key] = $p[$key] }
                if ($Body.replicationScope) {
                    $splatParams['ReplicationScope'] = $Body.replicationScope
                } elseif ($Body.zoneFile) {
                    $splatParams['ZoneFile'] = $Body.zoneFile
                }
                if ($Body.dynamicUpdate) { $splatParams['DynamicUpdate'] = $Body.dynamicUpdate }
                Add-DnsServerPrimaryZone @splatParams -ErrorAction Stop
            }
            'Secondary' {
                $splatParams = @{
                    Name          = $Body.zoneName
                    ZoneFile      = ($Body.zoneFile ?? "$($Body.zoneName).dns")
                    MasterServers = [string[]]$Body.masterServers
                }
                foreach ($key in $p.Keys) { $splatParams[$key] = $p[$key] }
                Add-DnsServerSecondaryZone @splatParams -ErrorAction Stop
            }
            'Stub' {
                $splatParams = @{
                    Name          = $Body.zoneName
                    MasterServers = [string[]]$Body.masterServers
                }
                foreach ($key in $p.Keys) { $splatParams[$key] = $p[$key] }
                if ($Body.replicationScope) {
                    $splatParams['ReplicationScope'] = $Body.replicationScope
                } else {
                    $splatParams['ZoneFile'] = ($Body.zoneFile ?? "$($Body.zoneName).dns")
                }
                Add-DnsServerStubZone @splatParams -ErrorAction Stop
            }
            'ConditionalForwarder' {
                $splatParams = @{
                    Name          = $Body.zoneName
                    MasterServers = [string[]]$Body.masterServers
                }
                foreach ($key in $p.Keys) { $splatParams[$key] = $p[$key] }
                if ($Body.replicationScope) { $splatParams['ReplicationScope'] = $Body.replicationScope }
                Add-DnsServerConditionalForwarderZone @splatParams -ErrorAction Stop
            }
            default {
                Send-Response -Response $Response -Body @{ success = $false; error = "Unknown zone type: $zoneType" } -StatusCode 400
                return
            }
        }
        Send-Response -Response $Response -Body @{ success = $true }
    } catch {
        Send-Response -Response $Response -Body @{ success = $false; error = $_.Exception.Message } -StatusCode 500
    }
}

function Handle-RemoveZone {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [System.Net.HttpListenerRequest]$Request,
        [string]$ZoneName
    )
    try {
        $p = Resolve-ServerConfigParams -Request $Request
        $splatParams = @{ Name = $ZoneName }
        foreach ($key in $p.Keys) { $splatParams[$key] = $p[$key] }
        Remove-DnsServerZone @splatParams -Force -ErrorAction Stop
        Send-Response -Response $Response -Body @{ success = $true }
    } catch {
        Send-Response -Response $Response -Body @{ success = $false; error = $_.Exception.Message } -StatusCode 500
    }
}

function Handle-ConvertZone {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [System.Net.HttpListenerRequest]$Request,
        [string]$ZoneName,
        [psobject]$Body
    )
    try {
        $p = Resolve-ServerConfigParams -Request $Request
        $splatParams = @{ Name = $ZoneName }
        foreach ($key in $p.Keys) { $splatParams[$key] = $p[$key] }
        $targetType = $Body.targetType  # 'Primary' or 'Secondary'
        if ($targetType -eq 'Primary') {
            if ($Body.replicationScope) { $splatParams['ReplicationScope'] = $Body.replicationScope }
            elseif ($Body.zoneFile) { $splatParams['ZoneFile'] = $Body.zoneFile }
            ConvertTo-DnsServerPrimaryZone @splatParams -Force -ErrorAction Stop
        } elseif ($targetType -eq 'Secondary') {
            if ($Body.masterServers) { $splatParams['MasterServers'] = [string[]]$Body.masterServers }
            if ($Body.zoneFile) { $splatParams['ZoneFile'] = $Body.zoneFile }
            ConvertTo-DnsServerSecondaryZone @splatParams -Force -ErrorAction Stop
        } else {
            Send-Response -Response $Response -Body @{ success = $false; error = "Invalid target type: $targetType" } -StatusCode 400
            return
        }
        Send-Response -Response $Response -Body @{ success = $true }
    } catch {
        Send-Response -Response $Response -Body @{ success = $false; error = $_.Exception.Message } -StatusCode 500
    }
}

function Handle-StartZoneTransfer {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [System.Net.HttpListenerRequest]$Request,
        [string]$ZoneName
    )
    try {
        $p = Resolve-ServerConfigParams -Request $Request
        $splatParams = @{ Name = $ZoneName }
        foreach ($key in $p.Keys) { $splatParams[$key] = $p[$key] }
        Start-DnsServerZoneTransfer @splatParams -ErrorAction Stop
        Send-Response -Response $Response -Body @{ success = $true }
    } catch {
        Send-Response -Response $Response -Body @{ success = $false; error = $_.Exception.Message } -StatusCode 500
    }
}

function Handle-SuspendZone {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [System.Net.HttpListenerRequest]$Request,
        [string]$ZoneName
    )
    try {
        $p = Resolve-ServerConfigParams -Request $Request
        $splatParams = @{ Name = $ZoneName }
        foreach ($key in $p.Keys) { $splatParams[$key] = $p[$key] }
        Suspend-DnsServerZone @splatParams -Force -ErrorAction Stop
        Send-Response -Response $Response -Body @{ success = $true }
    } catch {
        Send-Response -Response $Response -Body @{ success = $false; error = $_.Exception.Message } -StatusCode 500
    }
}

function Handle-ResumeZone {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [System.Net.HttpListenerRequest]$Request,
        [string]$ZoneName
    )
    try {
        $p = Resolve-ServerConfigParams -Request $Request
        $splatParams = @{ Name = $ZoneName }
        foreach ($key in $p.Keys) { $splatParams[$key] = $p[$key] }
        Resume-DnsServerZone @splatParams -ErrorAction Stop
        Send-Response -Response $Response -Body @{ success = $true }
    } catch {
        Send-Response -Response $Response -Body @{ success = $false; error = $_.Exception.Message } -StatusCode 500
    }
}

function Handle-ExportZone {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [System.Net.HttpListenerRequest]$Request,
        [string]$ZoneName,
        [psobject]$Body
    )
    try {
        $p = Resolve-ServerConfigParams -Request $Request
        $fileName = if ($Body -and $Body.fileName) { $Body.fileName } else { "$ZoneName.dns" }
        $splatParams = @{ Name = $ZoneName; FileName = $fileName }
        foreach ($key in $p.Keys) { $splatParams[$key] = $p[$key] }
        Export-DnsServerZone @splatParams -ErrorAction Stop
        Send-Response -Response $Response -Body @{ success = $true; fileName = $fileName }
    } catch {
        Send-Response -Response $Response -Body @{ success = $false; error = $_.Exception.Message } -StatusCode 500
    }
}

function Handle-GetZoneAging {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [System.Net.HttpListenerRequest]$Request,
        [string]$ZoneName
    )
    try {
        $p = Resolve-ServerConfigParams -Request $Request
        $splatParams = @{ Name = $ZoneName }
        foreach ($key in $p.Keys) { $splatParams[$key] = $p[$key] }
        $aging = Get-DnsServerZoneAging @splatParams -ErrorAction Stop
        Send-Response -Response $Response -Body @{
            success = $true
            aging   = $aging
        }
    } catch {
        Send-Response -Response $Response -Body @{ success = $false; error = $_.Exception.Message } -StatusCode 500
    }
}

function Handle-SetZoneAging {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [System.Net.HttpListenerRequest]$Request,
        [string]$ZoneName,
        [psobject]$Body
    )
    try {
        $p = Resolve-ServerConfigParams -Request $Request
        $splatParams = @{ Name = $ZoneName }
        foreach ($key in $p.Keys) { $splatParams[$key] = $p[$key] }
        if ($null -ne $Body.aging) { $splatParams['Aging'] = [bool]$Body.aging }
        if ($Body.refreshInterval) { $splatParams['RefreshInterval'] = $Body.refreshInterval }
        if ($Body.noRefreshInterval) { $splatParams['NoRefreshInterval'] = $Body.noRefreshInterval }
        if ($Body.scavengeServers) { $splatParams['ScavengeServers'] = [string[]]$Body.scavengeServers }
        Set-DnsServerZoneAging @splatParams -ErrorAction Stop
        Send-Response -Response $Response -Body @{ success = $true }
    } catch {
        Send-Response -Response $Response -Body @{ success = $false; error = $_.Exception.Message } -StatusCode 500
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

        # Add zone scopes (only for non-recursion policies)
        if ($Body.action -eq 'ALLOW' -and $Body.scopes -and -not $Body.applyOnRecursion) {
            $scopeStr = ($Body.scopes | ForEach-Object { "$($_.name),$($_.weight)" }) -join ';'
            $splatParams['ZoneScope'] = $scopeStr
        }

        # Recursion policy support
        if ($Body.applyOnRecursion) {
            $splatParams['ApplyOnRecursion'] = $true
            if ($Body.recursionScope) {
                $splatParams['RecursionScope'] = $Body.recursionScope
            }
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
        'Clear-DnsServer', 'Show-DnsServer', 'Enable-DnsServer', 'Disable-DnsServer',
        'ConvertTo-DnsServer', 'Export-DnsServer', 'Import-DnsServer',
        'Invoke-DnsServer', 'Start-DnsServer', 'Restore-DnsServer',
        'Resume-DnsServer', 'Suspend-DnsServer', 'Sync-DnsServer',
        'Step-DnsServer', 'Reset-DnsServer', 'Register-DnsServer', 'Unregister-DnsServer',
        'Update-DnsServer', 'Test-DnsServer',
        'Get-DnsClientServerAddress', 'Test-NetConnection',
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
            # ── Client Subnets ──────────────────────────────
            '^/api/subnets$' {
                switch ($method) {
                    'GET' {
                        Handle-GetSubnets -Response $response -Request $request
                    }
                    'POST' {
                        $body = Read-RequestBody -Request $request
                        Handle-CreateSubnet -Response $response -Body $body
                    }
                    default {
                        Send-Response -Response $response -Body @{ success = $false; error = 'Method not allowed' } -StatusCode 405
                    }
                }
            }
            '^/api/subnets/([^/]+)$' {
                if ($method -eq 'DELETE') {
                    $subnetName = [System.Uri]::UnescapeDataString($Matches[1])
                    Handle-DeleteSubnet -Response $response -Request $request -SubnetName $subnetName
                } else {
                    Send-Response -Response $response -Body @{ success = $false; error = 'Method not allowed' } -StatusCode 405
                }
            }
            # ── Zone Scopes ─────────────────────────────────
            '^/api/zonescopes/records$' {
                if ($method -eq 'POST') {
                    $body = Read-RequestBody -Request $request
                    Handle-AddZoneScopeRecord -Response $response -Body $body
                } else {
                    Send-Response -Response $response -Body @{ success = $false; error = 'Method not allowed' } -StatusCode 405
                }
            }
            '^/api/zonescopes$' {
                switch ($method) {
                    'GET' {
                        Handle-GetZoneScopes -Response $response -Request $request
                    }
                    'POST' {
                        $body = Read-RequestBody -Request $request
                        Handle-CreateZoneScope -Response $response -Body $body
                    }
                    default {
                        Send-Response -Response $response -Body @{ success = $false; error = 'Method not allowed' } -StatusCode 405
                    }
                }
            }
            '^/api/zonescopes/([^/]+)$' {
                if ($method -eq 'DELETE') {
                    $scopeName = [System.Uri]::UnescapeDataString($Matches[1])
                    Handle-DeleteZoneScope -Response $response -Request $request -ScopeName $scopeName
                } else {
                    Send-Response -Response $response -Body @{ success = $false; error = 'Method not allowed' } -StatusCode 405
                }
            }
            # ── Recursion Scopes ────────────────────────────
            '^/api/recursionscopes$' {
                switch ($method) {
                    'GET' {
                        Handle-GetRecursionScopes -Response $response -Request $request
                    }
                    'POST' {
                        $body = Read-RequestBody -Request $request
                        Handle-CreateRecursionScope -Response $response -Body $body
                    }
                    default {
                        Send-Response -Response $response -Body @{ success = $false; error = 'Method not allowed' } -StatusCode 405
                    }
                }
            }
            '^/api/recursionscopes/([^/]+)$' {
                switch ($method) {
                    'PUT' {
                        $body = Read-RequestBody -Request $request
                        $scopeName = [System.Uri]::UnescapeDataString($Matches[1])
                        Handle-SetRecursionScope -Response $response -Body $body -ScopeName $scopeName
                    }
                    'DELETE' {
                        $scopeName = [System.Uri]::UnescapeDataString($Matches[1])
                        Handle-DeleteRecursionScope -Response $response -Request $request -ScopeName $scopeName
                    }
                    default {
                        Send-Response -Response $response -Body @{ success = $false; error = 'Method not allowed' } -StatusCode 405
                    }
                }
            }
            # ── Zone Transfer Policies ──────────────────────
            '^/api/transferpolicies$' {
                switch ($method) {
                    'GET' {
                        Handle-GetZoneTransferPolicies -Response $response -Request $request
                    }
                    'POST' {
                        $body = Read-RequestBody -Request $request
                        Handle-CreateZoneTransferPolicy -Response $response -Body $body
                    }
                    default {
                        Send-Response -Response $response -Body @{ success = $false; error = 'Method not allowed' } -StatusCode 405
                    }
                }
            }
            '^/api/transferpolicies/([^/]+)$' {
                if ($method -eq 'DELETE') {
                    $policyName = [System.Uri]::UnescapeDataString($Matches[1])
                    Handle-DeleteZoneTransferPolicy -Response $response -Request $request -PolicyName $policyName
                } else {
                    Send-Response -Response $response -Body @{ success = $false; error = 'Method not allowed' } -StatusCode 405
                }
            }
            # ── Policy State ────────────────────────────────
            '^/api/policies/([^/]+)/state$' {
                if ($method -eq 'PUT') {
                    $body = Read-RequestBody -Request $request
                    $policyName = [System.Uri]::UnescapeDataString($Matches[1])
                    Handle-SetPolicyState -Response $response -Request $request -Body $body -PolicyName $policyName
                } else {
                    Send-Response -Response $response -Body @{ success = $false; error = 'Method not allowed' } -StatusCode 405
                }
            }
            '^/api/connect$' {
                if ($method -eq 'POST') {
                    $body = Read-RequestBody -Request $request
                    Handle-Connect -Response $response -Body $body
                } else {
                    Send-Response -Response $response -Body @{ success = $false; error = 'Method not allowed' } -StatusCode 405
                }
            }
            # ── Zone Lifecycle ─────────────────────────────
            '^/api/zones/([^/]+)/aging$' {
                $zn = [System.Uri]::UnescapeDataString($Matches[1])
                switch ($method) {
                    'GET' { Handle-GetZoneAging -Response $response -Request $request -ZoneName $zn }
                    'PUT' { $body = Read-RequestBody -Request $request; Handle-SetZoneAging -Response $response -Request $request -ZoneName $zn -Body $body }
                    default { Send-Response -Response $response -Body @{ success = $false; error = 'Method not allowed' } -StatusCode 405 }
                }
            }
            '^/api/zones/([^/]+)/convert$' {
                $zn = [System.Uri]::UnescapeDataString($Matches[1])
                if ($method -eq 'POST') {
                    $body = Read-RequestBody -Request $request
                    Handle-ConvertZone -Response $response -Request $request -ZoneName $zn -Body $body
                } else { Send-Response -Response $response -Body @{ success = $false; error = 'Method not allowed' } -StatusCode 405 }
            }
            '^/api/zones/([^/]+)/transfer$' {
                $zn = [System.Uri]::UnescapeDataString($Matches[1])
                if ($method -eq 'POST') {
                    Handle-StartZoneTransfer -Response $response -Request $request -ZoneName $zn
                } else { Send-Response -Response $response -Body @{ success = $false; error = 'Method not allowed' } -StatusCode 405 }
            }
            '^/api/zones/([^/]+)/suspend$' {
                $zn = [System.Uri]::UnescapeDataString($Matches[1])
                if ($method -eq 'POST') {
                    Handle-SuspendZone -Response $response -Request $request -ZoneName $zn
                } else { Send-Response -Response $response -Body @{ success = $false; error = 'Method not allowed' } -StatusCode 405 }
            }
            '^/api/zones/([^/]+)/resume$' {
                $zn = [System.Uri]::UnescapeDataString($Matches[1])
                if ($method -eq 'POST') {
                    Handle-ResumeZone -Response $response -Request $request -ZoneName $zn
                } else { Send-Response -Response $response -Body @{ success = $false; error = 'Method not allowed' } -StatusCode 405 }
            }
            '^/api/zones/([^/]+)/export$' {
                $zn = [System.Uri]::UnescapeDataString($Matches[1])
                if ($method -eq 'POST') {
                    $body = Read-RequestBody -Request $request
                    Handle-ExportZone -Response $response -Request $request -ZoneName $zn -Body $body
                } else { Send-Response -Response $response -Body @{ success = $false; error = 'Method not allowed' } -StatusCode 405 }
            }
            # ── Zone Records & Settings ─────────────────────
            '^/api/zones/([^/]+)/records$' {
                $zn = [System.Uri]::UnescapeDataString($Matches[1])
                switch ($method) {
                    'GET' {
                        Handle-GetZoneRecords -Response $response -Request $request -ZoneName $zn
                    }
                    'POST' {
                        $body = Read-RequestBody -Request $request
                        Handle-AddZoneRecord -Response $response -Body $body
                    }
                    'PUT' {
                        $body = Read-RequestBody -Request $request
                        Handle-UpdateZoneRecord -Response $response -Body $body -ZoneName $zn
                    }
                    'DELETE' {
                        $body = Read-RequestBody -Request $request
                        Handle-RemoveZoneRecord -Response $response -Body $body -ZoneName $zn
                    }
                    default {
                        Send-Response -Response $response -Body @{ success = $false; error = 'Method not allowed' } -StatusCode 405
                    }
                }
            }
            '^/api/zones/([^/]+)/settings$' {
                $zn = [System.Uri]::UnescapeDataString($Matches[1])
                if ($method -eq 'PUT') {
                    $body = Read-RequestBody -Request $request
                    Handle-SetZoneSettings -Response $response -Body $body -ZoneName $zn
                } else {
                    Send-Response -Response $response -Body @{ success = $false; error = 'Method not allowed' } -StatusCode 405
                }
            }
            '^/api/zones/([^/]+)$' {
                $zn = [System.Uri]::UnescapeDataString($Matches[1])
                switch ($method) {
                    'GET'    { Handle-GetZoneDetails -Response $response -Request $request -ZoneName $zn }
                    'DELETE' { Handle-RemoveZone -Response $response -Request $request -ZoneName $zn }
                    default  { Send-Response -Response $response -Body @{ success = $false; error = 'Method not allowed' } -StatusCode 405 }
                }
            }
            '^/api/zones$' {
                switch ($method) {
                    'GET'  { Handle-GetZones -Response $response -Request $request }
                    'POST' { $body = Read-RequestBody -Request $request; Handle-CreateZone -Response $response -Body $body }
                    default { Send-Response -Response $response -Body @{ success = $false; error = 'Method not allowed' } -StatusCode 405 }
                }
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
            '^/api/policies/copy$' {
                if ($method -eq 'POST') {
                    $body = Read-RequestBody -Request $request
                    Handle-CopyPolicies -Response $response -Body $body
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
            # ── Server Configuration ──────────────────────
            '^/api/server/settings$' {
                switch ($method) {
                    'GET'  { Handle-GetServerSettings -Response $response -Request $request }
                    'PUT'  { $body = Read-RequestBody -Request $request; Handle-SetServerSettings -Response $response -Request $request -Body $body }
                    default { Send-Response -Response $response -Body @{ success = $false; error = 'Method not allowed' } -StatusCode 405 }
                }
            }
            '^/api/server/forwarders$' {
                switch ($method) {
                    'GET'    { Handle-GetForwarders -Response $response -Request $request }
                    'POST'   { $body = Read-RequestBody -Request $request; Handle-AddForwarder -Response $response -Request $request -Body $body }
                    'PUT'    { $body = Read-RequestBody -Request $request; Handle-SetForwarders -Response $response -Request $request -Body $body }
                    'DELETE' { $body = Read-RequestBody -Request $request; Handle-RemoveForwarder -Response $response -Request $request -Body $body }
                    default  { Send-Response -Response $response -Body @{ success = $false; error = 'Method not allowed' } -StatusCode 405 }
                }
            }
            '^/api/server/cache$' {
                switch ($method) {
                    'GET'    { Handle-GetCache -Response $response -Request $request }
                    'DELETE' { Handle-ClearCache -Response $response -Request $request }
                    default  { Send-Response -Response $response -Body @{ success = $false; error = 'Method not allowed' } -StatusCode 405 }
                }
            }
            '^/api/server/recursion$' {
                switch ($method) {
                    'GET' { Handle-GetRecursionSettings -Response $response -Request $request }
                    'PUT' { $body = Read-RequestBody -Request $request; Handle-SetRecursionSettings -Response $response -Request $request -Body $body }
                    default { Send-Response -Response $response -Body @{ success = $false; error = 'Method not allowed' } -StatusCode 405 }
                }
            }
            '^/api/server/blocklist$' {
                switch ($method) {
                    'GET' { Handle-GetBlockList -Response $response -Request $request }
                    'PUT' { $body = Read-RequestBody -Request $request; Handle-SetBlockList -Response $response -Request $request -Body $body }
                    default { Send-Response -Response $response -Body @{ success = $false; error = 'Method not allowed' } -StatusCode 405 }
                }
            }
            '^/api/server/diagnostics$' {
                switch ($method) {
                    'GET' { Handle-GetDiagnostics -Response $response -Request $request }
                    'PUT' { $body = Read-RequestBody -Request $request; Handle-SetDiagnostics -Response $response -Request $request -Body $body }
                    default { Send-Response -Response $response -Body @{ success = $false; error = 'Method not allowed' } -StatusCode 405 }
                }
            }
            '^/api/server/statistics$' {
                switch ($method) {
                    'GET'    { Handle-GetStatistics -Response $response -Request $request }
                    'DELETE' { Handle-ClearStatistics -Response $response -Request $request }
                    default  { Send-Response -Response $response -Body @{ success = $false; error = 'Method not allowed' } -StatusCode 405 }
                }
            }
            # ── RRL & Scavenging ──────────────────────────────
            '^/api/server/rrl/exceptions/([^/]+)$' {
                $name = [System.Uri]::UnescapeDataString($Matches[1])
                if ($method -eq 'DELETE') {
                    Handle-RemoveRRLException -Response $response -Request $request -Name $name
                } else { Send-Response -Response $response -Body @{ success = $false; error = 'Method not allowed' } -StatusCode 405 }
            }
            '^/api/server/rrl/exceptions$' {
                switch ($method) {
                    'GET'  { Handle-GetRRLExceptions -Response $response -Request $request }
                    'POST' { $body = Read-RequestBody -Request $request; Handle-AddRRLException -Response $response -Request $request -Body $body }
                    default { Send-Response -Response $response -Body @{ success = $false; error = 'Method not allowed' } -StatusCode 405 }
                }
            }
            '^/api/server/rrl$' {
                switch ($method) {
                    'GET' { Handle-GetRRL -Response $response -Request $request }
                    'PUT' { $body = Read-RequestBody -Request $request; Handle-SetRRL -Response $response -Request $request -Body $body }
                    default { Send-Response -Response $response -Body @{ success = $false; error = 'Method not allowed' } -StatusCode 405 }
                }
            }
            '^/api/server/scavenging/start$' {
                if ($method -eq 'POST') {
                    Handle-StartScavenging -Response $response -Request $request
                } else { Send-Response -Response $response -Body @{ success = $false; error = 'Method not allowed' } -StatusCode 405 }
            }
            '^/api/server/scavenging$' {
                switch ($method) {
                    'GET' { Handle-GetScavenging -Response $response -Request $request }
                    'PUT' { $body = Read-RequestBody -Request $request; Handle-SetScavenging -Response $response -Request $request -Body $body }
                    default { Send-Response -Response $response -Body @{ success = $false; error = 'Method not allowed' } -StatusCode 405 }
                }
            }
            '^/api/server/test$' {
                if ($method -eq 'POST') {
                    Handle-TestDnsServer -Response $response -Request $request
                } else { Send-Response -Response $response -Body @{ success = $false; error = 'Method not allowed' } -StatusCode 405 }
            }
            '^/api/server/bpa$' {
                if ($method -eq 'POST') {
                    Handle-RunBpa -Response $response -Request $request
                } else { Send-Response -Response $response -Body @{ success = $false; error = 'Method not allowed' } -StatusCode 405 }
            }
            '^/api/server/encryption$' {
                switch ($method) {
                    'GET' { Handle-GetEncryptionProtocol -Response $response -Request $request }
                    'PUT' { $body = Read-RequestBody -Request $request; Handle-SetEncryptionProtocol -Response $response -Request $request -Body $body }
                    default { Send-Response -Response $response -Body @{ success = $false; error = 'Method not allowed' } -StatusCode 405 }
                }
            }
            # ── DNSSEC ────────────────────────────────────────
            '^/api/dnssec/([^/]+)/keys/([^/]+)$' {
                $zn = [System.Uri]::UnescapeDataString($Matches[1])
                $kid = [System.Uri]::UnescapeDataString($Matches[2])
                if ($method -eq 'DELETE') {
                    Handle-RemoveSigningKey -Response $response -Request $request -ZoneName $zn -KeyId $kid
                } else { Send-Response -Response $response -Body @{ success = $false; error = 'Method not allowed' } -StatusCode 405 }
            }
            '^/api/dnssec/([^/]+)/keys$' {
                $zn = [System.Uri]::UnescapeDataString($Matches[1])
                switch ($method) {
                    'GET'  { Handle-GetSigningKeys -Response $response -Request $request -ZoneName $zn }
                    'POST' { $body = Read-RequestBody -Request $request; Handle-AddSigningKey -Response $response -Request $request -ZoneName $zn -Body $body }
                    default { Send-Response -Response $response -Body @{ success = $false; error = 'Method not allowed' } -StatusCode 405 }
                }
            }
            '^/api/dnssec/([^/]+)/sign$' {
                $zn = [System.Uri]::UnescapeDataString($Matches[1])
                if ($method -eq 'POST') { Handle-SignZone -Response $response -Request $request -ZoneName $zn }
                else { Send-Response -Response $response -Body @{ success = $false; error = 'Method not allowed' } -StatusCode 405 }
            }
            '^/api/dnssec/([^/]+)/unsign$' {
                $zn = [System.Uri]::UnescapeDataString($Matches[1])
                if ($method -eq 'POST') { Handle-UnsignZone -Response $response -Request $request -ZoneName $zn }
                else { Send-Response -Response $response -Body @{ success = $false; error = 'Method not allowed' } -StatusCode 405 }
            }
            '^/api/dnssec/([^/]+)/export-key$' {
                $zn = [System.Uri]::UnescapeDataString($Matches[1])
                if ($method -eq 'POST') { Handle-ExportDnssecKey -Response $response -Request $request -ZoneName $zn }
                else { Send-Response -Response $response -Body @{ success = $false; error = 'Method not allowed' } -StatusCode 405 }
            }
            '^/api/dnssec/([^/]+)$' {
                $zn = [System.Uri]::UnescapeDataString($Matches[1])
                switch ($method) {
                    'GET' { Handle-GetDnssecSettings -Response $response -Request $request -ZoneName $zn }
                    'PUT' { $body = Read-RequestBody -Request $request; Handle-SetDnssecSettings -Response $response -Request $request -ZoneName $zn -Body $body }
                    default { Send-Response -Response $response -Body @{ success = $false; error = 'Method not allowed' } -StatusCode 405 }
                }
            }
            '^/api/trustanchors/([^/]+)$' {
                $name = [System.Uri]::UnescapeDataString($Matches[1])
                if ($method -eq 'DELETE') { Handle-RemoveTrustAnchor -Response $response -Request $request -Name $name }
                else { Send-Response -Response $response -Body @{ success = $false; error = 'Method not allowed' } -StatusCode 405 }
            }
            '^/api/trustanchors$' {
                switch ($method) {
                    'GET'  { Handle-GetTrustAnchors -Response $response -Request $request }
                    'POST' { $body = Read-RequestBody -Request $request; Handle-AddTrustAnchor -Response $response -Request $request -Body $body }
                    default { Send-Response -Response $response -Body @{ success = $false; error = 'Method not allowed' } -StatusCode 405 }
                }
            }
            '^/api/trustpoints/([^/]+)/update$' {
                $name = [System.Uri]::UnescapeDataString($Matches[1])
                if ($method -eq 'POST') { Handle-UpdateTrustPoint -Response $response -Request $request -Name $name }
                else { Send-Response -Response $response -Body @{ success = $false; error = 'Method not allowed' } -StatusCode 405 }
            }
            '^/api/trustpoints$' {
                if ($method -eq 'GET') { Handle-GetTrustPoints -Response $response -Request $request }
                else { Send-Response -Response $response -Body @{ success = $false; error = 'Method not allowed' } -StatusCode 405 }
            }
            # ── Niche: Root Hints, EDNS, DS, GNZ, Delegations ─
            '^/api/server/roothints$' {
                if ($method -eq 'GET') { Handle-GetRootHints -Response $response -Request $request }
                else { Send-Response -Response $response -Body @{ success = $false; error = 'Method not allowed' } -StatusCode 405 }
            }
            '^/api/server/edns$' {
                switch ($method) {
                    'GET' { Handle-GetEDns -Response $response -Request $request }
                    'PUT' { $body = Read-RequestBody -Request $request; Handle-SetEDns -Response $response -Request $request -Body $body }
                    default { Send-Response -Response $response -Body @{ success = $false; error = 'Method not allowed' } -StatusCode 405 }
                }
            }
            '^/api/server/dssetting$' {
                if ($method -eq 'GET') { Handle-GetDsSetting -Response $response -Request $request }
                else { Send-Response -Response $response -Body @{ success = $false; error = 'Method not allowed' } -StatusCode 405 }
            }
            '^/api/server/globalnamezone$' {
                switch ($method) {
                    'GET' { Handle-GetGlobalNameZone -Response $response -Request $request }
                    'PUT' { $body = Read-RequestBody -Request $request; Handle-SetGlobalNameZone -Response $response -Request $request -Body $body }
                    default { Send-Response -Response $response -Body @{ success = $false; error = 'Method not allowed' } -StatusCode 405 }
                }
            }
            '^/api/zones/([^/]+)/delegations$' {
                $zn = [System.Uri]::UnescapeDataString($Matches[1])
                if ($method -eq 'GET') { Handle-GetZoneDelegation -Response $response -Request $request -ZoneName $zn }
                else { Send-Response -Response $response -Body @{ success = $false; error = 'Method not allowed' } -StatusCode 405 }
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

$prefix = "http://${BindAddress}:${Port}/"
$listener = $null

# Remove stale URL ACL reservations that can block HttpListener
try {
    $aclCheck = & netsh http show urlacl url=$prefix 2>&1 | Out-String
    if ($aclCheck -match 'Reserved URL') {
        Write-Log "Removing stale URL ACL for $prefix ..."
        $null = & netsh http delete urlacl url=$prefix 2>&1
    }
} catch {}

# Try binding with multiple prefix formats for compatibility
$prefixes = @($prefix)
if ($BindAddress -eq '127.0.0.1') {
    $prefixes += "http://localhost:${Port}/"
} elseif ($BindAddress -eq '0.0.0.0') {
    $prefixes = @("http://+:${Port}/")
}
$started = $false

foreach ($pfx in $prefixes) {
    try {
        $listener = New-Object System.Net.HttpListener
        $listener.Prefixes.Add($pfx)
        $listener.Start()
        $started = $true
        $prefix = $pfx
        break
    } catch {
        Write-Log "Bind failed on $pfx : $($_.Exception.Message)" 'WARN'
        try { $listener.Close() } catch {}
        $listener = $null
    }
}

if (-not $started) {
    Write-Host ''
    Write-Host '  ERROR: Could not bind HTTP listener on port $Port.' -ForegroundColor Red
    Write-Host '  This usually means:' -ForegroundColor Yellow
    Write-Host '    1. Another process is using the port, OR' -ForegroundColor DarkGray
    Write-Host '    2. PowerShell is not running as Administrator' -ForegroundColor DarkGray
    Write-Host ''
    Write-Host '  Fix: Run Start-DNSPolicyManager.ps1 from an elevated PowerShell.' -ForegroundColor Cyan
    Write-Host ''
    exit 1
}

try {
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
