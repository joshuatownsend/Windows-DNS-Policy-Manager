#Requires -Modules @{ ModuleName = 'Pester'; ModuleVersion = '5.0' }

BeforeAll {
    . (Join-Path $PSScriptRoot 'TestHelpers.ps1')
    . ([scriptblock]::Create((Get-BridgeFunctionSource)))
}

Describe 'Test-CommandAllowed (issue #137)' {
    Context 'legitimate DNS commands' {
        It 'allows <_>' -ForEach @(
            'Get-DnsServerZone'
            'Get-DnsServerZone | Format-Table'
            'Get-DnsServerZone -ZoneName "contoso.com" | Select-Object ZoneName, ZoneType'
            'Get-DnsServerZone | Select-Object ZoneName, @{n="Type";e={$_.ZoneType}}'
            'Get-DnsServerResourceRecord -ZoneName contoso.com | Sort-Object { $_.HostName } | Format-List'
            'Get-DnsServerResourceRecord -ZoneName contoso.com -RRType A | Select-Object -First 5 | Out-String'
            'Add-DnsServerResourceRecordA -ZoneName contoso.com -Name www -IPv4Address 10.0.0.5'
            'Add-DnsServerQueryResolutionPolicy -Name "Block_x" -Action DENY -Fqdn "EQ,*.ads.example" -PassThru'
            'Remove-DnsServerZone -Name old.contoso.com -Force'
            'Set-DnsServerRecursion -Enable $true'
            'Get-DnsServerForwarder | Format-List IPAddress, @{Name="Count"; Expression={ $_.IPAddress.Count }}'
            'Get-DnsServerZone | Format-Table -Property ZoneName, IsDsIntegrated -AutoSize'
            'Get-DnsServerStatistics | Select-Object -ExpandProperty QueryStatistics'
            'Resolve-DnsName -Name example.com -Type AAAA'
            'Get-Service DNS'
            'Get-DnsServerZone | Sort-Object { -not $_.IsAutoCreated }, ZoneName'
            'Get-DnsServerZone | Select-Object @{n="Label";e={ "{0} ({1})" -f $_.ZoneName, $_.ZoneType }}'
            'Get-DnsServerResourceRecord -ZoneName contoso.com | Select-Object @{n="Ttl";e={ $_.TimeToLive.TotalSeconds / 60 }}'
            'Get-DnsServerZone | Format-Table @{n="Ad";e={ $_.IsDsIntegrated -and $_.ZoneType -eq "Primary" }}'
        ) {
            Test-CommandAllowed $_ | Should -BeTrue
        }
    }

    Context 'code execution and side-effect attempts' {
        It 'rejects <_>' -ForEach @(
            # Reported in #137: runtime ScriptBlock creation and invocation
            'Get-DnsServerZone | Select-Object @{n="x";e=[scriptblock]::Create("Start-Process calc")}'
            'Get-DnsServerZone | Select-Object @{n="x";e={ ([scriptblock]"calc").Invoke() }}'
            'Get-DnsServerZone | Select-Object @{n="x";e=[scriptblock]"Start-Process calc"}'
            'Get-DnsServerZone | Select-Object @{n="x";e={ & ([scriptblock]"calc") }}'
            # Casts, type literals, static members
            '[System.IO.File]::ReadAllText("C:\secret.txt")'
            'Get-DnsServerZone -ZoneName ([System.Environment]::MachineName)'
            'Get-DnsServerZone -ZoneName ([string]$env:USERNAME)'
            # Subexpressions and arbitrary variables
            'Get-DnsServerZone -ZoneName "$(Start-Process calc)"'
            'Get-DnsServerZone -ZoneName $(Start-Process calc)'
            'Get-DnsServerZone -ZoneName $env:COMPUTERNAME'
            'Get-DnsServerZone -ZoneName $ExecutionContext'
            'Get-DnsServerZone @args'
            'Get-DnsServerZone -ZoneName $using:x'
            # Commands outside the allowlist, anywhere in the input
            'Start-Process calc'
            'Get-DnsServerZone; Remove-Item C:\important -Recurse'
            'Get-DnsServerZone | ForEach-Object { Start-Process calc }'
            'Get-DnsServerZone | Select-Object @{n="x";e={ Start-Process calc }}'
            'Get-DnsServerZone | Where-Object { $_.ZoneName }'
            # Dynamic or path-based invocation
            '& $cmd'
            '& "Start-Process" calc'
            '. Get-DnsServerZone'
            'C:\tools\Get-DnsServerZone.ps1'
            '.\Get-DnsServerZone.ps1'
            # Redefinition, redirection, control flow
            '${function:Get-DnsServerZone} = "Start-Process calc"; Get-DnsServerZone'
            'function Get-DnsServerZone { Start-Process calc }; Get-DnsServerZone'
            'Get-DnsServerZone > C:\evil.txt'
            'Get-DnsServerZone 2> C:\evil.txt'
            'if ($true) { Get-DnsServerZone }'
            'foreach ($z in 1) { Get-DnsServerZone }'
            # Operators that convert types or take script blocks
            'Get-DnsServerZone | Select-Object @{n="x";e={ "C:\temp\x.txt" -as "System.IO.StreamWriter" }}'
            'Get-DnsServerZone | Select-Object @{n="x";e={ $_ -is "System.Object" }}'
            'Get-DnsServerZone | Select-Object @{n="x";e={ $_.ZoneName -replace "a", { "b" } }}'
            'Get-DnsServerZone | Select-Object @{n="x";e={ $_.ZoneName -split "." }}'
            'Get-DnsServerZone | Select-Object @{n="x";e={ -split $_.ZoneName }}'
            # Script blocks passed to non-formatter commands
            'Get-DnsServerZone -ZoneName { Start-Process calc }'
            # Degenerate input
            ''
            '   '
            '"just a string"'
            'Get-DnsServerZone -ZoneName "unterminated'
        ) {
            Test-CommandAllowed $_ | Should -BeFalse
        }
    }
}

