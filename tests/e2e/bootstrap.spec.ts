import { expect, test } from "@playwright/test";

test("shows the bootstrap page", async ({ page }) => {
  const cspErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && /eval\(\) is not supported|unsafe-eval|Refused to evaluate/u.test(message.text())) {
      cspErrors.push(message.text());
    }
  });
  const response = await page.goto("/");

  expect(response).not.toBeNull();
  const headers = response?.headers() ?? {};
  expect(headers["content-security-policy"]).toContain("object-src 'none'");
  expect(headers["content-security-policy"]).toContain("base-uri 'self'");
  expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  // This suite runs next dev; production is covered by the PWA suite.
  expect(headers["content-security-policy"]).toContain("'unsafe-eval'");
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
  expect(cspErrors).toEqual([]);
});
