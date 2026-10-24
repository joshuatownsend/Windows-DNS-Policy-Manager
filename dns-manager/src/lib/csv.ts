/**
 * Format one CSV cell. Always quotes (so commas, quotes and newlines can't break the row)
 * and prefixes a `'` to values a spreadsheet would treat as a formula — those starting
 * with `=`, `+`, `-`, `@`, tab or carriage return (OWASP CSV injection guidance).
 */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export function csvRow(values: unknown[]): string {
  return values.map(csvCell).join(",");
}

/**
 * Parse one CSV line (RFC 4180 quoting, `""` for an embedded quote). Reverses `csvCell`,
 * including its formula-neutralizing `'` prefix — imported values go to DNS, not a spreadsheet.
 */
export function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      cells.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells.map((c) => {
    const t = c.trim();
    return /^'[=+\-@\t\r]/.test(t) ? t.slice(1) : t;
  });
}
