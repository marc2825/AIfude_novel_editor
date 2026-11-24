# テスト方針

## 方針

テストはエディタ stateの安全性とデータ損失防止を最優先する。LLMの文章品質を、通常CIの非決定的なAPI呼び出しで検証しない。unit、integration、component、E2Eを分ける。実APIのsmoke testは明示的な手動操作のみ。CIへ実APIキーを渡さない。

## 単体テスト

対象：

- PM位置とplain-text offsetの変換
- LF serialization
- 選択範囲の抽出
- input limit
- Edit Intent推定
- context組み立てとtruncation
- AI state machine
- リクエスト identity判定
- 候補 validation
- Diffの文字単位
- save coordinator
- canonical provider/model 定義一覧、required 対応機能、既定値解決

日本語、絵文字、結合文字、全角空白、空paragraph、先頭・末尾改行を含める。

## エディタの必須テスト

実際のProseMirror EditorStateと採用スキーマを使用する。

### E-01 Selection

単一段落、複数段落、逆方向選択、AllSelectionを検証する。抽出文字列と実際の置換範囲が一致すること。

### E-02 Replacement

候補適用後の正規テキストがprefix＋replacement＋suffixに完全一致すること。先頭・末尾の空段落、段落境界、複数LF、絵文字を含む。

### E-03 Range safety

選択範囲外の文字を変更しないこと。置換Sliceを誤構築した場合にdispatchされないこと。

### E-04 Stale document

待機中に選択内、選択前、選択後のそれぞれを編集する。どの場合も古い候補を適用できないこと。

### E-05 Stale 選択範囲

本文を変更せずカーソルだけ動かす。元の選択範囲へ戻しても、旧セッションが復活しないこと。同じ選択範囲を明示設定しただけなら誤って無効化しないこと。

### E-06 Instance

同じchapter IDと同じリビジョンでも、エディタ インスタンス IDが変われば拒否すること。

### E-07 History isolation

次の順序で確認する。

1. 手入力A。
2. AI Accept。
3. 直後に手入力B。
4. UndoでBだけ戻る。
5. UndoでAI適用だけ戻る。
6. UndoでAが戻る。
7. Redoで同じ順序を復元できる。

AI適用直後なら1回のUndoでAI変更だけが戻ること。候補切替、Reject、失敗がUndo項目を増やさないこと。

### E-08 Double Accept

連続クリック、連続ショートカット、古いUI callbackで2回適用されないこと。

### E-09 Composition

composition中の起動とAcceptを拒否すること。

## プロパティベーステスト

`fast-check`を使用し、plain-text スキーマ内でランダムなparagraphと有効選択を生成する。候補置換について以下を検証する。

- スキーマに適合する。
- 正規テキストがprefix＋候補＋suffixに一致する。
- Undoで元documentへ戻る。
- Redoで置換後documentへ戻る。

seedを失敗報告へ含める。

## 結合テスト

### 編集セッション

PM plugin、AI コントローラー、transportを接続する。中止後にresolveするdeferred promiseを使う。古いリクエストのsuccessとerrorが、新しいセッションへ作用しないこと。

### 保存

`fake-indexeddb`を用い、以下を検証する。

- 初期保存と再読み込み
- storage バージョン比較
- 古いsave完了による保存済み表示の誤更新防止
- 保存中に新変更が発生した場合の直列化
- 容量制限 error
- 取り込みの原子的置換
- 不明スキーマバージョンで上書きしない
- 破損データを空文書へ置換しない
- WorkspaceSnapshot V1をV2の`automatic`へmigrationする
- モデル preferenceの保存、再読み込み、バックアップ round-trip

Web Locksは実ブラウザーのE2Eでも確認する。

### APIルート

- body実測上限
- Content-Length偽装
- invalid JSON
- unknown fields
- origin/host不一致
- JSON以外のcontent type
- 同意なし
- プロバイダー未設定
- rate limit
- プロバイダータイムアウト
- refusal
- incomplete
- invalid スキーマ
- 候補数違反
- 重複候補
- oversized output
- 公開用のエラー応答
- No-store header

### プロバイダーの契約

