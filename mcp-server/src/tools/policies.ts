import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as bridge from "../bridge-client.js";
import { ServerParamsSchema } from "./shared.js";

export function registerPolicyTools(server: McpServer) {
  server.tool(
    "dns_list_policies",
    "List DNS query resolution policies (name, action, processing order, criteria, zone scopes). Optionally filter by zone.",
    {
      zone: z.string().optional().describe("Filter policies by zone name"),
      ...ServerParamsSchema,
    },
    async ({ zone, ...params }) => ({
      content: [{
        type: "text",
        text: JSON.stringify(await bridge.listPolicies({ ...params, zone }), null, 2),
      }],
    })
  );

  server.tool(
    "dns_list_transfer_policies",
    "List DNS zone transfer policies",
    { ...ServerParamsSchema },
    async (params) => ({
      content: [{ type: "text", text: JSON.stringify(await bridge.listTransferPolicies(params), null, 2) }],
    })
  );
}
