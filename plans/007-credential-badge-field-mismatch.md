# Plan 007: Saved-credential status reflects the bridge correctly (field-name fix)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If
> anything in "STOP conditions" occurs, stop and report. When done, update the
> status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat db6c18d..HEAD -- dns-manager/src/app/server/page.tsx dns-manager/src/lib/api.ts server/bridge.ps1`
> If any changed since this plan was written, compare the "Current state"
> excerpts against the live code before proceeding; on a mismatch, STOP.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug (correctness)
- **Planned at**: commit `db6c18d`, 2026-06-14

## Why this matters

When the bridge comes online, the Server tab checks each saved-credential server
and is supposed to light up a "has credential" indicator. It never does, because
of a field-name mismatch: the bridge's check endpoint returns `{ success, exists
}`, but the frontend reads `res.found` (which is always `undefined`). So
`hasCredential` is set to `false` for every server regardless of whether a
DPAPI-encrypted credential actually exists — a silently wrong UI state. The same
code also uses `.forEach(async …)`, which floats unhandled promises (any rejection
is swallowed). This plan fixes the field name and the async pattern.

## Current state

The bridge returns `exists` (`server/bridge.ps1:315-318`, inside
`Handle-CheckCredential`):
```powershell
    Send-Response -Response $Response -Body @{
        success = $true
        exists  = $exists
    }
```

The API client passes the response through unchanged
(`dns-manager/src/lib/api.ts:241-245`):
```ts
  checkCredential: (serverId: string) =>
    request(
      "GET",
      `/api/credentials/check?serverId=${encodeURIComponent(serverId)}`
    ),
```
Per the project's API contract, `request()` resolves to
`{ success, error?, bridgeDown?, ...data }` — so the response field is
`res.exists`, **not** `res.found`.

The buggy consumer (`dns-manager/src/app/server/page.tsx:165-178`):
```tsx
  // ── Check saved credentials when bridge comes online ──────
  useEffect(() => {
    if (!bridgeConnected) return;
    servers
      .filter((s) => s.credentialMode === "savedCredential")
      .forEach(async (s) => {
        const res = await api.checkCredential(s.id);
        if (res.success) {
          updateServer(s.id, { hasCredential: !!res.found });   // <-- res.found is always undefined
        }
      });
    // Run once when bridge connects; intentionally not re-running on servers changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridgeConnected]);
```

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Typecheck/build | `cd dns-manager && npm run build` | exit 0 |
| Lint | `cd dns-manager && npm run lint` | exit 0 (note the existing `eslint-disable` line stays) |
| Unit tests (if plan 003 landed) | `cd dns-manager && npm run test` | all pass |

## Scope

**In scope**:
- `dns-manager/src/app/server/page.tsx` — the `useEffect` at lines 165-178.

**Out of scope** (do NOT touch):
- `api.ts` (the pass-through is correct) and the bridge (`exists` is the right
  field name — do not rename it; other callers / tests may rely on it).
- The `Server` type's `hasCredential` field.
- The intentional "run once on connect" behavior — keep the dependency array as
  `[bridgeConnected]` and keep the `eslint-disable-next-line` comment.

## Git workflow

- Branch: `advisor/007-credential-badge-fix`
- Commit message: `fix(server): read 'exists' from checkCredential and await checks properly`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Fix the field name and the async iteration

Replace the `useEffect` body (lines 166-178) with a version that (a) reads
`res.exists`, and (b) awaits all checks via `Promise.all` over `.map` instead of
`.forEach(async …)`:

```tsx
  // ── Check saved credentials when bridge comes online ──────
  useEffect(() => {
    if (!bridgeConnected) return;
    void Promise.all(
      servers
        .filter((s) => s.credentialMode === "savedCredential")
        .map(async (s) => {
          const res = await api.checkCredential(s.id);
          if (res.success) {
            updateServer(s.id, { hasCredential: !!res.exists });
          }
        })
    );
    // Run once when bridge connects; intentionally not re-running on servers changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridgeConnected]);
```

(`void Promise.all(...)` makes the fire-and-forget explicit and keeps the effect
callback synchronous, which is the correct React pattern.)

**Verify**: `cd dns-manager && npm run build` exits 0; `npm run lint` exits 0.

### Step 2: Confirm the field name against the type, if one exists

Check whether `api.checkCredential`'s response is typed. Run
`grep -rn "checkCredential\|exists\b" dns-manager/src/lib/types.ts dns-manager/src/lib/api.ts`.
- If there is a typed return that declares `found` (and not `exists`), STOP and
  report — the type itself encodes the bug and fixing it is a wider change.
- If the response is loosely typed (`ApiResponse` with index/`...data`), no further
  change is needed.

**Verify**: build still exits 0.

## Test plan

This is a small UI-state fix in a `useEffect`; the project has no React unit-test
setup (Playwright E2E only). Verification is the typecheck/lint gates plus, if a
Windows host with the bridge is available, a manual check:
- Store a credential for a `savedCredential` server (Server tab), reload, and
  confirm the "has credential" indicator now appears (previously it never did).

If no bridge host is available, record that the manual check was not run; the
build/lint gates are the automated verification.

Optionally, if plan 003's Vitest runner has landed and `api` is mockable, a small
test asserting the effect maps `exists → hasCredential` could be added — but the
effect is tightly coupled to the component, so this is not required.

## Done criteria

ALL must hold:

- [ ] `grep -n 'res.found' dns-manager/src/app/server/page.tsx` → no matches.
- [ ] `grep -n 'res.exists' dns-manager/src/app/server/page.tsx` → one match.
- [ ] `grep -n 'forEach(async' dns-manager/src/app/server/page.tsx` → no matches (replaced by `Promise.all`/`.map`).
- [ ] `cd dns-manager && npm run build` exits 0; `npm run lint` exits 0.
- [ ] Only `dns-manager/src/app/server/page.tsx` modified (`git status`).
- [ ] `plans/README.md` status row for 007 updated.

## STOP conditions

Stop and report if:

- The `useEffect` or the bridge/api excerpts don't match "Current state".
- A type declares the field as `found` (Step 2) — the fix then spans the type and
  is larger than this plan.
- `api.checkCredential` turns out to remap `exists`→`found` somewhere (search for
  `found` in `api.ts`) — if so, the real bug is elsewhere; report it.

## Maintenance notes

- Root cause is an untyped API surface: `checkCredential` returns `any`-ish data,
  so the wrong field name compiled fine. A worthwhile follow-up is giving the
  bridge endpoints typed response shapes so mismatches fail the typecheck.
- Reviewer should confirm `exists` matches the bridge's actual JSON key
  (`Handle-CheckCredential`) and that the effect still runs only on
  `bridgeConnected` changes.
