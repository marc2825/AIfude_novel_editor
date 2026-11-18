# 実装計画

作業単位と完了条件の記録。過去のPhase・Taskは当時の範囲を示し、現在の機能一覧ではない。使い方は [操作ガイド](USAGE.md)、現行の保存形式は [データモデル](DATA_MODEL.md)、直近の作業は末尾のPhase 20を参照する。

## 実行規則

1回のCodex依頼は1 Taskとする。Task間の依存を飛ばさない。各Taskで、既存差分確認、変更計画、実装、関連テスト、DoD確認、結果報告まで行う。対象外機能を先に作らない。通常は本体2〜5ファイル程度と対応テストを目安にする。bootstrapの設定ファイルとlockfileは例外。ファイル一覧は変更可能範囲であり、そのTaskで無条件に全ファイルを作る指示ではない。

全Taskでtypecheck、lint、関連Vitestを実行する。UI境界やサーバー境界変更時はbuildも実行する。

## Phase 0：Repository bootstrap

### 目的

仕様を読み、安全に実装・検証できる最小Next.js repositoryを作る。

### 変更箇所

- `package.json`
- `pnpm-lock.yaml`
- `.node-version`
- `.npmrc`
- `.gitignore`
- `.env.example`
- `tsconfig.json`
- `next-env.d.ts`
- `next.config.ts`
- `eslint.config.mjs`
- `vitest.config.ts`
- `playwright.config.ts`
- `src/app/layout.tsx`
- `src/app/page.tsx`
- `src/app/globals.css`
- `tests/setup.ts`
- `tests/components/bootstrap.test.tsx`
- `tests/e2e/bootstrap.spec.ts`
- `.github/workflows/ci.yml`
- `README.md`
- `docs/DECISIONS.md`

### タスク

#### Task 0.1：最小アプリと検査

- repositoryと設計ファイルを確認する。
- Node 24、pnpm 10、Next.js 16、React 19の互換性を確認する。
- 公開済み安定版を正確なバージョンで固定する。
- TypeScript strictを設定する。
- ループバック bindのdev/startコマンドを用意する。
- 静的な日本語のタイトルと「実装準備中」表示だけを作る。
- typecheck、lint、test、check、buildを設定する。
- VitestとTesting Libraryでbootstrap component testを作る。
- `.env.example`へ空のサーバー用設定名だけ記載する。
- lockfileを生成する。

#### Task 0.2：E2EとCI基盤

- Playwrightのbootstrap testを作る。
- CIでtypecheck、lint、Vitest、build、bootstrap E2Eを実行する。
- 実APIキーをCIへ設定しない。
- package scriptsとREADMEを整合させる。

### 検査

- タイトルが表示される。
- 初期画面からAI リクエストが発生しない。
- typecheck、lint、Vitest、buildが成功する。
- Task 0.2ではPlaywright bootstrapが成功する。

### 完了条件

- Task 0.1だけでローカル起動と基本検査が可能。
- 依存バージョンが固定されている。
- secretを含むファイルが追跡されない。
- エディタ、保存、AI機能はまだ存在しない。
- Task 0.2完了後にCIが再現可能。

### この段階では扱わない機能

TipTap、IndexedDB、AI route、プロバイダーSDK、ポップオーバー、Character、Story State。

## Phase 1：Plain エディタ

### 目的

AIなしで正しく書けるプレーンテキスト相当のエディタを作る。

### 変更箇所

- `src/features/editor/NovelEditor.tsx`
- `src/features/editor/create-editor.ts`
- `src/features/editor/plain-text.ts`
- `src/features/editor/Editor.module.css`
- `src/features/editor/extensions/plain-text-schema.ts`
- `src/features/editor/extensions/plain-text-history.ts`
- `src/features/workspace/WorkspaceApp.tsx`
- `src/app/page.tsx`
- `tests/helpers/editor.ts`
- `tests/unit/plain-text.test.ts`
- `tests/unit/history.test.ts`
- `tests/components/bootstrap.test.tsx`
- package関連ファイル

### タスク

#### Task 1.1：Schemaと入力

- TipTapの採用版を固定する。
- paragraph/textだけのschemaを作る。
- SSR時にエディタを作らない。
- プレーンテキスト貼り付けとLF正規化を実装する。
- serializationを実装する。
- ファイルdropとリッチコンテンツを受け付けない。

#### Task 1.2：HistoryとIME

- history pluginを1個導入する。
- Undo/Redo keymapを実装する。
- Enter/Shift + Enterを段落分割へ統一する。
- composition状態の観測を実装する。
- 日本語・絵文字・空段落を確認する。

### 検査

- serialization 書き出しと復元。
- 複数段落と末尾改行。
- HTML貼り付けが装飾を持ち込まない。
- Undo/Redo。
- composition中に独自処理で入力を破壊しない。

### 完了条件

- 通常入力と貼り付けができる。
- DOMを本文の正本にしていない。
- React 再描画で本文やカーソルがリセットされない。
- history pluginが重複していない。

### この段階では扱わない機能

AI 選択範囲 snapshot、ポップオーバー、API、保存、装飾機能。

## Phase 2：Local persistence

### 目的

AI開発より先に本文の保存と復旧手段を完成させる。

### 変更箇所

- `src/domain/workspace.ts`
- `src/persistence/workspace-repository.ts`
- `src/persistence/indexeddb.ts`
- `src/persistence/save-coordinator.ts`
- `src/persistence/workspace-lock.ts`
- `src/features/workspace/use-workspace.ts`
- `src/features/workspace/WorkspaceApp.tsx`
- `src/features/workspace/WorkspaceSettings.tsx`
- `src/features/workspace/Workspace.module.css`
- `src/features/workspace/backup.ts`
- `tests/fixtures/workspace.ts`
- `tests/unit/save-coordinator.test.ts`
- `tests/integration/workspace-repository.test.ts`
- `tests/components/workspace.test.tsx`
- `tests/e2e/persistence.spec.ts`

### タスク

#### Task 2.1：保存スキーマとrepository

- V0.1のWorkspaceSnapshotだけを実装する。
- load/save/replace/deleteを実装する。
- storage バージョンの比較更新を同一トランザクションで行う。
- 不明バージョンと破損データを拒否する。

#### Task 2.2：Hydration、自動保存、編集ロック

- 読み込み完了まで編集可能な空文書を表示しない。
- debounceと最大待機付き保存キューを実装する。
- 保存状態を表示する。
- Web Locksで単一writerにする。
- 保存失敗時にメモリ本文を維持する。

#### Task 2.3：バックアップと基本設定

- テキストとJSONの書き出しを実装する。
- 10MiB以下のJSON 取り込みを検証する。
- 上書き確認と同意初期化を実装する。
- 作品名、共通プロンプト、手動文体設定を編集可能にする。
- ローカルデータ削除を確認付きで実装する。

### 検査

- 保存後再読み込み。
- 保存完了順序。
- 容量制限 error。
- バージョン conflict。
- 別タブ読み取り専用。
- バックアップ書き出しと復元。
- 取り込み不正データと上限超過。
- 取り込みでAI同意が復元されない。

### 完了条件

- AIなしで入力・保存・復旧ができる。
- 古い保存が新しい本文を上書きしない。
- 初期読み込み失敗時に既存データを消さない。
- 2タブで同時編集できない。

### この段階では扱わない機能

クラウド同期、複数作品UI、編集履歴保存、将来モデルのtable。

## Phase 3：Selection safety

### 目的

AIがなくても検証できる、安全なsnapshotと置換の基盤を作る。

### 変更箇所

- `src/features/editor/selection.ts`
- `src/features/editor/replace-selection.ts`
- `src/features/editor/plugins/edit-guard.ts`
- `src/features/editor/create-editor.ts`
- `src/features/editor/NovelEditor.tsx`
- `tests/unit/editor-guard.test.ts`
- `tests/unit/replace-selection.test.ts`
- `tests/unit/history.test.ts`
- `tests/integration/editor-session.test.ts`
- `tests/helpers/editor.ts`

### タスク

#### Task 3.1：Captureと検証

- PM位置とplain-text位置の変換。
- TextSelectionとAllSelectionのcapture。
- エディタ インスタンス ID。
- monotonic content/selection リビジョン。
- context リビジョンの参照。
- strict stale判定。

#### Task 3.2：安全な範囲置換

- 候補文字列からSliceを作る。
- dispatch前のprefix＋候補＋suffix検証。
- 同期的な適用command。
- 二重適用防止の受け入れ条件。
- AI前後のhistory境界。

