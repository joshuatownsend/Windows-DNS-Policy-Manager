"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useStore } from "@/lib/store";
import { api } from "@/lib/api";
import type { Zone, DnsRecord, RecordType } from "@/lib/types";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Textarea } from "@/components/ui/textarea";
import { CreateZoneDialog } from "@/components/zones/create-zone-dialog";
import { ZoneActions } from "@/components/zones/zone-actions";
import { exportRecordsCsv } from "@/components/zones/record-export";
import { RecordImportDialog } from "@/components/zones/record-import";
import { Globe } from "lucide-react";

// ── Constants ────────────────────────────────────────────────

const RECORD_TYPES: RecordType[] = [
  "A",
  "AAAA",
  "CNAME",
  "MX",
  "NS",
  "PTR",
  "SRV",
  "TXT",
  "SOA",
];

const RECORD_TYPE_COLORS: Record<string, string> = {
  A: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  AAAA: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  CNAME: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  MX: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  NS: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  PTR: "bg-pink-500/20 text-pink-400 border-pink-500/30",
  SRV: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  TXT: "bg-slate-500/20 text-slate-400 border-slate-500/30",
  SOA: "bg-muted/50 text-muted-foreground border-border",
};

const ZONE_TYPE_COLORS: Record<string, string> = {
  Primary: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  Secondary: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  Stub: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  Forwarder: "bg-blue-500/20 text-blue-400 border-blue-500/30",
};

// ── Helpers ──────────────────────────────────────────────────

function getServerParams() {
  const server = useStore.getState().getActiveServer();
  if (!server) return {};
  return {
    server: server.hostname,
    serverId: server.id,
    credentialMode: server.credentialMode,
  };
}

function formatRecordData(record: DnsRecord): string {
  const data = record.RecordData;
  if (!data) return "";

  // Common record data fields
  if (data.IPv4Address) return String(data.IPv4Address);
  if (data.IPv6Address) return String(data.IPv6Address);
  if (data.HostNameAlias) return String(data.HostNameAlias);
  if (data.NameServer) return String(data.NameServer);
  if (data.PtrDomainName) return String(data.PtrDomainName);
  if (data.DescriptiveText) return String(data.DescriptiveText);
  if (data.MailExchange)
    return `${data.MailExchange} (priority: ${data.Preference ?? "?"})`;
  if (data.DomainName && data.Port != null)
    return `${data.DomainName}:${data.Port} (pri:${data.Priority ?? 0} w:${data.Weight ?? 0})`;

  // SOA
  if (data.PrimaryServer)
    return `${data.PrimaryServer} ${data.ResponsiblePerson ?? ""}`;

  // Fallback: show all key=value pairs
  const entries = Object.entries(data).filter(
    ([, v]) => v != null && v !== ""
  );
  if (entries.length === 0) return "";
  if (entries.length === 1) return String(entries[0][1]);
  return entries.map(([k, v]) => `${k}=${v}`).join(", ");
}

function matchesSearch(hostname: string, search: string): boolean {
  if (!search) return true;
  const trimmed = search.trim();
  if (!trimmed) return true;

  // Regex mode: /pattern/
  if (trimmed.startsWith("/") && trimmed.endsWith("/") && trimmed.length > 2) {
    try {
      const re = new RegExp(trimmed.slice(1, -1), "i");
      return re.test(hostname);
    } catch {
      return false;
    }
  }

  // Glob mode: contains *
  if (trimmed.includes("*")) {
    const escaped = trimmed.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    const pattern = escaped.replace(/\*/g, ".*");
    try {
      const re = new RegExp(`^${pattern}$`, "i");
      return re.test(hostname);
    } catch {
      return false;
    }
  }

  // Substring match
  return hostname.toLowerCase().includes(trimmed.toLowerCase());
}

// ── Empty record data template by type ───────────────────────

interface RecordFormData {
  recordType: RecordType;
  hostName: string;
  timeToLive: string;
  // Type-specific fields
  ipv4Address: string;
  ipv6Address: string;
  hostNameAlias: string;
  mailExchange: string;
  preference: string;
  nameServer: string;
  ptrDomainName: string;
  domainName: string;
  priority: string;
  weight: string;
  port: string;
  descriptiveText: string;
}

function emptyRecordForm(): RecordFormData {
  return {
    recordType: "A",
    hostName: "",
    timeToLive: "01:00:00",
    ipv4Address: "",
    ipv6Address: "",
    hostNameAlias: "",
    mailExchange: "",
    preference: "10",
    nameServer: "",
    ptrDomainName: "",
    domainName: "",
    priority: "0",
    weight: "0",
    port: "",
    descriptiveText: "",
  };
}

