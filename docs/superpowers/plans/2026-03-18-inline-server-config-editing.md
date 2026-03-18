# Inline Server Configuration Editing — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make all server configuration panels editable inline — click a toggle or input to change a value, save to the server immediately.

**Architecture:** Extract a reusable `EditableField` component that handles boolean (Switch), numeric (Input), and string (Input) fields with optimistic updates and toast feedback. Each panel replaces its read-only Badge display with `EditableField` components. No new API endpoints needed — all setter methods already exist.

**Tech Stack:** React, shadcn/ui (Switch, Input, Badge), Zustand, existing `api.set*()` methods.

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `dns-manager/src/components/server/editable-field.tsx` | **Create** | Reusable inline field component (boolean/numeric/string) |
| `dns-manager/src/components/server/server-config.tsx` | **Modify** | Replace read-only displays with EditableField in 7 panels |

No new API endpoints, types, or store changes needed.

---

## Design: EditableField Component

A single component that renders differently based on field type:

- **Boolean** → shadcn `Switch` that toggles immediately on click, calls save callback
- **Numeric** → `Input type=number` that shows current value, calls save on blur or Enter
- **String** → `Input type=text` that shows current value, calls save on blur or Enter
- **Read-only** → Falls back to current Badge display (for fields without setters)

Props:
```tsx
interface EditableFieldProps {
  label: string;
  value: unknown;
  type: "boolean" | "number" | "string" | "readonly";
  onSave: (newValue: unknown) => Promise<boolean>; // returns success
}
```

The `onSave` callback is provided by the parent panel, which calls the appropriate `api.set*()` method with the single changed field, then refreshes.

---

### Task 1: Create EditableField Component

**Files:**
- Create: `dns-manager/src/components/server/editable-field.tsx`

- [ ] **Step 1: Create the EditableField component**

