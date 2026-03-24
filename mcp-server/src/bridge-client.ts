/**
 * HTTP client for the PowerShell bridge REST API.
 * All methods return the parsed JSON response body.
 */

const BRIDGE_URL = process.env.BRIDGE_URL || "http://127.0.0.1:8650";
const DEFAULT_SERVER = process.env.DNS_DEFAULT_SERVER || "";
const DEFAULT_SERVER_ID = process.env.DNS_SERVER_ID || "";
const DEFAULT_CREDENTIAL_MODE = process.env.DNS_CREDENTIAL_MODE || "currentUser";
const DEFAULT_TIMEOUT = 30_000;
const LONG_TIMEOUT = 60_000;

export interface ServerParams {
  server?: string;
  serverId?: string;
  credentialMode?: string;
  [key: string]: string | undefined;
}

function buildQuery(params: Record<string, string | undefined>): string {
  const qs = new URLSearchParams();
  const server = params.server || DEFAULT_SERVER;
  const serverId = params.serverId || DEFAULT_SERVER_ID;
  const credentialMode = params.credentialMode || DEFAULT_CREDENTIAL_MODE;

  if (server) qs.set("server", server);
  if (serverId) qs.set("serverId", serverId);
  if (credentialMode) qs.set("credentialMode", credentialMode);

  // Add any extra params
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && !["server", "serverId", "credentialMode"].includes(k)) {
      qs.set(k, v);
    }
  }

  const str = qs.toString();
  return str ? `?${str}` : "";
}

async function request(
  path: string,
  params: Record<string, string | undefined> = {},
  timeout = DEFAULT_TIMEOUT
): Promise<unknown> {
  const url = `${BRIDGE_URL}${path}${buildQuery(params)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      let detail: string;
      try {
        detail = await res.text();
      } catch {
        detail = res.statusText;
      }
      return { success: false, error: `Bridge returned ${res.status}: ${detail}` };
    }
    try {
      return await res.json();
    } catch {
      const text = await res.text();
      return { success: false, error: `Bridge returned non-JSON response: ${text.slice(0, 200)}` };
    }
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") {
      return { success: false, error: `Request timed out after ${timeout}ms` };
    }
    return {
      success: false,
      error: `Bridge unreachable at ${BRIDGE_URL}: ${err instanceof Error ? err.message : String(err)}`,
      bridgeDown: true,
    };
  } finally {
    clearTimeout(timer);
  }
}

// ── Health ───────────────────────────────────────────────
export const health = () => request("/api/health");

// ── Zones ────────────────────────────────────────────────
export const listZones = (p: ServerParams = {}) =>
  request("/api/zones", p);

export const getZoneDetails = (zoneName: string, p: ServerParams = {}) =>
  request(`/api/zones/${encodeURIComponent(zoneName)}`, p);

export const getZoneRecords = (
  zoneName: string,
  filters: { type?: string; name?: string } = {},
  p: ServerParams = {}
) =>
  request(`/api/zones/${encodeURIComponent(zoneName)}/records`, {
    ...p,
    ...(filters.type ? { type: filters.type } : {}),
    ...(filters.name ? { name: filters.name } : {}),
  });

export const getZoneAging = (zoneName: string, p: ServerParams = {}) =>
  request(`/api/zones/${encodeURIComponent(zoneName)}/aging`, p);

export const getZoneDelegations = (zoneName: string, p: ServerParams = {}) =>
  request(`/api/zones/${encodeURIComponent(zoneName)}/delegations`, p);

// ── Policies ─────────────────────────────────────────────
export const listPolicies = (p: ServerParams & { zone?: string } = {}) =>
  request("/api/policies", p);

export const listTransferPolicies = (p: ServerParams = {}) =>
  request("/api/transferpolicies", p);

// ── DNS Objects ──────────────────────────────────────────
export const listSubnets = (p: ServerParams = {}) =>
  request("/api/subnets", p);

export const listZoneScopes = (zoneName: string, p: ServerParams = {}) =>
  request("/api/zonescopes", { ...p, zone: zoneName });

export const listRecursionScopes = (p: ServerParams = {}) =>
  request("/api/recursionscopes", p);

// ── Server Configuration ─────────────────────────────────
export const getServerSettings = (p: ServerParams = {}) =>
  request("/api/server/settings", p);

export const getForwarders = (p: ServerParams = {}) =>
  request("/api/server/forwarders", p);

export const getCacheSettings = (p: ServerParams = {}) =>
  request("/api/server/cache", p);

export const getRecursionSettings = (p: ServerParams = {}) =>
  request("/api/server/recursion", p);

export const getBlocklist = (p: ServerParams = {}) =>
  request("/api/server/blocklist", p);

export const getDiagnostics = (p: ServerParams = {}) =>
  request("/api/server/diagnostics", p);

export const getStatistics = (p: ServerParams = {}) =>
  request("/api/server/statistics", p);

// ── RRL & Scavenging ─────────────────────────────────────
export const getRRL = (p: ServerParams = {}) =>
  request("/api/server/rrl", p);

export const getRRLExceptions = (p: ServerParams = {}) =>
  request("/api/server/rrl/exceptions", p);

export const getScavenging = (p: ServerParams = {}) =>
  request("/api/server/scavenging", p);

// ── DNSSEC ───────────────────────────────────────────────
export const getDnssecSettings = (zoneName: string, p: ServerParams = {}) =>
  request(`/api/dnssec/${encodeURIComponent(zoneName)}`, p);

export const getSigningKeys = (zoneName: string, p: ServerParams = {}) =>
  request(`/api/dnssec/${encodeURIComponent(zoneName)}/keys`, p);

export const getTrustAnchors = (p: ServerParams = {}) =>
  request("/api/trustanchors", p);

export const getTrustPoints = (p: ServerParams = {}) =>
  request("/api/trustpoints", p);

// ── Infrastructure ───────────────────────────────────────
export const getRootHints = (p: ServerParams = {}) =>
  request("/api/server/roothints", p, LONG_TIMEOUT);

export const getEdns = (p: ServerParams = {}) =>
  request("/api/server/edns", p);

export const getEncryption = (p: ServerParams = {}) =>
  request("/api/server/encryption", p);

export const getGlobalNameZone = (p: ServerParams = {}) =>
  request("/api/server/globalnamezone", p);

export const exportServerConfig = (p: ServerParams = {}) =>
  request("/api/export/serverconfig", p, LONG_TIMEOUT);
