# TODO

## Medium Priority

### Wizard Processing Order Editor
Several wizards generate multiple policies with specific processing orders. Add a visual processing order editor that shows the policy evaluation chain and lets users reorder policies via drag-and-drop.

### Record Pagination for Large Zones
Zones with >1000 records may be slow. Add server-side paging or virtual scroll to the record table.

### Bulk Record Import/Export
Support importing records from CSV or zone file format, and exporting the current zone's records.

## Low Priority

### OpenAPI Spec Generation
Auto-generate an OpenAPI spec from bridge.ps1's route definitions for documentation and client generation.

### PWA / Offline Support
Service worker for caching the frontend shell. Would allow the command generation features to work without any server.

### Best Practices Analyzer
Call Windows Server Best Practices Analyzer for the DNS role and report results through the app. Optionally schedule regular runs.

### DoH Configuration Panel (Server 2025+)
Add `Get/Set-DnsServerEncryptionProtocol` UI panel to the server config, conditionally shown when the server supports it.
