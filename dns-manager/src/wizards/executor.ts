/* eslint-disable @typescript-eslint/no-explicit-any */
import { api } from "@/lib/api";
import type { ApiResponse } from "@/lib/types";

export interface ExecutionStep {
  label: string;
  execute: () => Promise<ApiResponse & Record<string, unknown>>;
}

interface ServerParams {
  server?: string;
  serverId?: string;
  credentialMode?: string;
}

// ── Helpers for bridge-compatible payloads ────────────────

/** Build a policy body matching the bridge's /api/policies schema */
function pol(opts: {
  name: string;
  action: string;
  processingOrder?: number;
  zoneName?: string;
  criteria?: { type: string; operator: string; values: string[] }[];
  scopes?: { name: string; weight: number }[];
  condition?: string;
  applyOnRecursion?: boolean;
  recursionScope?: string;
}, sp: ServerParams): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name: opts.name,
    action: opts.action,
  };
  if (opts.processingOrder != null) body.processingOrder = opts.processingOrder;
  if (opts.zoneName) body.zoneName = opts.zoneName;
  if (opts.criteria?.length) body.criteria = opts.criteria;
  if (opts.scopes?.length) body.scopes = opts.scopes;
  if (opts.condition) body.condition = opts.condition;
  if (opts.applyOnRecursion) body.applyOnRecursion = true;
  if (opts.recursionScope) body.recursionScope = opts.recursionScope;
  if (sp.server) body.server = sp.server;
  if (sp.serverId) body.serverId = sp.serverId;
  if (sp.credentialMode) body.credentialMode = sp.credentialMode;
  return body;
}

/** Build a single criterion entry */
function crit(type: string, operator: string, ...values: string[]) {
  return { type, operator, values };
}

/** Build zone scope record body matching bridge's Handle-AddZoneScopeRecord */
function scopeRec(zoneName: string, scopeName: string, recordName: string, recordType: string, recordValue: string, sp: ServerParams, ttl?: string) {
  return { zoneName, scopeName, recordName, recordType, recordValue, ...sp, ...(ttl ? { ttl } : {}) };
}

/** Build subnet body matching bridge's Handle-CreateSubnet */
function subnet(name: string, ipv4Subnet: string, sp: ServerParams) {
  return { name, ipv4Subnet, ...sp };
}

// ── Dispatcher ───────────────────────────────────────────

export function buildExecutionSteps(
  scenarioId: string,
  data: Record<string, any>,
  sp: ServerParams
): ExecutionStep[] {
  switch (scenarioId) {
    case "geolocation": return buildGeolocation(data, sp);
    case "splitbrain": return buildSplitBrain(data, sp);
    case "blocklist": return buildBlocklist(data, sp);
    case "timeofday": return buildTimeOfDay(data, sp);
    case "loadbalancing": return buildLoadBalancing(data, sp);
    case "geolb": return buildGeoLB(data, sp);
    case "primarysecondary": return buildPrimarySecondary(data, sp);
    case "queryfilter": return buildQueryFilter(data, sp);
    default: return [];
  }
}

// ── Geo-Location ─────────────────────────────────────────

function buildGeolocation(data: any, sp: ServerParams): ExecutionStep[] {
  const steps: ExecutionStep[] = [];
  const zone = data.zone;

  if (data.fallbackIP && data.recordName) {
    steps.push({
      label: `Add fallback record: ${data.recordName} → ${data.fallbackIP}`,
      execute: () => api.addZoneRecord(zone, {
        hostName: data.recordName,
        recordType: data.recordType || "A",
        recordData: data.recordType === "AAAA" ? { IPv6Address: data.fallbackIP } : { IPv4Address: data.fallbackIP },
        ...sp,
      }),
    });
  }

  for (const [idx, r] of (data.regions || []).entries()) {
    if (!r.name || !r.subnet) continue;
    steps.push({ label: `Create subnet: ${r.name}Subnet`, execute: () => api.createSubnet(subnet(`${r.name}Subnet`, r.subnet, sp)) });
    steps.push({ label: `Create scope: ${r.name}Scope`, execute: () => api.createZoneScope({ name: `${r.name}Scope`, zoneName: zone, ...sp }) });
    if (r.ip && data.recordName) {
      steps.push({ label: `Add record in ${r.name}Scope`, execute: () => api.addZoneScopeRecord(scopeRec(zone, `${r.name}Scope`, data.recordName, data.recordType || "A", r.ip, sp)) });
    }
    steps.push({
      label: `Create policy: ${r.name}Policy`,
      execute: () => api.addPolicy(pol({
        name: `${r.name}Policy`, action: "ALLOW",
        criteria: [crit("ClientSubnet", "EQ", `${r.name}Subnet`)],
        scopes: [{ name: `${r.name}Scope`, weight: 1 }],
        zoneName: zone, processingOrder: idx + 1,
      }, sp)),
    });
  }
  return steps;
}

