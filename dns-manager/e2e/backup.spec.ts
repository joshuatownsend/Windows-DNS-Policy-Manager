import { test, expect } from "@playwright/test";

test.describe("Backup Tab", () => {
  test("backup page renders", async ({ page }) => {
    await page.goto("/backup");
    await expect(page.locator("h2, h3").filter({ hasText: /Export/i }).first()).toBeVisible();
  });
});

test.describe("PowerShell Tab", () => {
  test("shows empty state", async ({ page }) => {
    await page.goto("/powershell");
    await expect(page.locator("text=No commands").first()).toBeVisible();
  });
});
