import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, expect, test, type Page, type BrowserContext } from "@playwright/test";
import { syncStateSchema } from "../../src/domain/sync";
import { parseWorkspaceSnapshot } from "../../src/domain/workspace";
import { parseHistoryEntry } from "../../src/persistence/writing-history";
import { manuscriptEditor } from "../e2e/ai-edit-helpers";
const projectId = "10000000-0000-4000-8000-000000000001";
const origin = "http://127.0.0.1:3108";
const headers = { Origin: origin, "Content-Type": "application/json", "X-Novel-Sync": "1" };
async function login(context: BrowserContext, account: string) { expect((await context.request.post(`${origin}/__test/session`, { data: { account } })).ok()).toBe(true); }
async function openPanel(page: Page) { await page.getByRole("button", { name: "ファイルとバックアップ", exact: true }).click(); return page.getByRole("region", { name: "端末同期", exact: true }); }
async function save(page: Page, text: string) {
  await manuscriptEditor(page).fill(text); await page.getByRole("button", { name: "保存", exact: true }).click(); await expect(page.getByText("保存済み", { exact: true })).toBeVisible();
}
async function records(page: Page, storeName: string): Promise<unknown[]> {
  return page.evaluate(async (storeName) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const req = indexedDB.open("novel-ai-editor"); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(new Error("database")); });
    try { return await new Promise<unknown[]>((resolve, reject) => { const request = db.transaction(storeName).objectStore(storeName).getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(new Error("records")); }); }
    finally { db.close(); }
  }, storeName);
}

