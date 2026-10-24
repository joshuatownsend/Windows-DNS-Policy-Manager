import { describe, expect, it } from "vitest";
import { checkImportFile, MAX_IMPORT_BYTES } from "./import-limits";

describe("checkImportFile", () => {
  it("accepts files at the limit", () => {
    expect(checkImportFile({ name: "a.json", size: MAX_IMPORT_BYTES })).toBeNull();
  });

  it("rejects files over the limit", () => {
    expect(checkImportFile({ name: "big.txt", size: MAX_IMPORT_BYTES + 1 })).toMatch(/big\.txt.*limited to 10 MB/);
  });
});
