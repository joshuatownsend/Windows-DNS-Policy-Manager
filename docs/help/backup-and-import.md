# Backup & Import

The **Backup & Import** tab provides three functions: exporting policies as JSON, importing policy backups, and bulk-importing domain blocklists.

## Exporting Policies

Export all policies from a DNS server as a downloadable JSON file.

1. Select a **server** from the dropdown
2. Choose what to include:
   - **Include Zone Policies** — Policies tied to specific zones
   - **Include Server Policies** — Server-level policies
3. Click **Export Policies**

A JSON file downloads automatically with a timestamped filename (e.g., `dns-policies-2026-03-17.json`). Keep this file to restore policies later or to replicate them on another server.

The bridge must be connected to export.

## Importing Policies

Restore policies from a previously exported JSON file.

1. **Drag and drop** a `.json` backup file onto the upload area (or click to browse)
2. A preview appears showing:
   - Source server name
   - Export date
   - Number of policies in the file
3. Click **Import All**

Each policy from the backup is created on the active server. A progress bar shows how many have been imported. Policies that already exist on the server may produce errors — these are shown as toast notifications.

The execution mode must be set to **Live** for import to execute. In **Dry Run** mode, the app shows a warning.

## Blocklist Import

Bulk-create DNS block policies from a text file of domains.

### Preparing Your Blocklist File

Create a plain text file (`.txt`) with one domain per line:

```
malware.example.com
phishing.bad-site.net
ads.tracker.org
```

Lines starting with `#` are treated as comments and ignored.

### Importing

1. **Drag and drop** the `.txt` file onto the upload area (or click to browse)
2. A preview shows the first 10 domains and the total count
3. Configure the import:
   - **Action** — What to do with matching queries:
     - **DENY** — Return a "refused" response
     - **IGNORE** — Silently drop the query (no response sent)
   - **Zone Name** (required) — The zone these policies apply to
   - **Processing Order Start** — The starting processing order number (default: 1). Each domain gets an incrementing order.
4. Click **Import Blocklist**

A progress bar tracks the import. Each domain becomes a separate DNS policy with an FQDN criterion.

The execution mode must be set to **Live** for the blocklist to execute on the server.
