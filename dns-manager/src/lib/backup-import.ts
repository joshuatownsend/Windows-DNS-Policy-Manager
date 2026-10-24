import { MAX_IMPORT_ENTRIES } from "./import-limits";
import type { ServerParams } from "./utils";

/** Criterion types Add-DnsServerQueryResolutionPolicy accepts (each becomes a cmdlet parameter). */
export const CRITERION_TYPES = [
  "ClientSubnet",
  "Fqdn",
  "QType",
  "ServerInterfaceIP",
  "TimeOfDay",
  "TransportProtocol",
  "InternetProtocol",
] as const;

export interface ImportCriterion {
  type: (typeof CRITERION_TYPES)[number];
  operator: "EQ" | "NE";
  values: string[];
}

export interface ImportScope {
  name: string;
  weight: number;
}

/** The only policy fields an import forwards to the bridge (see Handle-CreatePolicy). */
export interface ImportPolicy {
  name: string;
  action: "ALLOW" | "DENY" | "IGNORE";
  processingOrder?: number;
  zoneName?: string;
  condition?: "AND" | "OR";
  criteria?: ImportCriterion[];
  scopes?: ImportScope[];
  applyOnRecursion?: boolean;
  recursionScope?: string;
}

export interface ParsedBackup {
  server: string;
  exportDate: string;
  policies: ImportPolicy[];
  /** Entries dropped for a missing/invalid name, action, criterion or scope. */
  skipped: number;
  /** True when the file held more than MAX_IMPORT_ENTRIES policies. */
  truncated: boolean;
  /** DENY/IGNORE policies with no criteria — on import they would match every query. */
  matchAll: string[];
}

const ACTIONS = new Set(["ALLOW", "DENY", "IGNORE"]);

class InvalidEntry extends Error {}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

/** Case-insensitive property read — PowerShell exports PascalCase, hand-written files may not. */
function field(obj: Record<string, unknown>, name: string): unknown {
  const key = Object.keys(obj).find((k) => k.toLowerCase() === name.toLowerCase());
  return key === undefined ? undefined : obj[key];
}

function asObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function toCriterion(raw: unknown): ImportCriterion {
  const obj = asObject(raw);
  if (!obj) throw new InvalidEntry();
  const typeName = str(field(obj, "type"))?.toLowerCase();
  const type = CRITERION_TYPES.find((t) => t.toLowerCase() === typeName);
  const operator = str(field(obj, "operator"))?.toUpperCase();
  // Accept `values: string[]` (bridge shape) or a single `value` string (form shape).
  const rawValues = field(obj, "values") ?? field(obj, "value");
  const values = (Array.isArray(rawValues) ? rawValues : [rawValues]).map(str);
  if (!type || (operator !== "EQ" && operator !== "NE") || values.length === 0 || values.some((v) => !v)) {
    throw new InvalidEntry();
  }
  return { type, operator, values: values as string[] };
}

function toScope(raw: unknown): ImportScope {
  const obj = asObject(raw);
  const name = obj && (str(field(obj, "name")) ?? str(field(obj, "scopeName")));
  const weight = obj ? Number(field(obj, "weight") ?? 1) : NaN;
  if (!name || !Number.isInteger(weight) || weight < 1) throw new InvalidEntry();
  return { name, weight };
}

function toImportPolicy(raw: unknown): ImportPolicy | null {
  const obj = asObject(raw);
  if (!obj) return null;
  const name = str(field(obj, "name"));
  const action = str(field(obj, "action"))?.toUpperCase();
  if (!name || !action || !ACTIONS.has(action)) return null;

  const policy: ImportPolicy = { name, action: action as ImportPolicy["action"] };
  const order = Number(field(obj, "processingOrder"));
  if (Number.isInteger(order) && order > 0) policy.processingOrder = order;
  const zoneName = str(field(obj, "zoneName"));
  if (zoneName) policy.zoneName = zoneName;
  const condition = str(field(obj, "condition"))?.toUpperCase();
  if (condition === "AND" || condition === "OR") policy.condition = condition;

  try {
    // A policy whose criteria can't be restored exactly is skipped, never imported looser.
    const criteria = field(obj, "criteria");
    if (criteria !== undefined && criteria !== null) {
      if (!Array.isArray(criteria)) return null;
      if (criteria.length > 0) policy.criteria = criteria.map(toCriterion);
    }
    const scopes = field(obj, "scopes");
    if (scopes !== undefined && scopes !== null) {
      if (!Array.isArray(scopes)) return null;
      if (scopes.length > 0) policy.scopes = scopes.map(toScope);
    }
  } catch (e) {
    if (e instanceof InvalidEntry) return null;
    throw e;
  }
  if (field(obj, "applyOnRecursion") === true) policy.applyOnRecursion = true;
  const recursionScope = str(field(obj, "recursionScope"));
  if (recursionScope) policy.recursionScope = recursionScope;
  return policy;
}

/**
 * Validate a policy backup file. Only whitelisted policy fields survive, so keys such as
 * `server`, `serverId` or `credentialMode` hidden in a policy entry can never reach the bridge.
 */
export function parseBackupFile(
  text: string,
): { ok: true; backup: ParsedBackup } | { ok: false; error: string } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: "Failed to parse JSON file" };
  }
  const obj = asObject(data);
  if (!obj) {
    return { ok: false, error: "Invalid backup file: expected a JSON object" };
  }
  const lists = ["policies", "zonePolicies", "serverPolicies"].map((k) => obj[k]);
  if (lists.every((l) => l === undefined)) {
    return { ok: false, error: "Invalid backup file: no policies found" };
  }
  if (lists.some((l) => l !== undefined && !Array.isArray(l))) {
    return { ok: false, error: "Invalid backup file: policy lists must be arrays" };
  }

  const rawEntries = (lists as (unknown[] | undefined)[]).flatMap((l) => l ?? []);
  const truncated = rawEntries.length > MAX_IMPORT_ENTRIES;
  const policies: ImportPolicy[] = [];
  let skipped = 0;
  for (const raw of rawEntries.slice(0, MAX_IMPORT_ENTRIES)) {
    const p = toImportPolicy(raw);
    if (p) policies.push(p);
    else skipped++;
  }

  return {
    ok: true,
    backup: {
      server: str(obj.server) ?? "",
      exportDate: str(obj.exportDate) ?? str(obj.backupDate) ?? "",
      policies,
      skipped,
      truncated,
      matchAll: policies.filter((p) => p.action !== "ALLOW" && !p.criteria).map((p) => p.name),
    },
  };
}

/** Request body for POST /api/policies — the target is always the caller's active server. */
export function toCreatePolicyBody(policy: ImportPolicy, target: ServerParams): Record<string, unknown> {
  return { ...policy, ...target };
}
