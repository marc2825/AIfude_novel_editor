# Architecture

Task 18.5：`context-insert`を既存の補完operationへ追加する。captureと同期Accept guardは任意位置のゼロ幅TextSelectionを必須とし、元のfrom = to・Slice・前後全文・revisionを保持する。空白／章末尾の制約はinfill / continueだけに適用する。controller・比較route・provider・文字列検証・単一Undoの適用処理は共用し、位置の再探索やReact本文コピーを追加しない。

Task 18.4：`SelectionSnapshot.operation`を`insert | infill | continue`へ拡張する。infillだけは空白範囲の置換または空段落のゼロ幅TextSelection、continueは章末尾のゼロ幅TextSelectionをcaptureする。元のSlice・範囲・前後全文・revisionを保持し、Accept直前に本文条件と空段落条件を再検証する。範囲の拡張・探索・移動をしない。ゼロ幅transactionの終点検証は操作名ではなくfrom = toで判定し、prefix + candidate + suffixを照合する。通常置換の原文比上限は維持し、補完だけは既存insertと同じ3,000文字上限を使う。

目標文字数はAI session入力だけに保持し、変更で旧候補を破棄する。本文やモードを保存schemaへ追加しない。既存controller・比較route・provider・応答検証を共用する。本文と周辺文脈はPM snapshot由来で、React本文コピーや自動生成loopを追加しない。

Task 18.3：辞書は編集候補とは別の読み取り専用UIとする。AiEditBoundaryは既存selection snapshotをcaptureし、controllerのcommand / staleで対象の有効性を保つ。辞書ではcontroller.submit / acceptを呼ばない。DictionaryPopoverが独立した照会request ID・AbortControllerを持ち、stale・閉じる・unmount・モード変更でabortし、遅延結果を破棄する。本文のcontrolled stateや適用transactionを追加しない。

専用HTTP handlerが共通guard後にDictionaryRequestを検証し、serverでprompt-onlyの内部生成要求へ変換する。providerと候補wire schemaは既存のまま共有し、辞書UIだけが説明として表示する。clientも同じ変換を使って既存response検証・deadline処理を再利用する。editor / workspaceの本文・設定・メモはHTTP要求へ渡さない。UI stateと照会結果は保存しない。

Phase 12 / Task 12.1：空のTextSelectionで`operation: insert`をcaptureできる。位置・原文・prefix / suffix・revisionは従来のsnapshotに保持し、LLMへは送らない。Acceptは同じ同期検証・単一transaction境界を使用し、from = toの挿入だけを追加する。UIに本文のcontrolled valueは持たせない。

比較は`POST /api/ai/comparisons`の明示した2〜3対象へ同時fan-outする。既存のserviceと候補検証をproviderごとに実行し、request IDにひも付く結果をAI sessionへ保持する。rate limiterはprovider単位。共通server provider interfaceを保ち、Claude CLI・各社APIの固有型はserver内へ閉じ込める。APIの画面opt-inはworkspace永続化と分離した初期falseの状態で、変更時に進行中AI sessionをstale化する。

Task 13.1：作品メモリは`Project.storyMemory`の3つの手入力stringで管理する。`StoryMemoryPanel`のローカルdraftを明示保存し、`useWorkspace.updateStoryMemory`から既存SaveCoordinatorへ直列化する。メモ保存はPM documentやhistoryへdispatchせず、設定保存フォームからメモが省略された場合も既存値を保持する。保存失敗後の同じ値の再試行でも実際にflushし、未保存のまま成功を返さない。

SelectionSnapshotへメモをコピーしてfreezeし、contextRevisionに加えて現在の3欄の値も同期Accept guardで比較する。参照ON/OFFはAI session内だけの状態で、初期OFF・新セッションでOFF。OFFではrequestから省略し、ONでは置換・挿入・比較の共通requestへ含める。

必須入力予算をclientとserverで一致させるため、既存の純粋なprompt plannerを`src/features/ai-edit/prompt.ts`へ置く。`src/server/ai/prompt.ts`はserver-only再exportを維持し、providerは従来のimportを使用する。共有moduleにはReact、SDK、secret、server設定を含めない。メモはuntrusted JSON data、必須入力として扱い、予算超過ならHTTP / provider呼び出し前に拒否する。

## 1. 技術構成

