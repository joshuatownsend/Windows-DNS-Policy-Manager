import { describe, it, expect } from "vitest";
import { generateDohSetupScript } from "../doh-setup";

describe("generateDohSetupScript", () => {
  it("auto-generates a URI template from the host when none provided", () => {
    const out = generateDohSetupScript({ serverHost: "dns.contoso.com" });
    expect(out).toContain(
      'Set-DnsServerEncryptionProtocol -EnableDoh $true -UriTemplate "https://dns.contoso.com/dns-query"'
    );
  });

  it("includes the port in the auto template, binding, and firewall rule when not 443", () => {
    const out = generateDohSetupScript({ serverHost: "dns.contoso.com", port: 8443 });
    expect(out).toContain('https://dns.contoso.com:8443/dns-query');
    expect(out).toContain("-LocalPort 8443");
    expect(out).toContain("ipport=0.0.0.0:8443");
  });

  it("joins multiple templates with a pipe and caps at 3", () => {
    const out = generateDohSetupScript({
      serverHost: "dns.contoso.com",
      uriTemplates: [
        "https://a/dns-query",
        "https://b/dns-query",
        "https://c/dns-query",
        "https://d/dns-query",
      ],
    });
    expect(out).toContain('-UriTemplate "https://a/dns-query|https://b/dns-query|https://c/dns-query"');
    expect(out).not.toContain("https://d/dns-query");
  });

  it("emits Import-PfxCertificate only for the pfx cert source", () => {
    const out = generateDohSetupScript({
      serverHost: "dns.contoso.com",
      certSource: "pfx",
      pfxPath: "C:\\certs\\doh.pfx",
    });
    expect(out).toContain('Import-PfxCertificate -FilePath "C:\\certs\\doh.pfx"');
  });

  it("does not import for the existing cert source and matches by subject", () => {
    const out = generateDohSetupScript({
      serverHost: "dns.contoso.com",
      certSource: "existing",
      certSubject: "CN=dns.contoso.com",
    });
    expect(out).not.toContain("Import-PfxCertificate");
    expect(out).toContain('$_.Subject -match "CN=dns.contoso.com"');
  });

  it("escapes PowerShell metacharacters in user-supplied input", () => {
    const out = generateDohSetupScript({
      serverHost: "dns.contoso.com",
      certSubject: '$(Remove-Item C:\\)',
    });
    // The injected dollar-subexpression must be neutralized with a backtick.
    expect(out).toContain("`$(Remove-Item");
  });

  it("omits the firewall rule and service restart when disabled", () => {
    const out = generateDohSetupScript({
      serverHost: "dns.contoso.com",
      openFirewall: false,
      restartService: false,
    });
    expect(out).not.toContain("New-NetFirewallRule");
    expect(out).not.toContain("Restart-Service");
  });

  it("enables DoH without a template when no host or templates are given", () => {
    const out = generateDohSetupScript({ serverHost: "" });
    expect(out).toContain("Set-DnsServerEncryptionProtocol -EnableDoh $true");
    expect(out).not.toContain("-UriTemplate");
  });
});
