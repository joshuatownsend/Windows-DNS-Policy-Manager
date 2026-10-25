/**
 * Dry Run enforcement. In Dry Run every call that would change a DNS server is stopped in
 * the API client (src/lib/api.ts) before it leaves the browser, so no page can bypass the
 * mode by forgetting to check it. Calls that only read, test, export or manage the app's own
 * credentials stay live.
 */

/** POST/PUT/DELETE endpoints that change nothing on a DNS server. */
const READ_ONLY_CALLS: Array<{ method: string; pattern: RegExp }> = [
  { method: "POST", pattern: /^\/api\/connect$/ },
  { method: "POST", pattern: /^\/api\/credentials\/(store|session)$/ },
  { method: "DELETE", pattern: /^\/api\/credentials\/[^/]+$/ },
  { method: "POST", pattern: /^\/api\/server\/(test|resolvers|bpa)$/ },
  { method: "POST", pattern: /^\/api\/backup$/ },
  { method: "POST", pattern: /^\/api\/export\/allzones$/ },
  { method: "POST", pattern: /^\/api\/zones\/[^/]+\/export$/ },
  { method: "POST", pattern: /^\/api\/dnssec\/[^/]+\/export-key$/ },
  { method: "POST", pattern: /^\/api\/utilities\/dns-lookup$/ },
];

/** Verbs whose cmdlets only read or format (the PowerShell tab may run these in Dry Run). */
const READ_ONLY_VERBS = new Set(["get", "resolve", "test", "show", "select", "sort", "format", "out", "measure"]);

/**
 * True when every Verb-Noun token in a command uses a read-only verb. Errs toward "not
 * read-only": a hyphenated word inside a string argument counts as a command too, and any
 * backtick makes the whole command count as a change, because PowerShell drops escape
 * backticks from command names (``Remove`-DnsServerZone`` runs Remove-DnsServerZone).
 */
export function isReadOnlyCommand(command: string): boolean {
  if (command.includes("`")) return false;
  // Treat Unicode dashes as hyphens so they can't split a verb from its noun either.
  const normalized = command.replace(/[\u2010-\u2015\u2212]/g, "-");
  const names = normalized.match(/(?<![-\w])[A-Za-z]+-[A-Za-z0-9]+/g) ?? [];
  return names.length > 0 && names.every((n) => READ_ONLY_VERBS.has(n.split("-")[0].toLowerCase()));
}

/** True when an API call would change a DNS server and must be blocked in Dry Run. */
export function isMutatingCall(method: string, url: string, body?: unknown): boolean {
  const upper = method.toUpperCase();
  if (upper === "GET" || upper === "HEAD") return false;
  const path = url.split("?")[0];
  if (READ_ONLY_CALLS.some((c) => c.method === upper && c.pattern.test(path))) return false;
  if (upper === "POST" && path === "/api/execute") {
    const command = (body as { command?: unknown } | undefined)?.command;
    return !(typeof command === "string" && isReadOnlyCommand(command));
  }
  return true;
}

export const DRY_RUN_ERROR = "Dry Run is on, so nothing was changed. Switch the header toggle to Live to apply this change.";

/** One line for the PowerShell tab describing the request Dry Run held back. */
export function describeBlockedCall(method: string, url: string, body?: unknown): string {
  const path = url.split("?")[0];
  let detail = "";
  if (body !== undefined) {
    const json = JSON.stringify(body);
    detail = " " + (json.length > 300 ? json.slice(0, 300) + "…" : json);
  }
  return `# Dry Run — not sent: ${method.toUpperCase()} ${path}${detail}`;
}
