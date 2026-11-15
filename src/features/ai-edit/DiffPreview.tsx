"use client";

import { useEffect, useState } from "react";

import styles from "./AiEdit.module.css";
import {
  DIFF_TIMEOUT_MS,
  parseDiffWorkerResponse,
  type DiffPart,
  type DiffWorkerRequest,
} from "./diff/protocol";

type DiffPreviewProps = Readonly<{
  candidateId: string;
  candidatePosition: number;
  candidateText: string;
  originalText: string;
  requestId: string;
}>;

type DiffViewState =
  | Readonly<{
      candidateId: string;
      requestId: string;
      status: "loading";
    }>
  | Readonly<{
      candidateId: string;
      reason: "timeout" | "unavailable";
      requestId: string;
      status: "fallback";
    }>
  | Readonly<{
      candidateId: string;
      parts: readonly DiffPart[];
      requestId: string;
      status: "ready";
    }>;

function createLoadingState(
  requestId: string,
  candidateId: string,
): DiffViewState {
  return Object.freeze({ candidateId, requestId, status: "loading" });
}

function DiffParts({ parts }: Readonly<{ parts: readonly DiffPart[] }>) {
  return (
    <div className={styles.diffText} data-testid="candidate-diff-parts">
      {parts.map((part, index) => {
        const key = `${index}-${part.kind}`;

        switch (part.kind) {
          case "delete":
            return (
              <span key={key}>
                <span className={styles.visuallyHidden}>削除: </span>
                <del className={styles.diffDeletion}>{part.text}</del>
              </span>
            );
          case "insert":
            return (
              <span key={key}>
                <span className={styles.visuallyHidden}>追加: </span>
                <ins className={styles.diffInsertion}>{part.text}</ins>
              </span>
            );
          case "equal":
            return <span key={key}>{part.text}</span>;
        }
      })}
    </div>
  );
}

function SideBySideFallback({
  candidateText,
  originalText,
  reason,
}: Readonly<{
  candidateText: string;
  originalText: string;
  reason: "timeout" | "unavailable";
}>) {
  return (
    <>
      <p className={styles.diffFallbackMessage} role="status">
        {reason === "timeout"
          ? "差分計算が150ms以内に完了しなかったため、原文と候補を並べて表示します。"
          : "差分計算を完了できなかったため、原文と候補を並べて表示します。"}
      </p>
      <div className={styles.diffColumns}>
        <section aria-label="比較する原文">
          <h5>原文</h5>
          <p className={styles.diffSourceText}>{originalText}</p>
        </section>
        <section aria-label="比較する候補">
          <h5>候補</h5>
          <p className={styles.diffSourceText}>{candidateText}</p>
        </section>
      </div>
    </>
  );
}

export function DiffPreview({
  candidateId,
  candidatePosition,
  candidateText,
  originalText,
  requestId,
}: DiffPreviewProps) {
  const [state, setState] = useState<DiffViewState>(() =>
    createLoadingState(requestId, candidateId),
  );
  const stateMatchesCandidate =
    state.requestId === requestId && state.candidateId === candidateId;
  const visibleState = stateMatchesCandidate
    ? state
    : createLoadingState(requestId, candidateId);

  useEffect(() => {
    let active = true;
    let timeoutId: number | null = null;
    let worker: Worker | null = null;

    function stopWorker(): void {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
        timeoutId = null;
      }

      worker?.terminate();
      worker = null;
    }

    function showFallback(reason: "timeout" | "unavailable"): void {
      if (!active) {
        return;
      }

      active = false;
      stopWorker();
      setState(
        Object.freeze({
          candidateId,
          reason,
          requestId,
          status: "fallback",
        }),
      );
    }

    try {
      worker = new Worker(new URL("./diff/diff.worker.ts", import.meta.url), {
        type: "module",
      });
    } catch {
      showFallback("unavailable");
      return () => {
        active = false;
        stopWorker();
      };
    }

    worker.onmessage = (event: MessageEvent<unknown>) => {
      if (!active) {
        return;
      }

      const response = parseDiffWorkerResponse(
        event.data,
        requestId,
        candidateId,
      );

      if (response === null) {
        return;
      }

      if (response.type === "failed") {
        showFallback("unavailable");
        return;
      }

      active = false;
      stopWorker();
      setState(
        Object.freeze({
          candidateId,
          parts: response.parts,
          requestId,
          status: "ready",
        }),
      );
    };
    worker.onerror = () => showFallback("unavailable");
    worker.onmessageerror = () => showFallback("unavailable");
    timeoutId = window.setTimeout(
      () => showFallback("timeout"),
      DIFF_TIMEOUT_MS,
    );

    const message: DiffWorkerRequest = Object.freeze({
      candidateId,
      candidateText,
      originalText,
      requestId,
      type: "compute",
    });
    worker.postMessage(message);

    return () => {
      active = false;
      stopWorker();
    };
  }, [candidateId, candidateText, originalText, requestId]);

  return (
    <section
      aria-label={`候補 ${candidatePosition} の原文との差分`}
      className={styles.diffPreview}
    >
      <h4>原文との差分</h4>
      {visibleState.status === "loading" ? (
        <p className={styles.diffStatus} role="status">
          差分を計算しています。
        </p>
      ) : null}
      {visibleState.status === "fallback" ? (
        <SideBySideFallback
          candidateText={candidateText}
          originalText={originalText}
          reason={visibleState.reason}
        />
      ) : null}
      {visibleState.status === "ready" ? (
        <>
          <p className={styles.diffLegend}>
            <span>
              <del className={styles.diffDeletion}>削除</del>は原文から削る箇所
            </span>
            <span>
              <ins className={styles.diffInsertion}>追加</ins>は候補で加える箇所
            </span>
          </p>
          <DiffParts parts={visibleState.parts} />
        </>
      ) : null}
    </section>
  );
}
