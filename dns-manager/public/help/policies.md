# Policies

## Viewing Policies

The **Policies** tab shows all DNS query resolution policies and zone transfer policies on the active server.

Each policy card displays:
- **Name** — The policy identifier
- **Action** — ALLOW (green), DENY (red), or IGNORE (amber)
- **Processing Order** — Lower numbers are evaluated first
- **Zone** — The zone the policy applies to (if any)
- **Type badge** — Standard or Zone Transfer

### Filtering by Zone

Enter a zone name in the filter input and click **Refresh** to show only policies for that zone. Clear the field and refresh to show all policies.

### Enabling and Disabling Policies

Each policy has a toggle switch. Flip it to enable or disable the policy on the server. Disabled policies remain on the server but are not evaluated.

### Deleting a Policy

Click the **trash icon** on a policy card. A confirmation dialog appears before the policy is removed from the server.

## Creating Policies

The **Create Policy** tab provides a visual form for building new DNS policies.

### Step 1: Choose Policy Type

Click one of three cards at the top:

| Type | Purpose |
|------|---------|
| **Query Resolution** | Controls how DNS queries are answered. Supports zone scopes for routing queries to different record sets. |
| **Recursion** | Controls whether the server performs recursive resolution. Used in split-brain setups. |
| **Zone Transfer** | Controls which zone transfer requests are allowed or denied. |

The selected type determines which form sections are visible.

### Step 2: Basic Information

- **Policy Name** — A unique identifier (e.g., `NorthAmericaPolicy`)
- **Processing Order** — Evaluation priority. Lower numbers run first. Use `1` for the highest priority.
- **Action** — What to do when the policy matches:
  - **ALLOW** — Process the query normally (routing to a zone scope if specified)
  - **DENY** — Return a "refused" response to the client
  - **IGNORE** — Silently drop the query (no response)
- **Enabled** — Toggle to create the policy in a disabled state

### Step 3: Zone (Query Resolution and Zone Transfer only)

- **Zone Name** — The DNS zone this policy applies to (e.g., `contoso.com`)
- **Apply to Zone** — When enabled, the policy is zone-level. When disabled, it's server-level.

### Step 4: Criteria

Criteria define which queries the policy matches. Click **Add Criterion** to add matching rules.

Each criterion has:
- **Type** — What to match on:
  - `ClientSubnet` — Client's source IP (must reference a client subnet object)
  - `Fqdn` — The queried domain name (supports wildcards like `*.contoso.com`)
  - `TransportProtocol` — TCP or UDP
  - `InternetProtocol` — IPv4 or IPv6
  - `ServerInterfaceIP` — Which server network interface received the query
  - `TimeOfDay` — Time range (e.g., `18:00-21:00`)
  - `QType` — DNS query type (A, AAAA, MX, ANY, etc.)
- **Operator** — `EQ` (equals/matches) or `NE` (does not match)
- **Value** — The value to match against

When multiple criteria are present, a **Condition** selector appears: **AND** (all must match) or **OR** (any can match).

### Step 5: Zone Scopes (Query Resolution only)

Zone scopes control where matching queries are answered from. Each scope entry has:
- **Scope Name** — Name of a zone scope (must exist on the server)
- **Weight** — Relative traffic distribution (higher = more traffic)

For example, two scopes with weights 3 and 1 distribute traffic roughly 75%/25%.

### Step 6: Recursion Scope (Recursion only)

Enter the name of a recursion scope to direct matching queries to.

### Step 7: Target Servers

Select which servers to create the policy on. The active server is pre-selected. Use **Select All** to target every registered server.

### Generating and Executing

- **Generate PowerShell** — Creates the command and shows it in a preview box. The command is also added to the PowerShell tab for reference.
- **Create Policy** — Generates the command and, if execution mode is set to **Live**, executes it on the selected servers.

The generated command preview includes a **Copy** button for clipboard access.
