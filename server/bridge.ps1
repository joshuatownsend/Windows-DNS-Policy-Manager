#Requires -Version 5.1
<#
.SYNOPSIS
    DNS Policy Manager - PowerShell HTTP Bridge
.DESCRIPTION
    Local HTTP bridge that exposes DNS Server cmdlets as REST API endpoints.
    Binds to 127.0.0.1 by default (port 8650) for security. Zero external dependencies.
    Every endpoint except /api/health requires "Authorization: Bearer <token>". The token
    comes from -Token, else $env:DNS_BRIDGE_TOKEN, else the existing token file, else a new
    random one (-RotateToken forces a new one). It is written to
    %LOCALAPPDATA%\DNSPolicyManager\bridge.token (readable by this user only), where the
    local frontend and MCP server pick it up.
    Binding anything other than loopback (e.g. -BindAddress 0.0.0.0 for Docker) requires
    -AllowRemote, because credentials then cross the network; add -UseHttps (with a
    certificate bound via netsh http add sslcert) or a TLS proxy on untrusted networks.
.NOTES
    Run with: powershell -ExecutionPolicy Bypass -File bridge.ps1
    Stop with: Ctrl+C
#>

param(
    [int]$Port = 8650,
    [string]$BindAddress = '127.0.0.1',
    [string[]]$AllowedOrigins = @(
        'http://localhost:10010', 'http://127.0.0.1:10010'
    ),
    [string]$Token = $env:DNS_BRIDGE_TOKEN,
    [switch]$AllowRemote,
    [switch]$UseHttps,
    [switch]$RotateToken
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

function ConvertTo-PlainValue {
    # Convert a single value to a JSON-safe primitive.
    param($Val)
    if ($null -eq $Val) { return $null }
    if ($Val -is [string]) { return $Val }
    if ($Val -is [bool]) { return $Val }
    if ($Val -is [TimeSpan]) { return $Val.ToString() }
    if ($Val -is [DateTime]) { return $Val.ToString('o') }
    if ($Val -is [int] -or $Val -is [long] -or $Val -is [double] -or $Val -is [decimal] -or $Val -is [float]) { return $Val }
    if ($Val -is [enum]) { return $Val.ToString() }
    # Other ValueTypes (e.g. IPAddress is NOT a ValueType, but structs are)
    if ($Val -is [ValueType]) { return $Val.ToString() }
    # Arrays / collections — flatten each element
    if ($Val -is [System.Collections.IEnumerable]) {
        return @($Val | ForEach-Object { ConvertTo-PlainValue $_ })
    }
    # Everything else (IPAddress, CimInstance, etc.) — stringify
    return "$Val"
}

function ConvertTo-PlainObject {
    # Flatten a CIM/PSObject to a hashtable with only JSON-safe values.
    # Prevents [object Object] when CIM instances cross runspace/job boundaries.
    param($InputObject)
    if ($null -eq $InputObject) { return $null }
    $out = @{}
    foreach ($prop in $InputObject.PSObject.Properties) {
        $out[$prop.Name] = ConvertTo-PlainValue $prop.Value
    }
    return $out
}

function Send-Response {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [hashtable]$Body,
        [int]$StatusCode = 200
    )
    $json = ConvertTo-JsonSafe $Body
    $buffer = [System.Text.Encoding]::UTF8.GetBytes($json)

    try {
        $Response.StatusCode = $StatusCode
        $Response.ContentType = 'application/json; charset=utf-8'
        $Response.ContentLength64 = $buffer.Length
        # No CORS headers: browsers reach the bridge only through the frontend's server-side
        # /api proxy, so a page on another origin can't read bridge responses.

        $Response.OutputStream.Write($buffer, 0, $buffer.Length)
        $Response.OutputStream.Close()
    } catch {
        # Client may have disconnected (e.g., timeout). Log and move on.
        Write-Log "Send-Response failed (client likely disconnected): $($_.Exception.Message)" 'WARN'
    }
}

function Send-Preflight {
    # Answer CORS preflights without granting anything: no Access-Control-Allow-* headers,
    # so cross-origin browser requests are refused.
    param([System.Net.HttpListenerResponse]$Response)
    $Response.StatusCode = 204
    $Response.ContentLength64 = 0
    $Response.OutputStream.Close()
}

function Get-MaxRequestBodyBytes {
    # Largest request body the bridge will read. The biggest legitimate payloads (bulk
    # policy imports, block lists) are well under this.
    1MB
}

function Read-BoundedText {
    # Read a stream as text, throwing once more than MaxBytes have arrived. Covers chunked
    # requests, which carry no Content-Length for Route-Request to check up front.
    param(
        [System.IO.Stream]$Stream,
        [System.Text.Encoding]$Encoding,
        [long]$MaxBytes
    )
    $mem = New-Object System.IO.MemoryStream
    $buffer = New-Object byte[] 65536
    try {
        while (($read = $Stream.Read($buffer, 0, $buffer.Length)) -gt 0) {
            if ($mem.Length + $read -gt $MaxBytes) {
                throw [System.IO.InvalidDataException]::new('Request body too large')
            }
            $mem.Write($buffer, 0, $read)
        }
        return $Encoding.GetString($mem.ToArray())
    } finally {
        $mem.Dispose()
    }
}

