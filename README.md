# Windows DNS Policy Manager

A browser-based GUI for creating and managing Windows Server DNS Policies. Built with Next.js, TypeScript, and shadcn/ui. Connects to a live DNS server via the included PowerShell bridge for real-time policy management. Includes an MCP server for AI agent integration (Claude Code, Cursor, VS Code).

## Features

- **11-tab interface**: Server, Objects, Zones, Policies, Create, Blocklists, Wizards, DNSSEC, Resolvers, Backup, PowerShell
- **Multi-server management** with Kerberos, DPAPI-saved, or session-based credentials and header server switcher for quick switching from any tab
- **Server configuration dashboard** with inline editing for 13 config panels (settings, forwarders, recursion, cache, blocklist, diagnostics, statistics, RRL, scavenging, root hints, EDNS, AD settings, global name zone, DoH/DoT)
- **DNS Best Practices Analyzer** — run Windows BPA from the UI with severity-coded findings
- **Zone browser** with two-panel layout, settings editor, full record CRUD, CSV import/export, pagination, and filters for Forward/Reverse, zone type (Primary/Secondary/Stub/Forwarder), and AD-integrated
- **8 scenario wizards** with typed execution (geo-location, split-brain, time-of-day, load balancing, query filters, blocklist, geo+LB combo, primary-secondary)
- **Blocklists tab** — Quick Block (single domain), Bulk Import (.txt), Active Block Policies table, and Global Query Block List management
- **Resolvers tab** — IP stack DNS per adapter (IPv4/IPv6), forwarder configuration, Mermaid topology diagram with color-coded edges
- **DNSSEC management** — zone signing, signing key CRUD, trust anchors, trust points
- **Policy CRUD** with enable/disable toggle, processing order editor, and cross-server copy
- **DNS object management** for client subnets, zone scopes, and recursion scopes
- **Zone lifecycle** — create, delete, convert, suspend, resume, export zones
- **PowerShell command generation** with copy-to-clipboard — works offline as a command generator
- **Backup & export** — policy JSON backup/restore, server configuration export (Get-DnsServer as JSON), DNS zone export (single or all primary zones via Export-DnsServerZone), AD-integrated backup info
- **Context-sensitive help** with slide-over panel and full-page popout
- **20 Playwright E2E tests** with mock bridge, integrated into CI
- **MCP server** — 31 read-only tools for AI agents via Model Context Protocol (zones, records, policies, server config, DNSSEC, RRL, scavenging, and more), plus offline PowerShell command generation
- **Docker-ready** with multi-stage Alpine image (221 MB)
- Keyboard-accessible tab navigation and ARIA attributes

## Running Locally

### Requirements

- **Node.js** 18+ (for the frontend)
- **Windows Server** with the DNS Server role, or a machine with the `DnsServer` PowerShell module
- The bridge binds only to `127.0.0.1` by default — never exposed to the network

### One-command launch

```powershell
powershell -ExecutionPolicy Bypass -File Start-DNSPolicyManager.ps1
```

This starts both the PowerShell bridge (port 8650) and the Next.js dev server (port 10010), then opens your browser.

### Manual startup

```powershell
# Terminal 1: Start the bridge
powershell -ExecutionPolicy Bypass -File server/bridge.ps1

# Terminal 2: Start the frontend
cd dns-manager
npm install   # first time only
npm run dev
```