- Next.js App Router：画面と同一originのAPIを提供する。
- React：周辺UI。
- TipTap：ProseMirrorのReact統合とextension境界。
- ProseMirror：document、selection、transaction、historyの正本。
- CSS Modules：スタイル。
- Floating UI：selection付近の非modal popover配置。
- Radix UI：必要な設定dialog等に限定して利用する。
- Zod：API、保存、importの実行時検証。
- idb：IndexedDBの薄いラッパー。
- diff：表示用の文字差分。
- Vitest、Testing Library、Playwright：検証。

Zustand、Redux、汎用DI container、ORM、vector databaseは導入しない。

## 2. Frontend architecture

`src/app/page.tsx`はserver側で公開可能なAI実行情報を読み、client側の`WorkspaceApp`へ渡す。

公開可能な情報はprovider ID、model ID、表示名、短い説明、AI編集に必要なcapabilityと上限、利用可能状態、外部送信の有無だけ。APIキー、server環境値、SDK設定、account情報を渡さない。

ChatGPTの接続status routeは、認証情報を除く接続ID・状態と、接続済みの場合だけ検証済みemailを表示用に返す。これは上記のpage runtimeとは別の最小の接続UI契約であり、access / refresh / ID tokenを含めない。

provider/model定義の正本は`src/domain/ai-models.ts`とする。React、server config、provider factoryで別々のallowlistを持たない。公開runtime情報はこのregistryと検証済みserver configから安全なfieldだけを導出する。

`WorkspaceApp`は以下を統合する。

- workspaceの読み込みと保存状態
- 編集権限
- `NovelEditor`
- 設定画面
- AI controller
- `AiEditBoundary`

AI UIの例外でeditorをunmountしない。AI境界をeditorと別に置く。

## 3. Editor architecture

### 3.1 Schema

documentはparagraphを1個以上持つ。

paragraphはtextのみを持つ。marks、hardBreak、heading、list、image、linkは導入しない。

StarterKit全体は使用しない。必要なnodeとhistoryを個別に構成する。

`PlainTextHistory`は`@tiptap/pm/history`のhistory pluginを1個だけ登録する。

### 3.2 初期化

IndexedDB読み込みと編集権限確認が完了してからeditorを作成する。

Next.jsのSSR中にeditorを生成しない。TipTapのclient initialization設定を採用版に合わせ、`immediatelyRender: false`を使用する。

初期本文は一度だけ渡す。

通常のReact rerender、保存完了、候補切替によってeditor instanceを作り直さない。

バックアップimportは明示的な文書再読み込みであり、新しいeditor instanceとして扱う。

### 3.3 正本

本文の正本はPM document。

Reactが保持してよいのは、保存状態、UI状態、設定、直近の保存用snapshotである。

保存用JSON snapshotをeditorへ逆流させない。

`setContent()`は初期化・明示的再読み込み以外に使用しない。

## 4. State management

状態を3系統に分ける。

### Editor state

PM pluginが管理する。

- `editorInstanceId`
- `contentRevision`
- `selectionRevision`
- 現在のselection

`contentRevision`は`tr.docChanged`ごとに増加する。Undo/Redoでも増加し、過去の値へ戻さない。

`selectionRevision`は新旧selectionが等価でない場合に増加する。

`selectionSet`だけを変更検知の根拠にしない。

pluginはappendされたtransactionも含めて観測する。

### Workspace state

workspace controllerが管理する。

- 設定
- workspace単位のAIモデル設定
- `contextRevision`
- storage version
- 保存中・未保存・保存失敗
- 編集権限

共通プロンプト、手動文体、保存する作品メモリ、AIモデル選択、または外部送信同意の変更時に、`contextRevision`を同期的に増加させる。

### AI session state

AI controllerが管理する。

- セッション状態
- snapshot
- 現在のrequest ID
- 指示と候補数
- 候補一覧
- 選択中候補
- エラー
- AbortController

documentそのものは保持しない。

Reactの古いclosureをAcceptの認可情報として使用しない。Accept時はcontrollerとPM pluginの現在値を読み直す。

## 5. Selectionと文字列

### 5.1 座標系

次の3つを混同しない。

- ProseMirror位置：node境界を含むUTF-16基準の位置
- JavaScript文字列offset：UTF-16 code unit
- 入力上限の文字数：Unicodeコードポイント

Diffの分割単位はgrapheme clusterとする。

### 5.2 正規テキスト

