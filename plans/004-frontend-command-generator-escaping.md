# Plan 004: Frontend command generator escapes input like its MCP twin; README claim is true

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in "STOP conditions" occurs, stop and report — do not
> improvise. When done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat db6c18d..HEAD -- dns-manager/src/wizards/command-generator.ts mcp-server/src/tools/command-gen.ts README.md`
> If any changed since this plan was written, compare the "Current state"
> excerpts against the live code before proceeding; on a mismatch, STOP.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plans/003-command-generator-test-baseline.md (needs the Vitest runner)
- **Category**: security / tech-debt / docs
- **Planned at**: commit `db6c18d`, 2026-06-14

## Why this matters

The PowerShell command generator exists in two copies: the frontend
(`dns-manager/src/wizards/command-generator.ts`) and the MCP server
(`mcp-server/src/tools/command-gen.ts`). The MCP copy escapes user input before
interpolating it into command strings (a `psEscape` + `sanitizeData` pair); the
frontend copy — which the MCP copy was "ported from" — never got that escaping.
As a result, a wizard field like a zone name of `x"$(calc)"` produces a
copy-pasteable command string with an unescaped subexpression. This is a
copy-paste foot-gun, not a server-side vulnerability (the wizard *execution* path
in `executor.ts` uses typed, splatted API calls and is unaffected). It also makes
the README's security claim **false** for the frontend path.

Two concrete defects to fix: (1) add the same escaping to the frontend generator
so its output is safe to paste; (2) correct `README.md:134`, which currently
claims the offline command output sanitizes `$`, backtick, and `"` — true for the
MCP tool, not for the frontend. We also leave a clear "keep in sync" marker so the
two copies don't drift again.

## Current state

The MCP copy already has the escaping — copy it from here
(`mcp-server/src/tools/command-gen.ts:22-49`):

```ts
/** Escape PowerShell metacharacters for safe use inside double-quoted strings.
 *  Covers: backtick, double quote, dollar sign (prevents $() subexpression execution). */
function psEscape(value: string): string {
  return value.replace(/[`"$]/g, (ch) => "`" + ch).replace(/[\r\n]+/g, " ");
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function generateCommands(
  scenarioId: string,
  data: Record<string, any>,
  serverHostname?: string
): string {
  const serverParam =
    serverHostname && serverHostname !== "localhost"
      ? ` -ComputerName "${psEscape(serverHostname)}"`
      : "";
  // Sanitize all string values in data to prevent PowerShell injection via quotes/backticks
  function sanitizeData(obj: any): any {
    if (typeof obj === "string") return psEscape(obj);
    if (Array.isArray(obj)) return obj.map(sanitizeData);
    if (obj && typeof obj === "object") {
      const out: any = {};
      for (const [k, v] of Object.entries(obj)) out[k] = sanitizeData(v);
      return out;
    }
    return obj;
  }
  data = sanitizeData(data);
  const cmds: string[] = [];
  // ... switch (scenarioId) ...
```

The frontend copy currently has **no** escaping
(`dns-manager/src/wizards/command-generator.ts:1-12`):

```ts
/* eslint-disable @typescript-eslint/no-explicit-any */

export function generateCommands(
  scenarioId: string,
  data: Record<string, any>,
  serverHostname?: string
): string {
  const serverParam =
    serverHostname && serverHostname !== "localhost"
      ? ` -ComputerName "${serverHostname}"`
      : "";
  const cmds: string[] = [];
  // ... switch (scenarioId) ... (no sanitizeData; raw interpolation throughout)
```

