import { test, expect } from "@playwright/test";

test.describe("Zones Tab", () => {
  test("zone list loads", async ({ page }) => {
    await page.goto("/zones");
    await expect(page.locator("text=contoso.com").first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator("text=fabrikam.com").first()).toBeVisible();
  });

  test("clicking a zone loads records", async ({ page }) => {
    await page.goto("/zones");
    await page.locator("button", { hasText: "contoso.com" }).first().click();
    await expect(page.locator("text=192.168.1.10").first()).toBeVisible({ timeout: 10000 });
  });

  test("create zone button opens dialog", async ({ page }) => {
    await page.goto("/zones");
    await page.getByRole("button", { name: "Create" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
  });
});
