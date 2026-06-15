# Plan 008: Resolver polling doesn't restart when the server list changes mid-poll

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If
> anything in "STOP conditions" occurs, stop and report. When done, update the
> status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat db6c18d..HEAD -- dns-manager/src/app/resolvers/page.tsx`
> If it changed since this plan was written, compare the "Current state" excerpt
> against the live code before proceeding; on a mismatch, STOP.

## Status

- **Priority**: P3
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: perf / correctness
- **Planned at**: commit `db6c18d`, 2026-06-14

## Why this matters

The Resolvers tab starts a polling cycle that queries each online server until
all complete. The `fetchAll` callback depends on `[servers]`, and the effect that
runs it depends on `[bridgeConnected, fetchAll]`. So every time the `servers`
array changes — which happens frequently, because bridge/server status polling
flips `status` between `online`/`offline` and rewrites the array — `fetchAll` is
recreated and the effect re-runs, **restarting the entire poll**: it clears the
in-flight timers and re-issues the start-resolver jobs from scratch. With several
servers, each restart costs N extra API calls and abandons partial results, and a
steady stream of status updates can keep the poll from ever settling. The fix is
to make `fetchAll` stable (read the latest servers from a ref) so the poll runs to
completion regardless of unrelated `servers` churn.

## Current state

`dns-manager/src/app/resolvers/page.tsx:292-372`:

```tsx
  const pollTimers = useRef<ReturnType<typeof setInterval>[]>([]);

  // Clean up polls on unmount
  useEffect(() => {
    return () => {
      pollTimers.current.forEach(clearInterval);
    };
  }, []);

  const fetchAll = useCallback(async () => {
    const onlineServers = servers.filter((s) => s.status === "online");
    if (onlineServers.length === 0) {
      setResolverData([]);
      return;
    }

    // Clear any existing polls
    pollTimers.current.forEach(clearInterval);
    pollTimers.current = [];

    setLoading(true);

    // Start jobs for all servers
    await Promise.all(
      onlineServers.map((server) => {
        const p = sp(server);
        return api.startResolvers(p.server, p.serverId, p.credentialMode);
      })
    );

    // Poll each server until all complete
    const pending = new Map(onlineServers.map((s) => [s.id, s]));
    const results = new Map<string, ServerResolverData>();

    const timer = setInterval(async () => {
      const checks = [...pending.entries()].map(async ([id, server]) => {
        const p = sp(server);
        const res = await api.pollResolvers(p.server, p.serverId, p.credentialMode);
        const r = res as any;
        if (r.status === "running") return; // Still going
        pending.delete(id);
        if (r.success && r.interfaces) {
          results.set(id, { server, data: { interfaces: r.interfaces || [], forwarders: normalizeForwarders(r.forwarders), listeningAddresses: r.listeningAddresses || [] } });
        } else {
          results.set(id, { server, data: null, error: r.error || "Failed to fetch" });
        }
      });
      await Promise.all(checks);
      setResolverData(onlineServers.map((s) => results.get(s.id) || { server: s, data: null }));
      if (pending.size === 0) {
        clearInterval(timer);
        setLoading(false);
      }
    }, 2000);

    pollTimers.current.push(timer);
  }, [servers]);                       // <-- recreated on every servers change

  useEffect(() => {
    if (!bridgeConnected) return;
    fetchAll();
  }, [bridgeConnected, fetchAll]);     // <-- re-runs (restarts poll) whenever fetchAll changes
```

`sp` (server-params helper) and `normalizeForwarders` are referenced inside
`fetchAll`; locate their definitions in this file before editing (they are
component-scope helpers). Note: this file already uses
`// eslint-disable-next-line react-hooks/exhaustive-deps` elsewhere — follow that
convention if the linter objects to the new dependency arrays.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Build/typecheck | `cd dns-manager && npm run build` | exit 0 |
| Lint | `cd dns-manager && npm run lint` | exit 0 |
| E2E (resolvers spec is not in the suite, but run the full set) | `cd dns-manager && npm run test:e2e` | passes (or same pass set as before your change) |

## Scope

**In scope**:
- `dns-manager/src/app/resolvers/page.tsx` — stabilize `fetchAll` via a `servers`
  ref; adjust the two dependency arrays.

