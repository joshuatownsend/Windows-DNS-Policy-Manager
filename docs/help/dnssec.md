# DNSSEC Management

The **DNSSEC** tab lets you manage DNS Security Extensions — sign and unsign zones, manage signing keys, and configure trust anchors.

## Zone Signing Status

The main table lists all zones on the active server with their signing status:

- **Signed** (green badge) — The zone is DNSSEC-signed and serving authenticated responses
- **Unsigned** (gray badge) — The zone has no DNSSEC signing

Click any zone row to load its DNSSEC details in the panel below.

## Signing and Unsigning a Zone

With a zone selected, use the action buttons:

- **Sign Zone** — Signs the zone with DNSSEC. The server generates signing keys (if none exist) and signs all records. This may take a moment for large zones.
- **Unsign Zone** — Removes DNSSEC signing from the zone. You must type the zone name to confirm, since this is a destructive operation that removes all signatures and keys.

## Signing Keys

Each signed zone has one or more signing keys displayed in a table:

| Column | Meaning |
|--------|---------|
| **Type** | KSK (Key Signing Key) or ZSK (Zone Signing Key) |
| **Algorithm** | Cryptographic algorithm (e.g., RSA/SHA-256, ECDSA P-256) |
| **Length** | Key size in bits |
| **State** | Current key state (Active, Standby, etc.) |

### Key Types

- **KSK (Key Signing Key)** — Signs the DNSKEY record set. Used to establish a chain of trust with the parent zone. Rolled over less frequently.
- **ZSK (Zone Signing Key)** — Signs all other record sets in the zone. Rolled over more frequently for security.

### Adding a Key

1. Click **Add Key**
2. Select the key type (KSK or ZSK)
3. Choose an algorithm:
   - **RSA/SHA-256** — Widely supported, recommended for most deployments
   - **RSA/SHA-512** — Stronger RSA variant
   - **ECDSA P-256/SHA-256** — Smaller keys, faster, recommended for new deployments
   - **ECDSA P-384/SHA-384** — Stronger ECDSA variant
4. Set the key length (2048 bits typical for RSA, 256 for ECDSA)
5. Click **Add Key**

### Removing a Key

Click the **trash icon** next to any key to remove it. Be careful — removing the only active KSK or ZSK can break DNSSEC validation for the zone.

## Exporting the Public Key

Click **Export Key** to export the zone's DS and DNSKEY records. The export is saved to the DNS server's directory. You'll need these records to configure the chain of trust with your parent zone (domain registrar).

## Trust Anchors

Trust anchors are cryptographic keys used to validate DNSSEC responses from other zones. Click **Load Trust Data** to view them.

Each trust anchor shows:
- **Name** — The zone the anchor applies to
- **Type** — The anchor type (DS, DNSKEY)
- **State** — Current validation state

You can **add** new trust anchors (requires the key tag, algorithm, digest type, and digest) or **remove** existing ones.

## Trust Points

Trust points show the status of DNSSEC trust validation for configured zones. Each entry displays:
- **Name** — The trust point zone
- **State** — Whether validation is active
- **Last Refresh** — When the trust point was last validated

Click **Update** to force a refresh of a trust point's validation status.

## When to Use DNSSEC

DNSSEC is recommended when:
- Your zones are publicly accessible and you need to prevent DNS spoofing
- Your organization requires authenticated DNS responses
- Your parent zone supports DS record delegation

DNSSEC is typically not needed for:
- Internal-only zones behind a firewall
- Zones where the additional complexity outweighs the security benefit
