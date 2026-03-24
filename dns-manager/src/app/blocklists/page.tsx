"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useStore } from "@/lib/store";
import { api } from "@/lib/api";
import { getServerParams } from "@/lib/utils";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ShieldAlert,
  ShieldBan,
  ShieldCheck,
  Plus,
  Trash2,
  Upload,
  FileText,
  Loader2,
  RefreshCw,
  Search,
} from "lucide-react";

import type { PolicyAction } from "@/lib/types";

/* eslint-disable @typescript-eslint/no-explicit-any */

function sanitizeDomainName(domain: string): string {
  return domain.replace(/[^a-zA-Z0-9.-]/g, "_").replace(/\./g, "_");
}

function parseBlocklist(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

export default function BlocklistsPage() {
  const bridgeConnected = useStore((s) => s.bridgeConnected);
  const executionMode = useStore((s) => s.executionMode);
  const addPsOutput = useStore((s) => s.addPsOutput);

  // ── Quick Block ──
  const [quickDomain, setQuickDomain] = useState("");
  const [quickZone, setQuickZone] = useState("");
  const [quickAction, setQuickAction] = useState<PolicyAction>("DENY");
  const [quickBlocking, setQuickBlocking] = useState(false);

  // ── Bulk Import ──
  const fileRef = useRef<HTMLInputElement>(null);
  const [domains, setDomains] = useState<string[]>([]);
  const [bulkAction, setBulkAction] = useState<PolicyAction>("DENY");
  const [bulkZone, setBulkZone] = useState("");
  const [bulkStartOrder, setBulkStartOrder] = useState(1);
  const [bulkImporting, setBulkImporting] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({ done: 0, total: 0 });
  const [dragOver, setDragOver] = useState(false);

  // ── Active Block Policies ──
  const [blockPolicies, setBlockPolicies] = useState<any[]>([]);
  const [loadingPolicies, setLoadingPolicies] = useState(false);
  const [policySearch, setPolicySearch] = useState("");

  // ── Global Query Block List ──
  const [globalBlockList, setGlobalBlockList] = useState<string[]>([]);
  const [loadingGlobal, setLoadingGlobal] = useState(false);
  const [newGlobalDomain, setNewGlobalDomain] = useState("");

  // ── Load active block policies ──
  const loadBlockPolicies = useCallback(async () => {
    const p = getServerParams();
    setLoadingPolicies(true);
    try {
      // Fetch server-level policies
      const res = await api.listPolicies(p.server, undefined, p.serverId, p.credentialMode);
      if (res.success) {
        const policies = ((res as any).policies || []) as any[];
        // Filter to DENY/IGNORE actions (block-related)
        const blocked = policies.filter(
          (pol: any) => pol.Action === "DENY" || pol.Action === "IGNORE"
        );
        setBlockPolicies(blocked);
      }
    } catch {
      toast.error("Failed to load block policies");
    }
    setLoadingPolicies(false);
  }, []);

  // ── Load Global Query Block List ──
  const loadGlobalBlockList = useCallback(async () => {
    const p = getServerParams();
    setLoadingGlobal(true);
    try {
      const res = await api.getBlockList(p.server, p.serverId, p.credentialMode);
      if (res.success) {
        const bl = (res as any).blocklist;
        setGlobalBlockList(bl?.List || bl?.Enable ? (bl.List || []) : []);
      }
    } catch {
      toast.error("Failed to load global block list");
    }
    setLoadingGlobal(false);
  }, []);

  useEffect(() => {
    if (!bridgeConnected) return;
    /* eslint-disable react-hooks/set-state-in-effect -- async data fetch on mount, setState is in the async callbacks */
    loadBlockPolicies();
    loadGlobalBlockList();
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [bridgeConnected, loadBlockPolicies, loadGlobalBlockList]);

  // ── Quick Block handler ──
  async function handleQuickBlock() {
    if (!quickDomain.trim()) { toast.error("Enter a domain"); return; }
    if (!quickZone.trim()) { toast.error("Enter a zone name"); return; }
    setQuickBlocking(true);
    const p = getServerParams();

    const sanitized = sanitizeDomainName(quickDomain.trim());
    const policyData: Record<string, unknown> = {
      name: `Block_${sanitized}`,
      action: quickAction,
      fqdn: `EQ,${quickDomain.trim()}`,
      zoneName: quickZone.trim(),
      server: p.server,
      serverId: p.serverId,
      credentialMode: p.credentialMode,
    };

    const command = `Add-DnsServerQueryResolutionPolicy -Name "Block_${sanitized}" -Action ${quickAction} -Fqdn "EQ,${quickDomain.trim()}" -ZoneName "${quickZone.trim()}"`;
    addPsOutput(`[${new Date().toLocaleTimeString()}] ${command}`);

    if (executionMode === "execute" && bridgeConnected) {
      const res = await api.addPolicy(policyData);
      if (res.success) {
        toast.success(`Blocked ${quickDomain.trim()}`);
        setQuickDomain("");
        loadBlockPolicies();
      } else {
        toast.error("Failed: " + res.error);
      }
    } else {
      toast.success("Command generated — check PowerShell tab");
    }
    setQuickBlocking(false);
  }

  // ── Bulk import handler ──
  const handleFileLoad = useCallback((file: File) => {
    if (!file.name.endsWith(".txt")) { toast.error("Please select a .txt file"); return; }
    const reader = new FileReader();
    reader.onload = (e) => {
      const parsed = parseBlocklist(e.target?.result as string);
      if (parsed.length === 0) { toast.error("No domains found"); return; }
      setDomains(parsed);
      toast.success(`Loaded ${parsed.length} domains`);
    };
    reader.readAsText(file);
  }, []);

  async function handleBulkImport() {
    if (!bulkZone.trim()) { toast.error("Zone name is required"); return; }
    if (domains.length === 0) { toast.error("No domains loaded"); return; }

    setBulkImporting(true);
    setBulkProgress({ done: 0, total: domains.length });
    const p = getServerParams();
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < domains.length; i++) {
      const domain = domains[i];
      const sanitized = sanitizeDomainName(domain);
      const policyData: Record<string, unknown> = {
        name: `Block_${sanitized}`,
        action: bulkAction,
        fqdn: `EQ,${domain}`,
        zoneName: bulkZone.trim(),
        processingOrder: String(bulkStartOrder + i),
        server: p.server,
        serverId: p.serverId,
        credentialMode: p.credentialMode,
      };

      const command = `Add-DnsServerQueryResolutionPolicy -Name "Block_${sanitized}" -Action ${bulkAction} -Fqdn "EQ,${domain}" -ZoneName "${bulkZone.trim()}" -ProcessingOrder ${bulkStartOrder + i}`;
      addPsOutput(`[${new Date().toLocaleTimeString()}] ${command}`);

      if (executionMode === "execute" && bridgeConnected) {
        try {
          const res = await api.addPolicy(policyData);
          if (res.success) successCount++;
          else failCount++;
        } catch { failCount++; }
      } else {
        successCount++;
      }
      if ((i + 1) % 10 === 0 || i === domains.length - 1) {
        setBulkProgress({ done: i + 1, total: domains.length });
      }
    }

    setBulkImporting(false);
    if (executionMode === "execute" && bridgeConnected) {
      if (failCount === 0) toast.success(`Created ${successCount} block policies`);
      else toast.warning(`${successCount} succeeded, ${failCount} failed`);
      loadBlockPolicies();
    } else {
      toast.success(`Generated ${domains.length} commands — check PowerShell tab`);
    }
  }

  // ── Delete block policy ──
  async function handleDeletePolicy(name: string, zoneName?: string) {
    const p = getServerParams();
    const res = await api.removePolicy(name, p.server, zoneName, p.serverId, p.credentialMode);
    if (res.success) {
      toast.success(`Removed "${name}"`);
      loadBlockPolicies();
    } else {
      toast.error("Failed: " + res.error);
    }
  }

  // ── Global block list management ──
  async function handleAddGlobalDomain() {
    if (!newGlobalDomain.trim()) return;
    const p = getServerParams();
    const updated = [...globalBlockList, newGlobalDomain.trim()];
    const res = await api.setBlockList({ list: updated }, p.server, p.serverId, p.credentialMode);
    if (res.success) {
      toast.success(`Added "${newGlobalDomain.trim()}" to global block list`);
      setNewGlobalDomain("");
      loadGlobalBlockList();
    } else {
      toast.error("Failed: " + res.error);
    }
  }

  async function handleRemoveGlobalDomain(domain: string) {
    const p = getServerParams();
    const updated = globalBlockList.filter((d) => d !== domain);
    const res = await api.setBlockList({ list: updated }, p.server, p.serverId, p.credentialMode);
    if (res.success) {
      toast.success(`Removed "${domain}" from global block list`);
      loadGlobalBlockList();
    } else {
      toast.error("Failed: " + res.error);
    }
  }

  // ── Filtered block policies ──
  const filteredPolicies = useMemo(() => {
    if (!policySearch.trim()) return blockPolicies;
    const term = policySearch.toLowerCase();
    return blockPolicies.filter((p: any) =>
      p.Name?.toLowerCase().includes(term) ||
      p.Fqdn?.toLowerCase().includes(term)
    );
  }, [blockPolicies, policySearch]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">
          Blocklists
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Block domains via DNS policies. Quick block individual domains, bulk
          import from text files, or manage the server&apos;s global query block list.
        </p>
      </div>

      {/* ── Quick Block ──────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldBan className="h-4 w-4 text-red-400" />
            Quick Block
          </CardTitle>
          <CardDescription>
            Instantly block a single domain with a DENY or IGNORE policy.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5 flex-1 min-w-[200px]">
              <Label className="text-xs text-muted-foreground">Domain</Label>
              <Input
                placeholder="e.g. malware.example.com"
                value={quickDomain}
                onChange={(e) => setQuickDomain(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleQuickBlock()}
              />
            </div>
            <div className="space-y-1.5 min-w-[180px]">
              <Label className="text-xs text-muted-foreground">Zone</Label>
              <Input
                placeholder="e.g. contoso.com"
                value={quickZone}
                onChange={(e) => setQuickZone(e.target.value)}
              />
            </div>
            <div className="space-y-1.5 w-[120px]">
              <Label className="text-xs text-muted-foreground">Action</Label>
              <Select value={quickAction} onValueChange={(v) => { if (v) setQuickAction(v as PolicyAction); }}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="DENY">DENY</SelectItem>
                  <SelectItem value="IGNORE">IGNORE</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              onClick={handleQuickBlock}
              disabled={quickBlocking || !quickDomain.trim() || !quickZone.trim()}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {quickBlocking ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <ShieldBan className="h-4 w-4 mr-2" />
              )}
              Block Domain
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ── Bulk Import ──────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Upload className="h-4 w-4 text-cyan" />
            Bulk Blocklist Import
          </CardTitle>
          <CardDescription>
            Import a text file of domains to create block policies in bulk.
            One domain per line; lines starting with <code className="text-muted-foreground">#</code> are ignored.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Drop zone */}
          <div
            className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors cursor-pointer ${
              dragOver
                ? "border-cyan bg-cyan/5"
                : "border-border hover:border-muted-foreground/40"
            }`}
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const f = e.dataTransfer.files[0];
              if (f) handleFileLoad(f);
            }}
          >
            <FileText className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Drag &amp; drop a <span className="text-foreground">.txt</span> blocklist, or click to browse
            </p>
            <input
              ref={fileRef}
              type="file"
              accept=".txt"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileLoad(f); }}
            />
          </div>

          {/* Preview */}
          {domains.length > 0 && (
            <>
              <div className="rounded border border-border bg-background/50 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Domains Loaded</span>
                  <Badge variant="secondary">{domains.length}</Badge>
                </div>
                <ScrollArea className="h-32 rounded border border-border bg-background p-2">
                  <div className="space-y-0.5 font-mono text-xs text-muted-foreground">
                    {domains.slice(0, 20).map((d, i) => (
                      <div key={i}>{d}</div>
                    ))}
                    {domains.length > 20 && (
                      <div className="text-muted-foreground/50 pt-1">
                        ... and {domains.length - 20} more
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </div>

              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1.5 w-[120px]">
                  <Label className="text-xs text-muted-foreground">Action</Label>
                  <Select value={bulkAction} onValueChange={(v) => { if (v) setBulkAction(v as PolicyAction); }}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="DENY">DENY</SelectItem>
                      <SelectItem value="IGNORE">IGNORE</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5 min-w-[180px]">
                  <Label className="text-xs text-muted-foreground">Zone <span className="text-red-400">*</span></Label>
                  <Input
                    placeholder="e.g. contoso.com"
                    value={bulkZone}
                    onChange={(e) => setBulkZone(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5 w-[130px]">
                  <Label className="text-xs text-muted-foreground">Order Start</Label>
                  <Input
                    type="number"
                    min={1}
                    value={bulkStartOrder}
                    onChange={(e) => setBulkStartOrder(parseInt(e.target.value, 10) || 1)}
                  />
                </div>
                <Button
                  onClick={handleBulkImport}
                  disabled={bulkImporting || domains.length === 0 || !bulkZone.trim()}
                >
                  {bulkImporting ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <ShieldAlert className="h-4 w-4 mr-2" />
                  )}
                  Import {domains.length} Domains
                </Button>
              </div>

              {bulkImporting && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <div className="w-48 h-2 bg-secondary rounded-full overflow-hidden">
                    <div
                      className="h-full bg-cyan transition-all duration-300"
                      style={{ width: `${bulkProgress.total > 0 ? (bulkProgress.done / bulkProgress.total) * 100 : 0}%` }}
                    />
                  </div>
                  <span>{bulkProgress.done}/{bulkProgress.total}</span>
                </div>
              )}

              {executionMode !== "execute" && (
                <p className="text-xs text-amber-400">
                  Execution mode is &quot;Generate&quot; — commands go to the PowerShell tab.
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* ── Active Block Policies ────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <ShieldAlert className="h-4 w-4 text-amber-400" />
                Active Block Policies
                {blockPolicies.length > 0 && (
                  <Badge variant="secondary" className="text-xs">{blockPolicies.length}</Badge>
                )}
              </CardTitle>
              <CardDescription>
                Server-level DENY and IGNORE policies currently active.
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={loadBlockPolicies}
              disabled={loadingPolicies || !bridgeConnected}
            >
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loadingPolicies ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
          {blockPolicies.length > 5 && (
            <div className="relative mt-2">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search policies..."
                value={policySearch}
                onChange={(e) => setPolicySearch(e.target.value)}
                className="pl-8 h-8 text-xs"
              />
            </div>
          )}
        </CardHeader>
        <CardContent>
          {!bridgeConnected ? (
            <p className="text-sm text-muted-foreground">Connect to a server to view block policies.</p>
          ) : loadingPolicies ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : filteredPolicies.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {blockPolicies.length === 0
                ? "No DENY or IGNORE policies found on this server."
                : "No policies match your search."}
            </p>
          ) : (
            <ScrollArea className="max-h-[400px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead className="w-[80px]">Action</TableHead>
                    <TableHead>FQDN Match</TableHead>
                    <TableHead className="w-[60px]">Order</TableHead>
                    <TableHead className="w-[60px]">Enabled</TableHead>
                    <TableHead className="w-[40px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredPolicies.map((pol: any) => (
                    <TableRow key={pol.Name}>
                      <TableCell className="font-mono text-xs">{pol.Name}</TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={
                            pol.Action === "DENY"
                              ? "bg-red-500/10 text-red-400 border-red-500/30"
                              : "bg-amber-500/10 text-amber-400 border-amber-500/30"
                          }
                        >
                          {pol.Action}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {pol.Fqdn || "—"}
                      </TableCell>
                      <TableCell className="text-xs">{pol.ProcessingOrder}</TableCell>
                      <TableCell>
                        {pol.IsEnabled ? (
                          <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
                        ) : (
                          <span className="text-xs text-muted-foreground">Off</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-red-400 hover:text-red-300"
                          onClick={() => handleDeletePolicy(pol.Name, pol.ZoneName)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {/* ── Global Query Block List ──────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <ShieldAlert className="h-4 w-4 text-purple-400" />
                Global Query Block List
              </CardTitle>
              <CardDescription>
                Server-wide block list (<code className="text-muted-foreground">Get-DnsServerGlobalQueryBlockList</code>).
                Queries for these domains are silently dropped regardless of zone policies.
                Default entries are <code className="text-muted-foreground">isatap</code> and <code className="text-muted-foreground">wpad</code>.
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={loadGlobalBlockList}
              disabled={loadingGlobal || !bridgeConnected}
            >
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loadingGlobal ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {!bridgeConnected ? (
            <p className="text-sm text-muted-foreground">Connect to a server.</p>
          ) : loadingGlobal ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : (
            <>
              {globalBlockList.length === 0 ? (
                <p className="text-sm text-muted-foreground">Global block list is empty.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {globalBlockList.map((domain) => (
                    <Badge
                      key={domain}
                      variant="outline"
                      className="font-mono text-xs gap-1.5 pr-1"
                    >
                      {domain}
                      <button
                        onClick={() => handleRemoveGlobalDomain(domain)}
                        className="ml-1 text-red-400 hover:text-red-300"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}

              <div className="flex gap-2">
                <Input
                  placeholder="Add domain (e.g. wpad)"
                  value={newGlobalDomain}
                  onChange={(e) => setNewGlobalDomain(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddGlobalDomain()}
                  className="max-w-xs"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleAddGlobalDomain}
                  disabled={!newGlobalDomain.trim() || !bridgeConnected}
                >
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  Add
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
