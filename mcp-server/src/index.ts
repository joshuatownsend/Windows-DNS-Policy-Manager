#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as bridge from "./bridge-client.js";
import { registerZoneTools } from "./tools/zones.js";
import { registerPolicyTools } from "./tools/policies.js";
import { registerServerConfigTools } from "./tools/server-config.js";
import { registerObjectTools } from "./tools/objects.js";
import { registerSecurityTools } from "./tools/security.js";
import { registerCommandGenTools } from "./tools/command-gen.js";

const server = new McpServer({
  name: "dns-policy-manager",
  version: "1.0.0",
});

// ── Health check tool ────────────────────────────────────
server.tool(
  "dns_check_health",
  "Check if the PowerShell bridge is running and reachable",
  {},
  async () => ({
    content: [{ type: "text", text: JSON.stringify(await bridge.health(), null, 2) }],
  })
);

// ── Register all tool groups ─────────────────────────────
registerZoneTools(server);
registerPolicyTools(server);
registerServerConfigTools(server);
registerObjectTools(server);
registerSecurityTools(server);
registerCommandGenTools(server);

// ── Start stdio transport ────────────────────────────────
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Log to stderr so it doesn't interfere with stdio protocol
  console.error("DNS Policy Manager MCP server running on stdio");
  console.error(`Bridge URL: ${process.env.BRIDGE_URL || "http://127.0.0.1:8650"}`);
  console.error(`Default server: ${process.env.DNS_DEFAULT_SERVER || "(not set)"}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
