import { beforeEach, describe, expect, it } from "vitest";
import { appendCapped, useStore } from "./store";

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

describe("serverEpoch (issue #143)", () => {
  const A = { id: "a", name: "A", hostname: "dns-a", credentialMode: "currentUser" as const, hasCredential: false, status: "online" as const, lastChecked: null, serverInfo: null, zoneCount: 0 };
  const B = { ...A, id: "b", name: "B", hostname: "dns-b" };

  beforeEach(() => {
    useStore.setState({ servers: [A, B], activeServerId: "a", serverEpoch: 0 });
    useStore.getState().setZones([{ ZoneName: "a-only.example" } as never]);
    useStore.getState().setPolicies([{ Name: "A-policy" }]);
  });

  it("switching servers bumps the epoch and clears server data", () => {
    useStore.getState().setActiveServerId("b");
    const s = useStore.getState();
    expect(s.serverEpoch).toBe(1);
    expect(s.zones).toEqual([]);
    expect(s.policies).toEqual([]);
  });

  it("re-selecting the same server changes nothing", () => {
    useStore.getState().setActiveServerId("a");
    expect(useStore.getState().serverEpoch).toBe(0);
    expect(useStore.getState().zones).toHaveLength(1);
  });

  it("re-pointing the active server's host counts as a switch", () => {
    useStore.getState().updateServer("a", { hostname: "dns-a2" });
    expect(useStore.getState().serverEpoch).toBe(1);
    expect(useStore.getState().zones).toEqual([]);
  });

  it("status updates and edits to other servers keep the data", () => {
    useStore.getState().updateServer("a", { status: "offline" });
    useStore.getState().updateServer("b", { hostname: "dns-b2" });
    expect(useStore.getState().serverEpoch).toBe(0);
    expect(useStore.getState().zones).toHaveLength(1);
  });

  it("removing the active server clears its data", () => {
    useStore.getState().removeServer("a");
    expect(useStore.getState().activeServerId).toBeNull();
    expect(useStore.getState().serverEpoch).toBe(1);
    expect(useStore.getState().policies).toEqual([]);
  });
});