```tsx
// dns-manager/src/components/server/editable-field.tsx
"use client";

import { useState } from "react";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { RefreshCw } from "lucide-react";

interface EditableFieldProps {
  label: string;
  value: unknown;
  type: "boolean" | "number" | "string" | "readonly";
  onSave?: (newValue: unknown) => Promise<boolean>;
}

export function EditableField({ label, value, type, onSave }: EditableFieldProps) {
  const [saving, setSaving] = useState(false);
  const [localValue, setLocalValue] = useState(String(value ?? ""));

  const save = async (newVal: unknown) => {
    if (!onSave) return;
    setSaving(true);
    await onSave(newVal);
    setSaving(false);
  };

  if (type === "readonly" || !onSave) {
    return (
      <div className="flex items-center justify-between p-2 rounded bg-secondary/30">
        <span className="text-xs text-muted-foreground truncate mr-2">{label}</span>
        <Badge variant="secondary" className="text-xs shrink-0">{String(value ?? "")}</Badge>
      </div>
    );
  }

  if (type === "boolean") {
    return (
      <div className="flex items-center justify-between p-2 rounded bg-secondary/30">
        <span className="text-xs text-muted-foreground truncate mr-2">{label}</span>
        {saving ? (
          <RefreshCw className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
        ) : (
          <Switch
            checked={Boolean(value)}
            onCheckedChange={(checked) => save(checked)}
          />
        )}
      </div>
    );
  }

  // number or string
  return (
    <div className="flex items-center justify-between gap-2 p-2 rounded bg-secondary/30">
      <span className="text-xs text-muted-foreground truncate shrink-0">{label}</span>
      {saving ? (
        <RefreshCw className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
      ) : (
        <Input
          type={type === "number" ? "number" : "text"}
          value={localValue}
          onChange={(e) => setLocalValue(e.target.value)}
          onBlur={() => {
            const newVal = type === "number" ? parseInt(localValue) || 0 : localValue;
            if (String(newVal) !== String(value)) save(newVal);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              const newVal = type === "number" ? parseInt(localValue) || 0 : localValue;
              save(newVal);
            }
          }}
          className="h-7 w-28 text-xs text-right font-mono"
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify build passes**

Run: `cd dns-manager && npx next build 2>&1 | tail -5`
Expected: Compiled successfully (component is created but not yet imported anywhere)

- [ ] **Step 3: Commit**

```bash
git add dns-manager/src/components/server/editable-field.tsx
git commit -m "feat: add EditableField component for inline server config editing"
```

---

### Task 2: Wire General Settings Panel

**Files:**
- Modify: `dns-manager/src/components/server/server-config.tsx` (General Settings section, ~lines 274-292)

Replace the read-only Badge grid with EditableField switches. The save callback calls `api.setServerSettings({ [field]: value })` then refreshes.

- [ ] **Step 1: Import EditableField and create the save helper**

Add import at top of `server-config.tsx`:
```tsx
import { EditableField } from "./editable-field";
```

Create a helper inside `ServerConfig` component (after the existing loaders):
```tsx
const saveServerSetting = useCallback(async (field: string, value: unknown) => {
  const p = sp();
  const r = await api.setServerSettings({ [field]: value }, p.server, p.serverId, p.credentialMode);
  if (r.success) { toast.success(`${field} updated.`); loadSettings(); return true; }
  toast.error("Failed: " + r.error);
  return false;
}, [sp, loadSettings]);
```

- [ ] **Step 2: Replace General Settings panel body**

Replace the existing grid of Badge displays with:
```tsx
{settings ? (
  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
    {["RoundRobin", "BindSecondaries", "StrictFileParsing", "LocalNetPriority"].map((key) =>
      settings[key] !== undefined ? (
        <EditableField
          key={key}
          label={key}
          value={settings[key]}
          type="boolean"
          onSave={(v) => saveServerSetting(key, v)}
        />
      ) : null
    )}
    {["WriteAuthorityNS", "NameCheckFlag"].map((key) =>
      settings[key] !== undefined ? (
        <EditableField key={key} label={key} value={settings[key]} type="readonly" />
      ) : null
    )}
  </div>
) : (
  <p className="text-sm text-muted-foreground">Click refresh to load server settings.</p>
)}
```

- [ ] **Step 3: Build and verify**

Run: `cd dns-manager && npx next build 2>&1 | tail -5`
Expected: Compiled successfully

- [ ] **Step 4: Commit**

```bash
git add dns-manager/src/components/server/server-config.tsx
git commit -m "feat: inline editing for General Settings (boolean toggles)"
```

---

### Task 3: Wire Recursion Panel

**Files:**
- Modify: `dns-manager/src/components/server/server-config.tsx` (Recursion section)

- [ ] **Step 1: Create recursion save helper**

```tsx
const saveRecursionSetting = useCallback(async (field: string, value: unknown) => {
  const p = sp();
  const r = await api.setRecursionSettings({ [field.substring(0,1).toLowerCase() + field.substring(1)]: value }, p.server, p.serverId, p.credentialMode);
  if (r.success) { toast.success(`${field} updated.`); loadRecursion(); return true; }
  toast.error("Failed: " + r.error);
  return false;
}, [sp, loadRecursion]);
```

- [ ] **Step 2: Replace Recursion panel body**

Replace with:
```tsx
{recursion ? (
  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
    {["Enable", "SecureResponse"].map((key) =>
      recursion[key] !== undefined ? (
        <EditableField key={key} label={key} value={recursion[key]} type="boolean" onSave={(v) => saveRecursionSetting(key, v)} />
      ) : null
    )}
    {["Timeout", "AdditionalTimeout", "Retries"].map((key) =>
      recursion[key] !== undefined ? (
        <EditableField key={key} label={key} value={recursion[key]} type={key === "Timeout" ? "string" : "number"} onSave={(v) => saveRecursionSetting(key, v)} />
      ) : null
    )}
  </div>
) : (
  <p className="text-sm text-muted-foreground">Click refresh to load recursion settings.</p>
)}
```

- [ ] **Step 3: Build, verify, commit**

Run: `cd dns-manager && npx next build 2>&1 | tail -5`

```bash
git add dns-manager/src/components/server/server-config.tsx
git commit -m "feat: inline editing for Recursion settings"
```

---

### Task 4: Wire Diagnostics Panel

**Files:**
- Modify: `dns-manager/src/components/server/server-config.tsx` (Diagnostics section)

- [ ] **Step 1: Create diagnostics save helper**

```tsx
const saveDiagnosticSetting = useCallback(async (field: string, value: unknown) => {
  const p = sp();
  const camel = field.substring(0,1).toLowerCase() + field.substring(1);
  const r = await api.setDiagnostics({ [camel]: value }, p.server, p.serverId, p.credentialMode);
  if (r.success) { toast.success(`${field} updated.`); loadDiagnostics(); return true; }
  toast.error("Failed: " + r.error);
  return false;
}, [sp, loadDiagnostics]);
```

- [ ] **Step 2: Replace Diagnostics panel body**

Replace with:
```tsx
{diagnostics ? (
  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
    {Object.entries(diagnostics)
      .filter(([, v]) => typeof v === "boolean")
      .map(([key, val]) => (
        <EditableField key={key} label={key} value={val} type="boolean" onSave={(v) => saveDiagnosticSetting(key, v)} />
      ))}
    {Object.entries(diagnostics)
      .filter(([k, v]) => typeof v === "number" || (typeof v === "string" && k !== "PSComputerName"))
      .map(([key, val]) => (
        <EditableField key={key} label={key} value={val} type={typeof val === "number" ? "number" : "string"} onSave={(v) => saveDiagnosticSetting(key, v)} />
      ))}
  </div>
) : (
  <p className="text-sm text-muted-foreground">Click refresh to load diagnostics.</p>
)}
```

- [ ] **Step 3: Build, verify, commit**

```bash
git add dns-manager/src/components/server/server-config.tsx
git commit -m "feat: inline editing for Diagnostics (15 toggles + inputs)"
```

---

### Task 5: Wire RRL Panel

**Files:**
- Modify: `dns-manager/src/components/server/server-config.tsx` (RRL settings section, not exceptions — those already have CRUD)

- [ ] **Step 1: Create RRL save helper**

```tsx
const saveRRLSetting = useCallback(async (field: string, value: unknown) => {
  const p = sp();
  const camel = field.substring(0,1).toLowerCase() + field.substring(1);
  const r = await api.setRRL({ [camel]: value }, p.server, p.serverId, p.credentialMode);
  if (r.success) { toast.success(`${field} updated.`); loadRRL(); return true; }
  toast.error("Failed: " + r.error);
  return false;
}, [sp, loadRRL]);
```

- [ ] **Step 2: Replace RRL settings grid**

Replace the read-only grid (the one with Mode, ResponsesPerSec, etc.) with:
```tsx
<div className="grid grid-cols-2 md:grid-cols-3 gap-2">
  <EditableField label="Mode" value={rrl.Mode} type="string" onSave={(v) => saveRRLSetting("Mode", v)} />
  {["ResponsesPerSec", "ErrorsPerSec", "WindowInSec", "LeakRate", "TruncateRate", "TCRate", "IPv4PrefixLength", "IPv6PrefixLength"].map((key) =>
    rrl[key] !== undefined ? (
      <EditableField key={key} label={key} value={rrl[key]} type="number" onSave={(v) => saveRRLSetting(key, v)} />
    ) : null
  )}
