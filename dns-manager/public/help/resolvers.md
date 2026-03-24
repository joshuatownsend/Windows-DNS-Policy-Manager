# Resolvers & Topology

The **Resolvers** tab shows the DNS resolver configuration of the connected server, including per-adapter DNS settings, forwarder configuration, and a visual topology diagram.

## Adapter DNS Configuration

View the IP stack DNS settings for each network adapter on the server:

- **IPv4 DNS servers** — Primary and secondary DNS addresses
- **IPv6 DNS servers** — Primary and secondary DNS addresses
- **Adapter name** and connection status

This information comes from the OS network stack (not the DNS Server service) and shows how the server itself resolves DNS queries.

## Forwarder Configuration

View and manage the DNS forwarders configured on the server. Forwarders are DNS servers that this server sends queries to when it cannot resolve them locally.

- View the current forwarder list with IP addresses
- See the forwarder timeout and whether recursion is enabled

## Topology Diagram

A Mermaid-rendered network diagram that visualizes the resolver topology:

- The DNS server is shown at the center
- Network adapters branch out with their configured DNS servers
- Forwarders are displayed as upstream resolvers
- **Color-coded edges** distinguish IPv4 (one color) from IPv6 (another) and forwarder connections

This diagram provides a quick visual overview of how DNS resolution flows through the server and its upstream dependencies.

## Requirements

- The bridge must be connected to retrieve resolver information
- Resolver data is fetched as a background job since it queries multiple system components