mock、ローカルLLM、OpenAI adapterが、同じアプリ側契約へ変換されること。OpenAI SDKはmockし、リクエストにStructured Output、store false、ストリーム false、トークン limit、AbortSignalが設定されることを確認する。SDKの暗黙再試行が無効であることも確認する。

## コンポーネントテスト

Testing Libraryで以下を確認する。

- 有効選択範囲がない場合の案内
- ポップオーバーのlabelとフォーカス
- instruction validation
- 候補 count変更
- Generating中のcontrols
- 候補タブのキーボード操作
- riskNotes表示
- stale時のAccept無効化
- ErrorとRetry
- 保存失敗表示
- 同意checkbox初期off
- AI error boundaryがエディタを巻き込まない
- Automaticと全対応モデルの選択肢、説明、accessibility
- 利用不能な明示モデルを代替への切替せず表示する
- モデル変更でcontext リビジョンが増え、進行中AIセッションがstaleになる

## AI APIのモック

通常CIでは実APIへ接続しない。

- サーバー側：`EditingProvider`をmockへ差し替える。
- クライアント側：MSWまたはPlaywright route interceptionを使う。
- race test：deferred promiseで応答順序を制御する。

テスト用の遅延、失敗、任意出力を指定する公開API parameterを作らない。mock modeは画面上で実AIと区別する。

## 必須E2E

### T-01 正常系

選択 → Cmd/Ctrl + K → 指示 → 2候補 → 候補切替 → Diff → Accept。正しい範囲だけ置換されること。

### T-02 Reject

生成前後で本文がバイト相当の正規テキスト比較で一致すること。

### T-03 API failure

APIが500相当でも本文編集と保存が継続すること。

### T-04 Document stale

遅延応答中に本文を変更する。応答後も採用できず、新しい本文が保持されること。

### T-05 Selection stale

遅延応答中にカーソルを動かす。旧候補が新しい位置へ適用されないこと。

### T-06 Retry race

リクエスト Aを遅延させ、Retryでリクエスト Bを開始する。Bを先に返し、Aを後に返す。Bだけが表示・採用可能であること。

### T-07 Undo / Redo

AI変更が1操作で戻り、直前・直後の手入力と結合しないこと。

### T-08 保存

編集後に再読み込みして復元されること。AI失敗中の本文も保存されること。

### T-09 別タブ

2つ目のタブが読み取り専用になり、上書きできないこと。

### T-10 Keyboard only

マウスを使わず起動、生成、候補切替、Accept、Reject、Retry、Escができること。

### T-11 Privacy

未同意ではプロバイダー呼び出しが0回であること。network 送信データに全文書、APIキー、PM位置が含まれないこと。

### T-12 Boundary cases

空選択、空白のみ、上限超過、複数段落、絵文字、末尾改行を検証する。

### T-13 Model settings

OpenAI runtimeを安全なサーバーテスト用データで起動し、Settingsの全許可リスト、Automatic、選択保存、再読み込み、Command表示、同一プロバイダー同意の維持を確認する。AI routeはinterceptし、実OpenAI networkを使用しない。

## Phase 9 / Task 9.1 自動検証対応表

必須E2Eと自動検証の正本は次のとおり。E2Eは実プロバイダーへ接続せず、local mockまたはブラウザー route interceptionだけを使用する。