**Out of scope** (do NOT touch):
- `api.startResolvers` / `api.pollResolvers`, the bridge resolver endpoints.
- The unmount cleanup effect (lines 294-299) — it is correct; keep it.
- `normalizeForwarders` / `sp` logic.

## Git workflow

- Branch: `advisor/008-resolvers-polling-stability`
- Commit message: `fix(resolvers): stabilize poll so server-list churn doesn't restart it`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Add a ref that always holds the latest `servers`

Just below the existing `pollTimers` ref (`resolvers/page.tsx:292`), add:
```tsx
  const serversRef = useRef(servers);
  useEffect(() => {
    serversRef.current = servers;
  }, [servers]);
```

### Step 2: Read servers from the ref and make `fetchAll` stable

In `fetchAll`, change the first line from:
```tsx
    const onlineServers = servers.filter((s) => s.status === "online");
```
to:
```tsx
    const onlineServers = serversRef.current.filter((s) => s.status === "online");
```
Then change the `useCallback` dependency array from `[servers]` to `[]`. If
ESLint's `react-hooks/exhaustive-deps` flags `sp` / `normalizeForwarders`, confirm
they are stable (module-level or `useCallback`); if they are component-scope plain
functions, add `// eslint-disable-next-line react-hooks/exhaustive-deps` directly
above the dependency array line (matching the existing convention in this file).
Do NOT add `servers` back to the deps.

### Step 3: Simplify the triggering effect

Change the effect dependency array from `[bridgeConnected, fetchAll]` to
`[bridgeConnected]` (now that `fetchAll` is stable, including it is unnecessary and
was the cause of the restart). Keep the body:
```tsx
  useEffect(() => {
    if (!bridgeConnected) return;
    fetchAll();
    // fetchAll is stable (deps []); only re-run when bridge connection changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridgeConnected]);
```

**Verify**: `cd dns-manager && npm run build` exits 0; `npm run lint` exits 0.

### Step 4: Confirm behavior didn't regress

Run `cd dns-manager && npm run test:e2e` — confirm the same set of specs passes as
before (the navigation/server specs exercise routing; none should break).

If a Windows host with the bridge is available: open the Resolvers tab with
multiple servers configured, watch the bridge console — the start-resolver job
should fire once per poll cycle, not repeatedly as server status updates arrive.

## Test plan

No resolver-specific unit/E2E test exists. Verification:
- Automated: build + lint pass; the full Playwright suite passes unchanged.
- Manual (if bridge available): the poll runs to completion without restarting on
  unrelated server-status updates (Step 4).

A future E2E spec for the Resolvers tab (against the mock bridge) could assert the
start endpoint is called once per refresh — note as follow-up; not required here.

## Done criteria

ALL must hold:

- [ ] `grep -n 'serversRef' dns-manager/src/app/resolvers/page.tsx` → at least 3 matches (declare, sync effect, use in fetchAll).
- [ ] The `fetchAll` `useCallback` no longer depends on `[servers]`; the trigger effect no longer depends on `fetchAll` (verify by reading the two dep arrays).
- [ ] `cd dns-manager && npm run build` exits 0; `npm run lint` exits 0.
- [ ] `cd dns-manager && npm run test:e2e` passes the same specs as before.
- [ ] Only `dns-manager/src/app/resolvers/page.tsx` modified (`git status`).
- [ ] `plans/README.md` status row for 008 updated.

## STOP conditions

Stop and report if:

- The `fetchAll`/effect code doesn't match the "Current state" excerpt.
- After the change, the Resolvers tab no longer loads data on first connect
  (means the trigger effect isn't firing — check that `bridgeConnected` is `true`
  at mount and the effect runs once).
- ESLint reports an error that cannot be resolved with the documented
  `eslint-disable-next-line` (e.g. a genuinely-missing stable dependency) — report
  rather than disabling broadly.

## Maintenance notes

- The ref pattern keeps `fetchAll` stable while still reading fresh server data.
  If a future change needs the poll to react to a *specific* server being added,
  add that signal as an explicit, stable dependency rather than reverting to
  `[servers]`.
- Reviewer should confirm the unmount cleanup still clears timers and that
  `setLoading(false)` is still reached when `pending` empties.
- This is the same class of issue (effect re-run from an unstable callback) to
  watch for on other polling tabs (e.g. the BPA panel) — not in scope here.
