# Plan 006: Remote CIM sessions are disposed after each request (no handle leak)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If
> anything in "STOP conditions" occurs, stop and report. When done, update the
> status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat db6c18d..HEAD -- server/bridge.ps1`
> If `server/bridge.ps1` changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, STOP.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW-MED
- **Depends on**: none (touches `Resolve-ServerCredential` + the runspace dispatch; coordinate with plans 001/002 which also edit `bridge.ps1` — apply on top of whichever lands first, re-running the drift check)
- **Category**: correctness
- **Planned at**: commit `db6c18d`, 2026-06-14

## Why this matters

When the bridge talks to a **remote** DNS server using a stored or session
credential, `Resolve-ServerCredential` creates a `CimSession` and hands it to the
DNS cmdlet via splatting. That session is never closed on the request path — there
is exactly one `Remove-CimSession` in the whole 4,874-line file, and it belongs to
an unrelated background-job path. Every remote credentialed request therefore
leaks a CIM session (an open WS-Man/DCOM connection + handles). Over a long-lived
bridge with frequent remote queries, these accumulate and eventually exhaust
resources / cause RPC failures. The fix disposes each request's CIM session(s)
when the request finishes.

## Current state

The session is created and returned but never disposed
(`server/bridge.ps1:205-216`):

```powershell
    if ($isRemote -and $cred) {
        # DNS Server cmdlets don't accept -Credential; they need -CimSession.
        # Create a CIM session with the credential for splatting to DNS cmdlets.
        $so = New-CimSessionOption -Protocol Dcom
        $session = New-CimSession -ComputerName $Hostname -Credential $cred -SessionOption $so -ErrorAction Stop
        $params['CimSession'] = $session
    } elseif ($isRemote) {
        $params['ComputerName'] = $Hostname
    }

    return $params
```

`Resolve-ServerCredential` is called from ~30 handlers (e.g. lines 605, 659, 748,
…). Each assigns the returned hashtable to a local (`$params` / `$credParams`),
splats it into one DNS cmdlet, and discards it — so a per-handler fix would mean
~30 edits. Instead, dispose at the **per-request** boundary.

The per-request boundary is the runspace dispatch scriptblock
(`server/bridge.ps1:4822-4844`). It already binds shared state into script scope —
this is the established pattern this plan follows:

```powershell
        $null = $ps.AddScript({
            param($ctx, $state)
            # Bind shared state into script scope for handlers
            $script:SessionCredentials = $state.SessionCredentials
            $script:CredStorePath      = $state.CredStorePath
            $script:BpaJobs            = $state.BpaJobs
            $script:ResolverJobs       = $state.ResolverJobs

            try {
                Route-Request -Context $ctx
            } catch {
                try {
                    Send-Response -Response $ctx.Response -Body @{
                        success = $false
                        error   = "Internal server error: $($_.Exception.Message)"
                    } -StatusCode 500
                } catch {}
            }

            # Write back mutable state
            $state.BpaJobs      = $script:BpaJobs
            $state.ResolverJobs = $script:ResolverJobs
        }).AddArgument($context).AddArgument($sharedState)
```

Because handler functions reference `$script:SessionCredentials` (set here) and it
works, a `$script:RequestCimSessions` set here will likewise be visible to
`Resolve-ServerCredential`. Runspaces are reused from the pool, so the list MUST
be reset at the start of each dispatch.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Syntax/parse check (automated gate) | `powershell -NoProfile -Command "$e=$null;$t=$null;[void][System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path server/bridge.ps1),[ref]$t,[ref]$e);if($e){$e;exit 1}else{'PARSE OK'}"` | prints `PARSE OK`, exit 0 |
| Manual (needs Windows + a remote server + saved credential) | issue several remote requests, then check open sessions don't grow | `Get-CimSession` count stays ~0 between requests |

> The remote-credential path can only be exercised end-to-end against a real
> remote DNS server with a stored credential. If unavailable, the parse check is
> the automated gate; record that the runtime check was not run.

## Scope

**In scope**:
- `server/bridge.ps1` — (a) track created CIM sessions in
  `Resolve-ServerCredential`; (b) reset + dispose them in the runspace dispatch
  scriptblock.

**Out of scope** (do NOT touch):
- The ~30 individual handlers — do not add per-handler disposal.
- The background-job CIM path that already disposes (around `server/bridge.ps1:2056`).
- `Resolve-BackgroundJobCredential` — it builds a `PSCredential`, not a session.

## Git workflow

- Branch: `advisor/006-cim-session-leak`
- Commit message: `fix(bridge): dispose per-request CIM sessions to prevent handle leak`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Track each created CIM session

In `Resolve-ServerCredential`, immediately after the session is created
(after `server/bridge.ps1:210`, `$params['CimSession'] = $session`), add:
```powershell
        if (-not $script:RequestCimSessions) { $script:RequestCimSessions = @() }
        $script:RequestCimSessions += $session
