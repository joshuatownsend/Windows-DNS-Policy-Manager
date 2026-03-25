"use client";

import { useCallback, useState } from "react";
import { useStore } from "@/lib/store";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { EditableField } from "./editable-field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Trash2,
  Plus,
  Settings,
  ArrowUpDown,
  Database,
  Shield,
  BarChart3,
  Activity,
  ShieldAlert,
  Timer,
  FlaskConical,
  Globe,
  Radio,
  Server,
  ToggleLeft,
  Lock,
} from "lucide-react";

function getServerParams() {
  const server = useStore.getState().getActiveServer();
  if (!server) return {};
  return { server: server.hostname, serverId: server.id, credentialMode: server.credentialMode };
}

// ── Section wrapper ──────────────────────────────────────

function ConfigSection({
  title,
  icon: Icon,
  badge,
  children,
  onRefresh,
  loading,
}: {
  title: string;
  icon: React.ElementType;
  badge?: string;
  children: React.ReactNode;
  onRefresh?: () => void;
  loading?: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card className="border-border/50">
        <CardHeader className="py-3 px-4">
          <div className="flex items-center justify-between">
            <CollapsibleTrigger className="flex items-center gap-3 cursor-pointer hover:opacity-80 transition-opacity flex-1 text-left">
              {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
              <Icon className="h-4 w-4 text-cyan" />
              <CardTitle className="text-sm font-medium">{title}</CardTitle>
              {badge && <Badge variant="secondary" className="text-xs">{badge}</Badge>}
            </CollapsibleTrigger>
            {onRefresh && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={(e) => { e.stopPropagation(); onRefresh(); }}
                disabled={loading}
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              </Button>
            )}
          </div>
        </CardHeader>
        <CollapsibleContent>
          <CardContent className="pt-0 px-4 pb-4">
            {children}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

// ── Main Component ───────────────────────────────────────

export function ServerConfig() {
  const bridgeConnected = useStore((s) => s.bridgeConnected);
  const serverConfig = useStore((s) => s.serverConfig);
  const setServerConfig = useStore((s) => s.setServerConfig);
  const [loading, setLoading] = useState<Record<string, boolean>>({});

  const setL = (key: string, v: boolean) => setLoading((p) => ({ ...p, [key]: v }));

  const sp = useCallback(() => {
    const s = useStore.getState().getActiveServer();
    if (!s) return {};
    return { server: s.hostname, serverId: s.id, credentialMode: s.credentialMode };
  }, []);

  // ── Loaders ────────────────────────────────────────────

  const loadSettings = useCallback(async () => {
    setL("settings", true);
    const p = sp();
    const r = await api.getServerSettings(p.server, p.serverId, p.credentialMode);
    if (r.success) setServerConfig("settings", (r as Record<string, unknown>).settings);
    else toast.error("Failed to load settings: " + r.error);
    setL("settings", false);
  }, [sp, setServerConfig]);

  const loadForwarders = useCallback(async () => {
    setL("forwarders", true);
    const p = sp();
    const r = await api.getForwarders(p.server, p.serverId, p.credentialMode);
    if (r.success) setServerConfig("forwarders", (r as Record<string, unknown>).forwarders);
    else toast.error("Failed to load forwarders: " + r.error);
    setL("forwarders", false);
  }, [sp, setServerConfig]);

  const loadRecursion = useCallback(async () => {
    setL("recursion", true);
    const p = sp();
    const r = await api.getRecursionSettings(p.server, p.serverId, p.credentialMode);
    if (r.success) setServerConfig("recursion", (r as Record<string, unknown>).recursion);
    else toast.error("Failed to load recursion settings: " + r.error);
    setL("recursion", false);
  }, [sp, setServerConfig]);

  const loadCache = useCallback(async () => {
    setL("cache", true);
    const p = sp();
    const r = await api.getCache(p.server, p.serverId, p.credentialMode);
    if (r.success) setServerConfig("cache", (r as Record<string, unknown>).cache);
    else toast.error("Failed to load cache: " + r.error);
    setL("cache", false);
  }, [sp, setServerConfig]);

  const loadBlocklist = useCallback(async () => {
    setL("blocklist", true);
    const p = sp();
    const r = await api.getBlockList(p.server, p.serverId, p.credentialMode);
    if (r.success) setServerConfig("blocklist", (r as Record<string, unknown>).blocklist);
    else toast.error("Failed to load block list: " + r.error);
    setL("blocklist", false);
  }, [sp, setServerConfig]);

  const loadDiagnostics = useCallback(async () => {
    setL("diagnostics", true);
    const p = sp();
    const r = await api.getDiagnostics(p.server, p.serverId, p.credentialMode);
    if (r.success) setServerConfig("diagnostics", (r as Record<string, unknown>).diagnostics);
    else toast.error("Failed to load diagnostics: " + r.error);
    setL("diagnostics", false);
  }, [sp, setServerConfig]);

  const loadStatistics = useCallback(async () => {
    setL("statistics", true);
    const p = sp();
    const r = await api.getStatistics(p.server, p.serverId, p.credentialMode);
    if (r.success) setServerConfig("statistics", (r as Record<string, unknown>).statistics);
    else toast.error("Failed to load statistics: " + r.error);
    setL("statistics", false);
  }, [sp, setServerConfig]);

  // RRL, Scavenging, Test — local state (not in global store)
  const [rootHints, setRootHints] = useState<Record<string, unknown>[] | null>(null);
  const [edns, setEdns] = useState<Record<string, unknown> | null>(null);
  const [dsSetting, setDsSetting] = useState<Record<string, unknown> | null>(null);
  const [globalNameZone, setGlobalNameZone] = useState<Record<string, unknown> | null>(null);
  const [encryption, setEncryption] = useState<Record<string, unknown> | null>(null);
  const [encryptionUnsupported, setEncryptionUnsupported] = useState(false);
  const [rrl, setRrl] = useState<Record<string, unknown> | null>(null);
  const [rrlExceptions, setRrlExceptions] = useState<Record<string, unknown>[] | null>(null);
  const [scavenging, setScavenging] = useState<Record<string, unknown> | null>(null);
  const [testResult, setTestResult] = useState<Record<string, unknown> | null>(null);

  const loadRRL = useCallback(async () => {
    setL("rrl", true);
    const p = sp();
    const r = await api.getRRL(p.server, p.serverId, p.credentialMode);
    if (r.success) setRrl((r as Record<string, unknown>).rrl as Record<string, unknown>);
    else toast.error("Failed to load RRL: " + r.error);
    setL("rrl", false);
  }, [sp]);

  const loadRRLExceptions = useCallback(async () => {
    setL("rrlExc", true);
    const p = sp();
    const r = await api.getRRLExceptions(p.server, p.serverId, p.credentialMode);
    if (r.success) setRrlExceptions((r as Record<string, unknown>).exceptions as Record<string, unknown>[]);
    else toast.error("Failed to load RRL exceptions: " + r.error);
    setL("rrlExc", false);
  }, [sp]);

  const loadScavenging = useCallback(async () => {
    setL("scavenging", true);
    const p = sp();
    const r = await api.getScavenging(p.server, p.serverId, p.credentialMode);
    if (r.success) setScavenging((r as Record<string, unknown>).scavenging as Record<string, unknown>);
    else toast.error("Failed to load scavenging: " + r.error);
    setL("scavenging", false);
  }, [sp]);

  const loadRootHints = useCallback(async () => {
    setL("rootHints", true);
    const p = sp();
    const r = await api.getRootHints(p.server, p.serverId, p.credentialMode);
    if (r.success) setRootHints((r as Record<string, unknown>).rootHints as Record<string, unknown>[]);
    else toast.error("Failed to load root hints: " + r.error);
    setL("rootHints", false);
  }, [sp]);

  const loadEDns = useCallback(async () => {
    setL("edns", true);
    const p = sp();
    const r = await api.getEDns(p.server, p.serverId, p.credentialMode);
    if (r.success) setEdns((r as Record<string, unknown>).edns as Record<string, unknown>);
    else toast.error("Failed to load EDNS: " + r.error);
    setL("edns", false);
  }, [sp]);

  const loadDsSetting = useCallback(async () => {
    setL("dsSetting", true);
    const p = sp();
    const r = await api.getDsSetting(p.server, p.serverId, p.credentialMode);
    if (r.success) setDsSetting((r as Record<string, unknown>).dsSetting as Record<string, unknown>);
    else toast.error("Failed to load AD settings: " + r.error);
    setL("dsSetting", false);
  }, [sp]);

  const loadGlobalNameZone = useCallback(async () => {
    setL("gnz", true);
    const p = sp();
    const r = await api.getGlobalNameZone(p.server, p.serverId, p.credentialMode);
    if (r.success) setGlobalNameZone((r as Record<string, unknown>).globalNameZone as Record<string, unknown>);
    else toast.error("Failed to load GlobalNameZone: " + r.error);
    setL("gnz", false);
  }, [sp]);

  // ── Save helpers for inline editing ──────────────────────

  const saveServerSetting = useCallback(async (field: string, value: unknown) => {
    const p = sp();
    const r = await api.setServerSettings({ [field]: value }, p.server, p.serverId, p.credentialMode);
    if (r.success) { toast.success(`${field} updated.`); loadSettings(); return true; }
    toast.error("Failed: " + r.error); return false;
  }, [sp, loadSettings]);

  const saveRecursionSetting = useCallback(async (field: string, value: unknown) => {
    const p = sp();
    const camel = field.substring(0, 1).toLowerCase() + field.substring(1);
    const r = await api.setRecursionSettings({ [camel]: value }, p.server, p.serverId, p.credentialMode);
    if (r.success) { toast.success(`${field} updated.`); loadRecursion(); return true; }
    toast.error("Failed: " + r.error); return false;
  }, [sp, loadRecursion]);

  const saveDiagnosticSetting = useCallback(async (field: string, value: unknown) => {
    const p = sp();
    const camel = field.substring(0, 1).toLowerCase() + field.substring(1);
    const r = await api.setDiagnostics({ [camel]: value }, p.server, p.serverId, p.credentialMode);
    if (r.success) { toast.success(`${field} updated.`); loadDiagnostics(); return true; }
    toast.error("Failed: " + r.error); return false;
  }, [sp, loadDiagnostics]);

  const saveRRLSetting = useCallback(async (field: string, value: unknown) => {
    const p = sp();
    const camel = field.substring(0, 1).toLowerCase() + field.substring(1);
    const r = await api.setRRL({ [camel]: value }, p.server, p.serverId, p.credentialMode);
    if (r.success) { toast.success(`${field} updated.`); loadRRL(); return true; }
    toast.error("Failed: " + r.error); return false;
  }, [sp, loadRRL]);

  const saveScavengingSetting = useCallback(async (field: string, value: unknown) => {
    const p = sp();
    const camel = field.substring(0, 1).toLowerCase() + field.substring(1);
    const r = await api.setScavenging({ [camel]: value }, p.server, p.serverId, p.credentialMode);
    if (r.success) { toast.success(`${field} updated.`); loadScavenging(); return true; }
    toast.error("Failed: " + r.error); return false;
  }, [sp, loadScavenging]);

  const loadEncryption = useCallback(async () => {
    setL("encryption", true);
    const p = sp();
    const r = await api.getEncryptionProtocol(p.server, p.serverId, p.credentialMode);
    if (r.success) {
      setEncryption((r as Record<string, unknown>).protocol as Record<string, unknown>);
      setEncryptionUnsupported(false);
    } else if ((r as Record<string, unknown>).unsupported) {
      setEncryptionUnsupported(true);
    } else {
      toast.error("Failed to load encryption settings: " + r.error);
    }
    setL("encryption", false);
  }, [sp]);

  if (!bridgeConnected) return null;

  // ── Helpers ────────────────────────────────────────────

  const settings = serverConfig.settings as Record<string, unknown> | null;
  const forwarders = serverConfig.forwarders as Record<string, unknown> | null;
  const recursion = serverConfig.recursion as Record<string, unknown> | null;
  const cache = serverConfig.cache as Record<string, unknown> | null;
  const blocklist = serverConfig.blocklist as Record<string, unknown> | null;
  const diagnostics = serverConfig.diagnostics as Record<string, unknown> | null;
  const statistics = serverConfig.statistics as Record<string, unknown> | null;

  return (
    <div className="space-y-3">
      <Separator />
      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
        Server Configuration
      </h3>

      {/* ── General Settings ───────────────────────────── */}
      <ConfigSection title="General Settings" icon={Settings} onRefresh={loadSettings} loading={loading.settings}>
        {settings ? (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {["RoundRobin", "BindSecondaries", "StrictFileParsing", "LocalNetPriority"].map((key) =>
              settings[key] !== undefined ? (
                <EditableField key={key} label={key} value={settings[key]} type="boolean" onSave={(v) => saveServerSetting(key, v)} />
              ) : null
            )}
            {["WriteAuthorityNS", "NameCheckFlag"].map((key) =>
              settings[key] !== undefined ? (
                <EditableField key={key} label={key} value={settings[key]} type="readonly" />
              ) : null
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Click refresh to load server settings.</p>
        )}
      </ConfigSection>

      {/* ── Forwarders ─────────────────────────────────── */}
      <ConfigSection
        title="Forwarders"
        icon={ArrowUpDown}
        badge={forwarders?.IPAddress ? String((forwarders.IPAddress as string[]).length) : undefined}
        onRefresh={loadForwarders}
        loading={loading.forwarders}
      >
        {forwarders ? (
          <ForwardersPanel forwarders={forwarders} onRefresh={loadForwarders} />
        ) : (
          <p className="text-sm text-muted-foreground">Click refresh to load forwarders.</p>
        )}
      </ConfigSection>

      {/* ── Recursion ──────────────────────────────────── */}
      <ConfigSection title="Recursion" icon={RefreshCw} onRefresh={loadRecursion} loading={loading.recursion}>
        {recursion ? (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {["Enable", "SecureResponse"].map((key) =>
              recursion[key] !== undefined ? (
                <EditableField key={key} label={key} value={recursion[key]} type="boolean" onSave={(v) => saveRecursionSetting(key, v)} />
              ) : null
            )}
            {["Timeout"].map((key) =>
              recursion[key] !== undefined ? (
                <EditableField key={key} label={key} value={recursion[key]} type="string" onSave={(v) => saveRecursionSetting(key, v)} />
              ) : null
            )}
            {["AdditionalTimeout", "Retries"].map((key) =>
              recursion[key] !== undefined ? (
                <EditableField key={key} label={key} value={recursion[key]} type="number" onSave={(v) => saveRecursionSetting(key, v)} />
              ) : null
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Click refresh to load recursion settings.</p>
        )}
      </ConfigSection>

      {/* ── Cache ──────────────────────────────────────── */}
      <ConfigSection title="Cache" icon={Database} onRefresh={loadCache} loading={loading.cache}>
        {cache ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              {Object.entries(cache).map(([key, val]) => (
                <div key={key} className="flex items-center justify-between p-2 rounded bg-secondary/30">
                  <span className="text-xs text-muted-foreground">{key}</span>
                  <span className="text-sm font-mono">{String(val)}</span>
                </div>
              ))}
            </div>
            <Button
              variant="destructive"
              size="sm"
              onClick={async () => {
                const p = getServerParams();
                const r = await api.clearCache(p.server, p.serverId, p.credentialMode);
                if (r.success) toast.success("Cache cleared.");
                else toast.error("Failed: " + r.error);
              }}
            >
              <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Clear Cache
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Click refresh to load cache info.</p>
        )}
      </ConfigSection>

      {/* ── Global Query Block List ────────────────────── */}
      <ConfigSection title="Global Query Block List" icon={Shield} onRefresh={loadBlocklist} loading={loading.blocklist}>
        {blocklist ? (
          <BlocklistPanel blocklist={blocklist} onRefresh={loadBlocklist} />
        ) : (
          <p className="text-sm text-muted-foreground">Click refresh to load block list.</p>
        )}
      </ConfigSection>

      {/* ── Diagnostics ────────────────────────────────── */}
      <ConfigSection title="Diagnostics" icon={Activity} onRefresh={loadDiagnostics} loading={loading.diagnostics}>
        {diagnostics ? (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {Object.entries(diagnostics)
              .filter(([, v]) => typeof v === "boolean")
              .map(([key, val]) => (
                <EditableField key={key} label={key} value={val} type="boolean" onSave={(v) => saveDiagnosticSetting(key, v)} />
              ))}
            {Object.entries(diagnostics)
              .filter(([k, v]) => (typeof v === "number" || typeof v === "string") && k !== "PSComputerName")
              .map(([key, val]) => (
                <EditableField key={key} label={key} value={val} type={typeof val === "number" ? "number" : "string"} onSave={(v) => saveDiagnosticSetting(key, v)} />
              ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Click refresh to load diagnostics.</p>
        )}
      </ConfigSection>

      {/* ── Statistics ─────────────────────────────────── */}
      <ConfigSection title="Statistics" icon={BarChart3} onRefresh={loadStatistics} loading={loading.statistics}>
        {statistics ? (
          <div className="space-y-3">
            <pre className="text-xs font-mono p-3 bg-background rounded-lg border border-border max-h-64 overflow-auto whitespace-pre-wrap">
              {JSON.stringify(statistics, null, 2)}
            </pre>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                const p = getServerParams();
                const r = await api.clearStatistics(p.server, p.serverId, p.credentialMode);
                if (r.success) { toast.success("Statistics cleared."); loadStatistics(); }
                else toast.error("Failed: " + r.error);
              }}
            >
              <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Clear Statistics
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Click refresh to load statistics.</p>
        )}
      </ConfigSection>

      {/* ── Response Rate Limiting ─────────────────────── */}
      <ConfigSection title="Response Rate Limiting" icon={ShieldAlert} onRefresh={() => { loadRRL(); loadRRLExceptions(); }} loading={loading.rrl}>
        {rrl ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {rrl.Mode !== undefined && (
                <EditableField label="Mode" value={rrl.Mode} type="string" onSave={(v) => saveRRLSetting("Mode", v)} />
              )}
              {["ResponsesPerSec", "ErrorsPerSec", "WindowInSec", "LeakRate", "TruncateRate", "TCRate", "IPv4PrefixLength", "IPv6PrefixLength"].map((key) =>
                rrl[key] !== undefined ? (
                  <EditableField key={key} label={key} value={rrl[key]} type="number" onSave={(v) => saveRRLSetting(key, v)} />
                ) : null
              )}
            </div>

            {/* RRL Exceptions */}
            <Separator />
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Exception Lists</h4>
            {rrlExceptions && rrlExceptions.length > 0 ? (
              <div className="space-y-1.5">
                {rrlExceptions.map((exc, i) => (
                  <div key={i} className="flex items-center justify-between p-2 rounded bg-secondary/30">
                    <div>
                      <span className="text-sm font-medium">{String(exc.Name || "")}</span>
                      {exc.Fqdn ? <span className="text-xs text-muted-foreground ml-2">FQDN: {String(exc.Fqdn)}</span> : null}
                    </div>
                    <Button
                      variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive"
                      onClick={async () => {
                        const p = getServerParams();
                        const r = await api.removeRRLException(String(exc.Name), p.server, p.serverId, p.credentialMode);
                        if (r.success) { toast.success("Exception removed."); loadRRLExceptions(); }
                        else toast.error("Failed: " + r.error);
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No RRL exception lists.</p>
            )}
            <RRLExceptionAdder onAdded={loadRRLExceptions} />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Click refresh to load RRL settings.</p>
        )}
      </ConfigSection>

      {/* ── Scavenging ─────────────────────────────────── */}
      <ConfigSection title="Scavenging" icon={Timer} onRefresh={loadScavenging} loading={loading.scavenging}>
        {scavenging ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              {scavenging.ScavengingState !== undefined && (
                <EditableField label="ScavengingState" value={scavenging.ScavengingState} type="boolean" onSave={(v) => saveScavengingSetting("ScavengingState", v)} />
              )}
              {["ScavengingInterval", "RefreshInterval", "NoRefreshInterval"].map((key) =>
                scavenging[key] !== undefined ? (
                  <EditableField key={key} label={key} value={scavenging[key]} type="string" onSave={(v) => saveScavengingSetting(key, v)} />
                ) : null
              )}
              {scavenging.LastScavengeTime !== undefined && (
                <EditableField label="LastScavengeTime" value={scavenging.LastScavengeTime} type="readonly" />
              )}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                const p = getServerParams();
                const r = await api.startScavenging(p.server, p.serverId, p.credentialMode);
                if (r.success) toast.success("Scavenging started.");
                else toast.error("Failed: " + r.error);
              }}
            >
              <Timer className="h-3.5 w-3.5 mr-1.5" /> Scavenge Now
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Click refresh to load scavenging settings.</p>
        )}
      </ConfigSection>

      {/* ── Test Server ────────────────────────────────── */}
      <ConfigSection title="Server Test" icon={FlaskConical}>
        <div className="space-y-3">
          <Button
            size="sm"
            onClick={async () => {
              setL("test", true);
              const p = sp();
              const r = await api.testDnsServer(p.server, p.serverId, p.credentialMode);
              if (r.success) {
                setTestResult((r as Record<string, unknown>).result as Record<string, unknown>);
                toast.success("Server test completed.");
              } else {
                toast.error("Test failed: " + r.error);
              }
              setL("test", false);
            }}
            disabled={loading.test}
          >
            {loading.test ? <RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <FlaskConical className="h-3.5 w-3.5 mr-1.5" />}
            Run Test
          </Button>
          {testResult && (
            <pre className="text-xs font-mono p-3 bg-background rounded-lg border border-border max-h-48 overflow-auto whitespace-pre-wrap">
              {JSON.stringify(testResult, null, 2)}
            </pre>
          )}
        </div>
      </ConfigSection>

      {/* ── Root Hints ─────────────────────────────────── */}
      <ConfigSection title="Root Hints" icon={Globe} onRefresh={loadRootHints} loading={loading.rootHints}>
        {rootHints ? (
          <div className="space-y-1.5 max-h-48 overflow-auto">
            {rootHints.map((h, i) => (
              <div key={i} className="flex items-center justify-between p-2 rounded bg-secondary/30">
                <span className="font-mono text-sm">{String(h.NameServer || h.Name || "")}</span>
                <span className="text-xs text-muted-foreground">{String(h.IPAddress || "")}</span>
              </div>
            ))}
            {rootHints.length === 0 && <p className="text-sm text-muted-foreground">No root hints configured.</p>}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Click refresh to load root hints.</p>
        )}
      </ConfigSection>

      {/* ── EDNS ───────────────────────────────────────── */}
      <ConfigSection title="EDNS" icon={Radio} onRefresh={loadEDns} loading={loading.edns}>
        {edns ? (
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(edns).filter(([, v]) => v !== null).map(([key, val]) => (
              <EditableField
                key={key}
                label={key}
                value={val}
                type={typeof val === "boolean" ? "boolean" : typeof val === "number" ? "number" : "string"}
                onSave={async (v) => {
                  const p = sp();
                  const camel = key.substring(0, 1).toLowerCase() + key.substring(1);
                  const r = await api.setEDns({ [camel]: v }, p.server, p.serverId, p.credentialMode);
                  if (r.success) { toast.success(`${key} updated.`); loadEDns(); return true; }
                  toast.error("Failed: " + r.error); return false;
                }}
              />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Click refresh to load EDNS settings.</p>
        )}
      </ConfigSection>

      {/* ── AD DS Settings ─────────────────────────────── */}
      <ConfigSection title="Active Directory Settings" icon={Server} onRefresh={loadDsSetting} loading={loading.dsSetting}>
        {dsSetting ? (
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(dsSetting).filter(([, v]) => v !== null).map(([key, val]) => (
              <div key={key} className="flex items-center justify-between p-2 rounded bg-secondary/30">
                <span className="text-xs text-muted-foreground truncate mr-2">{key}</span>
                <span className="text-sm font-mono shrink-0">{String(val)}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Click refresh to load AD settings.</p>
        )}
      </ConfigSection>

      {/* ── Global Name Zone ───────────────────────────── */}
      <ConfigSection title="Global Name Zone" icon={ToggleLeft} onRefresh={loadGlobalNameZone} loading={loading.gnz}>
        {globalNameZone ? (
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(globalNameZone).filter(([, v]) => v !== null).map(([key, val]) => (
              <EditableField
                key={key}
                label={key}
                value={val}
                type={typeof val === "boolean" ? "boolean" : typeof val === "number" ? "number" : "string"}
                onSave={async (v) => {
                  const p = sp();
                  const camel = key.substring(0, 1).toLowerCase() + key.substring(1);
                  const r = await api.setGlobalNameZone({ [camel]: v }, p.server, p.serverId, p.credentialMode);
                  if (r.success) { toast.success(`${key} updated.`); loadGlobalNameZone(); return true; }
                  toast.error("Failed: " + r.error); return false;
                }}
              />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Click refresh to load Global Name Zone settings.</p>
        )}
      </ConfigSection>

      {/* ── DNS over HTTPS / DNS over TLS ──────────────── */}
      <ConfigSection title="Encryption (DoH/DoT)" icon={Lock} onRefresh={loadEncryption} loading={loading.encryption}>
        {encryptionUnsupported ? (
          <p className="text-sm text-muted-foreground">Not available on this server version (requires Windows Server 2025+).</p>
        ) : encryption ? (
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(encryption).filter(([, v]) => v !== null).map(([key, val]) => (
              <EditableField
                key={key}
                label={key}
                value={val}
                type={typeof val === "boolean" ? "boolean" : typeof val === "number" ? "number" : "string"}
                onSave={async (v) => {
                  const p = sp();
                  const camel = key.substring(0, 1).toLowerCase() + key.substring(1);
                  const r = await api.setEncryptionProtocol({ [camel]: v }, p.server, p.serverId, p.credentialMode);
                  if (r.success) { toast.success(`${key} updated.`); loadEncryption(); return true; }
                  toast.error("Failed: " + r.error); return false;
                }}
              />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Click refresh to load encryption settings.</p>
        )}
      </ConfigSection>
    </div>
  );
}

// ── Forwarders Sub-panel ─────────────────────────────────

function ForwardersPanel({
  forwarders,
  onRefresh,
}: {
  forwarders: Record<string, unknown>;
  onRefresh: () => void;
}) {
  const [newIp, setNewIp] = useState("");
  const ips = (forwarders.IPAddress as string[]) || [];

  const addForwarder = async () => {
    if (!newIp.trim()) return;
    const p = getServerParams();
    const r = await api.addForwarder(newIp.trim(), p.server, p.serverId, p.credentialMode);
    if (r.success) { toast.success("Forwarder added."); setNewIp(""); onRefresh(); }
    else toast.error("Failed: " + r.error);
  };

  const removeForwarder = async (ip: string) => {
    const p = getServerParams();
    const r = await api.removeForwarder(ip, p.server, p.serverId, p.credentialMode);
    if (r.success) { toast.success("Forwarder removed."); onRefresh(); }
    else toast.error("Failed: " + r.error);
  };

  return (
    <div className="space-y-3">
      {ips.length > 0 ? (
        <div className="space-y-1.5">
          {ips.map((ip) => (
            <div key={ip} className="flex items-center justify-between p-2 rounded bg-secondary/30">
              <span className="font-mono text-sm">{ip}</span>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive" onClick={() => removeForwarder(ip)}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No forwarders configured.</p>
      )}
      <div className="flex gap-2">
        <Input
          placeholder="IP address (e.g., 8.8.8.8)"
          value={newIp}
          onChange={(e) => setNewIp(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addForwarder()}
          className="flex-1"
        />
        <Button size="sm" onClick={addForwarder}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Add
        </Button>
      </div>
      {forwarders.UseRootHint !== undefined && (
        <EditableField
          label="Use Root Hints"
          value={forwarders.UseRootHint}
          type="boolean"
          onSave={async (v) => {
            const p = getServerParams();
            const r = await api.setForwarders({ useRootHint: v }, p.server, p.serverId, p.credentialMode);
            if (r.success) { toast.success("Updated."); onRefresh(); return true; }
            toast.error("Failed: " + r.error); return false;
          }}
        />
      )}
    </div>
  );
}

// ── Block List Sub-panel ─────────────────────────────────

function BlocklistPanel({
  blocklist,
  onRefresh,
}: {
  blocklist: Record<string, unknown>;
  onRefresh: () => void;
}) {
  const [newDomain, setNewDomain] = useState("");
  const domains = (blocklist.List as string[]) || [];
  const enabled = blocklist.Enable as boolean;

  const updateList = async (newList: string[]) => {
    const p = getServerParams();
    const r = await api.setBlockList({ list: newList }, p.server, p.serverId, p.credentialMode);
    if (r.success) { toast.success("Block list updated."); onRefresh(); }
    else toast.error("Failed: " + r.error);
  };

  const addDomain = () => {
    if (!newDomain.trim()) return;
    updateList([...domains, newDomain.trim()]);
    setNewDomain("");
  };

  const removeDomain = (domain: string) => {
    updateList(domains.filter((d) => d !== domain));
  };

  return (
    <div className="space-y-3">
      <EditableField
        label="Enabled"
        value={enabled}
        type="boolean"
        onSave={async (v) => {
          const p = getServerParams();
          const r = await api.setBlockList({ enable: v }, p.server, p.serverId, p.credentialMode);
          if (r.success) { toast.success("Updated."); onRefresh(); return true; }
          toast.error("Failed: " + r.error); return false;
        }}
      />
      {domains.length > 0 ? (
        <div className="space-y-1.5">
          {domains.map((d) => (
            <div key={d} className="flex items-center justify-between p-2 rounded bg-secondary/30">
              <span className="font-mono text-sm">{d}</span>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive" onClick={() => removeDomain(d)}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No domains in block list.</p>
      )}
      <div className="flex gap-2">
        <Input
          placeholder="Domain (e.g., wpad)"
          value={newDomain}
          onChange={(e) => setNewDomain(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addDomain()}
          className="flex-1"
        />
        <Button size="sm" onClick={addDomain}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Add
        </Button>
      </div>
    </div>
  );
}

// ── RRL Exception Adder ──────────────────────────────────

function RRLExceptionAdder({ onAdded }: { onAdded: () => void }) {
  const [name, setName] = useState("");
  const [fqdn, setFqdn] = useState("");

  const add = async () => {
    if (!name.trim()) { toast.warning("Exception name required."); return; }
    const p = getServerParams();
    const data: Record<string, unknown> = { name: name.trim() };
    if (fqdn.trim()) data.fqdn = fqdn.trim();
    const r = await api.addRRLException(data, p.server, p.serverId, p.credentialMode);
    if (r.success) { toast.success("RRL exception added."); setName(""); setFqdn(""); onAdded(); }
    else toast.error("Failed: " + r.error);
  };

  return (
    <div className="flex gap-2">
      <Input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} className="flex-1" />
      <Input placeholder="FQDN (optional)" value={fqdn} onChange={(e) => setFqdn(e.target.value)} className="flex-1" />
      <Button size="sm" onClick={add}>
        <Plus className="h-3.5 w-3.5 mr-1" /> Add
      </Button>
    </div>
  );
}
