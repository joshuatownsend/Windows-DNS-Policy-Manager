# Plan 002: The bridge rejects cross-origin browser requests (CSRF guard)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan in
> `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat db6c18d..HEAD -- server/bridge.ps1`
> If `server/bridge.ps1` changed since this plan was written, compare the
> "Current state" excerpts below against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none (complements 001)
- **Category**: security
- **Planned at**: commit `db6c18d`, 2026-06-14

## Why this matters

The bridge sends `Access-Control-Allow-Origin: *` on every response and allows
all methods, with **no Origin check, no CSRF token, and no auth**. It binds to
`127.0.0.1` by default, but localhost binding does not protect it from the
browser: any website the user visits while the bridge is running can issue
cross-origin `fetch`/form requests to `http://127.0.0.1:8650/...`. The browser
attaches an `Origin` header and sends the request; the bridge happily executes
it. That means a malicious page can create/delete DNS policies, zones, and
records on the user's DNS server — and, combined with plan 001's endpoint,
attempt code execution via `/api/execute`. This is classic CSRF against a
privileged localhost service.

The fix is a server-side **Origin allowlist** at the single request choke point
(`Route-Request`). Browsers always send `Origin` on cross-origin requests (and
on same-origin state-changing requests). Non-browser clients that legitimately
use the bridge — the web UI's own page, the MCP server, `curl`,
`Invoke-RestMethod` — either send the trusted UI origin or send no `Origin` at
all. So: **reject any request that carries an `Origin` header which is not in the
allowlist; allow requests with no `Origin`** (they are not browser-driven CSRF
vectors). This blocks the attack while leaving every legitimate caller working.

## Current state

- The web UI runs at `http://localhost:10010` (dev) — see
  `dns-manager/package.json:6` (`next dev --port 10010`) and the Docker default
  (README "Port Reference"). Its browser code calls the bridge directly at
  `:8650`, so the browser sends `Origin: http://localhost:10010` (or the
  `127.0.0.1` equivalent).
- The bridge accepts a `param(...)` block at the top, `server/bridge.ps1:14-17`:
  ```powershell
  param(
      [int]$Port = 8650,
      [string]$BindAddress = '127.0.0.1'
  )
  ```
- CORS headers are written in `Send-Response` (`server/bridge.ps1:88-91`) and
  `Send-Preflight` (`server/bridge.ps1:101-110`), both using `'*'`.
- The single request choke point is `Route-Request` (`server/bridge.ps1:4150-4167`):
  ```powershell
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
              ...
  ```

Repo conventions: 4-space indent; `Verb-Noun` functions; `Set-StrictMode` is on.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Syntax/parse check (automated gate) | `powershell -NoProfile -Command "$e=$null;$t=$null;[void][System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path server/bridge.ps1),[ref]$t,[ref]$e);if($e){$e;exit 1}else{'PARSE OK'}"` | prints `PARSE OK`, exit 0 |
| Manual: cross-origin blocked (needs Windows + bridge running) | `Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8650/api/health -Headers @{ Origin = 'http://evil.example' } -ContentType 'application/json'` | HTTP 403 |
| Manual: trusted origin allowed | `Invoke-RestMethod -Uri http://127.0.0.1:8650/api/health -Headers @{ Origin = 'http://localhost:10010' }` | `success:$true` |
| Manual: no-origin (curl/MCP) allowed | `Invoke-RestMethod -Uri http://127.0.0.1:8650/api/health` | `success:$true` |

> Bridge end-to-end checks require a Windows host with the bridge running. If
> unavailable, record that they were not run; the parse check is the automated gate.

## Scope

**In scope**:
- `server/bridge.ps1` — add an `$AllowedOrigins` param, a `Test-OriginAllowed`
  helper, and an Origin gate in `Route-Request`. Optionally tighten the CORS
  `Access-Control-Allow-Origin` to echo the validated origin.

**Out of scope** (do NOT touch):
- Routing logic, individual handlers, credential code.
- Do NOT add authentication tokens or sessions — that is a larger design change.
  The Origin allowlist is the agreed scope.
- Do NOT change the default `BindAddress`.

## Git workflow

- Branch: `advisor/002-origin-csrf-guard`
- Commit message: `fix(bridge): reject cross-origin browser requests (CSRF guard)`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Add an `-AllowedOrigins` parameter

Extend the param block at `server/bridge.ps1:14-17` to:

```powershell
param(
    [int]$Port = 8650,
    [string]$BindAddress = '127.0.0.1',
    [string[]]$AllowedOrigins = @(
        'http://localhost:10010', 'http://127.0.0.1:10010'
    )
)
```

**Verify**: parse check → `PARSE OK`.

### Step 2: Add a `Test-OriginAllowed` helper

Add after `Assert-SafeFileName` (after `server/bridge.ps1:165`), in the
"Security Helpers" region:

```powershell
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
```

