# Blocklists

The **Blocklists** tab provides tools for blocking DNS resolution of unwanted domains. It combines single-domain blocking, bulk import, active policy management, and Global Query Block List (GQBL) configuration in one place.

## Quick Block

Block a single domain instantly.

1. Enter the **domain name** to block (e.g., `malware.example.com`)
2. Click **Block Domain**

This creates a DNS policy that denies queries for the specified domain. The policy appears immediately in the Active Block Policies table below.

## Bulk Import

Import a list of domains from a `.txt` file to create block policies in batch.

1. Prepare a text file with one domain per line
2. **Drag and drop** the file onto the upload area (or click to browse)
3. Review the domain count
4. Click **Import**

Progress is tracked per-domain with error reporting for any that fail. This is useful for importing blocklists from threat intelligence feeds or community-maintained domain lists.

## Active Block Policies

A table showing all currently active block policies on the selected server. From here you can:

- View which domains are blocked
- **Enable or disable** individual block policies
- **Delete** block policies you no longer need

## Global Query Block List

Manage the Windows DNS Server Global Query Block List (GQBL). This is a built-in server feature that blocks queries for specific DNS names across all zones.

- View the current GQBL entries
- Add new entries to the list
- Remove entries from the list

The GQBL is separate from DNS policies and is configured at the server level. By default, Windows DNS Server blocks `wpad` and `isatap` queries through this list.

## Requirements

- The bridge must be connected to create block policies or manage the GQBL
- In offline mode, the Quick Block and Bulk Import features generate the equivalent PowerShell commands for manual execution
