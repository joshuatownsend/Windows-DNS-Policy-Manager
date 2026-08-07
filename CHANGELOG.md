# Changelog

All notable changes to the DNS Policy Manager will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Removed

- **`shadcn` dropped from `dns-manager` dependencies** — it is a scaffolding CLI, but it was declared
  as a production dependency because `src/app/globals.css` imported `shadcn/tailwind.css`. That
  1.7 KB stylesheet is now vendored as `src/app/shadcn-tailwind.css`, removing **248 packages**
  (989 → 741 lockfile entries) along with the entire `@modelcontextprotocol/sdk` HTTP stack — `hono`,
  `express-rate-limit`, `ajv`, `ts-morph` — that the CLI dragged into the production graph. Use
  `npx shadcn@latest add <component>` to scaffold components; if a new component needs a custom
  variant not in the vendored file, refresh it from the matching shadcn release.

### Security

- **Clears all 8 open Dependabot alerts** (4 high, 4 moderate; they close once this lands on the
  default branch). No direct dependency was vulnerable; every alert was transitive, and
  all fixes were patch bumps already inside their parents' declared semver ranges, so no `overrides`
  entries were added.
  - Six of the eight (`fast-uri` GHSA-7p8r-x3mc-p8w7, `ip-address` GHSA-mwp4-54f8-5fhr /
    GHSA-4xrf-jv44-h6hh / GHSA-22jq-vg5j-6vgg, `hono` GHSA-8j4g-w8fx-2239, and the production copy of
    `brace-expansion` GHSA-rgw5-rvv9-x895) existed *only* via `shadcn` and were cleared by removing
    it. The vulnerable code paths lived in the MCP SDK's HTTP transport, which the Next.js app never
    executed — reachable risk was nil even before the fix.
  - **dns-manager**: `brace-expansion` → 5.0.9 and 1.1.18 (dev-only, via `@typescript-eslint` and
    `eslint`).
  - **mcp-server**: `fast-uri` → 3.1.5, `hono` → 4.13.1. Both arrive via `@modelcontextprotocol/sdk`,
    a genuine runtime dependency here; the `hono` CORS ReDoS was unreachable because the server uses
    the stdio transport. `npm audit` now reports 0 vulnerabilities.
  - **`mermaid` 11.15.0 → 11.16.1** — surfaced by `npm audit` ahead of the Dependabot dashboard.
    Four MODERATE advisories (prototype pollution via configuration APIs and in Architecture
    diagrams, CSS injection into siblings of the diagram, infinite-loop DoS in XY Charts and radar
    diagrams). This is the only *direct* dependency in the sweep that was vulnerable; it renders the
    Resolvers topology diagram. Verified by headless-rendering the exact graph shape
    `buildMermaidGraph()` emits — `graph TB`, two `direction LR` subgraphs, `:::` node classes,
    `classDef`, `style`, and `linkStyle` index lists — which produced a valid SVG (4 nodes, 3 edges,
    2 clusters) with no console errors.
  - Still open, not part of this change: `js-yaml` 4.3.0 (HIGH — quadratic CPU consumption in
    `!!omap` resolution). Dev-only, reached via `eslint` → `@eslint/eslintrc`, so it never enters the
    production tree; blocked until eslint widens its range.

## [0.6.0] - 2026-08-01

### Changed

- **Node.js 24 LTS ("Krypton") is now the single target across the repo** — CI (`build.yml`), the
  `dns-manager` Dockerfile (all three stages), a new root `.nvmrc`, and `engines.node: ">=24"` in
  both workspaces. `@types/node` moves to `^24` (24.13.3) in both, replacing `^20` in `dns-manager`
  and `^25.6.0` in `mcp-server`.
  - Both workspaces had been typed against **end-of-life** Node lines: 20 ("Iron") reached EOL
    2026-04-30 and 25 reached EOL 2026-06-01. Node 22 ("Jod"), which CI and Docker pinned, has been
    in maintenance since 2025-10-21. Node 24 is the only Active LTS (maintenance 2026-10-20,
    EOL 2028-04-30) and was already the local development version.
  - Nothing in the dependency graph forced a lower floor: `next` requires `>=20.9.0` and the MCP SDK
    `>=18`. Raising `engines` to `>=24` keeps the declared minimum consistent with the types and the
    runtime actually tested, rather than claiming support for a runtime lacking those APIs.
  - README requirements updated accordingly.
