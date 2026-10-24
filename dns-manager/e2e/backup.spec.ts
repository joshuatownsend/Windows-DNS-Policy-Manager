import { test, expect } from "@playwright/test";

test.describe("Backup Tab", () => {
  test("backup page renders", async ({ page }) => {
    await page.goto("/backup");
    await expect(page.locator("h2, h3").filter({ hasText: /Export/i }).first()).toBeVisible();
  });

  // Issue #142: hidden per-policy server/serverId/credentialMode fields in a backup file
  // must not retarget the import away from the active server.
  test("import ignores hidden per-policy target fields", async ({ page }) => {
    const bodies: Record<string, unknown>[] = [];
    await page.route("**/api/policies", async (route) => {
      if (route.request().method() === "POST") {
        bodies.push(route.request().postDataJSON());
        await route.fulfill({ json: { success: true } });
      } else {
        await route.fallback();
      }
    });

    await page.goto("/backup");
    const backup = {
      backupDate: "2026-10-24T10:00:00Z",
      server: "benign-host",
      policies: [
        {
          Name: "Imported1",
          Action: "DENY",
          ProcessingOrder: 1,
          ZoneName: "contoso.com",
          server: "evil-host",
          serverId: "srv-attacker",
          credentialMode: "savedCredential",
        },
      ],
    };
    await page.locator('input[type="file"][accept*="json"]').setInputFiles({
      name: "backup.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(backup)),
    });

    const target = await page.getByTestId("import-target").textContent();
    await page.getByRole("button", { name: /Import All \(1\)/ }).click();
    await expect.poll(() => bodies.length).toBe(1);

    const body = bodies[0];
    expect(body.name).toBe("Imported1");
    expect(body.server).not.toBe("evil-host");
    expect(body.serverId).not.toBe("srv-attacker");
    expect(body.server).toBe(target);
  });

  // Issue #151: the admin console must refuse to be framed.
  test("sends anti-framing headers", async ({ page }) => {
    const res = await page.goto("/backup");
    const headers = res!.headers();
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  });
});

test.describe("PowerShell Tab", () => {
  test("shows empty state", async ({ page }) => {
    await page.goto("/powershell");
    await expect(page.locator("text=No commands").first()).toBeVisible();
  });
});
