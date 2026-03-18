import { test, expect } from "@playwright/test";

test.describe("Wizards Tab", () => {
  test("scenario grid shows wizards", async ({ page }) => {
    await page.goto("/wizards");
    await expect(page.locator("text=Geo-Location Routing").first()).toBeVisible();
    await expect(page.locator("text=Split-Brain DNS").first()).toBeVisible();
    await expect(page.locator("text=Domain Blocklist").first()).toBeVisible();
  });

  test("starting a wizard shows step progress", async ({ page }) => {
    await page.goto("/wizards");
    await page.locator("text=Geo-Location Routing").first().click();
    await expect(page.locator("text=Step 1 of 4").first()).toBeVisible();
  });

  test("cancel returns to grid", async ({ page }) => {
    await page.goto("/wizards");
    await page.locator("text=Domain Blocklist").first().click();
    await expect(page.locator("text=Step 1 of 3").first()).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.locator("text=Scenario Wizards").first()).toBeVisible();
  });
});
