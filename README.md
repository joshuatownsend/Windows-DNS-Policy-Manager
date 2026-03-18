# Windows DNS Policy Manager

A browser-based GUI for creating and managing Windows Server DNS Policies. Built with Next.js, TypeScript, and shadcn/ui. Connects to a live DNS server via the included PowerShell bridge for real-time policy management.

## Features

- **8-tab interface**: Server, DNS Objects, Zones, Policies, Create Policy, Wizards, Backup & Import, PowerShell
- **Multi-server management** with Kerberos, DPAPI-saved, or session-based credentials
- **Zone browser** with two-panel layout, settings editor, and full record CRUD (A, AAAA, CNAME, MX, SRV, TXT, NS, PTR)
- **10 scenario wizards** aligned to Microsoft DNS Policy documentation (geo-location, split-brain, time-of-day, load balancing, query filters, blocklist, and more)
- **Policy CRUD** with enable/disable toggle and cross-server copy
- **DNS object management** for client subnets, zone scopes, and recursion scopes
- **PowerShell command generation** with copy-to-clipboard — works offline as a command generator
- **Blocklist import** from TXT files with batch policy creation
- **Backup & export** of policies as JSON with restore support
- **Context-sensitive help** with slide-over panel and full-page popout
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
  /api/* proxy to bridge                        │
                                          DNS cmdlets (splatted)
                                          Get/Add/Remove/Set-DnsServer*
                                                │
                                          Returns JSON
```

**Frontend** (`dns-manager/`):
- Next.js App Router with TypeScript and Tailwind CSS v4
- shadcn/ui components (Radix primitives)
- Zustand store with localStorage persistence
- API client proxied through Next.js rewrites
- Standalone output for production Docker images

**Bridge** (`server/bridge.ps1`):
- PowerShell `HttpListener` with regex-based routing
- Splatted parameters for all DNS cmdlet calls (prevents injection)
- Three credential modes: Kerberos, DPAPI-encrypted, session
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
| POST | `/api/execute` | Run allowlisted DNS cmdlet |

## Project Structure

```
Start-DNSPolicyManager.ps1        Launcher: starts bridge + frontend
docker-compose.yml                Docker Compose for containerized deployment
server/
  bridge.ps1                      PowerShell HTTP bridge (localhost:8650)
  start.bat                       Double-click launcher for bridge only
dns-manager/                      Next.js frontend
  Dockerfile                      Multi-stage Alpine build (standalone output)
  src/
    app/                          App Router pages (9 tabs + help)
      server/page.tsx             Server management + configuration dashboard
      objects/page.tsx            DNS Objects (subnets, scopes)
      zones/page.tsx              Zone browser + record CRUD + lifecycle
      policies/page.tsx           Policy list
      create/page.tsx             Create Policy form
      wizards/page.tsx            Scenario wizards (10 scenarios)
      dnssec/page.tsx             DNSSEC management
      backup/page.tsx             Backup & Import
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
archive/
  vanilla-frontend/               Original vanilla JS/HTML/CSS (pre-migration)
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
