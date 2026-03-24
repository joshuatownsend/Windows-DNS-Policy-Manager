import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as bridge from "../bridge-client.js";

const ServerParamsSchema = {
  server: z.string().optional().describe("DNS server hostname (overrides DNS_DEFAULT_SERVER env var)"),
  serverId: z.string().optional().describe("Server ID for credential lookup"),
  credentialMode: z.enum(["currentUser", "savedCredential"]).optional().describe("Authentication mode"),
};

export function registerServerConfigTools(server: McpServer) {
  server.tool(
    "dns_get_server_settings",
    "Get DNS server configuration (round-robin, bind secondaries, listening IPs, version)",
    { ...ServerParamsSchema },
    async (params) => ({
      content: [{ type: "text", text: JSON.stringify(await bridge.getServerSettings(params), null, 2) }],
    })
  );

  server.tool(
    "dns_get_forwarders",
    "Get DNS forwarder configuration (IP addresses, use root hint, timeout)",
    { ...ServerParamsSchema },
    async (params) => ({
      content: [{ type: "text", text: JSON.stringify(await bridge.getForwarders(params), null, 2) }],
    })
  );

  server.tool(
    "dns_get_cache_settings",
    "Get DNS cache settings (max TTL, max negative TTL, size, pollution protection)",
    { ...ServerParamsSchema },
    async (params) => ({
      content: [{ type: "text", text: JSON.stringify(await bridge.getCacheSettings(params), null, 2) }],
    })
  );

  server.tool(
    "dns_get_recursion_settings",
    "Get DNS recursion configuration (enabled, timeout, retries, secure response)",
    { ...ServerParamsSchema },
    async (params) => ({
      content: [{ type: "text", text: JSON.stringify(await bridge.getRecursionSettings(params), null, 2) }],
    })
  );

  server.tool(
    "dns_get_blocklist",
    "Get DNS query block list (enabled, blocked domain list)",
    { ...ServerParamsSchema },
    async (params) => ({
      content: [{ type: "text", text: JSON.stringify(await bridge.getBlocklist(params), null, 2) }],
    })
  );

  server.tool(
    "dns_get_diagnostics",
    "Get DNS diagnostic/event logging configuration (queries, answers, packets, log file)",
    { ...ServerParamsSchema },
    async (params) => ({
      content: [{ type: "text", text: JSON.stringify(await bridge.getDiagnostics(params), null, 2) }],
    })
  );

  server.tool(
    "dns_get_statistics",
    "Get DNS server query statistics",
    { ...ServerParamsSchema },
    async (params) => ({
      content: [{ type: "text", text: JSON.stringify(await bridge.getStatistics(params), null, 2) }],
    })
  );

  server.tool(
    "dns_get_rrl",
    "Get Response Rate Limiting (RRL) settings (responses/sec, errors/sec, window, prefix lengths)",
    { ...ServerParamsSchema },
    async (params) => ({
      content: [{ type: "text", text: JSON.stringify(await bridge.getRRL(params), null, 2) }],
    })
  );

  server.tool(
    "dns_get_rrl_exceptions",
    "List Response Rate Limiting (RRL) exception rules",
    { ...ServerParamsSchema },
    async (params) => ({
      content: [{ type: "text", text: JSON.stringify(await bridge.getRRLExceptions(params), null, 2) }],
    })
  );

  server.tool(
    "dns_get_scavenging",
    "Get DNS scavenging configuration (state, interval, refresh, no-refresh, last scavenge time)",
    { ...ServerParamsSchema },
    async (params) => ({
      content: [{ type: "text", text: JSON.stringify(await bridge.getScavenging(params), null, 2) }],
    })
  );

  server.tool(
    "dns_get_root_hints",
    "Get root hint servers (may be slow — up to 45s)",
    { ...ServerParamsSchema },
    async (params) => ({
      content: [{ type: "text", text: JSON.stringify(await bridge.getRootHints(params), null, 2) }],
    })
  );

  server.tool(
    "dns_get_edns",
    "Get EDNS (Extension Mechanisms for DNS) settings",
    { ...ServerParamsSchema },
    async (params) => ({
      content: [{ type: "text", text: JSON.stringify(await bridge.getEdns(params), null, 2) }],
    })
  );

  server.tool(
    "dns_get_encryption",
    "Get DNS encryption protocol settings (DoH/DoT — requires Server 2025+)",
    { ...ServerParamsSchema },
    async (params) => ({
      content: [{ type: "text", text: JSON.stringify(await bridge.getEncryption(params), null, 2) }],
    })
  );

  server.tool(
    "dns_get_global_name_zone",
    "Get Global Names Zone (GNZ) configuration",
    { ...ServerParamsSchema },
    async (params) => ({
      content: [{ type: "text", text: JSON.stringify(await bridge.getGlobalNameZone(params), null, 2) }],
    })
  );

  server.tool(
    "dns_export_server_config",
    "Export full DNS server configuration as structured data (may be slow — up to 60s)",
    { ...ServerParamsSchema },
    async (params) => ({
      content: [{ type: "text", text: JSON.stringify(await bridge.exportServerConfig(params), null, 2) }],
    })
  );
}
