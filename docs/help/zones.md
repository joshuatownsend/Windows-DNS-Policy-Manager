# Zone Management

The **Zones** tab provides a two-panel browser for viewing zone details and managing DNS records.

## Layout

- **Left panel** — Searchable list of all zones on the active server
- **Right panel** — Details, settings, and records for the selected zone

## Browsing Zones

The left panel lists every zone on the active server. Each zone shows:
- Zone name
- Type badge (Primary, Secondary, Stub, etc.)
- Flags for AD-integrated, DNSSEC-signed, and reverse lookup zones

Use the **search box** at the top to filter zones by name.

Click a zone to load its details and records in the right panel.

## Zone Settings

When you select a zone, the right panel shows a collapsible **Settings** section with:

- **Dynamic Update** — Controls which clients can register DNS records dynamically. Options: None, Nonsecure and Secure, Secure Only.
- **Aging** — Enables or disables scavenging of stale records.
- **Refresh Interval** — How often a record must be refreshed to avoid scavenging.
- **NoRefresh Interval** — Period after a refresh during which the record cannot be refreshed again.

Click **Save Settings** to apply changes to the server.

## DNS Records

Below the settings section, a **Records** table shows all resource records in the selected zone.

### Record Table Columns

| Column | Content |
|--------|---------|
| **Host Name** | The record name (e.g., `www`, `@` for zone apex) |
| **Type** | Record type with a colored badge (A, AAAA, CNAME, MX, etc.) |
| **Record Data** | The record value (IP address, alias, mail server, etc.) |
| **TTL** | Time-to-live for the record |

### Filtering Records

Two filters are available above the table:

- **Type dropdown** — Show only records of a specific type (A, AAAA, CNAME, MX, NS, PTR, SRV, TXT, SOA), or "All Types"
- **Search box** — Filter by hostname. Supports three modes:
  - Plain text: substring match (e.g., `www` matches `www`, `www2`)
  - Glob: use `*` as wildcard (e.g., `*.internal` matches `app.internal`)
  - Regex: wrap in slashes (e.g., `/^mail\d+$/` matches `mail1`, `mail2`)

### Adding a Record

1. Click **Add Record**
2. Select the **Record Type** (A, AAAA, CNAME, MX, NS, PTR, SRV, TXT)
3. Enter the **Host Name** (e.g., `www`)
4. Fill in the type-specific fields:

| Type | Fields |
|------|--------|
| **A** | IPv4 Address |
| **AAAA** | IPv6 Address |
| **CNAME** | Host Name Alias |
| **MX** | Mail Exchange server, Preference (priority number) |
| **NS** | Name Server |
| **PTR** | PTR Domain Name |
| **SRV** | Domain Name, Priority, Weight, Port |
| **TXT** | Descriptive Text |

5. Optionally set a **TTL** (time-to-live in seconds)
6. Click **Save**

### Editing a Record

Click the **pencil icon** on any record row to open the edit dialog with the current values pre-filled. Modify the fields and click **Save**.

SOA records are read-only and cannot be edited through this tool.

### Deleting a Record

Click the **trash icon** on any record row and confirm the deletion.

## Reloading Records

Click the **Reload Records** button to refresh the record list from the server. This is useful after making changes through other tools or the command line.
