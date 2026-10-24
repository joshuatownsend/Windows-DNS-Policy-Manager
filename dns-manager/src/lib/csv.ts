/** Leading characters that make a spreadsheet treat a cell as a formula, plus `'` itself. */
const NEEDS_PREFIX = /^[=+\-@\t\r']/;

/**
 * Format one CSV cell. Always quotes (so commas, quotes and newlines can't break the row)
 * and prefixes a `'` to values a spreadsheet would treat as a formula — those starting
 * with `=`, `+`, `-`, `@`, tab or carriage return (OWASP CSV injection guidance). A value
 * that already starts with `'` gets one too, so `parseCsvLine` can always strip exactly one.
 */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (NEEDS_PREFIX.test(s)) s = `'${s}`;
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
  // Whitespace outside quotes is trimmed; whitespace inside quotes is data (e.g. TXT values).
  let quotedPart = "";
  let unquotedPart = "";
  let sawQuote = false;
  let quoted = false;
  const finish = () => {
    const value = sawQuote ? quotedPart + unquotedPart.trimEnd() : unquotedPart.trim();
    cells.push(sawQuote && NEEDS_PREFIX.test(value.slice(1)) && value.startsWith("'") ? value.slice(1) : value);
    quotedPart = "";
    unquotedPart = "";
    sawQuote = false;
  };
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        quotedPart += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        quotedPart += ch;
      }
    } else if (ch === '"' && !sawQuote && unquotedPart.trim() === "") {
      quoted = true;
      sawQuote = true;
      unquotedPart = "";
    } else if (ch === ",") {
      finish();
    } else {
      unquotedPart += ch;
    }
  }
  finish();
  return cells;
}
