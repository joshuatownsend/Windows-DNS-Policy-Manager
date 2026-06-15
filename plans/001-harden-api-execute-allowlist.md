# Plan 001: `/api/execute` only runs genuinely-allowlisted DNS cmdlets (no injection)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat db6c18d..HEAD -- server/bridge.ps1`
> If `server/bridge.ps1` changed since this plan was written, compare the
> "Current state" excerpts below against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `db6c18d`, 2026-06-14

## Why this matters

The bridge's `POST /api/execute` endpoint is meant to allow a curated set of
read/write DNS Server cmdlets that don't have dedicated UI. Today its allowlist
only checks that the submitted command **starts with** an allowed verb prefix,
then runs the *entire* string through `Invoke-Expression`. Because nothing
rejects statement separators (`;`), pipelines to non-DNS cmdlets, subexpressions
(`$(...)`), or call operators (`&`/`.`), a request like
`{"command":"Get-DnsServer; <anything>"}` passes the check and executes
arbitrary PowerShell **as the account running the bridge** — which is typically
a DNS/domain administrator. That is a remote-code-execution primitive. (Plan
002 closes the matching CSRF hole that lets a web page reach this endpoint; this
plan makes the endpoint itself safe regardless of who calls it.)

The fix must NOT break legitimate use: the PowerShell tab sends real command
strings here, including pipelines such as `Get-DnsServerZone | Format-Table`.
So we validate with the PowerShell **Abstract Syntax Tree** (AST) instead of a
substring match: parse the command, then require that *every* command invoked
anywhere in it — including inside pipelines and `$()` subexpressions — resolves
to an allowlisted name, and reject static method calls and dynamic invocation.

## Current state

- `server/bridge.ps1` — single-file PowerShell HTTP bridge. The vulnerable
  handler is `Handle-Execute` at lines **3704–3760**. It is reached from
  `Route-Request` via the `^/api/execute$` route (POST).
- The frontend calls it through `dns-manager/src/lib/api.ts:548`:
  ```ts
  execute: (command: string) => request("POST", "/api/execute", { command }),
  ```
  So the request body is `{ "command": "<powershell string>" }`.

Current vulnerable code, `server/bridge.ps1:3718-3760`:

```powershell
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
        if ($command -match "^\s*$([regex]::Escape($verb))") {   # <-- prefix-only match
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
        $output = Invoke-Expression $command 2>&1 | Out-String   # <-- runs the whole string
        Send-Response -Response $Response -Body @{ success = $true; output = $output }
    } catch {
        Send-Response -Response $Response -Body @{ success = $false; error = $_.Exception.Message } -StatusCode 500
    }
```

Repo conventions to match:
- Functions are `Verb-Noun`, defined at top level in this one file. Add the new
  helper next to the other security helpers (near `Assert-SafeId` /
  `Assert-SafeFileName`, around `server/bridge.ps1:145-165`).
- `Set-StrictMode -Version Latest` is active (line 19) — declare variables before
  use; no undefined-variable references.
- Indentation is 4 spaces.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Syntax/parse check (automated gate) | `powershell -NoProfile -Command "$e=$null;$t=$null;[void][System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path server/bridge.ps1),[ref]$t,[ref]$e);if($e){$e;exit 1}else{'PARSE OK'}"` | prints `PARSE OK`, exit 0 |
| Unit test the validator in isolation | see Test plan below (dot-source the function in a scratch script) | all assertions print `PASS` |
| Manual end-to-end (needs Windows + bridge running) | `Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8650/api/execute -ContentType 'application/json' -Body '{"command":"Get-DnsServer; Write-Output PWNED"}'` | response `success:$false`, status 403 |

> The bridge has no automated test harness (see plan 004 for the TS side). The
> parse check above is the automated gate that MUST pass. The end-to-end checks
> require a Windows host with the DnsServer module and a running bridge; run them
> if that environment is available, otherwise record that they were not run.

## Scope

**In scope** (the only file you should modify):
- `server/bridge.ps1` — add a `Test-CommandAllowed` helper and rewrite the
  validation portion of `Handle-Execute`.

