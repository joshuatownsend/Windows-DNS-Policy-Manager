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

  test("record pagination resets to page 1 when the filter changes", async ({ page }) => {
    // 120 A records -> 3 pages of 50. Hostnames host-000..host-119 sort predictably.
    const many = Array.from({ length: 120 }, (_, i) => ({
      HostName: `host-${String(i).padStart(3, "0")}`,
      RecordType: "A",
      RecordData: { IPv4Address: `10.0.${Math.floor(i / 250)}.${i % 250}` },
      TimeToLive: "01:00:00",
    }));
    await page.route(/\/api\/zones\/[^/]+\/records/, (route) =>
      route.fulfill({ json: { success: true, records: many } })
    );

    await page.goto("/zones");
    await page.locator("button", { hasText: "contoso.com" }).first().click();
    await expect(page.getByText("Page 1 of 3")).toBeVisible({ timeout: 10000 });

    await page.getByRole("button", { name: "Next" }).click();
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByText("Page 3 of 3")).toBeVisible();

    // Narrow to host-0* (100 records, 2 pages). Without the reset the view would stay on page 3.
    await page.getByPlaceholder("Search records... (* glob, /regex/)").fill("host-0*");
    await expect(page.getByText("Page 1 of 2")).toBeVisible();
  });
});