- **Dependabot no longer proposes Node-runtime-coupled bumps on its own** — `@types/node` major
  updates are now ignored in both npm ecosystems, because it tracks the Node line rather than a
  normal library and Dependabot was proposing EOL/pre-LTS targets (PR #55 proposed 20 → 25, a line
  that went EOL 2026-06-01). The `mcp-server-deps` group is now restricted to `minor`/`patch`,
  matching `dns-manager`'s `types-and-tooling` group — grouping majors is how `typescript` 6 → 7
  arrived bundled with routine updates in #66/#79. Ungrouped majors still get their own PR.

### Security

- **Dependency security sweep** — consolidated 9 open Dependabot PRs into one change and closed the gaps none of them covered. Dependabot alerts 37 → 1; `npm audit` production tree 0 in both workspaces (`dns-manager/` 12 high → 9 high, all dev-only; `mcp-server/` 0).
  - **dns-manager**: `next` 16.2.9 → 16.2.12 (4× HIGH, 4× MODERATE), `js-yaml` → 4.3.0 (HIGH + MODERATE), `dompurify` → 3.4.12 (8 alerts), `hono` → 4.12.32 (3× MODERATE), `fast-uri` → 3.1.4 (2× HIGH), `body-parser` → 2.3.0, `brace-expansion` → 1.1.17/5.0.8 (2× HIGH), `@babel/core` → 7.29.7.
  - **mcp-server**: lockfile-only patches to `fast-uri` 3.1.4 (2× HIGH), `hono` 4.12.32 (3× MODERATE), `body-parser` 2.3.0, `@hono/node-server` 2.0.12 (MODERATE), `zod` 4.4.3.
  - **`postcss` override was silently stale** — the pinned floor `>=8.5.10` resolved to 8.5.12, but GHSA-r28c-9q8g-f849 (HIGH — path traversal in `sourceMappingURL` auto-loading, arbitrary `.map` file disclosure) is vulnerable through 8.5.17. Raised to `>=8.5.18` (resolves 8.5.25). No Dependabot alert or PR covered this.
  - **`sharp` → `>=0.35.0` override** (HIGH — inherited libvips CVE-2026-33327/33328/35590/35591). Reachable only as an *optional* dependency of `next`, which still declares `^0.34.5`; the app imports `next/image` nowhere and configures no `images` optimizer, so the code path is unused. Overridden to clear the alert; revisit when Next widens its range.
  - **`@hono/node-server` fixed via its parent, not an override** — `@modelcontextprotocol/sdk` 1.27.1 (range `^1.19.9`) held it at 1.19.x. Bumping the SDK to 1.30.0, which declares `^1.19.9 || ^2.0.5`, brings 2.0.12 inside a supported range.
  - Still open, both upstream-blocked and neither in the production tree:
    - `eslint` 9 → 10 (9 dev-only HIGH: the `eslint`/`eslint-config-next` plugin chain, all rooted in `brace-expansion@1.1.17` / GHSA-mh99-v99m-4gvg, which has no v1-line fix). `eslint-config-next` 16.2.x crashes under ESLint 10 inside its bundled `eslint-plugin-react`, so the bump cannot land until upstream adds ESLint 10 support.
    - `dompurify` GHSA-x4vx-rjvf-j5p4 (LOW) — no patched version has been published.

### Added

- **DNS over HTTPS (DoH) tab** — dedicated tab to view, enable/disable, and configure inbound DoH (up to 3 pipe-separated URI templates) on Windows Server 2025+. Includes an offline generator that produces the full setup script: certificate import, `netsh http add sslcert` binding, inbound firewall rule, `Set-DnsServerEncryptionProtocol -EnableDoh`, and the required DNS service restart.

### Fixed