Describe 'Read-BoundedText (issue #141)' {
    It 'returns the text when under the limit' {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes('{"name":"x"}')
        $stream = [System.IO.MemoryStream]::new($bytes)
        Read-BoundedText -Stream $stream -Encoding ([System.Text.Encoding]::UTF8) -MaxBytes 100 |
            Should -Be '{"name":"x"}'
    }

    It 'accepts a body exactly at the limit' {
        $stream = [System.IO.MemoryStream]::new([byte[]]::new(100))
        (Read-BoundedText -Stream $stream -Encoding ([System.Text.Encoding]::UTF8) -MaxBytes 100).Length |
            Should -Be 100
    }

    It 'throws InvalidDataException past the limit' {
        $stream = [System.IO.MemoryStream]::new([byte[]]::new(200000))
        { Read-BoundedText -Stream $stream -Encoding ([System.Text.Encoding]::UTF8) -MaxBytes 100000 } |
            Should -Throw -ExceptionType ([System.IO.InvalidDataException])
    }

    It 'caps request bodies at 1 MB' {
        Get-MaxRequestBodyBytes | Should -Be 1MB
    }
}

Describe 'Resolve-JobSlot / Resolve-ExpiredJobs (issue #141)' {
    BeforeEach {
        $now = [datetime]'2026-10-24T12:00:00'
        $registry = [hashtable]::Synchronized(@{})
    }

    It 'reserves a slot for a new key with a Pending placeholder' {
        Resolve-JobSlot -Registry $registry -Key 'a' -Now $now | Should -Be 'reserved'
        $registry['a'].Pending | Should -BeTrue
        $registry['a'].Added | Should -Be $now
    }

    It 'reports running while a reservation is still starting' {
        Resolve-JobSlot -Registry $registry -Key 'a' -Now $now | Should -Be 'reserved'
        Resolve-JobSlot -Registry $registry -Key 'a' -Now $now | Should -Be 'running'
    }

    It 'counts reservations toward the cap, so concurrent starts cannot overshoot it' {
        Resolve-JobSlot -Registry $registry -Key 'a' -MaxEntries 2 -Now $now | Should -Be 'reserved'
        Resolve-JobSlot -Registry $registry -Key 'b' -MaxEntries 2 -Now $now | Should -Be 'reserved'
        Resolve-JobSlot -Registry $registry -Key 'c' -MaxEntries 2 -Now $now | Should -Be 'full'
        $registry.Count | Should -Be 2
    }

    It 'lets a key with a finished result start again at the cap' {
        $registry['a'] = @{ Job = $null; Result = @{ success = $true }; Added = $now }
        $registry['b'] = @{ Job = $null; Result = $null; Added = $now }
        Resolve-JobSlot -Registry $registry -Key 'a' -MaxEntries 2 -Now $now | Should -Be 'reserved'
    }

    It 'reclaims an expired entry for the same key instead of reporting running' {
        $registry['a'] = @{ Pending = $true; Job = $null; Result = $null; Added = $now.AddMinutes(-31) }
        Resolve-JobSlot -Registry $registry -Key 'a' -TtlMinutes 30 -Now $now | Should -Be 'reserved'
        $registry['a'].Added | Should -Be $now
    }

    It 'expires entries older than the TTL and keeps fresh ones' {
        $registry['old'] = @{ Job = $null; Result = @{ success = $true }; Added = $now.AddMinutes(-31) }
        $registry['new'] = @{ Job = $null; Added = $now.AddMinutes(-5) }
        Resolve-ExpiredJobs -Registry $registry -TtlMinutes 30 -Now $now
        $registry.ContainsKey('old') | Should -BeFalse
        $registry.ContainsKey('new') | Should -BeTrue
    }

    It 'expires entries that have no timestamp' {
        $registry['legacy'] = @{ Job = $null; Result = $null }
        Resolve-ExpiredJobs -Registry $registry -Now $now
        $registry.Count | Should -Be 0
    }

    It 'stops and removes a hung job even when the same key asks again' {
        $job = Start-Job -ScriptBlock { Start-Sleep -Seconds 60 }
        try {
            $registry['hung'] = @{ Job = $job; Result = $null; Added = $now.AddMinutes(-45) }
            Resolve-JobSlot -Registry $registry -Key 'hung' -Now $now | Should -Be 'reserved'
            $registry['hung'].Pending | Should -BeTrue
            Get-Job -Id $job.Id -ErrorAction SilentlyContinue | Should -BeNullOrEmpty
        } finally {
            Remove-Job -Job $job -Force -ErrorAction SilentlyContinue
        }
    }

    It 'reports running for a live job within the TTL' {
        $job = Start-Job -ScriptBlock { Start-Sleep -Seconds 60 }
        try {
            $registry['live'] = @{ Job = $job; Result = $null; Added = $now.AddMinutes(-1) }
            Resolve-JobSlot -Registry $registry -Key 'live' -Now $now | Should -Be 'running'
        } finally {
            Remove-Job -Job $job -Force -ErrorAction SilentlyContinue
        }
    }
}

