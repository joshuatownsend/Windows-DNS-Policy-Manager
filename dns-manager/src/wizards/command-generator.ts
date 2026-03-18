/* eslint-disable @typescript-eslint/no-explicit-any */

export function generateCommands(
  scenarioId: string,
  data: Record<string, any>,
  serverHostname?: string
): string {
  const serverParam =
    serverHostname && serverHostname !== "localhost"
      ? ` -ComputerName "${serverHostname}"`
      : "";
  const cmds: string[] = [];

  switch (scenarioId) {
    case "geolocation": {
      cmds.push("# Geo-Location Routing Configuration");
      cmds.push(`# Zone: ${data.zone}`);
      cmds.push("");
      if (data.fallbackIP && data.recordName) {
        const recType = data.recordType === "AAAA" ? " -AAAA -IPv6Address" : " -A -IPv4Address";
        cmds.push("# Default zone scope record (fallback)");
        cmds.push(`Add-DnsServerResourceRecord -ZoneName "${data.zone}" -Name "${data.recordName}"${recType} "${data.fallbackIP}"${serverParam}`);
        cmds.push("");
      }
      (data.regions || []).forEach((r: any, idx: number) => {
        if (!r.name || !r.subnet) return;
        cmds.push(`# Region: ${r.name}`);
        cmds.push(`Add-DnsServerClientSubnet -Name "${r.name}Subnet" -IPv4Subnet "${r.subnet}"${serverParam}`);
        cmds.push(`Add-DnsServerZoneScope -ZoneName "${data.zone}" -Name "${r.name}Scope"${serverParam}`);
        if (r.ip && data.recordName) {
          const rt = data.recordType === "AAAA" ? " -AAAA -IPv6Address" : " -A -IPv4Address";
          cmds.push(`Add-DnsServerResourceRecord -ZoneName "${data.zone}" -ZoneScope "${r.name}Scope" -Name "${data.recordName}"${rt} "${r.ip}"${serverParam}`);
        }
        cmds.push(`Add-DnsServerQueryResolutionPolicy -Name "${r.name}Policy" -Action ALLOW -ClientSubnet "EQ,${r.name}Subnet" -ZoneScope "${r.name}Scope,1" -ZoneName "${data.zone}" -ProcessingOrder ${idx + 1}${serverParam}`);
        cmds.push("");
      });
      break;
    }

    case "splitbrain": {
      const useIf = data.splitMethod === "interface";
      cmds.push(`# Split-Brain DNS (${useIf ? "Server Interface" : "Client Subnet"} method)`);
      cmds.push(`# Zone: ${data.zone}`);
      if (data.splitAD) cmds.push("# Active Directory integrated");
      cmds.push("");
      if (data.splitAD) {
        cmds.push(`Add-DnsServerPrimaryZone -Name "${data.zone}" -ReplicationScope "Domain"${serverParam}`);
        cmds.push("");
      }
      let splitCrit: string;
      if (useIf) {
        splitCrit = `-ServerInterfaceIP "EQ,${data.internalInterface || "10.0.0.1"}"`;
      } else {
        splitCrit = `-ClientSubnet "EQ,${data.subnetName || "InternalSubnet"}"`;
        cmds.push(`Add-DnsServerClientSubnet -Name "${data.subnetName || "InternalSubnet"}" -IPv4Subnet "${data.internalSubnets}"${serverParam}`);
      }
      cmds.push("");
      cmds.push(`Add-DnsServerZoneScope -ZoneName "${data.zone}" -Name "${data.internalScopeName || "internal"}"${serverParam}`);
      if (data.splitRecordName && data.internalIP) {
        cmds.push(`Add-DnsServerResourceRecord -ZoneName "${data.zone}" -ZoneScope "${data.internalScopeName || "internal"}" -A -Name "${data.splitRecordName}" -IPv4Address "${data.internalIP}"${serverParam}`);
      }
      cmds.push("");
      cmds.push(`Set-DnsServerRecursionScope -Name "." -EnableRecursion $false${serverParam}`);
      cmds.push(`Add-DnsServerRecursionScope -Name "${data.internalRecursionScope || "InternalRecursionScope"}" -EnableRecursion $true${serverParam}`);
      cmds.push("");
      const order = parseInt(data.splitOrder) || 1;
      cmds.push(`Add-DnsServerQueryResolutionPolicy -Name "SplitBrainRecursionPolicy" -Action ALLOW -ApplyOnRecursion -RecursionScope "${data.internalRecursionScope || "InternalRecursionScope"}" ${splitCrit} -ProcessingOrder ${order}${serverParam}`);
      cmds.push("");
      cmds.push(`Add-DnsServerQueryResolutionPolicy -Name "SplitBrainZonePolicy" -Action ALLOW ${splitCrit} -ZoneScope "${data.internalScopeName || "internal"},1" -ZoneName "${data.zone}" -ProcessingOrder ${order + 1}${serverParam}`);
      if (data.splitAD) {
        cmds.push("");
        cmds.push("# Note: Zone scopes replicate in AD, but policies do NOT.");
        cmds.push("# Run policy copy commands on each additional DC.");
      }
      break;
    }

    case "blocklist": {
      cmds.push("# Domain Blocklist Configuration");
      cmds.push("");
      let domains = (data.blocklistDomains || "")
        .split(/[\n,]+/)
        .map((d: string) => d.trim())
        .filter(Boolean);
      const blAction = data.blocklistAction || "IGNORE";
      const prefix = data.blocklistPolicyName || "Blocklist";
      if (data.blocklistWildcard) {
        domains = domains.map((d: string) => (d.startsWith("*.") ? d : "*." + d));
      }
      const groupSize = 100;
      for (let i = 0; i < domains.length; i += groupSize) {
        const batch = domains.slice(i, i + groupSize);
        const n = Math.floor(i / groupSize) + 1;
        const pName = domains.length > groupSize ? `${prefix}_Part${n}` : prefix;
        cmds.push(`Add-DnsServerQueryResolutionPolicy -Name "${pName}" -Action ${blAction} -FQDN "EQ,${batch.join(",")}" -ProcessingOrder ${n}${serverParam}`);
      }
      break;
    }

    case "timeofday": {
      cmds.push("# Time-of-Day Routing Configuration");
      cmds.push(`# Zone: ${data.zone}`);
      cmds.push("");
      const dcs: any[] = data.todDatacenters || [];
      const weights: Record<string, number> = data.todWeights || {};
      const recName = data.todRecordName || "@";
      const ttlP = data.todTtl && parseInt(data.todTtl) > 0
        ? ` -TimeToLive ([System.TimeSpan]::FromSeconds(${data.todTtl}))` : "";
      const hasSub = dcs.some((dc: any) => dc.subnet);
      let po = 1;

      if (hasSub) {
        cmds.push("# Client subnets");
        dcs.forEach((dc: any) => {
          if (dc.name && dc.subnet)
            cmds.push(`Add-DnsServerClientSubnet -Name "${dc.name}Subnet" -IPv4Subnet "${dc.subnet}"${serverParam}`);
        });
        cmds.push("");
      }

      cmds.push("# Zone scopes and records");
      dcs.forEach((dc: any) => {
        if (!dc.name || !dc.ip) return;
        cmds.push(`Add-DnsServerZoneScope -ZoneName "${data.zone}" -Name "${dc.name}ZoneScope"${serverParam}`);
        cmds.push(`Add-DnsServerResourceRecord -ZoneName "${data.zone}" -ZoneScope "${dc.name}ZoneScope" -A -Name "${recName}" -IPv4Address "${dc.ip}"${ttlP}${serverParam}`);
      });
      cmds.push("");

      if (data.todPeakHours) {
        cmds.push("# Peak-hour policies");
        if (hasSub) {
          dcs.forEach((dc: any) => {
            if (!dc.name || !dc.subnet) return;
            const sp = dcs.filter((d: any) => d.name).map((d: any) => `${d.name}ZoneScope,${weights[d.name] || 1}`);
            cmds.push(`Add-DnsServerQueryResolutionPolicy -Name "${dc.name}PeakPolicy" -Action ALLOW -ClientSubnet "EQ,${dc.name}Subnet" -TimeOfDay "EQ,${data.todPeakHours}" -ZoneScope "${sp.join(";")}" -ZoneName "${data.zone}" -ProcessingOrder ${po}${serverParam}`);
            po++;
          });
        } else {
          const sp = dcs.filter((d: any) => d.name).map((d: any) => `${d.name}ZoneScope,${weights[d.name] || 1}`);
          cmds.push(`Add-DnsServerQueryResolutionPolicy -Name "PeakHoursPolicy" -Action ALLOW -TimeOfDay "EQ,${data.todPeakHours}" -ZoneScope "${sp.join(";")}" -ZoneName "${data.zone}" -ProcessingOrder ${po}${serverParam}`);
          po++;
        }
        cmds.push("");
      }

      if (hasSub) {
        cmds.push("# Normal-hour per-region policies");
        dcs.forEach((dc: any) => {
          if (!dc.name || !dc.subnet) return;
          cmds.push(`Add-DnsServerQueryResolutionPolicy -Name "${dc.name}NormalPolicy" -Action ALLOW -ClientSubnet "EQ,${dc.name}Subnet" -ZoneScope "${dc.name}ZoneScope,1" -ZoneName "${data.zone}" -ProcessingOrder ${po}${serverParam}`);
          po++;
        });
        cmds.push("");
      }

      cmds.push("# Worldwide catch-all");
      const ca = dcs.filter((d: any) => d.name).map((d: any) => `${d.name}ZoneScope,1`);
      cmds.push(`Add-DnsServerQueryResolutionPolicy -Name "WorldwideCatchAllPolicy" -Action ALLOW -ZoneScope "${ca.join(";")}" -ZoneName "${data.zone}" -ProcessingOrder ${po}${serverParam}`);
      break;
    }

    case "loadbalancing": {
      cmds.push("# Application Load Balancing Configuration");
      cmds.push(`# Zone: ${data.zone}`);
      cmds.push("");
      const backends: any[] = data.backends || [];
      const lbTtl = data.lbTtl && parseInt(data.lbTtl) > 0
        ? ` -TimeToLive ([System.TimeSpan]::FromSeconds(${data.lbTtl}))` : "";
      const lbParts: string[] = [];
      backends.forEach((b: any) => {
        if (!b.name || !b.ip) return;
        cmds.push(`Add-DnsServerZoneScope -ZoneName "${data.zone}" -Name "${b.name}Scope"${serverParam}`);
        cmds.push(`Add-DnsServerResourceRecord -ZoneName "${data.zone}" -ZoneScope "${b.name}Scope" -A -Name "${data.lbRecordName || "@"}" -IPv4Address "${b.ip}"${lbTtl}${serverParam}`);
        lbParts.push(`${b.name}Scope,${b.weight || 1}`);
      });
      if (lbParts.length > 0) {
        cmds.push("");
        cmds.push(`Add-DnsServerQueryResolutionPolicy -Name "LoadBalancePolicy" -Action ALLOW -ZoneScope "${lbParts.join(";")}" -ZoneName "${data.zone}"${serverParam}`);
      }
      break;
    }

    case "geolb": {
      cmds.push("# Geo-Location + Load Balancing Configuration");
      cmds.push(`# Zone: ${data.zone}`);
      cmds.push("");
      const glRegs: any[] = data.geolbRegions || [];
      const glDcs2: any[] = data.geolbDatacenters || [];
      const glW: Record<string, Record<string, number>> = data.geolbRegionWeights || {};
      const glRec = data.geolbRecordName || "www";
      let glO = 1;

      cmds.push("# Client subnets");
      glRegs.forEach((r: any) => {
        if (r.name && r.subnet)
          cmds.push(`Add-DnsServerClientSubnet -Name "${r.name}Subnet" -IPv4Subnet "${r.subnet}"${serverParam}`);
      });
      cmds.push("");

      cmds.push("# Zone scopes and records");
      glDcs2.forEach((dc: any) => {
        if (!dc.name || !dc.ip) return;
        cmds.push(`Add-DnsServerZoneScope -ZoneName "${data.zone}" -Name "${dc.name}ZoneScope"${serverParam}`);
        cmds.push(`Add-DnsServerResourceRecord -ZoneName "${data.zone}" -ZoneScope "${dc.name}ZoneScope" -A -Name "${glRec}" -IPv4Address "${dc.ip}"${serverParam}`);
      });
      cmds.push("");

      cmds.push("# Per-region weighted policies");
      glRegs.forEach((r: any) => {
        if (!r.name || !r.subnet) return;
        const rW = glW[r.name] || {};
        const se = glDcs2.filter((d: any) => d.name).map((d: any) => `${d.name}ZoneScope,${rW[d.name] || 1}`);
        cmds.push(`Add-DnsServerQueryResolutionPolicy -Name "${r.name}Policy" -Action ALLOW -ClientSubnet "EQ,${r.name}Subnet" -ZoneScope "${se.join(";")}" -ZoneName "${data.zone}" -ProcessingOrder ${glO}${serverParam}`);
        glO++;
      });
      cmds.push("");

      if (data.geolbWorldwide !== false) {
        cmds.push("# Worldwide catch-all");
        const glCa = glDcs2.filter((d: any) => d.name).map((d: any) => `${d.name}ZoneScope,1`);
        cmds.push(`Add-DnsServerQueryResolutionPolicy -Name "WorldwidePolicy" -Action ALLOW -ZoneScope "${glCa.join(";")}" -ZoneName "${data.zone}" -ProcessingOrder ${glO}${serverParam}`);
      }
      break;
    }

    case "primarysecondary": {
      cmds.push("# Primary-Secondary Geo-Location Configuration");
      cmds.push(`# Zone: ${data.zone}`);
      cmds.push("");
      const psRegs: any[] = data.psRegions || [];
      const psSecs: any[] = data.psSecondaries || [];
      const psRec = data.psRecordName || "www";
      const secIPs = psSecs.filter((s: any) => s.ip).map((s: any) => `"${s.ip}"`);

      cmds.push("# Part A: Primary Server");
      cmds.push("");
      if (secIPs.length > 0) {
        cmds.push(`Set-DnsServerPrimaryZone -Name "${data.zone}" -Notify Notify -NotifyServers ${secIPs.join(",")} -SecondaryServers ${secIPs.join(",")}${serverParam}`);
        cmds.push("");
      }
      psRegs.forEach((r: any, idx: number) => {
        if (!r.name || !r.subnet) return;
        cmds.push(`Add-DnsServerClientSubnet -Name "${r.name}Subnet" -IPv4Subnet "${r.subnet}"${serverParam}`);
        cmds.push(`Add-DnsServerZoneScope -ZoneName "${data.zone}" -Name "${r.name}Scope"${serverParam}`);
        if (r.ip) cmds.push(`Add-DnsServerResourceRecord -ZoneName "${data.zone}" -ZoneScope "${r.name}Scope" -A -Name "${psRec}" -IPv4Address "${r.ip}"${serverParam}`);
        cmds.push(`Add-DnsServerQueryResolutionPolicy -Name "${r.name}Policy" -Action ALLOW -ClientSubnet "EQ,${r.name}Subnet" -ZoneScope "${r.name}Scope,1" -ZoneName "${data.zone}" -ProcessingOrder ${idx + 1}${serverParam}`);
        cmds.push("");
      });

      cmds.push("# Part B: Secondary Servers");
      cmds.push("");
      psSecs.forEach((sec: any) => {
        if (!sec.name) return;
        const secP = ` -ComputerName "${sec.name}"`;
        cmds.push(`Add-DnsServerSecondaryZone -Name "${data.zone}" -ZoneFile "${data.zone}.dns" -MasterServers ${serverHostname ? `"${serverHostname}"` : '"localhost"'}${secP}`);
        cmds.push("");
        psRegs.forEach((r: any) => {
          if (r.name && r.subnet) cmds.push(`Add-DnsServerClientSubnet -Name "${r.name}Subnet" -IPv4Subnet "${r.subnet}"${secP}`);
        });
        cmds.push("");
        psRegs.forEach((r: any) => {
          if (r.name) cmds.push(`Add-DnsServerZoneScope -ZoneName "${data.zone}" -Name "${r.name}Scope"${secP}`);
        });
        cmds.push("");
        psRegs.forEach((r: any) => {
          if (r.name && r.ip) cmds.push(`Add-DnsServerResourceRecord -ZoneName "${data.zone}" -ZoneScope "${r.name}Scope" -A -Name "${psRec}" -IPv4Address "${r.ip}"${secP}`);
        });
        cmds.push("");
        psRegs.forEach((r: any, idx: number) => {
          if (r.name && r.subnet) cmds.push(`Add-DnsServerQueryResolutionPolicy -Name "${r.name}Policy" -Action ALLOW -ClientSubnet "EQ,${r.name}Subnet" -ZoneScope "${r.name}Scope,1" -ZoneName "${data.zone}" -ProcessingOrder ${idx + 1}${secP}`);
        });
        cmds.push("");
      });
      break;
    }

    case "queryfilter": {
      const fm = data.filterMode || "blocklist";
      const fa = fm === "blocklist" ? (data.filterAction || "IGNORE") : "IGNORE";
      const fOp = fm === "blocklist" ? "EQ" : "NE";
      const fName = data.filterPolicyName || "QueryFilter";
      const fCrit: string[] = data.filterCriteria || ["FQDN"];
      const cond = data.filterCondition || "AND";

      cmds.push("# Query Filter Configuration");
      cmds.push(`# Mode: ${fm === "blocklist" ? "Block matching" : "Allow only matching"}`);
      cmds.push("");

      const parts: string[] = [];
      if (fCrit.includes("FQDN") && data.filterFqdns) {
        const fqdns = data.filterFqdns.split(/[\n,]+/).map((d: string) => d.trim()).filter(Boolean);
        if (fqdns.length) parts.push(`-FQDN "${fOp},${fqdns.join(",")}"`);
      }
      if (fCrit.includes("ClientSubnet") && data.filterSubnets) {
        const subs = data.filterSubnets.split(",").map((s: string) => s.trim()).filter(Boolean);
        if (subs.length) parts.push(`-ClientSubnet "${fOp},${subs.join(",")}"`);
      }
      if (fCrit.includes("QType") && data.filterQTypes) {
        const qts = data.filterQTypes.split(",").map((q: string) => q.trim()).filter(Boolean);
        if (qts.length) parts.push(`-QType "${fOp},${qts.join(",")}"`);
      }
      if (fCrit.includes("ServerInterfaceIP") && data.filterServerIPs) {
        const sips = data.filterServerIPs.split(",").map((s: string) => s.trim()).filter(Boolean);
        if (sips.length) parts.push(`-ServerInterfaceIP "${fOp},${sips.join(",")}"`);
      }

      if (parts.length > 0) {
        let cmd = `Add-DnsServerQueryResolutionPolicy -Name "${fName}" -Action ${fa} ${parts.join(" ")}`;
        if (parts.length > 1) cmd += ` -Condition ${cond}`;
        cmd += ` -ProcessingOrder 1${serverParam}`;
        cmds.push(cmd);
      } else {
        cmds.push("# No criteria specified");
      }
      break;
    }
  }

  return cmds.join("\n");
}
