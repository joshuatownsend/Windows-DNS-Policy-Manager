# Plan: Expand DnsServer PowerShell Module Coverage

## Context

The DNS Policy Manager currently wraps 23 of ~120 DnsServer cmdlets. Coverage is strong for policies, DNS objects, and basic zone/record operations, but missing for server configuration, zone lifecycle, response rate limiting, scavenging, DNSSEC, and several niche areas. This plan adds the highest-value cmdlet groups in phases, extending existing UI where possible and adding one new tab (DNSSEC) only where the feature complexity warrants it.

**Current coverage**: 23 cmdlets (~19%). **Target after all phases**: ~98 cmdlets (~82%). The remaining ~22 are type-specific record cmdlets (already handled by the generic form) or deep AD/replication cmdlets best left to the execute endpoint.

---

## Phase 1: Server Configuration Dashboard

**Value**: Every DNS admin checks and tweaks server settings. Fills the Server tab with real configuration data beyond just connection cards.

### Cmdlets (15 new → 38 total, ~32%)

| Cmdlet | Purpose |
|--------|---------|
| `Get/Set-DnsServerSetting` | Server-wide settings (listen addresses, version, etc.) |
| `Get/Set/Add/Remove-DnsServerForwarder` | Upstream forwarder management |
| `Get-DnsServerCache`, `Clear-DnsServerCache` | Cache info and flush |
| `Get/Set-DnsServerRecursion` | Recursion toggle, timeout, retries |
| `Get/Set-DnsServerGlobalQueryBlockList` | WPAD/ISATAP block list |
| `Get/Set-DnsServerDiagnostics` | Debug logging toggles |
| `Get/Clear-DnsServerStatistics` | Server performance counters |

### Bridge Endpoints (15 new routes)

```
GET    /api/server/settings          → Get-DnsServerSetting
PUT    /api/server/settings          → Set-DnsServerSetting
GET    /api/server/forwarders        → Get-DnsServerForwarder
POST   /api/server/forwarders        → Add-DnsServerForwarder
DELETE /api/server/forwarders        → Remove-DnsServerForwarder
PUT    /api/server/forwarders        → Set-DnsServerForwarder
GET    /api/server/cache             → Get-DnsServerCache
DELETE /api/server/cache             → Clear-DnsServerCache
GET    /api/server/recursion         → Get-DnsServerRecursion
PUT    /api/server/recursion         → Set-DnsServerRecursion
GET    /api/server/blocklist         → Get-DnsServerGlobalQueryBlockList
PUT    /api/server/blocklist         → Set-DnsServerGlobalQueryBlockList
GET    /api/server/diagnostics       → Get-DnsServerDiagnostics
PUT    /api/server/diagnostics       → Set-DnsServerDiagnostics
GET    /api/server/statistics        → Get-DnsServerStatistics
DELETE /api/server/statistics        → Clear-DnsServerStatistics
```

### UI Changes

Extend `/server` page. Below the existing server cards and zone grid, add a collapsible **Server Configuration** section with sub-panels:

- **General Settings** — listen addresses, version, server name (read-only display + editable settings)
- **Forwarders** — table of forwarder IPs with Add/Remove buttons, timeout setting
- **Recursion** — enable/disable toggle, timeout, additional recursion parameters
- **Cache** — cache stats display, "Clear Cache" button (with confirmation)
- **Global Query Block List** — editable domain list (default: wpad, isatap)
- **Diagnostics** — toggles for debug logging categories
- **Statistics** — read-only counter display, "Clear Statistics" button

### Files to Modify

- `server/bridge.ps1` — add 16 `Handle-*` functions + routes in `Route-Request`
- `dns-manager/src/lib/api.ts` — add 16 API methods
- `dns-manager/src/lib/types.ts` — add `ServerSettings`, `ForwarderConfig`, `RecursionConfig`, `CacheInfo`, `BlockListConfig`, `DiagnosticsConfig`, `ServerStatistics` interfaces
- `dns-manager/src/lib/store.ts` — add `serverConfig` state slice
- `dns-manager/src/app/server/page.tsx` — add configuration panels (extract to `src/components/server/` sub-components to manage size)

---

## Phase 2: Zone Lifecycle Management

