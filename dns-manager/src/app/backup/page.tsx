"use client";

import { useState, useRef, useCallback } from "react";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useStore } from "@/lib/store";
import { api } from "@/lib/api";
import { downloadJson } from "@/lib/utils";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
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
  Loader2,
  Server,
  Globe,
  Info,
} from "lucide-react";

import type { BackupData } from "@/lib/types";

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
  const [exportingConfig, setExportingConfig] = useState(false);
  const [exportingAllZones, setExportingAllZones] = useState(false);
  const [exportingZone, setExportingZone] = useState(false);
  const [singleZoneName, setSingleZoneName] = useState("");

  // ── Import state ──
  const importFileRef = useRef<HTMLInputElement>(null);
  const [importData, setImportData] = useState<BackupData | null>(null);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState({ done: 0, total: 0 });
  const [dragOverImport, setDragOverImport] = useState(false);


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

  function getActiveServerParams() {
    const active = servers.find((s) => s.id === useStore.getState().activeServerId);
    if (!active) return { server: exportServer || "localhost" };
    return { server: active.hostname, serverId: active.id, credentialMode: active.credentialMode };
  }

  async function handleExportServerConfig() {
    const p = getActiveServerParams();
    setExportingConfig(true);
    try {
      const res = await api.exportServerConfig(p.server, p.serverId, p.credentialMode);
      if (res.success && (res as Record<string, unknown>).config) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        downloadJson((res as Record<string, unknown>).config, `dns-server-config-${p.server}-${timestamp}.json`);
        toast.success("Server configuration exported");
      } else {
        toast.error("Export failed: " + (res.error ?? "Unknown error"));
      }
    } catch {
      toast.error("Export failed: unexpected error");
    } finally {
      setExportingConfig(false);
    }
  }

  async function handleExportAllZones() {
    const p = getActiveServerParams();
    setExportingAllZones(true);
    try {
      const res = await api.exportAllZones(p.server, p.serverId, p.credentialMode);
      const r = res as Record<string, unknown>;
      if (res.success && r.summary) {
        const summary = r.summary as { total: number; succeeded: number; failed: number };
        if (summary.failed === 0) {
          toast.success(`All ${summary.succeeded} zones exported to server's DNS directory`);
        } else {
          toast.warning(`${summary.succeeded} exported, ${summary.failed} failed`);
        }
        // Download the results summary
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        downloadJson({ results: r.results, summary }, `dns-zone-export-${p.server}-${timestamp}.json`);
      } else {
        toast.error("Export failed: " + (res.error ?? "Unknown error"));
      }
    } catch {
      toast.error("Export failed: unexpected error");
    } finally {
      setExportingAllZones(false);
    }
  }

  async function handleExportSingleZone() {
    if (!singleZoneName.trim()) { toast.error("Enter a zone name"); return; }
    const p = getActiveServerParams();
    setExportingZone(true);
    try {
      const res = await api.exportZone(singleZoneName.trim(), undefined, p.server, p.serverId, p.credentialMode);
      if (res.success) {
        toast.success(`Zone "${singleZoneName}" exported to server's DNS directory as ${(res as Record<string, unknown>).fileName || singleZoneName + ".dns"}`);
      } else {
        toast.error("Export failed: " + (res.error ?? "Unknown error"));
      }
    } catch {
      toast.error("Export failed: unexpected error");
    } finally {
      setExportingZone(false);
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
          Export DNS server configuration, zones, and policies. Import policy
          backups and blocklists.
        </p>
      </div>

      {/* ────────────────── AD-Integrated Note ────────────────── */}
      <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-4 flex gap-3">
        <Info className="h-5 w-5 text-blue-400 shrink-0 mt-0.5" />
        <div className="text-sm text-blue-200/80">
          <span className="font-medium text-blue-300">Active Directory-integrated zones:</span>{" "}
          Microsoft&apos;s preferred and most comprehensive backup method for AD-integrated DNS
          zones is a <span className="font-medium text-blue-200">full system state backup</span> (via
          Windows Server Backup or <code className="text-blue-300/80">wbadmin start systemstatebackup</code>),
          which backs up the entire Active Directory database including all DNS zone data.
          The exports below are supplementary and useful for configuration auditing, migration,
          and disaster recovery reference.
        </div>
      </div>

      {/* ────────────────── Export Server Config ────────────── */}
      <Card className="border-zinc-800 bg-zinc-950">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Server className="h-5 w-5 text-cyan-400" />
            Export Server Configuration
          </CardTitle>
          <CardDescription>
            Export the complete DNS server configuration (settings, cache, recursion,
            forwarders, diagnostics, scavenging, EDNS, block list) as JSON. Equivalent to{" "}
            <code className="text-zinc-400">Get-DnsServer</code>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            onClick={handleExportServerConfig}
            disabled={exportingConfig || !bridgeConnected}
          >
            {exportingConfig ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Download className="h-4 w-4 mr-2" />
            )}
            Export Server Config
          </Button>
        </CardContent>
      </Card>

      {/* ────────────────── Export Zones ────────────────────── */}
      <Card className="border-zinc-800 bg-zinc-950">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Globe className="h-5 w-5 text-cyan-400" />
            Export DNS Zones
          </CardTitle>
          <CardDescription>
            Export zone files to the server&apos;s DNS directory using{" "}
            <code className="text-zinc-400">Export-DnsServerZone</code>. Files are written
            to <code className="text-zinc-400">%SystemRoot%\System32\dns\</code> on the
            target server.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1.5 flex-1 min-w-[200px]">
              <Label className="text-xs text-zinc-400">Single Zone</Label>
              <div className="flex gap-2">
                <Input
                  placeholder="e.g. contoso.com"
                  value={singleZoneName}
                  onChange={(e) => setSingleZoneName(e.target.value)}
                  className="bg-zinc-900 border-zinc-700"
                />
                <Button
                  variant="outline"
                  onClick={handleExportSingleZone}
                  disabled={exportingZone || !bridgeConnected || !singleZoneName.trim()}
                >
                  {exportingZone ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4 mr-2" />
                  )}
                  Export Zone
                </Button>
              </div>
            </div>
          </div>

          <Separator className="bg-zinc-800" />

          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-zinc-300">Export All Primary Zones</p>
              <p className="text-xs text-zinc-500">
                Exports all non-autocreated primary zones to individual zone files on the server.
              </p>
            </div>
            <Button
              variant="outline"
              onClick={handleExportAllZones}
              disabled={exportingAllZones || !bridgeConnected}
            >
              {exportingAllZones ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Download className="h-4 w-4 mr-2" />
              )}
              Export All Zones
            </Button>
          </div>
        </CardContent>
      </Card>

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

    </div>
  );
}
