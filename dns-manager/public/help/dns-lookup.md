# DNS Lookup Utility

## Overview

The DNS Lookup utility lets you run **nslookup** and **dig**-style queries against any nameserver directly from the browser. It's available as a slide-over panel from the header — click the **Lookup** button (terminal icon) to open it from any tab.

Unlike the Zones tab which shows records stored on a server, the Lookup utility performs live DNS resolution — the same queries your clients make. This is essential for troubleshooting resolution issues, verifying policy behavior, and confirming record propagation.

## Using the Lookup Panel

### 1. Select a Tool

Choose between **nslookup** and **dig** using the toggle at the top. Both use the same underlying `Resolve-DnsName` PowerShell cmdlet — the difference is output formatting:

- **nslookup** — classic Windows-style output (`Server: ... Name: ... Address: ...`)
- **dig** — UNIX-style sections (QUESTION, ANSWER, AUTHORITY, ADDITIONAL, statistics)

### 2. Configure the Query

- **Nameserver**: Select any registered server from the dropdown, or choose "Custom..." to enter an IP address or hostname manually. The active server is pre-selected by default.
- **Hostname**: The domain name to look up (e.g., `example.com`, `mail.contoso.local`)
- **Type**: Record type to query — A, AAAA, CNAME, MX, NS, PTR, SRV, TXT, SOA, or ANY

### 3. Set Options

Options change based on the selected tool. They control both the query behavior and output formatting.

#### nslookup Options

| Option | Default | Effect |
|--------|---------|--------|
| **Recursion** | ON | Allow the server to resolve recursively. Turn off to test authoritative-only responses. |
| **Use TCP** | OFF | Force TCP instead of UDP. Useful for large responses or zone transfer testing. |
| **Debug** | OFF | Show additional detail: TTL, record class, section, and query timing. |
| **Search List** | ON | Append the DNS suffix search list to short names. |

#### dig Options

| Option | Default | Effect |
|--------|---------|--------|
| **+recurse** | ON | Set the Recursion Desired (RD) flag in the query. |
| **+tcp** | OFF | Force TCP transport. |
| **+dnssec** | OFF | Request DNSSEC records (RRSIG, NSEC). |
| **+trace** | OFF | Follow the delegation chain from root servers to authoritative, showing NS records at each step. |
| **+short** | OFF | Terse output — answer data only, one value per line. |
| **+all** | OFF | Master toggle — enables all section and display options at once. |
| **+multiline** | OFF | Verbose multi-line format for SOA records (labeled serial, refresh, retry, expire, minimum). |
| **+comments** | ON | Show section headers (`;; QUESTION SECTION:`, etc.). |
| **+question** | ON | Include the QUESTION section. |
| **+answer** | ON | Include the ANSWER section. |
| **+authority** | ON | Include the AUTHORITY section (NS records for the zone). |
| **+additional** | ON | Include the ADDITIONAL section (glue records). |
| **+stats** | ON | Show query statistics (time, server, timestamp, record count). |

### 4. Execute and Review

Click **Lookup** or press **Enter** to run the query. Results appear in the console-styled output area with the most recent query at the top. Each entry shows:

- Timestamp and the `Resolve-DnsName` command that was executed
- Formatted output matching the selected tool style

Use the **Copy** button to copy all output to clipboard, or **Clear** to reset the session.

## Common Use Cases

### Verify a Record Exists
Select the target server, enter the hostname, choose the record type (e.g., A), and click Lookup.

### Test Non-Recursive Resolution
Turn off **Recursion** (nslookup) or uncheck **+recurse** (dig) to see what the server knows authoritatively without following referrals.

### Check DNSSEC
In dig mode, enable **+dnssec** to see RRSIG and NSEC records alongside the answer.

### Trace the Delegation Chain
In dig mode, enable **+trace** to see the full resolution path: root servers, TLD nameservers, domain nameservers, and the final authoritative answer.

### Compare Servers
Run the same query against different nameservers by switching the Nameserver dropdown between queries. Results stay in the output history for easy comparison.

### Quick MX/NS Check
Set the record type to MX or NS to check mail routing or delegation for a domain.

## Requirements

- The **PowerShell bridge** must be running (the Lookup button is disabled when the bridge is offline)
- The `Resolve-DnsName` cmdlet must be available on the bridge host (included with Windows 8+ and Server 2012+)
- Network connectivity from the bridge host to the target nameserver

## Troubleshooting

- **"Failed to connect to bridge"** — Start the bridge with `Start-DNSPolicyManager.ps1` or manually run `server/bridge.ps1`
- **Timeout errors** — The target nameserver may be unreachable from the bridge host. Verify network connectivity.
- **Empty results for internal zones** — Make sure you're querying the correct nameserver (the one hosting the zone), not a public resolver.
