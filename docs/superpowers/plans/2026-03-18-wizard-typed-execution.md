# Wizard Typed Execution — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace opaque `api.execute(commandString)` calls in wizard execution with typed API methods that provide per-step progress, structured errors, and credential-aware execution.

**Architecture:** Create a new `src/wizards/executor.ts` module that takes a scenario ID + wizard data and returns an ordered list of typed execution steps. Each step calls an existing API method (no new endpoints needed). The `handleExecute` in `page.tsx` iterates the steps, reporting progress per-step. `command-generator.ts` is untouched — it still generates PowerShell strings for the "Generate Commands" flow.

**Tech Stack:** TypeScript, existing `api.*()` methods from `src/lib/api.ts`.

---

## Design

### Execution Step

```ts
interface ExecutionStep {
  label: string;                    // "Create client subnet: NorthAmericaSubnet"
  execute: () => Promise<ApiResponse>; // Calls api.createSubnet(...) etc.
}
```

### Executor Function

```ts
function buildExecutionSteps(
  scenarioId: string,
  data: Record<string, any>,
  serverParams: { server?: string; serverId?: string; credentialMode?: string }
): ExecutionStep[]
```

Each scenario function returns an ordered array of steps. Dependencies are implicit in the ordering: subnets before zone scopes, zone scopes before records, records before policies.

### Execution Loop (in page.tsx)

```ts
for (const step of steps) {
  setProgress({ current: i, total: steps.length, label: step.label });
  const result = await step.execute();
  if (!result.success) {
    results.push({ ...step, error: result.error });
    // Continue or stop based on user preference
  } else {
    results.push({ ...step, ok: true });
  }
}
```

### What stays the same

- `command-generator.ts` — still produces PowerShell strings for "Generate Commands"
- `scenarios.ts` — metadata unchanged
- All step UI forms — data collection unchanged
- The review step still shows generated commands as preview

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `dns-manager/src/wizards/executor.ts` | **Create** | Builds typed execution steps per scenario |
| `dns-manager/src/app/wizards/page.tsx` | **Modify** | Replace `handleExecute` to use executor + progress UI |

---

## Task 1: Create the Executor Module

**Files:**
- Create: `dns-manager/src/wizards/executor.ts`

- [ ] **Step 1: Create executor.ts with the ExecutionStep interface and buildExecutionSteps dispatcher**

The function switches on `scenarioId` and delegates to per-scenario builders.

- [ ] **Step 2: Implement geolocation steps**

Order: fallback record → (per region: subnet → zone scope → scope record → policy)

- [ ] **Step 3: Implement splitbrain steps**

Order: AD zone (optional) → subnet or skip → zone scope → scope record → disable default recursion → create recursion scope → recursion policy → zone policy

- [ ] **Step 4: Implement blocklist steps**

Order: (per batch of 100 domains: policy)

- [ ] **Step 5: Implement timeofday steps**

Order: subnets (if any) → zone scopes + records → peak policies → normal policies (if subnets) → catch-all policy

- [ ] **Step 6: Implement loadbalancing steps**

Order: (per backend: zone scope → scope record) → load balance policy

- [ ] **Step 7: Implement geolb steps**

Order: subnets → zone scopes + records → per-region policies → worldwide catch-all (optional)

- [ ] **Step 8: Implement primarysecondary steps**

Order: zone transfer config → primary geo setup → (per secondary: create secondary zone → copy subnets → copy scopes → copy records → copy policies)

- [ ] **Step 9: Implement queryfilter steps**

Order: single policy with combined criteria

- [ ] **Step 10: Build and verify**

```bash
cd dns-manager && npx next build 2>&1 | tail -5
```

- [ ] **Step 11: Commit**

```bash
git add dns-manager/src/wizards/executor.ts
git commit -m "feat: add typed wizard execution engine with per-step API calls"
```

---

## Task 2: Update Wizard Page to Use Executor

**Files:**
- Modify: `dns-manager/src/app/wizards/page.tsx`

- [ ] **Step 1: Add progress state**

```ts
const [execProgress, setExecProgress] = useState<{
  running: boolean;
  current: number;
  total: number;
  label: string;
  results: { label: string; ok: boolean; error?: string }[];
} | null>(null);
```

- [ ] **Step 2: Replace handleExecute**

Replace the current implementation (split-by-newline → api.execute per line) with:

```ts
const handleExecute = async () => {
  const server = getActiveServer();
  const sp = server ? { server: server.hostname, serverId: server.id, credentialMode: server.credentialMode } : {};
  const steps = buildExecutionSteps(activeScenario!, data, sp);
  // ... iterate with progress
};
```

- [ ] **Step 3: Add progress UI to the review step**

Show a progress bar with step label and per-step pass/fail results below the command preview.

- [ ] **Step 4: Keep "Generate Commands" unchanged**

The generate flow still calls `generateCommands()` from `command-generator.ts`.

- [ ] **Step 5: Build and verify**

```bash
cd dns-manager && npx next build 2>&1 | tail -5
```

- [ ] **Step 6: Commit**

```bash
git add dns-manager/src/app/wizards/page.tsx
git commit -m "feat: wizard execution uses typed API calls with per-step progress"
```

---

## Task 3: Update Docs and Changelog

**Files:**
- Modify: `docs/help/wizards.md` — update "After Execution" section
- Modify: `dns-manager/public/help/wizards.md` — copy
- Modify: `CHANGELOG.md`
- Modify: `TODO.md` — remove completed item

- [ ] **Step 1: Update wizards.md**

Update the "After Execution" section to mention per-step progress display and structured error reporting.

- [ ] **Step 2: Copy to public/help**

- [ ] **Step 3: Update CHANGELOG**

- [ ] **Step 4: Remove from TODO**

- [ ] **Step 5: Commit**

```bash
git add docs/help/wizards.md dns-manager/public/help/wizards.md CHANGELOG.md TODO.md
git commit -m "docs: update wizard execution docs, changelog, and TODO"
```

---

## Verification

After all tasks complete:
- [ ] `npm run build` passes with zero TypeScript errors
- [ ] "Generate Commands" still produces PowerShell strings (unchanged)
- [ ] "Execute on Server" uses typed API calls with per-step progress
- [ ] Each wizard scenario executes correctly with step-by-step feedback
- [ ] Failed steps show structured error messages (not raw PowerShell errors)
- [ ] Server credentials from the active server are used for all API calls
- [ ] Existing wizard UI forms are unchanged
