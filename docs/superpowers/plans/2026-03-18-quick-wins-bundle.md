# Quick Wins Bundle — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close three small gaps: DNSSEC help docs, full policy copy support, and CI build checks.

**Architecture:** Three independent changes — a new markdown doc + mapping fix, a bridge handler expansion, and a GitHub Actions workflow file.

**Tech Stack:** Markdown, PowerShell, GitHub Actions YAML.

---

## Task 1: DNSSEC Help Documentation

**Files:**
- Create: `docs/help/dnssec.md`
- Copy to: `dns-manager/public/help/dnssec.md`
- Modify: `dns-manager/src/lib/help-mapping.ts` — change `/dnssec` mapping from `getting-started` to `dnssec`
- Modify: `dns-manager/src/lib/help-mapping.ts` — add `dnssec` to `allDocs` array

- [ ] **Step 1: Write `docs/help/dnssec.md`**

Cover: zone signing status table, sign/unsign actions (with confirmation), signing key management (KSK/ZSK, add/remove, algorithm selection), trust anchors (view/add/remove), trust points (view/update), and public key export.

- [ ] **Step 2: Copy to public/help**

```bash
cp docs/help/dnssec.md dns-manager/public/help/dnssec.md
```

- [ ] **Step 3: Update help-mapping.ts**

Change `"/dnssec": "getting-started"` to `"/dnssec": "dnssec"` and add `{ slug: "dnssec", title: "DNSSEC Management" }` to the `allDocs` array (after `wizards`, before `backup-and-import`).

- [ ] **Step 4: Build and verify**

```bash
cd dns-manager && npx next build 2>&1 | tail -5
```

- [ ] **Step 5: Commit**

```bash
git add docs/help/dnssec.md dns-manager/public/help/dnssec.md dns-manager/src/lib/help-mapping.ts
git commit -m "docs: add DNSSEC help documentation and fix help mapping"
```

---

## Task 2: Policy Copy — Support Zone Transfer and Recursion Policies

**Files:**
- Modify: `server/bridge.ps1` — `Handle-CopyPolicies` function (~line 308)

Currently only calls `Get-DnsServerQueryResolutionPolicy`. Add an optional `policyType` field in the request body. When `policyType` is `"ZoneTransfer"`, call `Get-DnsServerZoneTransferPolicy` and `Add-DnsServerZoneTransferPolicy` instead. Default remains query resolution for backward compatibility.

- [ ] **Step 1: Read the current Handle-CopyPolicies function**

- [ ] **Step 2: Add policyType discrimination**

At the top of the function, read `$Body.policyType` (default `'QueryResolution'`). Use it to select which Get/Add cmdlets to call:
- `'QueryResolution'` → `Get-DnsServerQueryResolutionPolicy` / `Add-DnsServerQueryResolutionPolicy` (existing)
- `'ZoneTransfer'` → `Get-DnsServerZoneTransferPolicy` / `Add-DnsServerZoneTransferPolicy`

- [ ] **Step 3: Add frontend API support**

Modify `api.copyPolicies()` in `dns-manager/src/lib/api.ts` to accept an optional `policyType` parameter and pass it in the request body.

- [ ] **Step 4: Commit**

```bash
git add server/bridge.ps1 dns-manager/src/lib/api.ts
git commit -m "feat: policy copy now supports zone transfer policies via policyType param"
```

---

## Task 3: CI/CD Pipeline — GitHub Actions Build Check

**Files:**
- Create: `.github/workflows/build.yml`

- [ ] **Step 1: Create workflow file**

Workflow triggers on push to main and PRs. Steps: checkout, setup Node 22, npm ci in dns-manager, run `npm run build`, run `npm run lint`.

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/build.yml
git commit -m "ci: add GitHub Actions workflow for TypeScript build and lint checks"
```

---

## Task 4: Clean Up TODO.md

**Files:**
- Modify: `TODO.md`

- [ ] **Step 1: Remove completed items**

Remove "Inline Editing for Server Configuration Panels" (done), "DNSSEC Help Documentation" (done in task 1), "Policy Copy" (done in task 2), "CI/CD Pipeline" (done in task 3).

- [ ] **Step 2: Commit**

```bash
git add TODO.md
git commit -m "chore: remove completed items from TODO"
```