この段階ではテストテスト用データからcommandを呼ぶ。製品画面へ一時的な「強制置換」ボタンを追加しない。

### 検査

- 必須エディタ tests E-01からE-09。
- property-based replacement。
- 即時の前後入力とUndo分離。
- 同じ文字列へ戻しても旧リビジョンを受け付けない。

### 完了条件

- 正しい範囲以外を変更できない。
- 古いsnapshotが適用されない。
- AI相当の変更がUndoで1操作になる。
- 位置の自動mapping/rebaseを実装していない。

### この段階では扱わない機能

API、候補UI、Diff、partial Accept。

## Phase 4：AI contracts and context

### 目的

プロバイダーに依存しない入力、intent、context、出力検証を実装する。

### 変更箇所

- `contracts/llm-candidates.schema.ts`
- `src/domain/ai-edit.ts`
- `src/domain/limits.ts`
- `src/features/ai-edit/intent.ts`
- `src/features/ai-edit/context.ts`
- `src/server/ai/prompt.ts`
- `tests/unit/contracts.test.ts`
- `tests/unit/intent.test.ts`
- `tests/unit/context.test.ts`

### タスク

#### Task 4.1：契約とIntent

- API request/response/error スキーマを実装する。
- プロバイダー wire スキーマに対応する検証を実装する。
- business validationを実装する。
- 保守的なintent推定を実装する。
- スキーマ契約のdriftをテストする。

#### Task 4.2：Contextとプロンプト

- 前後文脈を抽出する。
- 上限とトークン見積もりを実装する。
- deterministicなtruncationを実装する。
- 固定指示を`prompt.ts`へ集約する。
- 送信範囲の説明用メタデータを作る。

### 検査

- 全上限の境界値。
- 「短くしない」をshortenと誤認しない。
- instructionと選択範囲を切り詰めない。
- 重複・空白・同一候補を拒否。
- 原文を勝手にtrimしない。

### 完了条件

- 同じ入力から同じintent/contextが得られる。
- プロバイダーSDKへの依存がない。
- 全文送信を必要としない。
- 無効入力はプロバイダー呼び出し前に検出できる。

### この段階では扱わない機能

Character retrieval、Story State、分類LLM、embeddings、実API。

## Phase 5：Protected mock API

### 目的

実AI費用なしで、最終的なAPI boundaryを通る生成経路を作る。

### 変更箇所

- `src/server/ai/provider.ts`
- `src/server/ai/config.ts`
- `src/server/ai/mock-provider.ts`
- `src/server/ai/edit-service.ts`
- `src/server/http/guard.ts`
- `src/server/http/rate-limit.ts`
- `src/server/http/errors.ts`
- `src/app/api/ai/edits/route.ts`
- `src/app/page.tsx`
- `tests/fixtures/candidates.ts`
- `tests/integration/edit-route.test.ts`
- `tests/integration/provider.test.ts`

### タスク

#### Task 5.1：Server境界

- server-onlyのprovider portとconfig。
- ループバック設定検証。
- origin/host/content type/body size検証。
- rate limiterと安全なerror mapping。
- disabled/mockの明示的なモード。

#### Task 5.2：Mock serviceとroute

- deterministicなmock プロバイダー。
- serviceで出力を検証。
- 候補IDをサーバー生成。
- no-store 応答。
- 公開可能なruntime情報をクライアントへ渡す。
- 制限時間とAbortSignalの配線。

### 検査

- 全HTTP error contract。
- 未設定で外部接続しない。
- リクエスト body実測上限。
- mock プロバイダー出力も通常validationを通る。
- 未加工のエラーと送信データが漏れない。

### 完了条件

- 実APIキーなしで有効な候補応答を取得できる。
- 危険なoriginやoversized bodyをプロバイダー手前で拒否できる。
- mockを実AIと誤表示しない。

### この段階では扱わない機能

OpenAI SDK、公開API、認証の仮実装、テスト専用公開エンドポイント。

## Phase 6：Command セッション

### 目的

選択範囲から生成までを接続し、安全な非同期state machineを完成させる。

### 変更箇所

- `src/features/ai-edit/machine.ts`
- `src/features/ai-edit/controller.ts`
- `src/features/ai-edit/client.ts`
- `src/features/ai-edit/EditPopover.tsx`
- `src/features/ai-edit/AiEditBoundary.tsx`
- `src/features/ai-edit/AiEdit.module.css`
- `src/features/workspace/WorkspaceApp.tsx`
- `tests/helpers/deferred.ts`
- `tests/unit/ai-machine.test.ts`
- `tests/components/command.test.tsx`
- `tests/integration/editor-session.test.ts`

### タスク

#### Task 6.1：Command UI

- Cmd/Ctrl + K。
- 非モーダル ポップオーバーとフォーカス制御。
- 指示、プリセット、候補数。
- 選択上限の案内。
- IME中の抑止。
- 送信予定文脈の確認表示。

#### Task 6.2：非同期コントローラー

- state machine。
- fetchとクライアントタイムアウト。
- リクエストID照合。
- cancellation。
- strict stale。
- API failureと再試行経路。
- 旧response/errorの破棄。

### 検査

- キーボードとcomposition。
- ポップオーバーへのフォーカスで誤staleにならない。
- 本文・選択範囲変更でstaleになる。
- 中止無視mockの遅延応答。
- 旧errorで新セッションを壊さない。

### 完了条件

- mock APIへ正しい送信データを送信できる。
- Generating中も本文が編集可能。
- 本文変更後の応答をPreview可能な状態へ遷移させない。
- このPhaseでは生成結果が存在しても本文を変更しない。

### この段階では扱わない機能

Accept UI、Diff、実プロバイダー、ストリーミング。

## Phase 7：Candidate review and Accept

### 目的

中心UXをmock APIで完成させる。

### 変更箇所

- `src/features/ai-edit/CandidatePreview.tsx`
- `src/features/ai-edit/DiffPreview.tsx`
- `src/features/ai-edit/diff/diff.ts`
- `src/features/ai-edit/diff/diff.worker.ts`
- `src/features/ai-edit/EditPopover.tsx`
- `src/features/ai-edit/controller.ts`
- `src/features/ai-edit/AiEdit.module.css`
- `tests/unit/diff.test.ts`
- `tests/components/candidate-preview.test.tsx`
- `tests/e2e/local-edit.spec.ts`
- `tests/e2e/stale-response.spec.ts`
- `tests/e2e/undo-redo.spec.ts`

### タスク

#### Task 7.1：候補と適用

- 候補タブ、説明、riskNotes。
- Accept、Reject、Retry。
- Phase 3の安全な適用commandへ接続。
- Accept後の保存予約。
- Retry開始時の旧候補無効化。
- 二重Accept防止。

#### Task 7.2：Diff

- grapheme分割。
- workerによるactive候補の差分。
- 150ms タイムアウトと並列表現。
- 遅延worker応答の破棄。
- キーボードと読み上げ用の差分表現。

### 検査

- 必須E2E T-01からT-07。
- Diffが本文に影響しない。
- 候補切替がUndo履歴を変えない。
- Accept前後の保存内容。
- Diff タイムアウトでも候補を確認できる。

### 完了条件

- mockで中心UX全体が動作する。
- Accept以外で本文が変わらない。
- staleとRetry raceを防げる。
- AI適用が1回のUndoで戻る。

### この段階では扱わない機能

partial Accept、候補の直接編集、実API、自動採用。

## Phase 8：OpenAI and privacy

### 目的

既存境界を変えずに実プロバイダーを接続する。

### 変更箇所

- `src/server/ai/openai-provider.ts`
- `src/server/ai/provider-factory.ts`
- `src/server/ai/config.ts`
- `src/server/ai/edit-service.ts`
- `src/features/workspace/WorkspaceSettings.tsx`
- `src/features/ai-edit/EditPopover.tsx`
- `src/app/page.tsx`
- `.env.example`
- `tests/integration/provider.test.ts`
- `tests/integration/edit-route.test.ts`
- `tests/e2e/privacy.spec.ts`
- `docs/DECISIONS.md`
- `README.md`

### タスク

#### Task 8.1：OpenAI adapter

- 採用SDKとモデルの対応機能を確認。
- Structured Output。
- 非ストリーミング。
- store false。
- SDK 再試行無効化。
- タイムアウト、refusal、incompleteの正規化。
- トークン使用量の変換。
- server-only 取り込み保証。

#### Task 8.2：同意と運用表示

- プロバイダー単位の同意。
- 初期offと同意撤回。
- 未同意で呼び出し0回。
- model/provider表示。
- 外部送信対象の確認。
- 手動smoke testの手順をREADMEへ追記。

