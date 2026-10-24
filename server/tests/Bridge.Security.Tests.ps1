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

Describe 'Test-JobSlot (issue #141)' {
    BeforeEach {
        $now = [datetime]'2026-10-24T12:00:00'
        $registry = [hashtable]::Synchronized(@{})
    }

    It 'allows a new key while under the cap' {
        $registry['a'] = @{ Job = $null; Added = $now }
        Test-JobSlot -Registry $registry -Key 'b' -MaxEntries 2 -Now $now | Should -BeTrue
    }

    It 'refuses a new key once the cap is reached' {
        $registry['a'] = @{ Job = $null; Added = $now }
        $registry['b'] = @{ Job = $null; Added = $now }
        Test-JobSlot -Registry $registry -Key 'c' -MaxEntries 2 -Now $now | Should -BeFalse
    }

    It 'lets an existing key reuse its slot at the cap' {
        $registry['a'] = @{ Job = $null; Added = $now }
        $registry['b'] = @{ Job = $null; Added = $now }
        Test-JobSlot -Registry $registry -Key 'a' -MaxEntries 2 -Now $now | Should -BeTrue
    }

    It 'expires entries older than the TTL, freeing their slots' {
        $registry['old'] = @{ Job = $null; Result = @{ success = $true }; Added = $now.AddMinutes(-31) }
        $registry['new'] = @{ Job = $null; Added = $now.AddMinutes(-5) }
        Test-JobSlot -Registry $registry -Key 'c' -MaxEntries 2 -TtlMinutes 30 -Now $now | Should -BeTrue
        $registry.ContainsKey('old') | Should -BeFalse
        $registry.ContainsKey('new') | Should -BeTrue
    }

    It 'expires entries that have no timestamp' {
        $registry['legacy'] = @{ Job = $null; Result = $null }
        Test-JobSlot -Registry $registry -Key 'x' -Now $now | Should -BeTrue
        $registry.Count | Should -Be 0
    }

    It 'stops and removes an expired running job' {
        $job = Start-Job -ScriptBlock { Start-Sleep -Seconds 60 }
        try {
            $registry['hung'] = @{ Job = $job; Added = $now.AddMinutes(-45) }
            Test-JobSlot -Registry $registry -Key 'x' -Now $now | Should -BeTrue
            $registry.ContainsKey('hung') | Should -BeFalse
            Get-Job -Id $job.Id -ErrorAction SilentlyContinue | Should -BeNullOrEmpty
        } finally {
            Remove-Job -Job $job -Force -ErrorAction SilentlyContinue
        }
    }
}
