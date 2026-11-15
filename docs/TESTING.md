# Testing Strategy

## 方針

テストはeditor stateの安全性とデータ損失防止を最優先する。

LLMの文章品質を、通常CIの非決定的なAPI呼び出しで検証しない。

unit、integration、component、E2Eを分ける。

実APIのsmoke testは明示的な手動操作のみ。CIへ実APIキーを渡さない。

## Unit

対象：

- PM位置とplain-text offsetの変換
- LF serialization
- selectionの抽出
- input limit
- Edit Intent推定
- context組み立てとtruncation
- AI state machine
- request identity判定
- candidate validation
- Diffの文字単位
- save coordinator
- canonical provider/model registry、required capability、default解決

日本語、絵文字、結合文字、全角空白、空paragraph、先頭・末尾改行を含める。

## Editor-specific tests

実際のProseMirror EditorStateと採用schemaを使用する。

### E-01 Selection

単一段落、複数段落、逆方向選択、AllSelectionを検証する。

抽出文字列と実際の置換範囲が一致すること。

### E-02 Replacement

候補適用後の正規テキストがprefix＋replacement＋suffixに完全一致すること。

先頭・末尾の空段落、段落境界、複数LF、絵文字を含む。

### E-03 Range safety

選択範囲外の文字を変更しないこと。

置換Sliceを誤構築した場合にdispatchされないこと。

### E-04 Stale document

待機中に選択内、選択前、選択後のそれぞれを編集する。

どの場合も古い候補を適用できないこと。

### E-05 Stale selection

本文を変更せずcaretだけ動かす。

元のselectionへ戻しても、旧sessionが復活しないこと。

同じselectionを明示設定しただけなら誤って無効化しないこと。

### E-06 Instance

同じchapter IDと同じrevisionでも、editor instance IDが変われば拒否すること。

### E-07 History isolation

次の順序で確認する。

1. 手入力A。
2. AI Accept。
3. 直後に手入力B。
4. UndoでBだけ戻る。
5. UndoでAI適用だけ戻る。
6. UndoでAが戻る。
7. Redoで同じ順序を復元できる。

AI適用直後なら1回のUndoでAI変更だけが戻ること。

候補切替、Reject、失敗がUndo項目を増やさないこと。

### E-08 Double Accept

連続クリック、連続ショートカット、古いUI callbackで2回適用されないこと。

### E-09 Composition

composition中の起動とAcceptを拒否すること。

## Property-based tests

`fast-check`を使用し、plain-text schema内でランダムなparagraphと有効選択を生成する。

候補置換について以下を検証する。

- schemaに適合する。
- 正規テキストがprefix＋candidate＋suffixに一致する。
- Undoで元documentへ戻る。
- Redoで置換後documentへ戻る。

seedを失敗報告へ含める。

## Integration

### Editor session

PM plugin、AI controller、transportを接続する。

abort後にresolveするdeferred promiseを使う。

古いrequestのsuccessとerrorが、新しいsessionへ作用しないこと。

### Persistence

`fake-indexeddb`を用い、以下を検証する。

- 初期保存と再読み込み
- storage version比較
- 古いsave完了による保存済み表示の誤更新防止
- 保存中に新変更が発生した場合の直列化
- quota error
- importの原子的置換
- 不明schema versionで上書きしない
- 破損データを空文書へ置換しない
- WorkspaceSnapshot V1をV2の`automatic`へmigrationする
- model preferenceの保存、再読み込み、backup round-trip

Web Locksは実ブラウザーのE2Eでも確認する。

### API route

- body実測上限
- Content-Length偽装
- invalid JSON
- unknown fields
- origin/host不一致
- JSON以外のcontent type
- 同意なし
- provider未設定
- rate limit
- provider timeout
- refusal
- incomplete
- invalid schema
- 候補数違反
- 重複候補
- oversized output
- safe error response
- No-store header

### Provider contract

mock、ローカルLLM、OpenAI adapterが、同じアプリ側契約へ変換されること。

