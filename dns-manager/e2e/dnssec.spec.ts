import { test, expect } from "@playwright/test";

test.describe("DNSSEC Tab", () => {
  test("page renders", async ({ page }) => {
    await page.goto("/dnssec");
    await expect(page.locator("text=DNSSEC Management").first()).toBeVisible();
  });

  test("zone list renders", async ({ page }) => {
    await page.goto("/dnssec");
    await expect(page.locator("text=contoso.com").first()).toBeVisible({ timeout: 10000 });
  });
});
