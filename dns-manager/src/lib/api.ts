import type {
  ApiResponse,
  HealthResponse,
  CredentialMode,
} from "./types";

const REQUEST_TIMEOUT = 15000;

async function request<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
  timeout?: number
): Promise<ApiResponse<T> & Record<string, unknown>> {
  const opts: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" },
  };

  if (body && (method === "POST" || method === "PUT" || method === "DELETE")) {
    opts.body = JSON.stringify(body);
  }

  const controller = new AbortController();
  opts.signal = controller.signal;
  const timeoutId = setTimeout(() => controller.abort(), timeout || REQUEST_TIMEOUT);

  try {
    const res = await fetch(path, opts);
    clearTimeout(timeoutId);
    try {
      return await res.json();
    } catch {
      return {
        success: false,
        error: `Bridge returned non-JSON response (HTTP ${res.status})`,
      };
    }
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Bridge unreachable",
      bridgeDown: true,
    };
  }
}

function qs(params: Record<string, string | undefined | null>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== "") parts.push(`${k}=${encodeURIComponent(v)}`);
  }
  return parts.length ? "?" + parts.join("&") : "";
}

// Helper for server/credential params used in most endpoints
function serverParams(
  server?: string,
  serverId?: string,
  credentialMode?: string
) {
  return qs({ server, serverId, credentialMode });
}

// ── API Methods ───────────────────────────────────────────

