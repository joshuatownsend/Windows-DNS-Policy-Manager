import { describe, expect, it } from "vitest";
import { describeBlockedCall, isMutatingCall, isReadOnlyCommand } from "./dry-run";

describe("isMutatingCall", () => {
  it.each([
    ["POST", "/api/policies"],
    ["DELETE", "/api/policies/Block%20ads?server=dns01"],
    ["PUT", "/api/zones/contoso.com/records"],
    ["POST", "/api/zones?server=dns01"],
    ["PUT", "/api/server/forwarders?server=dns01"],
    ["DELETE", "/api/server/cache"],
    ["POST", "/api/dnssec/contoso.com/sign"],
    ["PUT", "/api/doh/config"],
    ["POST", "/api/server/scavenging/start"],
    ["POST", "/api/zones/contoso.com/transfer"],
  ])("blocks %s %s", (method, url) => {
    expect(isMutatingCall(method, url)).toBe(true);
  });

  it.each([
    ["GET", "/api/zones"],
    ["POST", "/api/connect"],
    ["POST", "/api/credentials/store"],
    ["POST", "/api/credentials/session"],
    ["DELETE", "/api/credentials/srv-1"],
    ["POST", "/api/server/test?server=dns01"],
    ["POST", "/api/server/resolvers?serverId=a"],
    ["POST", "/api/server/bpa"],
    ["POST", "/api/backup"],
    ["POST", "/api/export/allzones?server=dns01"],
    ["POST", "/api/zones/contoso.com/export"],
    ["POST", "/api/dnssec/contoso.com/export-key"],
    ["POST", "/api/utilities/dns-lookup"],
  ])("allows %s %s", (method, url) => {
    expect(isMutatingCall(method, url)).toBe(false);
  });

  it("allows read-only PowerShell and blocks the rest", () => {
    expect(isMutatingCall("POST", "/api/execute", { command: "Get-DnsServerZone | Format-Table" })).toBe(false);
    expect(isMutatingCall("POST", "/api/execute", { command: "Remove-DnsServerZone -Name x -Force" })).toBe(true);
    expect(isMutatingCall("POST", "/api/execute", {})).toBe(true);
  });
});

describe("isReadOnlyCommand", () => {
  it.each([
    "Get-DnsServerZone",
    "Get-DnsServerResourceRecord -ZoneName contoso.com | Sort-Object HostName | Select-Object -First 5",
    "Resolve-DnsName example.com",
    "Test-DnsServer -IPAddress 10.0.0.1",
  ])("treats %j as read-only", (cmd) => {
    expect(isReadOnlyCommand(cmd)).toBe(true);
  });

  it.each([
    "Add-DnsServerResourceRecordA -ZoneName x -Name www -IPv4Address 10.0.0.1",
    "Get-DnsServerZone; Remove-DnsServerZone -Name x",
    'Get-DnsServerZone -ZoneName "Block-Ads"',
    "",
    "just text",
  ])("does not treat %j as read-only", (cmd) => {
    expect(isReadOnlyCommand(cmd)).toBe(false);
  });

  it("ignores parameter names that look hyphenated", () => {
    expect(isReadOnlyCommand("Get-DnsServerZone -ZoneName contoso.com -ComputerName dns01")).toBe(true);
  });
});

describe("describeBlockedCall", () => {
  it("drops the query string and summarizes the body", () => {
    expect(describeBlockedCall("put", "/api/server/forwarders?server=dns01", { ipAddress: ["10.0.0.1"] })).toBe(
      '# Dry Run — not sent: PUT /api/server/forwarders {"ipAddress":["10.0.0.1"]}',
    );
  });
});
