"use client";

import { useState, useCallback } from "react";
import { useStore } from "@/lib/store";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  ShieldCheck,
  AlertTriangle,
  XCircle,
  Info,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
} from "lucide-react";

/* eslint-disable @typescript-eslint/no-explicit-any */

interface BpaFinding {
  Severity: string;
  Category: string;
  Title: string;
  Problem: string;
  Impact: string;
  Resolution: string;
  Compliance: string;
  Source: string;
  ResultId: string;
}

const SEVERITY_CONFIG: Record<string, { icon: typeof AlertTriangle; color: string; bg: string }> = {
  Error: { icon: XCircle, color: "text-red-400", bg: "bg-red-500/10 border-red-500/20" },
  Warning: { icon: AlertTriangle, color: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/20" },
  Information: { icon: Info, color: "text-blue-400", bg: "bg-blue-500/10 border-blue-500/20" },
};

export function BpaPanel() {
  const bridgeConnected = useStore((s) => s.bridgeConnected);
  const getActiveServer = useStore((s) => s.getActiveServer);

  const [running, setRunning] = useState(false);
  const [findings, setFindings] = useState<BpaFinding[] | null>(null);
  const [summary, setSummary] = useState<{ errors: number; warnings: number; information: number } | null>(null);
  const [scannedAt, setScannedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runBpa = useCallback(async () => {
    const server = getActiveServer();
    const sp = server ? { server: server.hostname, serverId: server.id, credentialMode: server.credentialMode } : {};

    setRunning(true);
    setError(null);

    const result = await api.runBpa(sp.server, sp.serverId, sp.credentialMode);

    if (result.success) {
      const r = result as any;
      setFindings(r.findings || []);
      setSummary(r.summary || { errors: 0, warnings: 0, information: 0 });
      setScannedAt(r.scannedAt || new Date().toISOString());
      toast.success("Best Practices analysis complete.");
    } else {
      setError(result.error || "BPA failed");
      toast.error("BPA failed: " + result.error);
    }

    setRunning(false);
  }, [getActiveServer]);

  if (!bridgeConnected) return null;

  return (
    <Card className="border-border/50">
      <CardHeader className="py-3 px-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ClipboardCheck className="h-4 w-4 text-cyan" />
            <CardTitle className="text-sm font-medium">DNS Best Practices Analyzer</CardTitle>
            {summary && (
              <div className="flex gap-1.5">
                {summary.errors > 0 && (
                  <Badge variant="destructive" className="text-xs">{summary.errors} error{summary.errors !== 1 ? "s" : ""}</Badge>
                )}
                {summary.warnings > 0 && (
                  <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/30 text-xs">{summary.warnings} warning{summary.warnings !== 1 ? "s" : ""}</Badge>
                )}
                {summary.errors === 0 && summary.warnings === 0 && (
                  <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 text-xs">All clear</Badge>
                )}
              </div>
            )}
          </div>
          <Button
            size="sm"
            onClick={runBpa}
            disabled={running}
          >
            {running ? (
              <RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            ) : (
              <ShieldCheck className="h-3.5 w-3.5 mr-1.5" />
            )}
            {running ? "Scanning..." : "Run Analysis"}
          </Button>
        </div>
        {scannedAt && (
          <p className="text-[11px] text-muted-foreground mt-1">
            Last scanned: {new Date(scannedAt).toLocaleString()}
          </p>
        )}
      </CardHeader>

      {error && (
        <CardContent className="pt-0 px-4 pb-4">
          <div className="p-3 rounded bg-red-500/10 border border-red-500/20 text-sm text-red-400">
            {error}
          </div>
        </CardContent>
      )}

      {findings && findings.length > 0 && (
        <CardContent className="pt-0 px-4 pb-4 space-y-2">
          {findings.map((f, i) => {
            const sev = SEVERITY_CONFIG[f.Severity] || SEVERITY_CONFIG.Information;
            const Icon = sev.icon;
            return (
              <FindingItem key={i} finding={f} Icon={Icon} sev={sev} />
            );
          })}
        </CardContent>
      )}

      {findings && findings.length === 0 && (
        <CardContent className="pt-0 px-4 pb-4">
          <div className="p-3 rounded bg-emerald-500/10 border border-emerald-500/20 text-sm text-emerald-400 flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" />
            No issues found. DNS server configuration follows best practices.
          </div>
        </CardContent>
      )}
    </Card>
  );
}

function FindingItem({
  finding: f,
  Icon,
  sev,
}: {
  finding: BpaFinding;
  Icon: typeof AlertTriangle;
  sev: { color: string; bg: string };
}) {
  const [open, setOpen] = useState(false);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className={`rounded border ${sev.bg}`}>
        <CollapsibleTrigger>
          <div className="flex items-start gap-3 px-3 py-2.5 cursor-pointer hover:opacity-80 transition-opacity w-full text-left">
            {open ? <ChevronDown className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />}
            <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${sev.color}`} />
            <div className="min-w-0">
              <div className="text-sm font-medium">{f.Title}</div>
              <div className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{f.Problem}</div>
            </div>
            <Badge variant="secondary" className="text-[10px] shrink-0 ml-auto">{f.Category}</Badge>
          </div>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="px-3 pb-3 space-y-2 border-t border-border/30 pt-2 ml-10">
            {f.Problem && (
              <div>
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Problem</span>
                <p className="text-sm mt-0.5">{f.Problem}</p>
              </div>
            )}
            {f.Impact && (
              <div>
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Impact</span>
                <p className="text-sm mt-0.5">{f.Impact}</p>
              </div>
            )}
            {f.Resolution && (
              <div>
                <span className="text-xs font-semibold text-amber-400/80 uppercase tracking-wider">Resolution</span>
                <p className="text-sm mt-0.5">{f.Resolution}</p>
              </div>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