The README claim to correct (`README.md:134`):
```
- Generated PowerShell commands (offline tool) sanitize all input against injection (`$`, `` ` ``, `"`)
```

> Note: the two `generateCommands` switch bodies are otherwise **identical**. This
> plan only adds the escaping prologue to the frontend copy — do not rewrite the
> switch.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Unit tests | `cd dns-manager && npm run test` | all pass (incl. new escaping tests) |
| Build | `cd dns-manager && npm run build` | exit 0 |
| Lint | `cd dns-manager && npm run lint` | exit 0 |
| MCP build (twin still compiles) | `cd mcp-server && npm install && npm run build` | exit 0 |

## Scope

**In scope**:
- `dns-manager/src/wizards/command-generator.ts` — add `psEscape` + `sanitizeData`
  prologue (matching the MCP copy), plus a "keep in sync" header comment.
- `dns-manager/src/wizards/__tests__/command-generator.test.ts` — add escaping tests.
- `README.md` — correct line 134.
- `mcp-server/src/tools/command-gen.ts` — add the matching "keep in sync" header
  comment ONLY (no logic change; it already escapes).

**Out of scope** (do NOT touch):
- The `switch (scenarioId)` bodies in either file — they are identical and correct.
- `dns-manager/src/wizards/executor.ts` — the execution path is already safe
  (typed splatted API calls); changing it is unnecessary and risky.
- Do NOT attempt to extract a shared cross-package module in this plan (different
  build systems — Next bundler vs. MCP's Node16 ESM tsc). That is deferred; see
  Maintenance notes.

## Git workflow

- Branch: `advisor/004-frontend-cmdgen-escaping`
- Commit message: `fix(wizards): escape input in frontend command generator to match MCP copy`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Add the escaping prologue to the frontend generator

Edit `dns-manager/src/wizards/command-generator.ts`. Replace the top of the file
(the excerpt shown in "Current state", lines 1-12) so it matches the MCP copy's
prologue. The result should be:

```ts
/* eslint-disable @typescript-eslint/no-explicit-any */

// ⚠ KEEP IN SYNC with mcp-server/src/tools/command-gen.ts (same generator, two packages).
//   If you change scenario logic here, mirror it there, and vice versa.

/** Escape PowerShell metacharacters for safe use inside double-quoted strings.
 *  Covers: backtick, double quote, dollar sign (prevents $() subexpression execution). */