Then make the allowlist available in script scope. The bridge already binds
shared state into each runspace (see the dispatch scriptblock at
`server/bridge.ps1:4822-4844`, which sets `$script:SessionCredentials` etc.). To
follow that exact pattern, the value must reach the runspace. The simplest
robust approach: set a script-scoped copy once at startup AND pass it through the
shared state. Do BOTH of the following:

1. Near the credential infrastructure init (`server/bridge.ps1:169`, where
   `$script:SessionCredentials = @{}` is declared), add:
   ```powershell
   $script:AllowedOrigins = $AllowedOrigins
   ```
2. Find where the runspace `InitialSessionState` variables are added (around
   `server/bridge.ps1:4790-4796`, where `SharedState` is added as a
   `SessionStateVariableEntry`). Add a sibling entry so each runspace sees it:
   ```powershell
   $iss.Variables.Add(
       [System.Management.Automation.Runspaces.SessionStateVariableEntry]::new(
           'AllowedOrigins', $AllowedOrigins, ''
       )
   )
   ```
   This makes `$AllowedOrigins` a normal variable in every runspace;
   `Test-OriginAllowed` reads `$script:AllowedOrigins`, which resolves to it.

> If the `$iss.Variables.Add(...)` block for `SharedState` does not look like the
> excerpt, STOP and report — do not guess at the runspace setup.

**Verify**: parse check → `PARSE OK`.

### Step 3: Enforce the gate in `Route-Request`

In `Route-Request`, insert the gate **after** the `OPTIONS` preflight block and
**before** `Write-Log "$method $path"` (between `server/bridge.ps1:4163` and
`:4165`):

```powershell
    # CSRF guard: reject browser requests from untrusted origins.
    if (-not (Test-OriginAllowed -Request $request)) {
        Send-Response -Response $response -Body @{
            success = $false
            error   = 'Origin not allowed'
        } -StatusCode 403
        return
    }
```

Preflight (`OPTIONS`) intentionally stays permissive so the legitimate UI can
preflight; the gate on the actual request is what stops the attack.

**Verify**: parse check → `PARSE OK`.

### Step 4 (optional, defense-in-depth): echo the validated origin instead of `*`

This step is optional and only reduces what an attacker could *read*; the Step 3
gate is the real protection. If you do it, keep it minimal and do not break the
UI. Skip if it requires plumbing the request object into `Send-Response` in a way
that touches many call sites — in that case leave `*` and note it in the status.

## Test plan

There is no automated PowerShell test runner yet (see plan 004). Verify via the
manual matrix in "Commands you will need" when a Windows host + running bridge are
available:
- Untrusted `Origin` → 403.
- Trusted UI origin (`http://localhost:10010`) → request succeeds.
- No `Origin` header → request succeeds.

Additionally, regression-check the real UI: with the bridge running, load the web
app at `http://localhost:10010`, open the Server tab, and confirm bridge status
shows connected and a zone list loads (i.e. the UI's own cross-origin calls are
NOT blocked). If they ARE blocked, the UI's actual origin differs from the
allowlist — see STOP conditions.

If no Windows host is available, record that the manual matrix was not run; the
parse check remains the automated gate.

## Done criteria

ALL must hold:

- [ ] `server/bridge.ps1` parses cleanly (`PARSE OK`, exit 0).
- [ ] `grep -n 'function Test-OriginAllowed' server/bridge.ps1` → one match.
- [ ] `grep -n 'Test-OriginAllowed -Request' server/bridge.ps1` → one match (the gate in Route-Request).
- [ ] `grep -n 'AllowedOrigins' server/bridge.ps1` → at least the param, the `$script:` assignment, the ISS entry, and the helper.
- [ ] No files outside `server/bridge.ps1` modified (`git status`).
- [ ] `plans/README.md` status row for 002 updated.

## STOP conditions

Stop and report (do not improvise) if:

- The `param(...)` block, `Route-Request`, or the runspace `$iss.Variables.Add`
  block do not match the "Current state" excerpts.
- During the UI regression check, the real web app's calls are rejected as
  "Origin not allowed" — this means the UI runs on a different origin/port than
  `http://localhost:10010`. Report the actual `Origin` the browser sends (visible
  in the bridge's console `405/403` logs or the browser devtools Network tab) so
  the allowlist can be corrected, rather than reverting to `*`.
- You find a legitimate non-browser client that DOES send an `Origin` header not
  in the allowlist.

## Maintenance notes

- If the UI is deployed on a different host/port (e.g. a custom Docker port), the
  operator must pass `-AllowedOrigins` accordingly. Document this in the README's
  Port Reference / Docker section as a follow-up (not required for this plan).
- This is an allowlist, not authentication. If the bridge is ever exposed beyond
  localhost (`-BindAddress 0.0.0.0`), real auth is still needed — note that in any
  future networking work.
- Reviewer should confirm the gate runs for ALL state-changing routes (it sits
  before the `switch -Regex`, so it does) and that `OPTIONS` preflight still
  returns 204.
- Pairs with plan 001.