// ── Split-Brain ──────────────────────────────────────────

function buildSplitBrain(data: any, sp: ServerParams): ExecutionStep[] {
  const steps: ExecutionStep[] = [];
  const zone = data.zone;
  const useIf = data.splitMethod === "interface";
  const order = parseInt(data.splitOrder) || 1;

  if (data.splitAD) {
    steps.push({ label: `Create AD zone: ${zone}`, execute: () => api.createZone({ zoneName: zone, zoneType: "Primary", replicationScope: "Domain", ...sp }) });
  }
  if (!useIf) {
    steps.push({ label: `Create subnet: ${data.subnetName || "InternalSubnet"}`, execute: () => api.createSubnet(subnet(data.subnetName || "InternalSubnet", data.internalSubnets, sp)) });
  }

  const sn = data.internalScopeName || "internal";
  steps.push({ label: `Create scope: ${sn}`, execute: () => api.createZoneScope({ name: sn, zoneName: zone, ...sp }) });
  if (data.splitRecordName && data.internalIP) {
    steps.push({ label: `Add record in ${sn}`, execute: () => api.addZoneScopeRecord(scopeRec(zone, sn, data.splitRecordName, "A", data.internalIP, sp)) });
  }
  steps.push({ label: "Disable default recursion", execute: () => api.setRecursionScope(".", { enableRecursion: false, ...sp }) });

  const rs = data.internalRecursionScope || "InternalRecursionScope";
  steps.push({ label: `Create recursion scope: ${rs}`, execute: () => api.createRecursionScope({ name: rs, enableRecursion: true, ...sp }) });

  const critType = useIf ? "ServerInterfaceIP" : "ClientSubnet";
  const critVal = useIf ? (data.internalInterface || "10.0.0.1") : (data.subnetName || "InternalSubnet");

  steps.push({
    label: "Create recursion policy",
    execute: () => api.addPolicy(pol({
      name: "SplitBrainRecursionPolicy", action: "ALLOW",
      applyOnRecursion: true, recursionScope: rs,
      criteria: [crit(critType, "EQ", critVal)],
      processingOrder: order,
    }, sp)),
  });
  steps.push({
    label: "Create zone policy",
    execute: () => api.addPolicy(pol({
      name: "SplitBrainZonePolicy", action: "ALLOW",
      criteria: [crit(critType, "EQ", critVal)],
      scopes: [{ name: sn, weight: 1 }],
      zoneName: zone, processingOrder: order + 1,
    }, sp)),
  });
  return steps;
}

// ── Blocklist ────────────────────────────────────────────

function buildBlocklist(data: any, sp: ServerParams): ExecutionStep[] {
  const steps: ExecutionStep[] = [];
  const action = data.blocklistAction || "IGNORE";
  const prefix = data.blocklistPolicyName || "Blocklist";
  let domains = (data.blocklistDomains || "").split(/[\n,]+/).map((d: string) => d.trim()).filter(Boolean);
  if (data.blocklistWildcard) domains = domains.map((d: string) => d.startsWith("*.") ? d : "*." + d);

  const gs = 100;
  for (let i = 0; i < domains.length; i += gs) {
    const batch = domains.slice(i, i + gs);
    const n = Math.floor(i / gs) + 1;
    const pName = domains.length > gs ? `${prefix}_Part${n}` : prefix;
    steps.push({
      label: `Create blocklist policy: ${pName} (${batch.length} domains)`,
      execute: () => api.addPolicy(pol({
        name: pName, action,
        criteria: [crit("FQDN", "EQ", ...batch)],
        processingOrder: n,
      }, sp)),
    });
  }
  return steps;
}

