# Changelog

All notable changes to the DNS Policy Manager will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added

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
- **Zone Delegations endpoint** — GET /api/zones/{name}/delegations
- **Execute endpoint expansion** — Allowlist now covers all DnsServer module verbs (ConvertTo, Export, Import, Invoke, Start, Restore, Resume, Suspend, Sync, Step, Reset, Register, Unregister, Update, Enable, Disable, Clear, Show)
- 12 new DnsServer cmdlets wrapped (Get-DnsServerRootHint, Get/Set-DnsServerEDns, Get-DnsServerDsSetting, Get/Set-DnsServerGlobalNameZone, Get-DnsServerZoneDelegation, plus all verb prefixes for execute endpoint)

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

### Added (prior)



- **Zones tab** — New dedicated tab (8th, between DNS Objects and Policies) with two-panel layout: zone list sidebar + zone detail panel. Browse all zones, view zone settings, and manage DNS resource records.
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

- **Time-of-Day wizard overhaul** (MS Scenarios 3 & 4) — Completely redesigned to match Microsoft documentation. Now supports: datacenter definitions with IPs and optional client subnets, peak hours with weighted multi-scope distribution (e.g., 80/20 split), layered policies at different processing orders (peak → normal → worldwide catch-all), optional record TTL for cloud scenarios.
- **Load Balancing wizard improvements** (MS Scenario 8) — Now supports zone apex (@), includes optional record TTL field with recommendation note, and uses TimeToLive parameter in generated commands.
- **Blocklist wizard replaced** by the more comprehensive Query Filter wizard (Scenario 7 superset). The original blocklist scenario remains as a subset of the new filter wizard's blocklist mode.