| ID | 主な証拠 |
|---|---|
| T-01 | `tests/e2e/command.spec.ts`：選択、生成、2候補、Diff、候補切替、明示Accept、厳密範囲置換。 |
| T-02 | `tests/e2e/critical-failures.spec.ts`：Preview後の却下、本文不変、再読み込み後も不変。 |
| T-03 | `tests/e2e/critical-failures.spec.ts`：canonical 502後も本文編集、保存、再読み込みが継続し、内部messageを表示しない。 |
| T-04 | `tests/e2e/critical-failures.spec.ts`：遅延応答中の本文変更でstaleとなり、遅延候補を表示・適用しない。 |
| T-05 | `tests/e2e/critical-failures.spec.ts`：遅延応答中のselection-only移動でstaleとなり、本文を変更しない。 |
| T-06 | `tests/e2e/critical-failures.spec.ts`：Retryの新リクエストIDと、cancel済みセッション Aよりセッション Bを先に完了してAを後着させる応答所有権。`tests/integration/editor-session.test.ts`と`tests/unit/ai-machine.test.ts`で両応答順と古いsuccess/errorを補完。 |
| T-07 | `tests/e2e/command.spec.ts`と`tests/e2e/keyboard-boundary.spec.ts`：AcceptのUndo/Redo。`tests/integration/editor-session.test.ts`で前後の手入力とのhistory分離。 |
| T-08 | `tests/e2e/command.spec.ts`、`tests/e2e/persistence.spec.ts`、`tests/e2e/critical-failures.spec.ts`：通常編集、Accept、API失敗後編集の保存と再読み込み。 |
| T-09 | `tests/e2e/persistence.spec.ts`：2タブ目のread-only、AI起動・networkなし、ロック解放後の再取得。 |
| T-10 | `tests/e2e/keyboard-boundary.spec.ts`：Cmd/Ctrl+K、生成、タブ移動、候補矢印、Accept、Retry、Reject、Esc。 |
| T-11 | `tests/e2e/privacy.spec.ts`：同意の保存・再読み込み・撤回、同意前リクエスト 0件、bounded 送信データ、secret/PM位置なし。専用OpenAI runtime テスト用データでも実プロバイダー networkは使用しない。 |
| T-12 | `tests/e2e/keyboard-boundary.spec.ts`：カーソル、空白のみ、2,001文字、複数段落、emoji、全角空白、末尾空段落。 |
| T-13 | `tests/e2e/privacy.spec.ts`：Automaticと全許可リスト、明示モデルの保存・再読み込み・Command反映・同意維持。 |

ブラウザーから直接観測しにくい障害は次の層で補完する。

- `tests/components/workspace.test.tsx`：Acceptと進行中saveの直列化、Preview中の保存失敗、Accept直後の容量制限 failureからの回復、AI生成中取り込みによる中止とエディタ置換。
- `tests/components/ai-error-boundary.test.tsx`：AI描画障害を本文から隔離し、本文を保持した明示的な復旧。
- `tests/components/command.test.tsx`：Accept前のdocument/history不変、二重操作、stale全分類、HTML風文字列、Diff Worker失敗、synthetic IME。
- `tests/integration/ai-edit-route.test.ts`、`tests/integration/ai-edit-service.test.ts`、`tests/unit/openai-provider.test.ts`：disabled、origin/body/consent/rate limit、refusal/incomplete/invalid output、30秒制限時間、プロバイダー失敗taxonomy。
- `tests/unit/ai-machine.test.ts`：35秒クライアント タイムアウト、AbortSignalを無視するtransport、リクエスト ownership。

`pnpm test:e2e`は通常mock構成、privacy用OpenAI runtime テスト用データ、ローカルLLM構成、ChatGPTサブスク構成、複数AI比較構成を直列実行する。CIも同じcommandを使い、実APIキーや外部LLMを必要としない。Task 12.1では次を追加する。

| 対象 | 検証 |
| --- | --- |
| `prompt-insertion.test.ts` | 実PMで空document・段落境界・emoji・最大長・80例のproperty・stale・Undo/Redo・中止無視の遅延応答・プロンプトのみ送信 |
| `ai-comparison.test.ts`（integration） | 並列開始・同一入力・部分失敗・対象/同意/Origin拒否・API OFF・応答identity・中止無視・選択候補の採用・route間共有rate limit |
| `claude-cli-provider.test.ts` / `cloud-api-provider.test.ts` | サブスクリプション認証限定・stdin・CLI制限/終了・Unicode分割・出力上限・4社APIの固定URL/形式・refusal/incomplete/不正JSON・再試行なし・遅延応答 |
| `ai-comparison.test.tsx` / `workspace.test.tsx` | API初期OFF / 再読み込み OFF・選択最大3件・対象変更で比較同意解除・本文と保存設定の不変 |
| `prompt-insertion.spec.ts` / `ai-comparison.spec.ts` | 挿入・置換の並列比較・明示採用・Undo/Redo・保存再読み込み・部分失敗・3provider比較（偽Claude CLI） |

