import { MAX_IMPORT_ENTRIES } from "./import-limits";
import type { ServerParams } from "./utils";

/** The only policy fields an import forwards to the bridge (what Handle-Backup exports). */
export interface ImportPolicy {
  name: string;
  action: "ALLOW" | "DENY" | "IGNORE";
  processingOrder?: number;
  zoneName?: string;
  condition?: "AND" | "OR";
}

export interface ParsedBackup {
  server: string;
  exportDate: string;
  policies: ImportPolicy[];
  /** Entries dropped for a missing/invalid name or action. */
  skipped: number;
  /** True when the file held more than MAX_IMPORT_ENTRIES policies. */
  truncated: boolean;
}

const ACTIONS = new Set(["ALLOW", "DENY", "IGNORE"]);

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

/** Case-insensitive property read — PowerShell exports PascalCase, hand-written files may not. */
function field(obj: Record<string, unknown>, name: string): unknown {
  const key = Object.keys(obj).find((k) => k.toLowerCase() === name.toLowerCase());
  return key === undefined ? undefined : obj[key];
}

function toImportPolicy(raw: unknown): ImportPolicy | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
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
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, error: "Invalid backup file: expected a JSON object" };
  }
  const obj = data as Record<string, unknown>;
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
    },
  };
}

/** Request body for POST /api/policies — the target is always the caller's active server. */
export function toCreatePolicyBody(policy: ImportPolicy, target: ServerParams): Record<string, unknown> {
  return { ...policy, ...target };
}
