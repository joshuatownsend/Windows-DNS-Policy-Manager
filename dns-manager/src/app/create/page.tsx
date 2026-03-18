"use client";

import { useState } from "react";
import { useStore } from "@/lib/store";
import { api } from "@/lib/api";
import type { PolicyType, PolicyAction } from "@/lib/types";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Criterion {
  type: string;
  operator: string;
  value: string;
}

interface Scope {
  scopeName: string;
  weight: number;
}

const CRITERIA_TYPES = [
  "ClientSubnet",
  "Fqdn",
  "TransportProtocol",
  "InternetProtocol",
  "ServerInterfaceIP",
  "TimeOfDay",
  "QType",
];

function getServerParams() {
  const server = useStore.getState().getActiveServer();
  if (!server) return { server: undefined, serverId: undefined, credentialMode: undefined };
  return { server: server.hostname, serverId: server.id, credentialMode: server.credentialMode };
}

function buildCommand(
  policyType: PolicyType,
  name: string,
  action: PolicyAction,
  processingOrder: string,
  isEnabled: boolean,
  zoneName: string,
  applyToZone: boolean,
  condition: string,
  criteria: Criterion[],
  scopes: Scope[],
  recursionScope: string,
  serverHostname?: string
): string {
  const serverParam =
    serverHostname && serverHostname !== "localhost"
      ? ` -ComputerName "${serverHostname}"`
      : "";

  let cmdlet = "";
  if (policyType === "QueryResolution") cmdlet = "Add-DnsServerQueryResolutionPolicy";
  else if (policyType === "Recursion") cmdlet = "Add-DnsServerRecursionPolicy";
  else cmdlet = "Add-DnsServerZoneTransferPolicy";

  let cmd = `${cmdlet} -Name "${name}" -Action ${action}`;
  cmd += ` -ProcessingOrder ${processingOrder || "1"}`;

  if (!isEnabled) cmd += " -IsEnabled $false";

  // Zone
  if (policyType !== "Recursion" && zoneName && applyToZone) {
    cmd += ` -ZoneName "${zoneName}"`;
  }

  // Criteria
  const validCriteria = criteria.filter((c) => c.type && c.value);
  validCriteria.forEach((c) => {
    cmd += ` -${c.type} "${c.operator},${c.value}"`;
  });

  // Condition
  if (validCriteria.length > 1) {
    cmd += ` -Condition ${condition}`;
  }

  // Scopes (QueryResolution only)
  if (policyType === "QueryResolution" && scopes.length > 0) {
    const validScopes = scopes.filter((s) => s.scopeName);
    if (validScopes.length > 0) {
      const scopeStr = validScopes
        .map((s) => `${s.scopeName},${s.weight}`)
        .join(";");
      cmd += ` -ZoneScope "${scopeStr}"`;
    }
  }

  // Recursion scope
  if (policyType === "Recursion" && recursionScope) {
    cmd += ` -RecursionScope "${recursionScope}"`;
  }

  cmd += serverParam;
  return cmd;
}