**Out of scope** (do NOT touch):
- Any other handler or route.
- The `Invoke-Expression` *call itself* may remain (line 3749) — it is safe once
  `Test-CommandAllowed` has guaranteed the string contains only allowlisted
  commands. Do not attempt a larger rewrite of how the command runs.
- Do NOT remove the `/api/execute` endpoint — the PowerShell tab depends on it.

## Git workflow

- Branch: `advisor/001-harden-execute`
- Commit message style (conventional commits, matching `git log`): e.g.
  `fix(bridge): validate /api/execute via AST allowlist to prevent injection`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add the `Test-CommandAllowed` AST validator

Insert this function immediately after `Assert-SafeFileName` (after
`server/bridge.ps1:165`), in the "Security Helpers" region:

```powershell
function Test-CommandAllowed {
    # Validate a /api/execute command string. Returns $true only if every command
    # invoked anywhere in the input (including inside pipelines and $() subexpressions)
    # resolves to an allowlisted DNS cmdlet (or a safe read-only formatter), and the
    # input contains no static method calls or dynamically-named invocations.
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
    # Allowed by EXACT NAME — read-only output shaping used in legitimate pipelines.
    $allowedExact = @(
        'Format-Table', 'Format-List', 'Select-Object', 'Sort-Object', 'Out-String'
    )

    if ([string]::IsNullOrWhiteSpace($Command)) { return $false }

    $tokens = $null
    $errs   = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseInput($Command, [ref]$tokens, [ref]$errs)
    if ($errs -and $errs.Count -gt 0) { return $false }

    # Reject any static/instance method call, e.g. [Diagnostics.Process]::Start(...)
    $methodCalls = $ast.FindAll(
        { param($n) $n -is [System.Management.Automation.Language.InvokeMemberExpressionAst] }, $true)
    if ($methodCalls.Count -gt 0) { return $false }

    # Every command invoked anywhere must be allowlisted.
    $commands = $ast.FindAll(
        { param($n) $n -is [System.Management.Automation.Language.CommandAst] }, $true)
    if (-not $commands -or $commands.Count -eq 0) { return $false }

    foreach ($c in $commands) {
        $name = $c.GetCommandName()
        if (-not $name) { return $false }   # e.g. `& $var` — dynamic, not statically verifiable
        $ok = $false
        foreach ($p in $allowedPrefixes) {
            if ($name -like "$p*") { $ok = $true; break }
        }
        if (-not $ok -and ($allowedExact -notcontains $name)) { return $false }
    }
    return $true
}
```

Why this is robust: `FindAll(..., $true)` walks the **entire** tree, so command
names hidden inside `;`-separated statements, pipelines, `$()` subexpressions,
or `Where-Object`/`Select-Object` script blocks are all discovered and checked.
A non-allowlisted command anywhere → reject. `& $var` yields a null command name
→ reject. `[type]::Method()` is an `InvokeMemberExpressionAst` → reject.

**Verify**: run the parse check command from the table → `PARSE OK`.

### Step 2: Replace the prefix-match block in `Handle-Execute`

In `Handle-Execute`, delete the `$allowedVerbs` array, the `foreach ($verb ...)`
loop, and the `if (-not $isAllowed)` block (the code shown in "Current state",
`server/bridge.ps1:3719-3746`), and replace it with:

```powershell
    $command = $Body.command

    if (-not (Test-CommandAllowed -Command $command)) {
        Send-Response -Response $Response -Body @{
            success = $false
            error   = 'Command not allowed. Only specific DNS cmdlets (optionally piped to Format-Table/List/Select-Object/Sort-Object/Out-String) are permitted.'
        } -StatusCode 403
        return
    }
```

Leave the existing `try { $output = Invoke-Expression $command ... }` block
(lines 3748-3759) unchanged — it is safe now that the input is validated.

**Verify**: parse check → `PARSE OK`. Then confirm the removed identifiers are
gone: `grep -n '\$allowedVerbs\|\$isAllowed' server/bridge.ps1` → no matches.

### Step 3: (If a Windows test host is available) confirm behavior end-to-end

Start the bridge (`powershell -ExecutionPolicy Bypass -File server/bridge.ps1`)
and run, from another PowerShell window:

- Injection is blocked:
  `Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8650/api/execute -ContentType 'application/json' -Body '{"command":"Get-DnsServer; Write-Output PWNED"}'`
  → `success` is `$false`, HTTP 403.
- A legit single cmdlet still works:
  `... -Body '{"command":"Get-DnsServer"}'` → `success:$true`.
- A legit pipeline still works:
  `... -Body '{"command":"Get-DnsServerZone | Format-Table"}'` → `success:$true`.

If no Windows/DnsServer host is available, **record in the status note that
Step 3 was not run** and rely on Steps 1–2 + the validator unit test (Test plan).

## Test plan

Because the bridge has no test runner, write a throwaway verification script and
run it with `powershell` to exercise `Test-CommandAllowed` directly. Create
`server/_validate_execute_test.ps1` (DELETE it after — it is not committed):

```powershell
# Dot-source just the function under test by extracting it, or paste the function
# above this block. Then assert:
$cases = @(
    @{ cmd = 'Get-DnsServer';                          expect = $true  },
    @{ cmd = 'Get-DnsServerZone | Format-Table';       expect = $true  },
    @{ cmd = 'Get-DnsServer; Remove-Item C:\temp';     expect = $false },
    @{ cmd = 'Get-DnsServer | iex';                     expect = $false },
    @{ cmd = 'Resolve-DnsName -Name $(Remove-Item .)';  expect = $false },
    @{ cmd = '[System.Diagnostics.Process]::Start("calc")'; expect = $false },
    @{ cmd = '& "Remove-Item"';                          expect = $false },
    @{ cmd = 'Remove-Item C:\';                          expect = $false }
)
foreach ($c in $cases) {
    $got = Test-CommandAllowed -Command $c.cmd
    if ($got -eq $c.expect) { "PASS: [$($c.cmd)]" } else { "FAIL: [$($c.cmd)] expected $($c.expect) got $got" }
}
```

Verification: every line prints `PASS`. Then `rm server/_validate_execute_test.ps1`.

(When plan 004 lands a PowerShell test harness, these cases should move into a
permanent Pester test. For now they are a one-shot gate.)

## Done criteria

ALL must hold:

- [ ] `server/bridge.ps1` parses cleanly (parse-check command prints `PARSE OK`, exit 0).
- [ ] `grep -n '\$allowedVerbs\|\$isAllowed' server/bridge.ps1` returns no matches.
- [ ] `grep -n 'function Test-CommandAllowed' server/bridge.ps1` returns one match.
- [ ] The validator test script prints `PASS` for all 8 cases listed above, then is deleted.
- [ ] No files outside `server/bridge.ps1` are modified (`git status`).
- [ ] `plans/README.md` status row for 001 updated.

## STOP conditions

Stop and report (do not improvise) if:

- The code at `server/bridge.ps1:3718-3760` does not match the "Current state"
  excerpt (the bridge drifted since this plan was written).
- The parse check fails after your edit and the cause isn't an obvious typo you
  can fix in one pass.
- A legitimate command you expected to allow (e.g. `Get-DnsServer`) is rejected by
  `Test-CommandAllowed`, or an injection case is allowed — report the case rather
  than loosening the validator past the spec.
- You discover `/api/execute` is invoked from somewhere that sends commands NOT
  covered by the allowlist (search the frontend for `api.execute(` and the
  PowerShell tab) — report what legitimate commands would break.

## Maintenance notes

- If new DNS cmdlets without dedicated UI need to be reachable, add their name
  prefix to `$allowedPrefixes` in `Test-CommandAllowed` (not to `Handle-Execute`).
- This validation is what makes the retained `Invoke-Expression` safe. A reviewer
  should confirm no later refactor reintroduces a substring/regex shortcut.
- Longer term, consider replacing `/api/execute` entirely with typed endpoints
  (the rest of the bridge already uses splatted-parameter handlers, which are
  injection-proof). That is a larger effort and intentionally deferred here.
- Pairs with plan 002 (origin/CSRF gate). Neither fully replaces the other:
  001 makes the endpoint safe to call; 002 limits who can call it.
