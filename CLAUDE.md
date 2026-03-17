# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A zero-dependency browser-based GUI for managing Windows DNS Server policies. The frontend is vanilla JS/CSS/HTML opened directly in a browser (works on `file://`). The backend is a PowerShell HTTP bridge (`server/bridge.ps1`) that wraps DNS Server cmdlets as REST endpoints, bound to `127.0.0.1:8650`.

**Port note**: Default port is 8650 (not 8600). Windows Hyper-V/Docker dynamically reserves port ranges via `netsh int ipv4 show excludedportrange` that often include 8545-8644. If the bridge fails to bind, check excluded ranges and use `-Port` to specify an open one.

## Running the Application

```powershell
# Launch bridge + open browser (recommended)
powershell -ExecutionPolicy Bypass -File Start-DNSPolicyManager.ps1

# Or just the bridge
powershell -ExecutionPolicy Bypass -File server/bridge.ps1

# Or via batch file
server\start.bat
```

The app works in two modes: **offline** (open `index.html` directly — generates PowerShell commands only) or **live** (bridge running — can execute commands on DNS servers).

There is no build step, no package manager, no linter, and no test suite.

## Architecture

### Module System

All JavaScript uses IIFEs that extend a single global namespace: `window.DNSPolicyManager` (aliased as `NS` inside each module). There are no ES modules, no imports/exports — this is intentional so the app works on `file://` without a bundler.

**Load order matters** and is defined by `<script>` tags in `index.html`:
`state.js` → utils → UI helpers → `api.js` → feature modules → `app.js`

### Event Delegation

There is a single `document.addEventListener('click', ...)` and a single `document.addEventListener('change', ...)` in `app.js`. All interactive elements use `data-action="actionName"` attributes. The handler walks up one parent level to find the action, then routes via a `switch` statement. New features must add their action cases to `app.js`.

### State

`js/state.js` holds a single mutable object (`NS.state`). No reactive framework — features mutate state directly and call render functions. Server registry is persisted to `localStorage`.

### PowerShell Bridge

`server/bridge.ps1` is a `System.Net.HttpListener` with regex-based routing in `Route-Request`. Each endpoint gets a dedicated `Handle-*` function. New routes go in the `switch -Regex` block — **order matters** because more specific patterns (e.g., `/api/policies/{name}/state`) must appear before catch-all patterns (e.g., `/api/policies/(.+)`).

All DNS cmdlet calls use **splatted parameters** (`@splatParams`) to prevent command injection. Credentials are resolved through `Resolve-ServerCredential` which supports three modes: `currentUser` (Kerberos/NTLM), `savedCredential` (DPAPI-encrypted files), and `session` (in-memory).

### CSS

Modular CSS with design tokens in `css/variables.css`. Dark theme with cyan accent. Component styles use BEM-like naming. No preprocessor.

## Key Conventions

- **Safe DOM rendering**: Always use `document.createElement` + `textContent` for user-provided data. Never use `innerHTML` with dynamic content.
- **Feature modules**: Each file in `js/features/` is an IIFE that adds functions to `NS`. Pattern: `NS.loadX()` → API call → update `state.X` → `NS.renderX()`.
- **API methods**: All in `js/services/api.js` as `api.methodName()`. They return Promises with `{ success, ... }` or `{ success: false, error, bridgeDown }`.
- **Bridge handlers**: Follow the pattern of resolving credentials via `Resolve-ServerCredential`, building `$splatParams`, calling the DNS cmdlet, and returning JSON via `Send-Response`.
- **CORS**: Bridge allows `GET, POST, PUT, DELETE, OPTIONS` — safe because it only binds to localhost.

## Tabs and Features

The UI has 7 tabs: Server, DNS Objects, Policies, Create Policy, Wizards, Backup & Import, PowerShell Commands. The DNS Objects tab loads data on tab switch (see `js/ui/tabs.js` `showTab`). The Wizards tab re-renders its grid each time it's activated.

The Create Policy form has a Policy Type selector (Query Resolution / Recursion / Zone Transfer) that toggles which form sections are visible via `togglePolicyType()` in `js/ui/form.js`.

## TODO
- If I give you a TODO, save it to TODO.md in our repo.
- Consider our TODO list when planning new features. If something on the list can be accomplished during a plan or implement run, suggest it.
- Add TODO items if they make sense to do in the future, even if not part of the current plan you are creating.

## Documentation Policy

After completing any feature or fix, before considering the task done:
1. Identify which files changed.
2. Determine if any user-facing behavior changed or was added.
3. If yes, update the relevant section(s) in `/docs/help/`.
4. If a new UI route was added, update `lib/help-mapping.ts` (route → slug mapping).
5. Copy updated help markdown to `public/help/` (runtime-fetchable copies of `docs/help/`).
6. Commit doc changes with the feature.

## Changelog Discipline

Update `CHANGELOG.md` for any change that affects:

- UI behavior
- Application process or logic
- Validation outcomes
- API behavior or schema
- MCP behavior or schema
- Authentication/session behavior
- Subscription plans, entitlements, quotas
- Data migrations affecting interpretation

Use Keep a Changelog categories under `[Unreleased]`.

Pure refactors and test-only changes do not require entries.