// ── Time-of-Day ──────────────────────────────────────────

function buildTimeOfDay(data: any, sp: ServerParams): ExecutionStep[] {
  const steps: ExecutionStep[] = [];
  const zone = data.zone;
  const dcs: any[] = data.todDatacenters || [];
  const weights: Record<string, number> = data.todWeights || {};
  const recName = data.todRecordName || "@";
  const hasSub = dcs.some((dc: any) => dc.subnet);
  let po = 1;

  if (hasSub) {
    for (const dc of dcs) {
      if (dc.name && dc.subnet) steps.push({ label: `Create subnet: ${dc.name}Subnet`, execute: () => api.createSubnet(subnet(`${dc.name}Subnet`, dc.subnet, sp)) });
    }
  }
  for (const dc of dcs) {
    if (!dc.name || !dc.ip) continue;
    steps.push({ label: `Create scope: ${dc.name}ZoneScope`, execute: () => api.createZoneScope({ name: `${dc.name}ZoneScope`, zoneName: zone, ...sp }) });
    steps.push({ label: `Add record in ${dc.name}ZoneScope`, execute: () => api.addZoneScopeRecord(scopeRec(zone, `${dc.name}ZoneScope`, recName, "A", dc.ip, sp, data.todTtl)) });
  }

  const allScopes = dcs.filter((d: any) => d.name).map((d: any) => ({ name: `${d.name}ZoneScope`, weight: weights[d.name] || 1 }));

  if (data.todPeakHours) {
    if (hasSub) {
      for (const dc of dcs) {
        if (!dc.name || !dc.subnet) continue;
        steps.push({
          label: `Create peak policy: ${dc.name}PeakPolicy`,
          execute: () => api.addPolicy(pol({
            name: `${dc.name}PeakPolicy`, action: "ALLOW",
            criteria: [crit("ClientSubnet", "EQ", `${dc.name}Subnet`), crit("TimeOfDay", "EQ", data.todPeakHours)],
            scopes: allScopes, zoneName: zone, processingOrder: po++, condition: "AND",
          }, sp)),
        });
      }
    } else {
      steps.push({
        label: "Create peak hours policy",
        execute: () => api.addPolicy(pol({
          name: "PeakHoursPolicy", action: "ALLOW",
          criteria: [crit("TimeOfDay", "EQ", data.todPeakHours)],
          scopes: allScopes, zoneName: zone, processingOrder: po++,
        }, sp)),
      });
    }
  }
  if (hasSub) {
    for (const dc of dcs) {
      if (!dc.name || !dc.subnet) continue;
      steps.push({
        label: `Create normal policy: ${dc.name}NormalPolicy`,
        execute: () => api.addPolicy(pol({
          name: `${dc.name}NormalPolicy`, action: "ALLOW",
          criteria: [crit("ClientSubnet", "EQ", `${dc.name}Subnet`)],
          scopes: [{ name: `${dc.name}ZoneScope`, weight: 1 }],
          zoneName: zone, processingOrder: po++,
        }, sp)),
      });
    }
  }
  const equalScopes = dcs.filter((d: any) => d.name).map((d: any) => ({ name: `${d.name}ZoneScope`, weight: 1 }));
  steps.push({
    label: "Create worldwide catch-all policy",
    execute: () => api.addPolicy(pol({ name: "WorldwideCatchAllPolicy", action: "ALLOW", scopes: equalScopes, zoneName: zone, processingOrder: po }, sp)),
  });
  return steps;
}

// ── Load Balancing ───────────────────────────────────────