各paragraphのtextをLFで結合したものを章の正規プレーンテキストとする。

空paragraph、連続改行、末尾の空paragraphを保持する。

文字列のtrimやUnicode正規化を行わない。

### 5.3 選択範囲の抽出

`plain-text.ts`と`selection.ts`に変換処理を集約する。

paragraph内のPM位置から、そのparagraphのtext offsetと章全体のplain-text offsetを求める。

PM位置をそのままJavaScriptのsliceに渡さない。

AllSelectionは、最初のparagraphのcontent開始から最後のparagraphのcontent末尾へ正規化する。

元のselectionの種類・anchor・headはguard用に保持する。

不正なsurrogate境界は受け付けない。選択範囲を黙って拡大・縮小しない。

## 6. Edit snapshot

Cmd/Ctrl + Kで以下を一度だけcaptureする。

- project ID、document ID、chapter ID
- editor instance ID
- content revision
- selection revision
- context revision
- 元のPM selection
- 正規化した`from`と`to`
- 選択文字列
- 選択範囲のPM Slice
- 選択直前・直後の文脈
- 共通プロンプトと手動文体
- session ID

snapshotはそのセッション中、不変である。

PM Slice、PM selection、位置情報はクライアント内だけに置く。providerへ送信しない。

## 7. stale policy

V0.1はstrict invalidationを採用する。

次の変更があれば、snapshotをstaleにする。

- 選択範囲内外を問わないdocument変更
- PM selectionの実質的変更
- 文書再読み込み
- editor instance変更
- 参照設定変更
- AIモデル選択変更
- 同意撤回
- 編集権限喪失

stale化したら以下を行う。

1. 現在のrequestをabortする。
2. active request IDを無効化する。
3. AcceptとRetryを無効化する。
4. 候補を残す場合も「期限切れ・採用不可」と表示する。
5. 新しいCmd/Ctrl + Kでのみ新snapshotを作る。

一度staleになったsessionは復活させない。

DOMのblur、popoverへのfocus、windowのblurだけではstaleにしない。PM selectionが変わった場合だけselection revisionを更新する。

## 8. 非同期応答の受け入れ

API応答は、次のすべてが一致した場合だけPreviewへ遷移できる。

- controllerがGeneratingである
- session IDが現在のsessionと一致する
- request IDが現在のrequestと一致する
- editor instanceが一致する
- content、selection、context revisionが一致する
- snapshotがstaleでない
- sessionがcancelされていない

AbortControllerだけに依存しない。

abort後でもpromiseがresolveするmockを想定し、遅延応答を破棄する。

エラー応答にも同じidentity判定を適用する。旧requestのエラーで新sessionのUIを上書きしない。

## 9. Acceptの安全な実装

Acceptは同期的なcommandとして実装する。

### 9.1 Preconditions

- Preview状態である。
- request IDとcandidate IDが現在の候補に属する。
- sessionが未消費である。
- 編集権限がある。
- editorとcommand入力欄のいずれもcomposition中でない。
- document、instance、revisionがsnapshotと一致する。
- 現在のselectionがcaptureしたselectionと等価である。
- 現在の選択文字列とPM Sliceがsnapshotと一致する。
- 候補がschemaと文字数制約を満たす。

検証とdispatchの間に、fetch、hash計算のawait、保存待機、React effectを入れない。

### 9.2 置換

候補文字列をLFで分割し、schemaのparagraphとtextからSliceを作る。

段落内の開始・終了位置に対するopen depth 1のSliceを使用する。

PMの厳密な`tr.replace()`で選択範囲を置換する。

自動的に置換範囲を広げるfittingに依存しない。適合しない場合は失敗させる。

HTML parser、`insertContent()`によるHTML解釈、document全体の再構築を使用しない。

### 9.3 dispatch前の不変条件検証

生成したtransactionのdocumentを正規テキストへ変換する。

その結果が「元のprefix + 候補文字列 + 元のsuffix」と完全一致することを確認する。

不一致ならdispatchしない。

これにより、段落境界の処理が選択範囲外の文字を変更することを防ぐ。

### 9.4 完了

置換後のcaretはtransaction mappingで求めた挿入末尾へ置く。

transactionにsession/request/candidateを識別する内部metaを付ける。providerからmetaを受け取らない。

成功後にsessionを消費済みとし、popoverを閉じ、保存を即時予約する。

