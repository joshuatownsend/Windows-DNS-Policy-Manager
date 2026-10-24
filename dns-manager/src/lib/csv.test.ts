import { describe, expect, it } from "vitest";
import { csvCell, csvRow, hasEscapedCells, parseCsvLine, RECORD_CSV_HEADER } from "./csv";

describe("csvCell", () => {
  it("quotes plain values", () => {
    expect(csvCell("www")).toBe('"www"');
    expect(csvCell(3600)).toBe('"3600"');
  });

  it("renders null and undefined as empty", () => {
    expect(csvCell(null)).toBe('""');
    expect(csvCell(undefined)).toBe('""');
  });

  it("doubles embedded quotes", () => {
    expect(csvCell('v=spf1 "x"')).toBe('"v=spf1 ""x"""');
  });

  it.each(["=HYPERLINK(\"http://x\")", "+1+1", "-2+3", "@SUM(A1)", "\tcmd", "\rcmd"])(
    "neutralizes formula prefix in %j",
    (value) => {
      const cell = csvCell(value);
      expect(cell.startsWith(`"'`)).toBe(true);
    },
  );

  it("keeps commas and newlines inside one cell", () => {
    expect(csvCell("a,b\nc")).toBe('"a,b\nc"');
  });
});

describe("csvRow", () => {
  it("joins cells with commas", () => {
    expect(csvRow(["=evil", "A", "1.2.3.4", "01:00:00"])).toBe(
      `"'=evil","A","1.2.3.4","01:00:00"`,
    );
  });
});

describe("parseCsvLine", () => {
  it("splits unquoted cells", () => {
    expect(parseCsvLine("www,A,1.2.3.4,3600")).toEqual(["www", "A", "1.2.3.4", "3600"]);
  });

  it("keeps commas and quotes inside quoted cells", () => {
    expect(parseCsvLine('"txt","TXT","a,b ""c""","3600"')).toEqual(["txt", "TXT", 'a,b "c"', "3600"]);
  });

  it("round-trips csvRow, including neutralized formulas", () => {
    const values = ["=evil", "TXT", "v=spf1 include:x, -all", "01:00:00"];
    expect(parseCsvLine(csvRow(values), true)).toEqual(values);
  });
});

describe("csv round-trip edge cases", () => {
  it("preserves whitespace inside quoted cells", () => {
    expect(parseCsvLine('"txt","TXT","  padded  ","3600"')).toEqual(["txt", "TXT", "  padded  ", "3600"]);
  });

  it("still trims whitespace outside quotes", () => {
    expect(parseCsvLine(' www , A ,"1.2.3.4" ')).toEqual(["www", "A", "1.2.3.4"]);
  });

  it.each(["'=literal", "'plain", "''double", "=formula", "  spaced  ", "'"])("round-trips %j", (value) => {
    expect(parseCsvLine(csvRow([value]), true)).toEqual([value]);
  });
});

describe("legacy files", () => {
  it("marks this exporter's header as escaped", () => {
    expect(hasEscapedCells(RECORD_CSV_HEADER)).toBe(true);
    expect(hasEscapedCells("HostName,RecordType,Data,TTL")).toBe(false);
  });

  it("keeps a literal leading apostrophe when not unescaping", () => {
    expect(parseCsvLine(`txt,TXT,"'=literal",3600`)).toEqual(["txt", "TXT", "'=literal", "3600"]);
  });
});
