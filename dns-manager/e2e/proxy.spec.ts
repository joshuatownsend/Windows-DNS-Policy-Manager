import { test, expect } from "@playwright/test";
import { writeFileSync } from "node:fs";

/** What Start-DNSPolicyManager.ps1 does: write a fresh one-time code and return the link. */
function launcherLink(): string {
  const code = "c".repeat(20) + Date.now().toString(36).padStart(20, "0");
  writeFileSync(process.env.SIGNIN_CODE_FILE!, code);
  return `/auth?code=${code}`;
}

// Issue #138: the browser talks only to the app's own /api route, which adds the bridge
// token server-side. These tests hit that route directly.
test.describe("Bridge proxy", () => {
  test("forwards same-origin requests with the bridge token", async ({ request }) => {
    // The mock bridge answers 401 unless the proxy attached the token.
    const res = await request.get("/api/zones");
    expect(res.status()).toBe(200);
    expect((await res.json()).success).toBe(true);
  });

  test("a same-origin browser POST passes the Origin check", async ({ page }) => {
    // Browsers attach Origin to POST fetches; with Referrer-Policy no-referrer it would be "null".
    await page.goto("/server");
    const status = await page.evaluate(async () => {
      const res = await fetch("/api/policies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "e2e", action: "DENY" }),
      });
      return res.status;
    });
    expect(status).toBe(200);
  });

  test("refuses a cross-origin caller", async ({ request }) => {
    const res = await request.post("/api/policies", {
      headers: { Origin: "https://evil.example", "Content-Type": "application/json" },
      data: { name: "x", action: "DENY" },
    });
    expect(res.status()).toBe(403);
  });

  test("refuses cross-site fetch metadata", async ({ request }) => {
    const res = await request.get("/api/zones", { headers: { "Sec-Fetch-Site": "cross-site" } });
    expect(res.status()).toBe(403);
  });

  test("refuses non-JSON bodies (no CORS preflight)", async ({ request }) => {
    const res = await request.post("/api/policies", {
      headers: { "Content-Type": "text/plain" },
      data: '{"name":"x","action":"DENY"}',
    });
    expect(res.status()).toBe(415);
  });

  test("the page never calls the bridge port directly", async ({ page }) => {
    const direct: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes(":8650")) direct.push(r.url());
    });
    await page.goto("/zones");
    await expect(page.locator("text=contoso").first()).toBeVisible({ timeout: 15000 });
    expect(direct).toEqual([]);
  });
});

test.describe("Sign-in", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("the proxy refuses callers without a session", async ({ request }) => {
    const res = await request.get("/api/zones");
    expect(res.status()).toBe(401);
    expect((await res.json()).authRequired).toBe(true);
  });

  test("health stays available before sign-in", async ({ request }) => {
    expect((await request.get("/api/health")).status()).toBe(200);
  });

  test("the bridge token is never accepted in a URL", async ({ page }) => {
    await page.goto("/auth?token=e2e-bridge-token");
    await expect(page).toHaveURL(/\/login\?error=expired/);
    await expect(page.getByTestId("login-error")).toBeVisible();
  });

  test("a launcher link works once", async ({ page, browser }) => {
    const link = launcherLink();
    await page.goto(link);
    await expect(page).toHaveURL(/\/server$/);
    const second = await browser.newPage({ storageState: { cookies: [], origins: [] } });
    await second.goto(link);
    await expect(second).toHaveURL(/\/login\?error=expired/);
    await second.close();
  });

  test("the launcher link signs in and the app loads data", async ({ page }) => {
    await page.goto(launcherLink());
    await expect(page).toHaveURL(/\/server$/);
    const cookies = await page.context().cookies();
    const session = cookies.find((c) => c.name === "dpm_session");
    expect(session?.httpOnly).toBe(true);
    expect(session?.value).not.toContain("e2e-bridge-token");
    const res = await page.request.get("/api/zones");
    expect(res.status()).toBe(200);
  });

  test("the login form signs in", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Bridge token").fill("e2e-bridge-token");
    const [response] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith("/auth") && r.request().method() === "POST"),
      page.getByRole("button", { name: "Sign in" }).click(),
    ]);
    expect(response.status()).toBe(303);
    await expect(page).toHaveURL(/\/server$/);
  });

  test("an unauthenticated page is sent to sign in", async ({ page }) => {
    await page.goto("/zones");
    await expect(page).toHaveURL(/\/login/, { timeout: 15000 });
  });
});
