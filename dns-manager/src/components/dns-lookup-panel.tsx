"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { X, Search, Loader2, Trash2, Copy } from "lucide-react";
import { useStore } from "@/lib/store";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";


interface DnsLookupPanelProps {
  open: boolean;
  onClose: () => void;
}

const RECORD_TYPES = ["A", "AAAA", "CNAME", "MX", "NS", "PTR", "SRV", "TXT", "SOA", "ANY"] as const;

const DEFAULT_NSLOOKUP_OPTIONS = {
  recursive: true,
  tcp: false,
  debug: false,
};

const DEFAULT_DIG_OPTIONS = {
  recursive: true,
  tcp: false,
  dnssec: false,
  short: false,
  trace: false,
  all: false,
  comments: true,
  question: true,
  answer: true,
  authority: true,
  additional: true,
  stats: true,
  multiline: false,
};

type NslookupOptions = typeof DEFAULT_NSLOOKUP_OPTIONS;
type DigOptions = typeof DEFAULT_DIG_OPTIONS;

interface OutputEntry {
  id: number;
  timestamp: string;
  command: string;
  output: string;
  isError: boolean;
}

export function DnsLookupPanel({ open, onClose }: DnsLookupPanelProps) {
  const servers = useStore((s) => s.servers);
  const activeServer = useStore((s) => s.getActiveServer());
  const bridgeConnected = useStore((s) => s.bridgeConnected);

  const [tool, setTool] = useState<"nslookup" | "dig">("nslookup");
  const [nameserver, setNameserver] = useState("__active__");
  const [customNameserver, setCustomNameserver] = useState("");
  const [hostname, setHostname] = useState("");
  const [recordType, setRecordType] = useState("A");
  const [nslookupOptions, setNslookupOptions] = useState<NslookupOptions>({ ...DEFAULT_NSLOOKUP_OPTIONS });
  const [digOptions, setDigOptions] = useState<DigOptions>({ ...DEFAULT_DIG_OPTIONS });
  const [loading, setLoading] = useState(false);
  const [output, setOutput] = useState<OutputEntry[]>([]);
  const outputRef = useRef<HTMLDivElement>(null);
  const entryIdRef = useRef(0);
  const hostnameRef = useRef<HTMLInputElement>(null);

  // Scroll to top on new output (newest first)
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = 0;
    }
  }, [output]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // Focus hostname input when panel opens
  useEffect(() => {
    if (!open || !hostnameRef.current) return;
    const timeoutId = window.setTimeout(() => {
      hostnameRef.current?.focus();
    }, 300);
    return () => window.clearTimeout(timeoutId);
  }, [open]);

  const resolveNameserver = useCallback(() => {
    if (nameserver === "__custom__") return customNameserver;
    if (nameserver === "__active__") return activeServer?.hostname || "localhost";
    const srv = servers.find((s) => s.id === nameserver);
    return srv?.hostname || "localhost";
  }, [nameserver, customNameserver, activeServer, servers]);

  async function handleLookup() {
    const target = hostname.trim();
    if (!target) {
      toast.error("Enter a hostname to look up");
      return;
    }

    const server = resolveNameserver();
    if (!server) {
      toast.error("Enter or select a nameserver");
      return;
    }

    const options = tool === "nslookup"
      ? { ...nslookupOptions }
      : { ...digOptions };

    setLoading(true);
    try {
      const res = await api.dnsLookup({
        tool,
        hostname: target,
        server,
        recordType,
        options,
      });

      const entry: OutputEntry = {
        id: ++entryIdRef.current,
        timestamp: new Date().toLocaleTimeString(),
        command: (res as { command?: string }).command || `${tool} ${target}`,
        output: (res as { output?: string }).output || (res.error ? `Error: ${res.error}` : "No output"),
        isError: !res.success,
      };
      setOutput((prev) => [entry, ...prev]);
    } catch {
      const entry: OutputEntry = {
        id: ++entryIdRef.current,
        timestamp: new Date().toLocaleTimeString(),
        command: `${tool} ${target}`,
        output: "Failed to connect to bridge",
        isError: true,
      };
      setOutput((prev) => [entry, ...prev]);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !loading && hostname.trim()) {
      e.preventDefault();
      handleLookup();
    }
  }

  async function handleCopyAll() {
    const text = output.map((e) => `> ${e.command}\n${e.output}`).join("\n\n");
    if (!navigator.clipboard || !window.isSecureContext) {
      toast.error("Clipboard not available in this context");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied to clipboard");
    } catch {
      toast.error("Failed to copy — check browser clipboard permissions");
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label="DNS Lookup"
      aria-hidden={!open}
      inert={!open ? true : undefined}
      className={cn(
        "fixed top-0 right-0 z-50 h-full w-full max-w-lg",
        "flex flex-col",
        "bg-sidebar border-l border-border",
        "shadow-[-8px_0_32px_rgba(0,0,0,0.5)]",
        "transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]",
        open ? "translate-x-0" : "translate-x-full pointer-events-none"
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-background">
        <h2 className="text-sm font-semibold tracking-wide text-foreground font-display">
          DNS LOOKUP
        </h2>
        <button
          onClick={onClose}
          className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Close DNS lookup panel"
        >
          <X size={14} />
        </button>
      </div>

      {/* Form */}
      <div className="px-5 py-4 space-y-3 border-b border-border bg-background">
        {/* Tool selector */}
        <div className="flex gap-1 p-0.5 rounded-md bg-secondary">
          {(["nslookup", "dig"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTool(t)}
              className={cn(
                "flex-1 px-3 py-1 text-xs font-medium rounded transition-colors",
                tool === t
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Nameserver */}
        <div>
          <Label className="text-xs text-muted-foreground mb-1 block">Nameserver</Label>
          <Select value={nameserver} onValueChange={(v) => { if (v) setNameserver(v); }}>
            <SelectTrigger className="h-8 text-xs bg-secondary border-border">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__active__">
                Active Server ({activeServer?.hostname || "localhost"})
              </SelectItem>
              {servers.filter((s) => s.id !== activeServer?.id).map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name || s.hostname}
                </SelectItem>
              ))}
              <SelectItem value="__custom__">Custom...</SelectItem>
            </SelectContent>
          </Select>
          {nameserver === "__custom__" && (
            <Input
              placeholder="IP address or hostname"
              value={customNameserver}
              onChange={(e) => setCustomNameserver(e.target.value)}
              className="mt-1.5 h-8 text-xs bg-secondary border-border"
              onKeyDown={handleKeyDown}
            />
          )}
        </div>

        {/* Hostname + Record Type row */}
        <div className="flex gap-2">
          <div className="flex-1">
            <Label className="text-xs text-muted-foreground mb-1 block">Hostname</Label>
            <Input
              ref={hostnameRef}
              placeholder="example.com"
              value={hostname}
              onChange={(e) => setHostname(e.target.value)}
              onKeyDown={handleKeyDown}
              className="h-8 text-xs font-mono bg-secondary border-border"
            />
          </div>
          <div className="w-24">
            <Label className="text-xs text-muted-foreground mb-1 block">Type</Label>
            <Select value={recordType} onValueChange={(v) => { if (v) setRecordType(v); }}>
              <SelectTrigger className="h-8 text-xs bg-secondary border-border">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RECORD_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Options */}
        <div>
          <Label className="text-xs text-muted-foreground mb-1.5 block">Options</Label>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
            {tool === "nslookup" ? (
              <>
                <OptionCheckbox label="Recursion" checked={nslookupOptions.recursive} onChange={(v) => setNslookupOptions((o) => ({ ...o, recursive: v }))} />
                <OptionCheckbox label="Use TCP" checked={nslookupOptions.tcp} onChange={(v) => setNslookupOptions((o) => ({ ...o, tcp: v }))} />
                <OptionCheckbox label="Debug" checked={nslookupOptions.debug} onChange={(v) => setNslookupOptions((o) => ({ ...o, debug: v }))} />
              </>
            ) : (
              <>
                <OptionCheckbox label="+recurse" checked={digOptions.recursive} onChange={(v) => setDigOptions((o) => ({ ...o, recursive: v }))} />
                <OptionCheckbox label="+tcp" checked={digOptions.tcp} onChange={(v) => setDigOptions((o) => ({ ...o, tcp: v }))} />
                <OptionCheckbox label="+dnssec" checked={digOptions.dnssec} onChange={(v) => setDigOptions((o) => ({ ...o, dnssec: v }))} />
                <OptionCheckbox label="+trace" checked={digOptions.trace} onChange={(v) => setDigOptions((o) => ({ ...o, trace: v }))} />
                <OptionCheckbox label="+short" checked={digOptions.short} onChange={(v) => setDigOptions((o) => ({ ...o, short: v }))} />
                <OptionCheckbox label="+all" checked={digOptions.all} onChange={(v) => setDigOptions((o) => ({ ...o, all: v, comments: v, question: v, answer: v, authority: v, additional: v, stats: v }))} />
                <OptionCheckbox label="+multiline" checked={digOptions.multiline} onChange={(v) => setDigOptions((o) => ({ ...o, multiline: v }))} />
                <OptionCheckbox label="+comments" checked={digOptions.comments} onChange={(v) => setDigOptions((o) => ({ ...o, comments: v }))} />
                <OptionCheckbox label="+question" checked={digOptions.question} onChange={(v) => setDigOptions((o) => ({ ...o, question: v }))} />
                <OptionCheckbox label="+answer" checked={digOptions.answer} onChange={(v) => setDigOptions((o) => ({ ...o, answer: v }))} />
                <OptionCheckbox label="+authority" checked={digOptions.authority} onChange={(v) => setDigOptions((o) => ({ ...o, authority: v }))} />
                <OptionCheckbox label="+additional" checked={digOptions.additional} onChange={(v) => setDigOptions((o) => ({ ...o, additional: v }))} />
                <OptionCheckbox label="+stats" checked={digOptions.stats} onChange={(v) => setDigOptions((o) => ({ ...o, stats: v }))} />
              </>
            )}
          </div>
        </div>

        {/* Execute */}
        <Button
          size="sm"
          className="w-full"
          onClick={handleLookup}
          disabled={loading || !hostname.trim() || !bridgeConnected}
        >
          {loading ? (
            <Loader2 className="size-3.5 animate-spin mr-1.5" />
          ) : (
            <Search className="size-3.5 mr-1.5" />
          )}
          {loading ? "Looking up..." : "Lookup"}
        </Button>

        {!bridgeConnected && (
          <p className="text-[11px] text-amber-400 text-center">
            Bridge not connected. Start the bridge to run lookups.
          </p>
        )}
      </div>

      {/* Output */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {output.length > 0 && (
          <div className="flex items-center justify-end gap-1 px-4 py-1.5 border-b border-border shrink-0">
            <Button variant="ghost" size="icon-xs" onClick={handleCopyAll} title="Copy all">
              <Copy className="size-3" />
            </Button>
            <Button variant="ghost" size="icon-xs" onClick={() => setOutput([])} title="Clear output">
              <Trash2 className="size-3" />
            </Button>
          </div>
        )}
        <div ref={outputRef} className="flex-1 overflow-y-auto">
          <div className="p-4 space-y-4">
            {output.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Search className="size-8 text-muted-foreground/30 mb-3" />
                <p className="text-sm text-muted-foreground">Run a lookup to see results</p>
                <p className="text-xs text-muted-foreground/60 mt-1">
                  Results will appear here like a terminal session
                </p>
              </div>
            ) : (
              output.map((entry) => (
                <div key={entry.id} className="space-y-1">
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground/50">
                    <span className="font-mono">{entry.timestamp}</span>
                    <span className="text-muted-foreground/30">|</span>
                    <span className="font-mono truncate">{entry.command}</span>
                  </div>
                  <pre className={cn(
                    "text-xs font-mono leading-relaxed whitespace-pre-wrap break-all rounded-md p-3 bg-background border border-border",
                    entry.isError ? "text-red-400" : "text-foreground/80"
                  )}>
                    {entry.output}
                  </pre>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function OptionCheckbox({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-xs text-foreground/80 cursor-pointer select-none">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="rounded border-border bg-muted text-primary focus:ring-primary/30 size-3.5"
      />
      {label}
    </label>
  );
}