function Read-RequestBody {
    param([System.Net.HttpListenerRequest]$Request)
    if ($Request.HasEntityBody) {
        try {
            $body = Read-BoundedText -Stream $Request.InputStream -Encoding $Request.ContentEncoding -MaxBytes (Get-MaxRequestBodyBytes)
        } finally {
            $Request.InputStream.Close()
        }
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

# ── Security Helpers ─────────────────────────────────────────────────────────

function Assert-SafeId {
    # Validate that an ID contains only safe characters (alphanumeric, hyphens, underscores, dots).
    # Prevents path traversal via serverId or similar parameters.
    param([string]$Id, [string]$ParamName = 'id')
    if ($Id -notmatch '^[a-zA-Z0-9._-]+$') {
        throw "Invalid $ParamName : contains disallowed characters"
    }
    return $Id
}

function Assert-PolicyCriterionType {
    # Policy criteria arrive as { type, operator, values } and `type` becomes a cmdlet
    # parameter NAME in the splat. Without this check a request could smuggle in any
    # parameter -- e.g. type = 'ComputerName' or 'CimSession' to retarget the cmdlet.
    param([string]$Type)
    $allowed = @('ClientSubnet', 'Fqdn', 'QType', 'ServerInterfaceIP', 'TimeOfDay', 'TransportProtocol', 'InternetProtocol')
    $match = $allowed | Where-Object { $_ -eq $Type } | Select-Object -First 1
    if (-not $match) {
        throw "Invalid policy criterion type: $Type"
    }
    return $match
}

function Assert-SafeFileName {
    # Strip path components, leaving only the filename. Prevents path traversal via fileName params.
    param([string]$FileName)
    $safe = [System.IO.Path]::GetFileName($FileName)
    if (-not $safe -or $safe -ne $FileName) {
        throw "Invalid file name: path traversal not allowed"
    }
    return $safe
}

function Test-CommandAllowed {
    # Validate a /api/execute command string. The check is an ALLOWLIST at two levels:
    #   1. Every AST node must be one of a small set of node types (pipelines, commands,
    #      parameters, constants, hashtables, property access, ...). Anything else -- method
    #      calls, casts, type literals, $() subexpressions, assignments, redirections,
    #      control flow, function definitions, or a node type a future PowerShell adds --
    #      is rejected, so a construct nobody thought of fails closed.
    #   2. Every command must have a static, cmdlet-shaped name on the DNS allowlist or the
    #      read-only formatter list.
    # Script blocks are allowed only as arguments to the formatters (calculated properties,
    # Sort-Object keys), variables only as $_ / $PSItem / $true / $false / $null.
    param([string]$Command)

    # Allowed by NAME PREFIX (covers e.g. Get-DnsServerZone, Get-DnsServerResourceRecord).
    $allowedPrefixes = @(
        'Get-DnsServer', 'Add-DnsServer', 'Remove-DnsServer', 'Set-DnsServer',
        'Clear-DnsServer', 'Show-DnsServer', 'Enable-DnsServer', 'Disable-DnsServer',
        'ConvertTo-DnsServer', 'Export-DnsServer', 'Import-DnsServer',
        'Invoke-DnsServer', 'Start-DnsServer', 'Restore-DnsServer',
        'Resume-DnsServer', 'Suspend-DnsServer', 'Sync-DnsServer',
        'Step-DnsServer', 'Reset-DnsServer', 'Register-DnsServer', 'Unregister-DnsServer',
        'Update-DnsServer', 'Test-DnsServer',
        'Get-DnsClientServerAddress', 'Test-NetConnection', 'Resolve-DnsName', 'Get-Service'
    )
    # Allowed by EXACT NAME -- read-only output shaping used in legitimate pipelines.
    $formatters = @(
        'Format-Table', 'Format-List', 'Select-Object', 'Sort-Object', 'Out-String'
    )
    $allowedNodeTypes = @(
        'ScriptBlockAst', 'NamedBlockAst', 'StatementBlockAst', 'PipelineAst',
        'CommandAst', 'CommandParameterAst', 'CommandExpressionAst',
        'StringConstantExpressionAst', 'ConstantExpressionAst', 'ExpandableStringExpressionAst',
        'ArrayLiteralAst', 'ArrayExpressionAst', 'ParenExpressionAst', 'HashtableAst',
        'ScriptBlockExpressionAst', 'VariableExpressionAst', 'MemberExpressionAst',
        'IndexExpressionAst', 'BinaryExpressionAst', 'UnaryExpressionAst'
    )
    $allowedVariables = @('_', 'PSItem', 'true', 'false', 'null')
    # Operators: comparison, logical, arithmetic and string formatting only. Excluded on
    # purpose: -as / -is (type conversion runs constructors -- 'C:\x' -as 'IO.StreamWriter'
    # truncates a file), -replace (takes a script block in pwsh 7), -split, bitwise/shift.
    $allowedBinaryOperators = @(
        'Ieq', 'Ine', 'Igt', 'Ige', 'Ilt', 'Ile', 'Ilike', 'Inotlike', 'Imatch', 'Inotmatch',
        'Icontains', 'Inotcontains', 'Iin', 'Inotin',
        'Ceq', 'Cne', 'Cgt', 'Cge', 'Clt', 'Cle', 'Clike', 'Cnotlike', 'Cmatch', 'Cnotmatch',
        'Ccontains', 'Cnotcontains', 'Cin', 'Cnotin',
        'And', 'Or', 'Xor', 'Plus', 'Minus', 'Multiply', 'Divide', 'Rem', 'Join', 'Format'
    )
    $allowedUnaryOperators = @('Not', 'Exclaim', 'Minus', 'Plus')

    if ([string]::IsNullOrWhiteSpace($Command)) { return $false }

    $tokens = $null
    $errs   = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseInput($Command, [ref]$tokens, [ref]$errs)
    if ($errs -and $errs.Count -gt 0) { return $false }

    $commandCount = 0
    foreach ($node in $ast.FindAll({ $true }, $true)) {
        $typeName = $node.GetType().Name
        if ($allowedNodeTypes -notcontains $typeName) { return $false }

        switch ($typeName) {
            'ScriptBlockAst' {
                # Only the root script and literal { } blocks -- no param() blocks.
                if ($node.ParamBlock -or $node.BeginBlock -or $node.ProcessBlock -or $node.DynamicParamBlock) { return $false }
            }
            'BinaryExpressionAst' {
                if ($allowedBinaryOperators -notcontains $node.Operator.ToString()) { return $false }
            }
            'UnaryExpressionAst' {
                if ($allowedUnaryOperators -notcontains $node.TokenKind.ToString()) { return $false }
            }
            'MemberExpressionAst' {
                # Property reads like $_.Name. Static access ([X]::Prop) needs a type literal,
                # which is already rejected; the member name itself must be a plain constant.
                if ($node.Static) { return $false }
                if ($node.Member -isnot [System.Management.Automation.Language.StringConstantExpressionAst]) { return $false }
            }
            'VariableExpressionAst' {
                if ($node.Splatted) { return $false }
                $path = $node.VariablePath
                if (-not $path.IsUnqualified -or $allowedVariables -notcontains $path.UserPath) { return $false }
            }
            'ScriptBlockExpressionAst' {
                $owner = $node.Parent
                while ($owner -and $owner -isnot [System.Management.Automation.Language.CommandAst]) { $owner = $owner.Parent }
                if (-not $owner -or $formatters -notcontains $owner.GetCommandName()) { return $false }
            }
            'CommandAst' {
                $commandCount++
                $name = $node.GetCommandName()
                # Static and cmdlet-shaped: rejects `& $var`, paths, and script files on PATH.
                if (-not $name -or $name -notmatch '^[A-Za-z]+-[A-Za-z0-9]+$') { return $false }
                if ($node.InvocationOperator -eq [System.Management.Automation.Language.TokenKind]::Dot) { return $false }
                $ok = $formatters -contains $name
                if (-not $ok) {
                    foreach ($p in $allowedPrefixes) {
                        if ($name -like "$p*") { $ok = $true; break }
                    }
                }
                if (-not $ok) { return $false }
            }
        }
    }
    return ($commandCount -gt 0)
}

function Test-OriginAllowed {
    # CSRF guard. A browser attaches an Origin header on cross-origin (and
    # state-changing same-origin) requests. Non-browser clients (curl, the MCP
    # server, Invoke-RestMethod) usually send none. Rule: allow when there is no
    # Origin; otherwise the Origin must be in the allowlist.
    param([System.Net.HttpListenerRequest]$Request)
    $origin = $Request.Headers['Origin']
    if ([string]::IsNullOrEmpty($origin)) { return $true }
    return ($script:AllowedOrigins -contains $origin)
}

function Test-BearerToken {
    # Constant-time check of an "Authorization: Bearer <token>" header value.
    param([string]$Header, [string]$Token)
    if ([string]::IsNullOrEmpty($Token) -or [string]::IsNullOrEmpty($Header)) { return $false }
    if (-not $Header.StartsWith('Bearer ', [System.StringComparison]::OrdinalIgnoreCase)) { return $false }
    $presented = [System.Text.Encoding]::UTF8.GetBytes($Header.Substring(7).Trim())
    $expected = [System.Text.Encoding]::UTF8.GetBytes($Token)
    $diff = $presented.Length -bxor $expected.Length
    for ($i = 0; $i -lt $expected.Length; $i++) {
        $b = if ($i -lt $presented.Length) { $presented[$i] } else { 0 }
        $diff = $diff -bor ($b -bxor $expected[$i])
    }
    return ($diff -eq 0)
}

function Test-RequestAuthorized {
    param([System.Net.HttpListenerRequest]$Request, [string]$Token)
    return (Test-BearerToken -Header $Request.Headers['Authorization'] -Token $Token)
}

function ConvertTo-HostKey {
    # Normalize a hostname for comparison: case-insensitive, no trailing dot, and every name
    # for this machine (localhost, loopback, ".", NetBIOS name, FQDN) folds to "localhost".
    param([string]$Name)
    $n = "$Name".Trim().TrimEnd('.').ToLowerInvariant()
    $self = @('', 'localhost', '127.0.0.1', '::1', '[::1]', '.', "$env:COMPUTERNAME".ToLowerInvariant())
    # The machine's own DNS suffix (not USERDNSDOMAIN, which is the signed-in user's domain and
    # can name a different machine when user and computer live in different domains).
    try {
        $suffix = [System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().DomainName
        if ($suffix) { $self += "$env:COMPUTERNAME.$suffix".ToLowerInvariant() }
    } catch {}
    if ($self -contains $n) { return 'localhost' }
    return $n
}

function Test-SameHost {
    param([string]$A, [string]$B)
    return ((ConvertTo-HostKey $A) -eq (ConvertTo-HostKey $B))
}

# ── Credential Infrastructure ────────────────────────────────────────────────

$script:AllowedOrigins = $AllowedOrigins
$script:SessionCredentials = @{}
$script:CredStorePath = Join-Path $env:LOCALAPPDATA 'DNSPolicyManager\credentials'

function Resolve-ServerCredential {
    param(
        [string]$ServerId,
        [string]$CredentialMode,
        [string]$Hostname
    )

    $params = @{}
    $isRemote = $Hostname -and $Hostname -ne 'localhost' -and $Hostname -ne $env:COMPUTERNAME

    # Validate serverId to prevent path traversal
    if ($ServerId) { $null = Assert-SafeId -Id $ServerId -ParamName 'serverId' }

    # Resolve the PSCredential object (if any), bound to the host it was entered for
    $cred = Resolve-StoredCredential -ServerId $ServerId -CredentialMode $CredentialMode -Hostname $Hostname

    if ($isRemote -and $cred) {
        # DNS Server cmdlets don't accept -Credential; they need -CimSession.
        # Create a CIM session with the credential for splatting to DNS cmdlets.
        $so = New-CimSessionOption -Protocol Dcom
        $session = New-CimSession -ComputerName $Hostname -Credential $cred -SessionOption $so -ErrorAction Stop
        $params['CimSession'] = $session
        if (-not $script:RequestCimSessions) { $script:RequestCimSessions = @() }
        $script:RequestCimSessions += $session
    } elseif ($isRemote) {
        $params['ComputerName'] = $Hostname
    }

    return $params
}

function Resolve-StoredCredential {
    # Load the saved (DPAPI) or session credential for ServerId, refusing to release it for any
    # host other than the one it was stored for -- the caller picks serverId and hostname
    # independently, so without this a request could present a privileged credential to an
    # arbitrary machine. Returns $null for currentUser mode or a missing session credential.
    param(
        [string]$ServerId,
        [string]$CredentialMode,
        [string]$Hostname
    )
    if ($ServerId) { $null = Assert-SafeId -Id $ServerId -ParamName 'serverId' }
    switch ($CredentialMode) {
        'savedCredential' {
            $credFile = Join-Path $script:CredStorePath "$ServerId.cred"
            if (-not (Test-Path $credFile)) {
                throw "No saved credential found for server '$ServerId'"
            }
            $credData = Get-Content $credFile -Raw | ConvertFrom-Json
            $boundHost = if ($credData.PSObject.Properties['Hostname']) { $credData.Hostname } else { $null }
            if (-not $boundHost) {
                throw "The saved credential for server '$ServerId' predates host binding. Re-enter it on the Server tab."
            }
            if (-not (Test-SameHost $boundHost $Hostname)) {
                throw "The saved credential for server '$ServerId' was stored for host '$boundHost', not '$Hostname'. Re-enter it on the Server tab."
            }
            $securePass = $credData.Password | ConvertTo-SecureString
            return (New-Object System.Management.Automation.PSCredential($credData.Username, $securePass))
        }
        'session' {
            if (-not $script:SessionCredentials.ContainsKey($ServerId)) { return $null }
            $entry = $script:SessionCredentials[$ServerId]
            if (-not (Test-SameHost $entry.Hostname $Hostname)) {
                throw "The session credential for server '$ServerId' was entered for host '$($entry.Hostname)', not '$Hostname'. Re-enter it on the Server tab."
            }
            return $entry.Credential
        }
    }
    # 'currentUser' -- no credential needed, Kerberos/NTLM handles auth
    return $null
}

function Resolve-BackgroundJobCredential {
    # Extract hostname + credential from resolved params for use with Invoke-Command
    # in background jobs (CimSession can't cross job boundaries).
    param(
        [hashtable]$ResolvedParams,
        [System.Net.HttpListenerRequest]$Request
    )
    $remoteHost = $null
    $remoteCred = $null
    if ($ResolvedParams.ContainsKey('CimSession')) {
        $remoteHost = $ResolvedParams['CimSession'].ComputerName
        $qs = $Request.QueryString
        $sid = $qs['serverId']
        $cm  = $qs['credentialMode']
        if ($sid -and $cm -in @('savedCredential', 'session')) {
            $remoteCred = Resolve-StoredCredential -ServerId $sid -CredentialMode $cm -Hostname $remoteHost
        }
    } elseif ($ResolvedParams.ContainsKey('ComputerName')) {
        $remoteHost = $ResolvedParams['ComputerName']
    }
    return @{ Host = $remoteHost; Credential = $remoteCred }
}

function Handle-StoreCredential {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [psobject]$Body
    )

    try {
        if (-not $Body -or -not $Body.serverId -or -not $Body.hostname -or -not $Body.username -or -not $Body.password) {
            Send-Response -Response $Response -Body @{
                success = $false
                error   = 'serverId, hostname, username, and password are required'
            } -StatusCode 400
            return
        }

        $null = Assert-SafeId -Id $Body.serverId -ParamName 'serverId'

        # Ensure credential store directory exists
        if (-not (Test-Path $script:CredStorePath)) {
            $null = New-Item -Path $script:CredStorePath -ItemType Directory -Force
        }

        # Encrypt password via DPAPI
        $secureString = ConvertTo-SecureString $Body.password -AsPlainText -Force
        $encrypted = $secureString | ConvertFrom-SecureString

        # Hostname binds the credential to one machine (see Resolve-StoredCredential).
        $credData = @{
            Username = $Body.username
            Password = $encrypted
            Hostname = "$($Body.hostname)".Trim()
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

    $null = Assert-SafeId -Id $serverId -ParamName 'serverId'
    $credFile = Join-Path $script:CredStorePath "$serverId.cred"
    $exists = Test-Path $credFile
    $boundHost = $null
    if ($exists) {
        try {
            $credData = Get-Content $credFile -Raw | ConvertFrom-Json
            if ($credData.PSObject.Properties['Hostname']) { $boundHost = $credData.Hostname }
        } catch {}
    }

    Send-Response -Response $Response -Body @{
        success  = $true
        exists   = $exists
        hostname = $boundHost
    }
}

function Handle-DeleteCredential {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [string]$ServerId
    )

    $null = Assert-SafeId -Id $ServerId -ParamName 'serverId'
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
        if (-not $Body -or -not $Body.serverId -or -not $Body.hostname -or -not $Body.username -or -not $Body.password) {
            Send-Response -Response $Response -Body @{
                success = $false
                error   = 'serverId, hostname, username, and password are required'
            } -StatusCode 400
            return
        }

        $null = Assert-SafeId -Id $Body.serverId -ParamName 'serverId'
        $securePass = ConvertTo-SecureString $Body.password -AsPlainText -Force
        $cred = New-Object System.Management.Automation.PSCredential($Body.username, $securePass)
        $script:SessionCredentials[$Body.serverId] = @{ Credential = $cred; Hostname = "$($Body.hostname)".Trim() }

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
                        $paramName = Assert-PolicyCriterionType -Type $c.type
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

        # Explicitly flatten so single-entry subnet lists stay JSON arrays
        $subnets = @(Get-DnsServerClientSubnet @params -ErrorAction Stop | ForEach-Object {
            @{
                Name       = $_.Name
                IPv4Subnet = @($_.IPv4Subnet | Where-Object { $_ } | ForEach-Object { "$_" })
                IPv6Subnet = @($_.IPv6Subnet | Where-Object { $_ } | ForEach-Object { "$_" })
            }
        })

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
        if ($fetchParams.ContainsKey('CimSession'))    { $removeParams['CimSession'] = $fetchParams['CimSession'] }
        elseif ($fetchParams.ContainsKey('ComputerName')) { $removeParams['ComputerName'] = $fetchParams['ComputerName'] }

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
        if ($fetchParams.ContainsKey('CimSession'))    { $removeParams['CimSession'] = $fetchParams['CimSession'] }
        elseif ($fetchParams.ContainsKey('ComputerName')) { $removeParams['ComputerName'] = $fetchParams['ComputerName'] }

        Remove-DnsServerResourceRecord @removeParams -ErrorAction Stop

        # Step 2: Add new record
        $addParams = @{ ZoneName = $ZoneName; Name = $Body.recordName }
        if ($fetchParams.ContainsKey('CimSession'))    { $addParams['CimSession'] = $fetchParams['CimSession'] }
        elseif ($fetchParams.ContainsKey('ComputerName')) { $addParams['ComputerName'] = $fetchParams['ComputerName'] }

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
                if ($fetchParams.ContainsKey('CimSession'))    { $rollbackParams['CimSession'] = $fetchParams['CimSession'] }
                elseif ($fetchParams.ContainsKey('ComputerName')) { $rollbackParams['ComputerName'] = $fetchParams['ComputerName'] }

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

        # Explicitly flatten — Forwarder is IPAddress[], which ConvertTo-Json
        # serializes as objects (or unwraps to a scalar) instead of a string array
        $scopes = @(Get-DnsServerRecursionScope @params -ErrorAction Stop | ForEach-Object {
            @{
                Name            = $_.Name
                EnableRecursion = [bool]$_.EnableRecursion
                Forwarder       = @($_.Forwarder | Where-Object { $_ } | ForEach-Object { "$_" })
            }
        })

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
                $paramName = Assert-PolicyCriterionType -Type $c.type
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
        $mode = if ($credentialMode) { $credentialMode } else { 'currentUser' }
        return Resolve-ServerCredential -ServerId $serverId -CredentialMode $mode -Hostname $server
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
        $raw = Get-DnsServerSetting @p -ErrorAction Stop -All
        Send-Response -Response $Response -Body @{
            success  = $true
            settings = (ConvertTo-PlainObject $raw)
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

# Resolvers use a background job to avoid blocking the single-threaded listener.
# POST /api/server/resolvers starts the job, GET /api/server/resolvers polls for results.
$script:ResolverJobs = [hashtable]::Synchronized(@{})  # keyed by serverId or 'local'

function Resolve-ExpiredJobs {
    # Remove background-job registry entries older than TtlMinutes (running or finished),
    # stopping any job still attached. Reclaims results nobody polls and jobs that hang.
    param(
        [hashtable]$Registry,
        [int]$TtlMinutes = 30,
        [datetime]$Now = (Get-Date)
    )
    [System.Threading.Monitor]::Enter($Registry.SyncRoot)
    try {
        foreach ($k in @($Registry.Keys)) {
            $entry = $Registry[$k]
            $added = if ($entry -and $entry.ContainsKey('Added')) { $entry.Added } else { [datetime]::MinValue }
            if (($Now - $added).TotalMinutes -ge $TtlMinutes) {
                if ($entry -and $entry.Job) {
                    try { Stop-Job -Job $entry.Job -ErrorAction SilentlyContinue } catch {}
                    try { Remove-Job -Job $entry.Job -Force -ErrorAction SilentlyContinue } catch {}
                }
                $Registry.Remove($k)
            }
        }
    } finally {
        [System.Threading.Monitor]::Exit($Registry.SyncRoot)
    }
}

function Resolve-JobSlot {
    # Atomically claim a background-job slot for Key. Under the registry lock it sweeps
    # expired entries, then returns:
    #   'running'  - Key already has a live (or still-starting) job; don't start another
    #   'full'     - MaxEntries are held by other keys
    #   'reserved' - a Pending placeholder was inserted; the caller must replace it with the
    #                real job entry, or remove it if starting the job fails
    param(
        [hashtable]$Registry,
        [string]$Key,
        [int]$MaxEntries = 16,
        [int]$TtlMinutes = 30,
        [datetime]$Now = (Get-Date)
    )
    [System.Threading.Monitor]::Enter($Registry.SyncRoot)
    try {
        Resolve-ExpiredJobs -Registry $Registry -TtlMinutes $TtlMinutes -Now $Now
        $entry = $Registry[$Key]
        if ($entry -and ($entry.Pending -or ($entry.Job -and $entry.Job.State -eq 'Running'))) {
            return 'running'
        }
        if (-not $entry -and $Registry.Count -ge $MaxEntries) {
            return 'full'
        }
        $Registry[$Key] = @{ Pending = $true; Job = $null; Result = $null; Added = $Now }
        return 'reserved'
    } finally {
        [System.Threading.Monitor]::Exit($Registry.SyncRoot)
    }
}

function Handle-StartResolvers {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [System.Net.HttpListenerRequest]$Request
    )
    $jobKey = $null
    try {
        $p = Resolve-ServerConfigParams -Request $Request
        $qs = $Request.QueryString
        $jobKey = if ($qs['serverId']) { $qs['serverId'] } else { 'local' }

        $slot = Resolve-JobSlot -Registry $script:ResolverJobs -Key $jobKey
        if ($slot -eq 'running') {
            Send-Response -Response $Response -Body @{ success = $true; status = 'running' }
            return
        }
        if ($slot -eq 'full') {
            Send-Response -Response $Response -Body @{ success = $false; error = 'Too many background jobs; try again later.' } -StatusCode 429
            return
        }

        $bgCred = Resolve-BackgroundJobCredential -ResolvedParams $p -Request $Request
        $remoteHost = $bgCred.Host
        $remoteCred = $bgCred.Credential
        $cimComputerName = if ($p.ContainsKey('CimSession')) { $p['CimSession'].ComputerName } else { $null }

        $script:ResolverJobs[$jobKey] = @{
            Added  = Get-Date
            Job    = Start-Job -ScriptBlock {
                param($rHost, $rCred, $cimHost)
                try {
                    # 1. Get DNS client server addresses
                    if ($rHost) {
                        $invokeParams = @{ ComputerName = $rHost; ErrorAction = 'Stop' }
                        if ($rCred) { $invokeParams['Credential'] = $rCred }
                        $interfaces = @(Invoke-Command @invokeParams -ScriptBlock {
                            Get-DnsClientServerAddress -ErrorAction Stop |
                                Where-Object { $_.AddressFamily -in @(2, 23) -and $_.ServerAddresses.Count -gt 0 } |
                                Select-Object InterfaceAlias, AddressFamily, ServerAddresses, InterfaceIndex
                        })
                    } else {
                        $interfaces = @(Get-DnsClientServerAddress -ErrorAction Stop |
                            Where-Object { $_.AddressFamily -in @(2, 23) -and $_.ServerAddresses.Count -gt 0 } |
                            Select-Object InterfaceAlias, AddressFamily, ServerAddresses, InterfaceIndex)
                    }

                    # 2. Get DNS Server forwarder configuration
                    $cimSession = $null
                    $dnsParams = @{}
                    try {
                        if ($cimHost -and $rCred) {
                            $so = New-CimSessionOption -Protocol Dcom
                            $cimSession = New-CimSession -ComputerName $cimHost -Credential $rCred -SessionOption $so -ErrorAction Stop
                            $dnsParams['CimSession'] = $cimSession
                        } elseif ($rHost) {
                            $dnsParams['ComputerName'] = $rHost
                        }
                        $rawFwd = Get-DnsServerForwarder @dnsParams -ErrorAction Stop
                        $forwarders = @{
                            IPAddress   = @($rawFwd.IPAddress | ForEach-Object { "$_" })
                            UseRootHint = [bool]$rawFwd.UseRootHint
                            Timeout     = $rawFwd.Timeout
                        }

                        # 3. Get DNS Server listening addresses
                        $settings = Get-DnsServerSetting @dnsParams -All -ErrorAction Stop
                        $listeningAddresses = @($settings.ListeningIPAddress | ForEach-Object { "$_" })
                    } finally {
                        if ($cimSession) {
                            Remove-CimSession -CimSession $cimSession -ErrorAction SilentlyContinue
                        }
                    }

                    @{
                        success            = $true
                        interfaces         = $interfaces
                        forwarders         = $forwarders
                        listeningAddresses = $listeningAddresses
                    }
                } catch {
                    @{ success = $false; error = $_.Exception.Message }
                }
            } -ArgumentList $remoteHost, $remoteCred, $cimComputerName
            Result = $null
        }

        Send-Response -Response $Response -Body @{ success = $true; status = 'started' }
    } catch {
        # Release a reservation whose job never started.
        if ($jobKey -and $script:ResolverJobs[$jobKey] -and $script:ResolverJobs[$jobKey].Pending) {
            $script:ResolverJobs.Remove($jobKey)
        }
        Send-Response -Response $Response -Body @{ success = $false; error = $_.Exception.Message } -StatusCode 500
    }
}

function Handle-PollResolvers {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [System.Net.HttpListenerRequest]$Request
    )
    try {
        $qs = $Request.QueryString
        $jobKey = if ($qs['serverId']) { $qs['serverId'] } else { 'local' }
        Resolve-ExpiredJobs -Registry $script:ResolverJobs
        $entry = $script:ResolverJobs[$jobKey]

        if ($entry -and $entry.Pending) {
            Send-Response -Response $Response -Body @{ success = $true; status = 'running' }
            return
        }

        if (-not $entry -or -not $entry.Job) {
            if ($entry -and $entry.Result) {
                Send-Response -Response $Response -Body $entry.Result
            } else {
                Send-Response -Response $Response -Body @{ success = $true; status = 'idle' }
            }
            return
        }

        if ($entry.Job.State -eq 'Running') {
            Send-Response -Response $Response -Body @{ success = $true; status = 'running' }
            return
        }

        $result = Receive-Job -Job $entry.Job -ErrorAction SilentlyContinue
        Remove-Job -Job $entry.Job -Force -ErrorAction SilentlyContinue

        if ($result) {
            $script:ResolverJobs[$jobKey] = @{ Job = $null; Result = $result; Added = Get-Date }
            Send-Response -Response $Response -Body $result
        } else {
            $script:ResolverJobs[$jobKey] = @{ Job = $null; Result = $null; Added = Get-Date }
            Send-Response -Response $Response -Body @{ success = $false; error = 'Resolver job returned no results.' } -StatusCode 500
        }
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
        $raw = Get-DnsServerForwarder @p -ErrorAction Stop
        # Explicitly flatten — IPAddress objects need .ToString() not recursion
        $forwarders = @{
            IPAddress   = @($raw.IPAddress | ForEach-Object { "$_" })
            UseRootHint = [bool]$raw.UseRootHint
            Timeout     = $raw.Timeout
        }
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
            cache   = (ConvertTo-PlainObject $cache)
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
            recursion = (ConvertTo-PlainObject $recursion)
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
            blocklist = (ConvertTo-PlainObject $blocklist)
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
            diagnostics = (ConvertTo-PlainObject $diag)
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
            statistics = (ConvertTo-PlainObject $stats)
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
        Send-Response -Response $Response -Body @{ success = $true; rrl = (ConvertTo-PlainObject $rrl) }
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
        Send-Response -Response $Response -Body @{ success = $true; scavenging = (ConvertTo-PlainObject $scav) }
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
        # Test-DnsServer requires -IPAddress and prompts interactively without it.
        # Use Get-DnsServerSetting as a lightweight connectivity check instead.
        $settings = Get-DnsServerSetting @p -ErrorAction Stop
        Send-Response -Response $Response -Body @{
            success = $true
            result  = @{ ServerName = $settings.ComputerName; IsRunning = $true }
        }
    } catch {
        Send-Response -Response $Response -Body @{ success = $false; error = $_.Exception.Message } -StatusCode 500
    }
}

# ── BPA & DoH Handlers ────────────────────────────────────────────────────

# BPA runs in a background job to avoid blocking the single-threaded listener.
# POST /api/server/bpa starts the job, GET /api/server/bpa polls for results.
$script:BpaJobs = [hashtable]::Synchronized(@{})  # keyed by serverId or 'local'

function Handle-StartBpa {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [System.Net.HttpListenerRequest]$Request
    )
    $jobKey = $null
    try {
        $qs = $Request.QueryString
        $jobKey = if ($qs['serverId']) { $qs['serverId'] } else { 'local' }

        # If a BPA job is already running for this server, just acknowledge
        $slot = Resolve-JobSlot -Registry $script:BpaJobs -Key $jobKey
        if ($slot -eq 'running') {
            Send-Response -Response $Response -Body @{
                success = $true
                status  = 'running'
            }
            return
        }
        if ($slot -eq 'full') {
            Send-Response -Response $Response -Body @{ success = $false; error = 'Too many background jobs; try again later.' } -StatusCode 429
            return
        }

        $p = Resolve-ServerConfigParams -Request $Request
        $modelId = 'Microsoft/Windows/DNSServer'

        $bgCred = Resolve-BackgroundJobCredential -ResolvedParams $p -Request $Request
        $remoteHost = $bgCred.Host
        $remoteCred = $bgCred.Credential

        # Launch BPA in a background job so the listener stays responsive
        $script:BpaJobs[$jobKey] = @{ Added = Get-Date; Job = Start-Job -ScriptBlock {
            param($rHost, $rCred)
            $mid = 'Microsoft/Windows/DNSServer'
            try {
                if ($rHost) {
                    $invokeParams = @{ ComputerName = $rHost; ErrorAction = 'Stop' }
                    if ($rCred) { $invokeParams['Credential'] = $rCred }
                    $findings = Invoke-Command @invokeParams -ScriptBlock {
                        param($m)
                        Invoke-BpaModel -ModelId $m -ErrorAction Stop | Out-Null
                        Get-BpaResult -ModelId $m -ErrorAction Stop | ForEach-Object {
                            @{
                                Severity   = if ($_.Severity)   { $_.Severity.ToString() }   else { 'Information' }
                                Category   = if ($_.Category)   { $_.Category.ToString() }   else { 'Other' }
                                Title      = if ($_.Title)      { $_.Title }                 else { '' }
                                Problem    = if ($_.Problem)    { $_.Problem }                else { '' }
                                Impact     = if ($_.Impact)     { $_.Impact }                 else { '' }
                                Resolution = if ($_.Resolution) { $_.Resolution }             else { '' }
                                Compliance = if ($_.Compliance) { $_.Compliance.ToString() }  else { '' }
                                Source     = if ($_.Source)      { $_.Source }                 else { '' }
                                ResultId   = if ($_.ResultId)   { $_.ResultId }               else { '' }
                            }
                        }
                    } -ArgumentList $mid
                } else {
                    Invoke-BpaModel -ModelId $mid -ErrorAction Stop | Out-Null
                    $findings = Get-BpaResult -ModelId $mid -ErrorAction Stop | ForEach-Object {
                        @{
                            Severity   = if ($_.Severity)   { $_.Severity.ToString() }   else { 'Information' }
                            Category   = if ($_.Category)   { $_.Category.ToString() }   else { 'Other' }
                            Title      = if ($_.Title)      { $_.Title }                 else { '' }
                            Problem    = if ($_.Problem)    { $_.Problem }                else { '' }
                            Impact     = if ($_.Impact)     { $_.Impact }                 else { '' }
                            Resolution = if ($_.Resolution) { $_.Resolution }             else { '' }
                            Compliance = if ($_.Compliance) { $_.Compliance.ToString() }  else { '' }
                            Source     = if ($_.Source)      { $_.Source }                 else { '' }
                            ResultId   = if ($_.ResultId)   { $_.ResultId }               else { '' }
                        }
                    }
                }
                $findings = @($findings)
                @{
                    success   = $true
                    findings  = $findings
                    summary   = @{
                        errors      = @($findings | Where-Object { $_.Severity -eq 'Error' }).Count
                        warnings    = @($findings | Where-Object { $_.Severity -eq 'Warning' }).Count
                        information = @($findings | Where-Object { $_.Severity -eq 'Information' }).Count
                    }
                    scannedAt = (Get-Date -Format 'o')
                }
            } catch {
                @{
                    success = $false
                    error   = "BPA failed: $($_.Exception.Message). Ensure the DNS Server role is installed."
                }
            }
        } -ArgumentList $remoteHost, $remoteCred; Result = $null }

        Send-Response -Response $Response -Body @{
            success = $true
            status  = 'started'
        }
    } catch {
        # Release a reservation whose job never started.
        if ($jobKey -and $script:BpaJobs[$jobKey] -and $script:BpaJobs[$jobKey].Pending) {
            $script:BpaJobs.Remove($jobKey)
        }
        Send-Response -Response $Response -Body @{ success = $false; error = $_.Exception.Message } -StatusCode 500
    }
}

function Handle-PollBpa {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [System.Net.HttpListenerRequest]$Request
    )
    try {
        $qs = $Request.QueryString
        $jobKey = if ($qs['serverId']) { $qs['serverId'] } else { 'local' }
        Resolve-ExpiredJobs -Registry $script:BpaJobs
        $entry = $script:BpaJobs[$jobKey]

        if ($entry -and $entry.Pending) {
            Send-Response -Response $Response -Body @{ success = $true; status = 'running' }
            return
        }

        if (-not $entry -or -not $entry.Job) {
            if ($entry -and $entry.Result) {
                Send-Response -Response $Response -Body $entry.Result
            } else {
                Send-Response -Response $Response -Body @{ success = $true; status = 'idle' }
            }
            return
        }

        if ($entry.Job.State -eq 'Running') {
            Send-Response -Response $Response -Body @{ success = $true; status = 'running' }
            return
        }

        # Job completed — collect result
        $result = Receive-Job -Job $entry.Job -ErrorAction SilentlyContinue
        Remove-Job -Job $entry.Job -Force -ErrorAction SilentlyContinue

        if ($result) {
            $script:BpaJobs[$jobKey] = @{ Job = $null; Result = $result; Added = Get-Date }
            Send-Response -Response $Response -Body $result
        } else {
            $script:BpaJobs[$jobKey] = @{ Job = $null; Result = $null; Added = Get-Date }
            Send-Response -Response $Response -Body @{
                success = $false
                error   = 'BPA job completed but returned no results.'
            } -StatusCode 500
        }
    } catch {
        Send-Response -Response $Response -Body @{ success = $false; error = $_.Exception.Message } -StatusCode 500
    }
}

function Handle-GetDohConfig {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [System.Net.HttpListenerRequest]$Request
    )
    try {
        # Inbound DoH is Windows Server 2025+ only — check cmdlet existence before calling
        if (-not (Get-Command Get-DnsServerEncryptionProtocol -ErrorAction SilentlyContinue)) {
            Send-Response -Response $Response -Body @{
                success     = $false
                error       = 'DNS over HTTPS settings require Windows Server 2025 or later.'
                unsupported = $true
            }
            return
        }
        $p = Resolve-ServerConfigParams -Request $Request
        $proto = Get-DnsServerEncryptionProtocol @p -ErrorAction Stop
        Send-Response -Response $Response -Body @{ success = $true; protocol = (ConvertTo-PlainObject $proto) }
    } catch {
        Send-Response -Response $Response -Body @{ success = $false; error = $_.Exception.Message } -StatusCode 500
    }
}

