"use client";

import { useState, useCallback } from "react";
import { useStore } from "@/lib/store";
import { scenarios } from "@/wizards/scenarios";
import { generateCommands } from "@/wizards/command-generator";
import { buildExecutionSteps } from "@/wizards/executor";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/* eslint-disable @typescript-eslint/no-explicit-any */

export default function WizardsPage() {
  const bridgeConnected = useStore((s) => s.bridgeConnected);
  const serverZones = useStore((s) => s.serverZones);
  const addPsOutput = useStore((s) => s.addPsOutput);
  const getActiveServer = useStore((s) => s.getActiveServer);

  const [activeScenario, setActiveScenario] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [data, setData] = useState<Record<string, any>>({});
  const [executing, setExecuting] = useState(false);
  const [execProgress, setExecProgress] = useState<{
    current: number;
    total: number;
    label: string;
    results: { label: string; ok: boolean; error?: string }[];
  } | null>(null);

  const scenario = activeScenario ? scenarios[activeScenario] : null;
  const totalSteps = scenario?.steps.length ?? 0;
  const currentStepDef = scenario?.steps[step];

  const upd = useCallback(
    (patch: Record<string, any>) => setData((d) => ({ ...d, ...patch })),
    []
  );

  const startWizard = (id: string) => {
    setActiveScenario(id);
    setStep(0);
    setData({});
  };

  const cancel = () => {
    setActiveScenario(null);
    setStep(0);
    setData({});
  };

  const next = () => {
    // Basic zone validation
    if (currentStepDef?.id === "zone" || (currentStepDef?.id === "primary" && !data.zone)) {
      if (!data.zone) { toast.warning("Please select a zone."); return; }
    }
    if (step < totalSteps - 1) setStep(step + 1);
  };

  const back = () => { if (step > 0) setStep(step - 1); };

  const getServerHostname = () => {
    const s = getActiveServer();
    return s?.hostname;
  };

  const handleGenerate = () => {
    const cmds = generateCommands(activeScenario!, data, getServerHostname());
    addPsOutput(cmds);
    toast.success("Commands generated. See PowerShell tab.");
    return cmds;
  };

  const handleExecute = async () => {
    if (!bridgeConnected) { toast.warning("Bridge is offline."); return; }

    const server = getActiveServer();
    const sp = server
      ? { server: server.hostname, serverId: server.id, credentialMode: server.credentialMode }
      : {};

    const steps = buildExecutionSteps(activeScenario!, data, sp);
    if (!steps.length) { toast.warning("No steps to execute."); return; }

    setExecuting(true);
    setExecProgress({ current: 0, total: steps.length, label: steps[0].label, results: [] });

    let ok = 0, fail = 0;
    const stepResults: { label: string; ok: boolean; error?: string }[] = [];
    const psLines: string[] = [`# Wizard Execution Results (${activeScenario})`, ""];

    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      setExecProgress((p) => p ? { ...p, current: i, label: s.label } : p);

      const result = await s.execute();
      if (result.success) {
        ok++;
        stepResults.push({ label: s.label, ok: true });
        psLines.push(`[OK] ${s.label}`);
      } else {
        fail++;
        stepResults.push({ label: s.label, ok: false, error: result.error });
        psLines.push(`[FAIL] ${s.label}`);
        if (result.error) psLines.push(`  Error: ${result.error}`);
      }
      setExecProgress((p) => p ? { ...p, results: [...stepResults] } : p);
    }

    psLines.unshift(`# ${ok} succeeded, ${fail} failed`);
    addPsOutput(psLines.join("\n"));
    setExecuting(false);

    if (fail === 0) toast.success(`All ${ok} steps completed successfully!`);
    else toast.warning(`${ok} succeeded, ${fail} failed. Check results below.`);
  };

  // ── Scenario Grid ──────────────────────────────────────
  if (!activeScenario) {
    return (
      <div className="space-y-6">
        <h2 className="text-lg font-semibold">Scenario Wizards</h2>
        <p className="text-sm text-muted-foreground">
          Choose a scenario to configure DNS policies step-by-step with generated PowerShell commands.
        </p>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {Object.values(scenarios).map((s) => (
            <Card
              key={s.id}
              className="p-5 cursor-pointer transition-all hover:bg-secondary/50 hover:ring-1 hover:ring-primary/30"
              onClick={() => startWizard(s.id)}
            >
              <div className="text-3xl mb-3">{s.icon}</div>
              <div className="font-semibold text-sm mb-1">{s.title}</div>
              <div className="text-xs text-muted-foreground leading-relaxed">{s.description}</div>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  // ── Active Wizard ──────────────────────────────────────
  const progress = ((step + 1) / totalSteps) * 100;
  const isReview = currentStepDef?.id === "review";
  const commands = isReview ? generateCommands(activeScenario, data, getServerHostname()) : "";

  return (
    <div className="space-y-6">
      {/* Progress */}
      <div className="space-y-3">
        <div className="text-sm font-medium">
          {scenario!.title} — Step {step + 1} of {totalSteps}
        </div>
        <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
          <div
            className="h-full bg-primary transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="flex gap-2">
          {scenario!.steps.map((s, i) => (
            <span
              key={s.id}
              className={`text-xs px-2 py-1 rounded-full ${
                i < step
                  ? "bg-primary/20 text-primary"
                  : i === step
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-muted-foreground"
              }`}
            >
              {s.title}
            </span>
          ))}
        </div>
      </div>

      {/* Step Content */}
      <Card className="p-6">
        {isReview ? (
          <div className="space-y-4">
            <h3 className="font-semibold">Review Generated Commands</h3>
            <pre className="font-mono text-xs p-4 bg-background rounded-lg border border-border whitespace-pre-wrap max-h-72 overflow-auto">
              {commands}
            </pre>

            {/* Execution progress */}
            {execProgress && (
              <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{execProgress.label}</span>
                  <span>{execProgress.current + 1} / {execProgress.total}</span>
                </div>
                <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all duration-300"
                    style={{ width: `${((execProgress.current + 1) / execProgress.total) * 100}%` }}
                  />
                </div>
                {execProgress.results.length > 0 && (
                  <div className="space-y-1 max-h-48 overflow-auto">
                    {execProgress.results.map((r, i) => (
                      <div key={i} className={`text-xs px-2 py-1 rounded ${r.ok ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"}`}>
                        {r.ok ? "\u2713" : "\u2717"} {r.label}
                        {r.error ? <span className="block text-[11px] text-red-300 ml-4">{r.error}</span> : null}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <StepContent
            scenarioId={activeScenario}
            stepId={currentStepDef!.id}
            data={data}
            upd={upd}
            serverZones={serverZones as any[]}
          />
        )}
      </Card>

      {/* Navigation */}
      <div className="flex justify-between">
        <Button variant="outline" onClick={cancel}>Cancel</Button>
        <div className="flex gap-2">
          {step > 0 && <Button variant="outline" onClick={back}>Back</Button>}
          {!isReview && <Button onClick={next}>Next</Button>}
          {isReview && (
            <>
              <Button variant="outline" onClick={handleGenerate}>Generate Commands</Button>
              {bridgeConnected && (
                <Button onClick={handleExecute} disabled={executing}>
                  {executing ? "Executing..." : "Execute on Server"}
                </Button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Shared sub-components (must be outside StepContent) ──

function ZoneSelect({ data, upd, serverZones }: { data: any; upd: (p: any) => void; serverZones: any[] }) {
  return (
    <div className="space-y-2">
      <Label>Zone Name</Label>
      <Select value={data.zone || ""} onValueChange={(v) => upd({ zone: v })}>
        <SelectTrigger><SelectValue placeholder="Select a zone..." /></SelectTrigger>
        <SelectContent>
          {serverZones.map((z: any, i: number) => {
            const name = z.ZoneName || z.zoneName || z;
            return <SelectItem key={i} value={name}>{name}</SelectItem>;
          })}
        </SelectContent>
      </Select>
    </div>
  );
}

function DynList({
  items, setItems, fields, addLabel,
}: {
  items: any[]; setItems: (v: any[]) => void;
  fields: { key: string; placeholder: string; type?: string }[];
  addLabel: string;
}) {
  return (
    <div className="space-y-2">
      {items.map((item: any, i: number) => (
        <div key={i} className="flex gap-2">
          {fields.map((f) => (
            <Input
              key={f.key}
              type={f.type || "text"}
              placeholder={f.placeholder}
              value={item[f.key] || ""}
              onChange={(e) => {
                const next = [...items];
                next[i] = { ...next[i], [f.key]: f.type === "number" ? parseInt(e.target.value) || 1 : e.target.value };
                setItems(next);
              }}
              className="flex-1"
            />
          ))}
          {items.length > 1 && (
            <Button variant="destructive" size="sm" onClick={() => setItems(items.filter((_, idx) => idx !== i))}>
              ×
            </Button>
          )}
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={() => setItems([...items, {}])}>
        {addLabel}
      </Button>
    </div>
  );
}

// ── Step Content Router ──────────────────────────────────

function StepContent({
  scenarioId, stepId, data, upd, serverZones,
}: {
  scenarioId: string; stepId: string; data: any; upd: (p: any) => void; serverZones: any[];
}) {
  const key = `${scenarioId}_${stepId}`;

  switch (key) {
    // ── Geo-Location ──
    case "geolocation_zone":
      return <ZoneSelect data={data} upd={upd} serverZones={serverZones} />;
    case "geolocation_regions":
      return (
        <div className="space-y-4">
          <h3 className="font-semibold">Define Geographic Regions</h3>
          <p className="text-sm text-muted-foreground">Each region creates a client subnet, zone scope, and DNS records.</p>
          <DynList
            items={data.regions || [{ name: "", subnet: "", ip: "" }]}
            setItems={(v) => upd({ regions: v })}
            fields={[
              { key: "name", placeholder: "Region name (e.g., NorthAmerica)" },
              { key: "subnet", placeholder: "Subnet CIDR (e.g., 10.0.0.0/8)" },
              { key: "ip", placeholder: "Target IP" },
            ]}
            addLabel="Add Region"
          />
        </div>
      );
    case "geolocation_records":
      return (
        <div className="space-y-4">
          <h3 className="font-semibold">Record Configuration</h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Record Name</Label>
              <Input value={data.recordName || ""} onChange={(e) => upd({ recordName: e.target.value })} placeholder="www" />
            </div>
            <div className="space-y-2">
              <Label>Record Type</Label>
              <Select value={data.recordType || "A"} onValueChange={(v) => upd({ recordType: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="A">A</SelectItem>
                  <SelectItem value="AAAA">AAAA</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Default / Fallback IP</Label>
            <Input value={data.fallbackIP || ""} onChange={(e) => upd({ fallbackIP: e.target.value })} placeholder="198.51.100.1" />
            <p className="text-xs text-muted-foreground">Added to default zone scope for clients not matching any region.</p>
          </div>
        </div>
      );

    // ── Split-Brain ──
    case "splitbrain_method":
      return (
        <div className="space-y-4">
          <h3 className="font-semibold">Choose Split-Brain Method</h3>
          <div className="space-y-2">
            <Label>Method</Label>
            <Select value={data.splitMethod || "subnet"} onValueChange={(v) => upd({ splitMethod: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="subnet">By Client Subnet</SelectItem>
                <SelectItem value="interface">By Server Interface</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={data.splitAD || false} onChange={(e) => upd({ splitAD: e.target.checked })} className="rounded" />
            <span className="text-sm">Active Directory integrated zone</span>
          </label>
        </div>
      );
    case "splitbrain_zone":
      return (
        <div className="space-y-4">
          <ZoneSelect data={data} upd={upd} serverZones={serverZones} />
          {data.splitMethod === "interface" ? (
            <div className="space-y-2">
              <Label>Internal Interface IP</Label>
              <Input value={data.internalInterface || ""} onChange={(e) => upd({ internalInterface: e.target.value })} placeholder="10.0.0.1" />
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <Label>Internal Subnet(s) (comma-separated CIDRs)</Label>
                <Input value={data.internalSubnets || ""} onChange={(e) => upd({ internalSubnets: e.target.value })} placeholder="10.0.0.0/8, 192.168.0.0/16" />
              </div>
              <div className="space-y-2">
                <Label>Subnet Name</Label>
                <Input value={data.subnetName || "InternalSubnet"} onChange={(e) => upd({ subnetName: e.target.value })} />
              </div>
            </>
          )}
        </div>
      );
    case "splitbrain_records":
      return (
        <div className="space-y-4">
          <h3 className="font-semibold">Internal Zone Scope Records</h3>
          <div className="space-y-2">
            <Label>Internal Scope Name</Label>
            <Input value={data.internalScopeName || "internal"} onChange={(e) => upd({ internalScopeName: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>Record Name</Label>
            <Input value={data.splitRecordName || ""} onChange={(e) => upd({ splitRecordName: e.target.value })} placeholder="www" />
          </div>
          <div className="space-y-2">
            <Label>Internal IP Address</Label>
            <Input value={data.internalIP || ""} onChange={(e) => upd({ internalIP: e.target.value })} placeholder="10.0.0.5" />
          </div>
        </div>
      );
    case "splitbrain_recursion":
      return (
        <div className="space-y-4">
          <h3 className="font-semibold">Recursion Configuration</h3>
          <p className="text-sm text-muted-foreground">Disables recursion for external, enables for internal clients.</p>
          <div className="space-y-2">
            <Label>Internal Recursion Scope Name</Label>
            <Input value={data.internalRecursionScope || "InternalRecursionScope"} onChange={(e) => upd({ internalRecursionScope: e.target.value })} />
          </div>
        </div>
      );
    case "splitbrain_policies":
      return (
        <div className="space-y-4">
          <h3 className="font-semibold">Policy Configuration</h3>
          <p className="text-sm text-muted-foreground">Two policies will be created: recursion + query resolution.</p>
          <div className="space-y-2">
            <Label>Base Processing Order</Label>
            <Input type="number" min="1" value={data.splitOrder || "1"} onChange={(e) => upd({ splitOrder: e.target.value })} />
          </div>
        </div>
      );

    // ── Blocklist ──
    case "blocklist_domains":
      return (
        <div className="space-y-4">
          <h3 className="font-semibold">Import Domains to Block</h3>
          <div className="space-y-2">
            <Label>Domains (one per line or comma-separated)</Label>
            <Textarea rows={8} value={data.blocklistDomains || ""} onChange={(e) => upd({ blocklistDomains: e.target.value })} placeholder={"*.malware.com\n*.phishing.net\nbadsite.org"} />
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={data.blocklistWildcard !== false} onChange={(e) => upd({ blocklistWildcard: e.target.checked })} className="rounded" />
            <span className="text-sm">Add wildcard (*.) prefix to domains</span>
          </label>
        </div>
      );
    case "blocklist_action":
      return (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Action</Label>
            <Select value={data.blocklistAction || "IGNORE"} onValueChange={(v) => upd({ blocklistAction: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="IGNORE">IGNORE (Drop silently)</SelectItem>
                <SelectItem value="DENY">DENY (Return refused)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Policy Name Prefix</Label>
            <Input value={data.blocklistPolicyName || "Blocklist"} onChange={(e) => upd({ blocklistPolicyName: e.target.value })} />
          </div>
        </div>
      );

    // ── Time-of-Day ──
    case "timeofday_zone":
      return (
        <div className="space-y-4">
          <ZoneSelect data={data} upd={upd} serverZones={serverZones} />
          <div className="space-y-2">
            <Label>Record Name</Label>
            <Input value={data.todRecordName || ""} onChange={(e) => upd({ todRecordName: e.target.value })} placeholder="www" />
          </div>
          <div className="space-y-2">
            <Label>Record TTL (seconds, optional)</Label>
            <Input type="number" min="0" value={data.todTtl || ""} onChange={(e) => upd({ todTtl: e.target.value })} placeholder="3600" />
          </div>
        </div>
      );
    case "timeofday_datacenters":
      return (
        <div className="space-y-4">
          <h3 className="font-semibold">Define Datacenters</h3>
          <p className="text-sm text-muted-foreground">Each datacenter gets a zone scope. Subnet is optional (adds geo-awareness).</p>
          <DynList
            items={data.todDatacenters || [{ name: "Primary", ip: "", subnet: "" }, { name: "Cloud", ip: "", subnet: "" }]}
            setItems={(v) => upd({ todDatacenters: v })}
            fields={[
              { key: "name", placeholder: "Datacenter name" },
              { key: "ip", placeholder: "IP address" },
              { key: "subnet", placeholder: "Client subnet (optional)" },
            ]}
            addLabel="Add Datacenter"
          />
        </div>
      );
    case "timeofday_peakhours":
      return (
        <div className="space-y-4">
          <h3 className="font-semibold">Peak Hours & Weights</h3>
          <div className="space-y-2">
            <Label>Peak Hours (e.g., 18:00-21:00)</Label>
            <Input value={data.todPeakHours || ""} onChange={(e) => upd({ todPeakHours: e.target.value })} placeholder="18:00-21:00" />
          </div>
          <h4 className="text-sm font-medium">Weights per Datacenter</h4>
          <p className="text-xs text-muted-foreground">Higher weight = more traffic.</p>
          {(data.todDatacenters || []).filter((dc: any) => dc.name).map((dc: any) => (
            <div key={dc.name} className="flex items-center gap-3">
              <span className="text-sm w-32">{dc.name}</span>
              <Input
                type="number" min="1" className="w-20"
                value={data.todWeights?.[dc.name] || 1}
                onChange={(e) => upd({ todWeights: { ...data.todWeights, [dc.name]: parseInt(e.target.value) || 1 } })}
              />
            </div>
          ))}
        </div>
      );

    // ── Load Balancing ──
    case "loadbalancing_zone":
      return (
        <div className="space-y-4">
          <ZoneSelect data={data} upd={upd} serverZones={serverZones} />
          <div className="space-y-2">
            <Label>Record Name</Label>
            <Input value={data.lbRecordName || ""} onChange={(e) => upd({ lbRecordName: e.target.value })} placeholder="www" />
          </div>
          <div className="space-y-2">
            <Label>Record TTL (seconds, optional)</Label>
            <Input type="number" min="0" value={data.lbTtl || ""} onChange={(e) => upd({ lbTtl: e.target.value })} placeholder="300" />
          </div>
        </div>
      );
    case "loadbalancing_backends":
      return (
        <div className="space-y-4">
          <h3 className="font-semibold">Define Backend Servers</h3>
          <p className="text-sm text-muted-foreground">Each backend gets a zone scope with weighted distribution.</p>
          <DynList
            items={data.backends || [{ name: "Server1", ip: "", weight: 1 }, { name: "Server2", ip: "", weight: 1 }]}
            setItems={(v) => upd({ backends: v })}
            fields={[
              { key: "name", placeholder: "Scope name" },
              { key: "ip", placeholder: "IP address" },
              { key: "weight", placeholder: "Weight", type: "number" },
            ]}
            addLabel="Add Backend"
          />
        </div>
      );

    // ── Geo + LB ──
    case "geolb_zone":
      return (
        <div className="space-y-4">
          <ZoneSelect data={data} upd={upd} serverZones={serverZones} />
          <div className="space-y-2">
            <Label>Record Name</Label>
            <Input value={data.geolbRecordName || ""} onChange={(e) => upd({ geolbRecordName: e.target.value })} placeholder="www" />
          </div>
        </div>
      );
    case "geolb_regions":
      return (
        <div className="space-y-4">
          <h3 className="font-semibold">Define Regions</h3>
          <DynList
            items={data.geolbRegions || [{ name: "", subnet: "" }]}
            setItems={(v) => upd({ geolbRegions: v })}
            fields={[
              { key: "name", placeholder: "Region name" },
              { key: "subnet", placeholder: "Subnet CIDR" },
            ]}
            addLabel="Add Region"
          />
        </div>
      );
    case "geolb_datacenters":
      return (
        <div className="space-y-4">
          <h3 className="font-semibold">Datacenters</h3>
          <DynList
            items={data.geolbDatacenters || [{ name: "", ip: "" }]}
            setItems={(v) => upd({ geolbDatacenters: v })}
            fields={[
              { key: "name", placeholder: "Datacenter name" },
              { key: "ip", placeholder: "IP address" },
            ]}
            addLabel="Add Datacenter"
          />
          {/* Per-region weights */}
          {(data.geolbRegions || []).filter((r: any) => r.name).length > 0 &&
            (data.geolbDatacenters || []).filter((d: any) => d.name).length > 0 && (
              <div className="space-y-3 mt-4">
                <h4 className="text-sm font-medium">Weights per Region</h4>
                {(data.geolbRegions || []).filter((r: any) => r.name).map((r: any) => (
                  <Card key={r.name} className="p-3">
                    <div className="font-medium text-sm mb-2">{r.name}</div>
                    <div className="flex gap-3 flex-wrap">
                      {(data.geolbDatacenters || []).filter((d: any) => d.name).map((dc: any) => (
                        <div key={dc.name} className="flex items-center gap-2">
                          <span className="text-xs">{dc.name}:</span>
                          <Input
                            type="number" min="1" className="w-16"
                            value={data.geolbRegionWeights?.[r.name]?.[dc.name] || 1}
                            onChange={(e) => {
                              const w = { ...data.geolbRegionWeights };
                              if (!w[r.name]) w[r.name] = {};
                              w[r.name][dc.name] = parseInt(e.target.value) || 1;
                              upd({ geolbRegionWeights: w });
                            }}
                          />
                        </div>
                      ))}
                    </div>
                  </Card>
                ))}
              </div>
            )}
          <label className="flex items-center gap-2 cursor-pointer mt-3">
            <input type="checkbox" checked={data.geolbWorldwide !== false} onChange={(e) => upd({ geolbWorldwide: e.target.checked })} className="rounded" />
            <span className="text-sm">Include worldwide catch-all policy</span>
          </label>
        </div>
      );

    // ── Primary-Secondary ──
    case "primarysecondary_primary":
      return (
        <div className="space-y-4">
          <h3 className="font-semibold">Primary Server Geo-Location Setup</h3>
          <ZoneSelect data={data} upd={upd} serverZones={serverZones} />
          <div className="space-y-2">
            <Label>Record Name</Label>
            <Input value={data.psRecordName || ""} onChange={(e) => upd({ psRecordName: e.target.value })} placeholder="www" />
          </div>
          <h4 className="text-sm font-medium mt-4">Regions</h4>
          <DynList
            items={data.psRegions || [{ name: "", subnet: "", ip: "" }]}
            setItems={(v) => upd({ psRegions: v })}
            fields={[
              { key: "name", placeholder: "Region name" },
              { key: "subnet", placeholder: "Subnet CIDR" },
              { key: "ip", placeholder: "Target IP" },
            ]}
            addLabel="Add Region"
          />
        </div>
      );
    case "primarysecondary_secondaries":
      return (
        <div className="space-y-4">
          <h3 className="font-semibold">Secondary DNS Servers</h3>
          <p className="text-sm text-muted-foreground">Secondaries receive zone transfers. Subnets, scopes, and policies will be copied.</p>
          <DynList
            items={data.psSecondaries || [{ name: "", ip: "" }]}
            setItems={(v) => upd({ psSecondaries: v })}
            fields={[
              { key: "name", placeholder: "Hostname" },
              { key: "ip", placeholder: "IP address" },
            ]}
            addLabel="Add Secondary"
          />
        </div>
      );

    // ── Query Filter ──
    case "queryfilter_mode":
      return (
        <div className="space-y-4">
          <h3 className="font-semibold">Filter Mode & Criteria</h3>
          <div className="space-y-2">
            <Label>Filter Mode</Label>
            <Select value={data.filterMode || "blocklist"} onValueChange={(v) => upd({ filterMode: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="blocklist">Blocklist — Block matching queries</SelectItem>
                <SelectItem value="allowlist">Allowlist — Block non-matching queries</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Action (blocklist mode)</Label>
            <Select value={data.filterAction || "IGNORE"} onValueChange={(v) => upd({ filterAction: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="IGNORE">IGNORE (Drop silently)</SelectItem>
                <SelectItem value="DENY">DENY (Return refused)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Criteria Types</Label>
            {["FQDN", "ClientSubnet", "QType", "ServerInterfaceIP"].map((t) => (
              <label key={t} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={(data.filterCriteria || ["FQDN"]).includes(t)}
                  onChange={(e) => {
                    const cur = data.filterCriteria || ["FQDN"];
                    upd({ filterCriteria: e.target.checked ? [...cur, t] : cur.filter((c: string) => c !== t) });
                  }}
                  className="rounded"
                />
                <span className="text-sm">{t}</span>
              </label>
            ))}
          </div>
          <div className="space-y-2">
            <Label>Policy Name</Label>
            <Input value={data.filterPolicyName || "QueryFilter"} onChange={(e) => upd({ filterPolicyName: e.target.value })} />
          </div>
        </div>
      );
    case "queryfilter_values":
      return (
        <div className="space-y-4">
          <h3 className="font-semibold">Filter Values</h3>
          {(data.filterCriteria || ["FQDN"]).includes("FQDN") && (
            <div className="space-y-2">
              <Label>Domains</Label>
              <Textarea rows={5} value={data.filterFqdns || ""} onChange={(e) => upd({ filterFqdns: e.target.value })} placeholder={"*.malware.com\nbadsite.org"} />
            </div>
          )}
          {(data.filterCriteria || []).includes("ClientSubnet") && (
            <div className="space-y-2">
              <Label>Client Subnets (comma-separated)</Label>
              <Input value={data.filterSubnets || ""} onChange={(e) => upd({ filterSubnets: e.target.value })} placeholder="10.0.0.0/8" />
            </div>
          )}
          {(data.filterCriteria || []).includes("QType") && (
            <div className="space-y-2">
              <Label>Query Types (comma-separated)</Label>
              <Input value={data.filterQTypes || ""} onChange={(e) => upd({ filterQTypes: e.target.value })} placeholder="ANY, AXFR" />
            </div>
          )}
          {(data.filterCriteria || []).includes("ServerInterfaceIP") && (
            <div className="space-y-2">
              <Label>Server Interface IPs (comma-separated)</Label>
              <Input value={data.filterServerIPs || ""} onChange={(e) => upd({ filterServerIPs: e.target.value })} placeholder="10.0.0.1" />
            </div>
          )}
          <div className="space-y-2">
            <Label>Condition (multiple criteria)</Label>
            <Select value={data.filterCondition || "AND"} onValueChange={(v) => upd({ filterCondition: v })}>
              <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="AND">AND</SelectItem>
                <SelectItem value="OR">OR</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      );

    default:
      return <p className="text-muted-foreground">Unknown step: {key}</p>;
  }
}
