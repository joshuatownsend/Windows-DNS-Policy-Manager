import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as bridge from "../bridge-client.js";
import { ServerParamsSchema } from "./shared.js";

export function registerObjectTools(server: McpServer) {
  server.tool(
    "dns_list_subnets",
    "List DNS client subnet objects (name, IPv4 and IPv6 subnets) used in policy criteria",
    { ...ServerParamsSchema },
    async (params) => ({
      content: [{ type: "text", text: JSON.stringify(await bridge.listSubnets(params), null, 2) }],
    })
  );

  server.tool(
    "dns_list_zone_scopes",
    "List zone scopes for a zone (used for split-brain DNS, geo-location routing, load balancing)",
    {
      zoneName: z.string().describe("The zone name to list scopes for"),
      ...ServerParamsSchema,
    },
    async ({ zoneName, ...params }) => ({
      content: [{ type: "text", text: JSON.stringify(await bridge.listZoneScopes(zoneName, params), null, 2) }],
    })
  );

  server.tool(
    "dns_list_recursion_scopes",
    "List recursion scopes (control recursive DNS resolution behavior per client subnet)",
    { ...ServerParamsSchema },
    async (params) => ({
      content: [{ type: "text", text: JSON.stringify(await bridge.listRecursionScopes(params), null, 2) }],
    })
  );
}