Then open [http://localhost:10010](http://localhost:10010).

### Offline mode

If the bridge isn't running, the app falls back to command generation only — build policies visually and copy the generated PowerShell commands.

## MCP Server (AI Agent Integration)

The MCP server lets AI agents query your DNS servers through 31 read-only tools via the [Model Context Protocol](https://modelcontextprotocol.io). It connects to the same PowerShell bridge used by the web UI.

### Setup

```bash
cd mcp-server
npm install
npm run build
```

Or use the launcher:

```powershell
powershell -ExecutionPolicy Bypass -File Start-DNSPolicyManager.ps1 -MCP
```

### Register with Claude Code

```bash
claude mcp add dns-policy-manager -- node /path/to/mcp-server/dist/index.js
```

With environment variables for a specific server:

```bash
claude mcp add dns-policy-manager \
  -e BRIDGE_URL=http://127.0.0.1:8650 \
  -e DNS_DEFAULT_SERVER=dc01.contoso.com \
  -e DNS_CREDENTIAL_MODE=currentUser \
  -- node /path/to/mcp-server/dist/index.js
```

### Configuration

All configuration is via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `BRIDGE_URL` | `http://127.0.0.1:8650` | PowerShell bridge URL |
| `DNS_DEFAULT_SERVER` | *(none)* | Default DNS server hostname |
| `DNS_SERVER_ID` | *(none)* | Server ID for credential lookup |
| `DNS_CREDENTIAL_MODE` | `currentUser` | Auth mode: `currentUser` or `savedCredential` |

### Available Tools (31)

| Category | Tools |
|----------|-------|
| **Zones** | `dns_list_zones`, `dns_get_zone_details`, `dns_get_zone_records`, `dns_get_zone_aging`, `dns_get_zone_delegations` |
| **Policies** | `dns_list_policies`, `dns_list_transfer_policies` |
| **Server Config** | `dns_get_server_settings`, `dns_get_forwarders`, `dns_get_cache_settings`, `dns_get_recursion_settings`, `dns_get_blocklist`, `dns_get_diagnostics`, `dns_get_statistics`, `dns_get_rrl`, `dns_get_rrl_exceptions`, `dns_get_scavenging`, `dns_get_root_hints`, `dns_get_edns`, `dns_get_encryption`, `dns_get_global_name_zone`, `dns_export_server_config` |
| **DNS Objects** | `dns_list_subnets`, `dns_list_zone_scopes`, `dns_list_recursion_scopes` |
| **DNSSEC** | `dns_get_dnssec_settings`, `dns_get_signing_keys`, `dns_get_trust_anchors`, `dns_get_trust_points` |
| **Offline** | `dns_generate_policy_commands` (works without bridge) |
| **Health** | `dns_check_health` |

### Authentication

The MCP server supports two credential modes:

- **`currentUser`** (default) — uses Kerberos/NTLM from the logged-in user. No setup needed.
- **`savedCredential`** — uses DPAPI-encrypted credentials stored via the web UI. Set `DNS_SERVER_ID` to the server ID configured in the GUI.

Session credentials (username/password) are intentionally not supported in the MCP server — AI agents should not handle raw passwords.

### Security

- All tools are **read-only** — no write operations on DNS servers
- The bridge's `/api/execute` endpoint (arbitrary PowerShell) is **not exposed** through MCP
- Generated PowerShell commands (offline tool) sanitize all input against injection (`$`, `` ` ``, `"`)
- The bridge must be running for live queries; the offline command generator works independently

## Running with Docker

The frontend runs in a standard Linux container. The bridge requires Windows PowerShell with the `DnsServer` module, so it runs on the host machine (or a Windows container).

### Frontend in Docker, bridge on host

This is the recommended Docker setup. The frontend container proxies API calls to the bridge running on your Windows machine.

**Step 1 — Start the bridge on the host:**

```powershell
powershell -ExecutionPolicy Bypass -File server/bridge.ps1
```

**Step 2 — Start the frontend container:**

```bash
docker compose up -d
```

Or build and run manually:

```bash
docker build -t dns-manager ./dns-manager
docker run -d -p 10010:10010 dns-manager
```

Open [http://localhost:10010](http://localhost:10010).

### Custom bridge address

By default, the Docker image connects to the bridge at `http://host.docker.internal:8650` (Docker Desktop's host gateway). To point at a different bridge:

```bash
# At build time (baked into the image)
docker build --build-arg BRIDGE_URL=http://192.168.1.50:8650 -t dns-manager ./dns-manager

# Or override in docker-compose.yml
services:
  frontend:
    build:
      args:
        BRIDGE_URL: http://192.168.1.50:8650
```

### Bridge on a remote host or separate network

If the bridge runs on a different machine than Docker, use `-BindAddress` to make it listen on all interfaces:

```powershell
powershell -ExecutionPolicy Bypass -File server/bridge.ps1 -BindAddress 0.0.0.0
```

> **Security note**: `-BindAddress 0.0.0.0` exposes the bridge to the network. Only use this on trusted networks or behind a firewall. The default `127.0.0.1` restricts access to localhost.

### Docker Compose reference

```bash
docker compose up -d              # Start frontend (bridge on host)
docker compose down               # Stop
docker compose up -d --build      # Rebuild after code changes
docker compose logs -f frontend   # View logs
```

## Architecture

```
Browser (:10010)                         PowerShell Bridge (:8650)
─────────────────                        ──────────────────────────
  Next.js frontend        ──HTTP──►      [System.Net.HttpListener]
                                                │
AI Agent (stdio)                          DNS cmdlets (splatted)
────────────────                          Get/Add/Remove/Set-DnsServer*
  MCP Server              ──HTTP──►             │
  31 read-only tools                      Returns JSON
```

**Frontend** (`dns-manager/`):
- Next.js App Router with TypeScript and Tailwind CSS v4
- shadcn/ui components (Radix primitives)
- Zustand store with localStorage persistence
- API client with direct bridge calls (bypasses Next.js proxy)
- Standalone output for production Docker images

**Bridge** (`server/bridge.ps1`):
- PowerShell `HttpListener` with regex-based routing and **runspace pool** for concurrent request handling
- Splatted parameters for all DNS cmdlet calls (prevents injection)
- Three credential modes: Kerberos, DPAPI-encrypted, session — with **CIM sessions** for credential-based remote server access
- Background jobs for long-running operations (BPA, Resolvers)
- Path traversal protection on serverId and fileName parameters
- Graceful degradation — frontend works offline when bridge is unavailable

## API Endpoints (Bridge)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/health` | Ping + DNS module check |
| POST | `/api/connect` | Test DNS server, list zones |
| GET | `/api/zones` | List DNS zones |
| GET | `/api/zones/{name}` | Zone details |
| GET | `/api/zones/{name}/records` | List zone records |
| POST | `/api/zones/{name}/records` | Add record |
| PUT | `/api/zones/{name}/records` | Update record |
| DELETE | `/api/zones/{name}/records` | Delete record |
| PUT | `/api/zones/{name}/settings` | Edit zone settings |
| GET | `/api/policies` | List policies |
| POST | `/api/policies` | Create policy |
| DELETE | `/api/policies/{name}` | Remove policy |
| PUT | `/api/policies/{name}/state` | Enable/disable policy |
| POST | `/api/policies/multi` | Create on multiple servers |
| POST | `/api/policies/copy` | Copy policies between servers |
| GET | `/api/transferpolicies` | List zone transfer policies |
| POST | `/api/transferpolicies` | Create zone transfer policy |
| DELETE | `/api/transferpolicies/{name}` | Remove zone transfer policy |
| GET | `/api/subnets` | List client subnets |
| POST | `/api/subnets` | Create client subnet |
| DELETE | `/api/subnets/{name}` | Delete client subnet |
| GET | `/api/zonescopes` | List zone scopes |
| POST | `/api/zonescopes` | Create zone scope |
| DELETE | `/api/zonescopes/{name}` | Delete zone scope |
| POST | `/api/zonescopes/records` | Add record to zone scope |
| GET | `/api/recursionscopes` | List recursion scopes |
| POST | `/api/recursionscopes` | Create recursion scope |
| PUT | `/api/recursionscopes/{name}` | Update recursion scope |
| DELETE | `/api/recursionscopes/{name}` | Delete recursion scope |
| POST | `/api/credentials/store` | Store DPAPI credential |
| POST | `/api/credentials/session` | Store session credential |
| GET | `/api/credentials/check` | Check credential exists |
| DELETE | `/api/credentials/{id}` | Delete credential |
| POST | `/api/backup` | Export policies as JSON |
| POST | `/api/server/resolvers` | Start DNS client resolver discovery job |
| GET | `/api/server/resolvers` | Poll resolver discovery job result |
| GET | `/api/export/serverconfig` | Export full server config as JSON |
| POST | `/api/export/allzones` | Export all primary zones |
| POST | `/api/execute` | Run allowlisted DNS cmdlet |

## Project Structure

```
Start-DNSPolicyManager.ps1        Launcher: starts bridge + frontend (+ MCP with -MCP flag)
docker-compose.yml                Docker Compose for containerized deployment
server/
  bridge.ps1                      PowerShell HTTP bridge (localhost:8650)
  start.bat                       Double-click launcher for bridge only
mcp-server/                       MCP server for AI agents
  src/
    index.ts                      Entry point, stdio transport
    bridge-client.ts              HTTP client for bridge REST API
    tools/
      shared.ts                   Shared Zod schemas (ServerParamsSchema)
      zones.ts                    Zone query tools (5)
      policies.ts                 Policy query tools (2)
      server-config.ts            Server config query tools (15)
      objects.ts                  DNS object query tools (3)
      security.ts                 DNSSEC query tools (4)
      command-gen.ts              Offline PowerShell command generation (1)
dns-manager/                      Next.js frontend
  Dockerfile                      Multi-stage Alpine build (standalone output)
  src/
    app/                          App Router pages (11 tabs + help)
      server/page.tsx             Server management + configuration dashboard
      objects/page.tsx            DNS Objects (subnets, scopes)
      zones/page.tsx              Zone browser + record CRUD + lifecycle + filters
      policies/page.tsx           Policy list
      create/page.tsx             Create Policy form
      blocklists/page.tsx         Blocklists (quick block, bulk import, GQBL)
      wizards/page.tsx            Scenario wizards (8 scenarios)
      dnssec/page.tsx             DNSSEC management
      resolvers/page.tsx          Resolvers (adapter DNS, forwarders, topology)
      backup/page.tsx             Backup & Import + zone/config export
      powershell/page.tsx         PowerShell output
      help/[slug]/page.tsx        Help documentation viewer
    components/
      app-shell.tsx               Layout shell, header, bridge status
      tab-nav.tsx                 Tab navigation
      help-panel.tsx              Slide-over help panel
      ui/                         shadcn/ui components
    lib/
      api.ts                      Typed API client (~80 methods)
      store.ts                    Zustand store
      types.ts                    TypeScript interfaces
      help-mapping.ts             Route-to-help-doc mapping
    wizards/
      scenarios.ts                Scenario definitions
      command-generator.ts        PowerShell command generation
  public/help/                    Help documentation (Markdown)
docs/help/                        Source help documentation
```

## DnsServer Module Coverage

The app wraps ~98 of ~120 cmdlets in the [DnsServer PowerShell module](https://learn.microsoft.com/en-us/powershell/module/dnsserver/) with dedicated UI. The remaining cmdlets are accessible through the **PowerShell tab** via the execute endpoint, which allows any `DnsServer` cmdlet.

**Cmdlets without dedicated UI** (reachable via execute):

| Group | Cmdlets | Reason |
|-------|---------|--------|
| Type-specific record creation | `Add-DnsServerResourceRecordA`, `...AAAA`, `...CName`, `...MX`, `...Ptr`, `...DnsKey`, `...DS` | Already handled by the generic `Add-DnsServerResourceRecord` |
| Record aging | `Set-DnsServerResourceRecordAging` | Bulk operation, run via execute |
| Key rollover | `Invoke-DnsServerSigningKeyRollover`, `Step-DnsServerSigningKeyRollover` | One-off DNSSEC operations |
| Zone restore | `Restore-DnsServerPrimaryZone`, `Restore-DnsServerSecondaryZone` | Rarely used, forces reload from AD/file |
| Zone sync | `Sync-DnsServerZone` | Flushes memory to storage |
| Imports | `Import-DnsServerRootHint`, `Import-DnsServerResourceRecordDS`, `Import-DnsServerTrustAnchor` | File-based import operations |
| Key storage | `Show-DnsServerKeyStorageProvider` | Read-only diagnostic |
| Directory partitions | `Get/Add/Remove/Register/Unregister-DnsServerDirectoryPartition` | AD infrastructure, rarely changed |
| Virtualization | `Get/Add/Set/Remove-DnsServerVirtualizationInstance` | Server 2016+ niche feature |
| Encryption (DoH) | `Get/Set-DnsServerEncryptionProtocol` | Server 2025+ only |

## Browser Support

Chrome, Firefox, and Edge (current versions).

## Port Reference

| Service | Default Port | Override |
|---------|-------------|---------|
| Frontend (dev) | 10010 | Edit `package.json` dev script |
| Frontend (Docker) | 10010 | Change in `docker-compose.yml` ports |
| Bridge | 8650 | `-Port` parameter on `bridge.ps1` |

Windows Hyper-V/Docker dynamically reserves port ranges (check `netsh int ipv4 show excludedportrange`) that can conflict with port 8650. If the bridge fails to bind, use `-Port` to specify an open one.
