# アーキテクチャ

本文の状態はProseMirrorが管理し、Reactは操作画面を担当する。AIの返答は候補として保持し、採用時に現在の本文・選択範囲と照合してから適用する。保存用データをReactからエディタへ戻して、本文を二重管理しない。

## 1. 技術構成

Next.js App Router、React、TipTap / ProseMirror、CSS Modulesを使う。境界の検証はZod、IndexedDBはidb、差分表示はdiff、検査はVitest・Testing Library・Playwrightが担当する。

ポップオーバーは選択位置と画面の空き領域から配置する。初期案にあったFloating UI・Radix UIは未導入。依存のバージョンは `package.json` とlockfileを参照する。Zustand・Redux・汎用DI・ORM・ベクトルDBは使わない。

## 2. 画面側の構成

`src/app/page.tsx` はサーバーで公開可能なAI情報を読み、`WorkspaceApp` へ渡す。公開するのは提供元・モデルID・表示名・説明・対応機能と上限・利用可否・外部送信の有無だけ。キー、サーバー環境値、SDK設定、アカウント情報は渡さない。

ChatGPTの接続状態APIは別の契約として、接続ID・状態、接続済みの場合だけ検証済みメールアドレスを返す。access / refresh / ID tokenは含めない。モデルの定義は `src/domain/ai-models.ts` に集約し、画面・設定・factoryに別々の許可リストを持たせない。

`WorkspaceApp` は読み込み、保存状態、編集権限、エディタ、設定、AIコントローラーを統合する。AI画面のエラーで本文エディタを破棄しないよう、描画エラーの境界を分ける。

## 3. エディタの構成

### 3.1 Schema