**Value**: The Zones tab can browse and edit records but cannot create, delete, convert, or export zones. This is a critical gap.

### Cmdlets (16 new → 54 total, ~45%)

| Cmdlet | Purpose |
|--------|---------|
| `Add-DnsServerPrimaryZone` | Create primary zone (file-backed or AD-integrated) |
| `Add-DnsServerSecondaryZone` | Create secondary zone |
| `Add-DnsServerStubZone` | Create stub zone |
| `Add/Set-DnsServerConditionalForwarderZone` | Conditional forwarder zones |
| `Remove-DnsServerZone` | Delete a zone |
| `ConvertTo-DnsServerPrimaryZone` | Convert secondary/stub → primary |
| `ConvertTo-DnsServerSecondaryZone` | Convert primary/stub → secondary |
| `Set-DnsServerSecondaryZone` | Edit secondary zone settings |
| `Set-DnsServerStubZone` | Edit stub zone settings |
| `Export-DnsServerZone` | Export zone to file |
| `Resume/Suspend-DnsServerZone` | Pause/unpause name resolution |
| `Start-DnsServerZoneTransfer` | Force zone transfer for secondary |
| `Get/Set-DnsServerZoneAging` | Zone-level aging/scavenging settings |

### Bridge Endpoints (9 new routes)

```
POST   /api/zones                    → Handle-CreateZone (discriminate on body.zoneType)
DELETE /api/zones/{name}             → Handle-RemoveZone
POST   /api/zones/{name}/convert     → Handle-ConvertZone
POST   /api/zones/{name}/transfer    → Handle-StartZoneTransfer
POST   /api/zones/{name}/suspend     → Handle-SuspendZone
POST   /api/zones/{name}/resume      → Handle-ResumeZone
POST   /api/zones/{name}/export      → Handle-ExportZone
GET    /api/zones/{name}/aging       → Handle-GetZoneAging
PUT    /api/zones/{name}/aging       → Handle-SetZoneAging
```

**Route ordering**: Zone sub-routes (`/aging`, `/convert`, `/transfer`, `/suspend`, `/resume`, `/export`) must appear BEFORE the existing `/api/zones/([^/]+)$` catch-all in the regex switch.

### UI Changes

Extend `/zones` page:

- **"Create Zone" button** in the zone list header → opens a Dialog with zone type selector:
  - Primary: ZoneName, ZoneFile/AD ReplicationScope, DynamicUpdate
  - Secondary: ZoneName, MasterServers (comma-separated IPs)
  - Stub: ZoneName, MasterServers
  - Conditional Forwarder: Name, MasterServers, ReplicationScope
- **Zone action buttons** on each zone card in the left panel (via dropdown or icon row):
  - Delete (confirmation dialog requiring zone name typed to confirm)
  - Suspend / Resume toggle
  - Force Transfer (secondary/stub only)
  - Export
  - Convert To → Primary / Secondary
- **Zone Aging panel** in the zone detail right panel: aging toggle, refresh interval, no-refresh interval, scavenging servers

### Files to Modify

- `server/bridge.ps1` — add 9 `Handle-*` functions + routes
- `dns-manager/src/lib/api.ts` — add zone lifecycle methods
- `dns-manager/src/lib/types.ts` — add `CreateZoneParams` (union type for each zone type), `ZoneAging`
- `dns-manager/src/app/zones/page.tsx` — add Create Zone dialog, zone action dropdown, aging panel (extract sub-components to manage file size)

---

## Phase 3: Response Rate Limiting + Scavenging

**Value**: RRL is critical DDoS mitigation. Scavenging prevents stale record accumulation. Both are server-wide settings that extend the Phase 1 Server Configuration panels.

**Depends on**: Phase 1 (extends the server config UI)

### Cmdlets (9 new → 63 total, ~53%)

| Cmdlet | Purpose |
|--------|---------|
| `Get/Set-DnsServerResponseRateLimiting` | RRL enable/parameters |
| `Add/Remove/Set-DnsServerResponseRateLimitingExceptionlist` | RRL exception domains |
| `Get/Set-DnsServerScavenging` | Server-wide scavenging settings |
| `Start-DnsServerScavenging` | Trigger immediate scavenging |
| `Test-DnsServer` | Diagnostic test |

