# 日本語・モバイル拡張の段階計画

この文書のPhase番号は新ロードマップの番号。既存docs/IMPLEMENTATION_PLAN.mdのTask 18.5までをベースとする。今回の承認範囲はPhase 0〜1だけ。

| Phase / 依存 | 変更案（まだ存在しないファイルは候補） | 検証と終了条件 |
|---|---|---|
| 0 / 既存HEAD | roadmapの要件複写、BASELINE_AND_GAPS、ADR、計画 | Git/差分保護、既存check/build/全E2E、結果の実測 |
| 1 / 0 | WorkspaceLayout/Files/App、EditorSurface、AiEditBoundary、各CSS、layout、use-workspace、mobile E2E/component | M-01〜07、全回帰、schema v4不変。実機未実施を記録し停止 |
| 2 / 1 | domain/japanese-diagnostics、features/feedback、診断fixture | J-01〜03/06一部/07。ローカル規則と根拠、無視、変更時再計算。誤検出・AI通信0・100k文字。注釈をPMへ保存しない |
| 3 / 2 | domain/workspace、migration、story-memory、controller、CandidatePreview、replace-selection | A-01/02/04/05、J-04/05/06、S-01〜03。部分採用は最終置換文字列を同期guardへ。人物・文体・参照を明示承認。v1〜v4 import・範囲外不変・Undo・遅延応答 |
| 4 / 3 | annotation ADR、editor schema/serialization、exporter、AI contracts/prompt | T-01〜04、A-03/06/07、J-07 AI、S-04。ルビ/傍点のmark/node/sidecarを比較して採択後にmigration。Unicode/リテラル記号/round-trip/差分/Undo |
| 5 / 4の保存契約確定 | manifest、静的資産SW、offline UI、更新検知 | P-01〜05。offline再起動・編集・保存・復帰、SW更新失敗、private response非cache。端末installは別gate |
| 6 / 5 + セキュリティADR承認 | server/sync、local outbox、接続設定、競合UI、sync fixture | C-01〜08。HTTPS/認証/認可、CAS、削除tombstone、両版保全、2 profile/offline/再認証/復旧。初期OFF。外部契約/公開は別承認 |
| 7 / 各機能の自動gate | 日本語benchmark、実機手順、release記録 | J-08、I/R/Q/S/A。実機IME・選択・SR・20k/100k文字・品質・復旧。未実施ならNOT YET VERIFIED |

## データ移行の順序

1. Phase 1は保存schema/DB/PM schema/backupを変更しない。元データを書換えるmigrationなし。
2. 新しいデータが必要なPhaseでADRを作り、旧読込、保存、単体/全作品backup、履歴、ごみ箱の各versionを区別する。現行3欄メモを保持し、人物抽出候補は正本へ自動統合しない。
3. 旧v1〜v4 fixtureを保存し、本文/改行/Unicode/ID/順序/章数/メモ/model設定が維持される純粋migrationを実装。future versionはfail-closed。
4. 実書込前に旧版backupを確保・検証し、容量見積もりとquota失敗のrollbackを試験。既存recordを削除してから移す手順は禁止。transaction内で新データ検証と原子的切替。
5. 新旧タブ/SW混在時は旧writerを止め、バックアップ可能な読取状態へ。アプリdowngradeが新データを解釈できるとは扱わない。復旧は旧backupの別コピー、原本は保全。
6. 同期追加で既存IDを無断再発行しない。サーバーrevision、端末のlocal storageVersion、PM contentRevisionを別管理。初回upload/downloadは差分を提示し、サーバーが空でもローカルを削除しない。

## Phase 1検査計画

- mobile Chromium phone emulation: 320/375/390/430/768/1024px、タップ起動、全既存ツール、候補切替/比較/Diff、Accept→Undo/Redo、保存/reload、章/作品/未保存draft、失効拒否、生成中編集、回転。
- component: composition中のtap/履歴拒否、focus、VisualViewport、背景化flushと保存失敗。遅延応答は既存abort無視テストを含め全実行。
- desktop: 全5構成のE2E、型・lint・914件以上の既存自動検査、本番build、100k文字検査。browser console/hydrationと描画を確認。
- WebKitは利用可能なら自動試験。実機接続は127.0.0.1制限のため別設計。エミュレーション成功を実iOS/Android試験と報告しない。

形態素辞書、部分採用、構造化メモ、ルビ、PWA、同期、認証のコードは今回追加しない。

## 継続依頼（2026-10-27）

Phase 0〜1の完了後、ユーザーがPhase 2〜6の順次実装・検証・ローカルcommitを明示依頼した。本書の旧「今回」範囲は当初依頼の記録として保持し、現在の作業範囲と対応表は PHASE_2_6_PLAN.md（開発履歴・配布対象外） を使用する。push/PR/deployは行わない。
