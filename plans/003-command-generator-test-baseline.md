# Plan 003: A unit-test runner exists and covers the PowerShell command generator

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in "STOP conditions" occurs, stop and report — do not
> improvise. When done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat db6c18d..HEAD -- dns-manager/src/wizards/command-generator.ts dns-manager/package.json`
> If either file changed since this plan was written, compare the "Current state"
> excerpts against the live code before proceeding; on a mismatch, STOP.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `db6c18d`, 2026-06-14

## Why this matters

The repository's reason for existing is generating **correct** PowerShell DNS
commands. The generator (`dns-manager/src/wizards/command-generator.ts`, 320
lines, 8 scenarios) is a pure function — the easiest possible thing to unit test
— yet it has **zero tests**. The only tests in the repo are 8 Playwright E2E
specs that run against a mock bridge; nothing exercises command generation. A
typo there silently produces invalid PowerShell that a user pastes into a DNS
server. This plan stands up a fast unit-test runner (Vitest) and writes
**characterization tests** that lock in the generator's current output. That
runner and those tests are also the safety net for plan 005 (which adds input
escaping to this same file) — land this first.

## Current state

- `dns-manager/package.json` scripts (lines 5-11) — there is **no** `test` script
  for unit tests, and no test runner in `devDependencies`:
  ```json
  "scripts": {
    "dev": "next dev --port 10010",
    "build": "next build",
    "start": "next start --port 10010",
    "lint": "eslint",
    "test:e2e": "node e2e/start-test.mjs"
  },
  ```
- `dns-manager/tsconfig.json` is `strict: true`, `module: esnext`, path alias
  `"@/*": ["./src/*"]`.
- The function under test is exported:
  `dns-manager/src/wizards/command-generator.ts:3`
  `export function generateCommands(scenarioId, data, serverHostname?): string`.
  It is **pure** — imports nothing, has no side effects — so it needs no
  environment, mocks, or DOM.

Representative current output to characterize (verbatim from the code):
- `blocklist` with `{ blocklistDomains: "a.com,b.com", blocklistAction: "IGNORE" }`
  → contains the line
  `Add-DnsServerQueryResolutionPolicy -Name "Blocklist" -Action IGNORE -FQDN "EQ,a.com,b.com" -ProcessingOrder 1`
  (see `command-generator.ts:78-97`).
- `serverHostname` other than `"localhost"` appends ` -ComputerName "<host>"`
  to each command (`command-generator.ts:8-11`).

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Install dev deps | `cd dns-manager && npm install -D vitest@^2` | exit 0, lockfile updated |
| Run unit tests | `cd dns-manager && npm run test` | all tests pass |
| Build (regression — unaffected) | `cd dns-manager && npm run build` | exit 0 |
| Lint | `cd dns-manager && npm run lint` | exit 0 |

## Suggested executor toolkit

- Vitest works with TypeScript out of the box (esbuild) — no Babel/ts-jest setup
  needed for a pure module. Default `node` test environment is correct here.

## Scope

**In scope**:
- `dns-manager/package.json` — add `vitest` devDependency and a `test` script.
- `dns-manager/vitest.config.ts` (create) — minimal config.
- `dns-manager/src/wizards/__tests__/command-generator.test.ts` (create) — the tests.

**Out of scope** (do NOT touch):
- `dns-manager/src/wizards/command-generator.ts` itself — this plan only
  *characterizes* current behavior; do not change the generator. (Plan 005 will.)
- The Playwright E2E setup (`e2e/`, `test:e2e`) — leave it as is. Do not let
  Vitest try to run the Playwright `*.spec.ts` files (the config below scopes
  Vitest to `src/**`).
- The MCP server copy (`mcp-server/src/tools/command-gen.ts`) — out of scope here;
  see Maintenance notes.

## Git workflow

- Branch: `advisor/003-cmdgen-test-baseline`
- Commit message: `test(wizards): add Vitest + characterization tests for command generator`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Add Vitest and a `test` script

In `dns-manager/package.json`, add to `scripts`:
```json
    "test": "vitest run",
    "test:watch": "vitest"
```
Then install: `cd dns-manager && npm install -D vitest@^2`.

**Verify**: `cd dns-manager && npx vitest --version` prints a 2.x version.

### Step 2: Add a minimal Vitest config scoped to `src`

Create `dns-manager/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
```
This deliberately scopes Vitest to `src/**/*.test.ts` so it never picks up the
Playwright specs under `e2e/`.

**Verify**: `cd dns-manager && npm run test` runs and reports "no test files" or
runs successfully (it will pass once Step 3 adds a test).

### Step 3: Write characterization tests

Create `dns-manager/src/wizards/__tests__/command-generator.test.ts`. Model the
structure on a simple `describe`/`it`/`expect` layout. Cover, at minimum, these
cases (assert on substrings of the returned string so the tests are robust to
comment lines):

```ts
import { describe, it, expect } from "vitest";
import { generateCommands } from "../command-generator";

