import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  bridgePath,
  bridgeToken,
  checkBodyType,
  checkProxyRequest,
  hasValidSession,
  isBridgeToken,
  readBodyCapped,
  sessionCookie,
  sessionValue,
} from "./bridge-proxy";

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

describe("checkBodyType", () => {
  it("rejects a non-JSON body whatever Content-Length said", () => {
    expect(checkBodyType("text/plain", 10)?.status).toBe(415);
    expect(checkBodyType(null, 1)?.status).toBe(415);
  });

  it("accepts JSON and empty bodies", () => {
    expect(checkBodyType("application/json; charset=utf-8", 10)).toBeNull();
    expect(checkBodyType("text/plain", 0)).toBeNull();
  });
});

describe("readBodyCapped", () => {
  function stream(chunks: number[]): ReadableStream<Uint8Array> {
    return new ReadableStream({
      start(c) {
        for (const n of chunks) c.enqueue(new Uint8Array(n));
        c.close();
      },
    });
  }

  it("reads a body under the cap", async () => {
    expect((await readBodyCapped(stream([3, 4]), 10))?.byteLength).toBe(7);
  });

  it("stops past the cap even without Content-Length (chunked)", async () => {
    expect(await readBodyCapped(stream([6, 6]), 10)).toBeNull();
  });

  it("treats a missing body as empty", async () => {
    expect((await readBodyCapped(null))?.byteLength).toBe(0);
  });
});

describe("session cookie", () => {
  it("validates only the derived value for the current token", () => {
    const cookie = `other=1; dpm_session=${sessionValue("tok-A")}`;
    expect(hasValidSession(cookie, "tok-A")).toBe(true);
    expect(hasValidSession(cookie, "tok-B")).toBe(false);
    expect(hasValidSession("dpm_session=tok-A", "tok-A")).toBe(false);
    expect(hasValidSession(null, "tok-A")).toBe(false);
  });

  it("never puts the token itself in the cookie", () => {
    const header = sessionCookie("super-secret-token", false);
    expect(header).not.toContain("super-secret-token");
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Strict");
    expect(header).not.toContain("Secure");
    expect(sessionCookie("t", true)).toContain("Secure");
  });

  it("compares sign-in tokens exactly", () => {
    expect(isBridgeToken("tok-A", "tok-A")).toBe(true);
    expect(isBridgeToken(" tok-A ", "tok-A")).toBe(true);
    expect(isBridgeToken("tok-a", "tok-A")).toBe(false);
    expect(isBridgeToken("", "tok-A")).toBe(false);
  });
});
