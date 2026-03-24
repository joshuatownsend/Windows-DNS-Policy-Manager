"use client";

import { useState, useRef, useCallback } from "react";
import { useStore } from "@/lib/store";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Upload } from "lucide-react";

interface ParsedRecord {
  hostName: string;
  recordType: string;
  data: string;
  ttl: string;
  valid: boolean;
  error?: string;
}

const VALID_TYPES = new Set(["A", "AAAA", "CNAME", "MX", "NS", "PTR", "SRV", "TXT"]);

function parseDataForType(type: string, data: string): Record<string, unknown> {
  switch (type) {
    case "A": return { IPv4Address: data };
    case "AAAA": return { IPv6Address: data };
    case "CNAME": return { HostNameAlias: data };
    case "MX": {
      const [host, pref] = data.split(":");
      return { MailExchange: host, Preference: parseInt(pref) || 10 };
    }
    case "NS": return { NameServer: data };
    case "PTR": return { PtrDomainName: data };
    case "SRV": {
      const [host, pri, wt, port] = data.split(":");
      return { DomainName: host, Priority: parseInt(pri) || 0, Weight: parseInt(wt) || 0, Port: parseInt(port) || 0 };
    }
    case "TXT": return { DescriptiveText: data };
    default: return {};
  }
}

function parseCsv(text: string): ParsedRecord[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith("#"));
  if (lines.length === 0) return [];

  // Detect header row
  const first = lines[0].toLowerCase();
  const startIdx = first.includes("hostname") && first.includes("recordtype") ? 1 : 0;

  const records: ParsedRecord[] = [];
  for (let i = startIdx; i < lines.length; i++) {
    const parts = lines[i].split(",").map((p) => p.trim().replace(/^"|"$/g, ""));
    if (parts.length < 3) {
      records.push({ hostName: parts[0] || "", recordType: "", data: "", ttl: "", valid: false, error: "Too few columns" });
      continue;
    }
    const [hostName, recordType, data, ttl] = parts;
    const type = recordType.toUpperCase();
    if (!VALID_TYPES.has(type)) {
      records.push({ hostName, recordType: type, data, ttl: ttl || "", valid: false, error: `Invalid type: ${type}` });
      continue;
    }
    if (!hostName || !data) {
      records.push({ hostName, recordType: type, data, ttl: ttl || "", valid: false, error: "Missing hostname or data" });
      continue;
    }
    records.push({ hostName, recordType: type, data, ttl: ttl || "3600", valid: true });
  }
  return records;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  zoneName: string;
  onImported: () => void;
}

export function RecordImportDialog({ open, onOpenChange, zoneName, onImported }: Props) {
  const getActiveServer = useStore((s) => s.getActiveServer);
  const [records, setRecords] = useState<ParsedRecord[]>([]);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleFile = useCallback((file: File) => {
    if (!file.name.endsWith(".csv") && !file.name.endsWith(".txt")) {
      toast.error("Please select a .csv or .txt file");
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const parsed = parseCsv(e.target?.result as string);
      setRecords(parsed);
      if (parsed.length === 0) toast.warning("No records found in file.");
    };
    reader.readAsText(file);
  }, []);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleImport = async () => {
    const server = getActiveServer();
    const sp = server ? { server: server.hostname, serverId: server.id, credentialMode: server.credentialMode } : {};
    const validRecords = records.filter((r) => r.valid);
    if (validRecords.length === 0) { toast.warning("No valid records to import."); return; }

    setImporting(true);
    setProgress({ done: 0, total: validRecords.length });
    let ok = 0, fail = 0;

    for (let i = 0; i < validRecords.length; i++) {
      const r = validRecords[i];
      const recordData = parseDataForType(r.recordType, r.data);
      const result = await api.addZoneRecord(zoneName, {
        hostName: r.hostName,
        recordType: r.recordType,
        recordData,
        timeToLive: r.ttl,
        ...sp,
      });
      if (result.success) ok++;
      else fail++;
      setProgress({ done: i + 1, total: validRecords.length });
    }

    setImporting(false);
    setProgress(null);

    if (fail === 0) {
      toast.success(`All ${ok} records imported successfully.`);
      onOpenChange(false);
      setRecords([]);
      onImported();
    } else {
      toast.warning(`${ok} imported, ${fail} failed.`);
      onImported();
    }
  };

  const validCount = records.filter((r) => r.valid).length;
  const invalidCount = records.length - validCount;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Import Records to {zoneName}</DialogTitle>
        </DialogHeader>

        {records.length === 0 ? (
          /* File upload area */
          <div
            className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer ${
              dragOver ? "border-cyan-500 bg-cyan-950/20" : "border-border hover:border-foreground/20"
            }`}
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
          >
            <Upload className="h-10 w-10 mx-auto mb-3 text-muted-foreground/60" />
            <p className="text-sm text-foreground/80">Drop a CSV file here or click to browse</p>
            <p className="text-xs text-muted-foreground/60 mt-2">
              Format: HostName,RecordType,Data,TTL (one record per line)
            </p>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.txt"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
            />
          </div>
        ) : (
          /* Preview */
          <div className="flex-1 overflow-auto space-y-3">
            <div className="flex gap-2">
              <Badge variant="secondary">{records.length} records</Badge>
              <Badge className="bg-emerald-500/15 text-emerald-400">{validCount} valid</Badge>
              {invalidCount > 0 && <Badge variant="destructive">{invalidCount} invalid</Badge>}
            </div>

            {progress && (
              <div className="space-y-1">
                <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                  <div className="h-full bg-primary transition-all" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
                </div>
                <p className="text-xs text-muted-foreground">{progress.done} / {progress.total}</p>
              </div>
            )}

            <div className="max-h-64 overflow-auto border border-border rounded">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Host</TableHead>
                    <TableHead className="text-xs">Type</TableHead>
                    <TableHead className="text-xs">Data</TableHead>
                    <TableHead className="text-xs">TTL</TableHead>
                    <TableHead className="text-xs w-16">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {records.slice(0, 100).map((r, i) => (
                    <TableRow key={i} className={r.valid ? "" : "bg-red-500/5"}>
                      <TableCell className="text-xs font-mono">{r.hostName}</TableCell>
                      <TableCell><Badge variant="secondary" className="text-[10px]">{r.recordType}</Badge></TableCell>
                      <TableCell className="text-xs font-mono truncate max-w-[200px]">{r.data}</TableCell>
                      <TableCell className="text-xs font-mono">{r.ttl}</TableCell>
                      <TableCell>
                        {r.valid
                          ? <span className="text-emerald-400 text-xs">OK</span>
                          : <span className="text-red-400 text-xs" title={r.error}>{r.error}</span>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {records.length > 100 && (
                <p className="text-xs text-muted-foreground/60 p-2">Showing first 100 of {records.length} records.</p>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => { onOpenChange(false); setRecords([]); }}>Cancel</Button>
          {records.length > 0 && !importing && (
            <Button variant="outline" onClick={() => setRecords([])}>Choose Different File</Button>
          )}
          {validCount > 0 && (
            <Button onClick={handleImport} disabled={importing}>
              {importing ? `Importing... (${progress?.done}/${progress?.total})` : `Import ${validCount} Records`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