OpenAI SDKはmockし、requestにStructured Output、store false、stream false、token limit、AbortSignalが設定されることを確認する。

SDKの暗黙retryが無効であることも確認する。

## Component

Testing Libraryで以下を確認する。

- 有効selectionがない場合の案内
- popoverのlabelとfocus
- instruction validation
- candidate count変更
- Generating中のcontrols
- 候補tabのキーボード操作
- riskNotes表示
- stale時のAccept無効化
- ErrorとRetry
- 保存失敗表示
- 同意checkbox初期off
- AI error boundaryがeditorを巻き込まない
- Automaticと全対応modelの選択肢、説明、accessibility
- 利用不能な明示modelをfallbackせず表示する
- model変更でcontext revisionが増え、進行中AI sessionがstaleになる

## AI API mock

通常CIでは実APIへ接続しない。

- server側：`EditingProvider`をmockへ差し替える。
- client側：MSWまたはPlaywright route interceptionを使う。
- race test：deferred promiseで応答順序を制御する。

テスト用の遅延、失敗、任意出力を指定する公開API parameterを作らない。

mock modeは画面上で実AIと区別する。

## 必須E2E

### T-01 正常系

選択 → Cmd/Ctrl + K → 指示 → 2候補 → 候補切替 → Diff → Accept。

正しい範囲だけ置換されること。

### T-02 Reject

生成前後で本文がbyte相当の正規テキスト比較で一致すること。

### T-03 API failure

APIが500相当でも本文編集と保存が継続すること。

### T-04 Document stale

遅延応答中に本文を変更する。

応答後も採用できず、新しい本文が保持されること。

### T-05 Selection stale

遅延応答中にcaretを動かす。

旧候補が新しい位置へ適用されないこと。

### T-06 Retry race

request Aを遅延させ、Retryでrequest Bを開始する。

Bを先に返し、Aを後に返す。

Bだけが表示・採用可能であること。

### T-07 Undo / Redo

AI変更が1操作で戻り、直前・直後の手入力と結合しないこと。

### T-08 保存

編集後に再読み込みして復元されること。

AI失敗中の本文も保存されること。

### T-09 別タブ

2つ目のタブが読み取り専用になり、上書きできないこと。

### T-10 Keyboard only

マウスを使わず起動、生成、候補切替、Accept、Reject、Retry、Escができること。

### T-11 Privacy

未同意ではprovider呼び出しが0回であること。

network payloadに全文書、APIキー、PM位置が含まれないこと。

### T-12 Boundary cases

空選択、空白のみ、上限超過、複数段落、絵文字、末尾改行を検証する。

### T-13 Model settings

OpenAI runtimeを安全なserver fixtureで起動し、Settingsの全allowlist、Automatic、選択保存、再読み込み、Command表示、同一provider同意の維持を確認する。AI routeはinterceptし、実OpenAI networkを使用しない。

## Phase 9 / Task 9.1 自動検証対応表

必須E2Eと自動検証の正本は次のとおり。E2Eは実providerへ接続せず、local mockまたはbrowser route interceptionだけを使用する。

