# DNS Objects

The **DNS Objects** tab manages the building blocks used by DNS policies: client subnets, zone scopes, and recursion scopes. These objects must exist on the server before policies can reference them.

## Client Subnets

Client subnets define groups of IP address ranges. Policies use them to match DNS queries by the client's source IP — for example, routing queries from your North America subnet to a nearby datacenter.

### Viewing Subnets

Expand the **Client Subnets** section to see all subnets on the active server. Each row shows the subnet name, IPv4 ranges, and IPv6 ranges.

### Creating a Subnet

1. Enter a **Name** (e.g., `NorthAmericaSubnet`)
2. Enter **IPv4 Subnets** as comma-separated CIDRs (e.g., `10.0.0.0/8, 172.16.0.0/12`)
3. Optionally enter **IPv6 Subnets** (e.g., `fd00::/64`)
4. Click **Add**

### Deleting a Subnet

Click the **trash icon** next to any subnet. Subnets that are referenced by active policies should be removed from those policies first.

## Zone Scopes

Zone scopes are named subsets of a DNS zone that can contain different records. Policies direct matching queries to specific zone scopes — this is how geo-location routing and load balancing work.

Every zone has a default scope (`.`) that contains the normal records. You create additional named scopes (e.g., `EuropeScope`, `InternalScope`) with their own records.

### Viewing Zone Scopes

1. Enter a **zone name** in the input field (e.g., `contoso.com`)
2. Click **Load Scopes**
3. The table shows all scopes for that zone

### Creating a Zone Scope

1. Enter a **Scope Name** (e.g., `EuropeScope`)
2. Enter the **Zone Name** it belongs to (e.g., `contoso.com`)
3. Click **Add**

After creating a zone scope, add records to it using the Zones tab or through wizard scenarios.

### Deleting a Zone Scope

Click the **trash icon** next to any scope. The default scope (`.`) cannot be deleted.

## Recursion Scopes

Recursion scopes control whether the DNS server performs recursive resolution for matching queries. They are essential for split-brain DNS setups where you want internal clients to use recursion but block it for external clients.

### Viewing Recursion Scopes

Expand the **Recursion Scopes** section to see all recursion scopes on the active server.

### Creating a Recursion Scope

1. Enter a **Name** (e.g., `InternalRecursionScope`)
2. Toggle **Enable Recursion** on or off
3. Optionally enter **Forwarder IPs** (comma-separated, e.g., `8.8.8.8, 1.1.1.1`)
4. Click **Add**

### Deleting a Recursion Scope

Click the **trash icon** next to any scope. The default recursion scope (`.`) cannot be deleted, but its recursion setting can be changed.

## Refreshing Data

Each section has a **refresh button** to reload data from the server. Data does not auto-refresh — click refresh after making changes outside of this tool.

## Bridge Required

All operations in this tab require the bridge to be connected. If the bridge is offline, the sections show a warning and data may be stale.