```
So the block becomes:
```powershell
        $session = New-CimSession -ComputerName $Hostname -Credential $cred -SessionOption $so -ErrorAction Stop
        $params['CimSession'] = $session
        if (-not $script:RequestCimSessions) { $script:RequestCimSessions = @() }
        $script:RequestCimSessions += $session
```

**Verify**: parse check → `PARSE OK`.

### Step 2: Reset + dispose in the dispatch scriptblock

Edit the dispatch scriptblock (`server/bridge.ps1:4822-4844`) so it (a) resets the
list right after binding shared state, and (b) disposes in a `finally`. The
scriptblock becomes:
```powershell
        $null = $ps.AddScript({
            param($ctx, $state)
            # Bind shared state into script scope for handlers
            $script:SessionCredentials = $state.SessionCredentials
            $script:CredStorePath      = $state.CredStorePath
            $script:BpaJobs            = $state.BpaJobs
            $script:ResolverJobs       = $state.ResolverJobs
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
```

**Verify**: parse check → `PARSE OK`.

### Step 3: (If a remote test environment exists) confirm no growth

With the bridge running and a remote server configured with a saved credential,
issue ~10 remote requests (e.g. refresh the Zones tab pointed at the remote
server). On the bridge host, `Get-CimSession` should not show an accumulating list
(sessions should be closed between requests). Record the observation. If no remote
environment is available, note that Step 3 was not run.

## Test plan

No automated PowerShell test harness exists yet (plan 004 sets one up for the TS
side; a Pester harness for the bridge is a separate future item). Verification:
- Automated: parse check passes.
- Manual (if environment available): `Get-CimSession` count stays flat across
  repeated remote requests (Step 3).

A future Pester test should assert that after a simulated remote request,
`$script:RequestCimSessions` is empty — note this in Maintenance.

## Done criteria

ALL must hold:

- [ ] `server/bridge.ps1` parses cleanly (`PARSE OK`, exit 0).
- [ ] `grep -n 'RequestCimSessions' server/bridge.ps1` → at least 4 matches (init+append in Resolve-ServerCredential, reset + dispose-loop + reset in dispatch).
- [ ] `grep -n 'Remove-CimSession' server/bridge.ps1` → now 2 matches (the pre-existing job path + the new dispatch finally).
- [ ] No files outside `server/bridge.ps1` modified (`git status`).
- [ ] `plans/README.md` status row for 006 updated.

## STOP conditions

Stop and report if:

- The `Resolve-ServerCredential` remote block or the dispatch scriptblock don't
  match the "Current state" excerpts (drift, or another plan like 001/002 already
  restructured this area — re-run the drift check and re-locate the anchors).
- The dispatch scriptblock already has a `finally` (means someone added one;
  merge into it rather than adding a second).
- After the change, the manual remote test shows sessions STILL accumulating
  (means `$script:` scope isn't shared as assumed — report; do not add per-handler
  disposal as a workaround without flagging the scope finding).

## Maintenance notes

- This follows the existing `$script:SessionCredentials` sharing pattern; if that
  pattern is ever refactored (e.g. to a thread-safe shared object — see the
  separate runspace-concurrency finding), revisit this disposal too.
- When a Pester harness exists, add a test asserting `$script:RequestCimSessions`
  is emptied after a request.
- Reviewer should confirm disposal is in a `finally` (runs even when a handler
  throws) and that the list is reset per dispatch (runspaces are pooled/reused).
