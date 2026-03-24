import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as bridge from "../bridge-client.js";

const ServerParamsSchema = {
  server: z.string().optional().describe("DNS server hostname (overrides DNS_DEFAULT_SERVER env var)"),
  serverId: z.string().optional().describe("Server ID for credential lookup"),
  credentialMode: z.enum(["currentUser", "savedCredential"]).optional().describe("Authentication mode"),
};

export function registerSecurityTools(server: McpServer) {
  server.tool(
    "dns_get_dnssec_settings",
    "Get DNSSEC settings for a zone (denial of existence, key master, NSEC3 config)",
    {
      zoneName: z.string().describe("The signed zone name"),
      ...ServerParamsSchema,
    },
    async ({ zoneName, ...params }) => ({
      content: [{ type: "text", text: JSON.stringify(await bridge.getDnssecSettings(zoneName, params), null, 2) }],
    })
  );

  server.tool(
    "dns_get_signing_keys",
    "List DNSSEC signing keys for a zone (key ID, type, algorithm, length, state)",
    {
      zoneName: z.string().describe("The signed zone name"),
      ...ServerParamsSchema,
    },
    async ({ zoneName, ...params }) => ({
      content: [{ type: "text", text: JSON.stringify(await bridge.getSigningKeys(zoneName, params), null, 2) }],
    })
  );

  server.tool(
    "dns_get_trust_anchors",
    "List DNSSEC trust anchors (name, type, state, key tag)",
    { ...ServerParamsSchema },
    async (params) => ({
      content: [{ type: "text", text: JSON.stringify(await bridge.getTrustAnchors(params), null, 2) }],
    })
  );

  server.tool(
    "dns_get_trust_points",
    "List DNSSEC trust points (name, state, refresh times)",
    { ...ServerParamsSchema },
    async (params) => ({
      content: [{ type: "text", text: JSON.stringify(await bridge.getTrustPoints(params), null, 2) }],
    })
  );
}
