# TODO

No high or medium priority items remain. The following are ideas for future consideration:

## Medium Priority

### Server OS Version Detection & Feature Gating
- Query Windows Server version during `Handle-Connect` (e.g., via `[System.Environment]::OSVersion` or `Get-CimInstance Win32_OperatingSystem` on remote servers)
- Store version in `ServerInfo` and display on the Server tab (e.g., "Windows Server 2019 Build 17763")
- Use version info to gate features in the UI — disable/hide panels for unsupported cmdlets (e.g., DoH/DoT requires Server 2025+) with a clear "Requires Server 2025+" message
- Bridge handlers should check version before calling version-gated cmdlets instead of relying on error handling

## Low Priority

### MCP Server: Write Tools (v2)
- Add opt-in write tools gated behind `--allow-writes` CLI flag or `DNS_ALLOW_WRITES=true` env var
- Candidate tools: `dns_add_record`, `dns_remove_record`, `dns_add_policy`, `dns_remove_policy`, `dns_create_subnet`, `dns_clear_cache`
- Each write tool should require explicit confirmation in the tool response before executing

### MCP Server: Streamable HTTP Transport
- Add HTTP transport alongside stdio for remote AI agent access
- Would require the bridge to bind beyond localhost or use a reverse proxy

### OpenAPI Spec Generation
Auto-generate an OpenAPI spec from bridge.ps1's route definitions for documentation and client generation.
