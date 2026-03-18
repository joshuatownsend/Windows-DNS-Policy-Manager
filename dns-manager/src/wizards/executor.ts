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

/**
 * Builds an ordered list of typed execution steps for a wizard scenario.
 * Each step calls an existing api.*() method — no raw command execution.
 */
export function buildExecutionSteps(
  scenarioId: string,
  data: Record<string, any>,
  sp: ServerParams
): ExecutionStep[] {
  switch (scenarioId) {
    case "geolocation":
      return buildGeolocation(data, sp);
    case "splitbrain":
      return buildSplitBrain(data, sp);
    case "blocklist":
      return buildBlocklist(data, sp);
    case "timeofday":
      return buildTimeOfDay(data, sp);
    case "loadbalancing":
      return buildLoadBalancing(data, sp);
    case "geolb":
      return buildGeoLB(data, sp);
    case "primarysecondary":
      return buildPrimarySecondary(data, sp);
    case "queryfilter":
      return buildQueryFilter(data, sp);
    default:
      return [];
  }
}

// ── Geo-Location ─────────────────────────────────────────

function buildGeolocation(data: any, sp: ServerParams): ExecutionStep[] {
  const steps: ExecutionStep[] = [];
  const zone = data.zone;

  // Fallback record
  if (data.fallbackIP && data.recordName) {
    steps.push({
      label: `Add fallback record: ${data.recordName} → ${data.fallbackIP}`,
      execute: () =>
        api.addZoneRecord(zone, {
          hostName: data.recordName,
          recordType: data.recordType || "A",
          recordData: data.recordType === "AAAA"
            ? { IPv6Address: data.fallbackIP }
            : { IPv4Address: data.fallbackIP },
          ...sp,
        }),
    });
  }

  for (const [idx, r] of (data.regions || []).entries()) {
    if (!r.name || !r.subnet) continue;

    steps.push({
      label: `Create client subnet: ${r.name}Subnet`,
      execute: () =>
        api.createSubnet({
          name: `${r.name}Subnet`,
          ipv4Subnets: r.subnet,
          ...sp,
        }),
    });

    steps.push({
      label: `Create zone scope: ${r.name}Scope`,
      execute: () =>
        api.createZoneScope({
          name: `${r.name}Scope`,
          zoneName: zone,
          ...sp,
        }),
    });

    if (r.ip && data.recordName) {
      steps.push({
        label: `Add record in ${r.name}Scope: ${data.recordName} → ${r.ip}`,
        execute: () =>
          api.addZoneScopeRecord({
            zoneName: zone,
            zoneScope: `${r.name}Scope`,
            name: data.recordName,
            type: data.recordType || "A",
            data: r.ip,
            ...sp,
          }),
      });
    }

    steps.push({
      label: `Create policy: ${r.name}Policy`,
      execute: () =>
        api.addPolicy({
          Name: `${r.name}Policy`,
          Action: "ALLOW",
          ClientSubnet: `EQ,${r.name}Subnet`,
          ZoneScope: `${r.name}Scope,1`,
          ZoneName: zone,
          ProcessingOrder: idx + 1,
          ...sp,
        }),
    });
  }

  return steps;
}

// ── Split-Brain ──────────────────────────────────────────