describe("generateCommands", () => {
  it("blocklist: emits a single policy with joined FQDNs", () => {
    const out = generateCommands("blocklist", {
      blocklistDomains: "a.com,b.com",
      blocklistAction: "IGNORE",
    });
    expect(out).toContain(
      'Add-DnsServerQueryResolutionPolicy -Name "Blocklist" -Action IGNORE -FQDN "EQ,a.com,b.com" -ProcessingOrder 1'
    );
  });

  it("blocklist: splits into _Part batches over 100 domains", () => {
    const domains = Array.from({ length: 150 }, (_, i) => `d${i}.com`).join(",");
    const out = generateCommands("blocklist", { blocklistDomains: domains });
    expect(out).toContain('-Name "Blocklist_Part1"');
    expect(out).toContain('-Name "Blocklist_Part2"');
  });

  it("appends -ComputerName for a non-localhost server", () => {
    const out = generateCommands("blocklist", { blocklistDomains: "a.com" }, "dc01");
    expect(out).toContain('-ComputerName "dc01"');
  });

  it("omits -ComputerName for localhost", () => {
    const out = generateCommands("blocklist", { blocklistDomains: "a.com" }, "localhost");
    expect(out).not.toContain("-ComputerName");
  });

  it("geolocation: emits subnet, scope, and policy per region", () => {
    const out = generateCommands("geolocation", {
      zone: "contoso.com",
      recordName: "www",
      regions: [{ name: "US", subnet: "10.0.0.0/8", ip: "1.2.3.4" }],
    });
    expect(out).toContain('Add-DnsServerClientSubnet -Name "USSubnet" -IPv4Subnet "10.0.0.0/8"');
    expect(out).toContain('Add-DnsServerZoneScope -ZoneName "contoso.com" -Name "USScope"');
    expect(out).toContain('-Name "USPolicy"');
  });

  it("queryfilter: allow-mode uses NE operator", () => {
    const out = generateCommands("queryfilter", {
      filterMode: "allowlist",
      filterCriteria: ["FQDN"],
      filterFqdns: "good.com",
      filterPolicyName: "QF",
    });
    expect(out).toContain('-FQDN "NE,good.com"');
  });

  it("unknown scenario returns empty string", () => {
    expect(generateCommands("nope", {})).toBe("");
  });
});
```

**Verify**: `cd dns-manager && npm run test` → all tests pass (7 tests).

### Step 4: Confirm nothing else regressed

**Verify**: `cd dns-manager && npm run build` exits 0; `npm run lint` exits 0.

## Test plan

This plan *is* the test plan — it introduces the runner and the first suite. The
suite is characterization (locks current behavior), so all assertions reflect the
generator exactly as it exists at commit `db6c18d`. If any assertion fails on
first run, the excerpt in this plan is wrong or the file drifted — STOP and report
the actual output rather than editing the generator to match the test.

## Done criteria

ALL must hold:

- [ ] `cd dns-manager && npm run test` exits 0 with ≥7 passing tests, 0 failures.
- [ ] `cd dns-manager && npm run build` exits 0.
- [ ] `cd dns-manager && npm run lint` exits 0.
- [ ] `dns-manager/vitest.config.ts` and `dns-manager/src/wizards/__tests__/command-generator.test.ts` exist.
- [ ] `command-generator.ts` is unchanged (`git diff --stat -- dns-manager/src/wizards/command-generator.ts` shows no changes).
- [ ] `plans/README.md` status row for 003 updated.

## STOP conditions

Stop and report if:

- `dns-manager/package.json` scripts or `command-generator.ts` don't match the
  "Current state" excerpts.
- A characterization assertion fails on first run (means the documented current
  output is wrong — report the actual string; do NOT modify the generator).
- Vitest tries to execute the Playwright `e2e/*.spec.ts` files (the `include`
  glob should prevent this; if it happens, report rather than deleting specs).
- `npm install -D vitest@^2` fails to resolve against the existing lockfile
  (report the conflict).

## Maintenance notes

- Plan 005 depends on this: it adds escaping assertions to this same test file.
  Keep the file's structure simple so 005 can append cases.
- The MCP server (`mcp-server/src/tools/command-gen.ts`) is a near-duplicate of
  this generator and should get the same treatment (Vitest + tests) as a
  follow-up; it already includes the `psEscape` logic plan 005 ports to the
  frontend, so its tests would assert escaping is present.
- When adding new wizard scenarios, add a characterization test here in the same
  pass — that is the convention this plan establishes.
