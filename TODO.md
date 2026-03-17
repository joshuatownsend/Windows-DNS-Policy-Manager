# TODO

## Wizard Execution: Use Typed API Endpoints

Currently `wizardExecute()` sends each command line to the bridge's `/api/execute` endpoint sequentially. This works but relies on the `Handle-Execute` allowlist and treats all commands as opaque strings.

**Future improvement:** Refactor wizard execution to call typed API endpoints directly (e.g., `api.createSubnet()`, `api.createZoneScope()`, `api.addPolicy()`) instead of `/api/execute`. This would provide structured error handling per object type, bypass the allowlist dependency, and make rollback on partial failure feasible.

## Policy Copy: Support Zone Transfer and Recursion Policies

The current `Handle-CopyPolicies` bridge endpoint only copies query resolution policies (`Get-DnsServerQueryResolutionPolicy`). It should also support copying zone transfer policies (`Get-DnsServerZoneTransferPolicy`) and provide an option to select which policy types to copy.

## Scenario 2: Bridge Endpoints for Secondary Zones

The Primary-Secondary wizard generates correct PowerShell commands but can't execute them through the bridge yet. Needs:
- `Add-DnsServerSecondaryZone` bridge endpoint
- `Set-DnsServerPrimaryZone` for zone transfer notification config
- Remote execution support (commands targeting secondary servers)

## Wizard Processing Order Management

Several wizards now generate multiple policies with specific processing orders. Consider adding a visual processing order editor that shows the policy evaluation chain and lets users reorder policies.

## Zone Management Enhancements
- Zone creation (`Add-DnsServerPrimaryZone`, `Add-DnsServerSecondaryZone`) — add "Create Zone" button in Zones tab
- Zone deletion (`Remove-DnsServerZone`) — add delete option with confirmation
- Zone type conversion (`ConvertTo-DnsServerPrimaryZone` / `ConvertTo-DnsServerSecondaryZone`)
- DNSSEC management (signing, key rollover, trust anchor distribution)
- Record pagination for very large zones (>1000 records) — server-side paging or virtual scroll
- Zone aging/scavenging settings (`Set-DnsServerZoneAging`)
- Bulk record import/export (CSV/zone file format)

## Other
- Call Windows Server Best Practices Analyzer for DNS role and report results through the app. Schedule this to run regularly.