export const api = {
  // Health
  health: () => request<HealthResponse>("GET", "/api/health"),

  // Connection
  connect: (server: string, connectionType = "local") =>
    request("POST", "/api/connect", { server, connectionType }),

  connectServer: (serverObj: {
    hostname: string;
    id: string;
    credentialMode: string;
  }) =>
    request("POST", "/api/connect", {
      server: serverObj.hostname,
      serverId: serverObj.id,
      credentialMode: serverObj.credentialMode,
    }),

  // Zones
  listZones: (server?: string) =>
    request("GET", "/api/zones" + qs({ server })),

  getZoneDetails: (
    zoneName: string,
    server?: string,
    serverId?: string,
    credentialMode?: string
  ) =>
    request(
      "GET",
      `/api/zones/${encodeURIComponent(zoneName)}${serverParams(server, serverId, credentialMode)}`
    ),

  getZoneRecords: (
    zoneName: string,
    server?: string,
    serverId?: string,
    credentialMode?: string,
    type?: string,
    name?: string
  ) =>
    request(
      "GET",
      `/api/zones/${encodeURIComponent(zoneName)}/records${qs({ server, serverId, credentialMode, type, name })}`
    ),

  addZoneRecord: (zoneName: string, data: Record<string, unknown>) =>
    request(
      "POST",
      `/api/zones/${encodeURIComponent(zoneName)}/records`,
      { ...data, zoneName }
    ),

  removeZoneRecord: (zoneName: string, data: Record<string, unknown>) =>
    request(
      "DELETE",
      `/api/zones/${encodeURIComponent(zoneName)}/records`,
      data
    ),

  updateZoneRecord: (zoneName: string, data: Record<string, unknown>) =>
    request(
      "PUT",
      `/api/zones/${encodeURIComponent(zoneName)}/records`,
      data
    ),

  setZoneSettings: (zoneName: string, data: Record<string, unknown>) =>
    request(
      "PUT",
      `/api/zones/${encodeURIComponent(zoneName)}/settings`,
      data
    ),

  // Policies
  listPolicies: (server?: string, zone?: string) =>
    request("GET", "/api/policies" + qs({ server, zone })),

  addPolicy: (policy: Record<string, unknown>) =>
    request("POST", "/api/policies", policy),

  removePolicy: (
    name: string,
    server?: string,
    zone?: string
  ) =>
    request(
      "DELETE",
      `/api/policies/${encodeURIComponent(name)}${qs({ server, zone })}`
    ),

  setPolicyState: (
    name: string,
    isEnabled: boolean,
    server?: string,
    zone?: string,
    policyType?: string,
    processingOrder?: number
  ) =>
    request(
      "PUT",
      `/api/policies/${encodeURIComponent(name)}/state${qs({ server, zone, type: policyType })}`,
      { isEnabled, ...(processingOrder != null ? { processingOrder } : {}) }
    ),

  addPolicyMulti: (
    policy: Record<string, unknown>,
    servers: Array<{ hostname: string; id: string; credentialMode: string }>
  ) => request("POST", "/api/policies/multi", { policy, servers }),

  copyPolicies: (
    sourceServer: string,
    targetServers: Array<{
      hostname: string;
      id: string;
      credentialMode: string;
    }>,
    zone?: string,
    sourceServerId?: string,
    sourceCredentialMode?: CredentialMode,
    policyType?: "QueryResolution" | "ZoneTransfer"
  ) =>
    request("POST", "/api/policies/copy", {
      sourceServer,
      targetServers,
      zone: zone || null,
      sourceServerId: sourceServerId || null,
      sourceCredentialMode: sourceCredentialMode || "currentUser",
      policyType: policyType || "QueryResolution",
    }),

  // Zone Transfer Policies
  listZoneTransferPolicies: (
    server?: string,
    zone?: string,
    serverId?: string,
    credentialMode?: string
  ) =>
    request(
      "GET",
      "/api/transferpolicies" + qs({ server, zone, serverId, credentialMode })
    ),

  addZoneTransferPolicy: (policy: Record<string, unknown>) =>
    request("POST", "/api/transferpolicies", policy),

  removeZoneTransferPolicy: (
    name: string,
    server?: string,
    zone?: string,
    serverId?: string,
    credentialMode?: string
  ) =>
    request(
      "DELETE",
      `/api/transferpolicies/${encodeURIComponent(name)}${qs({ server, zone, serverId, credentialMode })}`
    ),

  // Credentials
  storeCredential: (serverId: string, username: string, password: string) =>
    request("POST", "/api/credentials/store", {
      serverId,
      username,
      password,
    }),

  checkCredential: (serverId: string) =>
    request(
      "GET",
      `/api/credentials/check?serverId=${encodeURIComponent(serverId)}`
    ),

  deleteCredential: (serverId: string) =>
    request(
      "DELETE",
      `/api/credentials/${encodeURIComponent(serverId)}`
    ),

  storeSessionCredential: (
    serverId: string,
    username: string,
    password: string
  ) =>
    request("POST", "/api/credentials/session", {
      serverId,
      username,
      password,
    }),

  // Client Subnets
  listSubnets: (server?: string, serverId?: string, credentialMode?: string) =>
    request("GET", "/api/subnets" + serverParams(server, serverId, credentialMode)),

  createSubnet: (data: Record<string, unknown>) =>
    request("POST", "/api/subnets", data),

  deleteSubnet: (
    name: string,
    server?: string,
    serverId?: string,
    credentialMode?: string
  ) =>
    request(
      "DELETE",
      `/api/subnets/${encodeURIComponent(name)}${serverParams(server, serverId, credentialMode)}`
    ),

  // Zone Scopes
  listZoneScopes: (
    zone?: string,
    server?: string,
    serverId?: string,
    credentialMode?: string
  ) =>
    request(
      "GET",
      "/api/zonescopes" + qs({ zone, server, serverId, credentialMode })
    ),

  createZoneScope: (data: Record<string, unknown>) =>
    request("POST", "/api/zonescopes", data),

  deleteZoneScope: (
    name: string,
    zone?: string,
    server?: string,
    serverId?: string,
    credentialMode?: string
  ) =>
    request(
      "DELETE",
      `/api/zonescopes/${encodeURIComponent(name)}${qs({ zone, server, serverId, credentialMode })}`
    ),

  addZoneScopeRecord: (data: Record<string, unknown>) =>
    request("POST", "/api/zonescopes/records", data),

  // Recursion Scopes
  listRecursionScopes: (
    server?: string,
    serverId?: string,
    credentialMode?: string
  ) =>
    request(
      "GET",
      "/api/recursionscopes" + serverParams(server, serverId, credentialMode)
    ),

  createRecursionScope: (data: Record<string, unknown>) =>
    request("POST", "/api/recursionscopes", data),

  setRecursionScope: (name: string, data: Record<string, unknown>) =>
    request(
      "PUT",
      `/api/recursionscopes/${encodeURIComponent(name)}`,
      data
    ),

  deleteRecursionScope: (
    name: string,
    server?: string,
    serverId?: string,
    credentialMode?: string
  ) =>
    request(
      "DELETE",
      `/api/recursionscopes/${encodeURIComponent(name)}${serverParams(server, serverId, credentialMode)}`
    ),

  // Zone Lifecycle
  createZone: (data: Record<string, unknown>) =>
    request("POST", "/api/zones", data),

  removeZone: (zoneName: string, server?: string, serverId?: string, credentialMode?: string) =>
    request("DELETE", `/api/zones/${encodeURIComponent(zoneName)}${serverParams(server, serverId, credentialMode)}`),

  convertZone: (zoneName: string, data: Record<string, unknown>, server?: string, serverId?: string, credentialMode?: string) =>
    request("POST", `/api/zones/${encodeURIComponent(zoneName)}/convert${serverParams(server, serverId, credentialMode)}`, data),

  startZoneTransfer: (zoneName: string, server?: string, serverId?: string, credentialMode?: string) =>
    request("POST", `/api/zones/${encodeURIComponent(zoneName)}/transfer${serverParams(server, serverId, credentialMode)}`),

  suspendZone: (zoneName: string, server?: string, serverId?: string, credentialMode?: string) =>
    request("POST", `/api/zones/${encodeURIComponent(zoneName)}/suspend${serverParams(server, serverId, credentialMode)}`),

  resumeZone: (zoneName: string, server?: string, serverId?: string, credentialMode?: string) =>
    request("POST", `/api/zones/${encodeURIComponent(zoneName)}/resume${serverParams(server, serverId, credentialMode)}`),

  exportZone: (zoneName: string, fileName?: string, server?: string, serverId?: string, credentialMode?: string) =>
    request("POST", `/api/zones/${encodeURIComponent(zoneName)}/export${serverParams(server, serverId, credentialMode)}`, { fileName }),

  getZoneAging: (zoneName: string, server?: string, serverId?: string, credentialMode?: string) =>
    request("GET", `/api/zones/${encodeURIComponent(zoneName)}/aging${serverParams(server, serverId, credentialMode)}`),

  setZoneAging: (zoneName: string, data: Record<string, unknown>, server?: string, serverId?: string, credentialMode?: string) =>
    request("PUT", `/api/zones/${encodeURIComponent(zoneName)}/aging${serverParams(server, serverId, credentialMode)}`, data),

  // Server Configuration
  getServerSettings: (server?: string, serverId?: string, credentialMode?: string) =>
    request("GET", "/api/server/settings" + serverParams(server, serverId, credentialMode)),

  setServerSettings: (data: Record<string, unknown>, server?: string, serverId?: string, credentialMode?: string) =>
    request("PUT", "/api/server/settings" + serverParams(server, serverId, credentialMode), data),

  getResolvers: (server?: string, serverId?: string, credentialMode?: string) =>
    request("GET", "/api/server/resolvers" + serverParams(server, serverId, credentialMode), undefined, 45000),

  getForwarders: (server?: string, serverId?: string, credentialMode?: string) =>
    request("GET", "/api/server/forwarders" + serverParams(server, serverId, credentialMode)),

  addForwarder: (ipAddress: string, server?: string, serverId?: string, credentialMode?: string) =>
    request("POST", "/api/server/forwarders" + serverParams(server, serverId, credentialMode), { ipAddress }),

  removeForwarder: (ipAddress: string, server?: string, serverId?: string, credentialMode?: string) =>
    request("DELETE", "/api/server/forwarders" + serverParams(server, serverId, credentialMode), { ipAddress }),

  setForwarders: (data: Record<string, unknown>, server?: string, serverId?: string, credentialMode?: string) =>
    request("PUT", "/api/server/forwarders" + serverParams(server, serverId, credentialMode), data),

  getCache: (server?: string, serverId?: string, credentialMode?: string) =>
    request("GET", "/api/server/cache" + serverParams(server, serverId, credentialMode)),

  clearCache: (server?: string, serverId?: string, credentialMode?: string) =>
    request("DELETE", "/api/server/cache" + serverParams(server, serverId, credentialMode)),

  getRecursionSettings: (server?: string, serverId?: string, credentialMode?: string) =>
    request("GET", "/api/server/recursion" + serverParams(server, serverId, credentialMode)),

  setRecursionSettings: (data: Record<string, unknown>, server?: string, serverId?: string, credentialMode?: string) =>
    request("PUT", "/api/server/recursion" + serverParams(server, serverId, credentialMode), data),

  getBlockList: (server?: string, serverId?: string, credentialMode?: string) =>
    request("GET", "/api/server/blocklist" + serverParams(server, serverId, credentialMode)),

  setBlockList: (data: Record<string, unknown>, server?: string, serverId?: string, credentialMode?: string) =>
    request("PUT", "/api/server/blocklist" + serverParams(server, serverId, credentialMode), data),

  getDiagnostics: (server?: string, serverId?: string, credentialMode?: string) =>
    request("GET", "/api/server/diagnostics" + serverParams(server, serverId, credentialMode)),

  setDiagnostics: (data: Record<string, unknown>, server?: string, serverId?: string, credentialMode?: string) =>
    request("PUT", "/api/server/diagnostics" + serverParams(server, serverId, credentialMode), data),

  getStatistics: (server?: string, serverId?: string, credentialMode?: string) =>
    request("GET", "/api/server/statistics" + serverParams(server, serverId, credentialMode)),

  clearStatistics: (server?: string, serverId?: string, credentialMode?: string) =>
    request("DELETE", "/api/server/statistics" + serverParams(server, serverId, credentialMode)),

  // RRL
  getRRL: (server?: string, serverId?: string, credentialMode?: string) =>
    request("GET", "/api/server/rrl" + serverParams(server, serverId, credentialMode)),

  setRRL: (data: Record<string, unknown>, server?: string, serverId?: string, credentialMode?: string) =>
    request("PUT", "/api/server/rrl" + serverParams(server, serverId, credentialMode), data),

  getRRLExceptions: (server?: string, serverId?: string, credentialMode?: string) =>
    request("GET", "/api/server/rrl/exceptions" + serverParams(server, serverId, credentialMode)),

  addRRLException: (data: Record<string, unknown>, server?: string, serverId?: string, credentialMode?: string) =>
    request("POST", "/api/server/rrl/exceptions" + serverParams(server, serverId, credentialMode), data),

  removeRRLException: (name: string, server?: string, serverId?: string, credentialMode?: string) =>
    request("DELETE", `/api/server/rrl/exceptions/${encodeURIComponent(name)}${serverParams(server, serverId, credentialMode)}`),

  // Scavenging
  getScavenging: (server?: string, serverId?: string, credentialMode?: string) =>
    request("GET", "/api/server/scavenging" + serverParams(server, serverId, credentialMode)),

  setScavenging: (data: Record<string, unknown>, server?: string, serverId?: string, credentialMode?: string) =>
    request("PUT", "/api/server/scavenging" + serverParams(server, serverId, credentialMode), data),

  startScavenging: (server?: string, serverId?: string, credentialMode?: string) =>
    request("POST", "/api/server/scavenging/start" + serverParams(server, serverId, credentialMode)),

  // Test
  testDnsServer: (server?: string, serverId?: string, credentialMode?: string) =>
    request("POST", "/api/server/test" + serverParams(server, serverId, credentialMode)),

  // DNSSEC
  getDnssecSettings: (zoneName: string, server?: string, serverId?: string, credentialMode?: string) =>
    request("GET", `/api/dnssec/${encodeURIComponent(zoneName)}${serverParams(server, serverId, credentialMode)}`),

  setDnssecSettings: (zoneName: string, data: Record<string, unknown>, server?: string, serverId?: string, credentialMode?: string) =>
    request("PUT", `/api/dnssec/${encodeURIComponent(zoneName)}${serverParams(server, serverId, credentialMode)}`, data),

  getSigningKeys: (zoneName: string, server?: string, serverId?: string, credentialMode?: string) =>
    request("GET", `/api/dnssec/${encodeURIComponent(zoneName)}/keys${serverParams(server, serverId, credentialMode)}`),

  addSigningKey: (zoneName: string, data: Record<string, unknown>, server?: string, serverId?: string, credentialMode?: string) =>
    request("POST", `/api/dnssec/${encodeURIComponent(zoneName)}/keys${serverParams(server, serverId, credentialMode)}`, data),

  removeSigningKey: (zoneName: string, keyId: string, server?: string, serverId?: string, credentialMode?: string) =>
    request("DELETE", `/api/dnssec/${encodeURIComponent(zoneName)}/keys/${encodeURIComponent(keyId)}${serverParams(server, serverId, credentialMode)}`),

  signZone: (zoneName: string, server?: string, serverId?: string, credentialMode?: string) =>
    request("POST", `/api/dnssec/${encodeURIComponent(zoneName)}/sign${serverParams(server, serverId, credentialMode)}`),

  unsignZone: (zoneName: string, server?: string, serverId?: string, credentialMode?: string) =>
    request("POST", `/api/dnssec/${encodeURIComponent(zoneName)}/unsign${serverParams(server, serverId, credentialMode)}`),

  exportDnssecKey: (zoneName: string, server?: string, serverId?: string, credentialMode?: string) =>
    request("POST", `/api/dnssec/${encodeURIComponent(zoneName)}/export-key${serverParams(server, serverId, credentialMode)}`),

  getTrustAnchors: (server?: string, serverId?: string, credentialMode?: string) =>
    request("GET", "/api/trustanchors" + serverParams(server, serverId, credentialMode)),

  addTrustAnchor: (data: Record<string, unknown>, server?: string, serverId?: string, credentialMode?: string) =>
    request("POST", "/api/trustanchors" + serverParams(server, serverId, credentialMode), data),

  removeTrustAnchor: (name: string, server?: string, serverId?: string, credentialMode?: string) =>
    request("DELETE", `/api/trustanchors/${encodeURIComponent(name)}${serverParams(server, serverId, credentialMode)}`),

  getTrustPoints: (server?: string, serverId?: string, credentialMode?: string) =>
    request("GET", "/api/trustpoints" + serverParams(server, serverId, credentialMode)),

  updateTrustPoint: (name: string, server?: string, serverId?: string, credentialMode?: string) =>
    request("POST", `/api/trustpoints/${encodeURIComponent(name)}/update${serverParams(server, serverId, credentialMode)}`),

  // Niche: Root Hints, EDNS, DS Settings, Global Name Zone, Zone Delegations
  getRootHints: (server?: string, serverId?: string, credentialMode?: string) =>
    request("GET", "/api/server/roothints" + serverParams(server, serverId, credentialMode)),

  getEDns: (server?: string, serverId?: string, credentialMode?: string) =>
    request("GET", "/api/server/edns" + serverParams(server, serverId, credentialMode)),

  setEDns: (data: Record<string, unknown>, server?: string, serverId?: string, credentialMode?: string) =>
    request("PUT", "/api/server/edns" + serverParams(server, serverId, credentialMode), data),

  getDsSetting: (server?: string, serverId?: string, credentialMode?: string) =>
    request("GET", "/api/server/dssetting" + serverParams(server, serverId, credentialMode)),

  getGlobalNameZone: (server?: string, serverId?: string, credentialMode?: string) =>
    request("GET", "/api/server/globalnamezone" + serverParams(server, serverId, credentialMode)),

  setGlobalNameZone: (data: Record<string, unknown>, server?: string, serverId?: string, credentialMode?: string) =>
    request("PUT", "/api/server/globalnamezone" + serverParams(server, serverId, credentialMode), data),

  getZoneDelegations: (zoneName: string, server?: string, serverId?: string, credentialMode?: string) =>
    request("GET", `/api/zones/${encodeURIComponent(zoneName)}/delegations${serverParams(server, serverId, credentialMode)}`),

  // BPA
  runBpa: (server?: string, serverId?: string, credentialMode?: string) =>
    request("POST", "/api/server/bpa" + serverParams(server, serverId, credentialMode), undefined, 180000),

  // Encryption Protocol (DoH/DoT — Server 2025+)
  getEncryptionProtocol: (server?: string, serverId?: string, credentialMode?: string) =>
    request("GET", "/api/server/encryption" + serverParams(server, serverId, credentialMode)),

  setEncryptionProtocol: (data: Record<string, unknown>, server?: string, serverId?: string, credentialMode?: string) =>
    request("PUT", "/api/server/encryption" + serverParams(server, serverId, credentialMode), data),

  // Backup
  backup: (server: string, includeZone = true, includeServer = true) =>
    request("POST", "/api/backup", {
      server: server || "localhost",
      includeZone,
      includeServer,
    }),

  // Execute
  execute: (command: string) =>
    request("POST", "/api/execute", { command }),
};