function recordFormToApiData(form: RecordFormData): Record<string, unknown> {
  const base: Record<string, unknown> = {
    recordType: form.recordType,
    hostName: form.hostName,
    timeToLive: form.timeToLive,
    ...getServerParams(),
  };

  switch (form.recordType) {
    case "A":
      base.recordData = form.ipv4Address;
      break;
    case "AAAA":
      base.recordData = form.ipv6Address;
      break;
    case "CNAME":
      base.recordData = form.hostNameAlias;
      break;
    case "MX":
      base.mailExchange = form.mailExchange;
      base.preference = form.preference;
      break;
    case "NS":
      base.recordData = form.nameServer;
      break;
    case "PTR":
      base.recordData = form.ptrDomainName;
      break;
    case "SRV":
      base.domainName = form.domainName;
      base.priority = form.priority;
      base.weight = form.weight;
      base.port = form.port;
      break;
    case "TXT":
      base.recordData = form.descriptiveText;
      break;
  }

  return base;
}

function recordToFormData(record: DnsRecord): RecordFormData {
  const form = emptyRecordForm();
  form.recordType = (record.RecordType as RecordType) || "A";
  form.hostName = record.HostName || "";
  form.timeToLive = record.TimeToLive || "01:00:00";

  const data = record.RecordData || {};
  form.ipv4Address = String(data.IPv4Address ?? "");
  form.ipv6Address = String(data.IPv6Address ?? "");
  form.hostNameAlias = String(data.HostNameAlias ?? "");
  form.mailExchange = String(data.MailExchange ?? "");
  form.preference = String(data.Preference ?? "10");
  form.nameServer = String(data.NameServer ?? "");
  form.ptrDomainName = String(data.PtrDomainName ?? "");
  form.domainName = String(data.DomainName ?? "");
  form.priority = String(data.Priority ?? "0");
  form.weight = String(data.Weight ?? "0");
  form.port = String(data.Port ?? "");
  form.descriptiveText = String(data.DescriptiveText ?? "");

  return form;
}

// ── Page Component ───────────────────────────────────────────