</div>
```

- [ ] **Step 3: Build, verify, commit**

```bash
git add dns-manager/src/components/server/server-config.tsx
git commit -m "feat: inline editing for RRL settings (mode + 8 numeric fields)"
```

---

### Task 6: Wire Scavenging Panel

**Files:**
- Modify: `dns-manager/src/components/server/server-config.tsx` (Scavenging section)

- [ ] **Step 1: Create scavenging save helper**

```tsx
const saveScavengingSetting = useCallback(async (field: string, value: unknown) => {
  const p = sp();
  const camel = field.substring(0,1).toLowerCase() + field.substring(1);
  const r = await api.setScavenging({ [camel]: value }, p.server, p.serverId, p.credentialMode);
  if (r.success) { toast.success(`${field} updated.`); loadScavenging(); return true; }
  toast.error("Failed: " + r.error);
  return false;
}, [sp, loadScavenging]);
```

- [ ] **Step 2: Replace Scavenging panel body**

Replace the generic grid with:
```tsx
{scavenging ? (
  <div className="space-y-3">
    <div className="grid grid-cols-2 gap-2">
      <EditableField label="ScavengingState" value={scavenging.ScavengingState} type="boolean" onSave={(v) => saveScavengingSetting("ScavengingState", v)} />
      {["ScavengingInterval", "RefreshInterval", "NoRefreshInterval"].map((key) =>
        scavenging[key] !== undefined ? (
          <EditableField key={key} label={key} value={scavenging[key]} type="string" onSave={(v) => saveScavengingSetting(key, v)} />
        ) : null
      )}
      {scavenging.LastScavengeTime !== undefined && (
        <EditableField label="LastScavengeTime" value={scavenging.LastScavengeTime} type="readonly" />
      )}
    </div>
    <Button variant="outline" size="sm" onClick={async () => { /* existing scavenge now handler */ }}>
      <Timer className="h-3.5 w-3.5 mr-1.5" /> Scavenge Now
    </Button>
  </div>
) : (
  <p className="text-sm text-muted-foreground">Click refresh to load scavenging settings.</p>
)}
```

- [ ] **Step 3: Build, verify, commit**

```bash
git add dns-manager/src/components/server/server-config.tsx
git commit -m "feat: inline editing for Scavenging settings"
```

---

### Task 7: Wire Remaining Panels (Forwarders extras, Block List enable, EDNS, Global Name Zone)

**Files:**
- Modify: `dns-manager/src/components/server/server-config.tsx`

- [ ] **Step 1: Add UseRootHint toggle and Timeout input to ForwardersPanel**

In the ForwardersPanel sub-component, replace the read-only UseRootHint badge with:
```tsx
<EditableField
  label="Use Root Hints"
  value={forwarders.UseRootHint}
  type="boolean"
  onSave={async (v) => {
    const p = getServerParams();
    const r = await api.setForwarders({ useRootHint: v }, p.server, p.serverId, p.credentialMode);
    if (r.success) { toast.success("Updated."); onRefresh(); return true; }
    toast.error("Failed: " + r.error); return false;
  }}
