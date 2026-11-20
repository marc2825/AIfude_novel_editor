"use client";

import { forwardRef, useImperativeHandle, useRef, useState, type FormEvent } from "react";

import { workspaceSettingsInputSchema } from "../../domain/workspace";
import type {
  AiModelPreference,
  WorkspaceSettingsInput,
  WorkspaceSnapshot,
} from "../../domain/workspace";
import { AiConsentDisclosure } from "../ai-edit/AiConsentDisclosure";
import { ChatGptConnectionPanel } from "../ai-edit/ChatGptConnectionPanel";
import { AiEditErrorBoundary } from "../ai-edit/AiEditErrorBoundary";
import type { ChatGptConnectionController } from "../ai-edit/use-chatgpt-connection";
import type { PublicAiRuntime } from "../ai-edit/consent";
import {
  createJsonWorkspaceDownload,
  createTextWorkspaceDownload,
  downloadWorkspaceFile,
  readWorkspaceBackup,
  workspaceBackupErrorMessage,
} from "./backup";
import type { WorkspaceActionResult } from "./use-workspace";
import { AiModelSettings } from "./AiModelSettings";
import styles from "./Workspace.module.css";
import { isPaidApiProvider } from "../../domain/ai-models";
import { HelpHeading } from "../ui/HelpTip";

export type WorkspaceSettingsHandle = Readonly<{ save: () => Promise<WorkspaceActionResult> }>;

type WorkspaceSettingsProps = Readonly<{
  embedded?: boolean;
  confirmExport?: () => boolean;
  onDirtyChange?: (dirty: boolean) => void;
  onPaidApiEnabledChange?: (enabled: boolean) => void;
  chatGptConnection?: ChatGptConnectionController;
  aiRuntime: PublicAiRuntime;
  busy: boolean;
  editable: boolean;
  getCurrentSnapshot: () => WorkspaceSnapshot | null;
  onDelete: () => Promise<WorkspaceActionResult>;
  onConsentChange: (
    providerId: string | null,
  ) => Promise<WorkspaceActionResult>;
  onImport: (
    snapshot: WorkspaceSnapshot,
  ) => Promise<WorkspaceActionResult>;
  onModelPreferenceChange: (
    preference: AiModelPreference,
  ) => Promise<WorkspaceActionResult>;
  onSave: (
    input: WorkspaceSettingsInput,
  ) => Promise<WorkspaceActionResult>;
  workspace: WorkspaceSnapshot;
}>;