function psEscape(value: string): string {
  return value.replace(/[`"$]/g, (ch) => "`" + ch).replace(/[\r\n]+/g, " ");
}

export function generateCommands(
  scenarioId: string,
  data: Record<string, any>,
  serverHostname?: string
): string {
  const serverParam =
    serverHostname && serverHostname !== "localhost"
      ? ` -ComputerName "${psEscape(serverHostname)}"`
      : "";
  // Sanitize all string values in data to prevent PowerShell injection via quotes/backticks
  function sanitizeData(obj: any): any {
    if (typeof obj === "string") return psEscape(obj);
    if (Array.isArray(obj)) return obj.map(sanitizeData);
    if (obj && typeof obj === "object") {
      const out: any = {};
      for (const [k, v] of Object.entries(obj)) out[k] = sanitizeData(v);
      return out;
    }
    return obj;
  }
  data = sanitizeData(data);
  const cmds: string[] = [];
```

Leave everything from the first `switch (scenarioId) {` onward unchanged.

**Verify**: `cd dns-manager && npm run test` → the existing characterization
tests from plan 003 still pass. Note: the test
`it("blocklist: emits a single policy with joined FQDNs")` uses only
alphanumeric/dot input (`a.com,b.com`), which `psEscape` leaves unchanged, so it
must still pass. If any plan-003 test now fails, you changed behavior for safe
input — STOP.

### Step 2: Add escaping tests

Append to `dns-manager/src/wizards/__tests__/command-generator.test.ts`:

```ts
describe("generateCommands escaping", () => {
  it("escapes double quotes, backticks, and $ in field values", () => {
    const out = generateCommands("geolocation", {
      zone: 'evil"$(calc)"',
      recordName: "www",
      regions: [{ name: "US", subnet: "10.0.0.0/8", ip: "1.2.3.4" }],
    });
    // Raw, dangerous form must NOT appear:
    expect(out).not.toContain('"evil"$(calc)""');
    // Escaped form (backtick before each metachar) must appear:
    expect(out).toContain('evil`"`$(calc)`"');
  });

  it("escapes the serverHostname", () => {
    const out = generateCommands("blocklist", { blocklistDomains: "a.com" }, 'h"$(x)');
    expect(out).toContain('-ComputerName "h`"`$(x)"');
  });

  it("leaves safe alphanumeric input unchanged", () => {
    const out = generateCommands("blocklist", { blocklistDomains: "a.com,b.com", blocklistAction: "IGNORE" });
    expect(out).toContain('-FQDN "EQ,a.com,b.com"');
  });
});
```

**Verify**: `cd dns-manager && npm run test` → all tests pass (plan 003 set + these 3).

### Step 3: Correct the README claim

In `README.md`, change line 134 from:
```
- Generated PowerShell commands (offline tool) sanitize all input against injection (`$`, `` ` ``, `"`)
```
to:
```
- Generated PowerShell commands (offline command generator, both the web UI and the MCP `dns_generate_policy_commands` tool) escape user input against injection (`$`, `` ` ``, `"`) before interpolation
```

**Verify**: `grep -n 'escape user input against injection' README.md` → one match.

### Step 4: Add the matching sync marker to the MCP copy (comment only)

In `mcp-server/src/tools/command-gen.ts`, just below the existing top comment
block (after `command-gen.ts:7`'s `*/`), add:
```ts
// ⚠ KEEP IN SYNC with dns-manager/src/wizards/command-generator.ts (same generator, two packages).
```
Do not change any logic.

**Verify**: `cd mcp-server && npm install && npm run build` exits 0.

## Test plan

- New tests: the 3 escaping cases in Step 2, in
  `dns-manager/src/wizards/__tests__/command-generator.test.ts`, following the
  structure established by plan 003.
- Covers: a metacharacter-laden field value is escaped (the security fix), the
  hostname is escaped, and safe input is untouched (no regression).
- Verification: `cd dns-manager && npm run test` → all pass.

## Done criteria

ALL must hold:

- [ ] `cd dns-manager && npm run test` exits 0; the 3 new escaping tests pass.
- [ ] `cd dns-manager && npm run build` exits 0; `npm run lint` exits 0.
- [ ] `cd mcp-server && npm run build` exits 0.
- [ ] `grep -n 'function psEscape' dns-manager/src/wizards/command-generator.ts` → one match.
- [ ] `grep -n 'KEEP IN SYNC' dns-manager/src/wizards/command-generator.ts mcp-server/src/tools/command-gen.ts` → one match in each file.
- [ ] `grep -n 'sanitize all input against injection' README.md` → no matches (old claim removed).
- [ ] Only the in-scope files modified (`git status`).
- [ ] `plans/README.md` status row for 004 updated.

## STOP conditions

Stop and report if:

- The frontend prologue or the MCP `psEscape`/`sanitizeData` don't match the
  "Current state" excerpts (drift since this plan was written).
- A plan-003 characterization test fails after Step 1 (means escaping changed
  behavior for safe input — investigate `psEscape` regex, do not edit the tests).
- The two `switch` bodies turn out NOT to be identical — report the differences;
  do not silently reconcile them.

## Maintenance notes

- The real long-term fix is a single shared module imported by both packages,
  eliminating the copy. It is deferred here because the two packages use
  different build systems (Next bundler vs. Node16 ESM tsc) and a shared file
  needs a chosen home both can import — a larger change with its own risk. The
  "KEEP IN SYNC" markers are the interim guard. Track the extraction as a
  separate tech-debt item.
- Reviewer should verify the escaping is applied to ALL interpolated values (it
  is, because `sanitizeData` runs over the whole `data` object and `serverParam`
  escapes the hostname) and that no scenario reads `serverHostname` raw after the
  prologue.