export default function ZonesPage() {
  const {
    zones,
    setZones,
    selectedZone,
    setSelectedZone,
    zoneRecords,
    setZoneRecords,
    zoneRecordFilter,
    setZoneRecordFilter,
    bridgeConnected,
  } = useStore();

  const [zoneSearch, setZoneSearch] = useState("");
  const [zoneFilters, setZoneFilters] = useState<{
    direction: "all" | "forward" | "reverse";
    type: "all" | "Primary" | "Secondary" | "Stub" | "Forwarder";
    adIntegrated: "all" | "yes" | "no";
  }>({ direction: "all", type: "all", adIntegrated: "all" });
  const [loading, setLoading] = useState(false);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);

  // Zone settings form
  const [dynamicUpdate, setDynamicUpdate] = useState("");
  const [aging, setAging] = useState(false);
  const [refreshInterval, setRefreshInterval] = useState("");
  const [noRefreshInterval, setNoRefreshInterval] = useState("");

  // Create zone dialog
  const [createZoneOpen, setCreateZoneOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  // Record modal
  const [recordDialogOpen, setRecordDialogOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<DnsRecord | null>(null);
  const [recordForm, setRecordForm] = useState<RecordFormData>(
    emptyRecordForm()
  );
  const [recordSaving, setRecordSaving] = useState(false);

  // ── Load zones on mount ──────────────────────────────────

  const loadZones = useCallback(async () => {
    const params = getServerParams();
    setLoading(true);
    try {
      const res = await api.listZones(params.server, params.serverId, params.credentialMode);
      if (res.success && Array.isArray(res.zones)) {
        setZones(res.zones as Zone[]);
      } else {
        toast.error(String(res.error || "Failed to load zones"));
      }
    } catch {
      toast.error("Failed to load zones");
    } finally {
      setLoading(false);
    }
  }, [setZones]);

  useEffect(() => {
    if (bridgeConnected) {
      loadZones();
    }
  }, [bridgeConnected, loadZones]);

  // ── Select a zone ────────────────────────────────────────

  const selectZone = useCallback(
    async (zone: Zone) => {
      setSelectedZone(zone);
      setZoneRecords([]);

      // Load zone details
      const params = getServerParams();
      try {
        const detailRes = await api.getZoneDetails(
          zone.ZoneName,
          params.server,
          params.serverId,
          params.credentialMode
        );
        if (detailRes.success && detailRes.zone) {
          const detail = detailRes.zone as Zone;
          setSelectedZone(detail);
          setDynamicUpdate(detail.DynamicUpdate || "None");
          setAging(detail.Aging || false);
          setRefreshInterval(detail.RefreshInterval || "");
          setNoRefreshInterval(detail.NoRefreshInterval || "");
        }
      } catch {
        // Zone selected but details failed; continue to load records
      }

      // Load records
      setRecordsLoading(true);
      try {
        const recRes = await api.getZoneRecords(
          zone.ZoneName,
          params.server,
          params.serverId,
          params.credentialMode
        );
        if (recRes.success && Array.isArray(recRes.records)) {
          setZoneRecords(recRes.records as DnsRecord[]);
        } else {
          toast.error(
            String(recRes.error || "Failed to load zone records")
          );
        }
      } catch {
        toast.error("Failed to load zone records");
      } finally {
        setRecordsLoading(false);
      }
    },
    [setSelectedZone, setZoneRecords]
  );

  // ── Save zone settings ───────────────────────────────────

  const saveSettings = useCallback(async () => {
    if (!selectedZone) return;
    setSavingSettings(true);
    const params = getServerParams();
    try {
      const res = await api.setZoneSettings(selectedZone.ZoneName, {
        dynamicUpdate,
        aging,
        refreshInterval,
        noRefreshInterval,
        ...params,
      });
      if (res.success) {
        toast.success("Zone settings saved");
      } else {
        toast.error(String(res.error || "Failed to save settings"));
      }
    } catch {
      toast.error("Failed to save zone settings");
    } finally {
      setSavingSettings(false);
    }
  }, [selectedZone, dynamicUpdate, aging, refreshInterval, noRefreshInterval]);

  // ── Reload records for current zone ──────────────────────

  const reloadRecords = useCallback(async () => {
    if (!selectedZone) return;
    const params = getServerParams();
    setRecordsLoading(true);
    try {
      const res = await api.getZoneRecords(
        selectedZone.ZoneName,
        params.server,
        params.serverId,
        params.credentialMode
      );
      if (res.success && Array.isArray(res.records)) {
        setZoneRecords(res.records as DnsRecord[]);
      }
    } catch {
      // silent
    } finally {
      setRecordsLoading(false);
    }
  }, [selectedZone, setZoneRecords]);

  // ── Add / Edit record ────────────────────────────────────

  const openAddRecord = useCallback(() => {
    setEditingRecord(null);
    setRecordForm(emptyRecordForm());
    setRecordDialogOpen(true);
  }, []);

  const openEditRecord = useCallback((record: DnsRecord) => {
    setEditingRecord(record);
    setRecordForm(recordToFormData(record));
    setRecordDialogOpen(true);
  }, []);

  const saveRecord = useCallback(async () => {
    if (!selectedZone) return;
    setRecordSaving(true);
    const data = recordFormToApiData(recordForm);

    try {
      let res;
      if (editingRecord) {
        res = await api.updateZoneRecord(selectedZone.ZoneName, {
          ...data,
          oldHostName: editingRecord.HostName,
          oldRecordType: editingRecord.RecordType,
          oldRecordData: formatRecordData(editingRecord),
        });
      } else {
        res = await api.addZoneRecord(selectedZone.ZoneName, data);
      }

      if (res.success) {
        toast.success(editingRecord ? "Record updated" : "Record added");
        setRecordDialogOpen(false);
        reloadRecords();
      } else {
        toast.error(String(res.error || "Failed to save record"));
      }
    } catch {
      toast.error("Failed to save record");
    } finally {
      setRecordSaving(false);
    }
  }, [selectedZone, recordForm, editingRecord, reloadRecords]);

  // ── Delete record ────────────────────────────────────────

  const deleteRecord = useCallback(
    async (record: DnsRecord) => {
      if (!selectedZone) return;
      if (
        !confirm(
          `Delete ${record.RecordType} record "${record.HostName}"?`
        )
      )
        return;

      const params = getServerParams();
      try {
        const res = await api.removeZoneRecord(selectedZone.ZoneName, {
          recordType: record.RecordType,
          hostName: record.HostName,
          recordData: formatRecordData(record),
          ...params,
        });
        if (res.success) {
          toast.success("Record deleted");
          reloadRecords();
        } else {
          toast.error(String(res.error || "Failed to delete record"));
        }
      } catch {
        toast.error("Failed to delete record");
      }
    },
    [selectedZone, reloadRecords]
  );

  // ── Filtered zones ───────────────────────────────────────

  const filteredZones = useMemo(() => {
    let result = zones;
    // Text search
    if (zoneSearch.trim()) {
      const term = zoneSearch.toLowerCase();
      result = result.filter((z) => z.ZoneName.toLowerCase().includes(term));
    }
    // Direction filter
    if (zoneFilters.direction === "forward") {
      result = result.filter((z) => !z.IsReverseLookupZone);
    } else if (zoneFilters.direction === "reverse") {
      result = result.filter((z) => z.IsReverseLookupZone);
    }
    // Type filter
    if (zoneFilters.type !== "all") {
      result = result.filter((z) => z.ZoneType === zoneFilters.type);
    }
    // AD-integrated filter
    if (zoneFilters.adIntegrated === "yes") {
      result = result.filter((z) => z.IsDsIntegrated);
    } else if (zoneFilters.adIntegrated === "no") {
      result = result.filter((z) => !z.IsDsIntegrated);
    }
    return result;
  }, [zones, zoneSearch, zoneFilters]);

  // ── Filtered records ─────────────────────────────────────

  const filteredRecords = useMemo(() => {
    let records = zoneRecords;

    // Type filter
    if (zoneRecordFilter.type) {
      records = records.filter(
        (r) => r.RecordType === zoneRecordFilter.type
      );
    }

    // Search filter
    if (zoneRecordFilter.search) {
      records = records.filter((r) =>
        matchesSearch(r.HostName, zoneRecordFilter.search)
      );
    }

    return records;
  }, [zoneRecords, zoneRecordFilter]);

  // ── Pagination ─────────────────────────────────────────
  const PAGE_SIZE = 50;
  const [recordPage, setRecordPage] = useState(0);
  const totalPages = Math.max(1, Math.ceil(filteredRecords.length / PAGE_SIZE));
  const paginatedRecords = filteredRecords.slice(
    recordPage * PAGE_SIZE,
    (recordPage + 1) * PAGE_SIZE
  );

  // Reset page when filters or zone change
  useEffect(() => {
    setRecordPage(0);
  }, [zoneRecordFilter, selectedZone]);

  // ── Update record form field ─────────────────────────────

  const updateFormField = useCallback(
    (field: keyof RecordFormData, value: string) => {
      setRecordForm((prev) => ({ ...prev, [field]: value }));
    },
    []
  );

  // ── Render ─────────────────────────────────────────────────

  return (
    <div className="flex h-full gap-4 p-4">
      {/* ── Left Panel: Zone List ──────────────────────────── */}
      <Card className="w-1/3 flex flex-col border-border bg-card">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Zones
              {zones.length > 0 && (
                <span className="ml-1.5 text-[10px] font-mono text-muted-foreground/40">
                  {filteredZones.length === zones.length
                    ? zones.length
                    : `${filteredZones.length}/${zones.length}`}
                </span>
              )}
              {(zoneSearch || zoneFilters.direction !== "all" || zoneFilters.type !== "all" || zoneFilters.adIntegrated !== "all") && (
                <button
                  onClick={() => {
                    setZoneSearch("");
                    setZoneFilters({ direction: "all", type: "all", adIntegrated: "all" });
                  }}
                  className="ml-2 text-[10px] text-amber-400 hover:text-amber-300 transition-colors"
                >
                  Reset
                </button>
              )}
            </CardTitle>
            <Button size="sm" variant="outline" onClick={() => setCreateZoneOpen(true)}>
              Create
            </Button>
          </div>
          <Input
            placeholder="Search zones..."
            value={zoneSearch}
            onChange={(e) => setZoneSearch(e.target.value)}
            className="mt-2 bg-secondary border-border text-foreground placeholder:text-muted-foreground/60"
          />
          {/* Zone Filters */}
          <div className="mt-2 flex flex-wrap gap-1">
            {/* Direction */}
            {(["all", "forward", "reverse"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setZoneFilters((f) => ({ ...f, direction: v }))}
                className={`px-2 py-0.5 rounded text-[10px] font-medium border transition-colors ${
                  zoneFilters.direction === v
                    ? "bg-cyan-500/15 text-cyan-400 border-cyan-500/40"
                    : "text-muted-foreground/60 border-border hover:text-foreground/80 hover:border-foreground/20"
                }`}
              >
                {v === "all" ? "All" : v === "forward" ? "Forward" : "Reverse"}
              </button>
            ))}
            <span className="w-px h-4 self-center bg-border" />
            {/* Zone Type */}
            {(["all", "Primary", "Secondary", "Stub", "Forwarder"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setZoneFilters((f) => ({ ...f, type: v }))}
                className={`px-2 py-0.5 rounded text-[10px] font-medium border transition-colors ${
                  zoneFilters.type === v
                    ? "bg-cyan-500/15 text-cyan-400 border-cyan-500/40"
                    : "text-muted-foreground/60 border-border hover:text-foreground/80 hover:border-foreground/20"
                }`}
              >
                {v === "all" ? "Any Type" : v}
              </button>
            ))}
            <span className="w-px h-4 self-center bg-border" />
            {/* AD Integrated */}
            {(["all", "yes", "no"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setZoneFilters((f) => ({ ...f, adIntegrated: v }))}
                className={`px-2 py-0.5 rounded text-[10px] font-medium border transition-colors ${
                  zoneFilters.adIntegrated === v
                    ? "bg-cyan-500/15 text-cyan-400 border-cyan-500/40"
                    : "text-muted-foreground/60 border-border hover:text-foreground/80 hover:border-foreground/20"
                }`}
              >
                {v === "all" ? "Any AD" : v === "yes" ? "AD-Integrated" : "File-Backed"}
              </button>
            ))}
          </div>
        </CardHeader>
        <Separator />
        <CardContent className="flex-1 p-0 overflow-hidden">
          <ScrollArea className="h-full">
            {loading ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground/60">
                Loading zones...
              </div>
            ) : filteredZones.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center px-4">
                <Globe className="h-8 w-8 mb-3 text-muted-foreground/30" />
                <p className="text-sm font-medium text-muted-foreground">
                  {bridgeConnected
                    ? "No zones match the current filters"
                    : "Connect to a server to browse zones"}
                </p>
                <p className="text-xs text-muted-foreground/60 mt-1">
                  {bridgeConnected
                    ? "Try adjusting the filters above or creating a new zone."
                    : "Add a server on the Server tab, then return here."}
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-1 p-2">
                {filteredZones.map((zone) => {
                  const isSelected =
                    selectedZone?.ZoneName === zone.ZoneName;
                  return (
                    <button
                      key={zone.ZoneName}
                      onClick={() => selectZone(zone)}
                      className={`w-full text-left px-3 py-2.5 rounded-md transition-colors ${
                        isSelected
                          ? "bg-cyan-500/10 border border-cyan-500/50"
                          : "hover:bg-muted/50 border border-transparent"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={`text-sm font-medium truncate ${
                            isSelected ? "text-cyan-400" : "text-foreground"
                          }`}
                        >
                          {zone.ZoneName}
                        </span>
                        <div className="flex items-center gap-1 shrink-0">
                          <Badge
                            variant="outline"
                            className={`text-[10px] ${
                              ZONE_TYPE_COLORS[zone.ZoneType] ||
                              "bg-muted/50 text-muted-foreground border-border"
                            }`}
                          >
                            {zone.ZoneType}
                          </Badge>
                          <span onClick={(e) => e.stopPropagation()}>
                            <ZoneActions
                              zoneName={zone.ZoneName}
                              zoneType={zone.ZoneType}
                              onDeleted={() => loadZones()}
                            />
                          </span>
                        </div>
                      </div>
                      <div className="flex gap-1.5 mt-1">
                        {zone.IsDsIntegrated && (
                          <Badge
                            variant="outline"
                            className="text-[9px] px-1.5 py-0 bg-blue-500/10 text-blue-400 border-blue-500/20"
                          >
                            AD
                          </Badge>
                        )}
                        {zone.IsSigned && (
                          <Badge
                            variant="outline"
                            className="text-[9px] px-1.5 py-0 bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                          >
                            DNSSEC
                          </Badge>
                        )}
                        {zone.IsReverseLookupZone && (
                          <Badge
                            variant="outline"
                            className="text-[9px] px-1.5 py-0 bg-amber-500/10 text-amber-400 border-amber-500/20"
                          >
                            Reverse
                          </Badge>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </CardContent>
        <Separator />
        <div className="p-3">
          <Button
            variant="outline"
            size="sm"
            onClick={loadZones}
            disabled={loading || !bridgeConnected}
            className="w-full border-border text-foreground/80 hover:bg-muted"
          >
            {loading ? "Loading..." : "Refresh Zones"}
          </Button>
        </div>
      </Card>

      {/* ── Right Panel: Zone Detail ──────────────────────── */}
      <div className="flex-1 flex flex-col gap-4 min-w-0">
        {!selectedZone ? (
          <Card className="flex-1 flex items-center justify-center border-border bg-card">
            <p className="text-muted-foreground/60">
              Select a zone to view its details and records
            </p>
          </Card>
        ) : (
          <>
            {/* Zone Header */}
            <Card className="border-border bg-card">
              <CardContent className="py-4">
                <div className="flex items-center gap-3">
                  <h2 className="text-lg font-semibold text-foreground">
                    {selectedZone.ZoneName}
                  </h2>
                  <Badge
                    variant="outline"
                    className={
                      ZONE_TYPE_COLORS[selectedZone.ZoneType] ||
                      "bg-muted/50 text-muted-foreground border-border"
                    }
                  >
                    {selectedZone.ZoneType}
                  </Badge>
                  {selectedZone.IsDsIntegrated && (
                    <Badge
                      variant="outline"
                      className="bg-blue-500/10 text-blue-400 border-blue-500/20"
                    >
                      AD-Integrated
                    </Badge>
                  )}
                  {selectedZone.IsSigned && (
                    <Badge
                      variant="outline"
                      className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                    >
                      DNSSEC Signed
                    </Badge>
                  )}
                  {selectedZone.IsReverseLookupZone && (
                    <Badge
                      variant="outline"
                      className="bg-amber-500/10 text-amber-400 border-amber-500/20"
                    >
                      Reverse Lookup
                    </Badge>
                  )}
                </div>
                {selectedZone.ReplicationScope && (
                  <p className="text-xs text-muted-foreground/60 mt-1">
                    Replication: {selectedZone.ReplicationScope}
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Settings Section */}
            <Collapsible open={settingsOpen} onOpenChange={setSettingsOpen}>
              <Card className="border-border bg-card">
                <CollapsibleTrigger>
                  <CardHeader className="cursor-pointer hover:bg-secondary/50 transition-colors py-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm font-medium text-muted-foreground">
                        Zone Settings
                      </CardTitle>
                      <span className="text-xs text-muted-foreground/40">
                        {settingsOpen ? "Collapse" : "Expand"}
                      </span>
                    </div>
                  </CardHeader>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <Separator />
                  <CardContent className="pt-4 pb-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label className="text-xs text-muted-foreground">
                          Dynamic Update
                        </Label>
                        <Select
                          value={dynamicUpdate}
                          onValueChange={(v) => { if (v) setDynamicUpdate(v); }}
                        >
                          <SelectTrigger className="bg-secondary border-border text-foreground">
                            <SelectValue placeholder="Select..." />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="None">None</SelectItem>
                            <SelectItem value="Secure">
                              Secure Only
                            </SelectItem>
                            <SelectItem value="NonsecureAndSecure">
                              Nonsecure and Secure
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="flex items-end gap-3">
                        <div className="space-y-2">
                          <Label className="text-xs text-muted-foreground">
                            Aging / Scavenging
                          </Label>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setAging(!aging)}
                            className={`border-border ${
                              aging
                                ? "bg-cyan-500/20 text-cyan-400 border-cyan-500/30"
                                : "text-muted-foreground"
                            }`}
                          >
                            {aging ? "Enabled" : "Disabled"}
                          </Button>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label className="text-xs text-muted-foreground">
                          Refresh Interval
                        </Label>
                        <Input
                          value={refreshInterval}
                          onChange={(e) =>
                            setRefreshInterval(e.target.value)
                          }
                          placeholder="7.00:00:00"
                          className="bg-secondary border-border text-foreground placeholder:text-muted-foreground/40"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label className="text-xs text-muted-foreground">
                          No-Refresh Interval
                        </Label>
                        <Input
                          value={noRefreshInterval}
                          onChange={(e) =>
                            setNoRefreshInterval(e.target.value)
                          }
                          placeholder="7.00:00:00"
                          className="bg-secondary border-border text-foreground placeholder:text-muted-foreground/40"
                        />
                      </div>
                    </div>

                    <div className="mt-4 flex justify-end">
                      <Button
                        size="sm"
                        onClick={saveSettings}
                        disabled={savingSettings}
                        className="bg-cyan-600 hover:bg-cyan-700 text-white"
                      >
                        {savingSettings
                          ? "Saving..."
                          : "Save Settings"}
                      </Button>
                    </div>
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>

            {/* Records Section */}
            <Card className="flex-1 flex flex-col border-border bg-card min-h-0">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Records
                    {zoneRecords.length > 0 && (
                      <span className="ml-2 text-muted-foreground/40">
                        ({recordPage * PAGE_SIZE + 1}-{Math.min((recordPage + 1) * PAGE_SIZE, filteredRecords.length)} of {filteredRecords.length}
                        {filteredRecords.length !== zoneRecords.length &&
                          ` / ${zoneRecords.length} total`}
                        )
                      </span>
                    )}
                  </CardTitle>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={reloadRecords}
                      disabled={recordsLoading}
                      className="border-border text-foreground/80 hover:bg-muted"
                    >
                      Refresh
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => exportRecordsCsv(filteredRecords, selectedZone?.ZoneName || "zone")}
                      disabled={filteredRecords.length === 0}
                    >
                      Export CSV
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setImportOpen(true)}
                    >
                      Import CSV
                    </Button>
                    <Button
                      size="sm"
                      onClick={openAddRecord}
                      className="bg-cyan-600 hover:bg-cyan-700 text-white"
                    >
                      Add Record
                    </Button>
                  </div>
                </div>

                {/* Filter Bar */}
                <div className="flex gap-2 mt-3">
                  <Select
                    value={zoneRecordFilter.type || "all"}
                    onValueChange={(v) =>
                      setZoneRecordFilter({
                        ...zoneRecordFilter,
                        type: !v || v === "all" ? "" : v,
                      })
                    }
                  >
                    <SelectTrigger className="w-[140px] bg-secondary border-border text-foreground">
                      <SelectValue placeholder="All Types" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Types</SelectItem>
                      {RECORD_TYPES.map((rt) => (
                        <SelectItem key={rt} value={rt}>
                          {rt}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    placeholder="Search records... (* glob, /regex/)"
                    value={zoneRecordFilter.search}
                    onChange={(e) =>
                      setZoneRecordFilter({
                        ...zoneRecordFilter,
                        search: e.target.value,
                      })
                    }
                    className="bg-secondary border-border text-foreground placeholder:text-muted-foreground/60"
                  />
                </div>
              </CardHeader>
              <Separator />
              <CardContent className="flex-1 p-0 overflow-hidden">
                <ScrollArea className="h-full">
                  {recordsLoading ? (
                    <div className="flex items-center justify-center py-12 text-muted-foreground/60">
                      Loading records...
                    </div>
                  ) : filteredRecords.length === 0 ? (
                    <div className="flex items-center justify-center py-12 text-muted-foreground/60">
                      {zoneRecords.length === 0
                        ? "No records in this zone"
                        : "No records match the current filter"}
                    </div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow className="border-border hover:bg-transparent">
                          <TableHead className="text-muted-foreground/60 text-xs">
                            HostName
                          </TableHead>
                          <TableHead className="text-muted-foreground/60 text-xs w-[90px]">
                            Type
                          </TableHead>
                          <TableHead className="text-muted-foreground/60 text-xs">
                            Record Data
                          </TableHead>
                          <TableHead className="text-muted-foreground/60 text-xs w-[100px]">
                            TTL
                          </TableHead>
                          <TableHead className="text-muted-foreground/60 text-xs w-[120px] text-right">
                            Actions
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {paginatedRecords.map((record, idx) => (
                          <TableRow
                            key={`${record.HostName}-${record.RecordType}-${idx}`}
                            className="border-border/50 hover:bg-secondary/50"
                          >
                            <TableCell className="text-foreground text-sm font-mono">
                              {record.HostName}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant="outline"
                                className={`text-[10px] font-mono ${
                                  RECORD_TYPE_COLORS[
                                    record.RecordType
                                  ] ||
                                  "bg-muted/50 text-muted-foreground border-border"
                                }`}
                              >
                                {record.RecordType}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-foreground/80 text-sm font-mono max-w-[300px] truncate">
                              {formatRecordData(record)}
                            </TableCell>
                            <TableCell className="text-muted-foreground text-xs font-mono">
                              {record.TimeToLive}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-1">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() =>
                                    openEditRecord(record)
                                  }
                                  className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground hover:bg-muted"
                                >
                                  Edit
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => deleteRecord(record)}
                                  className="h-7 px-2 text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10"
                                >
                                  Delete
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </ScrollArea>

                {/* Pagination */}
                {filteredRecords.length > PAGE_SIZE && (
                  <div className="flex items-center justify-between px-4 py-2 border-t border-border">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={recordPage === 0}
                      onClick={() => setRecordPage((p) => p - 1)}
                    >
                      Previous
                    </Button>
                    <span className="text-xs text-muted-foreground">
                      Page {recordPage + 1} of {totalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={recordPage >= totalPages - 1}
                      onClick={() => setRecordPage((p) => p + 1)}
                    >
                      Next
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>

      {/* ── Add/Edit Record Dialog ────────────────────────── */}
      <Dialog open={recordDialogOpen} onOpenChange={setRecordDialogOpen}>
        <DialogContent className="bg-card border-border text-foreground sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>
              {editingRecord ? "Edit Record" : "Add Record"}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground/60">
              {editingRecord
                ? `Editing ${editingRecord.RecordType} record for ${editingRecord.HostName}`
                : `Add a new DNS record to ${selectedZone?.ZoneName ?? "this zone"}`}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Record Type */}
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Record Type</Label>
              <Select
                value={recordForm.recordType}
                onValueChange={(v) =>
                  updateFormField("recordType", v as RecordType)
                }
                disabled={!!editingRecord}
              >
                <SelectTrigger className="bg-secondary border-border text-foreground">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RECORD_TYPES.filter((rt) => rt !== "SOA").map((rt) => (
                    <SelectItem key={rt} value={rt}>
                      {rt}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* HostName */}
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Host Name</Label>
              <Input
                value={recordForm.hostName}
                onChange={(e) =>
                  updateFormField("hostName", e.target.value)
                }
                placeholder="e.g., www, mail, @"
                className="bg-secondary border-border text-foreground placeholder:text-muted-foreground/40"
              />
            </div>

            {/* Type-specific fields */}
            {recordForm.recordType === "A" && (
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">
                  IPv4 Address
                </Label>
                <Input
                  value={recordForm.ipv4Address}
                  onChange={(e) =>
                    updateFormField("ipv4Address", e.target.value)
                  }
                  placeholder="192.168.1.1"
                  className="bg-secondary border-border text-foreground placeholder:text-muted-foreground/40"
                />
              </div>
            )}

            {recordForm.recordType === "AAAA" && (
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">
                  IPv6 Address
                </Label>
                <Input
                  value={recordForm.ipv6Address}
                  onChange={(e) =>
                    updateFormField("ipv6Address", e.target.value)
                  }
                  placeholder="2001:db8::1"
                  className="bg-secondary border-border text-foreground placeholder:text-muted-foreground/40"
                />
              </div>
            )}

            {recordForm.recordType === "CNAME" && (
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">
                  Host Name Alias
                </Label>
                <Input
                  value={recordForm.hostNameAlias}
                  onChange={(e) =>
                    updateFormField("hostNameAlias", e.target.value)
                  }
                  placeholder="target.example.com"
                  className="bg-secondary border-border text-foreground placeholder:text-muted-foreground/40"
                />
              </div>
            )}

            {recordForm.recordType === "MX" && (
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2 space-y-2">
                  <Label className="text-xs text-muted-foreground">
                    Mail Exchange
                  </Label>
                  <Input
                    value={recordForm.mailExchange}
                    onChange={(e) =>
                      updateFormField("mailExchange", e.target.value)
                    }
                    placeholder="mail.example.com"
                    className="bg-secondary border-border text-foreground placeholder:text-muted-foreground/40"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">
                    Preference
                  </Label>
                  <Input
                    value={recordForm.preference}
                    onChange={(e) =>
                      updateFormField("preference", e.target.value)
                    }
                    placeholder="10"
                    className="bg-secondary border-border text-foreground placeholder:text-muted-foreground/40"
                  />
                </div>
              </div>
            )}

            {recordForm.recordType === "NS" && (
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">
                  Name Server
                </Label>
                <Input
                  value={recordForm.nameServer}
                  onChange={(e) =>
                    updateFormField("nameServer", e.target.value)
                  }
                  placeholder="ns1.example.com"
                  className="bg-secondary border-border text-foreground placeholder:text-muted-foreground/40"
                />
              </div>
            )}

            {recordForm.recordType === "PTR" && (
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">
                  PTR Domain Name
                </Label>
                <Input
                  value={recordForm.ptrDomainName}
                  onChange={(e) =>
                    updateFormField("ptrDomainName", e.target.value)
                  }
                  placeholder="host.example.com"
                  className="bg-secondary border-border text-foreground placeholder:text-muted-foreground/40"
                />
              </div>
            )}

            {recordForm.recordType === "SRV" && (
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">
                    Domain Name
                  </Label>
                  <Input
                    value={recordForm.domainName}
                    onChange={(e) =>
                      updateFormField("domainName", e.target.value)
                    }
                    placeholder="sip.example.com"
                    className="bg-secondary border-border text-foreground placeholder:text-muted-foreground/40"
                  />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">
                      Priority
                    </Label>
                    <Input
                      value={recordForm.priority}
                      onChange={(e) =>
                        updateFormField("priority", e.target.value)
                      }
                      placeholder="0"
                      className="bg-secondary border-border text-foreground placeholder:text-muted-foreground/40"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">
                      Weight
                    </Label>
                    <Input
                      value={recordForm.weight}
                      onChange={(e) =>
                        updateFormField("weight", e.target.value)
                      }
                      placeholder="0"
                      className="bg-secondary border-border text-foreground placeholder:text-muted-foreground/40"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Port</Label>
                    <Input
                      value={recordForm.port}
                      onChange={(e) =>
                        updateFormField("port", e.target.value)
                      }
                      placeholder="5060"
                      className="bg-secondary border-border text-foreground placeholder:text-muted-foreground/40"
                    />
                  </div>
                </div>
              </div>
            )}

            {recordForm.recordType === "TXT" && (
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">
                  Descriptive Text
                </Label>
                <Textarea
                  value={recordForm.descriptiveText}
                  onChange={(e) =>
                    updateFormField("descriptiveText", e.target.value)
                  }
                  placeholder="v=spf1 include:example.com ~all"
                  rows={3}
                  className="bg-secondary border-border text-foreground placeholder:text-muted-foreground/40 resize-none"
                />
              </div>
            )}

            {/* TTL */}
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">
                Time to Live (TTL)
              </Label>
              <Input
                value={recordForm.timeToLive}
                onChange={(e) =>
                  updateFormField("timeToLive", e.target.value)
                }
                placeholder="01:00:00"
                className="bg-secondary border-border text-foreground placeholder:text-muted-foreground/40"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRecordDialogOpen(false)}
              className="border-border text-foreground/80 hover:bg-muted"
            >
              Cancel
            </Button>
            <Button
              onClick={saveRecord}
              disabled={recordSaving}
              className="bg-cyan-600 hover:bg-cyan-700 text-white"
            >
              {recordSaving
                ? "Saving..."
                : editingRecord
                  ? "Update Record"
                  : "Add Record"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Zone Dialog */}
      <CreateZoneDialog
        open={createZoneOpen}
        onOpenChange={setCreateZoneOpen}
        onCreated={() => loadZones()}
      />

      {/* Record Import Dialog */}
      {selectedZone && (
        <RecordImportDialog
          open={importOpen}
          onOpenChange={setImportOpen}
          zoneName={selectedZone.ZoneName}
          onImported={() => selectZone(selectedZone)}
        />
      )}
    </div>
  );
}
