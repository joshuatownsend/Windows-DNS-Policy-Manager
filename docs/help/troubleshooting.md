# Troubleshooting

## Bridge Won't Start

**"Port already in use"**

The default bridge port is 8650. If another process is using it:
1. Check what's using the port: `netstat -ano | findstr 8650`
2. Either stop that process or start the bridge on a different port:
   ```powershell
   powershell -ExecutionPolicy Bypass -File server\bridge.ps1 -Port 8700
   ```

**"Access denied" or permission errors**

The bridge uses `System.Net.HttpListener`, which typically requires Administrator privileges:
1. Right-click PowerShell and select **Run as Administrator**
2. Run the bridge or launcher from the elevated session

**Windows port exclusion ranges**

Windows Hyper-V and Docker reserve dynamic port ranges that can conflict. Check with:
```powershell
netsh int ipv4 show excludedportrange protocol=tcp
```
If port 8650 falls in an excluded range, use a different port with `-Port`.

## Bridge Shows "Online" but Operations Fail

**DnsServer module not installed**

The bridge requires the `DnsServer` PowerShell module. Install it with:
```powershell
Install-WindowsFeature RSAT-DNS-Server
```
Or on Windows 10/11:
```powershell
Add-WindowsCapability -Online -Name Rsat.Dns.Tools~~~~0.0.1.0
```

**Remote server unreachable**

If testing a remote server fails:
- Verify the hostname resolves: `Resolve-DnsName dc01.contoso.com`
- Verify WinRM/RPC connectivity: `Test-NetConnection dc01.contoso.com -Port 5985`
- Verify credentials: try running a DNS cmdlet manually:
  ```powershell
  Get-DnsServerZone -ComputerName dc01.contoso.com
  ```

## Frontend Won't Start

**"ENOENT: no such file or directory, package.json"**

You're running `npm` from the wrong directory. The frontend lives in the `dns-manager` subdirectory:
```
cd dns-manager
npm install
npm run dev
```

**Port 10010 already in use**

Stop whatever is using port 10010, or edit `dns-manager/package.json` and change the port number in the `dev` script.

## Policies Not Appearing

- Click **Refresh** on the Policies tab
- Check the **zone filter** — clear it to show all policies
- Verify the policy was created on the correct server (check which server is active in the Server tab)
- Zone transfer policies appear separately from query resolution policies

## Wizard Commands Fail

**"The specified zone scope does not exist"**

Zone scopes must exist before policies can reference them. If a wizard command fails because a scope doesn't exist, the zone scope creation command may have failed earlier. Check the PowerShell tab output for the first error — later commands often depend on earlier ones.

**"Access denied" on remote operations**

Ensure the credential mode for the target server has been set correctly in the Server tab and that credentials are stored.

## Records Not Saving

- SOA records are **read-only** and cannot be modified through this tool
- For other record types, check the PowerShell tab for the specific error message
- Verify the zone is not a secondary zone (records can only be added to primary zones)

## Data Looks Stale

The app does not auto-refresh data. After making changes outside this tool (via PowerShell, another admin tool, or replication), click **Refresh** on the relevant tab to reload data from the server.

## "Unauthorized: missing or invalid bridge token"

The bridge requires a token on every request except the health check:
- The frontend and MCP server read it from `%LOCALAPPDATA%\DNSPolicyManager\bridge.token`, which the bridge rewrites every time it starts.
- The bridge reuses the same token across restarts. If you rotated it (`-RotateToken`), sign in again: the frontend reads the new file automatically.
- If the bridge runs as a different Windows user (for example, elevated with another admin account), or on another machine, start it with a fixed token (`-Token <value>` or `$env:DNS_BRIDGE_TOKEN`). Then give the frontend and MCP server the same value in `BRIDGE_TOKEN`.

## Sent to the "Sign in" page

The app proxies every call to the bridge, and the proxy only serves browsers that have signed in. `Start-DNSPolicyManager.ps1` opens a link that signs you in automatically. Otherwise, paste the contents of `%LOCALAPPDATA%\DNSPolicyManager\bridge.token` (or your Docker `BRIDGE_TOKEN`) into the sign-in form. You stay signed in across bridge restarts until the token is rotated with `-RotateToken`.

## "Bridge token not found"

The frontend couldn't find the token file and no `BRIDGE_TOKEN` is set. Start the bridge first: it writes the file on startup. In Docker, set `BRIDGE_TOKEN` in `.env`.

## "Host not allowed"

The frontend only answers requests addressed to `localhost`, `127.0.0.1` or `[::1]`, which protects it from DNS-rebinding attacks. To open it under another hostname, add that name to `ALLOWED_HOSTS` (comma-separated) in the frontend's environment.

## Credentials stopped working after editing a server

Saved and session credentials are bound to the hostname they were entered for. Changing a server's hostname or credential mode clears its stored credential. Edit the server again and re-enter the username and password. Credentials saved before this protection existed must also be re-entered once.
