"use client";

import { useEffect, useState, useCallback } from "react";
import { useStore } from "@/lib/store";
import { api } from "@/lib/api";
import { toast } from "sonner";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  ChevronDown,
  ChevronRight,
  Plus,
  Trash2,
  RefreshCw,
  Network,
  Globe,
  GitBranch,
} from "lucide-react";

import type { ClientSubnet, ZoneScope, RecursionScope } from "@/lib/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getServerParams() {
  const server = useStore.getState().getActiveServer();
  if (!server) return {};
  return {
    server: server.hostname,
    serverId: server.id,
    credentialMode: server.credentialMode,
  };
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ObjectsPage() {
  const bridgeConnected = useStore((s) => s.bridgeConnected);
  const clientSubnets = useStore((s) => s.clientSubnets);
  const zoneScopes = useStore((s) => s.zoneScopes);
  const recursionScopes = useStore((s) => s.recursionScopes);
  const setClientSubnets = useStore((s) => s.setClientSubnets);
  const setZoneScopes = useStore((s) => s.setZoneScopes);
  const setRecursionScopes = useStore((s) => s.setRecursionScopes);

  // Section open state
  const [subnetsOpen, setSubnetsOpen] = useState(true);
  const [zoneScopesOpen, setZoneScopesOpen] = useState(true);
  const [recursionOpen, setRecursionOpen] = useState(true);

  // Add-form state: subnets
  const [newSubnetName, setNewSubnetName] = useState("");
  const [newSubnetIPv4, setNewSubnetIPv4] = useState("");
  const [newSubnetIPv6, setNewSubnetIPv6] = useState("");

  // Add-form state: zone scopes
  const [zoneScopeZone, setZoneScopeZone] = useState("");
  const [newZoneScopeName, setNewZoneScopeName] = useState("");
  const [newZoneScopeZone, setNewZoneScopeZone] = useState("");

  // Add-form state: recursion scopes
  const [newRecName, setNewRecName] = useState("");
  const [newRecEnable, setNewRecEnable] = useState(true);
  const [newRecForwarder, setNewRecForwarder] = useState("");

  // Loading flags
  const [loadingSubnets, setLoadingSubnets] = useState(false);
  const [loadingZoneScopes, setLoadingZoneScopes] = useState(false);
  const [loadingRecursion, setLoadingRecursion] = useState(false);

  // ------------------------------------------------------------------
  // Data loading
  // ------------------------------------------------------------------

  const loadSubnets = useCallback(async () => {
    const sp = getServerParams();
    setLoadingSubnets(true);
    try {
      const res = await api.listSubnets(sp.server, sp.serverId, sp.credentialMode);
      if (res.success) {
        setClientSubnets((res as Record<string, unknown>).subnets as ClientSubnet[] ?? []);
      } else {
        toast.error("Failed to load subnets: " + (res.error ?? "Unknown error"));
      }
    } finally {
      setLoadingSubnets(false);
    }
  }, [setClientSubnets]);

  const loadZoneScopes = useCallback(
    async (zone?: string) => {
      const zoneToLoad = zone ?? zoneScopeZone;
      if (!zoneToLoad) {
        toast.error("Enter a zone name to load scopes");
        return;
      }
      const sp = getServerParams();
      setLoadingZoneScopes(true);
      try {
        const res = await api.listZoneScopes(
          zoneToLoad,
          sp.server,
          sp.serverId,
          sp.credentialMode
        );
        if (res.success) {
          const scopes = (res as Record<string, unknown>).scopes as ZoneScope[] ?? [];
          setZoneScopes({
            ...useStore.getState().zoneScopes,
            [zoneToLoad]: scopes,
          });
        } else {
          toast.error("Failed to load zone scopes: " + (res.error ?? "Unknown error"));
        }
      } finally {
        setLoadingZoneScopes(false);
      }
    },
    [zoneScopeZone, setZoneScopes]
  );

  const loadRecursionScopes = useCallback(async () => {
    const sp = getServerParams();
    setLoadingRecursion(true);
    try {
      const res = await api.listRecursionScopes(
        sp.server,
        sp.serverId,
        sp.credentialMode
      );
      if (res.success) {
        setRecursionScopes(
          (res as Record<string, unknown>).scopes as RecursionScope[] ?? []
        );
      } else {
        toast.error(
          "Failed to load recursion scopes: " + (res.error ?? "Unknown error")
        );
      }
    } finally {
      setLoadingRecursion(false);
    }
  }, [setRecursionScopes]);

  // Load on mount when bridge is connected
  useEffect(() => {
    if (bridgeConnected) {
      loadSubnets();
      loadRecursionScopes();
    }
  }, [bridgeConnected, loadSubnets, loadRecursionScopes]);

  // ------------------------------------------------------------------
  // Actions: Client Subnets
  // ------------------------------------------------------------------

  async function handleAddSubnet() {
    if (!newSubnetName.trim()) {
      toast.error("Subnet name is required");
      return;
    }
    const sp = getServerParams();
    const ipv4 = newSubnetIPv4
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const ipv6 = newSubnetIPv6
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const res = await api.createSubnet({
      name: newSubnetName.trim(),
      ipv4Subnets: ipv4.length ? ipv4 : undefined,
      ipv6Subnets: ipv6.length ? ipv6 : undefined,
      ...sp,
    });
    if (res.success) {
      toast.success(`Subnet "${newSubnetName.trim()}" created`);
      setNewSubnetName("");
      setNewSubnetIPv4("");
      setNewSubnetIPv6("");
      loadSubnets();
    } else {
      toast.error("Failed to create subnet: " + (res.error ?? "Unknown error"));
    }
  }

  async function handleDeleteSubnet(name: string) {
    const sp = getServerParams();
    const res = await api.deleteSubnet(name, sp.server, sp.serverId, sp.credentialMode);
    if (res.success) {
      toast.success(`Subnet "${name}" deleted`);
      loadSubnets();
    } else {
      toast.error("Failed to delete subnet: " + (res.error ?? "Unknown error"));
    }
  }

  // ------------------------------------------------------------------
  // Actions: Zone Scopes
  // ------------------------------------------------------------------

  async function handleAddZoneScope() {
    if (!newZoneScopeName.trim() || !newZoneScopeZone.trim()) {
      toast.error("Scope name and zone name are required");
      return;
    }
    const sp = getServerParams();
    const res = await api.createZoneScope({
      name: newZoneScopeName.trim(),
      zoneName: newZoneScopeZone.trim(),
      ...sp,
    });
    if (res.success) {
      toast.success(`Zone scope "${newZoneScopeName.trim()}" created`);
      setNewZoneScopeName("");
      setNewZoneScopeZone("");
      loadZoneScopes(newZoneScopeZone.trim());
    } else {
      toast.error("Failed to create zone scope: " + (res.error ?? "Unknown error"));
    }
  }

  async function handleDeleteZoneScope(name: string, zone: string) {
    const sp = getServerParams();
    const res = await api.deleteZoneScope(
      name,
      zone,
      sp.server,
      sp.serverId,
      sp.credentialMode
    );
    if (res.success) {
      toast.success(`Zone scope "${name}" deleted`);
      loadZoneScopes(zone);
    } else {
      toast.error("Failed to delete zone scope: " + (res.error ?? "Unknown error"));
    }
  }

  // ------------------------------------------------------------------
  // Actions: Recursion Scopes
  // ------------------------------------------------------------------

  async function handleAddRecursionScope() {
    if (!newRecName.trim()) {
      toast.error("Recursion scope name is required");
      return;
    }
    const sp = getServerParams();
    const forwarders = newRecForwarder
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const res = await api.createRecursionScope({
      name: newRecName.trim(),
      enableRecursion: newRecEnable,
      forwarder: forwarders.length ? forwarders : undefined,
      ...sp,
    });
    if (res.success) {
      toast.success(`Recursion scope "${newRecName.trim()}" created`);
      setNewRecName("");
      setNewRecEnable(true);
      setNewRecForwarder("");
      loadRecursionScopes();
    } else {
      toast.error(
        "Failed to create recursion scope: " + (res.error ?? "Unknown error")
      );
    }
  }

  async function handleDeleteRecursionScope(name: string) {
    const sp = getServerParams();
    const res = await api.deleteRecursionScope(
      name,
      sp.server,
      sp.serverId,
      sp.credentialMode
    );
    if (res.success) {
      toast.success(`Recursion scope "${name}" deleted`);
      loadRecursionScopes();
    } else {
      toast.error(
        "Failed to delete recursion scope: " + (res.error ?? "Unknown error")
      );
    }
  }

  // ------------------------------------------------------------------
  // Flatten zone scopes for the table
  // ------------------------------------------------------------------

  const allZoneScopes: ZoneScope[] = Object.values(zoneScopes).flat();

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">DNS Objects</h1>
        <p className="text-sm text-zinc-400 mt-1">
          Manage client subnets, zone scopes, and recursion scopes used by DNS
          policies.
        </p>
      </div>

      {!bridgeConnected && (
        <div className="rounded-md border border-yellow-600/50 bg-yellow-950/30 px-4 py-3 text-sm text-yellow-300">
          Bridge is not connected. Data shown may be stale. Connect to a server
          to manage DNS objects.
        </div>
      )}

      {/* ────────────────── Client Subnets ────────────────── */}
      <Collapsible open={subnetsOpen} onOpenChange={setSubnetsOpen}>
        <div className="rounded-lg border border-zinc-800 bg-zinc-950">
          <div className="flex w-full items-center justify-between px-4 py-3 hover:bg-zinc-900/60 transition-colors">
            <CollapsibleTrigger className="flex items-center gap-3 text-left cursor-pointer flex-1">
              {subnetsOpen ? (
                <ChevronDown className="h-4 w-4 text-zinc-400" />
              ) : (
                <ChevronRight className="h-4 w-4 text-zinc-400" />
              )}
              <Network className="h-4 w-4 text-cyan-400" />
              <span className="font-semibold">Client Subnets</span>
              <Badge variant="secondary" className="ml-2">
                {clientSubnets.length}
              </Badge>
            </CollapsibleTrigger>
            <Button
              variant="ghost"
              size="sm"
              disabled={loadingSubnets || !bridgeConnected}
              onClick={loadSubnets}
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${loadingSubnets ? "animate-spin" : ""}`}
              />
            </Button>
          </div>

          <CollapsibleContent>
            <div className="border-t border-zinc-800 px-4 py-4 space-y-4">
              {/* Add form */}
              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1">
                  <Label className="text-xs text-zinc-400">Name</Label>
                  <Input
                    placeholder="e.g. CorpSubnet"
                    value={newSubnetName}
                    onChange={(e) => setNewSubnetName(e.target.value)}
                    className="h-8 w-44 bg-zinc-900 border-zinc-700"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-zinc-400">
                    IPv4 Subnets (comma-separated)
                  </Label>
                  <Input
                    placeholder="e.g. 10.0.0.0/24, 192.168.1.0/24"
                    value={newSubnetIPv4}
                    onChange={(e) => setNewSubnetIPv4(e.target.value)}
                    className="h-8 w-64 bg-zinc-900 border-zinc-700"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-zinc-400">
                    IPv6 Subnets (comma-separated)
                  </Label>
                  <Input
                    placeholder="e.g. fd00::/64"
                    value={newSubnetIPv6}
                    onChange={(e) => setNewSubnetIPv6(e.target.value)}
                    className="h-8 w-56 bg-zinc-900 border-zinc-700"
                  />
                </div>
                <Button
                  size="sm"
                  onClick={handleAddSubnet}
                  disabled={!bridgeConnected}
                >
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  Add
                </Button>
              </div>

              {/* Table */}
              {clientSubnets.length === 0 ? (
                <p className="text-sm text-zinc-500 py-2">
                  No client subnets found.
                </p>
              ) : (
                <div className="rounded-md border border-zinc-800 overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-zinc-800 hover:bg-transparent">
                        <TableHead className="text-zinc-400">Name</TableHead>
                        <TableHead className="text-zinc-400">
                          IPv4 Subnets
                        </TableHead>
                        <TableHead className="text-zinc-400">
                          IPv6 Subnets
                        </TableHead>
                        <TableHead className="text-zinc-400 w-16" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {clientSubnets.map((subnet) => (
                        <TableRow
                          key={subnet.Name}
                          className="border-zinc-800"
                        >
                          <TableCell className="font-medium">
                            {subnet.Name}
                          </TableCell>
                          <TableCell className="text-zinc-300">
                            {subnet.IPv4Subnet?.join(", ") || "--"}
                          </TableCell>
                          <TableCell className="text-zinc-300">
                            {subnet.IPv6Subnet?.join(", ") || "--"}
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-zinc-400 hover:text-red-400"
                              onClick={() => handleDeleteSubnet(subnet.Name)}
                              disabled={!bridgeConnected}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          </CollapsibleContent>
        </div>
      </Collapsible>

      {/* ────────────────── Zone Scopes ────────────────── */}
      <Collapsible open={zoneScopesOpen} onOpenChange={setZoneScopesOpen}>
        <div className="rounded-lg border border-zinc-800 bg-zinc-950">
          <CollapsibleTrigger>
            <button className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-zinc-900/60 transition-colors">
              <div className="flex items-center gap-3">
                {zoneScopesOpen ? (
                  <ChevronDown className="h-4 w-4 text-zinc-400" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-zinc-400" />
                )}
                <Globe className="h-4 w-4 text-cyan-400" />
                <span className="font-semibold">Zone Scopes</span>
                <Badge variant="secondary" className="ml-2">
                  {allZoneScopes.length}
                </Badge>
              </div>
              <Button
                variant="ghost"
                size="sm"
                disabled={loadingZoneScopes || !bridgeConnected || !zoneScopeZone}
                onClick={(e) => {
                  e.stopPropagation();
                  loadZoneScopes();
                }}
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${loadingZoneScopes ? "animate-spin" : ""}`}
                />
              </Button>
            </button>
          </CollapsibleTrigger>

          <CollapsibleContent>
            <div className="border-t border-zinc-800 px-4 py-4 space-y-4">
              {/* Zone loader */}
              <div className="flex items-end gap-3">
                <div className="space-y-1">
                  <Label className="text-xs text-zinc-400">
                    Zone Name (load scopes for zone)
                  </Label>
                  <Input
                    placeholder="e.g. contoso.com"
                    value={zoneScopeZone}
                    onChange={(e) => setZoneScopeZone(e.target.value)}
                    className="h-8 w-56 bg-zinc-900 border-zinc-700"
                  />
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => loadZoneScopes()}
                  disabled={!bridgeConnected || !zoneScopeZone.trim()}
                >
                  Load Scopes
                </Button>
              </div>

              {/* Add form */}
              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1">
                  <Label className="text-xs text-zinc-400">Scope Name</Label>
                  <Input
                    placeholder="e.g. InternalScope"
                    value={newZoneScopeName}
                    onChange={(e) => setNewZoneScopeName(e.target.value)}
                    className="h-8 w-44 bg-zinc-900 border-zinc-700"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-zinc-400">Zone Name</Label>
                  <Input
                    placeholder="e.g. contoso.com"
                    value={newZoneScopeZone}
                    onChange={(e) => setNewZoneScopeZone(e.target.value)}
                    className="h-8 w-56 bg-zinc-900 border-zinc-700"
                  />
                </div>
                <Button
                  size="sm"
                  onClick={handleAddZoneScope}
                  disabled={!bridgeConnected}
                >
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  Add
                </Button>
              </div>

              {/* Table */}
              {allZoneScopes.length === 0 ? (
                <p className="text-sm text-zinc-500 py-2">
                  No zone scopes loaded. Enter a zone name above and click
                  &quot;Load Scopes&quot;.
                </p>
              ) : (
                <div className="rounded-md border border-zinc-800 overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-zinc-800 hover:bg-transparent">
                        <TableHead className="text-zinc-400">Name</TableHead>
                        <TableHead className="text-zinc-400">
                          Zone Name
                        </TableHead>
                        <TableHead className="text-zinc-400 w-16" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {allZoneScopes.map((scope) => (
                        <TableRow
                          key={`${scope.ZoneName}-${scope.Name}`}
                          className="border-zinc-800"
                        >
                          <TableCell className="font-medium">
                            {scope.Name}
                          </TableCell>
                          <TableCell className="text-zinc-300">
                            {scope.ZoneName}
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-zinc-400 hover:text-red-400"
                              onClick={() =>
                                handleDeleteZoneScope(scope.Name, scope.ZoneName)
                              }
                              disabled={!bridgeConnected}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          </CollapsibleContent>
        </div>
      </Collapsible>

      {/* ────────────────── Recursion Scopes ────────────────── */}
      <Collapsible open={recursionOpen} onOpenChange={setRecursionOpen}>
        <div className="rounded-lg border border-zinc-800 bg-zinc-950">
          <CollapsibleTrigger>
            <button className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-zinc-900/60 transition-colors">
              <div className="flex items-center gap-3">
                {recursionOpen ? (
                  <ChevronDown className="h-4 w-4 text-zinc-400" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-zinc-400" />
                )}
                <GitBranch className="h-4 w-4 text-cyan-400" />
                <span className="font-semibold">Recursion Scopes</span>
                <Badge variant="secondary" className="ml-2">
                  {recursionScopes.length}
                </Badge>
              </div>
              <Button
                variant="ghost"
                size="sm"
                disabled={loadingRecursion || !bridgeConnected}
                onClick={(e) => {
                  e.stopPropagation();
                  loadRecursionScopes();
                }}
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${loadingRecursion ? "animate-spin" : ""}`}
                />
              </Button>
            </button>
          </CollapsibleTrigger>

          <CollapsibleContent>
            <div className="border-t border-zinc-800 px-4 py-4 space-y-4">
              {/* Add form */}
              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1">
                  <Label className="text-xs text-zinc-400">Name</Label>
                  <Input
                    placeholder="e.g. InternalRecursion"
                    value={newRecName}
                    onChange={(e) => setNewRecName(e.target.value)}
                    className="h-8 w-48 bg-zinc-900 border-zinc-700"
                  />
                </div>
                <div className="flex items-center gap-2 pb-0.5">
                  <Switch
                    id="rec-enable"
                    checked={newRecEnable}
                    onCheckedChange={setNewRecEnable}
                  />
                  <Label htmlFor="rec-enable" className="text-xs text-zinc-400">
                    Enable Recursion
                  </Label>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-zinc-400">
                    Forwarder IPs (comma-separated)
                  </Label>
                  <Input
                    placeholder="e.g. 8.8.8.8, 1.1.1.1"
                    value={newRecForwarder}
                    onChange={(e) => setNewRecForwarder(e.target.value)}
                    className="h-8 w-56 bg-zinc-900 border-zinc-700"
                  />
                </div>
                <Button
                  size="sm"
                  onClick={handleAddRecursionScope}
                  disabled={!bridgeConnected}
                >
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  Add
                </Button>
              </div>

              {/* Table */}
              {recursionScopes.length === 0 ? (
                <p className="text-sm text-zinc-500 py-2">
                  No recursion scopes found.
                </p>
              ) : (
                <div className="rounded-md border border-zinc-800 overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-zinc-800 hover:bg-transparent">
                        <TableHead className="text-zinc-400">Name</TableHead>
                        <TableHead className="text-zinc-400">
                          Enable Recursion
                        </TableHead>
                        <TableHead className="text-zinc-400">
                          Forwarder
                        </TableHead>
                        <TableHead className="text-zinc-400 w-16" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {recursionScopes.map((scope) => (
                        <TableRow
                          key={scope.Name}
                          className="border-zinc-800"
                        >
                          <TableCell className="font-medium">
                            {scope.Name}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={
                                scope.EnableRecursion !== false
                                  ? "default"
                                  : "secondary"
                              }
                              className={
                                scope.EnableRecursion !== false
                                  ? "bg-emerald-900/50 text-emerald-300 border-emerald-700/50"
                                  : "bg-zinc-800 text-zinc-400"
                              }
                            >
                              {scope.EnableRecursion !== false ? "Yes" : "No"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-zinc-300">
                            {scope.Forwarder?.join(", ") || "--"}
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-zinc-400 hover:text-red-400"
                              onClick={() =>
                                handleDeleteRecursionScope(scope.Name)
                              }
                              disabled={!bridgeConnected}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          </CollapsibleContent>
        </div>
      </Collapsible>
    </div>
  );
}
