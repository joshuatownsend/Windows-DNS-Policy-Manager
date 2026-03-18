# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A browser-based GUI for managing Windows DNS Server policies. The frontend is a Next.js + TypeScript + shadcn/ui app (`dns-manager/`). The backend is a PowerShell HTTP bridge (`server/bridge.ps1`) that wraps DNS Server cmdlets as REST endpoints, bound to `127.0.0.1:8650`.

**Port note**: Default bridge port is 8650. Default frontend dev port is 10010. Windows Hyper-V/Docker dynamically reserves port ranges via `netsh int ipv4 show excludedportrange` that often include 8545-8644. If the bridge fails to bind, check excluded ranges and use `-Port` to specify an open one.

## Running the Application

```powershell
# Launch bridge + frontend + open browser (recommended)
powershell -ExecutionPolicy Bypass -File Start-DNSPolicyManager.ps1

# Or manually:
# Terminal 1: bridge
powershell -ExecutionPolicy Bypass -File server/bridge.ps1
# Terminal 2: frontend
cd dns-manager && npm run dev
```

The app works in two modes: **offline** (frontend only — generates PowerShell commands) or **live** (bridge running — can execute commands on DNS servers).

## Architecture

### Frontend (`dns-manager/`)

Next.js App Router with TypeScript, Tailwind CSS v4, and shadcn/ui components.

- **Routing**: File-based via `src/app/{tab}/page.tsx`. 8 tab routes: server, objects, zones, policies, create, wizards, backup, powershell.
- **State**: Zustand store (`src/lib/store.ts`) with `persist` middleware for server registry in localStorage. All state is typed.
- **API client**: `src/lib/api.ts` — single typed fetch wrapper with shared query-string builder. All 39 methods. Proxied through Next.js rewrites (`/api/*` → bridge at `:8650`).
- **Types**: `src/lib/types.ts` — shared interfaces for Server, Zone, DnsRecord, Policy, WizardState, etc.
- **Wizards**: `src/wizards/scenarios.ts` (definitions) + `src/wizards/command-generator.ts` (PowerShell generation) + `src/app/wizards/page.tsx` (React UI). 8 scenarios covering all 10 Microsoft DNS Policy use cases.
- **Components**: shadcn/ui primitives in `src/components/ui/`. App shell components (header, tabs, bridge status) in `src/components/`.
- **Design**: "Operations Console" aesthetic — Oxanium display font, Manrope body, navy-charcoal palette, engineering dot grid background, beacon status indicators.

### PowerShell Bridge (`server/bridge.ps1`)

`System.Net.HttpListener` with regex-based routing in `Route-Request`. Each endpoint gets a dedicated `Handle-*` function. New routes go in the `switch -Regex` block — **order matters** because more specific patterns (e.g., `/api/policies/{name}/state`) must appear before catch-all patterns (e.g., `/api/policies/(.+)`).

All DNS cmdlet calls use **splatted parameters** (`@splatParams`) to prevent command injection. Credentials are resolved through `Resolve-ServerCredential` which supports three modes: `currentUser` (Kerberos/NTLM), `savedCredential` (DPAPI-encrypted files), and `session` (in-memory).

## Key Conventions

- **React components**: Each page is a `"use client"` component. Use shadcn/ui primitives. Use `import { toast } from "sonner"` for notifications.
- **Store access**: `import { useStore } from "@/lib/store"` with selectors. For non-React contexts: `useStore.getState()`.
- **API calls**: `import { api } from "@/lib/api"`. All methods return `Promise<ApiResponse>` with `{ success, error?, bridgeDown?, ...data }`.
- **Server params helper**: Most API calls need `server`, `serverId`, `credentialMode` from the active server. Use `useStore.getState().getActiveServer()`.
- **Bridge handlers**: Follow the pattern of resolving credentials via `Resolve-ServerCredential`, building `$splatParams`, calling the DNS cmdlet, and returning JSON via `Send-Response`.
- **CORS**: Bridge allows `GET, POST, PUT, DELETE, OPTIONS` — safe because it only binds to localhost.

## Tabs and Features

The UI has 8 tabs: Server, DNS Objects, Zones, Policies, Create Policy, Wizards, Backup & Import, PowerShell. The root `/` redirects to `/server`.

## TODO
- If I give you a TODO, save it to TODO.md in our repo.
- Consider our TODO list when planning new features. If something on the list can be accomplished during a plan or implement run, suggest it.
- Add TODO items if they make sense to do in the future, even if not part of the current plan you are creating.

## Changelog Discipline

Update `CHANGELOG.md` for any change that affects:

- UI behavior
- Application process or logic
- Validation outcomes
- API behavior or schema
- Authentication/session behavior

Use Keep a Changelog categories under `[Unreleased]`.

Pure refactors and test-only changes do not require entries.

## Manual Steps Logging

---

### Manual Step Logging

Whenever you identify a step that I (the developer) must perform manually outside
of code — including but not limited to:

- Database migrations (Drizzle push, Prisma migrate deploy, etc.)
- External service setup (Clerk, Vercel, Stripe, Supabase, Resend, etc.)
- Environment variable configuration
- DNS or domain changes
- CLI commands that must be run in a specific environment
- Dashboard or UI actions in third-party services
- API key generation or rotation
- Deployment triggers or feature flag toggles

…you MUST append an entry to `MANUAL_STEPS.md` in the project root.

#### Format

Use this exact structure (append, never overwrite):

```
## YYYY-MM-DD HH:MM | <project-or-feature-slug> | <plain-English context title>

- [ ] First step description
  Details, commands, or URLs on indented lines beneath the step
- [ ] Second step description
  `example command --flag`
  See: https://docs.example.com/relevant-page

---
```

#### Rules

1. **Append only** — never modify or delete existing entries in MANUAL_STEPS.md.
2. **One entry per session or feature** — group related steps under a single header.
3. **Be specific** — include exact commands, environment names, and documentation links.
4. **Indented detail lines** start with two or more spaces beneath the step they belong to.
5. **Create the file** if it does not already exist.
6. After appending, **tell me** that you've logged steps to MANUAL_STEPS.md and
   summarize what was added in one or two sentences.

#### Example entry

```
## 2026-03-17 14:32 | auth | Clerk + Vercel Authentication Setup

- [ ] Install Clerk package
  `npm install @clerk/nextjs`
- [ ] Add environment variables to Vercel dashboard
  CLERK_SECRET_KEY and NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
  See: https://clerk.com/docs/deployments/deploy-to-vercel
- [ ] Wrap root layout with <ClerkProvider> in app/layout.tsx
- [ ] Add middleware.ts to protect routes
  See: https://clerk.com/docs/references/nextjs/auth-middleware

---
```
