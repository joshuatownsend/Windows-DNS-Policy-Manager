import { test, expect } from "@playwright/test";

test.describe("Navigation", () => {
  test("server page loads", async ({ page }) => {
    await page.goto("/server");
    await expect(page.locator("h1, h2").filter({ hasText: "DNS Servers" }).first()).toBeVisible();
  });

  test("tab navigation works", async ({ page }) => {
    await page.goto("/server");

    const tabs = [
      { label: "Objects", url: "/objects" },
      { label: "Zones", url: "/zones" },
      { label: "Policies", url: "/policies" },
      { label: "Create", url: "/create" },
      { label: "Wizards", url: "/wizards" },
      { label: "DNSSEC", url: "/dnssec" },
      { label: "Backup", url: "/backup" },
      { label: "PowerShell", url: "/powershell" },
      { label: "Server", url: "/server" },
    ];

    for (const tab of tabs) {
      await page.getByRole("tab", { name: tab.label }).click();
      await expect(page).toHaveURL(new RegExp(tab.url));
    }
  });

  test("help panel opens and closes", async ({ page }) => {
    await page.goto("/server");
    await page.getByTitle("Help (context-sensitive)").click();
    const dialog = page.getByRole("dialog", { name: "Help documentation" });
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    // The panel uses translate-x-full to hide (still in DOM), so check it's translated off-screen
    await expect(dialog).toHaveClass(/translate-x-full/);
  });

  test("bridge status shows Online", async ({ page }) => {
    await page.goto("/server");
    // The bridge status component has "BRIDGE" label below the status
    await expect(page.locator("text=Online").first()).toBeVisible({ timeout: 10000 });
  });
});