| ID | 主な証拠 |
|---|---|
| T-01 | `tests/e2e/command.spec.ts`：選択、生成、2候補、Diff、候補切替、明示Accept、厳密範囲置換。 |
| T-02 | `tests/e2e/critical-failures.spec.ts`：Preview後の却下、本文不変、reload後も不変。 |
| T-03 | `tests/e2e/critical-failures.spec.ts`：canonical 502後も本文編集、保存、reloadが継続し、内部messageを表示しない。 |
| T-04 | `tests/e2e/critical-failures.spec.ts`：遅延応答中の本文変更でstaleとなり、遅延候補を表示・適用しない。 |
| T-05 | `tests/e2e/critical-failures.spec.ts`：遅延応答中のselection-only移動でstaleとなり、本文を変更しない。 |
| T-06 | `tests/e2e/critical-failures.spec.ts`：Retryの新request IDと、cancel済みsession Aよりsession Bを先に完了してAを後着させる応答所有権。`tests/integration/editor-session.test.ts`と`tests/unit/ai-machine.test.ts`で両応答順と古いsuccess/errorを補完。 |
| T-07 | `tests/e2e/command.spec.ts`と`tests/e2e/keyboard-boundary.spec.ts`：AcceptのUndo/Redo。`tests/integration/editor-session.test.ts`で前後の手入力とのhistory分離。 |
| T-08 | `tests/e2e/command.spec.ts`、`tests/e2e/persistence.spec.ts`、`tests/e2e/critical-failures.spec.ts`：通常編集、Accept、API失敗後編集の保存とreload。 |
| T-09 | `tests/e2e/persistence.spec.ts`：2タブ目のread-only、AI起動・networkなし、lock解放後の再取得。 |
| T-10 | `tests/e2e/keyboard-boundary.spec.ts`：Cmd/Ctrl+K、生成、tab移動、候補矢印、Accept、Retry、Reject、Esc。 |
| T-11 | `tests/e2e/privacy.spec.ts`：同意の保存・reload・撤回、同意前request 0件、bounded payload、secret/PM位置なし。専用OpenAI runtime fixtureでも実provider networkは使用しない。 |
| T-12 | `tests/e2e/keyboard-boundary.spec.ts`：caret、空白のみ、2,001文字、複数段落、emoji、全角空白、末尾空段落。 |
| T-13 | `tests/e2e/privacy.spec.ts`：Automaticと全allowlist、明示modelの保存・reload・Command反映・同意維持。 |

ブラウザーから直接観測しにくい障害は次の層で補完する。

- `tests/components/workspace.test.tsx`：Acceptと進行中saveの直列化、Preview中の保存失敗、Accept直後のquota failureからの回復、AI生成中importによるabortとeditor置換。
- `tests/components/ai-error-boundary.test.tsx`：AI描画障害を本文から隔離し、本文を保持した明示的な復旧。
- `tests/components/command.test.tsx`：Accept前のdocument/history不変、二重操作、stale全分類、HTML風文字列、Diff Worker失敗、synthetic IME。
- `tests/integration/ai-edit-route.test.ts`、`tests/integration/ai-edit-service.test.ts`、`tests/unit/openai-provider.test.ts`：disabled、origin/body/consent/rate limit、refusal/incomplete/invalid output、30秒deadline、provider失敗taxonomy。
- `tests/unit/ai-machine.test.ts`：35秒client timeout、AbortSignalを無視するtransport、request ownership。

`pnpm test:e2e`は通常mock構成、privacy用OpenAI runtime fixture、ローカルLLM構成、ChatGPTサブスク構成、複数AI比較構成を直列実行する。CIも同じcommandを使い、実APIキーや外部LLMを必要としない。

Task 12.1では次を追加する。

| 対象 | 検証 |
| --- | --- |
| `prompt-insertion.test.ts` | 実PMで空document・段落境界・emoji・最大長・80例のproperty・stale・Undo/Redo・abort無視の遅延応答・プロンプトのみ送信 |
| `ai-comparison.test.ts`（integration） | 並列開始・同一入力・部分失敗・対象/同意/Origin拒否・API OFF・応答identity・abort無視・選択候補の採用・route間共有rate limit |
| `claude-cli-provider.test.ts` / `cloud-api-provider.test.ts` | subscription認証限定・stdin・CLI制限/終了・Unicode分割・出力上限・4社APIの固定URL/形式・refusal/incomplete/不正JSON・retryなし・遅延応答 |
| `ai-comparison.test.tsx` / `workspace.test.tsx` | API初期OFF / reload OFF・選択最大3件・対象変更で比較同意解除・本文と保存設定の不変 |
| `prompt-insertion.spec.ts` / `ai-comparison.spec.ts` | 挿入・置換の並列比較・明示採用・Undo/Redo・保存reload・部分失敗・3provider比較（偽Claude CLI） |