export default function CreatePolicyPage() {
  const bridgeConnected = useStore((s) => s.bridgeConnected);
  const executionMode = useStore((s) => s.executionMode);
  const servers = useStore((s) => s.servers);
  const activeServerId = useStore((s) => s.activeServerId);
  const addPsOutput = useStore((s) => s.addPsOutput);

  const [policyType, setPolicyType] = useState<PolicyType>("QueryResolution");
  const [name, setName] = useState("");
  const [action, setAction] = useState<PolicyAction>("ALLOW");
  const [processingOrder, setProcessingOrder] = useState("1");
  const [isEnabled, setIsEnabled] = useState(true);
  const [zoneName, setZoneName] = useState("");
  const [applyToZone, setApplyToZone] = useState(true);
  const [condition, setCondition] = useState("AND");
  const [criteria, setCriteria] = useState<Criterion[]>([]);
  const [scopes, setScopes] = useState<Scope[]>([{ scopeName: "", weight: 1 }]);
  const [recursionScope, setRecursionScope] = useState("");
  const [generatedCmd, setGeneratedCmd] = useState("");
  const [selectedServers, setSelectedServers] = useState<Set<string>>(
    new Set(activeServerId ? [activeServerId] : [])
  );
  const [loading, setLoading] = useState(false);

  const addCriterion = () =>
    setCriteria([...criteria, { type: "ClientSubnet", operator: "EQ", value: "" }]);

  const removeCriterion = (i: number) =>
    setCriteria(criteria.filter((_, idx) => idx !== i));

  const updateCriterion = (i: number, field: keyof Criterion, val: string) =>
    setCriteria(criteria.map((c, idx) => (idx === i ? { ...c, [field]: val } : c)));

  const addScope = () => setScopes([...scopes, { scopeName: "", weight: 1 }]);
  const removeScope = (i: number) => setScopes(scopes.filter((_, idx) => idx !== i));
  const updateScope = (i: number, field: keyof Scope, val: string | number) =>
    setScopes(scopes.map((s, idx) => (idx === i ? { ...s, [field]: val } : s)));

  const toggleServer = (id: string) => {
    const next = new Set(selectedServers);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedServers(next);
  };

  const toggleAll = () => {
    if (selectedServers.size === servers.length)
      setSelectedServers(new Set());
    else
      setSelectedServers(new Set(servers.map((s) => s.id)));
  };

  const generate = () => {
    if (!name.trim()) {
      toast.warning("Policy name is required.");
      return;
    }
    const sp = getServerParams();
    const cmd = buildCommand(
      policyType, name.trim(), action, processingOrder, isEnabled,
      zoneName, applyToZone, condition, criteria, scopes, recursionScope,
      sp.server
    );
    setGeneratedCmd(cmd);
    addPsOutput(cmd);
    toast.success("Command generated.");
    return cmd;
  };

  const handleSubmit = async () => {
    const cmd = generate();
    if (!cmd) return;

    if (executionMode === "execute" && bridgeConnected) {
      setLoading(true);
      const result = await api.execute(cmd);
      setLoading(false);
      if (result.success) {
        toast.success("Policy created successfully.");
      } else {
        toast.error("Failed: " + (result.error || "Unknown error"));
      }
    }
  };

  const policyTypes: { type: PolicyType; label: string; desc: string }[] = [
    { type: "QueryResolution", label: "Query Resolution", desc: "Controls how DNS queries are resolved" },
    { type: "Recursion", label: "Recursion", desc: "Controls recursive query behavior" },
    { type: "ZoneTransfer", label: "Zone Transfer", desc: "Controls zone transfer requests" },
  ];

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold">Create Policy</h2>

      {/* Policy Type Selector */}
      <div className="grid grid-cols-3 gap-3">
        {policyTypes.map((pt) => (
          <Card
            key={pt.type}
            className={`p-4 cursor-pointer transition-all hover:bg-secondary/50 ${
              policyType === pt.type ? "ring-1 ring-primary bg-secondary/30" : ""
            }`}
            onClick={() => setPolicyType(pt.type)}
          >
            <div className="font-medium">{pt.label}</div>
            <div className="text-xs text-muted-foreground mt-1">{pt.desc}</div>
          </Card>
        ))}
      </div>

      <Separator />

      {/* Basic Info */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Policy Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="MyPolicy" />
        </div>
        <div className="space-y-2">
          <Label>Processing Order</Label>
          <Input
            type="number"
            min="1"
            value={processingOrder}
            onChange={(e) => setProcessingOrder(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label>Action</Label>
          <Select value={action} onValueChange={(v) => { if (v) setAction(v as PolicyAction); }}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALLOW">ALLOW</SelectItem>
              <SelectItem value="DENY">DENY</SelectItem>
              <SelectItem value="IGNORE">IGNORE</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-3 pt-6">
          <Switch checked={isEnabled} onCheckedChange={setIsEnabled} />
          <Label>Enabled</Label>
        </div>
      </div>

      {/* Zone Section */}
      {policyType !== "Recursion" && (
        <>
          <Separator />
          <div className="space-y-3">
            <h3 className="text-sm font-semibold">Zone</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Zone Name</Label>
                <Input value={zoneName} onChange={(e) => setZoneName(e.target.value)} placeholder="contoso.com" />
              </div>
              <div className="flex items-center gap-3 pt-6">
                <Switch checked={applyToZone} onCheckedChange={setApplyToZone} />
                <Label>Apply to Zone</Label>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Criteria Section */}
      {policyType !== "Recursion" && (
        <>
          <Separator />
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Criteria</h3>
              <Button variant="outline" size="sm" onClick={addCriterion}>
                Add Criterion
              </Button>
            </div>
            {criteria.length > 1 && (
              <div className="space-y-2">
                <Label>Condition</Label>
                <Select value={condition} onValueChange={(v) => { if (v) setCondition(v); }}>
                  <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="AND">AND</SelectItem>
                    <SelectItem value="OR">OR</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            {criteria.map((c, i) => (
              <div key={i} className="flex gap-2 items-end">
                <div className="flex-1 space-y-1">
                  <Label className="text-xs">Type</Label>
                  <Select value={c.type} onValueChange={(v) => { if (v) updateCriterion(i, "type", v); }}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CRITERIA_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>{t}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="w-20 space-y-1">
                  <Label className="text-xs">Op</Label>
                  <Select value={c.operator} onValueChange={(v) => { if (v) updateCriterion(i, "operator", v); }}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="EQ">EQ</SelectItem>
                      <SelectItem value="NE">NE</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex-1 space-y-1">
                  <Label className="text-xs">Value</Label>
                  <Input value={c.value} onChange={(e) => updateCriterion(i, "value", e.target.value)} placeholder="e.g., SubnetName" />
                </div>
                <Button variant="destructive" size="sm" onClick={() => removeCriterion(i)}>
                  Remove
                </Button>
              </div>
            ))}
            {criteria.length === 0 && (
              <p className="text-sm text-muted-foreground">No criteria. Click "Add Criterion" to filter by client subnet, FQDN, etc.</p>
            )}
          </div>
        </>
      )}

      {/* Scope Section (QueryResolution only) */}
      {policyType === "QueryResolution" && (
        <>
          <Separator />
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Zone Scopes</h3>
              <Button variant="outline" size="sm" onClick={addScope}>
                Add Scope
              </Button>
            </div>
            {scopes.map((s, i) => (
              <div key={i} className="flex gap-2 items-end">
                <div className="flex-1 space-y-1">
                  <Label className="text-xs">Scope Name</Label>
                  <Input value={s.scopeName} onChange={(e) => updateScope(i, "scopeName", e.target.value)} placeholder="e.g., NorthAmericaScope" />
                </div>
                <div className="w-24 space-y-1">
                  <Label className="text-xs">Weight</Label>
                  <Input type="number" min="1" max="100" value={s.weight} onChange={(e) => updateScope(i, "weight", parseInt(e.target.value) || 1)} />
                </div>
                {scopes.length > 1 && (
                  <Button variant="destructive" size="sm" onClick={() => removeScope(i)}>
                    Remove
                  </Button>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {/* Recursion Scope (Recursion only) */}
      {policyType === "Recursion" && (
        <>
          <Separator />
          <div className="space-y-2">
            <Label>Recursion Scope Name</Label>
            <Input value={recursionScope} onChange={(e) => setRecursionScope(e.target.value)} placeholder="e.g., InternalRecursionScope" />
          </div>
        </>
      )}

      {/* Target Servers */}
      <Separator />
      <div className="space-y-3">
        <h3 className="text-sm font-semibold">Target Servers</h3>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={selectedServers.size === servers.length}
            onChange={toggleAll}
            className="rounded border-border"
          />
          <span className="text-sm font-semibold">Select All</span>
        </label>
        {servers.map((s) => (
          <label key={s.id} className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={selectedServers.has(s.id)}
              onChange={() => toggleServer(s.id)}
              className="rounded border-border"
            />
            <span className="text-sm">{s.name}</span>
            <span className="text-xs text-muted-foreground">{s.hostname}</span>
          </label>
        ))}
      </div>

      {/* Submit */}
      <Separator />
      <div className="flex gap-3">
        <Button variant="outline" onClick={generate}>
          Generate PowerShell
        </Button>
        <Button onClick={handleSubmit} disabled={loading}>
          {loading ? "Creating..." : "Create Policy"}
        </Button>
      </div>

      {/* Generated Command */}
      {generatedCmd && (
        <Card className="p-4">
          <div className="flex items-center justify-between mb-2">
            <Badge variant="secondary">Generated Command</Badge>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                navigator.clipboard.writeText(generatedCmd);
                toast.success("Copied to clipboard.");
              }}
            >
              Copy
            </Button>
          </div>
          <pre className="font-mono text-xs text-muted-foreground whitespace-pre-wrap break-all">
            {generatedCmd}
          </pre>
        </Card>
      )}
    </div>
  );
}
