/**
 * Coerce a bridge list field into a string array.
 *
 * PowerShell's ConvertTo-Json does not reliably preserve array-typed
 * properties: a single-element array can arrive as a scalar, IPAddress values
 * serialize as objects, and Windows PowerShell 5.1 can wrap arrays as
 * `{ value: [...], Count: n }`. Older bridge builds returned these raw shapes
 * (issue #115), so normalize at the API boundary before calling `.join()`.
 */
export function toStringList(value: unknown): string[] {
  if (value === null || value === undefined || value === "") return [];
  if (Array.isArray(value)) return value.flatMap(toStringList);
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if ("value" in obj && Array.isArray(obj.value)) return toStringList(obj.value);
    if (typeof obj.IPAddressToString === "string") return [obj.IPAddressToString];
    return [];
  }
  return [String(value)];
}
