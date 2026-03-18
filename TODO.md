# TODO

## Medium Priority

### Wizard Processing Order Editor
Several wizards generate multiple policies with specific processing orders. Add a visual processing order editor that shows the policy evaluation chain and lets users reorder policies via drag-and-drop.

## Low Priority

### OpenAPI Spec Generation
Auto-generate an OpenAPI spec from bridge.ps1's route definitions for documentation and client generation.

### Best Practices Analyzer
Call Windows Server Best Practices Analyzer for the DNS role and report results through the app. Optionally schedule regular runs.

### DoH Configuration Panel (Server 2025+)
Add `Get/Set-DnsServerEncryptionProtocol` UI panel to the server config, conditionally shown when the server supports it.