function buildLoadBalancing(data: any, sp: ServerParams): ExecutionStep[] {
  const steps: ExecutionStep[] = [];
  const zone = data.zone;
  const backends: any[] = data.backends || [];
  const lbScopes: { name: string; weight: number }[] = [];

  for (const b of backends) {
    if (!b.name || !b.ip) continue;
    steps.push({ label: `Create scope: ${b.name}Scope`, execute: () => api.createZoneScope({ name: `${b.name}Scope`, zoneName: zone, ...sp }) });
    steps.push({ label: `Add record in ${b.name}Scope`, execute: () => api.addZoneScopeRecord(scopeRec(zone, `${b.name}Scope`, data.lbRecordName || "@", "A", b.ip, sp, data.lbTtl)) });
    lbScopes.push({ name: `${b.name}Scope`, weight: b.weight || 1 });
  }
  if (lbScopes.length > 0) {
    steps.push({
      label: "Create load balance policy",
      execute: () => api.addPolicy(pol({ name: "LoadBalancePolicy", action: "ALLOW", scopes: lbScopes, zoneName: zone }, sp)),
    });
  }
  return steps;
}

// ── Geo + Load Balancing ─────────────────────────────────

function buildGeoLB(data: any, sp: ServerParams): ExecutionStep[] {
  const steps: ExecutionStep[] = [];
  const zone = data.zone;
  const regions: any[] = data.geolbRegions || [];
  const dcs: any[] = data.geolbDatacenters || [];
  const rw: Record<string, Record<string, number>> = data.geolbRegionWeights || {};
  const recName = data.geolbRecordName || "www";
  let order = 1;

  for (const r of regions) {
    if (r.name && r.subnet) steps.push({ label: `Create subnet: ${r.name}Subnet`, execute: () => api.createSubnet(subnet(`${r.name}Subnet`, r.subnet, sp)) });
  }
  for (const dc of dcs) {
    if (!dc.name || !dc.ip) continue;
    steps.push({ label: `Create scope: ${dc.name}ZoneScope`, execute: () => api.createZoneScope({ name: `${dc.name}ZoneScope`, zoneName: zone, ...sp }) });
    steps.push({ label: `Add record in ${dc.name}ZoneScope`, execute: () => api.addZoneScopeRecord(scopeRec(zone, `${dc.name}ZoneScope`, recName, "A", dc.ip, sp)) });
  }
  for (const r of regions) {
    if (!r.name || !r.subnet) continue;
    const regionWeights = rw[r.name] || {};
    const sc = dcs.filter((d: any) => d.name).map((d: any) => ({ name: `${d.name}ZoneScope`, weight: regionWeights[d.name] || 1 }));
    steps.push({
      label: `Create policy: ${r.name}Policy`,
      execute: () => api.addPolicy(pol({
        name: `${r.name}Policy`, action: "ALLOW",
        criteria: [crit("ClientSubnet", "EQ", `${r.name}Subnet`)],
        scopes: sc, zoneName: zone, processingOrder: order++,
      }, sp)),
    });
  }
  if (data.geolbWorldwide !== false) {
    const eq = dcs.filter((d: any) => d.name).map((d: any) => ({ name: `${d.name}ZoneScope`, weight: 1 }));
    steps.push({
      label: "Create worldwide catch-all policy",
      execute: () => api.addPolicy(pol({ name: "WorldwidePolicy", action: "ALLOW", scopes: eq, zoneName: zone, processingOrder: order }, sp)),
    });
  }
  return steps;
}

// ── Primary-Secondary ────────────────────────────────────

