# Changelog

All notable changes to the DNS Policy Manager will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added

- **ServerInterfaceIP criteria type** — New criteria type for query resolution and recursion policies, separate from ServerInterface (zone transfer). Used in MS Scenarios 5, 6, and 7.
- **Record TTL support** — Zone scope records can now be created with a custom TTL (Time-To-Live) in seconds. The bridge passes `-TimeToLive` to `Add-DnsServerResourceRecord`. Recommended for cloud offload (Scenario 4) and load balancing (Scenario 8).
- **Default zone scope fallback records** — Geo-location wizard now includes a "Default / Fallback IP" field that generates `Add-DnsServerResourceRecord` commands for the default zone scope, ensuring clients from unmatched regions still receive a response (MS Scenario 1).
- **Policy copy between servers** — New "Copy to Server" button in Policies tab. Copies all query resolution policies from the active server to selected target server(s) via new `POST /api/policies/copy` bridge endpoint. Essential for AD environments where zone scopes replicate but policies do not (MS Scenario 6).
- **Geo-Location + Load Balancing wizard** (MS Scenario 9) — New wizard combining geographic routing with weighted load balancing. Supports per-region weighted datacenter distribution and a worldwide catch-all policy.
- **Primary-Secondary Geo-Location wizard** (MS Scenario 2) — New wizard that configures geo-location on primary server, then generates secondary zone creation, zone transfer config, and subnet/scope/policy copy commands for secondary servers.
- **Query Filter wizard** (MS Scenario 7) — New wizard replacing the basic blocklist wizard. Supports both blocklist (EQ + DENY/IGNORE) and allowlist (NE + IGNORE) patterns, with FQDN, client subnet, query type, and server interface IP criteria, including combinations with AND/OR conditions.
- **Split-Brain wizard: Server Interface method** (MS Scenarios 5b/6) — Split-brain wizard now offers a choice between "By Client Subnet" and "By Server Interface" methods. The interface method uses `-ServerInterfaceIP` criteria instead of `-ClientSubnet`.
- **Split-Brain wizard: Active Directory option** (MS Scenario 6) — Optional AD checkbox adds `Add-DnsServerPrimaryZone -ReplicationScope "Domain"` and policy copy guidance for AD-integrated zones.

### Changed

- **Time-of-Day wizard overhaul** (MS Scenarios 3 & 4) — Completely redesigned to match Microsoft documentation. Now supports: datacenter definitions with IPs and optional client subnets, peak hours with weighted multi-scope distribution (e.g., 80/20 split), layered policies at different processing orders (peak → normal → worldwide catch-all), optional record TTL for cloud scenarios.
- **Load Balancing wizard improvements** (MS Scenario 8) — Now supports zone apex (@), includes optional record TTL field with recommendation note, and uses TimeToLive parameter in generated commands.
- **Blocklist wizard replaced** by the more comprehensive Query Filter wizard (Scenario 7 superset). The original blocklist scenario remains as a subset of the new filter wizard's blocklist mode.
