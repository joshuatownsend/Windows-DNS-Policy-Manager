"use client";

import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { useStore } from "@/lib/store";
import { api } from "@/lib/api";
import { getServerParamsFor } from "@/lib/utils";
import type { NetworkDnsConfig, ResolverData, Server } from "@/lib/types";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import {
  RefreshCw,
  Network,
  ArrowRightLeft,
  AlertTriangle,
  Globe,
  Server as ServerIcon,
} from "lucide-react";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Well-known public DNS resolvers for labeling
const KNOWN_RESOLVERS: Record<string, string> = {
  "8.8.8.8": "Google DNS",
  "8.8.4.4": "Google DNS",
  "1.1.1.1": "Cloudflare",
  "1.0.0.1": "Cloudflare",
  "9.9.9.9": "Quad9",
  "149.112.112.112": "Quad9",
  "208.67.222.222": "OpenDNS",
  "208.67.220.220": "OpenDNS",
  "64.6.64.6": "Verisign",
  "64.6.65.6": "Verisign",
  "2001:4860:4860::8888": "Google DNS",
  "2001:4860:4860::8844": "Google DNS",
  "2606:4700:4700::1111": "Cloudflare",
  "2606:4700:4700::1001": "Cloudflare",
};

interface ServerResolverData {
  server: Server;
  data: ResolverData | null;
  error?: string;
}

const sp = getServerParamsFor;

// Normalize forwarder data — IPAddress may be a string, object, or array
function normalizeForwarders(raw: any): { IPAddress: string[]; UseRootHint?: boolean; Timeout?: number } {
  if (!raw) return { IPAddress: [] };
  let ips = raw.IPAddress;
  if (!ips) ips = [];
  else if (typeof ips === "string") ips = [ips];
  else if (!Array.isArray(ips)) ips = [];
  return { ...raw, IPAddress: ips };
}

function addressFamilyLabel(af: number) {
  return af === 2 ? "IPv4" : af === 23 ? "IPv6" : `AF${af}`;
}

function addressFamilyColor(af: number) {
  return af === 2
    ? "bg-blue-500/20 text-blue-400 border-blue-500/30"
    : "bg-purple-500/20 text-purple-400 border-purple-500/30";
}

// Sanitize Mermaid SVG output — strip script tags and event handlers.
// Uses text/html parser because Mermaid emits <br/> inside <foreignObject>
// which is invalid XML and breaks image/svg+xml parsing.
function sanitizeSvg(svg: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svg, "text/html");
  doc.querySelectorAll("script").forEach((el) => el.remove());
  doc.querySelectorAll("*").forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      if (attr.name.startsWith("on")) {
        el.removeAttribute(attr.name);
      }
    }
  });
  const svgEl = doc.querySelector("svg");
  if (!svgEl) return svg;
  return svgEl.outerHTML;
}

