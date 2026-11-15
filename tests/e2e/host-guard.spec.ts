import { expect, test } from "@playwright/test";

test("Host rejection covers framework routes, static assets, and APIs", async ({ request, page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "AIFUDE", exact: true })).toBeVisible();
  const script = await page.locator('script[src^="/_next/static/"]').first().getAttribute("src");
  expect(script).toBeTruthy();
  for (const path of ["/", "/api/health", "/_next/image?url=/icons/icon-192.png&w=64&q=75", "/sw.js", script ?? "/_next/static/app.js"]) {
    const response = await request.get(path, {
      headers: { host: "rebinding.invalid:3100", "x-forwarded-host": "127.0.0.1:3100" },
    });
    expect(response.status(), path).toBe(403);
  }
  expect((await request.get("/api/health")).status()).toBe(200);
  expect((await request.get("/icons/icon-192.png")).status()).toBe(200);
});
