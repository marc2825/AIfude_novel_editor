import { expect, test } from "@playwright/test";

test("shows the bootstrap page", async ({ page }) => {
  const response = await page.goto("/");

  expect(response).not.toBeNull();
  const headers = response?.headers() ?? {};
  expect(headers["content-security-policy"]).toContain("object-src 'none'");
  expect(headers["content-security-policy"]).toContain("base-uri 'self'");
  expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(headers["content-security-policy"]).not.toContain("'unsafe-eval'");
  expect(headers["permissions-policy"]).toBe(
    "camera=(), geolocation=(), microphone=()",
  );
  expect(headers["referrer-policy"]).toBe("no-referrer");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["x-frame-options"]).toBe("DENY");

  await expect(page).toHaveTitle("AIFUDE");
  await expect(
    page.getByRole("heading", { name: "AIFUDE" }),
  ).toBeVisible();
  await expect(page.getByText("保存済み", { exact: true })).toBeVisible();
  await expect(page.getByLabel("AI実行環境")).toHaveText(
    "AI：ローカルデモ候補（デモ候補・外部送信なし）",
  );
});
