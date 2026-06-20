"use client";

import { useCallback, useState } from "react";
import { useStore } from "@/lib/store";
import { api } from "@/lib/api";
import { getServerParams } from "@/lib/utils";
import type { DohConfig, DohProtocol } from "@/lib/types";
import { generateDohSetupScript, MAX_DOH_TEMPLATES } from "@/wizards/doh-setup";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  RefreshCw,
  Lock,
  Plus,
  Trash2,
  Save,
  Copy,
  AlertTriangle,
  ShieldCheck,
} from "lucide-react";

const sp = getServerParams;

function isHttpsTemplate(t: string): boolean {
  return /^https:\/\//i.test(t.trim());
}

export default function DohPage() {
  const bridgeConnected = useStore((s) => s.bridgeConnected);

  // ── Live config (via bridge) ──────────────────────────────
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [unsupported, setUnsupported] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [templates, setTemplates] = useState<string[]>([]);
  const [restartRequired, setRestartRequired] = useState(false);

  // ── Guided setup generator (offline) ──────────────────────
  // Default the host to the active server (reactive to server switches); user can override.
  const activeHost = useStore((s) => {
    const sv = s.getActiveServer();
    return sv && sv.hostname !== "localhost" ? sv.hostname : "";
  });
  const [hostOverride, setHostOverride] = useState<string | null>(null);
  const setupHost = hostOverride ?? activeHost;
  const [bindAddress, setBindAddress] = useState("0.0.0.0");
  const [port, setPort] = useState("443");
  const [certSource, setCertSource] = useState<"existing" | "pfx">("existing");
  const [certSubject, setCertSubject] = useState("");
  const [pfxPath, setPfxPath] = useState("");

  const loadConfig = useCallback(async () => {
    setLoading(true);
    const p = sp();
    const r = await api.getDohConfig(p.server, p.serverId, p.credentialMode);
    if (r.success) {
      const proto = (r as { protocol?: DohProtocol }).protocol ?? {};
      setUnsupported(false);
      setEnabled(!!proto.EnableDoh);
      const raw = proto.UriTemplate ? String(proto.UriTemplate) : "";
      setTemplates(raw ? raw.split("|").map((t) => t.trim()).filter(Boolean) : []);
      setLoaded(true);
    } else if ((r as { unsupported?: boolean }).unsupported) {
      setUnsupported(true);
    } else {
      toast.error("Failed to load DoH config: " + r.error);
    }
    setLoading(false);
  }, []);

  const updateTemplate = (i: number, v: string) =>
    setTemplates((prev) => prev.map((t, idx) => (idx === i ? v : t)));
  const addTemplate = () =>
    setTemplates((prev) => (prev.length >= MAX_DOH_TEMPLATES ? prev : [...prev, ""]));
  const removeTemplate = (i: number) =>
    setTemplates((prev) => prev.filter((_, idx) => idx !== i));

  const saveConfig = async () => {
    const cleaned = templates.map((t) => t.trim()).filter(Boolean);
    if (enabled && cleaned.length > 0) {
      if (cleaned.length > MAX_DOH_TEMPLATES) {
        toast.error(`A maximum of ${MAX_DOH_TEMPLATES} URI templates is allowed.`);
        return;
      }
      const bad = cleaned.find((t) => !isHttpsTemplate(t));
      if (bad) {
        toast.error(`URI templates must be valid HTTPS URIs (got "${bad}").`);
        return;
      }
    }
    const body: DohConfig = { enableDoh: enabled };
    if (enabled && cleaned.length > 0) body.uriTemplate = cleaned;

    setSaving(true);
    const p = sp();
    const r = await api.setDohConfig(body, p.server, p.serverId, p.credentialMode);
    setSaving(false);
    if (r.success) {
      toast.success(enabled ? "DoH enabled." : "DoH disabled.");
      setRestartRequired(!!(r as { restartRequired?: boolean }).restartRequired);
      loadConfig();
    } else {
      toast.error("Failed to save DoH config: " + r.error);
    }
  };

  const setupScript = generateDohSetupScript({
    serverHost: setupHost,
    bindAddress,
    port: Number(port) || 443,
    certSource,
    certSubject: certSubject || undefined,
    pfxPath: pfxPath || undefined,
    uriTemplates: templates.map((t) => t.trim()).filter(Boolean),
  });

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied to clipboard.");
    } catch {
      toast.error("Copy failed — select and copy manually.");
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Lock className="h-5 w-5 text-primary" />
          DNS over HTTPS (DoH)
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Encrypt inbound DNS queries to this server over HTTPS. Inbound DoH requires
          Windows Server 2025 (with the 2026-06 update / KB5094125) or later.
        </p>
      </div>

      {/* ── Live status & configuration ─────────────────────── */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4" />
            Server configuration
          </CardTitle>
          <Button variant="outline" size="sm" onClick={loadConfig} disabled={!bridgeConnected || loading}>
            <RefreshCw className={"h-4 w-4 " + (loading ? "animate-spin" : "")} />
            Refresh
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {!bridgeConnected ? (
            <p className="text-sm text-muted-foreground">
              Connect to a server (bridge offline) to view and change live DoH status. The
              setup-script generator below works offline.
            </p>
          ) : unsupported ? (
            <p className="text-sm text-muted-foreground">
              Not available on this server version — inbound DoH requires Windows Server 2025+.
            </p>
          ) : !loaded ? (
            <p className="text-sm text-muted-foreground">Click refresh to load DoH status.</p>
          ) : (
            <>
              {restartRequired && (
                <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                  <div>
                    <p className="font-medium text-amber-300">Restart required</p>
                    <p className="text-muted-foreground">
                      Restart the DNS Server service for the change to take effect:{" "}
                      <code className="rounded bg-secondary px-1">Restart-Service -Name DNS</code>
                    </p>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label className="text-sm">DoH enabled</Label>
                  <p className="text-xs text-muted-foreground">
                    Disabling clears all configured URI templates.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={enabled ? "default" : "secondary"}>
                    {enabled ? "Enabled" : "Disabled"}
                  </Badge>
                  <Switch checked={enabled} onCheckedChange={setEnabled} />
                </div>
              </div>

              {enabled && (
                <>
                  <Separator />
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm">URI templates (max {MAX_DOH_TEMPLATES})</Label>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={addTemplate}
                        disabled={templates.length >= MAX_DOH_TEMPLATES}
                      >
                        <Plus className="h-4 w-4" /> Add
                      </Button>
                    </div>
                    {templates.length === 0 && (
                      <p className="text-xs text-muted-foreground">
                        No template — the server will auto-generate{" "}
                        <code className="rounded bg-secondary px-1">https://&lt;fqdn&gt;/dns-query</code>.
                      </p>
                    )}
                    {templates.map((t, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <Input
                          value={t}
                          onChange={(e) => updateTemplate(i, e.target.value)}
                          placeholder="https://dns.contoso.com/dns-query"
                          spellCheck={false}
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => removeTemplate(i)}
                          aria-label="Remove URI template"
                          title="Remove URI template"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </>
              )}

              <div className="flex justify-end">
                <Button onClick={saveConfig} disabled={saving}>
                  <Save className="h-4 w-4" />
                  {saving ? "Saving…" : "Save"}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* ── Guided setup script (offline) ───────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Guided setup script</CardTitle>
          <p className="text-sm text-muted-foreground">
            The certificate import, SSL binding, firewall rule, and service restart can&apos;t be
            run remotely through the bridge. Fill in the details and run the generated script in an
            elevated PowerShell session <span className="font-medium">on the DNS server</span>.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="doh-host">Server host (cert SAN / URI host)</Label>
              <Input
                id="doh-host"
                value={setupHost}
                onChange={(e) => setHostOverride(e.target.value)}
                placeholder="dns.contoso.com"
                spellCheck={false}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="doh-bind">Bind address</Label>
                <Input
                  id="doh-bind"
                  value={bindAddress}
                  onChange={(e) => setBindAddress(e.target.value)}
                  placeholder="0.0.0.0"
                  spellCheck={false}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="doh-port">Port</Label>
                <Input
                  id="doh-port"
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  inputMode="numeric"
                  placeholder="443"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Certificate source</Label>
              <Select value={certSource} onValueChange={(v) => setCertSource(v as "existing" | "pfx")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="existing">Existing certificate in store</SelectItem>
                  <SelectItem value="pfx">Import from .pfx file</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {certSource === "pfx" ? (
              <div className="space-y-1.5">
                <Label htmlFor="doh-pfx">.pfx file path</Label>
                <Input
                  id="doh-pfx"
                  value={pfxPath}
                  onChange={(e) => setPfxPath(e.target.value)}
                  placeholder="C:\certs\doh.pfx"
                  spellCheck={false}
                />
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label htmlFor="doh-subject">Certificate subject match</Label>
                <Input
                  id="doh-subject"
                  value={certSubject}
                  onChange={(e) => setCertSubject(e.target.value)}
                  placeholder="defaults to the server host"
                  spellCheck={false}
                />
              </div>
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            Templates are taken from the configuration above (or auto-derived from the host).
          </p>

          <div className="relative">
            <Textarea
              readOnly
              value={setupScript}
              className="h-72 font-mono text-xs"
              spellCheck={false}
            />
            <Button
              variant="secondary"
              size="sm"
              className="absolute right-2 top-2"
              onClick={() => copy(setupScript)}
            >
              <Copy className="h-4 w-4" /> Copy
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
