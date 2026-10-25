import { describe, expect, it } from "vitest";
import { buildCommand, type Criterion } from "./policy-command";
import type { PolicyAction } from "./types";

function build(overrides: Partial<{ name: string; action: string; order: string; zone: string; condition: string; criteria: Criterion[]; host: string }> = {}) {
  return buildCommand(
    "QueryResolution",
    overrides.name ?? "Policy1",
    (overrides.action ?? "DENY") as PolicyAction,
    overrides.order ?? "1",
    true,
    overrides.zone ?? "contoso.com",
    true,
    overrides.condition ?? "AND",
    overrides.criteria ?? [{ type: "Fqdn", operator: "EQ", value: "*.ads.example" }],
    [],
    "",
    overrides.host,
  );
}

describe("buildCommand (issue #147)", () => {
  it("builds the expected command for ordinary input", () => {
    expect(build()).toBe(
      'Add-DnsServerQueryResolutionPolicy -Name "Policy1" -Action DENY -ProcessingOrder 1 -ZoneName "contoso.com" -Fqdn "EQ,*.ads.example"',
    );
  });

  it("escapes quote and subexpression characters in every string", () => {
    const cmd = build({ name: 'x"; Remove-Item C:\\ -Recurse; "', zone: "$(calc)", host: 'h"$x' });
    expect(cmd).toContain('-Name "x`"; Remove-Item C:\\ -Recurse; `""');
    expect(cmd).toContain('-ZoneName "`$(calc)"');
    expect(cmd).toContain('-ComputerName "h`"`$x"');
  });

  it("refuses unquoted injection through action, order, condition and criterion fields", () => {
    const cmd = build({
      action: "DENY; Remove-DnsServerZone x",
      order: "1; Remove-DnsServerZone x",
      condition: "OR; calc",
      criteria: [
        { type: "Fqdn", operator: "EQ", value: "a.example" },
        { type: "ComputerName", operator: "EQ", value: "evil" },
        { type: "QType", operator: "EQ; calc", value: "A" },
      ],
    });
    expect(cmd).not.toContain("Remove-DnsServerZone");
    expect(cmd).not.toContain("calc");
    expect(cmd).not.toContain("-ComputerName");
    expect(cmd).toContain("-Action ALLOW");
    expect(cmd).toContain("-ProcessingOrder 1");
    expect(cmd).toContain('-QType "EQ,A"');
    expect(cmd).toContain("-Condition AND");
  });
});
