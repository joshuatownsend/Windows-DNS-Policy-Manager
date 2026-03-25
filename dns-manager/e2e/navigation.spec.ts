import { test, expect } from "@playwright/test";

test.describe("Navigation", () => {
  test("server page loads", async ({ page }) => {
    await page.goto("/server");
    await expect(page.locator("h1, h2").filter({ hasText: "DNS Servers" }).first()).toBeVisible();
  });

  test("tab navigation works", async ({ page }) => {
    await page.goto("/server");

    const tabs = [
      { label: "DNS Objects", url: "/objects" },
      { label: "Zones", url: "/zones" },
      { label: "Policies", url: "/policies" },
      { label: "Create Policy", url: "/create" },
      { label: "Wizards", url: "/wizards" },
      { label: "DNSSEC", url: "/dnssec" },
      { label: "Backup & Import", url: "/backup" },
      { label: "PowerShell Commands", url: "/powershell" },
      { label: "Server", url: "/server" },
    ];

    for (const tab of tabs) {
      await page.getByRole("link", { name: tab.label }).click();
      await expect(page).toHaveURL(new RegExp(tab.url));
    }
  });

  test("help panel opens and closes", async ({ page }) => {
    await page.goto("/server");
    await page.getByRole("button", { name: "Open context-sensitive help" }).click();
    const dialog = page.getByRole("dialog", { name: "Help documentation" });
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    // The panel uses translate-x-full to hide (still in DOM), so check it's translated off-screen
    await expect(dialog).toHaveClass(/translate-x-full/);
  });

  test("DNS lookup panel opens and closes", async ({ page }) => {
    await page.goto("/server");
    await page.getByRole("button", { name: "Open DNS lookup utility" }).click();
    const dialog = page.getByRole("dialog", { name: "DNS Lookup" });
    await expect(dialog).toBeVisible();
    await expect(page.getByText("DNS LOOKUP")).toBeVisible();
    await page.keyboard.press("Escape");
    // After close, aria-hidden removes from a11y tree — use CSS locator
    const panel = page.locator('[aria-label="DNS Lookup"]');
    await expect(panel).toHaveAttribute("aria-hidden", "true");
  });

  test("bridge status shows Online", async ({ page }) => {
    await page.goto("/server");
    // The bridge status component has "BRIDGE" label below the status
    await expect(page.locator("text=Online").first()).toBeVisible({ timeout: 10000 });
  });
});
