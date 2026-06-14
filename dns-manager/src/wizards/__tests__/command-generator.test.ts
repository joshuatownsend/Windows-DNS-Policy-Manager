import { describe, it, expect } from "vitest";
import { generateCommands } from "../command-generator";

describe("generateCommands", () => {
  it("blocklist: emits a single policy with joined FQDNs", () => {
    const out = generateCommands("blocklist", {
      blocklistDomains: "a.com,b.com",
      blocklistAction: "IGNORE",
    });
    expect(out).toContain(
      'Add-DnsServerQueryResolutionPolicy -Name "Blocklist" -Action IGNORE -FQDN "EQ,a.com,b.com" -ProcessingOrder 1'
    );
  });

  it("blocklist: splits into _Part batches over 100 domains", () => {
    const domains = Array.from({ length: 150 }, (_, i) => `d${i}.com`).join(",");
    const out = generateCommands("blocklist", { blocklistDomains: domains });
    expect(out).toContain('-Name "Blocklist_Part1"');
    expect(out).toContain('-Name "Blocklist_Part2"');
  });

  it("appends -ComputerName for a non-localhost server", () => {
    const out = generateCommands("blocklist", { blocklistDomains: "a.com" }, "dc01");
    expect(out).toContain('-ComputerName "dc01"');
  });

  it("omits -ComputerName for localhost", () => {
    const out = generateCommands("blocklist", { blocklistDomains: "a.com" }, "localhost");
    expect(out).not.toContain("-ComputerName");
  });

  it("geolocation: emits subnet, scope, and policy per region", () => {
    const out = generateCommands("geolocation", {
      zone: "contoso.com",
      recordName: "www",
      regions: [{ name: "US", subnet: "10.0.0.0/8", ip: "1.2.3.4" }],
    });
    expect(out).toContain('Add-DnsServerClientSubnet -Name "USSubnet" -IPv4Subnet "10.0.0.0/8"');
    expect(out).toContain('Add-DnsServerZoneScope -ZoneName "contoso.com" -Name "USScope"');
    expect(out).toContain('-Name "USPolicy"');
  });

  it("queryfilter: allow-mode uses NE operator", () => {
    const out = generateCommands("queryfilter", {
      filterMode: "allowlist",
      filterCriteria: ["FQDN"],
      filterFqdns: "good.com",
      filterPolicyName: "QF",
    });
    expect(out).toContain('-FQDN "NE,good.com"');
  });

  it("unknown scenario returns empty string", () => {
    expect(generateCommands("nope", {})).toBe("");
  });
});

describe("generateCommands escaping", () => {
  it("escapes double quotes, backticks, and $ in field values", () => {
    const out = generateCommands("geolocation", {
      zone: 'evil"$(calc)"',
      recordName: "www",
      regions: [{ name: "US", subnet: "10.0.0.0/8", ip: "1.2.3.4" }],
    });
    // Raw, dangerous form must NOT appear:
    expect(out).not.toContain('"evil"$(calc)""');
    // Escaped form (backtick before each metachar) must appear:
    expect(out).toContain('evil`"`$(calc)`"');
  });

  it("escapes the serverHostname", () => {
    const out = generateCommands("blocklist", { blocklistDomains: "a.com" }, 'h"$(x)');
    expect(out).toContain('-ComputerName "h`"`$(x)"');
  });

  it("leaves safe alphanumeric input unchanged", () => {
    const out = generateCommands("blocklist", { blocklistDomains: "a.com,b.com", blocklistAction: "IGNORE" });
    expect(out).toContain('-FQDN "EQ,a.com,b.com"');
  });
});