### Bridge Endpoints (9 new routes)

```
GET    /api/server/rrl               → Get-DnsServerResponseRateLimiting
PUT    /api/server/rrl               → Set-DnsServerResponseRateLimiting
GET    /api/server/rrl/exceptions    → Get-DnsServerResponseRateLimitingExceptionlist
POST   /api/server/rrl/exceptions    → Add-DnsServerResponseRateLimitingExceptionlist
DELETE /api/server/rrl/exceptions/{name} → Remove-DnsServerResponseRateLimitingExceptionlist
GET    /api/server/scavenging        → Get-DnsServerScavenging
PUT    /api/server/scavenging        → Set-DnsServerScavenging
POST   /api/server/scavenging/start  → Start-DnsServerScavenging
POST   /api/server/test              → Test-DnsServer
```

### UI Changes

Add two panels to the Server Configuration section from Phase 1:

- **RRL panel** — enable/disable, ResponsesPerSec, ErrorsPerSec, WindowInSec, LeakRate, TruncateRate, TC rate. Exception list table with Add/Remove.
- **Scavenging panel** — enable/disable, scavenging interval, "Scavenge Now" button (with confirmation).
- **Test Server button** — runs `Test-DnsServer` and shows pass/fail diagnostic results.

### Files to Modify

- `server/bridge.ps1` — add 9 handlers + routes
- `dns-manager/src/lib/api.ts` — add RRL/scavenging/test methods
- `dns-manager/src/lib/types.ts` — add `RRLConfig`, `RRLException`, `ScavengingConfig`
- `dns-manager/src/app/server/page.tsx` (or extracted server config component) — add panels

---

## Phase 4: DNSSEC Management (new tab)

**Value**: DNSSEC is increasingly required. Complex enough to warrant its own dedicated page.

**Depends on**: Phase 2 (zone context needed)

### Cmdlets (15 new → 78 total, ~65%)

| Cmdlet | Purpose |
|--------|---------|
| `Get/Set-DnsServerDnsSecZoneSetting` | Zone DNSSEC config (NSEC/NSEC3, algo) |
| `Add/Get/Remove-DnsServerSigningKey` | KSK/ZSK management |
| `Invoke-DnsServerZoneSign/Unsign` | Sign or unsign a zone |
| `Get/Add/Remove-DnsServerTrustAnchor` | Trust anchor CRUD |
| `Get/Update-DnsServerTrustPoint` | Trust point status |
| `Export-DnsServerDnsSecPublicKey` | Export DS/DNSKEY for parent zone |
| `Enable/Disable-DnsServerSigningKeyRollover` | Key rollover automation |

### Bridge Endpoints (13 new routes)

```
GET    /api/dnssec/{zone}              → Get-DnsServerDnsSecZoneSetting
PUT    /api/dnssec/{zone}              → Set-DnsServerDnsSecZoneSetting
GET    /api/dnssec/{zone}/keys         → Get-DnsServerSigningKey
POST   /api/dnssec/{zone}/keys         → Add-DnsServerSigningKey
DELETE /api/dnssec/{zone}/keys/{id}    → Remove-DnsServerSigningKey
POST   /api/dnssec/{zone}/sign         → Invoke-DnsServerZoneSign
POST   /api/dnssec/{zone}/unsign       → Invoke-DnsServerZoneUnsign
POST   /api/dnssec/{zone}/export-key   → Export-DnsServerDnsSecPublicKey
GET    /api/trustanchors               → Get-DnsServerTrustAnchor
POST   /api/trustanchors               → Add-DnsServerTrustAnchor
DELETE /api/trustanchors/{name}        → Remove-DnsServerTrustAnchor
GET    /api/trustpoints                → Get-DnsServerTrustPoint
POST   /api/trustpoints/{name}/update  → Update-DnsServerTrustPoint
```

### UI Changes

New tab at position 09: **DNSSEC**

- **Zone signing status table** — all zones with signed/unsigned badge, algorithm, key count
- **Zone detail panel** (click a zone):
  - Signing keys table (KSK/ZSK) with Add/Remove
  - Sign Zone / Unsign Zone buttons (confirmation required)
  - DNSSEC settings editor (NSEC/NSEC3 mode, algorithm, key parameters)
  - Export Public Key button (downloads DS/DNSKEY)
  - Key rollover toggle