#### Task 8.3：Provider / Model configuration

- プロバイダーと対応モデルのcanonical 定義一覧を導入する。
- Structured Outputs、入力・出力上限等、workflowに必要な事実上の対応機能を記録する。
- Settingsから許可リスト済みモデルを選択できるようにする。自由入力のモデルIDは受け付けない。
- サーバーでプロバイダーとモデルの組合せを送信前に検証する。
- モデル選択の保存先と`Automatic / Default`の意味を決定し、必要なmigrationを明示する。
- モデル、Edit Intent、StyleProfile、task instructionを別の概念として維持する。
- 文学的品質の主観的rankingや「最良」表示を定義一覧へ持ち込まない。

### 検査

- SDK mockによる全応答分岐。
- クライアント bundleにkey/provider SDKがない。
- 同意なしの拒否。
- API failure中の保存。
- explicitな手動実API smoke test。

### 完了条件

- editor/UIへOpenAI固有型が入っていない。
- 設定した対応モデルで候補を取得できる。
- 自動再試行や自動切替がない。
- privacy表示と実際の送信データが一致する。
- 実API未検証の場合はその状態を明記し、実AIリリース完了とはしない。

### この段階では扱わない機能

別プロバイダー、BYOKブラウザー保存、Task 8.3前のモデル選択UI、モデル自動選択、料金計算の自動取得、公開デプロイ。

## Phase 9：Release gates

### 目的

V0.1の安全性、耐障害性、操作性を確認する。

### 変更箇所

- `tests/e2e/local-edit.spec.ts`
- `tests/e2e/stale-response.spec.ts`
- `tests/e2e/undo-redo.spec.ts`
- `tests/e2e/persistence.spec.ts`
- `tests/e2e/keyboard-ime.spec.ts`
- `tests/e2e/privacy.spec.ts`
- `next.config.ts`
- `src/app/error.tsx`
- 発見された不具合の最小修正箇所
- `docs/TESTING.md`
- `docs/SECURITY.md`
- `docs/SELF_REVIEW.md`
- `README.md`

### タスク

#### Task 9.1：Critical flowと障害試験

- 必須E2Eの不足を埋める。
- 保存失敗、再読み込み、別タブ、タイムアウト、応答乱順を確認。
- AI error boundaryと復旧導線を確認。
- CIで再現可能にする。

#### Task 9.2：手動検証とリリース判断

- macOS/Windowsの日本語IME。
- keyboard-only。
- accessibility。
- 10万文字級文書の性能。
- API keyとnetwork 送信データの検査。
- security headerとループバック設定。
- バックアップ復旧。

### 検査

`docs/TESTING.md`の必須項目すべて。

### 完了条件

- 全DoDとV0.1要件に対応する証拠がある。
- 未検証項目を成功扱いしていない。
- 本文消失、誤適用、Undo破損の既知不具合がない。
- ローカル専用という配布条件が明記されている。

### この段階では扱わない機能

新機能、V0.2先行実装、見た目だけを理由にした大規模refactor。

## Phase 10：Local LLM inference

### Task 10.1：ローカルLLMを主な推論先として追加する

ユーザーのローカルLLM対応依頼に基づく追加Task。Phase 8の「別プロバイダーを実装しない」はPhase 8の範囲として維持し、本Taskで実装する。Files to touch：サーバープロバイダー / config / factory / service、domain 定義一覧、公開runtime、クライアント制限時間、接続・モデル表示、環境設定例、対応テストとE2E設定、関連仕様・README。Acceptance Criteria：

- LM Studio / OllamaのOpenAI互換Chat Completionsへ、サーバー設定のループバック URLとモデルで接続できる。
- ローカル接続を標準の設定例とし、未設定ではAIを無効にする。失敗時にOpenAIへ自動切替しない。
- JSON Schemaを要求し、既存の候補・入力上限検証を通す。任意URL・任意モデルIDのクライアント指定を受け付けない。
- 接続先URL・認証トークンをブラウザーへ渡さず、使用モデルとローカル接続であることを表示する。
- ローカルサーバー 180秒 / クライアント 185秒で待機でき、キャンセル後の遅延応答を破棄する。
- Accept以外で本文を変更せず、stale、Undo/Redo、自動保存、OpenAIの同意確認条件を維持する。
- typecheck、lint、関連Vitest、build、関連E2Eを検証し、実LLM・IMEの未検証を区別する。

個別モデルのダウンロード・自動探索、モデル一覧取得UI、任意LAN / cloud接続、ストリーミング、自動再試行、保存スキーマ変更は含めない。

## Phase 11：Subscription inference

### Task 11.1：ChatGPTサブスク連携

2026-10-14のユーザー承認に基づく。複数プロバイダー対応の最初の対象としてChatGPTを追加する。サーバー内のSSE受信と固定出力トークン上限を使わない方式を許可し、従量課金API・ローカルLLMへ自動切替しない。

Files to touch：ChatGPT認証 / 認証情報保存 / プロバイダー / HTTP route、既存config / factory / service、domainのruntime / リクエスト / error契約、接続・同意UI、コントローラーの接続変更時の無効化、設定例・関連仕様・テスト。署名検証用joseだけを依存追加する。

Acceptance Criteria：

- API keyなしで公式OAuthを開始・完了・再認証・解除でき、state / nonce / PKCE / ID トークン / 範囲を検証する。
- 認証情報はサーバー専用の保護されたlocal ファイルに保存し、ブラウザー・本文workspace・バックアップ・ログへ渡さない。refreshを直列化する。
- 選択モデルを認証済みアカウントのcatalogで確認し、接続IDが一致するリクエストだけを処理する。
- 未同意での本文送信は0回。認証失効、利用枠不足、プロバイダー失敗で他プロバイダーへ切り替えない。
- サーバー内だけSSEを読み、完了イベントと全候補の検証後に既存のJSON 応答を返す。180秒 / 185秒、SSE実測1MiB、候補JSON128KiB、既存の候補文字数上限で制限する。
- 接続・再認証・解除でAIセッションを同期的に無効化し、中止を無視する遅延応答を破棄する。
- Accept以外で本文を変更せず、stale、Undo/Redo、保存、既存プロバイダーの明示設定を維持する。
- typecheck、lint、関連Vitest、build、E2Eを実行し、実認証・実推論・OSのIMEの未検証を区別する。

今回実装しないもの：他社サブスクadapter、複数ChatGPTアカウントの切替UI、アプリ自体のユーザー認証、クラウド同期、ブラウザーへのストリーミング、自動切替、cookie / Codex認証情報の転用、公開deploy。

## Phase 12：Prompt insertion and AI comparison

### Task 12.1：プロンプトによる文章挿入とAI出力比較

2026-10-16のユーザー依頼と回答に基づく。選択範囲の置換に加え、入力したプロンプトからの文章をカーソル位置へ挿入する。複数AIへの同時自動送信は必須。サブスクを基本とし、API接続は設定で明示ONにした場合のみ使用する（初期OFF）。ChatGPT / Claudeのサブスクと、OpenAI / Claude / Gemini / Grok / DeepSeekの任意API接続を対象にする。別プロバイダーへの自動切替は行わない。

Files to touch：エディタのcapture / 安全適用、AI入力・出力契約、プロンプト / service / コントローラー、候補UI、比較に必要な接続設定、関連仕様・unit / integration / component / E2E。Acceptance Criteria：

- 空のTextSelectionからプロンプトを入力し、候補の確認後に明示採用して挿入できる。標準1案、最大3案、各3,000文字以内。
- 挿入では入力プロンプトだけを送信し、本文・前後文脈・作品設定・挿入座標を暗黙に送らない。クライアントとサーバーでmodeと上限を検証する。
- 挿入前後の本文は完全に不変、AI挿入は1回のUndoで戻り、Redoと保存・再読み込みができる。待機中の本文・カーソル変更はstaleになり、遅延応答を破棄する。
- 比較では同じプロンプトに対する各AIの出力と提供元を区別して確認でき、採用する1件だけを本文へ適用する。途中の失敗や候補切替では本文を変えない。
- 比較対象・外部送信先を明示し、選択して同意した接続だけを使用する。利用枠不足で自動切替しない。
- 2〜3接続へ並列送信し、プロバイダーごとの成功・失敗を保持する。APIはサーバー opt-inと画面設定の両方がONである場合だけ送信できる。画面設定は再読み込みでOFFに戻る。
- typecheck、lint、Vitest、build、関連E2Eを実行する。実認証・推論・OSのIMEの未実施を区別して記録する。

