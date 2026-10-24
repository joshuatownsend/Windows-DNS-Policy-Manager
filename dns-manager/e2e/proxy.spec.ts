import { test, expect } from "@playwright/test";

// Issue #138: the browser talks only to the app's own /api route, which adds the bridge
// token server-side. These tests hit that route directly.
test.describe("Bridge proxy", () => {
  test("forwards same-origin requests with the bridge token", async ({ request }) => {
    // The mock bridge answers 401 unless the proxy attached the token.
    const res = await request.get("/api/zones");
    expect(res.status()).toBe(200);
    expect((await res.json()).success).toBe(true);
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
