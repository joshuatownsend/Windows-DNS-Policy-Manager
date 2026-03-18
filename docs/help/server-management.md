# Server Management

The **Server** tab is where you add, configure, and monitor your DNS server connections. All other tabs operate on whichever server is currently selected here.

## Adding a Server

1. Click **Add Server** in the top-right corner
2. Fill in the fields:
   - **Name** — A display name (e.g., "Production DC01")
   - **Hostname** — The server's hostname or IP address (e.g., `dc01.contoso.com`)
   - **Credential Mode** — How to authenticate (see below)
3. Click **Save**

A default `localhost` server is created automatically on first launch.

## Credential Modes

| Mode | When to Use |
|------|------------|
| **Current User (Kerberos/NTLM)** | You're logged in as a user with DNS admin rights. No extra credentials needed. Best for managing the local server. |
| **Saved Credential (DPAPI)** | You need to connect as a different user. Credentials are encrypted and stored on disk using Windows DPAPI. Persists across restarts. |
| **Session** | Like saved credentials, but only kept in memory. Credentials are lost when the bridge restarts. |

When you choose Saved Credential or Session mode, additional **Username** and **Password** fields appear in the dialog. Enter the credentials in `DOMAIN\username` format.

## Testing a Connection

- Click the **play button** on any server card to test its connection
- Click **Test All** to test every server at once

A successful test shows:
- Green status dot
- Zone count
- Last checked time
- Zone cards grid showing all zones on that server

A failed test shows a red status dot. Check that the hostname is correct and the bridge has network access to the server.

## Selecting the Active Server

Click any server card to make it the **active server**. The active server is highlighted with a cyan border. All other tabs (DNS Objects, Zones, Policies, Wizards) operate on the active server.

When you select a connected server, its zones load automatically in the panel below.

## Server Info Panel

When the active server is online, an info panel appears showing:
- Hostname and zone count
- Last connection check time
- A grid of **zone cards** with badges for zone type (Primary, Secondary), AD integration, DNSSEC signing, and reverse lookup zones

## Server Configuration

Below the server list and zone cards, a **Server Configuration** section provides collapsible panels for viewing and managing server-wide settings. Click the section header to expand it, and click the refresh icon to load data from the server.

### General Settings

Displays and edits server-wide DNS settings. Toggle **Round Robin**, **Bind Secondaries**, **Strict File Parsing**, and **Local Net Priority** directly with switches — changes apply immediately.

### Forwarders

Manages upstream DNS forwarders. Queries that the server cannot resolve locally are forwarded to these servers.

- View the current forwarder list with IP addresses
- **Add** a forwarder by entering an IP and clicking Add
- **Remove** a forwarder by clicking the trash icon

### Recursion

Edit server recursion settings inline. Toggle **Enable** and **Secure Response**, or change **Timeout**, **Additional Timeout**, and **Retries** values (press Enter or click away to save).

### Cache

Displays DNS cache configuration (max TTL, max size, pollution protection). Click **Clear Cache** to flush all cached records from the server.

### Global Query Block List

The block list prevents the DNS server from resolving certain names (by default, `wpad` and `isatap`). You can add or remove domains from this list.

### Diagnostics

Toggle DNS debug logging options inline — queries, answers, notifications, send/receive packets, and more. Changes apply immediately.

### Statistics

Displays raw server performance counters in JSON format. Click **Clear Statistics** to reset counters.

## Editing a Server

Click the **pencil icon** on a server card to open the edit dialog. You can change the name, hostname, or credential mode.

## Removing a Server

Click the **trash icon** on a server card to remove it. The server's stored credentials (if any) are also deleted from the bridge. You cannot remove the last remaining server.