今回実装しないもの：常設チャット、全文自動執筆、自動的な続きを生成するloop、位置の自動再配置、partial Accept、第三者の非公開認証情報の転用、公開deploy。

## Phase 13：作品メモリ

### Task 13.1：手入力メモの保存と任意のAI参照

2026-10-16のユーザー依頼に基づく。先にTask 12.1をコミットし、新規ブランチで実装する。ユーザーが選択した保存方式は「作品ごとのアプリ内メモ欄＋バックアップ」。設定・背景・登場人物の手入力メモを扱い、構造化Character / World / Story State、自動要約・更新、検索基盤は追加しない。

Files to touch：domainの作品メモリ / workspace / AI契約、workspace保存とメモ欄、選択範囲 snapshotの参照情報、AI コントローラー / context / プロンプト / 送信説明、バックアップ migration、関連仕様とテスト。

Acceptance Criteria：

- 設定・背景・登場人物のメモを作品単位で手入力・保存・再読み込みできる。各2,000コードポイントまで。本文の編集とUndo履歴を変更しない。
- 保存スキーマバージョン 3へバージョン 1 / 2から非破壊migrationし、メモリを含むJSONバックアップをexport / 取り込みできる。不正データ・未対応バージョン・保存失敗・別タブを既存の保護境界で扱う。
- 置換 / 挿入 / 複数AI比較の生成画面で参照をON/OFFできる。初期OFF、新セッションでOFF。OFF時はメモをHTTP 送信データとモデル入力へ含めず、ON時は保存済みメモを送信内容として表示する。
- クライアント / サーバーの両方でメモのスキーマと文字数・入力予算を検証する。メモをアプリの制御指示として扱わず、ONのメモを黙って省略・切り詰めない。予算超過時はプロバイダー呼び出し前に拒否して案内する。
- メモの保存変更でcontextRevisionを増やし、生成中 / 候補表示中のセッションをstale化する。中止を無視する遅延応答を採用できない。参照ON/OFFで旧候補を無効化する。
- typecheck / lint / unit / integration / component / 関連E2E / build / DoD確認を行い、実LLM・日本語IMEの未検証事項を区別する。

今回実装しないもの：メモの自動生成・学習・要約・更新、ファイルシステムのAGENTS.md読取、人物CRUD / RAG / embeddings、本文の自動変更、クラウド同期。

## Phase 14：執筆ファイルの操作とメモ保護

### Task 14.1：未保存メモ保護・項目別参照・保存とファイルタブ

2026-10-16の追加依頼に基づく。未保存メモ警告、設定・背景・登場人物の個別参照、一般的な保存・ロード・ファイル切替・タブを同じ執筆フローとして実装する。既存の自動保存・JSONバックアップを再利用する。複数作品UIの旧非目標は、この明示依頼の範囲で更新する。Files to touch：作品メモリUIとAI入力、workspace保存コントローラー / repository / IndexedDB、ファイル操作とタブUI、関連仕様・テスト。依存は追加しない。

Acceptance Criteria：

- 未保存メモがあれば再読み込み / 離脱でブラウザー標準警告を要求し、取込・作品切替・新規・タブを閉じる・削除では破棄確認できる。取消では本文・未保存の入力・AI状態を維持する。保存失敗でも未保存の入力を保持する。
- メモ参照は初期OFFを維持し、ON時に設定・背景・登場人物を個別選択できる。未選択のメモ内容はHTTP / モデル入力へ送らず、入力予算と送信前表示・応答メタデータも実際の選択へ合わせる。変更時は旧候補を破棄する。
- 本文の自動保存に加え、明示保存・Cmd/Ctrl + S、JSON保存、JSON / UTF-8テキストを新しい作品として開く、新規作成、保存済み作品のタブ切替・閉じる・再度開くを提供する。タブを閉じても保存データを削除しない。
- 切替前に現在の本文保存を完了させ、失敗時は切替を中止する。本文の正本をPMに維持し、作品ごとに設定・メモを分離する。切替・loadでは新エディタ / 新AIセッションにし、古い遅延応答を適用しない。
- 既存workspaceを非破壊で保持し、切替は原子的に実行する。単一writer ロック・storageVersion・不正データ拒否を維持し、バックアップ取り込みが別作品を上書きしない。
- 型・lint・unit / integration / component / E2E・buildを実行する。実LLM・native IME・ブラウザーの離脱警告制限を区別して記録する。

今回実装しないもの：cloud同期、共同編集、同一作品内の章管理、自動要約・メモ自動更新、任意filesystemへの無断書き込み、エディタ履歴の永続化。

## Phase 15：執筆の基本機能

### Task 15.1：履歴・全作品バックアップ・章・検索・編集状態・進捗

2026-10-17の「これら全部実装」の明示依頼。Phase 14の単一章と再マウントの制約をこの範囲で更新する。依存追加なし。変更対象：workspace スキーマ / migration、保存repository、エディタセッション、章・検索・履歴・バックアップ・文字数UI、関連テストと仕様。Acceptance Criteria：

- 手動の名前付き保存履歴と任意ONの自動履歴を保存し、本文・メモの差分確認後に明示復元できる。復元前の状態も保存し、失敗時は現在の本文を維持する。
- 保存済みの全作品・全章・メモ・履歴を一括JSONに書き出し、既存作品を上書きせずコピーとして原子的に復元できる。不正・将来バージョン・容量超過は拒否する。
- 作品内の章を作成・切替・改名・並べ替え・削除でき、章のアウトラインを保存できる。最後の章は削除不可。旧スキーマ 1〜3を非破壊migrationする。
- 現在の章で文字列を検索し、置換予定を確認して1件／全件を明示置換できる。古い検索結果を拒否し、1回のUndoで戻せる。
- 同じ起動中の作品／章切替でUndoとカーソルを保持する。再読み込み後は開いているタブと保存時のカーソルを復元する。Undoの永続化は保存履歴で補う。
- 章／作品の文字数と作品単位の目標進捗を表示する。改行は文字数から除き、Unicodeコードポイントで数える。
- 本文の正本、単一writer、CAS、古いAI候補の拒否、IME保護を維持する。型・lint・unit / integration / component / E2E・buildを実行し、native IMEの未実施を明記する。

自動執筆、学習、自動メモ更新、クラウド同期は含まない。

## Phase 16：未保存保護・ごみ箱・AI接続管理

### Task 16.1：優先度「最優先〜高」の3機能

ユーザーが2026-10-17に明示依頼。作品設定の未保存保護、ごみ箱からの作品／章復元、AI接続の画面設定と本文を使わない診断を実装する。中優先度の機能は含めない。変更対象：WorkspaceSettings / WorkspaceApp / use-workspace、trash スキーマ / repository / バックアップ、AI設定store / 設定API / プロバイダー起動 / 診断UI、関連仕様とテスト。Acceptance Criteria：

- 作品名・共通プロンプト・文体設定の未保存の入力を検知し、離脱・切替・取込・削除で保護する。通常保存／Cmd・Ctrl+Sへ統合し、失敗時は未保存の入力を保持する。取消でAIセッションを変更しない。
- 作品／章の削除を原子的にごみ箱へ移し、履歴がなくても復元できる。元の作品を上書きせず、復元後の古いAI候補を拒否する。完全削除は明示確認のみ。単一writer・CASと保存失敗時の本文保持を維持する。
- 旧DBを非破壊upgradeし、ごみ箱を全作品バックアップへ含める。旧バックアップの読み込み、不正入力・将来バージョン・同期容量制限失敗を検証する。
- AI接続画面で主接続・比較対象・モデル・ローカル接続URLを保存できる。キー、認証情報、CLI実行パスはサーバー管理を維持し、ブラウザー／作品バックアップへ含めない。APIはサーバー opt-inと画面の初期OFFを維持し、自動切替しない。
- 接続診断は明示操作のみ。本文・メモ・プロンプトを送らず、認証／モデル一覧・CLI auth status等を確認する。生成の成功を保証したと表示せず、期限・応答容量・origin・古い応答の拒否を検証する。
- 接続変更で進行中／表示中のAI候補を無効化する。typecheck、lint、unit / integration / component / E2E、build、DoDを確認し、実LLM・native IMEの未実施を区別する。

## Phase 17：起動の簡略化と端末連携

2026-10-21のユーザー依頼。「今後の実装すべきことに記録し、比較的容易なものをひとまず実装」に基づく。今回の実装はTask 17.1だけとし、端末連携は下表の未実装タスクとして記録する。