- **Trust Anchors section** — table with Add/Remove
- **Trust Points section** — read-only status table with Update action

### Files to Create/Modify

- `dns-manager/src/app/dnssec/page.tsx` — **new page**
- `dns-manager/src/components/tab-nav.tsx` — add DNSSEC tab (position 09)
- `dns-manager/src/lib/help-mapping.ts` — add `/dnssec` route mapping
- `server/bridge.ps1` — add 13 handlers + routes
- `dns-manager/src/lib/api.ts`, `types.ts`, `store.ts` — DNSSEC types, API methods, state

---

## Phase 5: Remaining Features (minimal UI + execute endpoint expansion)

**Value**: Covers niche features without over-building UI. Expands the execute endpoint allowlist for power users.

### Cmdlets (~20 new → 98 total, ~82%)

| Group | Cmdlets | UI Treatment |
|-------|---------|-------------|
| Root Hints | `Get/Add/Set/Remove/Import-DnsServerRootHint` | Small panel in Server Config |
| Zone Delegations | `Get/Add/Set/Remove-DnsServerZoneDelegation` | Panel in Zone detail view |
| DoH / Encryption | `Get/Set-DnsServerEncryptionProtocol` | Panel in Server Config (2025+ only) |
| AD Settings | `Get/Set-DnsServerDsSetting` | Panel in Server Config (AD-integrated only) |
| Global Name Zone | `Get/Set-DnsServerGlobalNameZone` | Toggle in Server Config |
| EDNS | `Get/Set-DnsServerEDns` | Panel in Server Config |
| Directory Partitions | `Get/Add/Remove/Register/Unregister-DnsServerDirectoryPartition` | Execute-only |
| Virtualization | `Get/Add/Set/Remove-DnsServerVirtualizationInstance` | Execute-only |
| Record-specific | `Add-DnsServerResourceRecordA/AAAA/CName/MX/Ptr/DnsKey/DS` | Skip (generic form handles these) |

### Execute Endpoint Expansion

Expand the cmdlet allowlist in `Handle-Execute` to cover all ~120 DnsServer module cmdlets. This lets power users run any DNS operation from the PowerShell tab without needing dedicated UI.

---

## Implementation Notes

### Route Ordering in bridge.ps1

The `switch -Regex` in `Route-Request` is order-sensitive. New routes must follow this pattern:
- Specific sub-routes first: `/api/zones/([^/]+)/aging`, `/api/zones/([^/]+)/convert`, etc.
- Then catch-all: `/api/zones/([^/]+)$`
- Server config routes (`/api/server/*`) are new prefixes with no collision risk

### Destructive Operations

All destructive actions require confirmation dialogs in the UI:
- Clear Cache, Clear Statistics, Remove Zone, Unsign Zone, Start Scavenging
- Remove Zone dialog should require typing the zone name to confirm

### File Size Management

`server/page.tsx` (811 lines) and `zones/page.tsx` (1258 lines) will grow significantly. Extract sub-components:
- `src/components/server/server-config.tsx` — configuration panels
- `src/components/server/forwarders-panel.tsx`, etc.
- `src/components/zones/create-zone-dialog.tsx`
- `src/components/zones/zone-actions.tsx`

### Phase Dependencies

```
Phase 1 (Server Config)  ──┐
                            ├── Phase 3 (RRL + Scavenging) ── Phase 5 (Niche)
Phase 2 (Zone Lifecycle) ──┤
                            └── Phase 4 (DNSSEC)
```

Phases 1 and 2 can be built in parallel. Each phase ships as one commit/PR.

---

## Verification

After each phase:
- [ ] `npm run build` passes with zero TypeScript errors
- [ ] All new bridge endpoints respond correctly (test with curl or the app)
- [ ] New UI panels render and load data from a connected DNS server
- [ ] Destructive operations show confirmation dialogs
- [ ] Existing functionality (policies, wizards, records) still works
- [ ] Help docs updated for new features
- [ ] CHANGELOG.md updated