同じ候補への二重クリックを2回の変更として処理しない。

## 10. Undo / Redo

AI Acceptを前後の手入力と分離する。

1. AI変更transactionに`closeHistory()`を適用して、直前の入力グループを閉じる。
2. 選択範囲の置換を、1つのdocument-changing transactionとしてdispatchする。
3. 直後に`closeHistory()`付きのmetadata-only transactionをdispatchする。
4. 後者は`addToHistory: false`にする。

AIの本文変更transaction自体には`addToHistory: false`を付けない。

これは「1つの本文変更＋履歴境界用transaction」であり、Undo上は1操作である。

後続の手入力がAI適用と結合しないことを必ずテストする。

Undo/Redoは通常のdocument変更なので、実行中の別AIセッションをstaleにする。

Undoしても候補UIを復活させない。Redo時にAPIを再実行しない。

## 11. LLM integrationとAPI boundary

ブラウザーは`POST /api/ai/edits`だけを呼ぶ。

routeは以下を順に行う。

1. origin、host、method、content type、body sizeを検証。
2. request schemaを検証。
3. requestのmodel IDまたはserver defaultをcanonical registryで解決し、provider対応とcapabilityを検証。
4. provider設定、同意、rate limitを検証。
5. intentをサーバーで決定。
6. contextとpromptを組み立てる。
7. 解決済みmodel定義とともにprovider adapterを呼ぶ。
8. 出力を検証。
9. server生成のcandidate IDと実際に使用したprovider/model IDを付けて返す。

providerはdocumentの位置やrevisionを知らない。

serverにはブラウザーの現在のdocumentが存在しないため、staleの最終判定はclientで行う。

## 12. Provider abstraction

`EditingProvider`は以下を受け取る。

- registryで解決済みのapplication model定義
- 固定の編集制約
- 組み立て済み入力データ
- JSON response schema
- 出力token上限
- AbortSignal
- ChatGPTサブスク接続の場合はclientが確認したconnection ID

結果は未検証の候補データと利用量情報、または正規化したprovider error。

SDK型、refusal判定、Structured Output設定はadapter内へ閉じる。application model IDと必要capabilityはprovider-neutral portを通し、OpenAI SDKの型をeditor/UIへ出さない。

OpenAI adapterはすべての対応modelで同じ実装を使う。`OPENAI_MODEL`はserver defaultであり、明示的なclient overrideはserver allowlistで再検証する。`automatic`はdefaultを使うだけで、動的routingや別modelへのfallbackを行わない。

ChatGPTサブスクを主な推論先とし、local、mock、API key方式のOpenAIも明示設定で利用できる。`local` adapterはサーバー設定のloopback `/v1/chat/completions`へ非streamingで接続し、同じ候補schemaを要求する。他provider用の空adapterは作らない。

ローカルのapplication model ID `local-default`はサーバー設定枠であり、具体的なmodelの能力・context上限を保証する登録ではない。Settingsは`automatic`だけを利用でき、実際のmodelは検証済み`LOCAL_LLM_MODEL`で指定する。公開runtimeはmodel表示名だけを導出し、接続URL・認証tokenをclientへ渡さない。候補metadataには実際に指定したmodel IDを返す。ローカル設定変更時はserver再起動とpage reloadで新sessionを作る。Task 10.1ではworkspace schema version 2を維持した（現在はTask 13.1のversion 3）。

ChatGPTも`chatgpt-default`設定枠と`CHATGPT_MODEL`を使う。個別modelのcapabilityをこの枠だけで保証せず、生成前に認証済みアカウントのcatalogを確認する。OAuth・credential file・SSEは`src/server/ai/chatgpt/`へ閉じ、clientには接続ID・接続状態・表示用emailだけを渡す。接続IDはrequestにだけ含め、LLM promptと本文保存へ含めない。再認証・解除時はcontrollerを同期的にstale化し、serverもrequest開始時と応答完了後に接続IDを照合する。

## 13. Context assembly

`context.ts`は純粋関数。

入力はsnapshotから作った文字列と設定。editor instanceやDOMへアクセスしない。

V0.1では検索をしない。前後文脈と手動設定のみを対象とする。

contextの文字数制限とtoken budgetは`docs/AI_EDITING.md`を正とする。

## 14. Persistence

