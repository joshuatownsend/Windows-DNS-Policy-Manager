"use client";

import { useState, useRef, useCallback } from "react";
import { useStore } from "@/lib/store";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
  Download,
  Upload,
  FileText,
  ShieldAlert,
  Loader2,
} from "lucide-react";

import type { BackupData, PolicyAction } from "@/lib/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function downloadJson(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function sanitizeDomainName(domain: string): string {
  return domain.replace(/[^a-zA-Z0-9.-]/g, "_").replace(/\./g, "_");
}

function parseBlocklist(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function BackupPage() {
  const servers = useStore((s) => s.servers);
  const executionMode = useStore((s) => s.executionMode);
  const addPsOutput = useStore((s) => s.addPsOutput);
  const bridgeConnected = useStore((s) => s.bridgeConnected);

  // ── Export state ──
  const [exportServer, setExportServer] = useState<string>("");
  const [includeZone, setIncludeZone] = useState(true);
  const [includeServer, setIncludeServer] = useState(true);
  const [exporting, setExporting] = useState(false);

  // ── Import state ──
  const importFileRef = useRef<HTMLInputElement>(null);
  const [importData, setImportData] = useState<BackupData | null>(null);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState({ done: 0, total: 0 });
  const [dragOverImport, setDragOverImport] = useState(false);

  // ── Blocklist state ──
  const blocklistFileRef = useRef<HTMLInputElement>(null);
  const [blocklistDomains, setBlocklistDomains] = useState<string[]>([]);
  const [blocklistAction, setBlocklistAction] = useState<PolicyAction>("DENY");
  const [blocklistZone, setBlocklistZone] = useState("");
  const [blocklistStartOrder, setBlocklistStartOrder] = useState(1);
  const [blocklistImporting, setBlocklistImporting] = useState(false);
  const [blocklistProgress, setBlocklistProgress] = useState({ done: 0, total: 0 });
  const [dragOverBlocklist, setDragOverBlocklist] = useState(false);

  // ------------------------------------------------------------------
  // Export
  // ------------------------------------------------------------------

  async function handleExport() {
    const server = exportServer || "localhost";
    setExporting(true);
    try {
      const res = await api.backup(server, includeZone, includeServer);
      if (res.success && res.data) {
        const data = res.data as BackupData;
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        downloadJson(data, `dns-policies-${server}-${timestamp}.json`);
        toast.success("Policies exported successfully");
      } else {
        toast.error("Export failed: " + (res.error ?? "Unknown error"));
      }
    } catch {
      toast.error("Export failed: unexpected error");
    } finally {
      setExporting(false);
    }
  }

  // ------------------------------------------------------------------
  // Import
  // ------------------------------------------------------------------

  const handleImportFileLoad = useCallback((file: File) => {
    if (!file.name.endsWith(".json")) {
      toast.error("Please select a .json file");
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target?.result as string) as BackupData;
        if (!data.policies && !data.zonePolicies && !data.serverPolicies) {
          toast.error("Invalid backup file: no policies found");
          return;
        }
        setImportData(data);
        toast.success("Backup file loaded");
      } catch {
        toast.error("Failed to parse JSON file");
      }
    };
    reader.readAsText(file);
  }, []);

  function handleImportFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleImportFileLoad(file);
  }

  function handleImportDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOverImport(false);
    const file = e.dataTransfer.files[0];
    if (file) handleImportFileLoad(file);
  }

  async function handleImportAll() {
    if (!importData) return;

    const allPolicies = [
      ...(importData.policies || []),
      ...(importData.zonePolicies || []),
      ...(importData.serverPolicies || []),
    ];

    if (allPolicies.length === 0) {
      toast.error("No policies to import");
      return;
    }

    setImporting(true);
    setImportProgress({ done: 0, total: allPolicies.length });

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < allPolicies.length; i++) {
      const policy = allPolicies[i];
      try {
        const res = await api.addPolicy(policy as Record<string, unknown>);
        if (res.success) {
          successCount++;
        } else {
          failCount++;
          toast.error(`Failed to import "${policy.Name}": ${res.error}`);
        }
      } catch {
        failCount++;
      }
      setImportProgress({ done: i + 1, total: allPolicies.length });
    }

    setImporting(false);
    if (failCount === 0) {
      toast.success(`Successfully imported ${successCount} policies`);
    } else {
      toast.warning(
        `Import complete: ${successCount} succeeded, ${failCount} failed`
      );
    }
  }

  // ------------------------------------------------------------------
  // Blocklist
  // ------------------------------------------------------------------

  const handleBlocklistFileLoad = useCallback((file: File) => {
    if (!file.name.endsWith(".txt")) {
      toast.error("Please select a .txt file");
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const domains = parseBlocklist(text);
      if (domains.length === 0) {
        toast.error("No domains found in file");
        return;
      }
      setBlocklistDomains(domains);
      toast.success(`Loaded ${domains.length} domains`);
    };
    reader.readAsText(file);
  }, []);

  function handleBlocklistFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleBlocklistFileLoad(file);
  }

  function handleBlocklistDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOverBlocklist(false);
    const file = e.dataTransfer.files[0];
    if (file) handleBlocklistFileLoad(file);
  }

  async function handleBlocklistImport() {
    if (!blocklistZone.trim()) {
      toast.error("Zone name is required");
      return;
    }
    if (blocklistDomains.length === 0) {
      toast.error("No domains loaded");
      return;
    }

    setBlocklistImporting(true);
    setBlocklistProgress({ done: 0, total: blocklistDomains.length });

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < blocklistDomains.length; i++) {
      const domain = blocklistDomains[i];
      const sanitized = sanitizeDomainName(domain);
      const policyData: Record<string, unknown> = {
        name: `Block_${sanitized}`,
        action: blocklistAction,
        fqdn: `EQ,${domain}`,
        zoneName: blocklistZone.trim(),
        processingOrder: String(blocklistStartOrder + i),
      };

      const timestamp = new Date().toLocaleTimeString();
      const command = `Add-DnsServerQueryResolutionPolicy -Name "Block_${sanitized}" -Action ${blocklistAction} -Fqdn "EQ,${domain}" -ZoneName "${blocklistZone.trim()}" -ProcessingOrder ${blocklistStartOrder + i}`;
      addPsOutput(`[${timestamp}] ${command}`);

      if (executionMode === "execute" && bridgeConnected) {
        try {
          const res = await api.addPolicy(policyData);
          if (res.success) {
            successCount++;
          } else {
            failCount++;
          }
        } catch {
          failCount++;
        }
      } else {
        successCount++;
      }
      setBlocklistProgress({ done: i + 1, total: blocklistDomains.length });
    }

    setBlocklistImporting(false);

    if (executionMode === "execute" && bridgeConnected) {
      if (failCount === 0) {
        toast.success(`Successfully created ${successCount} block policies`);
      } else {
        toast.warning(
          `Blocklist import: ${successCount} succeeded, ${failCount} failed`
        );
      }
    } else {
      toast.success(
        `Generated ${blocklistDomains.length} PowerShell commands. Check the PowerShell tab.`
      );
    }
  }

  // ------------------------------------------------------------------
  // Import policy count
  // ------------------------------------------------------------------

  const importPolicyCount = importData
    ? (importData.policies?.length ?? 0) +
      (importData.zonePolicies?.length ?? 0) +
      (importData.serverPolicies?.length ?? 0)
    : 0;

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Backup & Import</h1>
        <p className="text-sm text-zinc-400 mt-1">
          Export, import, and restore DNS policies. Import blocklists to create
          bulk deny/ignore policies.
        </p>
      </div>

      {/* ────────────────── Export Policies ────────────────── */}
      <Card className="border-zinc-800 bg-zinc-950">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Download className="h-5 w-5 text-cyan-400" />
            Export Policies
          </CardTitle>
          <CardDescription>
            Back up all DNS policies from a server to a JSON file.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1.5 min-w-[200px]">
              <Label className="text-xs text-zinc-400">Server</Label>
              <Select value={exportServer} onValueChange={(v) => { if (v) setExportServer(v); }}>
                <SelectTrigger className="bg-zinc-900 border-zinc-700">
                  <SelectValue placeholder="Select a server" />
                </SelectTrigger>
                <SelectContent>
                  {servers.length === 0 ? (
                    <SelectItem value="localhost">localhost</SelectItem>
                  ) : (
                    servers.map((s) => (
                      <SelectItem key={s.id} value={s.hostname}>
                        {s.name} ({s.hostname})
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeZone}
                  onChange={(e) => setIncludeZone(e.target.checked)}
                  className="rounded border-zinc-600 bg-zinc-800 text-cyan-500 focus:ring-cyan-500"
                />
                Include Zone Policies
              </label>
              <label className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeServer}
                  onChange={(e) => setIncludeServer(e.target.checked)}
                  className="rounded border-zinc-600 bg-zinc-800 text-cyan-500 focus:ring-cyan-500"
                />
                Include Server Policies
              </label>
            </div>

            <Button
              onClick={handleExport}
              disabled={exporting || !bridgeConnected}
            >
              {exporting ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Download className="h-4 w-4 mr-2" />
              )}
              Export Policies
            </Button>
          </div>

          {!bridgeConnected && (
            <p className="text-xs text-yellow-400">
              Bridge is not connected. Connect to a server to export policies.
            </p>
          )}
        </CardContent>
      </Card>

      {/* ────────────────── Import Policies ────────────────── */}
      <Card className="border-zinc-800 bg-zinc-950">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Upload className="h-5 w-5 text-cyan-400" />
            Import Policies
          </CardTitle>
          <CardDescription>
            Restore policies from a previously exported JSON backup file.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Drop zone */}
          <div
            className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer ${
              dragOverImport
                ? "border-cyan-500 bg-cyan-950/20"
                : "border-zinc-700 hover:border-zinc-500"
            }`}
            onClick={() => importFileRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOverImport(true);
            }}
            onDragLeave={() => setDragOverImport(false)}
            onDrop={handleImportDrop}
          >
            <FileText className="h-10 w-10 mx-auto mb-3 text-zinc-500" />
            <p className="text-sm text-zinc-400">
              Drag & drop a <span className="text-zinc-200">.json</span> backup
              file here, or click to browse
            </p>
            <input
              ref={importFileRef}
              type="file"
              accept=".json"
              className="hidden"
              onChange={handleImportFileChange}
            />
          </div>

          {/* Preview */}
          {importData && (
            <>
              <Separator className="bg-zinc-800" />
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 space-y-2">
                <h3 className="text-sm font-semibold text-zinc-200">
                  Backup Summary
                </h3>
                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div>
                    <span className="text-zinc-500">Server:</span>{" "}
                    <span className="text-zinc-200">
                      {importData.server || "Unknown"}
                    </span>
                  </div>
                  <div>
                    <span className="text-zinc-500">Export Date:</span>{" "}
                    <span className="text-zinc-200">
                      {importData.exportDate
                        ? new Date(importData.exportDate).toLocaleString()
                        : "Unknown"}
                    </span>
                  </div>
                  <div>
                    <span className="text-zinc-500">Policies:</span>{" "}
                    <Badge variant="secondary" className="ml-1">
                      {importPolicyCount}
                    </Badge>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <Button
                  onClick={handleImportAll}
                  disabled={importing || !bridgeConnected || importPolicyCount === 0}
                >
                  {importing ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Upload className="h-4 w-4 mr-2" />
                  )}
                  Import All ({importPolicyCount})
                </Button>

                {importing && (
                  <div className="flex items-center gap-2 text-sm text-zinc-400">
                    <div className="w-40 h-2 bg-zinc-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-cyan-500 transition-all duration-300"
                        style={{
                          width: `${
                            importProgress.total > 0
                              ? (importProgress.done / importProgress.total) * 100
                              : 0
                          }%`,
                        }}
                      />
                    </div>
                    <span>
                      {importProgress.done}/{importProgress.total}
                    </span>
                  </div>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* ────────────────── Blocklist Import ────────────────── */}
      <Card className="border-zinc-800 bg-zinc-950">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <ShieldAlert className="h-5 w-5 text-cyan-400" />
            Blocklist Import
          </CardTitle>
          <CardDescription>
            Import a text file of domains to create bulk block/ignore policies.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-zinc-500">
            One domain per line. Lines starting with <code className="text-zinc-400">#</code> are
            treated as comments and ignored.
          </p>

          {/* Drop zone */}
          <div
            className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer ${
              dragOverBlocklist
                ? "border-cyan-500 bg-cyan-950/20"
                : "border-zinc-700 hover:border-zinc-500"
            }`}
            onClick={() => blocklistFileRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOverBlocklist(true);
            }}
            onDragLeave={() => setDragOverBlocklist(false)}
            onDrop={handleBlocklistDrop}
          >
            <FileText className="h-10 w-10 mx-auto mb-3 text-zinc-500" />
            <p className="text-sm text-zinc-400">
              Drag & drop a <span className="text-zinc-200">.txt</span>{" "}
              blocklist file here, or click to browse
            </p>
            <input
              ref={blocklistFileRef}
              type="file"
              accept=".txt"
              className="hidden"
              onChange={handleBlocklistFileChange}
            />
          </div>

          {/* Preview */}
          {blocklistDomains.length > 0 && (
            <>
              <Separator className="bg-zinc-800" />
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-zinc-200">
                    Domains Loaded
                  </h3>
                  <Badge variant="secondary">{blocklistDomains.length}</Badge>
                </div>
                <ScrollArea className="h-40 rounded-md border border-zinc-800 bg-zinc-950 p-3">
                  <div className="space-y-1 font-mono text-xs text-zinc-400">
                    {blocklistDomains.slice(0, 10).map((domain, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <span className="text-zinc-600 w-6 text-right">
                          {i + 1}.
                        </span>
                        <span>{domain}</span>
                      </div>
                    ))}
                    {blocklistDomains.length > 10 && (
                      <div className="text-zinc-600 pt-1">
                        ... and {blocklistDomains.length - 10} more
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </div>
            </>
          )}

          {/* Settings */}
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1.5 min-w-[140px]">
              <Label className="text-xs text-zinc-400">Action</Label>
              <Select
                value={blocklistAction}
                onValueChange={(v) => { if (v) setBlocklistAction(v as PolicyAction); }}
              >
                <SelectTrigger className="bg-zinc-900 border-zinc-700">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="DENY">DENY</SelectItem>
                  <SelectItem value="IGNORE">IGNORE</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5 min-w-[200px]">
              <Label className="text-xs text-zinc-400">
                Zone Name <span className="text-red-400">*</span>
              </Label>
              <Input
                placeholder="e.g. contoso.com"
                value={blocklistZone}
                onChange={(e) => setBlocklistZone(e.target.value)}
                className="bg-zinc-900 border-zinc-700"
              />
            </div>

            <div className="space-y-1.5 w-40">
              <Label className="text-xs text-zinc-400">
                Processing Order Start
              </Label>
              <Input
                type="number"
                min={1}
                value={blocklistStartOrder}
                onChange={(e) =>
                  setBlocklistStartOrder(parseInt(e.target.value, 10) || 1)
                }
                className="bg-zinc-900 border-zinc-700"
              />
            </div>

            <Button
              onClick={handleBlocklistImport}
              disabled={
                blocklistImporting ||
                blocklistDomains.length === 0 ||
                !blocklistZone.trim()
              }
            >
              {blocklistImporting ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <ShieldAlert className="h-4 w-4 mr-2" />
              )}
              Import Blocklist
            </Button>
          </div>

          {/* Progress */}
          {blocklistImporting && (
            <div className="flex items-center gap-2 text-sm text-zinc-400">
              <div className="w-40 h-2 bg-zinc-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-cyan-500 transition-all duration-300"
                  style={{
                    width: `${
                      blocklistProgress.total > 0
                        ? (blocklistProgress.done / blocklistProgress.total) * 100
                        : 0
                    }%`,
                  }}
                />
              </div>
              <span>
                {blocklistProgress.done}/{blocklistProgress.total}
              </span>
            </div>
          )}

          {executionMode !== "execute" && blocklistDomains.length > 0 && (
            <p className="text-xs text-yellow-400">
              Execution mode is set to &quot;Generate&quot;. Commands will be
              shown in the PowerShell tab instead of being executed.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
