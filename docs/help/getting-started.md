# Getting Started

## What is DNS Policy Manager?

DNS Policy Manager is a graphical tool for creating and managing DNS policies on Windows Server. It connects to your DNS servers through a local PowerShell bridge and lets you build policies visually instead of writing PowerShell commands by hand.

## Requirements

- **Node.js 18 or later** (for the web interface)
- **Windows Server** with the DNS Server role installed, or any Windows machine with the `DnsServer` PowerShell module
- A modern web browser (Chrome, Firefox, or Edge)

## Starting the Application

### Recommended: Use the Launcher

```powershell
powershell -ExecutionPolicy Bypass -File Start-DNSPolicyManager.ps1
```

This starts both the PowerShell bridge and the web interface, then opens your browser automatically.

### Manual Startup

Open two terminals:

**Terminal 1** — Start the PowerShell bridge:
```powershell
powershell -ExecutionPolicy Bypass -File server\bridge.ps1
```

**Terminal 2** — Start the web interface:
```
cd dns-manager
npm install      (first time only)
npm run dev
```

Then open `http://localhost:10010` in your browser.

## Two Modes of Operation

### Live Mode (bridge connected)

When the bridge is running and connected to a DNS server, you can:
- Create, modify, and delete policies directly on the server
- Browse zones and manage DNS records
- Run wizard scenarios that configure multiple objects at once
- Export and import policy backups

The bridge status indicator in the top-right corner shows **Online** (green) when connected.

### Offline Mode (generate only)

If the bridge isn't running, the app still works as a command generator:
- Build policies using the visual form
- Run wizard scenarios to generate commands
- Copy the generated PowerShell commands from the PowerShell tab
- Paste and run them manually in your own PowerShell session

## Execution Mode Toggle

When the bridge is connected, a toggle appears in the header:

- **Dry Run** (default) — Commands are generated and shown in the PowerShell tab, but not executed on the server. Use this to review before applying.
- **Live** — Commands are generated AND executed on the server immediately.

## Interface Overview

The app has 8 tabs:

| Tab | Purpose |
|-----|---------|
| **Server** | Add, test, and manage DNS server connections |
| **DNS Objects** | Create client subnets, zone scopes, and recursion scopes |
| **Zones** | Browse zones, edit settings, manage DNS records |
| **Policies** | View, enable/disable, and delete existing policies |
| **Create Policy** | Build new policies with the visual form |
| **Wizards** | Step-by-step guided setup for common DNS scenarios |
| **Backup & Import** | Export policies to JSON, import backups, bulk-import blocklists |
| **PowerShell** | View all generated commands with copy-to-clipboard |

## First Steps

1. **Add your DNS server** in the Server tab (localhost is added by default)
2. **Test the connection** — click the play button on the server card
3. **Browse your zones** in the Zones tab
4. **Try a wizard** — the Wizards tab walks you through common scenarios step by step
