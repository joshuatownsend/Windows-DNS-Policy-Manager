import { describe, expect, it } from "vitest";
import { toStringList } from "./normalize";

describe("toStringList", () => {
  it("returns an empty list for missing values", () => {
    expect(toStringList(undefined)).toEqual([]);
    expect(toStringList(null)).toEqual([]);
    expect(toStringList("")).toEqual([]);
  });

  it("passes string arrays through", () => {
    expect(toStringList(["10.0.0.1", "10.0.0.2"])).toEqual(["10.0.0.1", "10.0.0.2"]);
  });

  it("wraps a scalar left behind by a collapsed single-element array", () => {
    expect(toStringList("10.0.0.1")).toEqual(["10.0.0.1"]);
  });

  it("extracts serialized IPAddress objects", () => {
    const ip = { Address: 16777226, AddressFamily: 2, IPAddressToString: "10.0.0.1" };
    expect(toStringList(ip)).toEqual(["10.0.0.1"]);
    expect(toStringList([ip, { IPAddressToString: "10.0.0.2" }])).toEqual(["10.0.0.1", "10.0.0.2"]);
  });

  it("unwraps the Windows PowerShell 5.1 { value, Count } array wrapper", () => {
    expect(toStringList({ value: ["10.0.0.1"], Count: 1 })).toEqual(["10.0.0.1"]);
  });

  it("drops objects it cannot interpret instead of rendering [object Object]", () => {
    expect(toStringList({ foo: "bar" })).toEqual([]);
  });
});
