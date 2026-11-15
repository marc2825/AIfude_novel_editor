# Phase 3: 構造化執筆設定と部分採用

2026-10-27。ユーザーのPhase 3依頼に基づく設計。workspaceをv5へ進め、PM schemaとDB store構成は変えない。

Project.authoringProfileに人物（一人称/二人称/呼称/口調/例/避ける表現）、語彙表記、作品資料（設定・関係・出来事・章要約）、文体観測と名前付きプリセットを保存する。項目ID/revision/updatedAtと任意の出典章/content revisionを持つ。既存3欄メモは保持する。章が消えた出典は履歴情報として残し、現在の根拠として断定しない。コピー復元は出典IDも同じ対応表で再発行する。

v1〜v4のstrict検証・参照整合性を通してから空profileを補う純粋migration。読込では元recordへ書かず、通常のCAS/原子的保存でv5へ再保存する。future versionはfail-closed。旧アプリへdowngradeして新データを上書きしない。復旧は旧backupの別コピー。旧snapshot・全作品backup・履歴・ごみ箱のround-tripを検証する。

人物・資料・観測文体は生成ごとの明示選択、初期OFF。送信内容をプレビューし、既存の未信頼storyMemory欄へ構造化JSONとして合成する。各2,000文字/全体の既存入力予算を維持し、超過を黙って切り詰めない。プリセットは作者の明示操作で指示欄へ読み込む。作品本文/資料から制御指示を自動生成しない。

文字列保持を必須指定した場合は、指定文字列の出現回数を合成後の置換文字列で検証し、変われば採用拒否。この保証は字面の出現回数に限る。人物/固有名詞/人称/数値の変化は観測警告、出来事・意味・視点・設定の維持は作者の確認とLLMへの要求であり機械保証ではない。

部分採用はimmutable候補と元snapshotだけからgrapheme差分hunkを計算する。逆方向の差分で位置割当が異なる曖昧な差分、過大な差分は部分採用不可。hunk番号集合はcontrollerのpreview stateに保持し、候補切替/再生成でreset。キーボード採用も同じ選択を使う。Acceptで現在候補から完成した置換文字列を合成し、既存同期guard・1 transaction・範囲外不変・1回Undoへ渡す。mapping/再検索/自動rebaseは禁止。

検証: 旧形式migrationと再保存/backup、future拒否、不正/重複ID、保存失敗、出典コピー、参照初期OFF/予算、部分採用property/多段落/emoji/IME/stale/遅延応答/Undo/Redo、人物ルールとプリセットの保存reload、複数AI比較回帰。実モデル品質はNOT RUN。
