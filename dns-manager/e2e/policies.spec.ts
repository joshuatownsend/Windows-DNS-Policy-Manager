import { test, expect } from "@playwright/test";

test.describe("Policies Tab", () => {
  test("policy list renders", async ({ page }) => {
    await page.goto("/policies");
    await expect(page.locator("text=GeoNorthAmericaPolicy").first()).toBeVisible({ timeout: 10000 });
  });
});

test.describe("Create Policy Tab", () => {
  test("policy type cards render", async ({ page }) => {
    await page.goto("/create");
    await expect(page.locator("text=Query Resolution").first()).toBeVisible();
  });

  test("generate powershell produces command", async ({ page }) => {
    await page.goto("/create");
    // The Policy Name input — find by placeholder or nearby label
    await page.locator("input[placeholder='MyPolicy']").fill("TestPolicy");
    await page.getByRole("button", { name: "Generate PowerShell" }).click();
    await expect(page.locator("text=Add-DnsServer").first()).toBeVisible();
  });
});
