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