function Handle-SetDohConfig {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [System.Net.HttpListenerRequest]$Request,
        [psobject]$Body
    )
    try {
        # Inbound DoH is Windows Server 2025+ only — check cmdlet existence before calling
        if (-not (Get-Command Set-DnsServerEncryptionProtocol -ErrorAction SilentlyContinue)) {
            Send-Response -Response $Response -Body @{
                success     = $false
                error       = 'DNS over HTTPS settings require Windows Server 2025 or later.'
                unsupported = $true
            }
            return
        }
        if ($null -eq $Body.enableDoh) { throw 'enableDoh (boolean) is required.' }

        $p = Resolve-ServerConfigParams -Request $Request
        $splatParams = @{}
        foreach ($key in $p.Keys) { $splatParams[$key] = $p[$key] }

        $enable = [bool]$Body.enableDoh
        $splatParams['EnableDoh'] = $enable

        # URI templates only apply when enabling. Accept a single string or an array.
        # Set-DnsServerEncryptionProtocol takes one pipe-separated string, max 3 templates.
        # Disabling clears all templates automatically, so we never pass UriTemplate then.
        if ($enable -and $null -ne $Body.uriTemplate) {
            $templates = @(@($Body.uriTemplate) | Where-Object { $_ -and "$_".Trim() } | ForEach-Object { "$_".Trim() })
            if ($templates.Count -gt 3) { throw 'A maximum of 3 URI templates is allowed.' }
            foreach ($t in $templates) {
                if ($t -notmatch '^https://') { throw "URI templates must be valid HTTPS URIs (got '$t')." }
            }
            if ($templates.Count -gt 0) { $splatParams['UriTemplate'] = ($templates -join '|') }
        }

        Set-DnsServerEncryptionProtocol @splatParams -ErrorAction Stop
        # The DNS Server service must be restarted for DoH changes to take effect.
        Send-Response -Response $Response -Body @{ success = $true; restartRequired = $true }
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
        $hints = @(Get-DnsServerRootHint @p -ErrorAction SilentlyContinue | ForEach-Object { ConvertTo-PlainObject $_ })
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
        Send-Response -Response $Response -Body @{ success = $true; edns = (ConvertTo-PlainObject $edns) }
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
        Send-Response -Response $Response -Body @{ success = $true; dsSetting = (ConvertTo-PlainObject $ds) }
    } catch {
        Send-Response -Response $Response -Body @{ success = $false; error = $_.Exception.Message } -StatusCode 500
    }
}