export const WorkspaceSettings = forwardRef<WorkspaceSettingsHandle, WorkspaceSettingsProps>(function WorkspaceSettings({
  embedded = false,
  confirmExport,
  onDirtyChange,
  onPaidApiEnabledChange,
  chatGptConnection,
  aiRuntime,
  busy,
  editable,
  getCurrentSnapshot,
  onDelete,
  onConsentChange,
  onImport,
  onModelPreferenceChange,
  onSave,
  workspace,
}: WorkspaceSettingsProps, ref) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [commonPrompt, setCommonPrompt] = useState(
    workspace.project.commonPrompt,
  );
  const [error, setError] = useState<string | null>(null);
  const [manualInstructions, setManualInstructions] = useState(
    workspace.styleProfile.manualInstructions,
  );
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [title, setTitle] = useState(workspace.project.title);
  const savingRef = useRef(false);
  const [baseline, setBaseline] = useState({ title, commonPrompt, manualInstructions });
  const dirty = title !== baseline.title || commonPrompt !== baseline.commonPrompt || manualInstructions !== baseline.manualInstructions;
  const controlsDisabled = busy || submitting;
  function changeDraft(next: { title: string; commonPrompt: string; manualInstructions: string }) {
    setTitle(next.title); setCommonPrompt(next.commonPrompt); setManualInstructions(next.manualInstructions);
    onDirtyChange?.(next.title !== baseline.title || next.commonPrompt !== baseline.commonPrompt || next.manualInstructions !== baseline.manualInstructions);
    setMessage(null);
  }

  function exportWorkspace(kind: "json" | "text") {
    setError(null);
    setMessage(null);
    if (confirmExport && !confirmExport()) { setMessage("書き出しを取り消しました。"); return; }

    try {
      const snapshot = getCurrentSnapshot();

      if (snapshot === null) {
        throw new Error("workspace is unavailable");
      }

      downloadWorkspaceFile(
        kind === "json"
          ? createJsonWorkspaceDownload(snapshot)
          : createTextWorkspaceDownload(snapshot),
      );
      setMessage(
        kind === "json"
          ? "JSONバックアップを書き出しました。"
          : "本文テキストを書き出しました。",
      );
    } catch {
      setError("書き出しに失敗しました。本文は変更されていません。");
    }
  }

  async function save(): Promise<WorkspaceActionResult> {
    if (!editable || busy || savingRef.current) return { ok: false, message: "現在は作品設定を保存できません。" };
    const parsed = workspaceSettingsInputSchema.safeParse({ title, commonPrompt, manualInstructions });
    if (!parsed.success) {
      const message = "作品名は1〜120文字、共通プロンプトは2,000文字、文体設定は1,000文字以内にしてください。";
      setError(message); return { ok: false, message };
    }
    setError(null); setMessage(null); savingRef.current = true; setSubmitting(true);
    try {
      const result = await onSave(parsed.data);
      if (result.ok) {
        setBaseline({ title: parsed.data.title, commonPrompt: parsed.data.commonPrompt, manualInstructions: parsed.data.manualInstructions });
        onDirtyChange?.(false); setMessage("設定を保存しました。");
      } else setError(result.message ?? "設定を保存できませんでした。入力内容は保持されています。");
      return result;
    } catch {
      const message = "設定を保存できませんでした。入力内容は保持されています。";
      setError(message); return { ok: false, message };
    } finally { savingRef.current = false; setSubmitting(false); }
  }
  useImperativeHandle(ref, () => ({ save }));
  function saveSettings(event: FormEvent<HTMLFormElement>) { event.preventDefault(); void save(); }

  async function importBackup(file: File) {
    setError(null);
    setMessage(null);
    setSubmitting(true);

    try {
      const imported = await readWorkspaceBackup(file);
      const confirmed = window.confirm(
        "現在の作品をバックアップの内容で置き換えます。未保存の変更とUndo履歴は失われます。必要なら先に現在のJSONバックアップを書き出してください。続行しますか？",
      );

      if (!confirmed) {
        return;
      }

      const result = await onImport(imported);

      if (result.ok) {
        setMessage("バックアップを取り込みました。");
      } else {
        setError(result.message ?? "バックアップを取り込めませんでした。");
      }
    } catch (caught: unknown) {
      setError(workspaceBackupErrorMessage(caught));
    } finally {
      setSubmitting(false);

      if (fileInputRef.current !== null) {
        fileInputRef.current.value = "";
      }
    }
  }

  async function deleteLocalData() {
    setError(null);
    setMessage(null);

    if (
      !window.confirm(
        "この作品をごみ箱へ移します。本文・設定・保存履歴はごみ箱から復元できます。削除しますか？",
      )
    ) {
      return;
    }

    setSubmitting(true);

    try {
      const result = await onDelete();

      if (!result.ok) {
        setError(result.message ?? "ローカルデータを削除できませんでした。");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <details className={styles.settings} open={embedded || undefined}>
      <summary hidden={embedded}>設定とバックアップ</summary>
      <div className={styles.settingsContent}>
        <form className={styles.settingsForm} onSubmit={saveSettings}>
          <HelpHeading level={2} label="作品設定" help={<>共通プロンプトは、AI編集で参照してほしい希望を書く欄です。</>}>作品設定</HelpHeading>
          {dirty ? <p role="status">作品設定に未保存の変更があります。</p> : null}
          <label>
            作品名
            <input
              disabled={!editable || controlsDisabled}
              onChange={(event) => changeDraft({ title: event.currentTarget.value, commonPrompt, manualInstructions })}
              required
              type="text"
              value={title}
            />
            <span>1〜120文字</span>
          </label>
          <label>
            共通プロンプト
            <textarea
              disabled={!editable || controlsDisabled}
              onChange={(event) =>
                changeDraft({ title, commonPrompt: event.currentTarget.value, manualInstructions })
              }
              rows={4}
              value={commonPrompt}
            />
            <span>最大2,000文字</span>
          </label>
          <label>
            手動文体設定
            <textarea
              disabled={!editable || controlsDisabled}
              onChange={(event) =>
                changeDraft({ title, commonPrompt, manualInstructions: event.currentTarget.value })
              }
              rows={4}
              value={manualInstructions}
            />
            <span>最大1,000文字</span>
          </label>
          <button disabled={!editable || controlsDisabled} type="submit">
            設定を保存
          </button>
        </form>

        {(aiRuntime.providerId === "chatgpt" || aiRuntime.comparisonProviders?.some((provider) => provider.providerId === "chatgpt")) && chatGptConnection ? (
          <AiEditErrorBoundary><ChatGptConnectionPanel connection={chatGptConnection} disabled={!editable || controlsDisabled} /></AiEditErrorBoundary>
        ) : null}
        <AiModelSettings
          disabled={!editable || controlsDisabled}
          onChange={onModelPreferenceChange}
          preference={workspace.project.aiModelPreference}
          runtime={aiRuntime}
        />

        <section aria-labelledby="api-connection-title">
          <HelpHeading level={2} id="api-connection-title" label="API接続" help={<>有効にしても、送信先の選択と外部送信への同意が必要です。サブスクから自動で切り替わることはありません。利用するAPIのキーとモデルはサーバー側で設定します。</>}>API接続</HelpHeading>
          <label><input type="checkbox" checked={aiRuntime.paidApiEnabled === true}
            disabled={!editable || controlsDisabled || ![aiRuntime, ...(aiRuntime.comparisonProviders ?? [])].some((provider) => isPaidApiProvider(provider.providerId))}
            onChange={(event) => onPaidApiEnabledChange?.(event.currentTarget.checked)} />
            サブスクとは別料金のAPI接続を有効にする
          </label>
          <p>初期OFFです。画面を再読み込みするとOFFに戻ります。</p>
        </section>
        {[aiRuntime, ...(aiRuntime.comparisonProviders ?? [])].some((provider) => provider.providerId === "claude") ? <section aria-labelledby="claude-connection-title">
          <HelpHeading level={2} id="claude-connection-title" label="Claudeサブスク接続" help={<>このPCの公式Claude CLIへ事前にログインして使います。手順はREADMEにあります。未ログインや利用枠超過のときは失敗を表示します。サブスク枠だけで使う場合は、Claudeアカウント側の追加使用量をOFFにしてください。</>}>Claudeサブスク接続（実験的）</HelpHeading>
          <p>提供元の利用条件を確認中の実験的な機能です。</p>
        </section> : null}

        <AiConsentDisclosure
          allowRevoke
          commonPromptIncluded={workspace.project.commonPrompt.length > 0}
          consent={workspace.project.aiConsent}
          disabled={!editable || controlsDisabled}
          manualStyleIncluded={
            workspace.styleProfile.manualInstructions.length > 0
          }
          modelPreference={workspace.project.aiModelPreference}
          onChange={onConsentChange}
          runtime={aiRuntime}
        />

        <section className={styles.backup} aria-labelledby="backup-title">
          <h2 id="backup-title">書き出しと復元</h2>
          <p>バックアップには未公開の本文と設定が含まれます。</p>
          <div className={styles.buttonRow}>
            <button
              disabled={controlsDisabled}
              onClick={() => exportWorkspace("text")}
              type="button"
            >
              本文をテキストで書き出す
            </button>
            <button
              disabled={controlsDisabled}
              onClick={() => exportWorkspace("json")}
              type="button"
            >
              JSONバックアップを書き出す
            </button>
          </div>
          <label className={styles.fileInput}>
            JSONバックアップを取り込む
            <input
              accept="application/json,.json"
              disabled={!editable || controlsDisabled}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];

                if (file !== undefined) {
                  void importBackup(file);
                }
              }}
              ref={fileInputRef}
              type="file"
            />
            <span>10MiB以下のJSONファイル。確認後に現在の作品を置き換えます。</span>
          </label>
        </section>

        <section className={styles.dangerZone} aria-labelledby="delete-title">
          <h2 id="delete-title">ローカルデータ削除</h2>
          <p>本文・設定・保存履歴をごみ箱へ移します。完全削除はごみ箱から行います。</p>
          <button
            className={styles.dangerButton}
            disabled={!editable || controlsDisabled}
            onClick={() => void deleteLocalData()}
            type="button"
          >
            ローカルデータを削除
          </button>
        </section>

        {message === null ? null : (
          <p className={styles.actionMessage} role="status">
            {message}
          </p>
        )}
        {error === null ? null : (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
      </div>
    </details>
  );
});