IndexedDBの`workspaces` object storeへ現在の単一workspace aggregateを保存する。Task 14.1ではdatabase version 2で`workspace-files`を追加し、待機中の作品を同じWorkspaceSnapshot形式で保持する。既存recordをupgrade時に書き換えない。

章本文だけでなく、関連設定とschema versionを同じsnapshotへ含める。

repositoryの操作はload、save、replace、deleteに加え、listFilesとactivateFileを提供する。activateFileは2storeを同一transactionで扱い、現在の期待ID / storageVersion、targetのschema、ID重複を検証してから原子的に退避・取出する。backup置換も待機中作品とのID衝突を拒否する。

saveは同じIndexedDB readwrite transaction内でstorage versionを比較して更新する。

React componentからIndexedDBを直接操作しない。

### 保存順序

- document変更時にdirty sequenceを増やす。
- save coordinatorは書き込みを直列化する。
- 実行中に新変更があれば、完了後に最新snapshotを保存する。
- 保存済み表示は最新dirty sequenceまで保存された場合だけ。
- 画面離脱時のflushはbest effortであり、完了保証とは表示しない。

### 作品ファイルと未保存メモ（Task 14.1）

新規・ファイルopen・作品切替はworkspace controllerで直列化する。現在のeditorを切替中だけ読み取り専用にして保存をflushし、失敗ならそのeditorで編集を再開する。Task 15.1では成功時に現在のviewを切り替え、AI boundaryを作り直す。PM documentをReact stateから復元せず、通常保存・rerenderでsetContentしない。

初回作成の保存に失敗してrecordがまだない場合は、明示保存・切替前flushでdirtyを設定して実際の保存を再試行する。空の保存キューを保存成功と誤認してその作品を破棄しない。

Tiptapのcreate通知は遅延するため、NovelEditorは最初のtransactionでもreadyを1回通知し、切替直後の入力を保存対象から漏らさない。履歴pluginは1つだけ。通常の作品／章切替ではEditorSessions内のEditorを再利用し、その章のUndo / selectionを保持する。importと履歴復元では作品のeditor epochを進め、新しいEditorを使う。

StoryMemoryPanelは保存済みbaselineと入力draftを分け、変更を同期callbackでWorkspaceAppへ通知する。beforeunloadは未保存メモまたは未保存本文がある場合だけ標準確認を要求する。取込・削除・新規・切替ではdraft破棄確認が成功してからAIを無効化し、取消では既存sessionとdraftを維持する。保存操作はメモを先に検証保存してから本文をflushする。

ファイルopenは10MiB以下のcanonical JSONまたはfatal UTF-8 decodeを通る.txtだけ。新UUIDの作品としてロードし、送信同意・revision・履歴を引き継がない。ファイルdownloadとブラウザー内保存を分け、任意filesystem pathやクラウドを扱わない。閉じたタブのUUIDとcaret metadataはlocalStorageへ保存する。本文・メモ・履歴snapshotはIndexedDBが担当し、UI metadataの保存失敗で本文保存を妨げない。

### 別タブ

Web Locksでorigin内のworkspace編集権限を1タブに限定する。

lock名は`novel-editor:workspace`。

取得できないタブは読み取り専用。AI生成も無効化する。

Web Locks非対応環境では永続workspaceを編集可能にしない。安全でないlocalStorage leaseへ自動fallbackしない。

IndexedDBのversion比較は二重防御として維持する。

## 15. Concurrent editing

共同編集、remote merge、CRDTは対象外。

別タブの同時書き込みは拒否する。

文書位置のrebase、mappingによるAI候補の追従、変更箇所探索は実装しない。

## 16. Diff

Diffは表示専用。

- 原文と候補を`Intl.Segmenter`でgrapheme単位に分ける。
- `diff`をWeb Worker内で実行する。
- active候補だけ計算する。
- 150msでworkerを終了し、原文・候補の並列表現へfallbackする。
- worker応答もrequest IDとcandidate IDで照合する。

Diffの結果をAccept時のpatchとして使用しない。

## 17. Retry / cancellation / streaming

Retryは新しいrequest IDを発行する。

旧候補はRetry開始時に利用不能にする。

キャンセルはclient状態を即座に閉じ、通信停止はbest effortで行う。

provider側の処理・課金の停止を保証しない。