function buildPrimarySecondary(data: any, sp: ServerParams): ExecutionStep[] {
  const steps: ExecutionStep[] = [];
  const zone = data.zone;
  const regions: any[] = data.psRegions || [];
  const secondaries: any[] = data.psSecondaries || [];
  const recName = data.psRecordName || "www";
  const secIPs = secondaries.filter((s: any) => s.ip).map((s: any) => s.ip);

  if (secIPs.length > 0) {
    steps.push({ label: "Configure zone transfer", execute: () => api.setZoneSettings(zone, { notify: "Notify", notifyServers: secIPs, secondaryServers: secIPs, ...sp }) });
  }

  for (const [idx, r] of regions.entries()) {
    if (!r.name || !r.subnet) continue;
    steps.push({ label: `[Primary] Create subnet: ${r.name}Subnet`, execute: () => api.createSubnet(subnet(`${r.name}Subnet`, r.subnet, sp)) });
    steps.push({ label: `[Primary] Create scope: ${r.name}Scope`, execute: () => api.createZoneScope({ name: `${r.name}Scope`, zoneName: zone, ...sp }) });
    if (r.ip) steps.push({ label: `[Primary] Add record in ${r.name}Scope`, execute: () => api.addZoneScopeRecord(scopeRec(zone, `${r.name}Scope`, recName, "A", r.ip, sp)) });
    steps.push({
      label: `[Primary] Create policy: ${r.name}Policy`,
      execute: () => api.addPolicy(pol({
        name: `${r.name}Policy`, action: "ALLOW",
        criteria: [crit("ClientSubnet", "EQ", `${r.name}Subnet`)],
        scopes: [{ name: `${r.name}Scope`, weight: 1 }],
        zoneName: zone, processingOrder: idx + 1,
      }, sp)),
    });
  }

  for (const sec of secondaries) {
    if (!sec.name) continue;
    const secSp: ServerParams = { server: sec.name };
    steps.push({ label: `[${sec.name}] Create secondary zone`, execute: () => api.createZone({ zoneName: zone, zoneType: "Secondary", masterServers: [sp.server || "localhost"], ...secSp }) });
    for (const r of regions) {
      if (r.name && r.subnet) steps.push({ label: `[${sec.name}] Copy subnet: ${r.name}Subnet`, execute: () => api.createSubnet(subnet(`${r.name}Subnet`, r.subnet, secSp)) });
    }
    for (const r of regions) {
      if (r.name) steps.push({ label: `[${sec.name}] Copy scope: ${r.name}Scope`, execute: () => api.createZoneScope({ name: `${r.name}Scope`, zoneName: zone, ...secSp }) });
    }
    for (const r of regions) {
      if (r.name && r.ip) steps.push({ label: `[${sec.name}] Copy record`, execute: () => api.addZoneScopeRecord(scopeRec(zone, `${r.name}Scope`, recName, "A", r.ip, secSp)) });
    }
    for (const [idx, r] of regions.entries()) {
      if (r.name && r.subnet) {
        steps.push({
          label: `[${sec.name}] Copy policy: ${r.name}Policy`,
          execute: () => api.addPolicy(pol({
            name: `${r.name}Policy`, action: "ALLOW",
            criteria: [crit("ClientSubnet", "EQ", `${r.name}Subnet`)],
            scopes: [{ name: `${r.name}Scope`, weight: 1 }],
            zoneName: zone, processingOrder: idx + 1,
          }, secSp)),
        });
      }
    }
  }
  return steps;
}

// ── Query Filter ─────────────────────────────────────────

function buildQueryFilter(data: any, sp: ServerParams): ExecutionStep[] {
  const fm = data.filterMode || "blocklist";
  const fa = fm === "blocklist" ? (data.filterAction || "IGNORE") : "IGNORE";
  const op = fm === "blocklist" ? "EQ" : "NE";
  const fName = data.filterPolicyName || "QueryFilter";
  const fCrit: string[] = data.filterCriteria || ["FQDN"];
  const cond = data.filterCondition || "AND";

  const criteria: { type: string; operator: string; values: string[] }[] = [];

  if (fCrit.includes("FQDN") && data.filterFqdns) {
    const vals = data.filterFqdns.split(/[\n,]+/).map((d: string) => d.trim()).filter(Boolean);
    if (vals.length) criteria.push(crit("FQDN", op, ...vals));
  }
  if (fCrit.includes("ClientSubnet") && data.filterSubnets) {
    const vals = data.filterSubnets.split(",").map((s: string) => s.trim()).filter(Boolean);
    if (vals.length) criteria.push(crit("ClientSubnet", op, ...vals));
  }
  if (fCrit.includes("QType") && data.filterQTypes) {
    const vals = data.filterQTypes.split(",").map((q: string) => q.trim()).filter(Boolean);
    if (vals.length) criteria.push(crit("QType", op, ...vals));
  }
  if (fCrit.includes("ServerInterfaceIP") && data.filterServerIPs) {
    const vals = data.filterServerIPs.split(",").map((s: string) => s.trim()).filter(Boolean);
    if (vals.length) criteria.push(crit("ServerInterfaceIP", op, ...vals));
  }

  return [{
    label: `Create query filter policy: ${fName}`,
    execute: () => api.addPolicy(pol({
      name: fName, action: fa,
      criteria, processingOrder: 1,
      condition: criteria.length > 1 ? cond : undefined,
    }, sp)),
  }];
}