Describe 'Assert-PolicyCriterionType (issue #142)' {
    It 'accepts <_>' -ForEach @('ClientSubnet', 'Fqdn', 'QType', 'ServerInterfaceIP', 'TimeOfDay', 'TransportProtocol', 'InternetProtocol') {
        Assert-PolicyCriterionType -Type $_ | Should -Be $_
    }

    It 'normalizes case to the canonical parameter name' {
        Assert-PolicyCriterionType -Type 'clientsubnet' | Should -Be 'ClientSubnet'
    }

    It 'rejects parameter names that would retarget or reshape the cmdlet: <_>' -ForEach @('ComputerName', 'CimSession', 'ZoneName', 'Action', 'PassThru', '', 'Fqdn;x') {
        { Assert-PolicyCriterionType -Type $_ } | Should -Throw
    }
}

Describe 'Test-BearerToken (issue #138)' {
    It 'accepts the exact token' {
        Test-BearerToken -Header 'Bearer s3cr3t-T0ken' -Token 's3cr3t-T0ken' | Should -BeTrue
    }

    It 'accepts a case-insensitive scheme' {
        Test-BearerToken -Header 'bearer s3cr3t-T0ken' -Token 's3cr3t-T0ken' | Should -BeTrue
    }

    It 'rejects <Label>' -ForEach @(
        @{ Label = 'a missing header'; Header = $null }
        @{ Label = 'an empty header'; Header = '' }
        @{ Label = 'a wrong token'; Header = 'Bearer s3cr3t-T0kem' }
        @{ Label = 'a prefix of the token'; Header = 'Bearer s3cr3t' }
        @{ Label = 'a longer token'; Header = 'Bearer s3cr3t-T0ken-extra' }
        @{ Label = 'a different scheme'; Header = 'Basic s3cr3t-T0ken' }
        @{ Label = 'a bare token'; Header = 's3cr3t-T0ken' }
    ) {
        Test-BearerToken -Header $Header -Token 's3cr3t-T0ken' | Should -BeFalse
    }

    It 'never authorizes when no token is configured' {
        Test-BearerToken -Header 'Bearer ' -Token '' | Should -BeFalse
    }
}