function buildSplitBrain(data: any, sp: ServerParams): ExecutionStep[] {
  const steps: ExecutionStep[] = [];
  const zone = data.zone;
  const useInterface = data.splitMethod === "interface";
  const order = parseInt(data.splitOrder) || 1;

  // AD zone creation
  if (data.splitAD) {
    steps.push({
      label: `Create AD-integrated primary zone: ${zone}`,
      execute: () =>
        api.createZone({
          zoneName: zone,
          zoneType: "Primary",
          replicationScope: "Domain",
          ...sp,
        }),
    });
  }

  // Client subnet (subnet method only)
  if (!useInterface) {
    steps.push({
      label: `Create client subnet: ${data.subnetName || "InternalSubnet"}`,
      execute: () =>
        api.createSubnet({
          name: data.subnetName || "InternalSubnet",
          ipv4Subnets: data.internalSubnets,
          ...sp,
        }),
    });
  }

  // Internal zone scope
  const scopeName = data.internalScopeName || "internal";
  steps.push({
    label: `Create zone scope: ${scopeName}`,
    execute: () =>
      api.createZoneScope({ name: scopeName, zoneName: zone, ...sp }),
  });

  // Record in internal scope
  if (data.splitRecordName && data.internalIP) {
    steps.push({
      label: `Add record in ${scopeName}: ${data.splitRecordName} → ${data.internalIP}`,
      execute: () =>
        api.addZoneScopeRecord({
          zoneName: zone,
          zoneScope: scopeName,
          name: data.splitRecordName,
          type: "A",
          data: data.internalIP,
          ...sp,
        }),
    });
  }

  // Disable default recursion
  steps.push({
    label: "Disable recursion on default scope",
    execute: () =>
      api.setRecursionScope(".", { enableRecursion: false, ...sp }),
  });

  // Create internal recursion scope
  const recScope = data.internalRecursionScope || "InternalRecursionScope";
  steps.push({
    label: `Create recursion scope: ${recScope}`,
    execute: () =>
      api.createRecursionScope({
        name: recScope,
        enableRecursion: true,
        ...sp,
      }),
  });

  // Criteria string
  const criteria = useInterface
    ? { ServerInterfaceIP: `EQ,${data.internalInterface || "10.0.0.1"}` }
    : { ClientSubnet: `EQ,${data.subnetName || "InternalSubnet"}` };

  // Recursion policy
  steps.push({
    label: "Create recursion policy: SplitBrainRecursionPolicy",
    execute: () =>
      api.addPolicy({
        Name: "SplitBrainRecursionPolicy",
        Action: "ALLOW",
        ApplyOnRecursion: true,
        RecursionScope: recScope,
        ProcessingOrder: order,
        ...criteria,
        ...sp,
      }),
  });

  // Zone policy
  steps.push({
    label: "Create zone policy: SplitBrainZonePolicy",
    execute: () =>
      api.addPolicy({
        Name: "SplitBrainZonePolicy",
        Action: "ALLOW",
        ZoneScope: `${scopeName},1`,
        ZoneName: zone,
        ProcessingOrder: order + 1,
        ...criteria,
        ...sp,
      }),
  });

  return steps;
}

// ── Blocklist ────────────────────────────────────────────

