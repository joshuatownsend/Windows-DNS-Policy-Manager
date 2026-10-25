import type { PolicyAction, PolicyType } from "./types";
import { POLICY_ACTIONS, POLICY_CONDITIONS, POLICY_CRITERIA, psEnum, psEscape, psInt } from "./ps-escape";

export interface Criterion {
  type: string;
  operator: string;
  value: string;
}

export interface Scope {
  scopeName: string;
  weight: number;
}

/**
 * PowerShell for the Create Policy form. Shown to the user and, in Live mode, run through
 * /api/execute.
 */
export function buildCommand(
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
  // This text is shown to the user and, in Live mode, run through /api/execute: strings are
  // escaped and quoted, and every unquoted position comes from a fixed vocabulary.
  const serverParam =
    serverHostname && serverHostname !== "localhost"
      ? ` -ComputerName "${psEscape(serverHostname)}"`
      : "";

  let cmdlet = "";
  if (policyType === "QueryResolution") cmdlet = "Add-DnsServerQueryResolutionPolicy";
  else if (policyType === "Recursion") cmdlet = "Add-DnsServerRecursionPolicy";
  else cmdlet = "Add-DnsServerZoneTransferPolicy";

  let cmd = `${cmdlet} -Name "${psEscape(name)}" -Action ${psEnum(action, POLICY_ACTIONS, "ALLOW")}`;
  cmd += ` -ProcessingOrder ${psInt(processingOrder, 1, 1)}`;

  if (!isEnabled) cmd += " -IsEnabled $false";

  // Zone
  if (policyType !== "Recursion" && zoneName && applyToZone) {
    cmd += ` -ZoneName "${psEscape(zoneName)}"`;
  }

  // Criteria
  const validCriteria = criteria.filter(
    (c) => c.value && (POLICY_CRITERIA as readonly string[]).includes(c.type)
  );
  validCriteria.forEach((c) => {
    cmd += ` -${c.type} "${psEnum(c.operator, ["EQ", "NE"] as const, "EQ")},${psEscape(c.value)}"`;
  });

  // Condition
  if (validCriteria.length > 1) {
    cmd += ` -Condition ${psEnum(condition, POLICY_CONDITIONS, "AND")}`;
  }

  // Scopes (QueryResolution only)
  if (policyType === "QueryResolution" && scopes.length > 0) {
    const validScopes = scopes.filter((s) => s.scopeName);
    if (validScopes.length > 0) {
      const scopeStr = validScopes
        .map((s) => `${psEscape(s.scopeName)},${psInt(s.weight, 1, 1)}`)
        .join(";");
      cmd += ` -ZoneScope "${scopeStr}"`;
    }
  }

  // Recursion scope
  if (policyType === "Recursion" && recursionScope) {
    cmd += ` -RecursionScope "${psEscape(recursionScope)}"`;
  }

  cmd += serverParam;
  return cmd;
}
