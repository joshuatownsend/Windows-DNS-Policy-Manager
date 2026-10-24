import { describe, expect, it } from "vitest";
import { parseBackupFile, toCreatePolicyBody } from "./backup-import";
import { MAX_IMPORT_ENTRIES } from "./import-limits";

function parse(obj: unknown) {
  const r = parseBackupFile(JSON.stringify(obj));
  if (!r.ok) throw new Error(r.error);
  return r.backup;
}

describe("parseBackupFile", () => {
  it("reads a bridge export (PascalCase, backupDate)", () => {
    const b = parse({
      backupDate: "2026-10-24T10:00:00Z",
      server: "dns01",
      policies: [
        { Name: "BlockAds", Action: "DENY", ProcessingOrder: 2, IsEnabled: true, Condition: "AND", Level: "Zone", ZoneName: "contoso.com" },
      ],
    });
    expect(b.exportDate).toBe("2026-10-24T10:00:00Z");
    expect(b.policies).toEqual([
      { name: "BlockAds", action: "DENY", processingOrder: 2, zoneName: "contoso.com", condition: "AND" },
    ]);
  });

  it("drops hidden per-policy target fields", () => {
    const b = parse({
      server: "benign",
      policies: [
        { Name: "P1", Action: "ALLOW", server: "evil-host", serverId: "srv-other", credentialMode: "savedCredential", ComputerName: "x" },
      ],
    });
    expect(Object.keys(b.policies[0]).sort()).toEqual(["action", "name"]);
  });

  it("skips entries without a valid name or action", () => {
    const b = parse({ policies: [{ Name: "ok", Action: "IGNORE" }, { Name: "bad", Action: "RUN" }, { Action: "DENY" }, "x", null] });
    expect(b.policies.map((p) => p.name)).toEqual(["ok"]);
    expect(b.skipped).toBe(4);
  });

  it("caps the number of entries", () => {
    const policies = Array.from({ length: MAX_IMPORT_ENTRIES + 5 }, (_, i) => ({ Name: `p${i}`, Action: "DENY" }));
    const b = parse({ policies });
    expect(b.policies).toHaveLength(MAX_IMPORT_ENTRIES);
    expect(b.truncated).toBe(true);
  });

  it.each([
    ["not json", "{"],
    ["an array", "[]"],
    ["no policy lists", "{}"],
    ["a non-array list", '{"policies":{"Name":"x"}}'],
  ])("rejects %s", (_label, text) => {
    expect(parseBackupFile(text).ok).toBe(false);
  });
});

describe("toCreatePolicyBody", () => {
  it("targets the given server", () => {
    expect(
      toCreatePolicyBody({ name: "P", action: "DENY" }, { server: "dns02", serverId: "srv-2", credentialMode: "currentUser" }),
    ).toEqual({ name: "P", action: "DENY", server: "dns02", serverId: "srv-2", credentialMode: "currentUser" });
  });
});