| Task | 内容 | 規模・前提 | 状態 |
|---|---|---|---|
| 17.1 | PCの起動ファイルからサーバー起動・ブラウザー表示 | 小。現在のローカルWebアプリを再利用 | 今回の対象 |
| 17.2 | スマホのブラウザーからPCへ接続 | 中。認証・HTTPS・許可origin・接続先管理・タッチ操作・実機IME。PC稼働が必要 | 未実装・個別Taskで設計 |
| 17.3 | PCとスマホの作品共有 | 大。共通保存先、競合検知、オフライン時の扱い、既存IndexedDBの移行、バックアップ復旧 | 未実装・個別Taskで設計 |
| 17.4 | PC停止中のスマホ利用 | 大。常時稼働サーバーまたは独立動作、認証情報の保存先、サブスク接続の実行場所 | 未実装・個別Taskで設計 |
| 17.5 | デスクトップ／スマホのアプリ配布 | 中〜大。ランチャーとは別に署名・インストーラー・更新・ホーム画面起動等を検討 | 未実装・個別Taskで設計 |

### Task 17.1：ローカルPCの起動ランチャー

変更対象：起動script、OS用の起動ファイル、packageのlaunch command、起動確認route、テスト、README・設計記録。新規依存・エディタ・保存スキーマの変更なし。Acceptance Criteria：

- 固定Nodeと導入済み依存を確認し、起動ファイルまたは`pnpm launch`から本番build・ループバックサーバー起動・準備完了後のブラウザー表示まで実行できる。作業ディレクトリに依存しない。
- URLは従来の`http://127.0.0.1:3000`へ固定し、別portへの自動切替で保存先originを変えない。LAN公開・外部origin許可・AI接続の自動変更を行わない。
- 二重起動は同じランチャーの稼働中サーバーを確認できた場合だけブラウザーを開き、二重buildや別プロセスの停止を行わない。port競合・不正／残存ロック・build／起動失敗を説明する。
- ブラウザー起動に失敗してもサーバーを維持し、手動で開くURLを表示する。Ctrl+C／終了signalで所有するプロセスを止めてロックを解放する。準備待ち・失敗・取消に時間上限を持たせる。
- 本文・メモ・認証情報をランチャーや起動確認応答へ含めず、依存installやキー設定を自動実行しない。
- 関連unit / プロセス integration、typecheck・lint、本番buildと起動smokeを実行する。GUIや未検証OSの確認を区別し、DoDを報告する。

今回実装しないもの：スマホ接続、作品の端末間同期、常駐サービス登録、PC以外の公開サーバー、nativeアプリの配布。

## Phase 18：本文中心の画面と日本語の局所推敲

### Task 18.1：執筆画面・選択からのAI提案・候補比較の刷新

2026-10-22の明示依頼。中央の大きな本文、上部操作バー、右側の折りたたみメモリを備えた画面へ刷新する。日本語小説の選択範囲を手軽に推敲し、複数AIの候補を比較・採用する一連のUXを対象とする。変更対象：WorkspaceAppと周辺パネル、NovelEditor表示、AI ポップオーバー・候補表示、CSS、関連仕様・テスト。プロバイダー・保存スキーマ・依存は変更しない。Acceptance Criteria：

- 初期画面は本文を中央に大きく表示する。上部にファイル・設定・AI接続、右側にメモリ・章・履歴を配置し、本文と独立したパネルのスクロールで同じ画面から操作できる。
- パネルを閉じる／切り替えるだけではエディタや入力中の設定・メモを破棄しない。保存・未保存保護・章／作品切替・Undoを維持する。
- 有効な選択範囲で右クリック→「AI提案」から非モーダル ポップオーバーを開く。Cmd/Ctrl+Kに加えてShift+F10も操作でき、IME・読み取り専用・選択なしでは右クリックを横取りしない。メニュー中の本文／選択変更で古い対象を破棄する。
- 選択原文、提供AI／モデル、複数候補、文字数差、変更説明、差分を比較できる。日本語の語尾重複・文のリズム・視点を整える指示を選べる。複数AI送信は既存の明示選択・同意を使い、追加送信や自動採用をしない。
- 生成中も本文を編集でき、本文／選択／参照条件変更によるstale拒否、明示採用、1回のUndo、リクエストIDによる遅延結果拒否を維持する。
- 型・lint・unit / integration / component・関連E2E・buildを実行し、キーボード・画面サイズ・描画を確認する。日本語IME実機と実AIの未検証範囲を区別する。

スマホ連携、縦書き、全文生成、学習や自動採用は対象外。

### Task 18.2：選択範囲の5種類のAI編集ツール

2026-10-24の明示依頼。Rewriteを初期値として、Transform・Expand・Condense・Customを追加し、画面右端で次の右クリック／Cmd・Ctrl+Kに使うツールを選ぶ。

変更対象：WorkspaceLayout / WorkspaceApp、AiEditBoundary / EditPopover、intent・プロンプトとAPIのpreset enum、関連テスト・文書。エディタ mutation、プロバイダー、保存スキーマ、依存は変更しない。

Acceptance Criteria：

- 右端から5種類をマウス・キーボードで選べる。初期値と再読み込み後はRewrite。作品切替では起動中の選択を保持する。選ぶだけで本文変更・送信しない。
- 有効な本文選択から、選んだツールの入力画面を開く。Transformは雰囲気・強さ、Expandは詳しく長く、Condenseは情報を保って短く、Customは保持条件内の自由指示に対応する。空のTransform／Custom指示を送信できない。
- クライアント / サーバーの同じpreset・intent検証を通し、Transform・Expand・Customの追加指示で長さや許可範囲を通常Rewriteへ戻さない。固定Preserve、JSON・文字数・予算・同意検証は維持する。
- モード変更は旧AIセッションを閉じて中止し、中止を無視した遅延応答も破棄する。候補・Diff・明示Accept・1回のUndo / Redo、stale拒否、複数AI比較を維持する。空選択範囲での既存プロンプト挿入にはツール設定を適用しない。
- 型・lint・関連unit / integration / component・E2E・build・自動a11yとキーボード操作を確認し、実AI品質・日本語IME実機の未実施を区別する。

