import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as bridge from "../bridge-client.js";

const ServerParamsSchema = {
  server: z.string().optional().describe("DNS server hostname (overrides DNS_DEFAULT_SERVER env var)"),
  serverId: z.string().optional().describe("Server ID for credential lookup"),
  credentialMode: z.enum(["currentUser", "savedCredential"]).optional().describe("Authentication mode"),
};

export function registerZoneTools(server: McpServer) {
  server.tool(
    "dns_list_zones",
    "List all DNS zones on the server (name, type, AD-integrated, signed, reverse lookup)",
    { ...ServerParamsSchema },
    async (params) => ({
      content: [{ type: "text", text: JSON.stringify(await bridge.listZones(params), null, 2) }],
    })
  );

  server.tool(
    "dns_get_zone_details",
    "Get detailed properties of a specific DNS zone (type, replication, dynamic update, aging, notify servers)",
    {
      zoneName: z.string().describe("The zone name (e.g. 'contoso.com')"),
      ...ServerParamsSchema,
    },
    async ({ zoneName, ...params }) => ({
      content: [{ type: "text", text: JSON.stringify(await bridge.getZoneDetails(zoneName, params), null, 2) }],
    })
  );

  server.tool(
    "dns_get_zone_records",
    "Get DNS records in a zone, with optional type and name filters",
    {
      zoneName: z.string().describe("The zone name (e.g. 'contoso.com')"),
      type: z.string().optional().describe("Filter by record type (A, AAAA, CNAME, MX, NS, PTR, SRV, TXT, SOA)"),
      name: z.string().optional().describe("Filter by record hostname"),
      ...ServerParamsSchema,
    },
    async ({ zoneName, type, name, ...params }) => ({
      content: [{
        type: "text",
        text: JSON.stringify(await bridge.getZoneRecords(zoneName, { type, name }, params), null, 2),
      }],
    })
  );

  server.tool(
    "dns_get_zone_aging",
    "Get aging/scavenging settings for a zone (aging enabled, refresh interval, no-refresh interval)",
    {
      zoneName: z.string().describe("The zone name"),
      ...ServerParamsSchema,
    },
    async ({ zoneName, ...params }) => ({
      content: [{ type: "text", text: JSON.stringify(await bridge.getZoneAging(zoneName, params), null, 2) }],
    })
  );

  server.tool(
    "dns_get_zone_delegations",
    "List NS delegations within a zone",
    {
      zoneName: z.string().describe("The zone name"),
      ...ServerParamsSchema,
    },
    async ({ zoneName, ...params }) => ({
      content: [{ type: "text", text: JSON.stringify(await bridge.getZoneDelegations(zoneName, params), null, 2) }],
    })
  );
}
