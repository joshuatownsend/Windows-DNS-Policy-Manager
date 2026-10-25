// Helpers for building PowerShell command text that an administrator will copy and run.
//
// KEEP IDENTICAL to mcp-server/src/lib/ps-escape.ts. dns-manager's ps-escape.test.ts fails
// if the two copies differ.

/**
 * Characters with meaning inside a PowerShell double-quoted (expandable) string: the escape
 * character, `$` (variables and `$()` subexpressions) and every double-quote form the parser
 * accepts as a string terminator, including the curly quotes U+201C, U+201D and U+201E.
 */
const CURLY_DOUBLE_QUOTES = String.fromCharCode(0x201c, 0x201d, 0x201e);
const DOUBLE_QUOTED_SPECIALS = new RegExp("[`\"$" + CURLY_DOUBLE_QUOTES + "]", "g");

/** CR, LF and the Unicode line/paragraph separators. */
const LINE_BREAKS = new RegExp("[" + String.fromCharCode(0x0d, 0x0a, 0x2028, 0x2029) + "]+", "g");

/**
 * Make a value safe inside a double-quoted PowerShell string. Each special character gets a
 * backtick. Line breaks become spaces, so a value placed in a `#` comment line can't end the
 * comment and start a command on the next line.
 */
export function psEscape(value: unknown): string {
  return String(value ?? "")
    .replace(LINE_BREAKS, " ")
    .replace(DOUBLE_QUOTED_SPECIALS, (ch) => "`" + ch);
}

/**
 * A value for an unquoted enum position (e.g. `-Action ALLOW`): the canonical spelling of the
 * case-insensitive match from `allowed`, else `fallback`. Escaping can't make an unquoted
 * position safe; only a fixed vocabulary can.
 */
export function psEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  const wanted = String(value ?? "").trim().toLowerCase();
  return allowed.find((a) => a.toLowerCase() === wanted) ?? fallback;
}

/** A value for an unquoted integer position, clamped to [min, max]; `fallback` if not a number. */
export function psInt(value: unknown, fallback: number, min = 0, max = 2147483647): number {
  const n = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

export const POLICY_ACTIONS = ["ALLOW", "DENY", "IGNORE"] as const;
export const POLICY_CONDITIONS = ["AND", "OR"] as const;
export const POLICY_CRITERIA = [
  "ClientSubnet",
  "Fqdn",
  "QType",
  "ServerInterfaceIP",
  "TimeOfDay",
  "TransportProtocol",
  "InternetProtocol",
] as const;