CLI child-processテストはテスト用Nodeプロセスを使用する。`tests/fixtures/claude-cli.mjs`は認証・推論の応答を返す専用fixtureで、実Claude CLI / credential / ネットワークへ接続しない。これらの成功を実サブスク認証や文章品質の検証と扱わない。

Task 13.1では次を追加する。

| 対象 | 検証 |
| --- | --- |
| `tests/unit/story-memory.test.ts` | 2,000 / 2,001コードポイント・不正Unicode・strict schema、OFF省略、ONのJSON data分離、完全なメモ維持と予算拒否、provider呼び出し0回、応答文字数metadata |
| `tests/unit/workspace.test.ts` / `backup.test.ts`、`tests/integration/workspace-repository.test.ts` | version 1 / 2から3のmigration、model設定・本文保持、非破壊readとstorage競合、メモ付きbackup round trip |
| `tests/integration/story-memory.test.ts` / `ai-comparison.test.ts` | 新セッションOFF、参照切替で旧候補破棄、全providerへ同じメモ、メモ変更stale、abort無視の後着応答拒否、revision更新漏れでも実値guard、置換・挿入AcceptとUndo/Redo、client予算超過で送信0回 |
| `tests/components/story-memory.test.tsx` / `workspace.test.tsx` | 保存失敗と同値再試行、上限・read-only、ON/OFF・予算案内、本文・editor instance・Undo不変、保存reload |
| `tests/e2e/story-memory.spec.ts` / `ai-comparison.spec.ts` | 3欄の保存・reload・JSON export/import、置換・挿入のOFF→ON→明示Accept・Undo/Redo・新セッションOFF、生成中のメモ変更staleと本文編集継続、2AIへのON同時送信 |

保存状態のE2E locatorは「保存済み」への完全一致を使う。「保存済み作品メモリを参照する」という操作ラベルを保存完了と誤認しない。ローカルproviderで不要な送信同意はcheckbox全件数ではなく同意labelで検証する。componentの初回editor生成は状態条件を最大3秒待つ（固定sleepを使用しない）。

Task 14.1では`workspace-files.test.ts`と`workspace-files.spec.ts`、既存のworkspace / story-memory / repository検査を追加・拡張する。

| 対象 | 検証 |
| --- | --- |
| domain / controller | 項目選択による未選択内容の除外・予算削減、metadata、旧候補破棄、ONで選択0件なら送信0回 |
| file reader | UTF-8とCRLF・空行・末尾改行・emoji、JSONのID再発行と本文・メモ保持、同意reset、不正形式・過大入力拒否 |
| repository | database 1→2の非破壊upgrade、2作品の原子的交換と個別version維持、stale reference・不正target・backup ID衝突拒否、削除後の別作品の再open |
| component | 未保存draftの変更・取消・保存失敗、beforeunload、Cmd/Ctrl + S、初回保存失敗の再保存と切替中止、取込取消、AI処理中の切替取消、切替前のflush失敗とactivate失敗、切替直後の入力、閉じたタブの再open、abort無視の古いAI応答 |
| E2E | 実reloadのbeforeunload確認と取消、メモ警告によるbackup取消、複数作品の保存・切替・閉じる・再open・reload、JSON download / 新規open、.txt open、項目別参照と予算、旧AI応答の隔離 |

離脱確認はユーザー操作済みのChromiumで検証し、native IMEやすべてのbrowserの保証と扱わない。通常CIは実AIへ接続しない。

ローカルLLMは`tests/unit/local-provider.test.ts`、`tests/integration/local-service.test.ts`でJSON Schema request、応答上限、refusal / incomplete / invalid output、180秒deadline、abortを無視する遅延応答、クラウドmodel指定の拒否を確認する。`tests/integration/editor-session.test.ts`はローカル生成が35秒で打ち切られず、本文不変のままPreviewへ進むことを確認する。`playwright.local.config.ts`はloopback HTTP fixtureへ実adapterから接続し、未同意での局所編集、明示採用、Undo/Redo、保存・reload、推論失敗中の編集継続を検証する。このfixtureは実LLMの推論品質・実モデル互換性の証拠ではない。実機smoke testはREADMEの手順で別途記録する。

