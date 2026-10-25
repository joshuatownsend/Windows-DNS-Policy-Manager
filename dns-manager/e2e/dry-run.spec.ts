import { test, expect } from "@playwright/test";

// Issue #146: Dry Run (the default) must stop every DNS change in the API client, not rely
// on each page remembering to check the mode.
test.describe("Dry Run", () => {
  test("a mutation in Dry Run never reaches the bridge", async ({ page }) => {
    let posted = 0;
    await page.route("**/api/policies", async (route) => {
      if (route.request().method() === "POST") posted++;
      await route.fallback();
    });

    await page.goto("/backup");
    await expect(page.getByText("Dry Run", { exact: true }).first()).toBeVisible();
    await page.locator('input[type="file"][accept*="json"]').setInputFiles({
      name: "backup.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({ policies: [{ Name: "P1", Action: "DENY", criteria: [{ type: "Fqdn", operator: "EQ", values: ["*.ads.example"] }] }] })),
    });
    await page.getByRole("button", { name: /Import All \(1\)/ }).click();

    await expect(page.getByText(/Dry Run is on/).first()).toBeVisible();
    expect(posted).toBe(0);

    // Client-side navigation: the PowerShell log is in memory and a reload would clear it.
    await page.locator('a[href="/powershell"]').first().click();
    await expect(page.getByText(/Dry Run — not sent: POST \/api\/policies/).first()).toBeVisible();
  });

  test("reads still work in Dry Run", async ({ page }) => {
    await page.goto("/zones");
    await expect(page.locator("text=contoso").first()).toBeVisible({ timeout: 15000 });
  });
});