ブラウザーへの候補streamingは使用しない。完全な返答の検証が終わるまで候補を表示しない。2026-10-14のユーザー承認に基づき、ChatGPTサブスクのserver adapter内だけHTTP/SSEを受信する。`response.completed`前、途中の失敗、受信上限超過では候補を返さない。

## 18. Error boundaries

- AI描画エラー：AI領域だけ停止。
- APIエラー：本文不変、保存継続。
- 保存エラー：メモリ本文維持、未保存表示、書き出し提供。
- 初期読み込みエラー：空文書で自動上書きしない。
- editor致命的エラー：直近メモリsnapshotと保存済みsnapshotの復旧手段を表示。

例外を握りつぶして「成功」「保存済み」と表示しない。

## 19. Security

`docs/SECURITY.md`を適用する。

server専用moduleには`server-only`を使用する。

clientからserver moduleへのimportをlintとbuildで禁止する。

候補、本文、説明、共通プロンプトはすべて未信頼文字列として扱う。


### 章・履歴・検索（Task 15.1）

active chapterの正本はPM document。保存snapshotのchapterは現在章、additionalChaptersは非表示章。章切替前にactive PM本文をflushし、章の更新をCAS保存してからviewを変更する。EditorSessionsは作品ID・章ID・epochで実Editorを所有し、Reactはactive viewだけをmountする。非表示editorはeditable:falseとcallback解除。候補は再利用せず、同じEditorへ戻っても旧AI sessionは復活しない。owner破棄で全Editorをdestroyする。

手動の章タイトル／アウトラインdraftも未保存警告と明示保存の対象。文字数はactive PM documentのコードポイント数と非active章の保存bodyから数値だけをUIへ渡す。改行を除き空白を含む。目標設定は作品単位で保存する。

検索は現在章のliteral文字列、最大500コードポイント、case指定あり、最大10,000一致。UTF-16 plain text offsetをparagraph境界に沿ってPM位置へ変換する。置換は最大3,000コードポイント、空文字可。明示確認後にeditor identity・contentRevision・doc.eq・editable・compositionを同期検証し、逆順のreplaceを1transactionへまとめる。前後のcloseHistoryで単一Undoにする。本文変更後の検索snapshotは再利用しない。

保存履歴の記録と一括backupは専用の具体repositoryで扱う。履歴復元と一括importは原子的transactionで、同期的なrequest作成失敗でもabortする。自動履歴は本文save後の別transactionなので、quota失敗で本文saveを失敗に変えない。全作品exportは単一readonly transactionで整合したsnapshotを読み、一括importはコピー追加を原子的に行う。

### 未保存保護・ごみ箱・接続管理（Task 16.1）

作品設定のdraftは成功した保存baselineと比較する。親へdirtyを同期通知し、beforeunloadと作品切替・単体import・削除の破棄確認へ統合する。取消ではAI controllerに触れない。通常保存は作品設定・メモ・章設定を順次保存して本文をflushし、その後で接続設定を保存する。AI設定の保存失敗でも本文の保存は完了し、未保存の接続draftを残して部分的な成功を通知する。複数の保存を単一transactionと表示しない。AI接続画面の描画エラーも専用boundaryで隔離する。

作品削除は最新のPM snapshotと保存履歴をworkspace-trashへ退避し、activeとhistoryの削除を同じtransactionで行う。章削除もtrash追加とworkspace更新を同時に行う。復元・完全削除はWeb LockとCASの下だけで実行する。作品復元はarchiveへ追加し、現在作品を上書きしない。削除済み状態からは復元作品をactivateする。章復元では現在章を維持して新IDの章を追加する。破棄済みEditorや古い候補を復活させない。

AI接続設定のclient契約はdomain、UIとtransportはfeatures/ai-edit、file storeと診断はserver/ai、HTTP guardはserver/httpへ分離する。サーバーの環境設定へ検証済みの保存設定を重ね、各routeで同じrevisionを解決する。clientは`x-novel-ai-settings-revision`を送り、serverは推論前後に照合する。設定変更中の応答は採用できない。破損設定はAIだけ停止し、自動fallbackしない。

画面内の変更とBroadcastChannelによる別タブ変更は進行中AIを無効化し、runtimeを再読込する。別タブ変更時も未保存接続draftは保持するが、旧revisionによる保存は拒否する。診断はrequest ID・revision・modeを照合し、取消後の遅延応答を破棄する。GETでの設定読込自体は外部通信を行わない。