// Escape text for use in Mermaid node labels — prevents syntax injection
function escapeMermaidLabel(text: string): string {
  return text.replace(/["\\<>{}()\[\]|]/g, "");
}

type AddressFilter = "both" | "ipv4" | "ipv6";

// Generate Mermaid graph definition from resolver data
// Layout: TB (top-to-bottom). External resolvers at top, mid-tier servers in middle, leaf servers at bottom.
function buildMermaidGraph(allData: ServerResolverData[], addressFilter: AddressFilter): string {
  const lines: string[] = ["graph TB"];
  const managedIPs = new Set<string>();
  const nodeIds = new Map<string, string>();
  const externalNodes = new Set<string>();  // node IDs of external resolvers
  const managedNodeIds = new Map<string, string>(); // hostname -> nodeId
  let nodeCounter = 0;

  function getNodeId(label: string): string {
    const key = label.toLowerCase();
    if (!nodeIds.has(key)) {
      nodeIds.set(key, `N${nodeCounter++}`);
    }
    return nodeIds.get(key)!;
  }

  // Filter interfaces by address family
  function filterInterfaces(interfaces: NetworkDnsConfig[]): NetworkDnsConfig[] {
    if (addressFilter === "ipv4") return interfaces.filter((i) => i.AddressFamily === 2);
    if (addressFilter === "ipv6") return interfaces.filter((i) => i.AddressFamily === 23);
    return interfaces;
  }

  // Filter forwarder IPs by address family (v4 = contains '.', v6 = contains ':')
  function filterIPs(ips: string[]): string[] {
    if (addressFilter === "ipv4") return ips.filter((ip) => ip.includes("."));
    if (addressFilter === "ipv6") return ips.filter((ip) => ip.includes(":"));
    return ips;
  }

  // Collect all listening IPs for managed servers
  for (const entry of allData) {
    if (!entry.data) continue;
    for (const ip of entry.data.listeningAddresses) {
      managedIPs.add(ip);
    }
  }

  // Register managed server node IDs
  for (const entry of allData) {
    const id = getNodeId(entry.server.hostname);
    managedNodeIds.set(entry.server.hostname.toLowerCase(), id);
  }

  // Collect edges first to determine node tiers
  const ipStackEdges = new Set<string>();
  const forwarderEdges = new Set<string>();
  const referencedBy = new Set<string>();  // node IDs that are targets
  const referencesOthers = new Set<string>(); // node IDs that have outgoing edges

  for (const entry of allData) {
    if (!entry.data) continue;
    const srcId = getNodeId(entry.server.hostname);

    // IP stack DNS edges
    for (const iface of filterInterfaces(entry.data.interfaces)) {
      for (const addr of iface.ServerAddresses) {
        if (managedIPs.has(addr) && entry.data.listeningAddresses.includes(addr)) continue;
        const targetId = getNodeId(addr);
        ipStackEdges.add(`${srcId}->${targetId}`);
        referencesOthers.add(srcId);
        referencedBy.add(targetId);
        if (!managedIPs.has(addr)) externalNodes.add(targetId);
      }
    }

    // Forwarder edges
    for (const addr of filterIPs(entry.data.forwarders?.IPAddress || [])) {
      if (managedIPs.has(addr) && entry.data.listeningAddresses.includes(addr)) continue;
      const targetId = getNodeId(addr);
      forwarderEdges.add(`${srcId}->${targetId}`);
      referencesOthers.add(srcId);
      referencedBy.add(targetId);
      if (!managedIPs.has(addr)) externalNodes.add(targetId);
    }
  }

  // Classify managed servers into tiers
  const topTier: string[] = [];    // External resolvers (not managed)
  const midTier: string[] = [];    // Referenced by others AND forward to others
  const bottomTier: string[] = []; // Only reference others (leaf clients)

  // External resolvers always go on top
  for (const nodeId of externalNodes) {
    topTier.push(nodeId);
  }

  // Classify managed servers
  for (const entry of allData) {
    const id = getNodeId(entry.server.hostname);
    const isReferenced = referencedBy.has(id);
    const references = referencesOthers.has(id);
    if (isReferenced && references) {
      midTier.push(id);
    } else if (isReferenced) {
      midTier.push(id); // Referenced but doesn't forward — still mid
    } else {
      bottomTier.push(id); // Only references others — leaf
    }
  }

  // Build external node labels
  const externalLabels = new Map<string, string>();
  for (const entry of allData) {
    if (!entry.data) continue;
    const addExternal = (addr: string) => {
      const targetId = getNodeId(addr);
      if (externalNodes.has(targetId) && !externalLabels.has(targetId)) {
        const knownName = KNOWN_RESOLVERS[addr];
        const safeAddr = escapeMermaidLabel(addr);
        const label = knownName ? `${escapeMermaidLabel(knownName)}<br/>${safeAddr}` : safeAddr;
        externalLabels.set(targetId, label);
      }
    };
    for (const iface of filterInterfaces(entry.data.interfaces)) {
      for (const addr of iface.ServerAddresses) addExternal(addr);
    }
    for (const addr of filterIPs(entry.data.forwarders?.IPAddress || [])) addExternal(addr);
  }

  // Render subgraphs for vertical organization
  if (topTier.length > 0) {
    lines.push(`  subgraph upstream [" "]`);
    lines.push(`    direction LR`);
    for (const id of topTier) {
      const label = externalLabels.get(id) || id;
      lines.push(`    ${id}("${label}"):::external`);
    }
    lines.push(`  end`);
  }

  if (midTier.length > 0) {
    lines.push(`  subgraph servers [" "]`);
    lines.push(`    direction LR`);
    for (const id of midTier) {
      const entry = allData.find((e) => getNodeId(e.server.hostname) === id);
      const label = entry ? escapeMermaidLabel(entry.server.name || entry.server.hostname) : id;
      lines.push(`    ${id}["${label}"]:::managed`);
    }
    lines.push(`  end`);
  }

  if (bottomTier.length > 0) {
    lines.push(`  subgraph clients [" "]`);
    lines.push(`    direction LR`);
    for (const id of bottomTier) {
      const entry = allData.find((e) => getNodeId(e.server.hostname) === id);
      const label = entry ? escapeMermaidLabel(entry.server.name || entry.server.hostname) : id;
      lines.push(`    ${id}["${label}"]:::managed`);
    }
    lines.push(`  end`);
  }

  // Render edges with per-edge color styles
  let edgeIndex = 0;
  const ipStackIndices: number[] = [];
  const forwarderIndices: number[] = [];
  const bothIndices: number[] = [];

  for (const edge of ipStackEdges) {
    const [src, tgt] = edge.split("->");
    if (forwarderEdges.has(edge)) {
      lines.push(`  ${src} -. "IP Stack + Forwarder" .-> ${tgt}`);
      bothIndices.push(edgeIndex++);
      forwarderEdges.delete(edge);
    } else {
      lines.push(`  ${src} -- "IP Stack" --> ${tgt}`);
      ipStackIndices.push(edgeIndex++);
    }
  }
  for (const edge of forwarderEdges) {
    const [src, tgt] = edge.split("->");
    lines.push(`  ${src} == "Forwarder" ==> ${tgt}`);
    forwarderIndices.push(edgeIndex++);
  }

  // Node styles
  lines.push(`  classDef managed fill:#0e4066,stroke:#22d3ee,stroke-width:2px,color:#e2e8f0`);
  lines.push(`  classDef external fill:#1a1a2e,stroke:#f59e0b,stroke-width:1px,color:#e2e8f0`);

  // Hide subgraph borders
  lines.push(`  style upstream fill:transparent,stroke:transparent`);
  lines.push(`  style servers fill:transparent,stroke:transparent`);
  lines.push(`  style clients fill:transparent,stroke:transparent`);

  // Per-edge color styles
  if (ipStackIndices.length > 0) {
    lines.push(`  linkStyle ${ipStackIndices.join(",")} stroke:#22d3ee,stroke-width:2px`);
  }
  if (forwarderIndices.length > 0) {
    lines.push(`  linkStyle ${forwarderIndices.join(",")} stroke:#f59e0b,stroke-width:3px`);
  }
  if (bothIndices.length > 0) {
    lines.push(`  linkStyle ${bothIndices.join(",")} stroke:#34d399,stroke-width:2px`);
  }

  return lines.join("\n");
}

export default function ResolversPage() {
  const servers = useStore((s) => s.servers);
  const bridgeConnected = useStore((s) => s.bridgeConnected);

  const [resolverData, setResolverData] = useState<ServerResolverData[]>([]);
  const [loading, setLoading] = useState(false);
  const [addressFilter, setAddressFilter] = useState<AddressFilter>("both");
  const mermaidRef = useRef<HTMLDivElement>(null);
  const [mermaidError, setMermaidError] = useState<string | null>(null);

  const pollTimers = useRef<ReturnType<typeof setInterval>[]>([]);

  // Clean up polls on unmount
  useEffect(() => {
    return () => {
      pollTimers.current.forEach(clearInterval);
    };
  }, []);

  const fetchAll = useCallback(async () => {
    const onlineServers = servers.filter((s) => s.status === "online");
    if (onlineServers.length === 0) {
      setResolverData([]);
      return;
    }

    // Clear any existing polls
    pollTimers.current.forEach(clearInterval);
    pollTimers.current = [];

    setLoading(true);

    // Start jobs for all servers
    await Promise.all(
      onlineServers.map((server) => {
        const p = sp(server);
        return api.startResolvers(p.server, p.serverId, p.credentialMode);
      })
    );

    // Poll each server until all complete
    const pending = new Map(onlineServers.map((s) => [s.id, s]));
    const results = new Map<string, ServerResolverData>();

    const timer = setInterval(async () => {
      const checks = [...pending.entries()].map(async ([id, server]) => {
        const p = sp(server);
        const res = await api.pollResolvers(p.server, p.serverId, p.credentialMode);
        const r = res as any;

        if (r.status === "running") return; // Still going

        pending.delete(id);
        if (r.success && r.interfaces) {
          results.set(id, {
            server,
            data: {
              interfaces: r.interfaces || [],
              forwarders: normalizeForwarders(r.forwarders),
              listeningAddresses: r.listeningAddresses || [],
            },
          });
        } else {
          results.set(id, {
            server,
            data: null,
            error: r.error || "Failed to fetch",
          });
        }
      });

      await Promise.all(checks);

      // Update UI with whatever we have so far
      setResolverData(
        onlineServers.map((s) => results.get(s.id) || { server: s, data: null })
      );

      if (pending.size === 0) {
        clearInterval(timer);
        setLoading(false);
      }
    }, 2000);

    pollTimers.current.push(timer);
  }, [servers]);

  useEffect(() => {
    if (!bridgeConnected) return;
    fetchAll();
  }, [bridgeConnected, fetchAll]);

  // Initialize Mermaid once
  const mermaidReady = useRef(false);
  useEffect(() => {
    (async () => {
      const mermaid = (await import("mermaid")).default;
      mermaid.initialize({
        startOnLoad: false,
        theme: "dark",
        themeVariables: {
          primaryColor: "#0e4066",
          primaryBorderColor: "#22d3ee",
          lineColor: "#94a3b8",
          textColor: "#e2e8f0",
          fontSize: "14px",
        },
        flowchart: { curve: "basis", padding: 16 },
        securityLevel: "strict",
      });
      mermaidReady.current = true;
    })();
  }, []);

  // Memoize graph definition
  const dataWithResults = useMemo(
    () => resolverData.filter((d) => d.data),
    [resolverData]
  );
  const graphDef = useMemo(
    () => (dataWithResults.length > 0 ? buildMermaidGraph(dataWithResults, addressFilter) : null),
    [dataWithResults, addressFilter]
  );

  // Render Mermaid diagram when graph definition changes
  useEffect(() => {
    if (!graphDef || !mermaidRef.current || !mermaidReady.current) return;

    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        if (mermaidRef.current) mermaidRef.current.textContent = "";
        const { svg } = await mermaid.render("resolver-diagram", graphDef);
        if (mermaidRef.current) {
          const safeSvg = sanitizeSvg(svg);
          mermaidRef.current.insertAdjacentHTML("afterbegin", safeSvg);
          setMermaidError(null);
        }
      } catch (err: any) {
        setMermaidError(err?.message || "Failed to render diagram");
      }
    })();
  }, [graphDef]);

  // Find discrepancies between IP stack and forwarder DNS for a server
  function findDiscrepancies(data: ResolverData) {
    const ipStackDns = new Set<string>();
    for (const iface of data.interfaces) {
      for (const addr of iface.ServerAddresses) {
        ipStackDns.add(addr);
      }
    }
    const fwdList = Array.isArray(data.forwarders?.IPAddress) ? data.forwarders.IPAddress : [];
    const forwarderIPs = new Set(fwdList);

    const onlyInIpStack = [...ipStackDns].filter((ip) => !forwarderIPs.has(ip));
    const onlyInForwarders = [...forwarderIPs].filter((ip) => !ipStackDns.has(ip));

    return { onlyInIpStack, onlyInForwarders };
  }

  const onlineCount = resolverData.filter((d) => d.data).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">
            Resolvers &amp; Topology
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            DNS resolver configuration and server interconnection diagram
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={fetchAll}
          disabled={loading || !bridgeConnected}
        >
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {!bridgeConnected && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="flex items-center gap-3 py-4">
            <AlertTriangle className="h-5 w-5 text-amber-400" />
            <span className="text-sm text-amber-200">
              Bridge is offline. Connect to a server to view resolver data.
            </span>
          </CardContent>
        </Card>
      )}

      {bridgeConnected && servers.filter((s) => s.status === "online").length === 0 && !loading && (
        <Card className="border-muted">
          <CardContent className="flex items-center gap-3 py-8 justify-center">
            <ServerIcon className="h-5 w-5 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">
              No online servers. Go to the Server tab to connect.
            </span>
          </CardContent>
        </Card>
      )}

      {/* Topology Diagram */}
      {onlineCount > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-base">
                <Network className="h-4 w-4 text-cyan" />
                DNS Topology
              </CardTitle>
              <div className="flex items-center gap-1">
                {(["both", "ipv4", "ipv6"] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => setAddressFilter(v)}
                    className={`px-2.5 py-1 rounded text-[11px] font-medium border transition-colors ${
                      addressFilter === v
                        ? "bg-cyan-500/15 text-cyan-400 border-cyan-500/40"
                        : "text-muted-foreground border-border hover:text-foreground hover:border-muted-foreground/40"
                    }`}
                  >
                    {v === "both" ? "All" : v === "ipv4" ? "IPv4" : "IPv6"}
                  </button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {/* Legend */}
            <div className="mb-4 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-0.5 w-6 bg-cyan-400" />
                IP Stack DNS
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-1 w-6 bg-amber-400" />
                Forwarder
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-0.5 w-6 border-t-2 border-dashed border-emerald-400" />
                Both (agreement)
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-3 w-3 rounded-sm border-2 border-cyan-400 bg-[#0e4066]" />
                Managed Server
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-3 w-3 rounded-full border border-amber-400 bg-[#1a1a2e]" />
                External Resolver
              </span>
            </div>

            {mermaidError ? (
              <div className="rounded border border-red-500/30 bg-red-500/5 p-4 text-sm text-red-300">
                Diagram error: {mermaidError}
              </div>
            ) : (
              <div
                ref={mermaidRef}
                className="overflow-x-auto rounded-lg bg-background/50 p-4 [&_svg]:mx-auto [&_svg]:max-w-full"
              />
            )}
          </CardContent>
        </Card>
      )}

      {/* Per-server cards */}
      {resolverData.map((entry) => (
        <Card key={entry.server.id}>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <ServerIcon className="h-4 w-4 text-cyan" />
              {entry.server.name || entry.server.hostname}
              {entry.data?.listeningAddresses && entry.data.listeningAddresses.length > 0 && (
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  Listening: {entry.data.listeningAddresses.join(", ")}
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {entry.error && (
              <div className="rounded border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-300">
                {entry.error}
              </div>
            )}

            {entry.data && (
              <>
                {/* IP Stack DNS Servers */}
                <div>
                  <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-cyan-300">
                    <Globe className="h-3.5 w-3.5" />
                    IP Stack DNS Servers
                  </h3>
                  {entry.data.interfaces.length > 0 ? (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[200px]">Interface</TableHead>
                          <TableHead className="w-[100px]">Family</TableHead>
                          <TableHead>DNS Servers</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {entry.data.interfaces.map((iface: NetworkDnsConfig, i: number) => (
                          <TableRow key={`${iface.InterfaceIndex}-${iface.AddressFamily}-${i}`}>
                            <TableCell className="font-mono text-xs">
                              {iface.InterfaceAlias}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant="outline"
                                className={addressFamilyColor(iface.AddressFamily)}
                              >
                                {addressFamilyLabel(iface.AddressFamily)}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-wrap gap-1.5">
                                {iface.ServerAddresses.map((addr: string) => (
                                  <Badge
                                    key={addr}
                                    variant="outline"
                                    className="font-mono text-xs"
                                  >
                                    {addr}
                                    {KNOWN_RESOLVERS[addr] && (
                                      <span className="ml-1 text-muted-foreground">
                                        ({KNOWN_RESOLVERS[addr]})
                                      </span>
                                    )}
                                  </Badge>
                                ))}
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      No DNS servers configured on network interfaces.
                    </p>
                  )}
                </div>

                <Separator />

                {/* Forwarders */}
                <div>
                  <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-300">
                    <ArrowRightLeft className="h-3.5 w-3.5" />
                    DNS Server Forwarders
                  </h3>
                  {(entry.data.forwarders?.IPAddress || []).length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {(entry.data.forwarders.IPAddress || []).map((ip: string) => (
                        <Badge key={ip} variant="outline" className="font-mono text-xs">
                          {ip}
                          {KNOWN_RESOLVERS[ip] && (
                            <span className="ml-1 text-muted-foreground">
                              ({KNOWN_RESOLVERS[ip]})
                            </span>
                          )}
                        </Badge>
                      ))}
                      <Badge
                        variant="outline"
                        className={
                          entry.data.forwarders.UseRootHint
                            ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                            : "bg-zinc-500/10 text-zinc-400 border-zinc-500/30"
                        }
                      >
                        Root Hints: {entry.data.forwarders.UseRootHint ? "On" : "Off"}
                      </Badge>
                      {entry.data.forwarders.Timeout != null && (
                        <Badge variant="outline" className="text-xs text-muted-foreground">
                          Timeout: {entry.data.forwarders.Timeout}s
                        </Badge>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">No forwarders configured.</p>
                  )}
                </div>

                {/* Discrepancies */}
                {(() => {
                  const disc = findDiscrepancies(entry.data);
                  if (disc.onlyInIpStack.length === 0 && disc.onlyInForwarders.length === 0) {
                    return null;
                  }
                  return (
                    <>
                      <Separator />
                      <div className="rounded border border-amber-500/30 bg-amber-500/5 p-3">
                        <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-300">
                          <AlertTriangle className="h-3.5 w-3.5" />
                          Configuration Discrepancies
                        </h3>
                        <div className="space-y-1 text-xs text-amber-200/80">
                          {disc.onlyInIpStack.length > 0 && (
                            <p>
                              <span className="font-medium">IP Stack only:</span>{" "}
                              {disc.onlyInIpStack.join(", ")} — present in adapter DNS but not
                              in forwarders
                            </p>
                          )}
                          {disc.onlyInForwarders.length > 0 && (
                            <p>
                              <span className="font-medium">Forwarders only:</span>{" "}
                              {disc.onlyInForwarders.join(", ")} — configured as forwarder but
                              not in any adapter&apos;s DNS
                            </p>
                          )}
                        </div>
                      </div>
                    </>
                  );
                })()}
              </>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
