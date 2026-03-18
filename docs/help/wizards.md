# Scenario Wizards

The **Wizards** tab provides step-by-step guided setup for common DNS policy scenarios. Each wizard generates the complete set of PowerShell commands needed — including client subnets, zone scopes, resource records, and policies — so you don't have to create each object individually.

## How Wizards Work

1. Choose a scenario from the grid
2. Walk through the steps, filling in your configuration
3. On the final **Review** step, inspect the generated commands
4. Click **Generate Commands** to save them, or **Execute on Server** to run them immediately

You can go **Back** to any previous step to change your inputs. Click **Cancel** to exit without executing.

## Scenarios

### Geo-Location Routing

Route DNS queries to different IP addresses based on which geographic region the client is in.

**What you configure:**
- Zone name
- Regions: each with a name, subnet CIDR, and target IP address
- Record name and type (A or AAAA)
- Fallback IP for clients that don't match any region

**What gets created:**
- One client subnet per region
- One zone scope per region with a resource record pointing to the region's IP
- One query resolution policy per region matching the subnet to the zone scope
- A default zone scope record for unmatched clients

---

### Split-Brain DNS

Serve different DNS answers to internal and external clients for the same zone. Internal users resolve to private IPs; external users resolve to public IPs.

**What you configure:**
- Method: **By Client Subnet** (match by source IP range) or **By Server Interface** (match by which network interface received the query)
- Zone name
- Internal subnet CIDRs or internal interface IP
- Internal zone scope name and records
- Recursion scope settings

**What gets created:**
- Client subnet (if using subnet method)
- Internal zone scope with internal records
- Recursion scope with recursion disabled on default, enabled on internal scope
- Recursion policy for internal clients
- Query resolution policy routing internal clients to the internal zone scope

Optionally enable **Active Directory integrated** to include AD zone creation commands and guidance for replicating policies to other domain controllers.

---

### Domain Blocklist

Block or silently drop DNS queries for a list of malicious or unwanted domains.

**What you configure:**
- Domain list (one per line or comma-separated; supports wildcards like `*.malware.com`)
- Whether to auto-add `*.` wildcard prefixes
- Action: **IGNORE** (silently drop) or **DENY** (return refused)
- Policy name prefix

**What gets created:**
- One or more query resolution policies with FQDN criteria matching the domains
- Domains are automatically batched into groups of 100 per policy if the list is large

---

### Time-of-Day Routing

Distribute DNS traffic differently during peak hours, optionally with geographic awareness.

**What you configure:**
- Zone name and record name
- Datacenters: each with a name, IP address, and optional client subnet
- Peak hours (e.g., `18:00-21:00`)
- Traffic weights per datacenter during peak hours

**What gets created:**
- Client subnets (if any datacenter has a subnet defined)
- Zone scopes and records per datacenter
- Peak-hour policies with weighted zone scope distribution
- Normal-hour per-region policies (if subnets are defined)
- Worldwide catch-all policy with equal distribution

If no subnets are provided, creates a simpler time-based setup (cloud offload pattern).

---

### Application Load Balancing

Distribute DNS queries across multiple backend servers using weighted zone scopes.

**What you configure:**
- Zone name and record name
- Record TTL (low values recommended, e.g., 300 seconds)
- Backend servers: each with a scope name, IP address, and weight

**What gets created:**
- Zone scopes and records per backend
- A single load balancing policy with weighted zone scope distribution

Higher weight means more traffic. For example, weights of 3, 2, and 1 distribute traffic roughly 50%/33%/17%.

---

### Geo-Location + Load Balancing

Combine geographic routing with weighted load balancing. Clients in different regions get different traffic distributions across your datacenters.

**What you configure:**
- Zone name and record name
- Regions: each with a name and subnet CIDR
- Datacenters: each with a name and IP address
- Per-region weight matrix (how much traffic each region sends to each datacenter)
- Whether to include a worldwide catch-all policy

**What gets created:**
- Client subnets per region
- Zone scopes and records per datacenter
- Per-region weighted policies
- Optional worldwide catch-all with equal distribution

---

### Primary-Secondary Geo-Location

Configure geo-location routing on a primary DNS server, then replicate the setup to secondary servers.

**What you configure:**
- Zone name and record name
- Regions (same as geo-location: name, subnet, IP)
- Secondary servers: hostname and IP address

**What gets created:**
- On the primary: zone transfer configuration, client subnets, zone scopes, records, and policies
- On each secondary: secondary zone creation, then copies of all subnets, zone scopes, records, and policies

---

### Query Filters (Block/Allow)

Create flexible query filters using combinations of criteria types.

**What you configure:**
- Filter mode:
  - **Blocklist** — Block queries that match (using `EQ` operator)
  - **Allowlist** — Block queries that do NOT match (using `NE` operator)
- Action: IGNORE or DENY
- Criteria types (select one or more):
  - **FQDN** — Domain names
  - **Client Subnet** — Client IP ranges
  - **Query Type** — DNS record types (A, AAAA, ANY, AXFR, etc.)
  - **Server Interface IP** — Which server interface received the query
- Condition for multiple criteria: AND (all must match) or OR (any can match)
- Policy name

**What gets created:**
- A single query resolution policy combining all selected criteria

## After Execution

When you click **Execute on Server**, the wizard runs each step individually using the application's typed API — not raw PowerShell strings. This provides:

- **Per-step progress** — A progress bar shows which step is running (e.g., "Creating client subnet: NorthAmericaSubnet")
- **Step-by-step results** — Each step shows a green checkmark or red X with the specific error
- **Proper credentials** — All steps use the active server's credential mode automatically
- **PowerShell tab log** — A summary of all steps (pass/fail) is added to the PowerShell tab

If a step fails, the remaining steps still execute. Review the results list below the command preview for details on any failures.

**Generate Commands** still produces raw PowerShell strings that you can copy and run manually — this flow is unchanged.