ChatGPTは`tests/integration/chatgpt-auth.test.ts`でstate / PKCE / identity / scope / credential保護・refresh競合・解除後の遅延認証を確認する。`tests/unit/chatgpt-provider.test.ts`と`tests/integration/chatgpt-service.test.ts`はaccount catalog、SSE分割、拒否・未完了・利用枠不足、上限超過、遅延応答、共通候補検証を確認する。`tests/unit/chatgpt-handler.test.ts`は同一origin・安全なstatus・明示操作を確認する。`tests/components/chatgpt-connection.test.tsx`と`tests/integration/chatgpt-controller.test.ts`は古いstatusと接続変更時のstaleを確認する。

`playwright.chatgpt.config.ts`のE2Eは認証とAI routeをinterceptし、接続UI、初回の利用枠案内、別途の外部送信同意、採用・Undo/Redo・保存、利用枠不足、候補表示中の接続解除を確認する。実OpenAI endpointへのアクセスは行わず、実OAuth・実推論を検証したとは扱わない。

## IME実機確認

自動テストだけでは完了扱いにしない。

最低限、次の組み合わせで手動確認する。

- macOSの日本語IMEとChromium系ブラウザー
- WindowsのMicrosoft IMEとChromium系ブラウザー

確認項目：

- 変換中にCmd/Ctrl + Kで入力が壊れない。
- Enterによる変換確定で生成しない。
- Escによる変換取消でAI UIを誤操作しない。
- AI Accept後も変換・入力を継続できる。
- 指示欄でも同様に動作する。

OS、ブラウザーバージョン、確認日、結果を実施時に記録する。

未実施なら「未実施」と報告する。

## Accessibility

自動検査とkeyboard-only確認を併用する。

focusの消失、到達不能button、誤ったmodal扱い、読み上げ過多を確認する。

## Performance

10万コードポイント、約2,000段落のfixtureを用意する。

入力、snapshot取得、保存、Diff timeoutを測定する。

CIの不安定な時間閾値だけで合否を決めない。基準端末と測定条件を記録する。

本文入力のたびに全文Diffやprovider prompt生成が走っていないことを確認する。

## CI

Phase 0以降はtypecheck、lint、Vitest、buildを必須にする。

E2E導入後はmockのみでcritical flowをCIへ追加する。

テスト不存在を隠す`passWithNoTests`設定を使用しない。

failしたテストをskipして通過扱いにしない。


## 基本執筆機能（Task 15.1）

- `chapters.test.ts`：schema 3 migration、複数章の参照・順番・重複拒否、Unicode文字数。
- `search-replace.test.ts`：literal / case / 絵文字 / 改行、空置換、readonly / composition / stale拒否、単一Undo / Redo。
- `writing-library.test.ts`：全作品・章・メモ・履歴round trip、コピーID対応、同意reset、不正／将来／過大backup、CAS、同期quota失敗の全体rollback、履歴50件と作品削除。
- `editor-sessions.test.ts`：live Editor再利用とUndo / selection分離、revision一致時のcaret復元、localStorage破損・quota、Strict Mode disposal。
- `workspace.test.tsx`：未保存アウトライン、章保存失敗、履歴取消／復元前checkpoint、自動履歴opt-in／quotaで本文保持、章を往復した同じPMへのabort無視の遅延AI応答拒否。
- `writing-tools.spec.ts`：章管理と進捗保存、作品／章Undoとcaret、閉じたtabのreload、検索置換の確認／stale／Undo、メモを含む履歴previewと復元、一括backup／コピー復元の取消とreload。

実LLMの認証／推論とOS日本語IMEは未実施。合成compositionとChromiumの自動操作を実機IMEの代替と報告しない。

## 優先機能の保護境界（Task 16.1）

