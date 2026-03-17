# Windows DNS Policy Manager

A zero-dependency, browser-based GUI for creating and managing Windows Server DNS Query Resolution Policies. Open `index.html` directly in any browser — no server, no build tools, no installs.

Optionally connect to a live DNS server via the included PowerShell bridge for real-time policy management.

## Features

- Visual policy builder with form validation
- Support for all DNS policy criteria types (FQDN, Client Subnet, Query Type, etc.)
- PowerShell command generation with copy-to-clipboard
- **Live server management** via local PowerShell bridge (create, delete, load policies)
- **Real-time connection testing** with zone autocomplete
- **Live backup** — export policies directly from the DNS server
- Policy backup and export (JSON, XML, PowerShell script)
- Blocklist import from TXT/CSV files with preview and optional server execution
- Graceful degradation — works fully offline as a command generator
- Toast notifications (replaces alert dialogs)
- Keyboard-accessible tab navigation (arrow keys, Enter/Space)
- Screen-reader-friendly ARIA attributes
- Responsive layout (desktop, tablet, phone)

## Quick Start

### Offline mode (command generation only)

1. Double-click `index.html` (or open it in Chrome, Firefox, or Edge)
2. Use the **Create Policy** tab to build DNS policies visually
3. Click **Generate Policy** to produce the PowerShell command
4. Copy the command from the **PowerShell Commands** tab

### Live mode (connected to DNS server)

1. Double-click `server/start.bat` (or run `Start-DNSPolicyManager.ps1`)
2. The PowerShell bridge starts on `http://127.0.0.1:8650` and the browser opens automatically
3. The header shows **Bridge: Connected** (green dot)
4. Enable the **Execute on server** toggle to create policies directly on the DNS server
5. Use **Refresh Policies** to load existing policies from the server
6. Use **Backup from Server** to export all policies as JSON

> **Requirements for live mode:** Windows Server with the DNS Server role installed, or a machine with the `DnsServer` PowerShell module available. The bridge binds only to `127.0.0.1` (localhost) — it is never exposed to the network.

## Architecture

```
Browser (index.html)                    PowerShell Bridge (bridge.ps1)
─────────────────────                   ──────────────────────────────
  fetch('/api/...')     ──HTTP──►    [System.Net.HttpListener] :8650
                                           │
                                     Executes DNS cmdlets:
                                     Get-DnsServerQueryResolutionPolicy
                                     Add-DnsServerQueryResolutionPolicy
                                     Remove-DnsServerQueryResolutionPolicy
                                     Get-DnsServerZone
                                           │
                                     Returns JSON ◄── cmdlet output
```

- **Namespace pattern** (`window.DNSPolicyManager`): Works with `file://` protocol (ES modules are blocked by CORS when opening HTML files directly)
- **Event delegation**: A single click/change listener on `document` routes actions via `data-action` attributes — no inline `onclick` handlers
- **CSS custom properties**: All colors, spacing, and typography are defined as tokens in `variables.css`
- **Graceful degradation**: When the bridge is offline, the app falls back to its original command-generation behavior. All bridge-dependent code paths check `state.bridgeConnected` before making API calls.
- **Security**: Policy creation uses PowerShell splatting (not string concatenation) to prevent injection. The `/api/execute` endpoint only allows DNS-related cmdlets via an allowlist.

## API Endpoints (Bridge)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/health` | Ping + DNS module availability check |
| POST | `/api/connect` | Test DNS server reachability, list zones |
| GET | `/api/zones?server=X` | List DNS zones |
| GET | `/api/policies?server=X&zone=Y` | List policies |
| POST | `/api/policies` | Create policy (splatted params) |
| DELETE | `/api/policies/{name}?server=X&zone=Y` | Remove policy |
| POST | `/api/backup` | Export all policies as JSON |
| POST | `/api/execute` | Run allowlisted DNS cmdlet |

## Project Structure

```
index.html                    HTML shell with ARIA attributes
Start-DNSPolicyManager.ps1    Launcher: starts bridge + opens browser
server/
  bridge.ps1                  PowerShell HTTP bridge (localhost:8650)
  start.bat                   Double-click launcher
css/
  variables.css               Design tokens (colors, spacing, radii, shadows)
  base.css                    Reset, typography, form elements, validation states
  layout.css                  Container, header, grid, sidebar
  components.css              Buttons, tabs, cards, badges, tooltips, toggle, upload
  powershell.css              Dark-themed code output panel
  responsive.css              Media queries (1024px, 768px, 480px)
js/
  state.js                    App state object (includes bridge connection state)
  app.js                      Entry point: event delegation, bridge init
  services/
    api.js                    Bridge API client (fetch wrapper, health polling)
  ui/
    tabs.js                   Tab switching
    toast.js                  Toast notifications
    form.js                   Validation, toggles, clearForm
  features/
    policy.js                 Generate, execute, render, select, delete policies
    criteria.js               Add/remove criteria, help text
    scopes.js                 Add/remove zone scopes
    connection.js             Test connection, load zones, toggle credentials
    backup.js                 Backup script generation, live server backup, export
    blocklist.js              File import, parsing, preview, policy generation
  utils/
    download.js               File download helper
dns-policy-manager.html       Original single-file version (kept as reference)
```

## Browser Support

Chrome, Firefox, and Edge (current versions). Works when opened via `file://` or any HTTP server.
