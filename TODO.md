# TODO

No high or medium priority items remain. The following are ideas for future consideration:

## Medium Priority

### Server OS Version Detection & Feature Gating
- Query Windows Server version during `Handle-Connect` (e.g., via `[System.Environment]::OSVersion` or `Get-CimInstance Win32_OperatingSystem` on remote servers)
- Store version in `ServerInfo` and display on the Server tab (e.g., "Windows Server 2019 Build 17763")
- Use version info to gate features in the UI — disable/hide panels for unsupported cmdlets (e.g., DoH/DoT requires Server 2025+) with a clear "Requires Server 2025+" message
- Bridge handlers should check version before calling version-gated cmdlets instead of relying on error handling

## Low Priority

### OpenAPI Spec Generation
Auto-generate an OpenAPI spec from bridge.ps1's route definitions for documentation and client generation.
