import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bridgePath, bridgeToken, checkProxyRequest } from "./bridge-proxy";

function headers(init: Record<string, string>): Headers {
  return new Headers(init);
}

describe("checkProxyRequest", () => {
  const savedHosts = process.env.ALLOWED_HOSTS;
  afterEach(() => {
    process.env.ALLOWED_HOSTS = savedHosts;
  });

  it.each(["localhost:10010", "127.0.0.1:10010", "[::1]:10010", "LOCALHOST"])("accepts loopback host %s", (host) => {
    expect(checkProxyRequest("GET", headers({ host }))).toBeNull();
  });

  it("rejects an unknown Host (DNS rebinding)", () => {
    expect(checkProxyRequest("GET", headers({ host: "rebind.attacker.example:10010" }))?.status).toBe(403);
  });

  it("accepts hosts listed in ALLOWED_HOSTS", () => {
    process.env.ALLOWED_HOSTS = "dns-admin.contoso.com, other.example";
    expect(checkProxyRequest("GET", headers({ host: "dns-admin.contoso.com:10010" }))).toBeNull();
  });

  it("accepts a same-origin Origin", () => {
    expect(
      checkProxyRequest("POST", headers({ host: "localhost:10010", origin: "http://localhost:10010" })),
    ).toBeNull();
  });

  it.each(["https://evil.example", "http://localhost:3000", "null", "not a url"])("rejects Origin %s", (origin) => {
    expect(checkProxyRequest("POST", headers({ host: "localhost:10010", origin }))?.status).toBe(403);
  });

  it.each(["cross-site", "same-site"])("rejects Sec-Fetch-Site %s", (site) => {
    expect(checkProxyRequest("GET", headers({ host: "localhost:10010", "sec-fetch-site": site }))?.status).toBe(403);
  });

  it.each(["same-origin", "none"])("accepts Sec-Fetch-Site %s", (site) => {
    expect(checkProxyRequest("GET", headers({ host: "localhost:10010", "sec-fetch-site": site }))).toBeNull();
  });

  it("rejects non-JSON bodies", () => {
    const h = headers({ host: "localhost:10010", "content-type": "text/plain", "content-length": "10" });
    expect(checkProxyRequest("POST", h)?.status).toBe(415);
  });

  it("accepts JSON bodies and empty bodies", () => {
    const json = headers({ host: "localhost:10010", "content-type": "application/json; charset=utf-8", "content-length": "10" });
    expect(checkProxyRequest("PUT", json)).toBeNull();
    expect(checkProxyRequest("DELETE", headers({ host: "localhost:10010" }))).toBeNull();
  });

  it("rejects oversized bodies", () => {
    const h = headers({ host: "localhost:10010", "content-type": "application/json", "content-length": String(3 * 1024 * 1024) });
    expect(checkProxyRequest("POST", h)?.status).toBe(413);
  });
});

describe("bridgePath", () => {
  it("re-encodes segments", () => {
    expect(bridgePath(["policies", "Block ads", "state"])).toBe("/api/policies/Block%20ads/state");
  });

  it.each([[[".."]], [["zones", "."]], [["a/b"]], [["a\\b"]], [[""]]])("rejects %j", (segments) => {
    expect(bridgePath(segments)).toBeNull();
  });
});

describe("bridgeToken", () => {
  let dir: string;
  const saved = { token: process.env.BRIDGE_TOKEN, file: process.env.BRIDGE_TOKEN_FILE };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "dpm-token-"));
    delete process.env.BRIDGE_TOKEN;
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    process.env.BRIDGE_TOKEN = saved.token;
    process.env.BRIDGE_TOKEN_FILE = saved.file;
  });

  it("prefers BRIDGE_TOKEN", () => {
    process.env.BRIDGE_TOKEN = "  from-env  ";
    expect(bridgeToken()).toBe("from-env");
  });

  it("reads the token file and picks up a rotated token", () => {
    const file = join(dir, "bridge.token");
    process.env.BRIDGE_TOKEN_FILE = file;
    writeFileSync(file, "first\n");
    utimesSync(file, new Date(1_000_000), new Date(1_000_000));
    expect(bridgeToken()).toBe("first");
    writeFileSync(file, "second");
    utimesSync(file, new Date(2_000_000), new Date(2_000_000));
    expect(bridgeToken()).toBe("second");
  });

  it("returns null when there is no token anywhere", () => {
    process.env.BRIDGE_TOKEN_FILE = join(dir, "missing.token");
    expect(bridgeToken()).toBeNull();
  });
});
