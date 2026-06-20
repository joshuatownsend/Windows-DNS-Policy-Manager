// Generates the PowerShell setup script for enabling inbound DNS over HTTPS (DoH)
// on a Windows Server 2025+ DNS Server.
//
// These steps are intentionally GENERATED (copy-paste) rather than executed via the
// bridge: importing a certificate, the `netsh http add sslcert` binding, the firewall
// rule, and the service restart cannot run over the bridge's remote DCOM CIM session
// (only the DNS Server cmdlets can). The admin runs this on the server in an elevated
// session. The live enable/disable toggle on the DoH tab uses the bridge instead.

import { psEscape } from "./command-generator";

/** Maximum URI templates accepted by Set-DnsServerEncryptionProtocol. */
export const MAX_DOH_TEMPLATES = 3;

export interface DohSetupInput {
  /** FQDN or IP that appears in the certificate SAN and the URI template host. */
  serverHost: string;
  /** IP address the DoH listener binds to. Default "0.0.0.0" (all addresses). */
  bindAddress?: string;
  /** DoH port. Default 443. */
  port?: number;
  /** "existing" = locate a cert already in the store; "pfx" = import one first. */
  certSource?: "existing" | "pfx";
  /** Subject substring used to locate the certificate (defaults to serverHost). */
  certSubject?: string;
  /** Path to the .pfx file (only used when certSource is "pfx"). */
  pfxPath?: string;
  /** Explicit HTTPS URI templates (max 3). If omitted, one is derived from host[:port]. */
  uriTemplates?: string[];
  /** Emit the inbound firewall rule. Default true. */
  openFirewall?: boolean;
  /** Emit the DNS service restart. Default true. */
  restartService?: boolean;
}

/**
 * Build the ordered DoH setup script as a single newline-joined string,
 * matching the convention of generateCommands() in command-generator.ts.
 */
export function generateDohSetupScript(input: DohSetupInput): string {
  const host = (input.serverHost || "").trim();
  const bind = (input.bindAddress || "0.0.0.0").trim();
  const port = input.port && input.port > 0 ? Math.floor(input.port) : 443;
  const certSource = input.certSource ?? "existing";
  const openFirewall = input.openFirewall !== false;
  const restartService = input.restartService !== false;

  // Resolve templates: explicit list (trimmed, capped) or auto-derived from host[:port].
  let templates = (input.uriTemplates || []).map((t) => t.trim()).filter(Boolean);
  if (templates.length === 0 && host) {
    const hostPort = port === 443 ? host : `${host}:${port}`;
    templates = [`https://${hostPort}/dns-query`];
  }
  templates = templates.slice(0, MAX_DOH_TEMPLATES);

  const lines: string[] = [];
  lines.push("# DNS over HTTPS (DoH) setup — run in an elevated PowerShell session ON the DNS server.");
  lines.push("# Requires Windows Server 2025 with KB5094125 (2026-06 update) or later.");
  lines.push("");

  // 1. Certificate (SAN must match the URI template host; private key in LocalMachine\My).
  lines.push("# 1. Import / locate the TLS certificate.");
  if (certSource === "pfx" && input.pfxPath) {
    lines.push('$pfxPassword = Read-Host -AsSecureString -Prompt "PFX password"');
    lines.push(
      `Import-PfxCertificate -FilePath "${psEscape(input.pfxPath)}" -CertStoreLocation "Cert:\\LocalMachine\\My" -Password $pfxPassword`
    );
  }
  // Match the subject as a literal substring via [regex]::Escape so values with regex
  // metacharacters (CN=…, parentheses, etc.) behave. Fall back to a placeholder when no host
  // or subject is given so the script never matches every cert via -match "".
  const subjectMatch = psEscape((input.certSubject?.trim() || host) || "<certificate-subject>");
  lines.push(
    `$cert = Get-ChildItem -Path Cert:\\LocalMachine\\My | Where-Object { $_.Subject -match [regex]::Escape("${subjectMatch}") } | Select-Object -First 1`
  );
  lines.push('if (-not $cert) { throw "No matching certificate found in Cert:\\LocalMachine\\My." }');
  lines.push("");

  // 2. Bind the certificate to the DoH port.
  lines.push("# 2. Bind the certificate to the DoH port.");
  lines.push('$guid = [guid]::NewGuid().ToString("B")');
  // Quote the user-controlled ipport so PowerShell statement separators in bindAddress
  // (`;`, `&`) stay inside a single token and can't inject commands into the copy-paste script.
  lines.push(`netsh http add sslcert ipport="${psEscape(bind)}:${port}" certhash="$($cert.Thumbprint)" appid="$guid"`);
  lines.push("");

  // 3. Firewall.
  if (openFirewall) {
    lines.push("# 3. Allow inbound DoH traffic through Windows Firewall.");
    lines.push(
      `New-NetFirewallRule -DisplayName "DNS over HTTPS" -Direction Inbound -Protocol TCP -LocalPort ${port} -Action Allow`
    );
    lines.push("");
  }

  // 4. Enable DoH and set the URI template(s).
  lines.push("# 4. Enable DoH and set the URI template(s).");
  if (templates.length > 0) {
    lines.push(`Set-DnsServerEncryptionProtocol -EnableDoh $true -UriTemplate "${psEscape(templates.join("|"))}"`);
  } else {
    // No host/templates supplied — the server auto-generates https://<fqdn>/dns-query.
    lines.push("Set-DnsServerEncryptionProtocol -EnableDoh $true");
  }
  lines.push("");

  // 5. Restart the DNS Server service for changes to take effect.
  if (restartService) {
    lines.push("# 5. Restart the DNS Server service for changes to take effect.");
    lines.push("Restart-Service -Name DNS");
    lines.push("");
  }

  // Verification.
  lines.push("# Verify (run on the server):");
  lines.push("Get-DnsServerEncryptionProtocol");
  lines.push(`netsh http show sslcert ipport="${psEscape(bind)}:${port}"`);
  lines.push("# Then, from a DoH-configured Windows client, test resolution:");
  if (host) {
    lines.push(`#   Resolve-DnsName -Name ${psEscape(host)} -Server ${psEscape(host)}`);
  } else {
    lines.push("#   Resolve-DnsName -Name <name> -Server <dns-server>");
  }

  return lines.join("\n");
}