CLI child-processテストはテスト用Nodeプロセスを使用する。`tests/fixtures/claude-cli.mjs`は認証・推論の応答を返す専用テスト用データで、実Claude CLI / 認証情報 / ネットワークへ接続しない。これらの成功を実サブスク認証や文章品質の検証と扱わない。

Task 13.1では次を追加する。

| 対象 | 検証 |
| --- | --- |
| `tests/unit/story-memory.test.ts` | 2,000 / 2,001コードポイント・不正Unicode・strict スキーマ、OFF省略、ONのJSON data分離、完全なメモ維持と予算拒否、プロバイダー呼び出し0回、応答文字数メタデータ |
| `tests/unit/workspace.test.ts` / `backup.test.ts`、`tests/integration/workspace-repository.test.ts` | バージョン 1 / 2から3のmigration、モデル設定・本文保持、非破壊readとstorage競合、メモ付きバックアップ 書き出しと復元 |
| `tests/integration/story-memory.test.ts` / `ai-comparison.test.ts` | 新セッションOFF、参照切替で旧候補破棄、全プロバイダーへ同じメモ、メモ変更stale、中止無視の後着応答拒否、リビジョン更新漏れでも実値検証、置換・挿入AcceptとUndo/Redo、クライアント予算超過で送信0回 |
| `tests/components/story-memory.test.tsx` / `workspace.test.tsx` | 保存失敗と同値再試行、上限・read-only、ON/OFF・予算案内、本文・エディタ インスタンス・Undo不変、保存再読み込み |
| `tests/e2e/story-memory.spec.ts` / `ai-comparison.spec.ts` | 3欄の保存・再読み込み・JSON export/import、置換・挿入のOFF→ON→明示Accept・Undo/Redo・新セッションOFF、生成中のメモ変更staleと本文編集継続、2AIへのON同時送信 |

保存状態のE2E locatorは「保存済み」への完全一致を使う。「保存済み作品メモリを参照する」という操作ラベルを保存完了と誤認しない。ローカルプロバイダーで不要な送信同意はcheckbox全件数ではなく同意labelで検証する。componentの初回エディタ生成は状態条件を最大3秒待つ（固定sleepを使用しない）。

Task 14.1では`workspace-files.test.ts`と`workspace-files.spec.ts`、既存のworkspace / story-memory / repository検査を追加・拡張する。

| 対象 | 検証 |
| --- | --- |
| domain / controller | 項目選択による未選択内容の除外・予算削減、メタデータ、旧候補破棄、ONで選択0件なら送信0回 |
| ファイル reader | UTF-8とCRLF・空行・末尾改行・emoji、JSONのID再発行と本文・メモ保持、同意初期化、不正形式・過大入力拒否 |
| repository | database 1→2の非破壊upgrade、2作品の原子的交換と個別バージョン維持、stale reference・不正target・バックアップ ID衝突拒否、削除後の別作品の再open |
| component | 未保存の入力の変更・取消・保存失敗、beforeunload、Cmd/Ctrl + S、初回保存失敗の再保存と切替中止、取込取消、AI処理中の切替取消、切替前のflush失敗とactivate失敗、切替直後の入力、切替メニューからの作品の再open、中止無視の古いAI応答 |
| E2E | 実再読み込みのbeforeunload確認と取消、メモ警告によるバックアップ取消、複数作品の保存・切替・閉じる・再open・再読み込み、JSON download / 新規open、.txt open、項目別参照と予算、旧AI応答の隔離 |

離脱確認はユーザー操作済みのChromiumで検証し、native IMEやすべてのブラウザーの保証と扱わない。通常CIは実AIへ接続しない。

ローカルLLMは`tests/unit/local-provider.test.ts`、`tests/integration/local-service.test.ts`でJSON Schema リクエスト、応答上限、refusal / incomplete / invalid output、180秒制限時間、中止を無視する遅延応答、クラウドモデル指定の拒否を確認する。`tests/integration/editor-session.test.ts`はローカル生成が35秒で打ち切られず、本文不変のままPreviewへ進むことを確認する。`playwright.local.config.ts`はループバック HTTP テスト用データへ実adapterから接続し、未同意での局所編集、明示採用、Undo/Redo、保存・再読み込み、推論失敗中の編集継続を検証する。このテスト用データは実LLMの推論品質・実モデル互換性の証拠ではない。実機smoke testはREADMEの手順で別途記録する。

