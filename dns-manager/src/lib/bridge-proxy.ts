import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Server-side half of the browser → bridge path. The browser calls same-origin `/api/*`;
 * the route handler checks the request with `checkProxyRequest`, adds the bridge token
 * (which never reaches the browser) and forwards to the PowerShell bridge.
 */

const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "[::1]", "::1"];

/** Largest body the proxy will buffer; the bridge itself refuses anything over 1 MB. */
export const MAX_PROXY_BODY_BYTES = 2 * 1024 * 1024;

export function bridgeUrl(): string {
  return (process.env.BRIDGE_URL || "http://127.0.0.1:8650").replace(/\/+$/, "");
}

function allowedHostnames(): string[] {
  const extra = (process.env.ALLOWED_HOSTS || "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return [...LOOPBACK_HOSTS, ...extra];
}

/** Hostname part of a Host header (`example:10010` → `example`, `[::1]:10010` → `[::1]`). */
function hostnameOf(host: string): string {
  const h = host.trim().toLowerCase();
  if (h.startsWith("[")) return h.slice(0, h.indexOf("]") + 1);
  const colon = h.lastIndexOf(":");
  return colon === -1 ? h : h.slice(0, colon);
}

export interface ProxyRejection {
  status: number;
  error: string;
}

/**
 * Decide whether a request may be forwarded with the bridge token attached.
 *  - Host must be loopback or listed in ALLOWED_HOSTS (blocks DNS-rebinding pages).
 *  - A browser-supplied Origin must be this same origin, and Sec-Fetch-Site (when sent)
 *    must be same-origin or none (blocks cross-site form posts and fetches).
 *  - Bodies must be JSON, which forces a CORS preflight for any cross-origin sender.
 */
export function checkProxyRequest(method: string, headers: Headers): ProxyRejection | null {
  const host = headers.get("host");
  if (!host || !allowedHostnames().includes(hostnameOf(host))) {
    return { status: 403, error: "Host not allowed. Add it to ALLOWED_HOSTS to serve the app under this name." };
  }

  const origin = headers.get("origin");
  if (origin) {
    let originHost: string;
    try {
      originHost = new URL(origin).host.toLowerCase();
    } catch {
      return { status: 403, error: "Origin not allowed" };
    }
    if (originHost !== host.trim().toLowerCase()) {
      return { status: 403, error: "Origin not allowed" };
    }
  }

  const fetchSite = headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    return { status: 403, error: "Cross-site request refused" };
  }

  const upper = method.toUpperCase();
  if (upper !== "GET" && upper !== "HEAD") {
    const length = Number(headers.get("content-length") || "0");
    if (length > MAX_PROXY_BODY_BYTES) {
      return { status: 413, error: "Request body too large" };
    }
    const type = headers.get("content-type") || "";
    if (length > 0 && !type.toLowerCase().startsWith("application/json")) {
      return { status: 415, error: "Request body must be application/json" };
    }
  }
  return null;
}

/** Rebuild the bridge path from route segments, re-encoding each one. */
export function bridgePath(segments: string[]): string | null {
  if (segments.some((s) => s === "" || s === "." || s === ".." || s.includes("/") || s.includes("\\"))) {
    return null;
  }
  return "/api/" + segments.map(encodeURIComponent).join("/");
}

export function defaultTokenFile(): string | null {
  if (process.env.BRIDGE_TOKEN_FILE) return process.env.BRIDGE_TOKEN_FILE;
  if (process.env.LOCALAPPDATA) return join(process.env.LOCALAPPDATA, "DNSPolicyManager", "bridge.token");
  return null;
}

let cachedToken: { path: string; mtimeMs: number; token: string } | null = null;

/**
 * The bridge token: BRIDGE_TOKEN, else the file the bridge writes on start (re-read when it
 * changes, since a restarted bridge generates a new token). Null when neither exists.
 */
export function bridgeToken(): string | null {
  const fromEnv = process.env.BRIDGE_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  const file = defaultTokenFile();
  if (!file) return null;
  try {
    // The token file is runtime state outside the app, not a build input: keep it out of tracing.
    const { mtimeMs } = statSync(/*turbopackIgnore: true*/ file);
    if (!cachedToken || cachedToken.path !== file || cachedToken.mtimeMs !== mtimeMs) {
      cachedToken = { path: file, mtimeMs, token: readFileSync(/*turbopackIgnore: true*/ file, "utf8").trim() };
    }
    return cachedToken.token || null;
  } catch {
    return null;
  }
}