/>
```

- [ ] **Step 2: Add Enable toggle to BlocklistPanel**

Replace the read-only Enable badge with:
```tsx
<EditableField
  label="Enabled"
  value={enabled}
  type="boolean"
  onSave={async (v) => {
    const p = getServerParams();
    const r = await api.setBlockList({ enable: v }, p.server, p.serverId, p.credentialMode);
    if (r.success) { toast.success("Updated."); onRefresh(); return true; }
    toast.error("Failed: " + r.error); return false;
  }}
/>
```

- [ ] **Step 3: Replace EDNS panel body with EditableField components**

Replace the generic grid with typed EditableField components:
```tsx
{edns ? (
  <div className="grid grid-cols-2 gap-2">
    {Object.entries(edns).filter(([, v]) => v !== null).map(([key, val]) => (
      <EditableField
        key={key}
        label={key}
        value={val}
        type={typeof val === "boolean" ? "boolean" : typeof val === "number" ? "number" : "string"}
        onSave={async (v) => {
          const p = sp();
          const camel = key.substring(0,1).toLowerCase() + key.substring(1);
          const r = await api.setEDns({ [camel]: v }, p.server, p.serverId, p.credentialMode);
          if (r.success) { toast.success(`${key} updated.`); loadEDns(); return true; }
          toast.error("Failed: " + r.error); return false;
        }}
      />
    ))}
  </div>
) : (
  <p className="text-sm text-muted-foreground">Click refresh to load EDNS settings.</p>
)}
```

- [ ] **Step 4: Replace Global Name Zone panel body**

Same pattern — replace read-only with EditableField:
```tsx
{globalNameZone ? (
  <div className="grid grid-cols-2 gap-2">
    {Object.entries(globalNameZone).filter(([, v]) => v !== null).map(([key, val]) => (
      <EditableField
        key={key}
        label={key}
        value={val}
        type={typeof val === "boolean" ? "boolean" : typeof val === "number" ? "number" : "string"}
        onSave={async (v) => {
          const p = sp();
          const camel = key.substring(0,1).toLowerCase() + key.substring(1);
          const r = await api.setGlobalNameZone({ [camel]: v }, p.server, p.serverId, p.credentialMode);
          if (r.success) { toast.success(`${key} updated.`); loadGlobalNameZone(); return true; }
          toast.error("Failed: " + r.error); return false;
        }}
      />
    ))}
  </div>
) : (
  <p className="text-sm text-muted-foreground">Click refresh to load Global Name Zone settings.</p>
)}
```

- [ ] **Step 5: Import EditableField in ForwardersPanel and BlocklistPanel**

Both sub-components are in the same file, so the import from Task 2 covers them.

- [ ] **Step 6: Build and verify**

Run: `cd dns-manager && npx next build 2>&1 | tail -5`
Expected: Compiled successfully

- [ ] **Step 7: Commit**

```bash
git add dns-manager/src/components/server/server-config.tsx
git commit -m "feat: inline editing for Forwarders, Block List, EDNS, Global Name Zone"
```

---

### Task 8: Update Help Docs and Changelog

**Files:**
- Modify: `docs/help/server-management.md`
- Modify: `dns-manager/public/help/server-management.md` (copy)
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Update server-management.md**

Update the Server Configuration section to mention that settings are now editable inline — toggles apply immediately, numeric/string values save on Enter or blur.

- [ ] **Step 2: Copy to public/help**

```bash
cp docs/help/server-management.md dns-manager/public/help/server-management.md
```

- [ ] **Step 3: Update CHANGELOG.md**

Add under `[Unreleased]`:
```markdown
### Changed
- Server Configuration panels now support inline editing — boolean settings toggle immediately via Switch, numeric and string values edit in-place and save on Enter or blur. Covers General Settings, Recursion, Diagnostics, RRL, Scavenging, Forwarders, Block List, EDNS, and Global Name Zone.
```

- [ ] **Step 4: Final commit**

```bash
git add docs/help/server-management.md dns-manager/public/help/server-management.md CHANGELOG.md
git commit -m "docs: update help and changelog for inline server config editing"
```

---

## Verification

After all tasks complete:
- [ ] `npm run build` passes with zero TypeScript errors
- [ ] General Settings: toggle RoundRobin → switch flips, toast shows success, value persists on refresh
- [ ] Recursion: toggle Enable → saves, change Retries → type number, press Enter → saves
- [ ] Diagnostics: toggle any logging option → saves immediately
- [ ] RRL: change ResponsesPerSec → saves on blur
- [ ] Scavenging: toggle ScavengingState → saves, Scavenge Now still works
- [ ] Forwarders: UseRootHint toggle works, existing add/remove still works
- [ ] Block List: Enable toggle works, existing add/remove still works
- [ ] EDNS and Global Name Zone: fields are editable where setter exists
- [ ] Cache, Statistics, Root Hints, AD Settings: remain read-only (no setter API)