- **DoH configuration silently did nothing on Server 2025** — the encryption-protocol setter sent invented parameters (`DohEnabled`/`DotEnabled`/`CertificateSubjectName`) that do not exist on `Set-DnsServerEncryptionProtocol`. The GA cmdlet only accepts `-EnableDoh` and `-UriTemplate`, so edits were a no-op (and would have thrown if the bogus params reached the cmdlet). The bridge now uses the correct contract, validates HTTPS templates (max 3), version-gates the setter, and reports `restartRequired`.

### Removed

- **DNS over TLS (DoT) controls** — `Set-DnsServerEncryptionProtocol` has no DoT capability. The non-functional DoT toggle and the generic "Encryption (DoH/DoT)" panel on the Server tab were removed in favor of the new DNS over HTTPS tab.

## [0.5.1] - 2026-06-15

### Security

- **Dependency CVE sweep** — cleared the entire open vulnerability backlog: GitHub Dependabot alerts 49 → 0, and `npm audit` from 14 → 0 (`dns-manager/`) and 5 → 0 (`mcp-server/`).
  - **dns-manager**: `vitest` 2 → 3 (CRITICAL; also pulls `vite` 7, clearing the `vite` advisory), `next` 16.2.4 → 16.2.6 (HIGH), `mermaid` 11.13 → 11.15, an `esbuild >=0.28.1` override (2× HIGH — RCE via `NPM_CONFIG_REGISTRY`, dev-server file read), plus semver-compatible transitive patches to `fast-uri`, `hono`, `ip-address`, `qs`, `brace-expansion`, and `uuid` (#50).
  - **mcp-server**: transitive patches (lockfile-only) to `fast-uri` (HIGH), `hono`, `ip-address`, and `qs` (#51).
  - Deferred (non-security, tracked by Dependabot): `eslint` 9 → 10, `@types/node` 20 → 25.

## [0.5.0] - 2026-03-25

### Added

- **DNS Lookup utility** — slide-over panel accessible from the header (terminal icon) on any tab. Supports nslookup and dig output styles with tool-specific options:
  - **nslookup**: Recursion, Use TCP, Debug (verbose output)
  - **dig**: +recurse, +tcp, +dnssec, +trace, +short, +all, +multiline, +comments, +question, +answer, +authority, +additional, +stats
  - Query any registered server or enter a custom nameserver IP
  - Console-style output area with session history, copy, and clear
  - Powered by `Resolve-DnsName` via the bridge (`/api/utilities/dns-lookup`)

### Fixed

- **Server switcher crash** — wrap `DropdownMenuLabel` in `DropdownMenuGroup` to satisfy Base UI's `MenuGroupRootContext` requirement
- **Launcher** — `Start-DNSPolicyManager.ps1` now auto-installs frontend dependencies (`npm install`) on first run instead of printing a warning and skipping the frontend

## [0.4.1] - 2026-03-24

### Added

- **Accessibility** — `prefers-reduced-motion` media query disables all animations for users who opt out
- **ARIA coverage** — added `role="status"` and `aria-live="polite"` to bridge status, `aria-label` to execution toggle, help button, and server switcher
- **Design context** — `.impeccable.md` and `.github/copilot-instructions.md` codify the design system for AI assistants
- **Empty states** — improved empty states on Server (no servers, not connected), Zones (no zones, not connected), and Policies (bridge offline, no policies) pages with contextual guidance, clearer copy, and next-step suggestions

### Changed

- **Tab navigation** — redesigned from underline-indicator with numeric prefixes to pill-style active tabs with descriptive labels (e.g., "DNS Objects", "Create Policy", "Backup & Import")
- **Bridge status indicator** — replaced animated beacon/flatline pulse with static colored dot for clarity
- **Header** — simplified by removing scanline overlay, dot-grid background, noise texture, and glowing divider
- **Card component** — added `accent` prop for left-edge cyan accent bar on section-level cards
- **Server switcher** — refactored from hand-rolled dropdown to shadcn DropdownMenu for proper keyboard navigation and ARIA support
- **Design tokens** — eliminated all 225 hard-coded `zinc-*` Tailwind classes across 8 files, replacing with semantic design tokens (`bg-card`, `bg-secondary`, `border-border`, `text-muted-foreground`, etc.). Also replaced hard-coded hex/rgba values in Toaster, help panel, and app shell
- **Execution toggle** — switching to Live mode now requires explicit confirmation dialog naming the target server and warning that DNS changes take effect immediately

### Removed

- Scanline overlay, noise texture (z-index 9999), dot-grid background, beacon/flatline animations, stagger animations, glow effects, tab-indicator pseudo-elements, and numeric tab prefixes

## [0.4.0] - 2026-03-24

### Added

- **MCP Server** (`mcp-server/`) — Model Context Protocol server for AI agent integration:
  - 31 read-only tools exposing DNS zones, records, policies, server config, DNSSEC, RRL, scavenging, and more
  - Offline `dns_generate_policy_commands` tool produces PowerShell scripts for 8 policy scenarios without the bridge
  - stdio transport for Claude Code, Cursor, VS Code, and other MCP-compatible AI tools
  - Connects to the PowerShell bridge REST API — no bridge changes required
  - Supports `currentUser` (Kerberos) and `savedCredential` (DPAPI) authentication modes
  - Configurable via env vars: `BRIDGE_URL`, `DNS_DEFAULT_SERVER`, `DNS_SERVER_ID`, `DNS_CREDENTIAL_MODE`

## [0.3.0] - 2026-03-24

### Added

- **Blocklists tab** (position 06) — First-class RPZ/blocklist management:
  - **Quick Block** — single-domain block with DENY/IGNORE action in one click
  - **Bulk Import** — drag-and-drop .txt file import for mass domain blocking with progress bar
  - **Active Block Policies** — searchable table of all DENY/IGNORE policies with one-click delete
  - **Global Query Block List** — view/add/remove entries from the server's built-in global block list (`Get-DnsServerGlobalQueryBlockList`)
  - Moved from Backup tab to dedicated tab as a primary workflow
- **Export Server Configuration** — full `Get-DnsServer` export as JSON on the Backup tab
- **Export DNS Zones** — single zone or bulk export of all primary zones via `Export-DnsServerZone`
- **AD-integrated backup note** — info banner explaining Microsoft's preferred system state backup method
- **Zone filters** — filter by Forward/Reverse, zone type (Primary/Secondary/Stub/Forwarder), and AD-integrated status on the Zones tab
- **Resolvers & Topology tab** — New tab displaying DNS resolver configuration per server. Shows IP stack DNS servers (per network adapter, IPv4/IPv6) and DNS Server forwarder configuration side by side. Highlights discrepancies between the two. Includes a Mermaid-rendered topology diagram with color-coded edges: cyan for IP stack connections, amber for forwarders, dashed for agreement. Well-known resolvers (Google, Cloudflare, Quad9, etc.) are auto-labeled.
- **Policy processing order editor** — Reorder dialog on the Policies tab with up/down arrows to rearrange policy evaluation order. Shows before/after order numbers, saves only changed policies. Uses extended `PUT /api/policies/{name}/state` endpoint that now accepts `processingOrder`.
- **DNS Best Practices Analyzer** — Run the Windows BPA model for the DNS Server role from the Server tab. Results categorized by severity (Error/Warning/Information) with expandable findings showing problem, impact, and resolution. Handles BPA unavailability gracefully.
- **DNS over HTTPS/TLS (DoH/DoT) panel** — View and configure encryption protocol settings on Windows Server 2025+. Graceful fallback on older server versions with "not available" message.
- **Record pagination** — Zones with more than 50 records now paginate with Previous/Next controls. Page resets on filter or zone change.
- **Bulk record export** — Export current zone records (or filtered subset) as CSV with one click.
- **Bulk record import** — Import records from CSV files with drag-and-drop, preview table with validation, per-record progress bar, and error reporting. Supports A, AAAA, CNAME, MX, NS, PTR, SRV, TXT records.
- **E2E tests with Playwright** — 20 tests across all 9 tabs using a mock HTTP bridge on port 8650. Tests run against the production build (no dev server needed). Covers navigation, help panel, bridge status, server CRUD, zone browsing/records/creation, policy list/create/generate, wizard scenarios, backup/powershell empty states, and DNSSEC status. CI workflow updated to run tests automatically.
- **Typed wizard execution** — "Execute on Server" now uses structured API calls instead of raw PowerShell command strings. Each wizard step calls the appropriate typed endpoint (createSubnet, createZoneScope, addPolicy, etc.) with per-step progress display, structured error messages, and proper credential handling. "Generate Commands" still produces PowerShell strings for manual use.
- **Server Configuration Dashboard** — New collapsible panels on the Server tab for viewing and managing server-wide DNS settings:
  - **General Settings**: Round Robin, Bind Secondaries, Strict File Parsing, Local Net Priority
  - **Forwarders**: Add/remove upstream DNS forwarders with inline IP entry
  - **Recursion**: View recursion enable state, timeout, retries, secure response
  - **Cache**: View cache config, Clear Cache action
  - **Global Query Block List**: Add/remove blocked domains (wpad, isatap, etc.)
  - **Diagnostics**: View debug logging toggle states
  - **Statistics**: View raw server counters, Clear Statistics action
  - 15 new DnsServer cmdlets wrapped (Get/Set-DnsServerSetting, Get/Set/Add/Remove-DnsServerForwarder, Get-DnsServerCache, Clear-DnsServerCache, Get/Set-DnsServerRecursion, Get/Set-DnsServerGlobalQueryBlockList, Get/Set-DnsServerDiagnostics, Get/Clear-DnsServerStatistics)
  - 16 new bridge endpoints under `/api/server/*`
- **Zone Lifecycle Management** — Create, delete, convert, suspend, resume, export zones, and manage zone aging:
  - **Create Zone** dialog with type selector (Primary, Secondary, Stub, Conditional Forwarder), AD replication scope, dynamic update options
  - **Zone Actions** dropdown per zone: Suspend, Resume, Force Transfer (secondary), Export, Delete (with typed confirmation)
  - **Zone Aging** settings via bridge endpoint
  - Supports Primary (file-backed or AD-integrated), Secondary, Stub, and Conditional Forwarder zones
  - 16 new DnsServer cmdlets wrapped (Add-DnsServerPrimaryZone, Add-DnsServerSecondaryZone, Add-DnsServerStubZone, Add/Set-DnsServerConditionalForwarderZone, Remove-DnsServerZone, ConvertTo-DnsServerPrimaryZone, ConvertTo-DnsServerSecondaryZone, Set-DnsServerSecondaryZone, Set-DnsServerStubZone, Export-DnsServerZone, Resume/Suspend-DnsServerZone, Start-DnsServerZoneTransfer, Get/Set-DnsServerZoneAging)
  - 9 new bridge endpoints for zone lifecycle operations
- **Response Rate Limiting (RRL)** — View and configure RRL settings (mode, rates, window, prefix lengths), manage RRL exception lists with add/remove
- **Scavenging** — View scavenging settings (state, intervals, last scavenge time), trigger immediate scavenging with "Scavenge Now" button
- **Server Test** — Run `Test-DnsServer` diagnostic from the UI with JSON result display
  - 9 new DnsServer cmdlets wrapped (Get/Set-DnsServerResponseRateLimiting, Add/Remove/Get-DnsServerResponseRateLimitingExceptionlist, Get/Set-DnsServerScavenging, Start-DnsServerScavenging, Test-DnsServer)
  - 9 new bridge endpoints for RRL, scavenging, and server test
- **DNSSEC Management tab** — New dedicated tab (position 07) for managing DNS Security Extensions:
  - Zone signing status table showing all zones with signed/unsigned badges
  - Zone DNSSEC detail panel with settings display, sign/unsign actions, and public key export
  - Signing key management: view KSK/ZSK keys, add new keys (RSA/ECDSA algorithms), remove keys
  - Trust anchors: view, add, remove trust anchors
  - Trust points: view status with update action
  - Unsign zone requires typed confirmation
  - 15 new DnsServer cmdlets wrapped (Get/Set-DnsServerDnsSecZoneSetting, Add/Get/Remove-DnsServerSigningKey, Invoke-DnsServerZoneSign, Invoke-DnsServerZoneUnsign, Export-DnsServerDnsSecPublicKey, Get/Add/Remove-DnsServerTrustAnchor, Get/Update-DnsServerTrustPoint, Enable/Disable-DnsServerSigningKeyRollover)
  - 13 new bridge endpoints under /api/dnssec/*, /api/trustanchors/*, /api/trustpoints/*
- **Root Hints panel** — View configured root hint servers
- **EDNS panel** — View EDNS reception, probes, and cache timeout settings
- **Active Directory Settings panel** — View AD DS replication settings
- **Global Name Zone panel** — View and toggle GlobalNames zone
- **Zone Delegations endpoint** — `GET /api/zones/{name}/delegations`
- **Execute endpoint expansion** — Allowlist now covers all DnsServer module verbs (ConvertTo, Export, Import, Invoke, Start, Restore, Resume, Suspend, Sync, Step, Reset, Register, Unregister, Update, Enable, Disable, Clear, Show)
  - 12 new DnsServer cmdlets wrapped (Get-DnsServerRootHint, Get/Set-DnsServerEDns, Get-DnsServerDsSetting, Get/Set-DnsServerGlobalNameZone, Get-DnsServerZoneDelegation, plus all verb prefixes for execute endpoint)

### Fixed

- **Saved/session credentials with remote DNS servers** — DNS Server cmdlets don't accept `-Credential` directly. Bridge now creates a `CimSession` with DCOM protocol for alternate credentials, which all DNS Server cmdlets accept. Previously, any operation using saved or session credentials on a remote server would fail with "A parameter cannot be found that matches parameter name 'Credential'."
- **PowerShell 5.1 compatibility** — Replaced `??` null-coalescing operators (PowerShell 7+) with `if/else` expressions throughout bridge.ps1.
- **BPA no longer blocks the bridge** — BPA now runs as a background job (`Start-Job`) with frontend polling every 3s. Previously, the single-threaded bridge became unresponsive for the entire duration of a BPA scan (1-3 minutes).
- **Bridge resilience** — Main listener loop now catches errors that escape individual handlers, preventing bridge crashes.
- **Long-running API calls bypass Next.js proxy** — Resolvers and BPA endpoints call the bridge directly to avoid the ~15s dev-mode proxy timeout.

### Changed

- **Server Configuration panels now support inline editing** — boolean settings toggle immediately via Switch, numeric and string values edit in-place and save on Enter or blur. Covers General Settings, Recursion, Diagnostics, RRL, Scavenging, Forwarders (UseRootHint), Block List (Enable), EDNS, and Global Name Zone. Cache, Statistics, Root Hints, and AD Settings remain read-only (no setter API).

## [0.2.0] - 2026-03-18

### Added

- **Zones tab** — New dedicated tab with two-panel layout: zone list sidebar + zone detail panel. Browse all zones, view zone settings, and manage DNS resource records.
- **Zone record management (CRUD)** — Full create, read, update, delete for A, AAAA, CNAME, MX, SRV, TXT, NS, and PTR records. SOA records are read-only. Type-sensitive modal form with validation.
- **Zone settings editor** — View and edit Dynamic Update and Replication Scope settings for primary/AD-integrated zones.
- **Zone record filtering** — Filter records by type (dropdown) and search by hostname/data (text input) with live filtering.
- **Clickable zone cards** — Zone cards in the Server tab now navigate to the Zones tab and select that zone.
- **Bridge endpoints for zone management** — 6 new handlers: `GET /api/zones/{name}` (details), `GET /api/zones/{name}/records` (list records), `POST /api/zones/{name}/records` (add), `PUT /api/zones/{name}/records` (update via remove+add with rollback), `DELETE /api/zones/{name}/records` (remove), `PUT /api/zones/{name}/settings` (edit zone settings).
- **DELETE request body support** — API client now sends request body for DELETE methods (needed for record deletion).
- **ServerInterfaceIP criteria type** — New criteria type for query resolution and recursion policies, separate from ServerInterface (zone transfer). Used in MS Scenarios 5, 6, and 7.
- **Record TTL support** — Zone scope records can now be created with a custom TTL (Time-To-Live) in seconds. The bridge passes `-TimeToLive` to `Add-DnsServerResourceRecord`. Recommended for cloud offload (Scenario 4) and load balancing (Scenario 8).
- **Default zone scope fallback records** — Geo-location wizard now includes a "Default / Fallback IP" field that generates `Add-DnsServerResourceRecord` commands for the default zone scope, ensuring clients from unmatched regions still receive a response (MS Scenario 1).
- **Policy copy between servers** — New "Copy to Server" button in Policies tab. Copies all query resolution policies from the active server to selected target server(s) via new `POST /api/policies/copy` bridge endpoint. Essential for AD environments where zone scopes replicate but policies do not (MS Scenario 6).
- **Geo-Location + Load Balancing wizard** (MS Scenario 9) — New wizard combining geographic routing with weighted load balancing. Supports per-region weighted datacenter distribution and a worldwide catch-all policy.
- **Primary-Secondary Geo-Location wizard** (MS Scenario 2) — New wizard that configures geo-location on primary server, then generates secondary zone creation, zone transfer config, and subnet/scope/policy copy commands for secondary servers.
- **Query Filter wizard** (MS Scenario 7) — New wizard replacing the basic blocklist wizard. Supports both blocklist (EQ + DENY/IGNORE) and allowlist (NE + IGNORE) patterns, with FQDN, client subnet, query type, and server interface IP criteria, including combinations with AND/OR conditions.
- **Split-Brain wizard: Server Interface method** (MS Scenarios 5b/6) — Split-brain wizard now offers a choice between "By Client Subnet" and "By Server Interface" methods. The interface method uses `-ServerInterfaceIP` criteria instead of `-ClientSubnet`.
- **Split-Brain wizard: Active Directory option** (MS Scenario 6) — Optional AD checkbox adds `Add-DnsServerPrimaryZone -ReplicationScope "Domain"` and policy copy guidance for AD-integrated zones.

### Changed

- **BREAKING: Migrated frontend to Next.js + TypeScript + shadcn/ui** — Complete rewrite of the vanilla JS/HTML/CSS frontend (7.3K lines JS, 2.4K CSS, 825 HTML) to a modern React-based architecture. The PowerShell bridge (`server/bridge.ps1`) is unchanged — it remains the REST API contract boundary.
  - All 19 JS files replaced with ~25 TypeScript/React components + hooks + typed API client
  - All 6 CSS files replaced with Tailwind CSS utilities + shadcn/ui component library (dark theme with cyan accent preserved)
  - Global `window.DNSPolicyManager` namespace + IIFE pattern replaced with ES modules + Zustand store
  - 90-case event delegation switch in `app.js` replaced with per-component React event handlers
  - `wizards.js` (2,331 lines) decomposed into scenario definitions, command generator, and React components
  - 379 `createElement` calls replaced with declarative JSX
  - Full TypeScript type coverage across all 80+ functions and state properties
  - File-based routing via Next.js App Router (8 tab routes)
  - API client proxied through Next.js rewrites (no more direct localhost calls from browser)
  - Server registry persisted via Zustand `persist` middleware (replaces manual localStorage)
  - `file://` mode no longer supported — bridge serves frontend via Next.js dev server
  - Launcher script updated to start both bridge and Next.js dev server
- **Time-of-Day wizard overhaul** (MS Scenarios 3 & 4) — Completely redesigned to match Microsoft documentation. Now supports: datacenter definitions with IPs and optional client subnets, peak hours with weighted multi-scope distribution (e.g., 80/20 split), layered policies at different processing orders (peak → normal → worldwide catch-all), optional record TTL for cloud scenarios.
- **Load Balancing wizard improvements** (MS Scenario 8) — Now supports zone apex (@), includes optional record TTL field with recommendation note, and uses TimeToLive parameter in generated commands.
- **Blocklist wizard replaced** by the more comprehensive Query Filter wizard (Scenario 7 superset). The original blocklist scenario remains as a subset of the new filter wizard's blocklist mode.