function Handle-GetGlobalNameZone {
    param([System.Net.HttpListenerResponse]$Response, [System.Net.HttpListenerRequest]$Request)
    try {
        $p = Resolve-ServerConfigParams -Request $Request
        $gnz = Get-DnsServerGlobalNameZone @p -ErrorAction Stop
        Send-Response -Response $Response -Body @{ success = $true; globalNameZone = (ConvertTo-PlainObject $gnz) }
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
                $credMode = if ($Body.credentialMode) { $Body.credentialMode } else { 'currentUser' }
                $p = Resolve-ServerCredential -ServerId $Body.serverId -CredentialMode $credMode -Hostname $Body.server
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
                    ZoneFile      = if ($Body.zoneFile) { $Body.zoneFile } else { "$($Body.zoneName).dns" }
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
                    $splatParams['ZoneFile'] = if ($Body.zoneFile) { $Body.zoneFile } else { "$($Body.zoneName).dns" }
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
        $fileName = if ($Body -and $Body.fileName) { Assert-SafeFileName $Body.fileName } else { "$ZoneName.dns" }
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
                $paramName = Assert-PolicyCriterionType -Type $c.type
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

function Handle-ExportServerConfig {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [System.Net.HttpListenerRequest]$Request
    )
    try {
        $p = Resolve-ServerConfigParams -Request $Request
        $dnsServer = Get-DnsServer @p -ErrorAction Stop

        # Flatten each section to plain objects for JSON transport
        $config = @{
            ServerSetting     = ConvertTo-PlainObject $dnsServer.ServerSetting
            ServerCache       = ConvertTo-PlainObject $dnsServer.ServerCache
            ServerRecursion   = ConvertTo-PlainObject $dnsServer.ServerRecursion
            ServerDiagnostics = ConvertTo-PlainObject $dnsServer.ServerDiagnostics
            ServerScavenging  = ConvertTo-PlainObject $dnsServer.ServerScavenging
            ServerEdns        = ConvertTo-PlainObject $dnsServer.ServerEdns
            ServerGlobalQueryBlockList = ConvertTo-PlainObject $dnsServer.ServerGlobalQueryBlockList
        }

        # Forwarders — flatten IPs explicitly
        if ($dnsServer.ServerForwarder) {
            $config['ServerForwarder'] = @{
                IPAddress   = @($dnsServer.ServerForwarder.IPAddress | ForEach-Object { "$_" })
                UseRootHint = [bool]$dnsServer.ServerForwarder.UseRootHint
                Timeout     = $dnsServer.ServerForwarder.Timeout
            }
        }

        # Zone list
        $config['Zones'] = @(Get-DnsServerZone @p -ErrorAction Stop |
            Where-Object { -not $_.IsAutoCreated } |
            Select-Object ZoneName, ZoneType, IsReverseLookupZone, IsDsIntegrated, IsSigned |
            ForEach-Object { ConvertTo-PlainObject $_ })

        Send-Response -Response $Response -Body @{
            success = $true
            config  = $config
        }
    } catch {
        Send-Response -Response $Response -Body @{ success = $false; error = $_.Exception.Message } -StatusCode 500
    }
}

function Handle-ExportAllZones {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [System.Net.HttpListenerRequest]$Request
    )
    try {
        $p = Resolve-ServerConfigParams -Request $Request
        $zones = @(Get-DnsServerZone @p -ErrorAction Stop |
            Where-Object { -not $_.IsAutoCreated -and $_.ZoneType -eq 'Primary' })

        $results = @()
        foreach ($zone in $zones) {
            $zoneName = $zone.ZoneName
            $fileName = "$zoneName.dns"
            try {
                $exportParams = @{ Name = $zoneName; FileName = $fileName }
                foreach ($key in $p.Keys) { $exportParams[$key] = $p[$key] }
                Export-DnsServerZone @exportParams -ErrorAction Stop
                $results += @{ zoneName = $zoneName; fileName = $fileName; success = $true }
            } catch {
                $results += @{ zoneName = $zoneName; success = $false; error = $_.Exception.Message }
            }
        }

        $succeeded = @($results | Where-Object { $_.success }).Count
        $failed    = @($results | Where-Object { -not $_.success }).Count

        Send-Response -Response $Response -Body @{
            success  = $true
            results  = $results
            summary  = @{ total = $zones.Count; succeeded = $succeeded; failed = $failed }
        }
    } catch {
        Send-Response -Response $Response -Body @{ success = $false; error = $_.Exception.Message } -StatusCode 500
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

    $command = $Body.command

    if (-not (Test-CommandAllowed -Command $command)) {
        Send-Response -Response $Response -Body @{
            success = $false
            error   = 'Command not allowed. Only specific DNS cmdlets (optionally piped to Format-Table/List/Select-Object/Sort-Object/Out-String) are permitted.'
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

# ── DNS Lookup Utility ────────────────────────────────────────────────────────

function Handle-DnsLookup {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [System.Net.HttpListenerRequest]$Request,
        $Body
    )

    $tool       = if ($Body.tool)       { $Body.tool.ToLower() } else { 'nslookup' }
    $hostname   = if ($Body.hostname)   { $Body.hostname }   else { '' }
    $server     = if ($Body.server)     { $Body.server }     else { '' }
    $recordType = if ($Body.recordType) { $Body.recordType } else { 'A' }
    $options    = if ($Body.options)     { $Body.options }    else { @{} }

    # Whitelist tools
    $allowedTools = @('nslookup', 'dig')
    if ($tool -notin $allowedTools) {
        Send-Response -Response $Response -Body @{ success = $false; error = "Invalid tool: $tool" } -StatusCode 400
        return
    }

    # Validate hostname
    if (-not $hostname -or $hostname -match '[;&|`$]') {
        Send-Response -Response $Response -Body @{ success = $false; error = 'Invalid hostname' } -StatusCode 400
        return
    }

    # Whitelist record types
    $allowedTypes = @('A','AAAA','CNAME','MX','NS','PTR','SRV','TXT','SOA','ANY')
    if ($recordType -notin $allowedTypes) {
        Send-Response -Response $Response -Body @{ success = $false; error = "Invalid record type: $recordType" } -StatusCode 400
        return
    }

    try {
        # Build splatted params for Resolve-DnsName
        $splatParams = @{
            Name        = $hostname
            Type        = $recordType
            ErrorAction = 'Stop'
        }
        if ($server) { $splatParams['Server'] = $server }
        if ($options.recursive -eq $false) { $splatParams['NoRecursion'] = $true }
        if ($options.tcp -eq $true)        { $splatParams['TcpOnly'] = $true }
        if ($options.dnssec -eq $true)     { $splatParams['DnssecOk'] = $true }

        $cmdDisplay = "Resolve-DnsName -Name '$hostname' -Type $recordType"
        if ($server) { $cmdDisplay += " -Server '$server'" }
        if ($splatParams.ContainsKey('NoRecursion')) { $cmdDisplay += ' -NoRecursion' }
        if ($splatParams.ContainsKey('TcpOnly'))     { $cmdDisplay += ' -TcpOnly' }
        if ($splatParams.ContainsKey('DnssecOk'))    { $cmdDisplay += ' -DnssecOk' }

        $startTime = [System.Diagnostics.Stopwatch]::StartNew()

        # +trace: iterative resolution from root servers
        if ($tool -eq 'dig' -and $options.trace -eq $true) {
            $traceOutput = Format-DigTrace -Hostname $hostname -RecordType $recordType -Options $options
            $startTime.Stop()
            $output = $traceOutput
        } else {
            $results = @(Resolve-DnsName @splatParams)
            $startTime.Stop()
            $queryTime = $startTime.ElapsedMilliseconds

            # Format output based on tool
            $output = if ($tool -eq 'dig') {
                Format-DigOutput -Results $results -Hostname $hostname -Server $server -RecordType $recordType -QueryTime $queryTime -Options $options
            } else {
                Format-NslookupOutput -Results $results -Hostname $hostname -Server $server -RecordType $recordType -QueryTime $queryTime -Options $options
            }
        }

        Send-Response -Response $Response -Body @{
            success = $true
            output  = $output
            command = $cmdDisplay
        }
    } catch {
        $errorOutput = if ($tool -eq 'dig') {
            ";; connection timed out; no servers could be reached`n;; Error: $($_.Exception.Message)"
        } else {
            "*** $($server): can't find $hostname - $($_.Exception.Message)"
        }
        Send-Response -Response $Response -Body @{
            success = $false
            output  = $errorOutput
            command = $cmdDisplay
            error   = $_.Exception.Message
        } -StatusCode 500
    }
}

function Format-NslookupOutput {
    param($Results, $Hostname, $Server, $RecordType, $QueryTime, $Options)

    $lines = [System.Collections.Generic.List[string]]::new()
    $lines.Add("Server:  $Server")
    $lines.Add("Address:  $Server")
    $lines.Add('')

    $debug = ($Options.debug -eq $true)

    if ($Results.Count -eq 0) {
        $lines.Add("*** $Server can't find ${Hostname}: Non-existent domain")
    } else {
        $hasNonAuth = $false
        foreach ($r in $Results) {
            $section = if ($r.Section) { $r.Section.ToString() } else { 'Answer' }
            if ($section -eq 'Additional') { $hasNonAuth = $true }

            switch ($r.Type.ToString()) {
                'A' {
                    if ($debug) {
                        $lines.Add("Name:    $($r.Name)")
                        $lines.Add("Address: $($r.IPAddress)")
                        $lines.Add("TTL:     $($r.TTL)")
                        $lines.Add("Section: $section")
                        $lines.Add('')
                    } else {
                        $lines.Add("Name:    $($r.Name)")
                        $lines.Add("Address: $($r.IPAddress)")
                        $lines.Add('')
                    }
                }
                'AAAA' {
                    if ($debug) {
                        $lines.Add("Name:    $($r.Name)")
                        $lines.Add("Address: $($r.IPAddress)")
                        $lines.Add("TTL:     $($r.TTL)")
                        $lines.Add("Section: $section")
                        $lines.Add('')
                    } else {
                        $lines.Add("Name:    $($r.Name)")
                        $lines.Add("Address: $($r.IPAddress)")
                        $lines.Add('')
                    }
                }
                'CNAME' {
                    $lines.Add("$($r.Name)  canonical name = $($r.NameHost)")
                    if ($debug) { $lines.Add("TTL:     $($r.TTL)"); $lines.Add('') }
                }
                'MX' {
                    $lines.Add("$Hostname  MX preference = $($r.Preference), mail exchanger = $($r.NameExchange)")
                    if ($debug) { $lines.Add("TTL:     $($r.TTL)"); $lines.Add('') }
                }
                'NS' {
                    $lines.Add("$Hostname  nameserver = $($r.NameHost)")
                    if ($debug) { $lines.Add("TTL:     $($r.TTL)"); $lines.Add('') }
                }
                'SOA' {
                    $lines.Add("$Hostname")
                    $lines.Add("  primary name server = $($r.PrimaryServer)")
                    $lines.Add("  responsible mail addr = $($r.NameAdministrator)")
                    $lines.Add("  serial  = $($r.SerialNumber)")
                    $lines.Add("  refresh = $($r.RefreshInterval)")
                    $lines.Add("  retry   = $($r.RetryDelay)")
                    $lines.Add("  expire  = $($r.ExpireLimit)")
                    $lines.Add("  default TTL = $($r.MinimumTimeToLive)")
                    $lines.Add('')
                }
                'TXT' {
                    $txt = if ($r.Strings) { ($r.Strings -join '') } else { $r.Text }
                    $lines.Add("$($r.Name)  text = `"$txt`"")
                    if ($debug) { $lines.Add("TTL:     $($r.TTL)"); $lines.Add('') }
                }
                'SRV' {
                    $lines.Add("$($r.Name)  SRV service location:")
                    $lines.Add("  priority = $($r.Priority), weight = $($r.Weight), port = $($r.Port), target = $($r.NameTarget)")
                    if ($debug) { $lines.Add("TTL:     $($r.TTL)"); $lines.Add('') }
                }
                'PTR' {
                    $lines.Add("$($r.Name)  name = $($r.NameHost)")
                    if ($debug) { $lines.Add("TTL:     $($r.TTL)"); $lines.Add('') }
                }
                default {
                    $lines.Add("$($r.Name)  type = $($r.Type)  data = $($r | ConvertTo-Json -Compress)")
                    if ($debug) { $lines.Add('') }
                }
            }
        }
        if ($hasNonAuth -and -not $debug) {
            $lines.Insert(2, 'Non-authoritative answer:')
        }
    }

    if ($debug) {
        $lines.Add("Query time: ${QueryTime}ms")
    }

    return ($lines -join "`n")
}

function Format-DigOutput {
    param($Results, $Hostname, $Server, $RecordType, $QueryTime, $Options)

    $lines = [System.Collections.Generic.List[string]]::new()
    $short = ($Options.short -eq $true)

    if ($short) {
        foreach ($r in $Results) {
            switch ($r.Type.ToString()) {
                'A'     { $lines.Add($r.IPAddress) }
                'AAAA'  { $lines.Add($r.IPAddress) }
                'CNAME' { $lines.Add($r.NameHost) }
                'MX'    { $lines.Add("$($r.Preference) $($r.NameExchange)") }
                'NS'    { $lines.Add($r.NameHost) }
                'PTR'   { $lines.Add($r.NameHost) }
                'TXT'   { $txt = if ($r.Strings) { ($r.Strings -join '') } else { $r.Text }; $lines.Add("`"$txt`"") }
                'SRV'   { $lines.Add("$($r.Priority) $($r.Weight) $($r.Port) $($r.NameTarget)") }
                'SOA'   { $lines.Add("$($r.PrimaryServer) $($r.NameAdministrator) $($r.SerialNumber) $($r.RefreshInterval) $($r.RetryDelay) $($r.ExpireLimit) $($r.MinimumTimeToLive)") }
                default { $lines.Add(($r | ConvertTo-Json -Compress)) }
            }
        }
        return ($lines -join "`n")
    }

    # Full dig-style output
    $multiline = ($Options.multiline -eq $true)

    if ($Options.comments -ne $false) {
        $lines.Add("; <<>> Resolve-DnsName <<>> $Hostname $RecordType")
        $lines.Add(";; global options: +cmd")
        $lines.Add('')
    }

    # Question section
    if ($Options.question -ne $false) {
        $lines.Add(';; QUESTION SECTION:')
        $lines.Add(";$($Hostname.PadRight(28)) IN  $RecordType")
        $lines.Add('')
    }

    # Group results by section
    $answerRecords = @($Results | Where-Object { -not $_.Section -or $_.Section.ToString() -eq 'Answer' })
    $authorityRecords = @($Results | Where-Object { $_.Section -and $_.Section.ToString() -eq 'Authority' })
    $additionalRecords = @($Results | Where-Object { $_.Section -and $_.Section.ToString() -eq 'Additional' })

    if ($answerRecords.Count -gt 0 -and $Options.answer -ne $false) {
        if ($Options.comments -ne $false) { $lines.Add(';; ANSWER SECTION:') }
        foreach ($r in $answerRecords) {
            $lines.Add((Format-DigRecord $r -Multiline:$multiline))
        }
        $lines.Add('')
    }

    if ($authorityRecords.Count -gt 0 -and $Options.authority -ne $false) {
        if ($Options.comments -ne $false) { $lines.Add(';; AUTHORITY SECTION:') }
        foreach ($r in $authorityRecords) {
            $lines.Add((Format-DigRecord $r -Multiline:$multiline))
        }
        $lines.Add('')
    }

    if ($additionalRecords.Count -gt 0 -and $Options.additional -ne $false) {
        if ($Options.comments -ne $false) { $lines.Add(';; ADDITIONAL SECTION:') }
        foreach ($r in $additionalRecords) {
            $lines.Add((Format-DigRecord $r -Multiline:$multiline))
        }
        $lines.Add('')
    }

    if ($Options.stats -ne $false) {
        $lines.Add(";; Query time: ${QueryTime} msec")
        $lines.Add(";; SERVER: ${Server}")
        $lines.Add(";; WHEN: $(Get-Date -Format 'ddd MMM dd HH:mm:ss yyyy')")
        $lines.Add(";; MSG SIZE  rcvd: $($Results.Count) records")
    }

    return ($lines -join "`n")
}

function Format-DigRecord {
    param($Record, [switch]$Multiline)
    $name = $Record.Name.PadRight(28)
    $ttl  = if ($Record.TTL) { "$($Record.TTL)".PadRight(6) } else { '0'.PadRight(6) }
    $type = $Record.Type.ToString().PadRight(6)

    if ($Multiline -and $Record.Type.ToString() -eq 'SOA') {
        $soaLines = @(
            "$name $ttl IN  $type $($Record.PrimaryServer) $($Record.NameAdministrator) ("
            "                                $($Record.SerialNumber)  ; serial"
            "                                $($Record.RefreshInterval)       ; refresh"
            "                                $($Record.RetryDelay)       ; retry"
            "                                $($Record.ExpireLimit)       ; expire"
            "                                $($Record.MinimumTimeToLive)       ; minimum"
            "                                )"
        )
        return ($soaLines -join "`n")
    }

    $data = switch ($Record.Type.ToString()) {
        'A'     { $Record.IPAddress }
        'AAAA'  { $Record.IPAddress }
        'CNAME' { $Record.NameHost }
        'MX'    { "$($Record.Preference) $($Record.NameExchange)" }
        'NS'    { $Record.NameHost }
        'PTR'   { $Record.NameHost }
        'TXT'   { $txt = if ($Record.Strings) { ($Record.Strings -join '') } else { $Record.Text }; "`"$txt`"" }
        'SRV'   { "$($Record.Priority) $($Record.Weight) $($Record.Port) $($Record.NameTarget)" }
        'SOA'   { "$($Record.PrimaryServer) $($Record.NameAdministrator) $($Record.SerialNumber) $($Record.RefreshInterval) $($Record.RetryDelay) $($Record.ExpireLimit) $($Record.MinimumTimeToLive)" }
        default { $Record | ConvertTo-Json -Compress }
    }

    return "$name $ttl IN  $type $data"
}

function Format-DigTrace {
    param($Hostname, $RecordType, $Options)

    $lines = [System.Collections.Generic.List[string]]::new()
    $lines.Add("; <<>> Resolve-DnsName <<>> +trace $Hostname $RecordType")
    $lines.Add(";; global options: +cmd")

    # Build the delegation chain from labels: e.g. example.co.uk -> [uk, co.uk, example.co.uk]
    $parts = $Hostname.TrimEnd('.').Split('.')
    $delegationNames = [System.Collections.Generic.List[string]]::new()
    for ($i = $parts.Count - 1; $i -ge 0; $i--) {
        $delegationNames.Add(($parts[$i..($parts.Count - 1)] -join '.'))
    }

    # Step 1: Get root server to start iterative queries
    $nextServer = $null
    try {
        $lines.Add('')
        $lines.Add(';; Querying root servers:')
        $rootNs = @(Resolve-DnsName -Name '.' -Type NS -ErrorAction Stop)
        foreach ($r in $rootNs) {
            if ($r.Type.ToString() -eq 'NS') {
                $lines.Add(".                            518400 IN  NS     $($r.NameHost)")
                if (-not $nextServer) { $nextServer = $r.NameHost }
            }
        }
    } catch {
        $lines.Add(";; ERROR querying root: $($_.Exception.Message)")
    }

    # Walk the delegation chain, querying each level's NS against the previous level's server
    foreach ($name in $delegationNames) {
        if (-not $nextServer) { break }
        $queryServer = $nextServer
        $nextServer = $null
        try {
            $lines.Add('')
            $sw = [System.Diagnostics.Stopwatch]::StartNew()
            $nsResults = @(Resolve-DnsName -Name $name -Type NS -Server $queryServer -NoRecursion -ErrorAction Stop)
            $sw.Stop()
            $lines.Add(";; Received from ${queryServer} for ${name}. ($($sw.ElapsedMilliseconds) ms):")
            foreach ($r in $nsResults) {
                if ($r.Type.ToString() -eq 'NS') {
                    $lines.Add((Format-DigRecord $r))
                    if (-not $nextServer) { $nextServer = $r.NameHost }
                } elseif ($r.Type.ToString() -eq 'SOA') {
                    # Hit authoritative — SOA means this server owns the zone
                    $lines.Add((Format-DigRecord $r))
                }
            }
        } catch {
            $lines.Add('')
            $lines.Add(";; Query to ${queryServer} for ${name} NS failed: $($_.Exception.Message)")
        }
    }

    # Final query: ask the last authoritative server for the actual record
    $authServer = if ($nextServer) { $nextServer } else { $queryServer }
    if ($authServer) {
        try {
            $lines.Add('')
            $sw = [System.Diagnostics.Stopwatch]::StartNew()
            $finalResults = @(Resolve-DnsName -Name $Hostname -Type $RecordType -Server $authServer -NoRecursion -ErrorAction Stop)
            $sw.Stop()
            $lines.Add(";; Received from ${authServer} for ${Hostname}. ($($sw.ElapsedMilliseconds) ms):")
            foreach ($r in $finalResults) {
                $lines.Add((Format-DigRecord $r))
            }
        } catch {
            $lines.Add(";; Final query to ${authServer} failed: $($_.Exception.Message)")
        }
    }

    $lines.Add('')
    $lines.Add(";; WHEN: $(Get-Date -Format 'ddd MMM dd HH:mm:ss yyyy')")

    return ($lines -join "`n")
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

    # CSRF guard: reject browser requests from untrusted origins. This runs BEFORE
    # the OPTIONS preflight so untrusted origins receive a consistent 403 rather than
    # a 204 preflight. Allowlisted origins and no-Origin requests still pass, so the
    # legitimate UI preflight (e.g. from localhost:10010) continues to work.
    if (-not (Test-OriginAllowed -Request $request)) {
        Send-Response -Response $response -Body @{
            success = $false
            error   = 'Origin not allowed'
        } -StatusCode 403
        return
    }

    # Handle CORS preflight
    if ($method -eq 'OPTIONS') {
        Send-Preflight -Response $response
        return
    }

    # Every endpoint but the health probe needs the bridge token.
    if ($path -ne '/api/health' -and -not (Test-RequestAuthorized -Request $request -Token $script:BridgeToken)) {
        Send-Response -Response $response -Body @{
            success = $false
            error   = 'Unauthorized: missing or invalid bridge token'
        } -StatusCode 401
        return
    }

    # Refuse oversized bodies before reading them. Chunked bodies (no Content-Length)
    # are capped while reading, in Read-BoundedText.
    if ($request.ContentLength64 -gt (Get-MaxRequestBodyBytes)) {
        Send-Response -Response $response -Body @{
            success = $false
            error   = 'Request body too large'
        } -StatusCode 413
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
            '^/api/export/serverconfig$' {
                if ($method -eq 'GET') {
                    Handle-ExportServerConfig -Response $response -Request $request
                } else { Send-Response -Response $response -Body @{ success = $false; error = 'Method not allowed' } -StatusCode 405 }
            }
            '^/api/export/allzones$' {
                if ($method -eq 'POST') {
                    Handle-ExportAllZones -Response $response -Request $request
                } else { Send-Response -Response $response -Body @{ success = $false; error = 'Method not allowed' } -StatusCode 405 }
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
            '^/api/server/resolvers$' {
                switch ($method) {
                    'POST'   { Handle-StartResolvers -Response $response -Request $request }
                    'GET'    { Handle-PollResolvers -Response $response -Request $request }
                    default  { Send-Response -Response $response -Body @{ success = $false; error = 'Method not allowed' } -StatusCode 405 }
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
                switch ($method) {
                    'POST' { Handle-StartBpa -Response $response -Request $request }
                    'GET'  { Handle-PollBpa -Response $response -Request $request }
                    default { Send-Response -Response $response -Body @{ success = $false; error = 'Method not allowed' } -StatusCode 405 }
                }
            }
            '^/api/doh/config$' {
                switch ($method) {
                    'GET' { Handle-GetDohConfig -Response $response -Request $request }
                    'PUT' { $body = Read-RequestBody -Request $request; Handle-SetDohConfig -Response $response -Request $request -Body $body }
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
            # ── Utilities ──────────────────────────────────
            '^/api/utilities/dns-lookup$' {
                if ($method -eq 'POST') {
                    $body = Read-RequestBody -Request $request
                    Handle-DnsLookup -Response $response -Request $request -Body $body
                } else {
                    Send-Response -Response $response -Body @{ success = $false; error = 'Method not allowed' } -StatusCode 405
                }
            }
            default {
                Send-Response -Response $response -Body @{ success = $false; error = "Not found: $path" } -StatusCode 404
            }
        }
    } catch [System.IO.InvalidDataException] {
        try {
            Send-Response -Response $response -Body @{
                success = $false
                error   = $_.Exception.Message
            } -StatusCode 413
        } catch {
            # Response may already be closed
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

$loopbackBinds = @('127.0.0.1', 'localhost', '::1', '[::1]')
if (($loopbackBinds -notcontains $BindAddress) -and -not $AllowRemote) {
    Write-Host ''
    Write-Host "  ERROR: -BindAddress $BindAddress exposes the bridge beyond this machine." -ForegroundColor Red
    Write-Host '  Saved/session credentials and DNS changes would then cross the network. Re-run with' -ForegroundColor Yellow
    Write-Host '  -AllowRemote to confirm, and prefer -UseHttps or a TLS reverse proxy on untrusted networks.' -ForegroundColor Yellow
    Write-Host ''
    exit 1
}

# Bridge token: explicit -Token / DNS_BRIDGE_TOKEN, else the token file from a previous start
# (so restarts don't sign every browser out), else a fresh random one.
$tokenFile = Join-Path $env:LOCALAPPDATA 'DNSPolicyManager\bridge.token'
$tokenSource = $null
if ([string]::IsNullOrWhiteSpace($Token) -and -not $RotateToken -and (Test-Path $tokenFile)) {
    try {
        $existing = ([System.IO.File]::ReadAllText($tokenFile)).Trim()
        if ($existing.Length -ge 32) { $Token = $existing; $tokenSource = 'reused' }
    } catch {}
}
if ([string]::IsNullOrWhiteSpace($Token)) {
    $tokenBytes = New-Object byte[] 32
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $rng.GetBytes($tokenBytes)
    $rng.Dispose()
    $Token = [Convert]::ToBase64String($tokenBytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
    $tokenSource = 'generated'
} elseif (-not $tokenSource) {
    $Token = $Token.Trim()
    $tokenSource = 'supplied'
}
$script:BridgeToken = $Token

$scheme = if ($UseHttps) { 'https' } else { 'http' }
$prefix = "${scheme}://${BindAddress}:${Port}/"
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
    $prefixes += "${scheme}://localhost:${Port}/"
} elseif ($BindAddress -eq '0.0.0.0') {
    $prefixes = @("${scheme}://+:${Port}/")
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

# Publish the token only once this instance owns the port, so a launch that fails to bind
# never overwrites the token another running bridge is using.
# Write the token where the local frontend and MCP server look for it, readable only by
# this user (and SYSTEM / Administrators).
try {
    $tokenDir = Split-Path -Parent $tokenFile
    if (-not (Test-Path $tokenDir)) { $null = New-Item -ItemType Directory -Path $tokenDir -Force }
    # Lock the (empty) file down first, then write the token, so it is never readable through
    # inherited permissions. Uses the .NET ACL API rather than Set-Acl, which lives in a module
    # that can fail to load (e.g. when started from pwsh with a 7.x PSModulePath).
    [System.IO.File]::WriteAllText($tokenFile, '')
    $acl = New-Object System.Security.AccessControl.FileSecurity
    $acl.SetAccessRuleProtection($true, $false)
    $identities = @(
        [System.Security.Principal.WindowsIdentity]::GetCurrent().User,
        (New-Object System.Security.Principal.SecurityIdentifier('S-1-5-18')),
        (New-Object System.Security.Principal.SecurityIdentifier('S-1-5-32-544'))
    )
    foreach ($id in $identities) {
        $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($id, 'FullControl', 'Allow')))
    }
    $fileInfo = New-Object System.IO.FileInfo($tokenFile)
    if ($fileInfo | Get-Member -Name SetAccessControl -MemberType Method) {
        $fileInfo.SetAccessControl($acl)                                      # .NET Framework (PS 5.1)
    } else {
        [System.IO.FileSystemAclExtensions]::SetAccessControl($fileInfo, $acl) # .NET (pwsh 7)
    }
    [System.IO.File]::WriteAllText($tokenFile, $Token)
} catch {
    Write-Log "Could not write bridge token file ${tokenFile}: $($_.Exception.Message)" 'WARN'
}

try {
    Write-Host ''
    Write-Host '  DNS Policy Manager - PowerShell Bridge' -ForegroundColor Cyan
    Write-Host "  Listening on $prefix" -ForegroundColor Green
    Write-Host "  Bridge token ($tokenSource) written to $tokenFile" -ForegroundColor Gray
    if (-not $UseHttps -and ($loopbackBinds -notcontains $BindAddress)) {
        Write-Host '  WARNING: plain HTTP on a network interface - credentials are sent unencrypted.' -ForegroundColor Yellow
    }
    Write-Host "  DNS Module: $(if (Test-DnsModule) { 'Available' } else { 'Not Found' })" -ForegroundColor $(if (Test-DnsModule) { 'Green' } else { 'Yellow' })
    Write-Host '  Press Ctrl+C to stop' -ForegroundColor DarkGray
    Write-Host ''

    # ── Concurrent Request Handling via Runspace Pool ────────────────────────
    # The main thread accepts connections. Each request is dispatched to a
    # pooled PowerShell runspace so the listener stays responsive.
    # All functions are injected into the InitialSessionState so runspaces
    # can call Route-Request and all handlers. Shared mutable state is
    # passed via a synchronized hashtable.

    # Collect all functions defined in this session into InitialSessionState
    $iss = [System.Management.Automation.Runspaces.InitialSessionState]::CreateDefault()
    Get-ChildItem Function: | Where-Object { $_.Name -match '^(Route-|Handle-|Send-|Read-|Resolve-|ConvertTo-|Write-|Test-|Get-QueryParam|Get-MaxRequestBodyBytes|Assert-|Format-)' } | ForEach-Object {
        $entry = [System.Management.Automation.Runspaces.SessionStateFunctionEntry]::new($_.Name, $_.Definition)
        $iss.Commands.Add($entry)
    }

    # Shared state: synchronized hashtable visible to all runspaces
    $sharedState = [hashtable]::Synchronized(@{
        SessionCredentials = $script:SessionCredentials
        CredStorePath      = $script:CredStorePath
        BpaJobs            = [hashtable]::Synchronized(@{})
        ResolverJobs       = [hashtable]::Synchronized(@{})
        AllowedOrigins     = $script:AllowedOrigins
        BridgeToken        = $script:BridgeToken
    })
    $iss.Variables.Add(
        [System.Management.Automation.Runspaces.SessionStateVariableEntry]::new(
            'script:SessionCredentials', $sharedState.SessionCredentials, ''
        )
    )
    $iss.Variables.Add(
        [System.Management.Automation.Runspaces.SessionStateVariableEntry]::new(
            'script:CredStorePath', $sharedState.CredStorePath, ''
        )
    )
    $iss.Variables.Add(
        [System.Management.Automation.Runspaces.SessionStateVariableEntry]::new(
            'SharedState', $sharedState, ''
        )
    )
    $iss.Variables.Add(
        [System.Management.Automation.Runspaces.SessionStateVariableEntry]::new(
            'AllowedOrigins', $AllowedOrigins, ''
        )
    )

    $poolSize = [Math]::Max(4, [Environment]::ProcessorCount * 2)
    $pool = [RunspaceFactory]::CreateRunspacePool(1, $poolSize, $iss, $Host)
    $pool.Open()
    Write-Log "Runspace pool opened (max $poolSize threads)"

    # Track active runspaces for cleanup
    $activeRunspaces = [System.Collections.Generic.List[object]]::new()

    while ($listener.IsListening) {
        $context = $listener.GetContext()

        # Prune completed runspaces
        for ($i = $activeRunspaces.Count - 1; $i -ge 0; $i--) {
            $r = $activeRunspaces[$i]
            if ($r.Handle.IsCompleted) {
                try { $r.Shell.EndInvoke($r.Handle) } catch {}
                $r.Shell.Dispose()
                $activeRunspaces.RemoveAt($i)
            }
        }

        # Dispatch to runspace pool
        $ps = [PowerShell]::Create()
        $ps.RunspacePool = $pool
        $null = $ps.AddScript({
            param($ctx, $state)
            # Bind shared state into script scope for handlers
            $script:SessionCredentials = $state.SessionCredentials
            $script:CredStorePath      = $state.CredStorePath
            $script:BpaJobs            = $state.BpaJobs
            $script:ResolverJobs       = $state.ResolverJobs
            $script:AllowedOrigins     = $state.AllowedOrigins
            $script:BridgeToken        = $state.BridgeToken
            $script:RequestCimSessions = @()

            try {
                Route-Request -Context $ctx
            } catch {
                try {
                    Send-Response -Response $ctx.Response -Body @{
                        success = $false
                        error   = "Internal server error: $($_.Exception.Message)"
                    } -StatusCode 500
                } catch {}
            } finally {
                foreach ($s in $script:RequestCimSessions) {
                    try { Remove-CimSession -CimSession $s -ErrorAction SilentlyContinue } catch {}
                }
                $script:RequestCimSessions = @()
            }

            # Write back mutable state
            $state.BpaJobs      = $script:BpaJobs
            $state.ResolverJobs = $script:ResolverJobs
        }).AddArgument($context).AddArgument($sharedState)

        $handle = $ps.BeginInvoke()
        $activeRunspaces.Add(@{ Shell = $ps; Handle = $handle })
    }
} catch [System.Net.HttpListenerException] {
    if ($_.Exception.ErrorCode -ne 995) {
        # 995 = operation aborted (Ctrl+C) - expected
        Write-Log "Listener error: $($_.Exception.Message)" 'ERROR'
    }
} finally {
    Write-Log 'Shutting down bridge...'

    foreach ($r in $activeRunspaces) {
        try {
            if (-not $r.Handle.IsCompleted) { $r.Shell.Stop() }
            $r.Shell.Dispose()
        } catch {}
    }

    if ($pool) {
        $pool.Close()
        $pool.Dispose()
    }

    if ($listener.IsListening) {
        $listener.Stop()
    }
    $listener.Close()
    Write-Log 'Bridge stopped.'
}