Describe 'Test-SameHost (issue #139)' {
    It 'treats <A> and <B> as the same host' -ForEach @(
        @{ A = 'dns01.contoso.com'; B = 'DNS01.CONTOSO.COM' }
        @{ A = 'dns01.contoso.com.'; B = 'dns01.contoso.com' }
        @{ A = 'localhost'; B = '127.0.0.1' }
        @{ A = 'localhost'; B = $env:COMPUTERNAME }
        @{ A = '.'; B = 'localhost' }
    ) {
        Test-SameHost $A $B | Should -BeTrue
    }

    It 'treats <A> and <B> as different hosts' -ForEach @(
        @{ A = 'dns01.contoso.com'; B = 'dns02.contoso.com' }
        @{ A = 'dns01'; B = 'dns01.contoso.com' }
        @{ A = 'localhost'; B = 'attacker.example' }
    ) {
        Test-SameHost $A $B | Should -BeFalse
    }
}

Describe 'Resolve-StoredCredential host binding (issue #139)' {
    BeforeAll {
        $script:CredStorePath = Join-Path ([System.IO.Path]::GetTempPath()) ("dpm-cred-test-" + [guid]::NewGuid())
        $null = New-Item -ItemType Directory -Path $script:CredStorePath
        function Save-TestCred([string]$Id, [string]$BoundHost) {
            $data = @{ Username = 'CONTOSO\admin'; Password = (ConvertTo-SecureString 'P@ss' -AsPlainText -Force | ConvertFrom-SecureString) }
            if ($BoundHost) { $data.Hostname = $BoundHost }
            $data | ConvertTo-Json | Set-Content -Path (Join-Path $script:CredStorePath "$Id.cred")
        }
        Save-TestCred 'srv-bound' 'dns01.contoso.com'
        Save-TestCred 'srv-legacy' $null
        $script:SessionCredentials = @{
            'srv-session' = @{
                Credential = New-Object System.Management.Automation.PSCredential('CONTOSO\ops', (ConvertTo-SecureString 'x' -AsPlainText -Force))
                Hostname   = 'dns02.contoso.com'
            }
        }
    }

    AfterAll {
        Remove-Item -LiteralPath $script:CredStorePath -Recurse -Force -ErrorAction SilentlyContinue
    }

    It 'releases a saved credential to the host it was stored for' {
        $cred = Resolve-StoredCredential -ServerId 'srv-bound' -CredentialMode 'savedCredential' -Hostname 'DNS01.contoso.com'
        $cred.UserName | Should -Be 'CONTOSO\admin'
    }

    It 'refuses a saved credential for a different host' {
        { Resolve-StoredCredential -ServerId 'srv-bound' -CredentialMode 'savedCredential' -Hostname 'attacker.example' } |
            Should -Throw '*stored for host*'
    }

    It 'refuses a legacy saved credential with no bound host' {
        { Resolve-StoredCredential -ServerId 'srv-legacy' -CredentialMode 'savedCredential' -Hostname 'dns01.contoso.com' } |
            Should -Throw '*predates host binding*'
    }

    It 'releases a session credential only to its host' {
        (Resolve-StoredCredential -ServerId 'srv-session' -CredentialMode 'session' -Hostname 'dns02.contoso.com').UserName |
            Should -Be 'CONTOSO\ops'
        { Resolve-StoredCredential -ServerId 'srv-session' -CredentialMode 'session' -Hostname 'dns01.contoso.com' } |
            Should -Throw '*entered for host*'
    }

    It 'returns nothing for currentUser mode' {
        Resolve-StoredCredential -ServerId 'srv-bound' -CredentialMode 'currentUser' -Hostname 'anything' | Should -BeNullOrEmpty
    }

    It 'rejects path-traversal server IDs' {
        { Resolve-StoredCredential -ServerId '..\..\x' -CredentialMode 'savedCredential' -Hostname 'h' } | Should -Throw
    }
}