- `trash.test.ts`：履歴なし・最新PM本文・全章・メモの復元、ID衝突時コピー、章の新IDと順番、CAS、同期quota rollback、不正version／参照／履歴重複、旧backup移行とごみ箱だけのbackup。
- `ai-connection-settings.test.ts`：server-only fileの600権限、lock / revision / atomic save、未来version・symlink拒否、公開情報の秘匿、env overlayと不正設定時のAI停止。
- `connection-diagnostics.test.ts` / `ai-connections-handler.test.ts`：認証／metadataだけの通信、API二重許可、本文フィールド拒否、origin、HTTP失敗、期限・容量、abort無視の遅延応答とrevision変更。
- `ai-connection-settings.test.tsx` / `workspace.test.tsx`：明示load、保存失敗後のdraft保持と再試行、診断取消／乱順、API初期OFF、作品設定draftとCtrl+S、取消でPreview保持、履歴なし復元、接続変更で旧AI応答破棄、AI設定の保存失敗でも原稿・作品draftを保存。
- `priority-tools.spec.ts`：実browserのbeforeunload取消と設定保存／reload、章・作品の復元と完全削除確認、再起動なしの接続保存、loopback fixtureへのGET modelsだけの診断、本文不変とAPI OFF。

Playwrightの全設定は専用の一時AI設定fileを使用し、実ユーザー設定を更新しない。実サブスク・APIやローカル推論エンジンを使わず、HTTP fixtureとinterceptionで検証する。

## PC起動ランチャー（Task 17.1）

`tests/unit/launcher.test.ts`は起動識別子の一致、不正／過大health応答、abortを無視して遅延するfetch、準備待ちdeadline、OS別browser command、公開health応答の秘匿を確認する。`tests/integration/launcher.test.ts`は実Node子processとloopback fixtureでbuild→start、二重起動、port競合、build／start失敗、残存／不正lock、build中の取消、SIGTERMを無視するprocessの強制終了、作業directory・空白を含むpathを検証する。実AI・認証は使用しない。

最終smokeでは専用のAI設定pathとmock providerを使い、実ランチャー経由のproduction build・起動・healthとbrowserでの編集保存・reloadを確認する。Windows / macOS GUIでのダブルクリック、OS日本語IMEは別途人手確認とする。

## 新ロードマップPhase 1：スマホ幅とタップ

`playwright.mobile.config.ts` / `tests/mobile/mobile.spec.ts` はPixel 7のChromium phone emulationとloopback mockを使う。6幅、9ツール、本文への退避/再表示とdraft/候補保持、候補比較と同意、タップAccept/Undo/Redo/保存reload、章・未保存入力・回転、遅延応答のstaleを検証。`pnpm test:e2e`の最後に実行する。DOM Rangeでネイティブ選択の結果を再現するため、OSの選択handle操作の証拠とはしない。

componentではタッチcontextmenuの非取消、composition中のpointer/Undo/Redo拒否、VisualViewport縮小/scroll時のsnapshot/draft不変、背景化保存の完了前表示とquota失敗→再試行を確認する。jsdomにはRange layoutがないため、履歴componentだけscroll処理をstubし、実際のscrollはE2Eで検証する。

iOS/Android実機、Windows/macOS IME、物理keyboard、screen reader、実モデル品質、モバイル実機性能は別のNOT RUN gate。検査件数と失敗修正はroadmap/PHASE_1_REPORT.mdに記録する。

## 新ロードマップPhase 2

`japanese-diagnostics.test.ts`で語境界・Unicode・100k文字・検査上限、`diagnostic-anchors.test.ts`でPM位置/Undo/失効、`feedback-route.test.ts`で同意/Origin/上限/遅延応答、`feedback.test.tsx`で明示送信と変更後の破棄を検証する。`tests/e2e/japanese-feedback.spec.ts`はWorker/下線/無視/個別採用/保存reload/AI準備/読み取り専用コメント/狭幅の遅延応答を確認。規則検出と実LLMの品質評価を区別する。