ChatGPTは`tests/integration/chatgpt-auth.test.ts`でstate / PKCE / identity / 範囲 / 認証情報保護・refresh競合・解除後の遅延認証を確認する。`tests/unit/chatgpt-provider.test.ts`と`tests/integration/chatgpt-service.test.ts`はaccount catalog、SSE分割、拒否・未完了・利用枠不足、上限超過、遅延応答、共通候補検証を確認する。`tests/unit/chatgpt-handler.test.ts`は同一origin・安全なstatus・明示操作を確認する。`tests/components/chatgpt-connection.test.tsx`と`tests/integration/chatgpt-controller.test.ts`は古いstatusと接続変更時のstaleを確認する。

`playwright.chatgpt.config.ts`のE2Eは認証とAI routeをinterceptし、接続UI、初回の利用枠案内、別途の外部送信同意、採用・Undo/Redo・保存、利用枠不足、候補表示中の接続解除を確認する。実OpenAI エンドポイントへのアクセスは行わず、実OAuth・実推論を検証したとは扱わない。

## IME実機確認

自動テストだけでは完了扱いにしない。最低限、次の組み合わせで手動確認する。

- macOSの日本語IMEとChromium系ブラウザー
- WindowsのMicrosoft IMEとChromium系ブラウザー

確認項目：

- 変換中にCmd/Ctrl + Kで入力が壊れない。
- Enterによる変換確定で生成しない。
- Escによる変換取消でAI UIを誤操作しない。
- AI Accept後も変換・入力を継続できる。
- 指示欄でも同様に動作する。

OS、ブラウザーバージョン、確認日、結果を実施時に記録する。未実施なら「未実施」と報告する。

## アクセシビリティ

自動検査とkeyboard-only確認を併用する。フォーカスの消失、到達不能ボタン、誤ったmodal扱い、読み上げ過多を確認する。

## 性能

10万コードポイント、約2,000段落のテスト用データを用意する。入力、snapshot取得、保存、Diff タイムアウトを測定する。CIの不安定な時間閾値だけで合否を決めない。基準端末と測定条件を記録する。本文入力のたびに全文Diffやプロバイダー プロンプト生成が走っていないことを確認する。

## CI

Phase 0以降はtypecheck、lint、Vitest、buildを必須にする。E2E導入後はmockのみでcritical flowをCIへ追加する。テスト不存在を隠す`passWithNoTests`設定を使用しない。failしたテストをskipして通過扱いにしない。

## 基本執筆機能（Task 15.1）

- `chapters.test.ts`：スキーマ 3 migration、複数章の参照・順番・重複拒否、Unicode文字数。
- `search-replace.test.ts`：literal / case / 絵文字 / 改行、空置換、readonly / composition / stale拒否、単一Undo / Redo。
- `writing-library.test.ts`：全作品・章・メモ・履歴書き出しと復元、コピーID対応、同意初期化、不正／将来／過大バックアップ、CAS、同期容量制限失敗の全体ロールバック、履歴50件と作品削除。
- `editor-sessions.test.ts`：live Editor再利用とUndo / 選択範囲分離、リビジョン一致時のカーソル復元、localStorage破損・容量制限、Strict Mode disposal。
- `workspace.test.tsx`：未保存アウトライン、章保存失敗、履歴取消／復元前保存記録、自動履歴opt-in／容量制限で本文保持、章を往復した同じPMへの中止無視の遅延AI応答拒否。
- `writing-tools.spec.ts`：章管理と進捗保存、作品／章Undoとカーソル、再読み込み後の保存済み作品一覧とカーソル、検索置換の確認／stale／Undo、メモを含む履歴プレビューと復元、一括バックアップ／コピー復元の取消と再読み込み。
- `saved-works-and-pixiv.spec.ts`：保存済みの作品を確認後にごみ箱へ移し、開いている作品と切替メニューの一覧を保つ。pixiv向けのルビ出力を確認画面で示し、本文を変えない。
- `secret-works.spec.ts`：シークレット作品の暗号化保存（IndexedDBに平文が残らない）、再読み込みでのロック、誤ったパスワードの拒否、解錠・手動ロック、10分間の無操作での自動ロック、解除後の平文保存。

