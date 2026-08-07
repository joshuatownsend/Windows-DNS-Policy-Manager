import { test, expect, type Page } from "@playwright/test";

// The Resolvers tab only fetches when a server is marked "online", and that
// transition happens only on the Server tab. Seed the persisted Zustand store
// directly so this spec does not depend on another tab's flow.
const ONLINE_SERVER = {
  id: "e2e-resolvers-server",
  name: "localhost",
  hostname: "localhost",
  credentialMode: "currentUser",
  hasCredential: false,
  status: "online",
  lastChecked: null,
  serverInfo: null,
  zoneCount: 2,
};

async function seedOnlineServer(page: Page) {
  await page.addInitScript((server) => {
    window.localStorage.setItem(
      "dns-policy-manager",
      JSON.stringify({
        state: {
          servers: [server],
          activeServerId: server.id,
          executionMode: "generate",
        },
        version: 0,
      })
    );
  }, ONLINE_SERVER);
}

// Mermaid renders into an <svg id="resolver-diagram">. The page polls the
// bridge on a 2s interval before the first render, hence the generous timeout.
const diagram = (page: Page) => page.locator("svg#resolver-diagram");

async function gotoDiagram(page: Page) {
  await page.goto("/resolvers");
  await expect(diagram(page)).toBeVisible({ timeout: 20000 });
}

test.describe("Resolvers Tab", () => {
  test.beforeEach(async ({ page }) => {
    await seedOnlineServer(page);
  });

  test("page renders", async ({ page }) => {
    await page.goto("/resolvers");
    await expect(page.locator("text=DNS Topology").first()).toBeVisible({ timeout: 20000 });
  });

  test("topology diagram renders with managed and external nodes", async ({ page }) => {
    await gotoDiagram(page);

    // fixtures/resolvers.json yields 1 managed server + 4 external resolvers,
    // grouped into the "upstream" and "servers" subgraphs.
    await expect(diagram(page).locator(".node")).toHaveCount(5);
    await expect(diagram(page).locator(".cluster")).toHaveCount(2);

    const svg = diagram(page);
    await expect(svg).toContainText("localhost");
    await expect(svg).toContainText("8.8.8.8");
    await expect(svg).toContainText("9.9.9.9");
  });

  test("known resolver addresses are labelled with their provider", async ({ page }) => {
    await gotoDiagram(page);

    // KNOWN_RESOLVERS maps addresses to friendly names in the node label.
    await expect(diagram(page)).toContainText("Google DNS");
    await expect(diagram(page)).toContainText("Cloudflare");
    await expect(diagram(page)).toContainText("Quad9");
  });

  test("edges cover IP stack, forwarder, and agreement cases", async ({ page }) => {
    await gotoDiagram(page);

    // 8.8.8.8 via IP stack only, 9.9.9.9 via forwarder only, 1.1.1.1 via both
    // (deduped into one "IP Stack + Forwarder" edge), 2606:...:1111 via IP stack.
    await expect(diagram(page).locator(".flowchart-link")).toHaveCount(4);
    await expect(diagram(page)).toContainText("IP Stack");
    await expect(diagram(page)).toContainText("Forwarder");
  });

  test("address family filter narrows the diagram", async ({ page }) => {
    await gotoDiagram(page);
    await expect(diagram(page).locator(".node")).toHaveCount(5);

    // IPv4 drops the IPv6-only upstream (2606:4700:4700::1111).
    await page.getByRole("button", { name: "IPv4", exact: true }).click();
    await expect(diagram(page).locator(".node")).toHaveCount(4);
    await expect(diagram(page)).not.toContainText("2606:4700:4700::1111");

    // IPv6 keeps only that upstream: the v4 interface addresses and both
    // forwarders (1.1.1.1, 9.9.9.9) are filtered out.
    await page.getByRole("button", { name: "IPv6", exact: true }).click();
    await expect(diagram(page).locator(".node")).toHaveCount(2);
    await expect(diagram(page)).toContainText("2606:4700:4700::1111");
    await expect(diagram(page)).not.toContainText("8.8.8.8");

    await page.getByRole("button", { name: "All", exact: true }).click();
    await expect(diagram(page).locator(".node")).toHaveCount(5);
  });

  test("rendered SVG is sanitized", async ({ page }) => {
    await gotoDiagram(page);

    // sanitizeSvg() strips <script> elements and on* handlers before the SVG
    // is inserted with insertAdjacentHTML.
    await expect(diagram(page).locator("script")).toHaveCount(0);
    const handlers = await diagram(page).evaluate((svg) =>
      [...svg.querySelectorAll("*")].some((el) =>
        [...el.attributes].some((a) => a.name.startsWith("on"))
      )
    );
    expect(handlers).toBe(false);
  });
});
