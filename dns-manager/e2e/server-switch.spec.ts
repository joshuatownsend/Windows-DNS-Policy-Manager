import { test, expect } from "@playwright/test";

// Issue #143: objects loaded from server A must never stay on screen (or be acted on) once
// the user switches to server B, including a slow response from A arriving after the switch.
const server = (id: string, name: string) => ({
  id, name, hostname: name, credentialMode: "currentUser", hasCredential: false,
  status: "online", lastChecked: null, serverInfo: null, zoneCount: 0,
});

test.describe("Server switching", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript((state) => {
      window.localStorage.setItem("dns-policy-manager", JSON.stringify({ state, version: 0 }));
    }, { servers: [server("srv-a", "dns-a"), server("srv-b", "dns-b")], activeServerId: "srv-a", executionMode: "generate" });

    await page.route("**/api/zones?*", async (route) => {
      const url = new URL(route.request().url());
      const fromA = url.searchParams.get("serverId") === "srv-a";
      if (fromA) await new Promise((r) => setTimeout(r, 2500));
      await route.fulfill({
        json: { success: true, zones: [{ ZoneName: fromA ? "a-only.example" : "b-only.example", ZoneType: "Primary", IsDsIntegrated: false, IsReverseLookupZone: false, IsAutoCreated: false }] },
      });
    });
  });

  test("a late response from the previous server is discarded", async ({ page }) => {
    await page.goto("/zones");
    await page.getByRole("button", { name: /Active server: dns-a/ }).click();
    await page.getByRole("menuitem", { name: /dns-b/ }).click();

    await expect(page.getByText("b-only.example").first()).toBeVisible({ timeout: 10000 });
    // Give server A's delayed response time to arrive; it must not replace B's zones.
    await page.waitForTimeout(3500);
    await expect(page.getByText("a-only.example")).toHaveCount(0);
    await expect(page.getByText("b-only.example").first()).toBeVisible();
  });
});
