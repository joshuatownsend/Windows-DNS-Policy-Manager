import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { POLICY_ACTIONS, psEnum, psEscape, psInt } from "./ps-escape";

describe("psEscape", () => {
  it.each([
    ['say "hi"', 'say `"hi`"'],
    ["$(Start-Process calc)", "`$(Start-Process calc)"],
    ["a`b", "a``b"],
    ["\u201Cx\u201D\u201E", "`\u201Cx`\u201D`\u201E"],
    ["plain.contoso.com", "plain.contoso.com"],
  ])("escapes %j", (input, expected) => {
    expect(psEscape(input)).toBe(expected);
  });

  it("turns line breaks into spaces (comment-line injection)", () => {
    expect(psEscape("zone\nRemove-DnsServerZone x\r\n")).toBe("zone Remove-DnsServerZone x ");
    expect(psEscape("a\u2028b")).toBe("a b");
  });

  it("handles non-strings", () => {
    expect(psEscape(undefined)).toBe("");
    expect(psEscape(42)).toBe("42");
  });

  it("leaves single quotes alone (they are literal inside double quotes)", () => {
    expect(psEscape("o'brien")).toBe("o'brien");
  });
});

describe("psEnum", () => {
  it("returns the canonical spelling", () => {
    expect(psEnum("deny", POLICY_ACTIONS, "IGNORE")).toBe("DENY");
  });

  it.each(["ALLOW; Remove-DnsServerZone x", "", undefined, "DROP"])("falls back for %j", (v) => {
    expect(psEnum(v, POLICY_ACTIONS, "IGNORE")).toBe("IGNORE");
  });
});

describe("psInt", () => {
  it.each([
    ["300", 300],
    [12.9, 12],
    ["60); Remove-Item C:\\x; (", 60],
    ["abc", 7],
    [-5, 0],
  ])("converts %j", (v, expected) => {
    expect(psInt(v, 7)).toBe(expected);
  });

  it("clamps to the range", () => {
    expect(psInt("99999", 1, 1, 100)).toBe(100);
  });
});

describe("MCP copy", () => {
  it("is identical to mcp-server/src/lib/ps-escape.ts", () => {
    const here = readFileSync(join(__dirname, "ps-escape.ts"), "utf8").replace(/\r\n/g, "\n");
    const mcp = readFileSync(join(__dirname, "..", "..", "..", "mcp-server", "src", "lib", "ps-escape.ts"), "utf8").replace(/\r\n/g, "\n");
    expect(mcp).toBe(here);
  });
});
