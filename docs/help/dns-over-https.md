# DNS over HTTPS

The **DNS over HTTPS** tab manages *inbound* DoH on a Windows DNS Server — encrypting
DNS queries that clients send **to** this server over HTTPS instead of plaintext UDP/TCP 53.

> Inbound DoH is generally available on **Windows Server 2025** (with the 2026-06 update,
> KB5094125, or later). On earlier versions the server configuration panel shows a
> "not available" message. The setup-script generator works regardless of the connected
> server's version.

## Server configuration

Live settings, read and written through the bridge using `Get-DnsServerEncryptionProtocol`
and `Set-DnsServerEncryptionProtocol`:

- **DoH enabled** — toggle inbound DoH on or off. Disabling clears all configured URI
  templates automatically.
- **URI templates** — up to **3** HTTPS templates (e.g. `https://dns.contoso.com/dns-query`).
  If you enable DoH with no template, the server auto-generates `https://<fqdn>/dns-query`.

After saving, **the DNS Server service must be restarted** for the change to take effect
(`Restart-Service -Name DNS`). The UI shows a reminder banner after a successful save.

## Guided setup script

Enabling DoH is more than a single cmdlet — the server first needs a TLS certificate and a
listener binding. These steps **cannot be run remotely through the bridge** (the certificate
import, `netsh` SSL binding, firewall rule, and service restart are not DNS Server cmdlets),
so the tab generates a copy-paste script to run in an **elevated PowerShell session on the
DNS server**:

1. **Certificate** — import a `.pfx` (or locate an existing cert). The certificate's Subject
   Alternative Name (SAN) must match the URI-template host, and its private key must be in
   `Cert:\LocalMachine\My` without strong private-key protection.
2. **Binding** — `netsh http add sslcert ipport=<bind>:<port> certhash=<thumbprint> appid=<guid>`.
3. **Firewall** — allow inbound TCP on the DoH port (443 by default).
4. **Enable** — `Set-DnsServerEncryptionProtocol -EnableDoh $true -UriTemplate "..."`.
5. **Restart** — `Restart-Service -Name DNS`.

Fill in the server host, bind address, port, and certificate source. URI templates are taken
from the **Server configuration** section above (or auto-derived from the host).

## Verifying

On the server:

```powershell
Get-DnsServerEncryptionProtocol
netsh http show sslcert ipport=0.0.0.0:443
```

Then, from a DoH-configured Windows 10/11 client, resolve a name against the server and
confirm it succeeds.

## Notes

- **DNS over TLS (DoT) is not supported** by Windows DNS Server — only DoH.
- Reporting on / configuring DoH for Windows 10/11 *clients* is a separate capability planned
  for a future release.