実LLMの認証／推論とOS日本語IMEは未実施。合成compositionとChromiumの自動操作を実機IMEの代替と報告しない。

## 優先機能の保護境界（Task 16.1）

- `trash.test.ts`：履歴なし・最新PM本文・全章・メモの復元、ID衝突時コピー、章の新IDと順番、CAS、同期容量制限 ロールバック、不正バージョン／参照／履歴重複、旧バックアップ移行とごみ箱だけのバックアップ。
- `ai-connection-settings.test.ts`：server-only ファイルの600権限、ロック / リビジョン / atomic save、未来バージョン・symlink拒否、公開情報の秘匿、env overlayと不正設定時のAI停止。
- `connection-diagnostics.test.ts` / `ai-connections-handler.test.ts`：認証／メタデータだけの通信、API二重許可、本文フィールド拒否、origin、HTTP失敗、期限・容量、中止無視の遅延応答とリビジョン変更。
- `ai-connection-settings.test.tsx` / `workspace.test.tsx`：明示load、保存失敗後の未保存の入力保持と再試行、診断取消／乱順、API初期OFF、作品設定未保存の入力とCtrl+S、取消でPreview保持、履歴なし復元、接続変更で旧AI応答破棄、AI設定の保存失敗でも原稿・作品未保存の入力を保存。
- `priority-tools.spec.ts`：実ブラウザーのbeforeunload取消と設定保存／再読み込み、章・作品の復元と完全削除確認、再起動なしの接続保存、ループバック テスト用データへのGET modelsだけの診断、本文不変とAPI OFF。

Playwrightの全設定は専用の一時AI設定ファイルを使用し、実ユーザー設定を更新しない。実サブスク・APIやローカル推論エンジンを使わず、HTTP テスト用データとinterceptionで検証する。

## PC起動ランチャー（Task 17.1）

`tests/unit/launcher.test.ts`は起動識別子の一致、不正／過大health応答、中止を無視して遅延するfetch、準備待ち制限時間、OS別ブラウザー command、公開health応答の秘匿を確認する。`tests/integration/launcher.test.ts`は実Node子プロセスとループバック テスト用データでbuild→start、二重起動、port競合、build／start失敗、残存／不正ロック、build中の取消、SIGTERMを無視するプロセスの強制終了、作業ディレクトリ・空白を含むパスを検証する。実AI・認証は使用しない。

最終smokeでは専用のAI設定パスとmock プロバイダーを使い、実ランチャー経由のproduction build・起動・healthとブラウザーでの編集保存・再読み込みを確認する。Windows / macOS GUIでのダブルクリック、OS日本語IMEは別途人手確認とする。

## 新ロードマップPhase 1：スマホ幅とタップ

`playwright.mobile.config.ts` / `tests/mobile/mobile.spec.ts` はPixel 7のChromium phone emulationとループバック mockを使う。6幅、下部の8つの入口（44px以上・省略なし・360px以上で画面内）、全ツール（AI画面の中で選択）、本文への退避/再表示とdraft/候補保持、候補比較と同意、タップAccept/Undo/Redo/保存reload、章・未保存入力・回転、遅延応答のstaleを検証。`pnpm test:e2e`の最後に実行する。DOM Rangeでネイティブ選択の結果を再現するため、OSの選択ハンドル操作の証拠とはしない。

componentではタッチcontextmenuの非取消、composition中のpointer/Undo/Redo拒否、VisualViewport縮小/scroll時のsnapshot/draft不変、背景化保存の完了前表示と容量制限失敗→再試行を確認する。jsdomにはRange layoutがないため、履歴componentだけscroll処理をstubし、実際のscrollはE2Eで検証する。

iOS/Android実機、Windows/macOS IME、物理キーボード、スクリーンリーダー、実モデル品質、モバイル実機性能は別の未実施確認条件。実施結果と未確認項目は [公開準備](PUBLISHING.md) に記録する。

## 新ロードマップPhase 2