参考：[NovelAI Writer’s Toolbox](https://docs.novelai.net/ja/text/editor/writerstoolbox/)。このアプリでは物語上の事実・人物・出来事・視点を保持する。新しい設定の創作、視点変更、ツール選択の永続化、追加モードの先行実装は対象外。

### Task 18.3：読み取り専用の辞書モード

2026-10-24の明示依頼。右端のツールに辞書を追加し、選択語句の意味をLLMまたは検索で調べる。変更対象：ツール定義、AiEditBoundary、辞書ポップオーバー・語句契約・専用API入口、関連文書とテスト。既存プロバイダー・保存スキーマ・エディタ mutation・依存は変更しない。Acceptance Criteria：

- 「辞書」を選び、1〜100コードポイントの語句を右クリック／Cmd・Ctrl+Kから開く。選択なしでは挿入を開かず、語句の選択を案内する。開くだけでは送信しない。
- LLMには語句と固定の辞書指示だけを送る。前後本文・作品設定・メモ・編集座標は送信しない。専用routeでも同じ入力上限・strict スキーマを検証する。
- 主AIの接続、外部送信同意、API初期OFF、時間・出力上限・rate limit・settings リビジョンの保護を維持する。明示操作のみで照会し、別AIや検索への自動切替はしない。
- LLMの説明は本文と別に表示し、「採用」やDiff・本文挿入操作を提供しない。生成中も本文編集・保存を維持する。stale・モード／作品変更・閉じる・取消で中止し、遅延応答を破棄する。
- 「Googleで意味を検索」は語句と「意味」だけを送る別タブの外部検索リンクとし、押すまで外部検索へ送信しない。LLM未接続・失敗時も明示的に使用できる。
- 型・lint・unit / integration / component・関連E2E・build・a11yを実行し、本文不変、同意・入力境界・失敗・遅延応答を検証する。実AIの語義品質・日本語IME実機・検索結果の品質は未確認として記録する。

アプリ内への検索結果取得、検索API契約、辞書履歴の保存、作品の自動置換は対象外。LLM結果は出典付き辞書や実検索の結果として表示しない。

### Task 18.4：明示操作による中間補完・文字数指定の続き執筆

2026-10-24の明示依頼。右端にInfillとContinueを追加し、デフォルトのRewriteは維持する。既存の局所編集を主機能とする方針を保ち、今回の指示による一回分の新規文章候補だけを生成する。全文執筆・自動進行loopは追加しない。変更対象：ツールとポップオーバー、生成契約・文脈・プロンプト、選択範囲 capture / 同期Accept 検証、関連テストと文書。保存スキーマ・プロバイダー固有adapter・依存は変更しない。

Acceptance Criteria：

- 右端で中間補完／続きを書くを明示選択でき、初期値・再読み込み後は書き直し。選択だけでは送信・本文変更しない。
- 中間補完は前後に本文がある空白だけのTextSelection、または途中の空段落内のカーソルで使える。文字を含む範囲・通常文中のカーソルを拒否し、空白の自動検索・選択拡張をしない。続きは本文のある現在の章の末尾カーソルだけを対象とする。
- 両モードで目標1〜3,000コードポイント（改行込み、初期400）と指示、1〜3候補を指定できる。実文字数を表示し、厳密一致は保証しない。上限超過・空白・重複・不正Unicode候補を拒否し、文字数合わせの無断再生成や機械的切り詰めをしない。
- 前後各最大1,000文字、共通プロンプト・手動文体を送信予定として説明する。続きには前文脈だけを送る。メモは新セッションOFF、明示ONした項目のみ送る。クライアント / サーバーの入力境界・予算・同意・API OFF・比較機能を維持する。
- 新しい文章の創作を許可する専用プロンプトを使い、既存の事実・人物・視点との整合を求める。本文やメモを制御指示として扱わず、座標・PM JSON・patchを送受信しない。
- 候補・Diff・明示Acceptと範囲外不変、単一Undo / Redoを維持する。本文／選択範囲／設定変更でstale、モード変更で閉じて中止し、遅延応答を破棄する。AI失敗時も本文編集・保存を継続できる。
- typecheck・lint・unit / integration / component・関連E2E・build・a11yを実行する。実モデル品質、文字数遵守、日本語IME実機の未検証を区別する。

今回の対象外：章をまたぐ文脈取得、空白の自動探索、全文自動執筆、継続生成loop、モデルへの無断再試行、文字数一致を装う切り詰め、モード永続化。

### Task 18.5：内容指定と前後文脈によるカーソル位置への挿入

2026-10-26の明示依頼。指定した位置へ、入力した内容と前後の文脈に沿う文章を生成する「文脈で挿入」を追加する。任意のゼロ幅TextSelectionを対象とし、空白や章末尾に限定しない。変更対象：補完契約・プロンプト、選択範囲 capture / 検証、ツール選択・右クリック・ポップオーバー、関連テストと文書。既存のコントローラー・プロバイダー・比較・Acceptを再利用し、保存スキーマ・依存は変更しない。Acceptance Criteria：

- 右端の「文脈で挿入」を明示選択し、任意のカーソル位置から右クリック／Shift+F10／Cmd・Ctrl+Kで開ける。範囲選択は置換せず拒否する。選択／開くだけでは送信しない。初期／再読み込みはRewrite。
- 「書きたい内容」は初期空で必須。1〜500文字、目標1〜3,000文字（初期400）、候補1〜3（初期1）を指定できる。クライアント / サーバーで同じstrict入力・出力上限を検証する。
- 前後各最大1,000文字と作品の共通プロンプト・手動文体を参照し、主題はユーザーの入力内容とする。片側だけの文脈や空の章も扱う。メモ参照は初期OFF、ON時の選択項目のみ。既存のprompt-only挿入の送信範囲は変えない。
- モデルへ座標・PM document・patchを渡さず、その位置へ挿入する本文だけを返すよう求める。前後の文章を重複出力せず、後続場面に接続し、既存の事実・人物・視点との整合を求める。
- 既存の候補・Diff・明示Acceptと一回Undo / Redoを使い、元の本文は前後とも完全に保持する。内容／文字数変更で旧候補を破棄。本文／選択範囲／設定変更はstale、モード変更・取消は中止し、遅延応答を破棄する。
- 複数AI比較、外部送信同意、API初期OFF、自動切替禁止、AI失敗時の本文編集・保存を維持する。
- typecheck・lint・unit / integration / component・関連E2E・build・a11yを実行し、実LLM品質・日本語IME実機の未検証を記録する。

章をまたぐ文脈収集、範囲置換との兼用、常設チャット、全文執筆、連続生成、自動Acceptは対象外。

## 将来バージョンのGate

### V0.2

Character、World、確認済みSummary、決定的な関連検索を追加する。Acceptance Criteria：

- 選択に無関係な設定を全件送信しない。
- 使用したcontextを表示できる。
- 元データリビジョン変更でリクエストを無効化できる。
- 未来の要約を過去の場面へ混入させない。

### V0.3

Story Stateとcheckerを追加する。Acceptance Criteria：

- stateの物語位置とsourceを追跡できる。
- 世界の事実と人物の知識を分ける。
- checkerは警告のみで本文を自動変更しない。
- 不明な状態を断定しない。

### V0.4

履歴保存と個人化を追加する。Acceptance Criteria：

- 明示的opt-in。
- 削除と書き出し。
- 未採用・取消・staleを拒否嗜好と混同しない。
- ユーザー本人の文体維持を目的とする。
- 学習前後の効果と副作用を評価する。

将来Gateは実装許可ではない。個別の要件・移行・Task分割を承認してから開始する。

## 新ロードマップ Phase 0〜1：日本語小説・モバイル基盤

2026-10-26の明示依頼でTask 18.5のHEADから開始。今回の単位は添付CODEX_IMPLEMENTATION_PROMPTSの「最初のCodexプロンプト（Phase 0〜1）」に従う。既存のPhase番号とは別に管理する。

変更対象・Acceptance Criteria：M-01〜07、既存監査・移行/同期の文書化・スマホ幅とタップ導線・候補比較・draft/保存保護・既存全回帰・ローカルcommit。保存v4/PM schema/公開境界は変更しない。Phase 2以降は文書のみで、今回実装しない。

## Phase 19：製品名

### Task 19.1：bunsAI++への名称統一

過去の名称変更の記録。現行の名称はTask 19.2を参照。2026-11-03の明示依頼。製品表示をbunsAI++、パッケージ名をbunsai-ppとする。対象はmain、日本語・モバイル拡張、公開用フォルダ。Files to touch：READMEと関連文書、package.json、layout・画面見出し・PWA メタデータ、起動メッセージ、ログイン時の表示名、既存の名称確認テスト。Acceptance Criteria：

- 画面見出し・ブラウザータイトル・文書に製品名を反映する。
- PWAがある版ではname・short_name・Appleホーム画面名も一致する。
- npm用のnameはbunsai-ppとし、既存の依存とlockfileを維持する。
- 保存先・バックアップ形式・ロック・認証・起動照合の既存識別子を維持する。
- 関連テスト・型検査・build・ブラウザー確認を行い、未実行事項を明記する。

適用方針と検証結果：[製品名](BRANDING.md)。ライセンス決定、GitHubのリポジトリ名変更、commit・push・公開操作はこのTaskに含めない。

### Task 19.2：AIFUDE（合い筆）への改名

2026-11-13の明示依頼。現行の製品名をAIFUDE、読みを「合い筆」、package.jsonのnameをaifudeとする。対象はmain、日本語・モバイル拡張、公開用フォルダ。Files to touch：README・現行の名称文書、package.json、layout・画面見出し・PWA メタデータ、起動メッセージ、新規認証の表示名、既存の名称確認テスト。Acceptance Criteria：

- 画面・ブラウザータイトル・PWAのname / short_name・Appleホーム画面名・新規認証の表示名をAIFUDEにする。
- READMEと名称文書で「合い筆」の読みを示し、パッケージ名をaifudeにする。
- 保存先・バックアップ形式・ロック・認証ディレクトリ・health識別子と既存依存を維持する。
- 既存の名称確認テスト、型・lint、build、ブラウザー確認を実行し、過去の記録と今回の結果を区別する。

方針と検証結果：[製品名](BRANDING.md)。過去のTask 19.1とarchiveは以前の名称変更の記録として残す。ライセンス決定、Git初期化、commit・push・公開操作は含めない。

## Phase 20：公開前整備と正本の統合

### Task 20.1：レビュー指摘の修正とmainへの統合

2026-11-11の明示依頼。今回だけ公開前の横断的な修正とjpブランチのmainへのローカルマージを一つのTaskとして扱う。公開用リポジトリ作成・push・公開デプロイは実施せず、未決定・外部設定・実機確認を [公開前TODO](PUBLISHING.md) へ追記する。

対象：package / lockfile、Next Host境界、Node条件・ランチャー、初期環境例、CI / Dependabot、公開文書と書き出しscript、歴史文書のarchive、固定契約テスト用データの移動、関連テスト。本文の編集処理と保存形式を追加変更しない。

Acceptance Criteria：

- 既知の依存脆弱性を修正し、全依存の監査、check、build、標準／モバイル／PWA／同期E2Eを再実行する。失敗と未実施を分けて記録する。
- 不正Hostを通常ページ・API・フレームワークルート・静的資産で拒否し、正しいループバック Hostは通す。画像最適化を無効化する。
- Nodeの最低版以上の24系を許容し、mockを使う環境例を用意する。本文編集・保存をAI認証の前提にしない。
- 公開先へ古い履歴・archive・私的作業依頼・生成物を持ち込まない書き出しを用意し、元ファイルの未コミット差分は保全する。
- 原稿バックアップの状態を確認してからjp版をmainへ統合する。Workspace v4からv6、DB v4からv5への移行を明示する。
- ライセンス・素材・外部規約・GitHub設定・実機確認などの未決定事項をTODOとして残し、公開操作は行わない。

### Task 20.2：Claude CLIのログイン方法固定の解除

2026-11-13の明示依頼。公開前レビューで、Claude CLIのログイン方法をサブスクリプションに固定する実装が公式条件に反するおそれを確認した。所有者は連携の削除ではなく固定の解除を選んだ。決定は[D-045](DECISIONS.md)。

対象：Claude CLI プロバイダー、サーバー config、接続診断と診断メッセージ、関連unit test、README・AI_EDITING・SECURITY・外部サービス確認・環境例。保存形式、本文処理、画面の操作フローは変更しない。Acceptance Criteria：

- CLIへ`forceLoginMethod`を渡さず、ログイン方法を固定しない。
- サブスクリプション認証では従来どおり生成し、入力はstdinだけへ渡す。
- サブスクリプション以外の認証は`AI_ENABLE_PAID_API=true`のときだけ生成し、未設定ならプロバイダー呼び出し前に止める。未ログイン・状態取得失敗も同様に止める。
- 診断でサブスクリプション、従量課金の許可済み・未許可、未認証を区別する。
- 型・lint・Vitest・build、偽CLIを使う比較E2Eを実行する。実CLI・実アカウントの確認は未実施として残す。

### Task 20.3：新公開リポジトリへの移行用ソースと公開前確認

2026-11-15の明示依頼。新リポジトリ名は `AIfude_novel_editor`、ライセンスはApache-2.0、著作権者はmarc2825。公開に必要な整備・移行用フォルダの提供・残件の整理を一つのTaskとして扱う。対象：ライセンス・README・公開手順、公開書き出しscriptと回帰テスト、依存と配布内容の検査。本文編集・保存形式・プロバイダーの動作は変更しない。Acceptance Criteria：

- LICENSE / NOTICE / package.jsonのライセンス表示を揃え、第三者依存と同梱素材の確認範囲を記録する。
- コミットせず今回の修正を含められる明示的な書き出し方法を用意する。未指定の未追跡ファイル・履歴・認証情報・archive・生成物・symlinkを持ち込まず、元の作業状態を保持する。
- 移行フォルダと圧縮ファイルを提供し、ファイル内容・実行属性・相対文書リンクを確認する。
- 同じ配布内容の独立コピーでfrozen install・audit・check・build・標準／モバイル／PWA／同期E2Eを実行し、結果と未実施を区別する。
- 新リポジトリへの移行手順と、公開前／公開切替時に所有者が行う残件をまとめる。GitHub作成・commit・push・公開デプロイは行わない。

### Task 20.4：操作文字・ツールの視認性と開発時CSPの修正

2026-11-15の明示依頼。移行済みの `AIfude_novel_editor` を対象に、ツール・タブの小さい文字、右端ツールの識別しづらさ、開発時のReact evalエラーを一つのTaskとして修正する。対象：操作UIのCSS、WorkspaceLayoutと装飾アイコン、NextのCSP、関連テスト・仕様。本文編集・保存・AI送信処理、依存バージョンは変更しない。Acceptance Criteria：

- UIの基準文字を16px、主要なツール名を14px以上、作品タブを15pxにする。本文の文字サイズ設定は維持する。
- 右端のAIツールはアイコンと日本語名を併記し、選択・フォーカスを判別できる。native radioのキーボード操作を保ち、選択だけで本文変更・AI送信を行わない。
- 320〜1024px幅でも既存のパネル、候補、採用ボタンが操作でき、横方向にはみ出さない。
- 開発時のeval関連Console Errorを解消し、本番のページ／offline画面のCSPには `unsafe-eval` を含めない。
- 型・lint・関連component/unitテスト、build、デスクトップ／モバイル／PWA E2Eを実行する。実機IMEは未実施として明記する。commit・pushは行わない。

#### Task 20.4の変更・検査結果（2026-11-16）

変更ファイル：`src/app/globals.css`、`src/features/workspace/Workspace.module.css`、`WorkspaceLayout.tsx`、新規`WorkspaceIcon.tsx`、`src/features/ai-edit/AiEdit.module.css`、`src/features/editor/Editor.module.css`、`next.config.ts`。テストは `tests/unit/security-headers.test.ts`、`tests/e2e/bootstrap.spec.ts`、`tests/e2e/workspace-design.spec.ts`、`tests/pwa/offline.spec.ts`。文書は本計画、UX、SECURITY、DECISIONS。

Acceptance Criteriaはすべて自動検査で確認した。操作文字の拡大、装飾SVGと名称の併記、native radio・パネルのキーボード操作、選択だけでは本文・AI送信を変えない境界を維持。上部配置を詰め、本文の開始位置と幅も既存の基準を維持した。狭い画面で診断ボタンを遮る開発用ステータスバッジを非表示にしたが、コンパイル・実行時エラーの表示は維持している。

| 検査 | 結果 |
|---|---|
| `pnpm install --frozen-lockfile --offline` | 成功。依存追加・更新なし |
| `pnpm check` | 型・lint成功、85ファイル / 1,088テスト成功 |
| `pnpm test:e2e` | 105件成功（標準71、privacy 1、local 2、ChatGPT mock 2、比較6、モバイル23） |
| `pnpm build` | 成功。静的PWA資産24件も生成 |
| `pnpm test:e2e:pwa` | Chromium / WebKitの7件成功。本番CSP、オフライン保存・再起動・再接続も確認 |
| 操作部のaxe-core検査 | 1440 / 1024 / 390 / 320px幅で指摘0件。アプリ設定ナビ・執筆ツール・作品タブを対象にWCAG 2 A/AA・2.1 A/AAを検査 |
| 表示とキーボード | 同4幅のスクリーンショット確認、横はみ出しなし。矢印キーでのツール選択、Enterでパネルを開く、Escで戻る操作が成功 |

初回の全体検査では、使用中の3000番ポートとの競合でランチャー4件が失敗した。アプリを停止せず、`unshare --user --map-root-user --net --fork sh -c 'ip link set lo up && pnpm check'` でネットワークを隔離して全件の成功を確認した。初回E2Eで検出した本文の開始位置と開発バッジの重なりは修正し、上表の全E2Eを再実行した。テストのskipや許容範囲の緩和はしていない。

検査は同じソースの独立コピー、Node.js 24.21.0 / pnpm 10.34.5、Linuxで実施。ブラウザーの共有ライブラリは検査用の `LD_LIBRARY_PATH` / `NOVEL_WEBKIT_EXECUTABLE` で補い、製品の依存やOS設定を変更していない。反映時には変更対象の元ファイルhashを照合して、利用者の変更を上書きしないことを確認する。

実機の日本語IME、実スマホの長押し選択、実スクリーンリーダーは未実施。操作部の自動検査でそれらを検証済みとは扱わない。保存後に新リポジトリ側の開発サーバーを再起動して再読み込みする。本番起動の場合は再buildが必要。commit・push・次Taskへの着手は行わない。

### Task 20.5：文書の推敲と読み手別の整理

2026-11-16の依頼。READMEと関連文書の重複、回りくどい説明、作業報告と現行仕様の混在を整理する。

変更対象はREADME、SECURITY、docs配下の文書。READMEを概要・起動・入口に絞り、操作とAI接続を専用ガイドへまとめる。設計文書と過去の計画は用語を整え、仕様ID、制限値、コード例、判断の根拠を保つ。

完了条件：読み手が目的の手順に進めること、現行仕様と過去の記録を区別できること、文書リンクと例が整合すること。コード・依存・前回の画面修正を変えず、既存の差分を残す。文書検査と差分確認を行い、製品のテスト結果を今回の実行結果として流用しない。

確認結果：README・SECURITY・docsの27ファイルを編集（操作・接続ガイド2件を追加）。Pythonの文書検査で相対リンク80件・見出しアンカー・コードフェンスを確認し、エラー0件。契約の照合と `bash -n` でシェル例7件の構文、既存の要件・Task・Decision ID、契約表のフィールド名、モデルID、Node・pnpmの版を照合した。

コード・依存・前回の画面修正は変更しない。文書だけの変更のため、型・lint・build・製品テストは今回再実行していない。実AI・実機の確認状況と公開前の未完了項目は残す。変更前のファイル内容を照合して反映し、Git差分を確認して終了する。commit・pushは行わない。

### Task 20.6：AIツールの名称と目的別グループ

2026-11-17の明示依頼。「五感の描写」は残したまま、何をするツールか分かる名前に変える。右端のAIツールを、似た操作ごとにまとめる。対象：ツール定義、WorkspaceLayoutとCSS、関連E2E・文書。ツールID、AI送信内容、プロンプト、本文編集、保存、依存は変更しない。Acceptance Criteria：

- 「五感の描写」の表示名を「描写を足す」に変え、説明に五感・比喩・内面とカーソル位置への挿入を明記する。ID `describe` と英語名Describeは維持する。
- AIツールを「選択範囲を直す」（書き直し・文体変換・膨らませる・短くする・自由指示）、「カーソル位置に書く」（中間補完・続きを書く・文脈で挿入・描写を足す・展開を指定）、「語句を調べる」（辞書）の3グループで表示する。狭い画面のselectも同じグループで分ける。
- 各グループは見出し付きのfieldsetとし、radioの名前・矢印キーでのグループ間移動・44px以上の操作領域を保つ。見出しが増えても、1024×850pxで右端のパネルボタンが画面内に収まる。選択だけでは本文変更・AI送信を行わない。
- 型・lint・関連テスト、build、関連するデスクトップ／モバイルE2Eを実行する。実機IMEは対象外として明記する。commit・pushは行わない。

#### Task 20.6の変更・検査結果（2026-11-17）

変更ファイル：`src/features/ai-edit/writing-tools.ts`、`src/features/workspace/WorkspaceLayout.tsx`、`Workspace.module.css`。テストは `tests/e2e/workspace-design.spec.ts`（グループ・optgroup・グループ間の矢印キー）、`typography.spec.ts`、`dictionary.spec.ts`（新しい並び順に合わせた矢印キー操作）。文書はUSAGE、UX、本計画。

見出しの追加で、1024×850pxでは右端のパネルボタンが画面外に出た。そこで全体見出しを読み上げ専用にし、ツールの高さを64pxから48pxへ詰めた。最後のボタン下端は809pxになった。「描写を加える」は選択時の太字で折り返したため、「描写を足す」に変更した。

| 検査 | 結果 |
|---|---|
| `pnpm check`（ネットワーク隔離） | 型・lint成功、85ファイル / 1,088テスト成功 |
| 標準E2E（独立コピー） | 69件成功、2件失敗。失敗した `japanese-feedback.spec.ts:60` と `story-memory.spec.ts:47`（insert）は、変更前のHEADでも同じく失敗する。原因は開発サーバーのNext.js「Insight」バッジによるクリック遮断 |
| モバイルE2E（`pnpm build` を含む） | 23件成功 |

使用中の3000番ポートと衝突しないよう、`pnpm check` はネットワークを隔離して実行した。E2Eは独立コピーで実行し、ブラウザーの共有ライブラリは `LD_LIBRARY_PATH` で補った。Playwrightが起動する開発サーバーは起動直後に終了することがあった。そのため標準E2Eでは、同じ環境変数で手動起動したサーバーを再利用した。`next build` はNext.jsの脆弱性通知を出して初回だけ停止し、再実行で成功した。依存は更新していない。PWA・privacy・local等の別設定E2E、実機IME、スクリーンリーダーは未実施。commit・pushは行わない。

### Task 20.7：利用者向け文書の読みやすさの改善

2026-11-17の依頼。[yomiyasu](https://github.com/nanaism/yomiyasu)の文章規則を参考に、冗長さを減らし、人が読みやすい文書にする。今回は利用者が直接読むREADME、SECURITY、docs/USAGE、AI_CONNECTIONS、DEVELOPMENT、PUBLISHINGを対象とする。仕様書、決定記録、過去の計画、AGENTS.md、skillsは変更しない。Acceptance Criteria：

- 意味・制限値・コマンド・パス・UI名・リンク先を変えない。Task 20.6のツール分類の反映を除き、情報を追加・削除しない。
- 太字は警告だけに絞る。UI名は「」で示し、箇条書きの太字ラベルは外すか表にする。
- 操作ガイドの見出しと説明を画面のAIツールのグループ名に合わせ、記述の矛盾を直す。
- 相対リンクとアンカーを検査する。コード・テスト・依存は変更しない。commit・pushは行わない。

#### Task 20.7の変更・検査結果（2026-11-17）

変更ファイル：README、SECURITY、docs/USAGE、AI_CONNECTIONS、PUBLISHING。DEVELOPMENTは規則に当たる箇所がなく、変更していない。

太字は警告の2か所だけを残した（23か所→2か所）。UI名は「」で示し、箇条書きの太字ラベルを外した。AI接続の「つながらないとき」は症状と対処の表にした。操作ガイドでは、ツールの分類と選び方を「画面とキーボード」へまとめ、見出しを「選択範囲を直す」「カーソル位置に書く」に合わせた。AI文章挿入の開き方の記述も、新しい分類に合わせて直した。READMEは、起動ファイルがビルドする主語を明示し、ツールの3分類と案内先を分けた。

Pythonの文書検査で、全Markdownの相対リンク80件・見出しアンカー・コードフェンスを確認し、エラー0件。対象6文書でコードブロック・インラインコード・リンク先が変更前と一致し、追加された数値は分類数の「3」だけであることを確認した。コード・テスト・依存は変更していない。仕様書・決定記録・過去の計画・AGENTS.md・skillsは対象外。commit・pushは行わない。

### Task 20.8：CIの依存監査失敗の修正

2026-11-17の依頼。mainへのpush後、CIの `pnpm audit --audit-level=moderate` がNext.js 16.4.1の脆弱性（GHSA-mfr8-8qww-v76h、修正版16.4.5以降）で失敗した。`next` と `eslint-config-next` を同じマイナー版の16.4.6へ更新する。ほかの依存とアプリのコードは変更しない。Acceptance Criteria：

- `pnpm audit --audit-level=moderate` が0件になる。
- frozen install、`pnpm check`、build、CIと同じE2Eがローカルで通る。結果と未実施を区別して記録する。

#### Task 20.8の変更・検査結果（2026-11-17）

変更ファイル：`package.json`、`pnpm-lock.yaml`。lockfileではNext関連の16.4.6への更新に加え、ESLint resolverのWASM用optional依存 `@napi-rs/wasm-runtime` が既存の1.2.6へ統合された（1.2.4→1.2.6）。

| 検査 | 結果 |
|---|---|
| `pnpm install --frozen-lockfile` | 成功 |
| `pnpm audit --audit-level=moderate` | 脆弱性0件 |
| `pnpm check`（ネットワーク隔離） | 型・lint成功、85ファイル / 1,088テスト成功 |
| `pnpm build`（独立コピー） | 成功 |
| `pnpm test:e2e`（独立コピー） | 105件成功（標準71、privacy 1、local 2、ChatGPT mock 2、比較6、モバイル23） |
| `pnpm test:e2e:pwa` | Chromium / WebKitの7件成功 |
| `pnpm test:e2e:sync` | 2件成功 |

Task 20.6で開発サーバーのInsightバッジにより失敗した標準E2E 2件も成功した。ブラウザーの共有ライブラリは検査用の `LD_LIBRARY_PATH` と `NOVEL_WEBKIT_EXECUTABLE` で補った。GitHub上のCIはpush後に確認する。

### Task 20.12：商用禁止ライセンスへの変更

2026-11-18の依頼。ライセンスをApache-2.0からPolyForm Noncommercial License 1.0.0へ変える（[D-048](DECISIONS.md#d-048ライセンスをpolyform-noncommercial-100へ変更する)）。LICENSEは公式本文（polyform-licensesの1.0.0タグ、SHA-256 `c0ea4a89…fabbe5`）をそのまま置き、NOTICEに `Required Notice:` の著作権表示と旧版の扱いを書いた。package.jsonの `license`、README、BRANDING、PUBLISHING、THIRD_PARTY_LICENSES、PROVIDER_DISTRIBUTION_REVIEWを更新した。コードと依存は変更していない。commitは行わない。