function buildBlocklist(data: any, sp: ServerParams): ExecutionStep[] {
  const steps: ExecutionStep[] = [];
  const action = data.blocklistAction || "IGNORE";
  const prefix = data.blocklistPolicyName || "Blocklist";

  let domains = (data.blocklistDomains || "")
    .split(/[\n,]+/)
    .map((d: string) => d.trim())
    .filter(Boolean);

  if (data.blocklistWildcard) {
    domains = domains.map((d: string) => (d.startsWith("*.") ? d : "*." + d));
  }

  const groupSize = 100;
  for (let i = 0; i < domains.length; i += groupSize) {
    const batch = domains.slice(i, i + groupSize);
    const n = Math.floor(i / groupSize) + 1;
    const pName = domains.length > groupSize ? `${prefix}_Part${n}` : prefix;

    steps.push({
      label: `Create blocklist policy: ${pName} (${batch.length} domains)`,
      execute: () =>
        api.addPolicy({
          Name: pName,
          Action: action,
          FQDN: `EQ,${batch.join(",")}`,
          ProcessingOrder: n,
          ...sp,
        }),
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

  // Client subnets
  if (hasSub) {
    for (const dc of dcs) {
      if (dc.name && dc.subnet) {
        steps.push({
          label: `Create client subnet: ${dc.name}Subnet`,
          execute: () =>
            api.createSubnet({ name: `${dc.name}Subnet`, ipv4Subnets: dc.subnet, ...sp }),
        });
      }
    }
  }

  // Zone scopes + records
  for (const dc of dcs) {
    if (!dc.name || !dc.ip) continue;
    steps.push({
      label: `Create zone scope: ${dc.name}ZoneScope`,
      execute: () =>
        api.createZoneScope({ name: `${dc.name}ZoneScope`, zoneName: zone, ...sp }),
    });
    steps.push({
      label: `Add record in ${dc.name}ZoneScope: ${recName} → ${dc.ip}`,
      execute: () =>
        api.addZoneScopeRecord({
          zoneName: zone, zoneScope: `${dc.name}ZoneScope`,
          name: recName, type: "A", data: dc.ip,
          ...(data.todTtl ? { ttl: data.todTtl } : {}),
          ...sp,
        }),
    });
  }

  // Peak-hour policies
  if (data.todPeakHours) {
    if (hasSub) {
      for (const dc of dcs) {
        if (!dc.name || !dc.subnet) continue;
        const scopeStr = dcs.filter((d: any) => d.name).map((d: any) => `${d.name}ZoneScope,${weights[d.name] || 1}`).join(";");
        steps.push({
          label: `Create peak policy: ${dc.name}PeakPolicy`,
          execute: () =>
            api.addPolicy({
              Name: `${dc.name}PeakPolicy`, Action: "ALLOW",
              ClientSubnet: `EQ,${dc.name}Subnet`,
              TimeOfDay: `EQ,${data.todPeakHours}`,
              ZoneScope: scopeStr, ZoneName: zone,
              ProcessingOrder: po++, ...sp,
            }),
        });
      }
    } else {
      const scopeStr = dcs.filter((d: any) => d.name).map((d: any) => `${d.name}ZoneScope,${weights[d.name] || 1}`).join(";");
      steps.push({
        label: "Create peak hours policy",
        execute: () =>
          api.addPolicy({
            Name: "PeakHoursPolicy", Action: "ALLOW",
            TimeOfDay: `EQ,${data.todPeakHours}`,
            ZoneScope: scopeStr, ZoneName: zone,
            ProcessingOrder: po++, ...sp,
          }),
      });
    }
  }

  // Normal-hour per-region
  if (hasSub) {
    for (const dc of dcs) {
      if (!dc.name || !dc.subnet) continue;
      steps.push({
        label: `Create normal policy: ${dc.name}NormalPolicy`,
        execute: () =>
          api.addPolicy({
            Name: `${dc.name}NormalPolicy`, Action: "ALLOW",
            ClientSubnet: `EQ,${dc.name}Subnet`,
            ZoneScope: `${dc.name}ZoneScope,1`, ZoneName: zone,
            ProcessingOrder: po++, ...sp,
          }),
      });
    }
  }

  // Catch-all
  const catchAll = dcs.filter((d: any) => d.name).map((d: any) => `${d.name}ZoneScope,1`).join(";");
  steps.push({
    label: "Create worldwide catch-all policy",
    execute: () =>
      api.addPolicy({
        Name: "WorldwideCatchAllPolicy", Action: "ALLOW",
        ZoneScope: catchAll, ZoneName: zone,
        ProcessingOrder: po, ...sp,
      }),
  });

  return steps;
}

// ── Load Balancing ───────────────────────────────────────

function buildLoadBalancing(data: any, sp: ServerParams): ExecutionStep[] {
  const steps: ExecutionStep[] = [];
  const zone = data.zone;
  const backends: any[] = data.backends || [];
  const lbParts: string[] = [];

  for (const b of backends) {
    if (!b.name || !b.ip) continue;
    steps.push({
      label: `Create zone scope: ${b.name}Scope`,
      execute: () =>
        api.createZoneScope({ name: `${b.name}Scope`, zoneName: zone, ...sp }),
    });
    steps.push({
      label: `Add record in ${b.name}Scope: ${data.lbRecordName || "@"} → ${b.ip}`,
      execute: () =>
        api.addZoneScopeRecord({
          zoneName: zone, zoneScope: `${b.name}Scope`,
          name: data.lbRecordName || "@", type: "A", data: b.ip,
          ...(data.lbTtl ? { ttl: data.lbTtl } : {}),
          ...sp,
        }),
    });
    lbParts.push(`${b.name}Scope,${b.weight || 1}`);
  }

  if (lbParts.length > 0) {
    steps.push({
      label: "Create load balance policy",
      execute: () =>
        api.addPolicy({
          Name: "LoadBalancePolicy", Action: "ALLOW",
          ZoneScope: lbParts.join(";"), ZoneName: zone,
          ...sp,
        }),
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
  const regionWeights: Record<string, Record<string, number>> = data.geolbRegionWeights || {};
  const recName = data.geolbRecordName || "www";
  let order = 1;

  // Subnets
  for (const r of regions) {
    if (r.name && r.subnet) {
      steps.push({
        label: `Create client subnet: ${r.name}Subnet`,
        execute: () =>
          api.createSubnet({ name: `${r.name}Subnet`, ipv4Subnets: r.subnet, ...sp }),
      });
    }
  }

  // Zone scopes + records
  for (const dc of dcs) {
    if (!dc.name || !dc.ip) continue;
    steps.push({
      label: `Create zone scope: ${dc.name}ZoneScope`,
      execute: () =>
        api.createZoneScope({ name: `${dc.name}ZoneScope`, zoneName: zone, ...sp }),
    });
    steps.push({
      label: `Add record in ${dc.name}ZoneScope: ${recName} → ${dc.ip}`,
      execute: () =>
        api.addZoneScopeRecord({
          zoneName: zone, zoneScope: `${dc.name}ZoneScope`,
          name: recName, type: "A", data: dc.ip, ...sp,
        }),
    });
  }

  // Per-region weighted policies
  for (const r of regions) {
    if (!r.name || !r.subnet) continue;
    const rw = regionWeights[r.name] || {};
    const scopeStr = dcs.filter((d: any) => d.name).map((d: any) => `${d.name}ZoneScope,${rw[d.name] || 1}`).join(";");
    steps.push({
      label: `Create policy: ${r.name}Policy`,
      execute: () =>
        api.addPolicy({
          Name: `${r.name}Policy`, Action: "ALLOW",
          ClientSubnet: `EQ,${r.name}Subnet`,
          ZoneScope: scopeStr, ZoneName: zone,
          ProcessingOrder: order++, ...sp,
        }),
    });
  }

  // Worldwide catch-all
  if (data.geolbWorldwide !== false) {
    const catchAll = dcs.filter((d: any) => d.name).map((d: any) => `${d.name}ZoneScope,1`).join(";");
    steps.push({
      label: "Create worldwide catch-all policy",
      execute: () =>
        api.addPolicy({
          Name: "WorldwidePolicy", Action: "ALLOW",
          ZoneScope: catchAll, ZoneName: zone,
          ProcessingOrder: order, ...sp,
        }),
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

  // Primary: zone transfer config
  if (secIPs.length > 0) {
    steps.push({
      label: "Configure zone transfer and notification",
      execute: () =>
        api.setZoneSettings(zone, {
          notify: "Notify",
          notifyServers: secIPs,
          secondaryServers: secIPs,
          ...sp,
        }),
    });
  }

  // Primary: geo setup
  for (const [idx, r] of regions.entries()) {
    if (!r.name || !r.subnet) continue;
    steps.push({
      label: `[Primary] Create subnet: ${r.name}Subnet`,
      execute: () => api.createSubnet({ name: `${r.name}Subnet`, ipv4Subnets: r.subnet, ...sp }),
    });
    steps.push({
      label: `[Primary] Create scope: ${r.name}Scope`,
      execute: () => api.createZoneScope({ name: `${r.name}Scope`, zoneName: zone, ...sp }),
    });
    if (r.ip) {
      steps.push({
        label: `[Primary] Add record in ${r.name}Scope`,
        execute: () =>
          api.addZoneScopeRecord({
            zoneName: zone, zoneScope: `${r.name}Scope`,
            name: recName, type: "A", data: r.ip, ...sp,
          }),
      });
    }
    steps.push({
      label: `[Primary] Create policy: ${r.name}Policy`,
      execute: () =>
        api.addPolicy({
          Name: `${r.name}Policy`, Action: "ALLOW",
          ClientSubnet: `EQ,${r.name}Subnet`,
          ZoneScope: `${r.name}Scope,1`, ZoneName: zone,
          ProcessingOrder: idx + 1, ...sp,
        }),
    });
  }

  // Secondary servers
  for (const sec of secondaries) {
    if (!sec.name) continue;
    // Target secondary server directly via ComputerName
    const secSp = { server: sec.name };

    steps.push({
      label: `[${sec.name}] Create secondary zone`,
      execute: () =>
        api.createZone({
          zoneName: zone, zoneType: "Secondary",
          masterServers: [sp.server || "localhost"],
          ...secSp,
        }),
    });

    for (const r of regions) {
      if (r.name && r.subnet) {
        steps.push({
          label: `[${sec.name}] Copy subnet: ${r.name}Subnet`,
          execute: () => api.createSubnet({ name: `${r.name}Subnet`, ipv4Subnets: r.subnet, ...secSp }),
        });
      }
    }

    for (const r of regions) {
      if (r.name) {
        steps.push({
          label: `[${sec.name}] Copy scope: ${r.name}Scope`,
          execute: () => api.createZoneScope({ name: `${r.name}Scope`, zoneName: zone, ...secSp }),
        });
      }
    }

    for (const r of regions) {
      if (r.name && r.ip) {
        steps.push({
          label: `[${sec.name}] Copy record in ${r.name}Scope`,
          execute: () =>
            api.addZoneScopeRecord({
              zoneName: zone, zoneScope: `${r.name}Scope`,
              name: recName, type: "A", data: r.ip, ...secSp,
            }),
        });
      }
    }

    for (const [idx, r] of regions.entries()) {
      if (r.name && r.subnet) {
        steps.push({
          label: `[${sec.name}] Copy policy: ${r.name}Policy`,
          execute: () =>
            api.addPolicy({
              Name: `${r.name}Policy`, Action: "ALLOW",
              ClientSubnet: `EQ,${r.name}Subnet`,
              ZoneScope: `${r.name}Scope,1`, ZoneName: zone,
              ProcessingOrder: idx + 1, ...secSp,
            }),
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

  const policyData: Record<string, unknown> = {
    Name: fName,
    Action: fa,
    ProcessingOrder: 1,
    ...sp,
  };

  if (fCrit.includes("FQDN") && data.filterFqdns) {
    const fqdns = data.filterFqdns.split(/[\n,]+/).map((d: string) => d.trim()).filter(Boolean);
    if (fqdns.length) policyData.FQDN = `${op},${fqdns.join(",")}`;
  }
  if (fCrit.includes("ClientSubnet") && data.filterSubnets) {
    const subs = data.filterSubnets.split(",").map((s: string) => s.trim()).filter(Boolean);
    if (subs.length) policyData.ClientSubnet = `${op},${subs.join(",")}`;
  }
  if (fCrit.includes("QType") && data.filterQTypes) {
    const qts = data.filterQTypes.split(",").map((q: string) => q.trim()).filter(Boolean);
    if (qts.length) policyData.QType = `${op},${qts.join(",")}`;
  }
  if (fCrit.includes("ServerInterfaceIP") && data.filterServerIPs) {
    const sips = data.filterServerIPs.split(",").map((s: string) => s.trim()).filter(Boolean);
    if (sips.length) policyData.ServerInterfaceIP = `${op},${sips.join(",")}`;
  }

  const criteriaCount = ["FQDN", "ClientSubnet", "QType", "ServerInterfaceIP"].filter((k) => policyData[k]).length;
  if (criteriaCount > 1) policyData.Condition = cond;

  return [
    {
      label: `Create query filter policy: ${fName}`,
      execute: () => api.addPolicy(policyData),
    },
  ];
}
