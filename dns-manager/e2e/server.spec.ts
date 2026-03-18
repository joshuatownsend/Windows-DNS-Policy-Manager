import { test, expect } from "@playwright/test";

test.describe("Server Tab", () => {
  test("shows default localhost server", async ({ page }) => {
    await page.goto("/server");
    await expect(page.locator(".cursor-pointer").filter({ hasText: "localhost" }).first()).toBeVisible();
  });

  test("add server dialog opens", async ({ page }) => {
    await page.goto("/server");
    const addBtn = page.getByRole("button", { name: "Add Server" }).first();
    await addBtn.waitFor({ state: "visible" });
    await addBtn.click();
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5000 });
  });

  test("test connection shows zones", async ({ page }) => {
    await page.goto("/server");
    await page.getByTitle("Test connection").first().click();
    await expect(page.locator("text=contoso.com").first()).toBeVisible({ timeout: 10000 });
  });
});
