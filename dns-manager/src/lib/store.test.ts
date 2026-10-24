import { describe, expect, it } from "vitest";
import { appendCapped } from "./store";

describe("appendCapped", () => {
  it("appends under the cap", () => {
    expect(appendCapped(["a"], ["b", "c"], 5)).toEqual(["a", "b", "c"]);
  });

  it("keeps only the most recent lines over the cap", () => {
    expect(appendCapped(["a", "b", "c"], ["d", "e"], 3)).toEqual(["c", "d", "e"]);
  });

  it("handles a batch larger than the cap", () => {
    expect(appendCapped([], ["1", "2", "3", "4"], 2)).toEqual(["3", "4"]);
  });
});