`japanese-diagnostics.test.ts`で語境界・Unicode・100k文字・検査上限、`diagnostic-anchors.test.ts`でPM位置/Undo/失効、`feedback-route.test.ts`で同意/Origin/上限/遅延応答、`feedback.test.tsx`で明示送信と変更後の破棄を検証する。`tests/e2e/japanese-feedback.spec.ts`はWorker/下線/無視/個別採用/保存reload/AI準備/読み取り専用コメント/狭幅の遅延応答を確認。規則検出と実LLMの品質評価を区別する。

## 実サービスの手動確認

自動テストは実AIへ接続しない。実施する場合は課金と送信内容の許可を得て、テスト用の短い原稿を使う。APIキーやトークンを履歴・ログ・画像・Issueへ残さない。

| 接続先 | 確認すること |
|---|---|
| ChatGPT | 公式認証、アカウントのモデルカタログ、初回案内、同意後の生成、再認証・解除による旧候補の失効、利用枠不足時の本文保存 |
| Claude CLI | 専用ディレクトリでの認証、auth statusとモデル、比較生成、未ログイン・無効モデル時の失敗。他方の候補は残ること |
| Ollama / LM Studio | JSON Schema対応、入力と出力に足りるコンテキスト設定、生成と差分、推論サーバー停止時のエラー。外部接続へ切り替わらないこと |
| OpenAI API | キーが画面やバックアップに出ないこと、未同意・API無効では送信しないこと、同意後の単発生成、同意撤回後の停止 |

各接続で、採用前の本文不変、採用範囲、Undo/Redo、保存・再読み込み、生成中の編集、古い結果の拒否を確認する。複数AI比較は同じ原稿を明示選択した接続先だけへ送ることを確認する。送信量・時間・形式の条件は [AI編集仕様](AI_EDITING.md) と照合する。

終了後はサーバーを止め、テスト用キーを削除または更新する。日付・OS・接続先・モデル・結果・未確認事項を記録する。実AIの検証は未実施のままであり、この手順の追加は実施済みを意味しない。

## 画面の一新（Task 24.1）

- `tests/unit/writing-tools.test.ts`：選択の形（文章・空白・カーソル）によるツールの種類の決定、種類ごとの最後のツールの記憶、辞書を記憶しないこと、壊れた記憶からの復帰、「指示から書く」がプリセット・初期指示・本文の文脈を持たないこと。
- `tests/integration/ai-target.test.ts`：対象の印がDecorationだけで、本文・PM selection・guardのrevision・Undo履歴を変えず、snapshotを期限切れにしないこと。カーソル位置の印、本文変更時に印を別の文字へ移さず消すこと、範囲外と破棄済みエディタの無視。
- `command.test.tsx`：選択によるツールの決定とパネル内の切替の記憶、合わないツールの記憶時の「指示から書く」への切替、合わないツールを選んでもセッションと入力を保つこと、ツール切替で受信済み候補を捨てて後から採用しないこと、右クリックの辞書で生成中の通信を中止し遅延応答を捨てること、対象の印の表示と閉じる・期限切れでの削除。
- `workspace.test.tsx`：作品の切替メニューでの新規・切替・`aria-current`、保存失敗時に一覧を増やさないこと。
- `workspace-design.spec.ts`：左の列の8つの入口（44px以上、14px以上の文字、アイコンの非読み上げ）、待機中にツールを並べないこと、選択とカーソルで出すツール、矢印キーでのツール選択、余白欄のAI画面が本文に重ならないこと、対象の印、ツール選択だけでは送信も本文の変更もしないこと。
- `keyboard-boundary.spec.ts`：空白だけの選択は編集コマンドではなく中間補完で開くこと。
- `ai-edit-helpers.ts`：`chooseAiTool`・`tryAiTool`・`openAiTool`（AI画面の中でツールを選ぶ）、`openWorkMenu`・`workMenuButton`・`savedWorkButtons`（作品の切替メニュー。一覧は閉じたまま件数と題を確認できる）。

幅1440・1024・390pxの明暗の画面は、確認用のスクリプトで撮影して目視した。実機の日本語IME、スクリーンリーダー、macOSのヒラギノでの表示は未確認。