test("C-01/03/04/05/08: two persistent profiles survive lost ack, offline restart, reauthentication and conflicting edits", async () => {
  test.setTimeout(120_000);
  const root = await mkdtemp(join(tmpdir(), "novel-two-device-"));
  let a = await chromium.launchPersistentContext(join(root, "a"), { viewport: { width: 1440, height: 900 } });
  let b = await chromium.launchPersistentContext(join(root, "b"), { viewport: { width: 390, height: 844 }, hasTouch: true });
  try {
    await login(a, "owner"); await login(b, "expired");
    const pageA = a.pages()[0]!, pageB = b.pages()[0]!;
    await pageA.goto(origin); await pageB.goto(origin);
    await save(pageA, "端末Aで書いた原稿。😀"); const panelA = await openPanel(pageA);
    await expect(panelA.getByRole("checkbox")).not.toBeChecked();
    await panelA.getByRole("checkbox").check(); await panelA.getByRole("button", { name: "保存して送信待ちを準備" }).click();
    const before = syncStateSchema.parse((await records(pageA, "workspace-sync"))[0]); expect(before.pending).not.toBeNull();
    await a.request.post(`${origin}/__test/drop-response`);
    await panelA.getByRole("button", { name: "送信待ちを送る・再送" }).click();
    await expect(panelA.getByText(/同期先へ接続できません/u)).toBeVisible();
    await pageA.reload(); await openPanel(pageA);
    expect(syncStateSchema.parse((await records(pageA, "workspace-sync"))[0]).pending?.operationId).toBe(before.pending?.operationId);
    await panelA.getByRole("button", { name: "送信待ちを送る・再送" }).click();
    await expect(panelA.getByText(/前回の送信完了（改訂 1）/u)).toBeVisible();
    const remote = await a.request.get(`${origin}/api/sync?project=${projectId}`, { headers }); expect((await remote.json()).revision).toBe(1);
    await save(pageB, "端末Bのオフライン原稿。"); const panelB = await openPanel(pageB);
    await panelB.getByRole("checkbox").check(); await b.setOffline(true);
    await panelB.getByRole("button", { name: "保存して送信待ちを準備" }).click();
    await expect(panelB.getByRole("button", { name: "送信待ちを送る・再送" })).toBeDisabled();
    const waiting = syncStateSchema.parse((await records(pageB, "workspace-sync"))[0]);
    await b.close(); b = await chromium.launchPersistentContext(join(root, "b"), { viewport: { width: 390, height: 844 }, hasTouch: true });
    const returned = b.pages()[0]!; await returned.goto(origin); await openPanel(returned); const returnedPanel = returned.getByRole("region", { name: "端末同期", exact: true });
    expect(syncStateSchema.parse((await records(returned, "workspace-sync"))[0]).pending?.operationId).toBe(waiting.pending?.operationId);
    await returnedPanel.getByRole("button", { name: "送信待ちを送る・再送" }).click(); await expect(returnedPanel.getByText(/認証が失効/u)).toBeVisible();
    await returned.getByRole("button", { name: "サイドパネルを閉じる" }).click(); await save(returned, "端末Bの送信待ち後に追加した原稿。😀"); await openPanel(returned);
    await login(b, "owner"); await returnedPanel.getByRole("button", { name: "送信待ちを送る・再送" }).click();
    await expect(returnedPanel.getByText(/同期競合：/u)).toBeVisible();
    const conflict = syncStateSchema.parse((await records(returned, "workspace-sync"))[0]);
    expect(conflict.copies.map((copy) => copy.source)).toEqual(["local-conflict", "remote-conflict"]);
    await expect(manuscriptEditor(returned)).toHaveText("端末Bの送信待ち後に追加した原稿。😀");
    await returnedPanel.getByRole("button", { name: "コピーを残して端末版で競合を解決" }).click();
    await returnedPanel.getByRole("button", { name: "保存して送信待ちを準備" }).click(); await returnedPanel.getByRole("button", { name: "送信待ちを送る・再送" }).click();
    await expect(returnedPanel.getByText(/前回の送信完了（改訂 2）/u)).toBeVisible();
    await panelA.getByRole("button", { name: "同期先の原稿を受信" }).click();
    await panelA.getByRole("button", { name: "内容を確認", exact: true }).click();
    await panelA.getByRole("button", { name: "この原稿と履歴をコピーとして復元" }).click();
    await expect(panelA.getByText(/1作品をコピーとして復元/u)).toBeVisible();
    const copies = (await records(pageA, "workspace-files")).map(parseWorkspaceSnapshot); expect(copies).toHaveLength(1);
    const copy = copies[0]!; expect(copy.project.id).not.toBe(projectId); expect(copy.project.storyMemory.characterNotes).toBe("葵は静かに話す。"); expect(copy.project.authoringProfile.characters.length).toBeGreaterThan(0);
    expect((await records(pageA, "workspace-history")).map(parseHistoryEntry).some((entry) => entry.projectId === copy.project.id && entry.label === "端末移行前")).toBe(true);
    await expect(manuscriptEditor(pageA)).toHaveText("端末Aで書いた原稿。😀");
    await pageA.getByRole("button", { name: "サイドパネルを閉じる" }).click();
    await pageA.getByRole("combobox", { name: "保存済み作品を開く" }).selectOption(copy.project.id);
    await expect(manuscriptEditor(pageA)).toHaveText("端末Bの送信待ち後に追加した原稿。😀");
    await a.close(); a = await chromium.launchPersistentContext(join(root, "a"));
    const reopened = a.pages()[0]!; await reopened.goto(origin); await expect(manuscriptEditor(reopened)).toHaveText("端末Bの送信待ち後に追加した原稿。😀");
    await login(a, "other"); expect((await a.request.get(`${origin}/api/sync?project=${projectId}`, { headers })).status()).toBe(404);
  } finally { await a.close(); await b.close(); await rm(root, { recursive: true, force: true }); }
});

test("C-02/06: refuses cross-origin requests and keeps copies after local deletion", async ({ page, context }) => {
  await login(context, "owner"); await page.goto(origin); await save(page, "削除・復元の確認。");
  const panel = await openPanel(page); await panel.getByRole("checkbox").check(); await panel.getByRole("button", { name: "保存して送信待ちを準備" }).click();
  const state = syncStateSchema.parse((await records(page, "workspace-sync"))[0]);
  const blocked = await context.request.post(`${origin}/api/sync`, { headers: { ...headers, Origin: "https://attacker.example" }, data: state.pending }); expect(blocked.status()).toBe(403);
  await page.getByRole("button", { name: "サイドパネルを閉じる" }).click(); await page.getByRole("button", { name: "設定とバックアップ", exact: true }).click();
  page.once("dialog", (dialog) => dialog.accept()); await page.getByRole("button", { name: "ローカルデータを削除", exact: true }).click();
  await expect(page.getByText(/ローカルデータを削除しました/u)).toBeVisible();
  expect(syncStateSchema.parse((await records(page, "workspace-sync"))[0]).pending).toEqual(state.pending);
  await page.getByRole("button", { name: "ごみ箱・削除の復元" }).click();
  page.once("dialog", (dialog) => dialog.accept()); await page.getByRole("button", { name: "作品：星明かりの物語を復元", exact: true }).click();
  await expect(manuscriptEditor(page)).toHaveText("削除・復元の確認。");
});
