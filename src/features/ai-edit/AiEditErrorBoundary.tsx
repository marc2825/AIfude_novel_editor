"use client";

import { Component, Fragment, type ReactNode } from "react";

import styles from "./AiEdit.module.css";

type AiEditErrorBoundaryProps = Readonly<{
  children: ReactNode;
}>;

type AiEditErrorBoundaryState = Readonly<{
  failed: boolean;
  recoveryKey: number;
}>;

const INITIAL_STATE: AiEditErrorBoundaryState = Object.freeze({
  failed: false,
  recoveryKey: 0,
});

export class AiEditErrorBoundary extends Component<
  AiEditErrorBoundaryProps,
  AiEditErrorBoundaryState
> {
  state: AiEditErrorBoundaryState = INITIAL_STATE;

  static getDerivedStateFromError(): Partial<AiEditErrorBoundaryState> {
    return { failed: true };
  }

  private recover = () => {
    this.setState((state) => ({
      failed: false,
      recoveryKey: state.recoveryKey + 1,
    }));
  };

  render() {
    if (this.state.failed) {
      return (
        <section
          aria-labelledby="ai-edit-render-error-title"
          className={styles.errorBoundary}
          role="alert"
        >
          <h2 id="ai-edit-render-error-title">AI編集を表示できませんでした</h2>
          <p>本文の編集と保存は、このまま継続できます。</p>
          <button onClick={this.recover} type="button">
            AI編集を再開
          </button>
        </section>
      );
    }

    return (
      <Fragment key={this.state.recoveryKey}>
        {this.props.children}
      </Fragment>
    );
  }
}