documentはparagraphを1個以上持ち、paragraphはtextを持つ。現在はルビ・傍点のmarkも扱う。hardBreak、heading、list、image、linkは使わない。保存形式の拡張は [データモデル](DATA_MODEL.md#phase-4--workspacesnapshot-v6) を参照する。

StarterKit全体は使わず、必要なノードと履歴だけを構成する。`PlainTextHistory` が `@tiptap/pm/history` のpluginを1つ登録する。

### 3.2 初期化

IndexedDBの読み込みと編集権限の確認後にエディタを作る。SSR中は生成せず、TipTapには `immediatelyRender: false` を指定する。初期本文を渡すのは一度だけ。再描画・保存完了・候補切替でインスタンスを作り直さない。

通常の作品・章切替は保存したインスタンスを再利用する。バックアップ取込と履歴復元は明示的な再読み込みとして新しいインスタンスを使う。

### 3.3 正本

本文の基準はPM documentである。Reactに持てるのはUI・設定・保存状態と、保存用の直近snapshot。保存用JSONを本文へ逆流させない。`setContent()` は初期化・明示的な再読み込み以外で呼ばない。

## 4. 状態の管理

| 管理者 | 状態 |
|---|---|
| PM plugin | `editorInstanceId`、`contentRevision`、`selectionRevision`、現在の選択 |
| 作品コントローラー | 設定、AIモデル設定、`contextRevision`、保存用バージョン、保存状態、編集権限 |
| AIコントローラー | セッション、snapshot、現在のリクエストID、指示、候補数、候補一覧と選択、エラー、AbortController |

`contentRevision` は `tr.docChanged` ごとに増やす。Undo/Redoでも増え、以前の値に戻さない。`selectionRevision` は新旧selectionが等価でない場合だけ増やす。`selectionSet` だけで判定せず、追加されたトランザクションも観測する。

共通プロンプト、手動文体、保存済みメモ、AIモデル、送信同意の変更では `contextRevision` を同期的に増やす。AI側には本文そのものを保持しない。採用時は古いReactのクロージャーを使わず、コントローラーとPM pluginの現在値を読む。

## 5. Selectionと文字列

### 5.1 座標系

PM位置はノード境界を含むUTF-16基準の構造的位置、JavaScriptのoffsetはUTF-16 code unit、入力上限はUnicodeコードポイントで数える。差分の分割はgrapheme clusterとする。

### 5.2 正規テキスト

各paragraphのtextをLFでつないだものを章のプレーンテキストとする。空段落、連続改行、末尾の空段落を保持し、trimやUnicode正規化をしない。

### 5.3 選択範囲の抽出

`plain-text.ts` と `selection.ts` に変換を集める。PM位置から段落内・章全体の文字列offsetを求め、PM位置をそのままJavaScriptのsliceに渡さない。AllSelectionは最初の段落のcontent開始から最後のcontent末尾へ正規化し、元の種類・anchor・headも検証用に残す。不正なsurrogate境界は拒否し、範囲を自動で広げたり縮めたりしない。

## 6. Edit snapshot

AI入力欄を開くとき、次を一度だけ取得する。

- project / document / chapter / editor instance / sessionのID。
- content / selection / contextのrevision。
- 元のPM selection、正規化した `from` / `to`、選択文字列、PM Slice。
- 選択前後の文脈、共通プロンプト、手動文体、参照する保存済みメモ。

snapshotはセッション中に書き換えない。PMの位置・Slice・selectionはクライアント内に置き、プロバイダーへ送らない。メモはコピーして固定し、採用時には `contextRevision` に加えて現在の3欄の値も比較する。

## 7. stale policy

本文の変更、PM selectionの実質的な変更、再読み込み、エディタの変更、参照設定・モデル・同意・権限の変更でsnapshotを期限切れ（stale）にする。選択範囲外の編集も同じ扱い。

期限切れにしたら通信を中止し、現在のリクエストIDと採用・再試行を無効にする。候補を残す場合も採用不可と表示する。開き直して新snapshotを取得するまで有効に戻さない。元の文章や選択へ戻しても復活しない。

DOMのblur、ウィンドウのblur、AI入力欄へのフォーカス移動だけでは期限切れにしない。PM selectionが変わったかを比較する。

## 8. 非同期応答の受け入れ

Generatingであり、session ID、request ID、editor instance、content / selection / context revisionが現在値と一致し、snapshotが有効で、キャンセルされていない場合だけ候補を受け入れる。

AbortControllerだけには依存しない。中止を無視して後から成功する通信や、古いエラーにも同じ照合を行う。旧応答で新しい画面を上書きしない。

## 9. 採用処理の検証と適用

### 9.1 前提条件

採用は同期commandとする。候補確認中で、リクエストと候補が現在のセッションに属し、未消費、編集可能、本文・指示欄ともIME変換中でないことを確認する。

document、instance、各revision、PM selection、選択文字列、Sliceをsnapshotと照合し、候補の形式と文字数も再検証する。検証からdispatchまでにawait、保存待ち、React effectを挟まない。

### 9.2 置換

候補をLFで分割し、スキーマのparagraphとtextからopen depth 1のSliceを作る。`tr.replace()` で厳密に置換し、範囲を広げるfittingに頼らない。適合しなければ失敗とする。HTML parser、HTMLとして解釈する `insertContent()`、document全体の再構築は使わない。

### 9.3 dispatch前の不変条件検証

適用予定のdocumentをプレーンテキストにし、「元のprefix + 候補 + 元のsuffix」と完全一致するか調べる。一致しなければdispatchしない。段落境界でも、選択範囲外の文字を変えないための検証である。

### 9.4 完了

挿入末尾のカーソル位置はトランザクションのmappingで求める。session / request / candidateを識別するmetaはアプリが付け、プロバイダーから受け取らない。適用後はセッションを消費済みにし、画面を閉じて保存を即時予約する。二重クリックを2回の適用として処理しない。

## 10. Undo / Redo

1. 変更トランザクションに `closeHistory()` を適用し、直前の手入力を区切る。
2. AIの本文変更を1つのトランザクションでdispatchする。
3. `closeHistory()` と `addToHistory: false` を付けたmetadata-onlyトランザクションをdispatchし、後続の入力も区切る。

AIの本文変更自体には `addToHistory: false` を付けない。本文変更と履歴境界を合わせて、Undoでは1操作にする。Undo/Redoも通常の変更なので他のAI候補は期限切れになるが、候補画面やAPI呼び出しは再現しない。

## 11. AI連携とAPIの境界

ブラウザーは同一originのAI APIを呼ぶ。標準編集は `POST /api/ai/edits`、比較は `POST /api/ai/comparisons`、辞書・Feedbackは専用APIを使う。処理順は以下の通り。

1. Origin・Host・method・Content-Type・実測サイズとスキーマを検証する。
2. モデルを定義一覧で解決し、対応機能・接続設定・同意・回数制限を確認する。
3. intentを決め、文脈とプロンプトを組み立てる。
4. プロバイダーを呼び、出力を検証する。
5. アプリが候補IDを発行し、実際の提供元・モデルIDとともに返す。

サーバーにはブラウザーの現在のdocumentがない。位置・revisionをモデルへ渡さず、期限切れの最終判定はクライアントで行う。

## 12. プロバイダーの分離

`EditingProvider` は解決済みモデル定義、固定編集制約、入力データ、JSON応答スキーマ、出力上限、AbortSignalを受け取る。ChatGPTは確認済みconnection IDも受ける。結果は未検証の候補と利用量、または正規化したエラー。SDK型・refusal・Structured Outputの設定はアダプター内に閉じる。

OpenAI APIでは共通アダプターを使い、明示モデルもサーバーの許可リストで検証する。`automatic` は既定値を使うだけで、動的な振り分けや代替モデルへの切替はしない。

`local-default` はローカルモデルの設定枠であり、能力や上限を保証する登録ではない。具体的なIDは `LOCAL_LLM_MODEL` で指定し、ループバックの `/v1/chat/completions` へ非ストリーミングで送る。接続URL・認証情報は公開しない。

ChatGPTは `chatgpt-default` と `CHATGPT_MODEL` を使い、生成前にアカウントのカタログを確認する。OAuth・認証ファイル・SSEは `src/server/ai/chatgpt/` に閉じる。接続IDはAPI照合だけに使い、プロンプトや作品保存に含めない。再認証・解除でクライアントを同期的に無効化し、サーバーでも生成前後の接続IDを照合する。

Claude CLIと各社APIも共通の契約に従い、固有の型はサーバー外へ出さない。API利用の許可は作品の永続設定と分け、初期falseで管理する。

## 13. 文脈の組み立て

`context.ts` はsnapshotの文字列と設定を受ける純粋関数とし、DOMやエディタへ触らない。資料を自動検索せず、前後本文と明示した設定・資料だけを扱う。文字数とトークン予算は [AI編集仕様](AI_EDITING.md) に従う。

必須入力の計算は `src/features/ai-edit/prompt.ts` で共有し、サーバー側はserver-onlyの再エクスポートを使う。共有部分にReact、SDK、秘密情報、サーバー設定を含めない。メモは未信頼のJSONデータとして必須予算に含め、超過時はAPI呼び出し前に止める。

## 14. 保存

IndexedDBの `workspaces` に現在の作品、`workspace-files` に待機中の作品を保存する。設定と全章を同じWorkspaceSnapshotへ含める。現行の形式・DBバージョンは [データモデル](DATA_MODEL.md) を参照する。

画面からDBを直接操作せず、repositoryのload / save / replace / delete / listFiles / activateFileを使う。作品切替は同じトランザクションで、現在のIDとstorageVersion、切替先の形式、IDの重複を検証して退避・取出する。バックアップ置換でも他作品とのID衝突を拒否する。

### 保存順序

本文変更ごとにdirty sequenceを増やし、SaveCoordinatorで書き込みを直列化する。保存中に新しい変更があれば、完了後に最新snapshotを書く。最新のsequenceまで完了した場合だけ保存済みと表示する。離脱時にも保存を試みるが、終了前の完了保証はしない。

新規・読込・作品切替も直列化する。切替中だけ読み取り専用にし、現在の内容を保存する。失敗なら元のエディタで再開する。初期レコードの保存失敗後も、明示保存や切替前にはdirtyを設定して再試行する。空の保存キューを成功とみなして作品を捨てない。

### 編集状態と未保存の入力

EditorSessionsが作品ID・章ID・epochごとにEditorを所有する。表示中のviewだけをmountし、非表示では編集とcallbackを無効にする。所有者の破棄で全Editorを終了する。遅延するTipTapのcreate通知に備え、最初のトランザクションでもreadyを1回通知する。

未保存の作品設定・メモ・章設定は保存済みの値と比較し、親へ同期通知する。離脱・切替・取込・削除前に破棄を確認し、キャンセルした場合は入力もAIセッションも残す。通常保存は作品設定・メモ・章設定を保存して本文をflushし、その後にAI接続設定を保存する。複数の保存を単一トランザクションとは表示しない。接続だけ失敗した場合は原稿の保存完了と区別する。

メモ保存はPM documentや履歴を変更しない。設定フォームにメモが省略されても保存済みの値を残す。同じ値での再試行も実際にflushする。

10MiB以下の作品JSONまたは厳格にUTF-8デコードしたテキストを、新しいIDで開く。送信同意・revision・履歴は引き継がない。本文やメモはIndexedDB、閉じたタブIDとカーソルはlocalStorageに分け、UI状態の保存失敗で本文保存を妨げない。

### 別タブ

Web Lock `novel-editor:workspace` を取れた1タブだけが編集・AI生成できる。取れない場合と非対応環境は読み取り専用とし、localStorage leaseへ切り替えない。IndexedDBのバージョン比較も二重防御として残す。

## 15. 同時編集

共同編集・CRDT・remote mergeは対象外。別タブの書き込みは拒否する。古いAI候補の位置をmapping・検索・rebaseで追従させない。

## 16. Diff

`Intl.Segmenter` でgrapheme単位に分割し、選択中の候補だけWeb Workerでdiffを計算する。150msで打ち切り、原文と候補を並べて表示する。応答はrequest ID・candidate IDで照合する。表示用の差分を実行可能patchとして使わず、部分採用も最終的な置換文字列を検証してから適用する。

## 17. Retry / cancellation / streaming

再試行は新しいrequest IDを発行する。キャンセルは画面をすぐ閉じ、通信の停止も要求するが、提供元の処理・課金停止は保証しない。

ブラウザーへ候補をストリーミングしない。ChatGPTだけは承認された例外としてサーバー内でHTTP/SSEを受信し、`response.completed` と全候補の検証が完了してから返す。途中の失敗や受信上限超過では候補を捨てる。

## 18. エラーの隔離

| 失敗 | 扱い |
|---|---|
| AIの描画・通信 | AI領域で通知し、本文編集と保存を続ける |
| 保存 | メモリ上の本文を残し、未保存表示と書き出しを提供する |
| 初期読み込み | 空の本文で上書きしない |
| エディタの致命的エラー | 直近のメモリ・保存済みsnapshotから復旧する手段を示す |

失敗を握りつぶして成功や保存済みと表示しない。

## 19. セキュリティ

[セキュリティ仕様](SECURITY.md) に従う。サーバー専用モジュールに `server-only` を付け、lintとbuildで境界を検査する。本文・候補・説明・共通プロンプトは未信頼の文字列として扱う。

## 章・履歴・検索

現在章の本文はPM document、他章は保存snapshotから読む。章切替は現在本文をflushし、CASで保存してからviewを切り替える。文字数は現在章のPM documentと他章の保存本文から数え、改行を除き空白を含むコードポイント数だけをUIへ渡す。

検索は現在章のliteral文字列、最大500コードポイント、大小文字の指定あり、最大10,000一致。置換は最大3,000コードポイントで空文字も許可する。確認後にidentity・contentRevision・doc.eq・editable・compositionを同期検証し、逆順のreplaceを1トランザクションにまとめて履歴を区切る。本文変更後は再検索する。

履歴復元と一括取り込みは原子的に行い、同期的なリクエスト作成失敗でも中止する。自動履歴は本文保存後の別トランザクションなので、その容量不足で本文の保存成功を取り消さない。一括書き出しは単一readonlyトランザクションで読む。

ごみ箱への移動も、最新本文・履歴の退避と削除を同じトランザクションで行う。復元・完全削除はWeb LockとCASの下で実行する。作品は保存済み一覧へ追加し、削除済みの状態なら復元作品を開く。章は新IDで追加し、現在章を上書きしない。破棄したEditorや候補を復活させない。

## 接続設定と診断

クライアントとの契約はdomain、画面と通信はfeatures/ai-edit、ファイル保存と診断はserver/ai、HTTPの検証はserver/httpに置く。環境設定に保存済み設定を重ね、全APIで同じrevisionを解決する。`x-novel-ai-settings-revision` を推論前後に照合し、途中の変更を拒否する。破損時はAIだけを止める。

画面操作とBroadcastChannelからの変更通知でAIセッションを無効にし、実行情報を再読込する。他タブの変更でも入力中の接続設定は残すが、古いrevisionで保存できないようにする。診断はrequest ID・revision・modeを照合し、取消後の応答を捨てる。設定読み込みのGETは外部通信を行わない。

## 操作別の補足

| 操作 | 取得・検証する範囲 |
|---|---|
| `insert` | 空のTextSelection。元の位置、prefix / suffix、Slice、revisionを保持する |
| `context-insert` | 任意位置のゼロ幅TextSelection。元の本文を残す |
| `infill` | 前後に本文のある空白範囲、または途中の空段落 |
| `continue` | 現在章の末尾のゼロ幅TextSelection |

補完は採用直前に空白・空段落・章末尾の条件を再検証する。範囲を探索・移動しない。ゼロ幅置換の終点検証は操作名でなくfrom = toで判定する。補完の上限は挿入と同じ3,000文字、通常置換の原文比上限は維持する。目標文字数はAIセッション内だけに持ち、変更で旧候補を捨てる。

辞書は独立した照会request IDとAbortControllerを持つ。既存snapshotで対象を監視するが、編集コントローラーのsubmit / acceptは呼ばない。閉じる・期限切れ・破棄・モード変更で中止し、結果や画面状態を保存しない。サーバーは固定の辞書指示を内部生成要求へ変換し、既存プロバイダーと候補検証を共用する。本文・設定・メモは渡さない。

比較は同じ入力を2〜3接続へ並列に送り、提供元ごとの検証済み結果を同じrequest IDへまとめる。回数制限はプロバイダーごとに共有し、型・SDK・認証は共通契約の内側へ閉じる。
