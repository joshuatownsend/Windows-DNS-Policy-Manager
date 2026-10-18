import { test, expect } from "@playwright/test";

// Regression coverage for issue #115: the DNS Objects tab crashed with
// "scope.Forwarder?.join is not a function" when the bridge returned a
// non-array Forwarder, and logged nested-<button> hydration errors from the
// collapsible section headers. The mock bridge (start-test.mjs) serves the
// legacy raw shapes for subnets and recursion scopes.
test.describe("DNS Objects Tab", () => {
  test("renders bridge list fields that are not plain arrays", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.goto("/objects");

    const recursionRow = (name: string) => page.locator("tr", { hasText: name });
    await expect(recursionRow("SingleForwarder")).toContainText("10.0.0.1", { timeout: 15000 });
    await expect(recursionRow("WrappedForwarders")).toContainText("10.0.0.2, 10.0.0.3");
    await expect(page.locator("tr", { hasText: "BranchOffice" })).toContainText("10.1.0.0/16");

    expect(pageErrors).toEqual([]);
  });

  test("section headers do not nest buttons", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    await page.goto("/objects");
    await expect(page.locator("text=Recursion Scopes").first()).toBeVisible({ timeout: 15000 });

    await expect(page.locator("button button")).toHaveCount(0);
    expect(consoleErrors.filter((t) => /descendant of <button>|nested <button>/.test(t))).toEqual([]);
  });

  test("collapsible header still toggles its section", async ({ page }) => {
    await page.goto("/objects");
    const trigger = page.getByRole("button", { name: /Recursion Scopes/ });
    await expect(page.locator("tr", { hasText: "SingleForwarder" })).toBeVisible({ timeout: 15000 });

    await trigger.click();
    await expect(page.locator("tr", { hasText: "SingleForwarder" })).toBeHidden();

    await trigger.click();
    await expect(page.locator("tr", { hasText: "SingleForwarder" })).toBeVisible();
  });
});
