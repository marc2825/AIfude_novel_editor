# AIFUDE（合い筆）

**プレビュー版です。** 実機の日本語IME・実AI・スマホPWAの確認が残っています。公開前の残件は [公開前TODO](docs/PUBLISHING.md)、検査手順は [開発手順](docs/DEVELOPMENT.md) を参照してください。

Local-first Japanese novel editor with explicit AI suggestions, diffs, and acceptance. Preview release; Linux / WSL are the primary tested environments.

人間が小説を書き、必要な箇所だけAIに局所編集させるエディタ。

AIによる小説の自動執筆サービスではない。本文編集が主機能であり、AIは選択範囲に対する補助機能である。

## 最初に起動する

Node.js 24.21.0以上の24系とpnpm 10.34.5を用意し、このフォルダで実行します。

```sh
pnpm install --frozen-lockfile
pnpm dev
```

ブラウザーで `http://127.0.0.1:3000` を開きます。環境変数・保存済みAI設定がない初回はAI無効で、本文編集と保存を利用できます。AI操作のデモには `.env.example` を `.env.local` へコピーしてから起動します（mock候補・有料API無効）。原稿はブラウザー内に保存するため、重要な原稿は「全作品を一括バックアップ」から書き出してください。

## ライセンスと報告窓口

Copyright 2026 marc2825。コード・文書・権利を保有する自作素材は [Apache-2.0](LICENSE) で提供します。[NOTICE](NOTICE) と [第三者ライセンス](docs/THIRD_PARTY_LICENSES.md) も参照してください。依存ライブラリと外部AIサービスには、それぞれのライセンス・利用条件が適用されます。

セキュリティ上の問題の報告方法は [SECURITY.md](SECURITY.md) に記載しています。原稿や認証情報を公開Issueへ投稿しないでください。

## スマホ幅での操作（Phase 1）

本文を選択して、原稿上部の **AI提案** をタップします。下部の **AIツール** で辞書・中間補完・続き・文脈挿入も選べます。候補のタブで原文・提供元・Diffを確認し、**採用** で反映します。↶ / ↷ は本文のUndo / Redoです。

作品の作成・読込・JSON書き出しは **作品操作**、章・メモリ・履歴は下部ボタンから開きます。パネルを閉じても入力中のdraftは残り、未保存のメモ・設定は画面に通知されます。**保存** でまとめて保存できます。

サーバーは引き続き `127.0.0.1` 限定です。PC上の静的PWA shellは実装済みですが、実スマホからのPC接続や製品の端末間同期は提供していません。実機の日本語IME・長押し選択は未検証です。現在の制約は [公開前TODO](docs/PUBLISHING.md)、後続機能は [ロードマップ](docs/roadmap/IMPLEMENTATION_PLAN.md) を参照してください。

## 中心UX

1. 本文を書く。
2. 編集したい文字列を選択する。
3. 右クリック → **AI提案**、またはCmd/Ctrl + KでAI編集入力欄を開く。
4. 「自然に」「台詞を自然に」「語尾の重複」「文のリズム」などを選ぶか、編集指示を入力する。
5. 2案または3案の候補を取得する。
6. 原文、候補、Diffを確認する。
7. Acceptした候補だけを選択範囲へ適用する。
8. UndoでAI適用を1回の操作として戻せる。

## 画面の使い方（Task 18.1）

本文を中央の原稿用紙で編集し、補助操作は同じ画面の右パネルで行います。

| 場所 | できること |
|---|---|
| 上部の作品タブ・操作バー | 新規作品、ファイルを開く、作品切替、保存（Cmd/Ctrl + S）、JSON保存 |
| 上部の「ファイル」 | 全作品のバックアップと復元、ごみ箱 |
| 上部の「設定」 | 作品名、共通プロンプト、文体、モデル・送信同意、単体バックアップ |
| 上部の「AI接続」 | 主に使うAI、比較するAI、接続設定・診断 |
| 右側の「メモリ」 | 設定・背景・登場人物のメモを編集・保存 |
| 右側の「章」「履歴」 | 章・アウトライン、名前付き保存と復元 |
| 原稿の上／下 | 検索・置換（Cmd/Ctrl + F / H）、文字数と執筆目標 |

右パネルは同じボタン、×、またはパネル内のEscで閉じられます。閉じたり別のパネルに切り替えたりしても、未保存の入力は残ります。通常の「保存」は閉じたパネルの作品設定・メモ・章設定も保存します。

**言い換えを比較するには**、本文を選択し、右クリックの「AI提案」を選びます（キーボードではCmd/Ctrl + K、またはShift + F10）。ポップアップで原文・指示・送信先を確認して生成します。候補カードには提供AI・モデル・文字数差を表示し、候補を選ぶと本文と差分を確認できます。「採用」で選択範囲だけを置換し、1回のUndoで戻せます。生成後に条件を変えるには「指示・送信設定を変更」を開きます。

複数AIの比較は、上部「AI接続」で比較対象を設定した後、ポップアップで2〜3個のAIを選択して送信に同意し、「N個のAIへ同時送信」を押します。候補の選択やパネルを開く操作だけでは生成しません。API接続は初期OFFです。作品メモリも生成ごとの初期OFFで、参照する項目を選択できます。

本文・選択範囲・保存した参照設定が変わると古い候補は期限切れになり、採用できません。AIによる意味・視点・口調の保持は、原文と差分を読んで確認してください。

今回の変更と検証結果はTask 18.1 実装レポート（開発履歴・配布対象外）を参照してください。

### 右クリックで使うAIツール（Task 18.2）

画面右端の「AIツール」で選択し、本文の対象範囲を選んで右クリック→「AI提案」、またはCmd/Ctrl + Kで開きます。ラジオボタンはTabと矢印キーでも選べます。

| ツール | 用途 |
|---|---|
| 書き直し / Rewrite（初期値） | 意味と基本的な文体を保って自然にする。既存プリセット・日本語推敲指示も使用可能 |
| 文体変換 / Transform | 「幻想的」「静かな余韻」などの雰囲気と、控えめ・標準・強めを指定。組み立てた編集指示を送信前に調整可能 |
| 膨らませる / Expand | 原文の描写を丁寧に言葉にして長くする。新しい事実・心情・設定・出来事は追加しない |
| 短くする / Condense | 要点を保ち、冗長な表現を減らす |
| 自由指示 / Custom | 「敬体に」「余韻を残して」などを自由に指示。固定の保持条件内で文体・長さも調整可能 |

選んだツールは起動中の作品切替でも維持し、再読み込みで「書き直し」に戻ります。選ぶだけでは生成しません。開いている選択範囲のAI画面や生成はツール変更で閉じるため、対象範囲から開き直してください。採用前の候補は本文に入りません。

本文を書き換える5ツールでは出来事・人物・視点・時系列・台詞の意味・事実・固有名詞を保持する制約が優先されます。視点変更や新しい設定の追加は対象外です。膨らませる場合も候補は3,000文字と「原文の2倍＋128文字」の小さい方まで。意味や品質は自動保証されないため、原文・候補・Diffを確認して採用してください。この5ツールで空selectionから開く既存の「AI文章挿入」は、選んだツールの影響を受けません。

変更ファイル・検査結果と追加モードの提案はTask 18.2 実装レポート（開発履歴・配布対象外）に記録しています。

### 辞書モード（Task 18.3）

1. 右端の「辞書」を選び、本文から調べたい単語・語句を選択します（1〜100文字）。
2. 右クリック→「辞書で調べる」、またはCmd/Ctrl + Kで辞書を開きます。開くだけでは照会しません。
3. 「LLMで調べる」で、主AIに読み・意味・短い例文・使い分けを尋ねます。既存の接続と外部送信同意を使用し、API接続は引き続き初期OFFです。
4. 「Googleで意味を検索（別タブ）」では、語句と「意味」をGoogleへ送って検索結果を開きます。LLM未接続でも利用できます。アプリ内には検索結果を取り込みません。

辞書は読み取り専用で、説明を採用・本文挿入する操作はありません。LLMへ送るのは語句と固定の辞書指示だけで、前後本文・作品設定・メモを含めません。LLMの説明は検索結果や出典付き辞書ではなく、読みや用法の正確さを保証しません。「デモ応答」の場合は実際の語義説明ではありません。

閉じる・照会中止・本文／選択／参照設定の変更・ツール切替で旧結果を破棄し、自動で再照会しません。本文の編集・保存は続けられます。辞書では空selectionから文章挿入を開かず、語句の選択を案内します。

変更ファイル・検査結果・未確認事項はTask 18.3 実装レポート（開発履歴・配布対象外）を参照してください。

## 指定した内容を前後の文脈に沿って挿入する

1. 右端の **文脈で挿入（Context Insert）** を選び、書き足したい位置へカーソルを置きます。文の途中・章の先頭／末尾で使えます。
2. 右クリック→「文脈で挿入」、または **Ctrl / Cmd + K** で開き、**書きたい内容**を入力します。例：「主人公が返事をためらう仕草を、前後につながるように描いて」。
3. 必要なら目標文字数（1〜3,000、初期400）・候補数・複数AI比較を設定して生成し、候補とDiffを確認して **採用** します。

前後各最大1,000文字と作品の共通プロンプト・手動文体を参照します。作品メモリは任意ONです。範囲選択はせずカーソル位置を指定するため、前後の本文は完全に残り、1回のUndoで戻せます。空の章では入力した内容から候補を作ります。初期モードは「書き直し」です。

既存の「AI文章挿入」はプロンプトだけを使い、「中間補完」は空白だけを埋めます。文脈と内容を指定して任意位置へ書き足す場合は、このモードを使います。検証結果（開発履歴・配布対象外）。

## 中間補完・続きを書く

右端でモードを選んで使います。初期モードは「書き直し」のままです。

- **中間補完（Infill）**：前後に本文がある空白だけを選択するか、途中の空段落にカーソルを置き、右クリック→「中間補完」（またはCtrl / Cmd + K）。選択した空白／空段落内だけに文章を作ります。
- **続きを書く（Continue）**：現在の章の本文末尾にカーソルを置き、右クリック→「続きを書く」（またはCtrl / Cmd + K）。
- **目標文字数**を1〜3,000文字で指定し、必要なら指示を調整して生成します。候補・Diff・実際の文字数を確認し、「採用」で反映します。1回のUndoで戻せます。

前後各最大1,000文字（続きは直前のみ）と作品の共通プロンプト・手動文体を参照します。作品メモリは従来どおり任意ON、複数AI比較も利用できます。文字数は改行込みの目標で、厳密一致は保証されません。生成後の自動挿入や連続生成はしません。空の章や通常文中のカーソルは、この2モードの対象外です。

検証結果：Task 18.4 report（開発履歴・配布対象外）。

## V0.1の範囲

- プレーンテキスト相当の小説本文編集。
- IndexedDBへの自動保存。
- JSONバックアップと本文のテキスト書き出し。
- 選択範囲、前後文脈、共通プロンプト、手動文体設定を使ったAI編集。
- 作品ごとの設定・背景・登場人物メモの保存と、生成ごとの任意参照。
- 候補比較、Diff、Accept、Reject、Retry。
- 日本語IMEとキーボード操作への対応。
- ローカルPCで動作する単一ユーザー用アプリ。

Task 14.1で作品ごとのファイル・タブ管理、Task 15.1で章・アウトライン・保存履歴などの基本執筆機能を追加する。Character Sheets、Story State、学習、アプリ自身のログイン、クラウド同期、共同編集は実装しない。

## 配置済みファイルと実装ファイル

このrepositoryには、アプリ、設計文書、Skills、LLM出力契約、自動テストを含む。配布と起動はloopback上のローカル専用であり、公開SaaSとしての運用は対象外である。Windows / macOS日本語IME、物理keyboard、screen readerの必須人手gateは未実施。検査状況と残件は [公開前TODO](docs/PUBLISHING.md) を参照する。

現在の画面ではparagraphとtextだけの本文を入力し、プレーンテキストを貼り付けられる。EnterとShift + Enterは段落分割となり、editor内でUndo/Redoを利用できる。初期hydrationの完了後にeditorを表示し、本文変更を500ms debounce（継続入力時は最大2秒）でIndexedDBへ直列保存する。画面上部には「未保存」「保存中」「保存済み」「保存失敗」を表示する。本文の有効な選択範囲からCmd/Ctrl + Kで非modalのAI編集入力欄を開き、指示、プリセット、候補数、送信予定文脈を確認できる。

AI候補は同一originの`POST /api/ai/edits`から取得し、canonical schemaとrequest IDで検証してsession内にだけ保持する。本文、selection、参照設定、編集権限、editor instanceのいずれかが変わるとsessionをstaleにし、通信をabortして遅延応答を破棄する。候補は本文外で比較・Diff表示し、明示的なAcceptだけがPhase 3の同期的な安全置換を実行する。OpenAIを選んだ場合もPreview、stale、Accept、Undo/Redo、自動保存の経路はprovider非依存である。

同一originではWeb Locksの`novel-editor:workspace`を取得した1タブだけが編集できる。2つ目のタブは読み取り専用となる。Web Locks非対応環境でも、既存workspaceは読み取り専用で表示し、安全でない代替lockへfallbackしない。

「設定とバックアップ」から、作品名、共通プロンプト、手動文体設定、AI model preferenceを保存できる。本文はUTF-8テキスト、本文・設定・作品メモリはversion 6のcanonical `WorkspaceSnapshot` JSONとしてclient内だけで書き出す。version 1〜5は本文・既存設定を保持し、不足フィールドだけを補ってversion 6へmigrationする。ファイル名は作品名を安全化した`<作品名>.txt`と`<作品名>-backup.json`である。JSON importは10MiB以下に限定し、全体のschema検証と上書き確認後に原子的に置換する。import元の`storageVersion`は競合判定へ流用せず、AI送信同意とUndo履歴は復元しない。ローカルデータ削除にも確認が必要である。

設計に存在する将来エンティティを理由に、未使用の実装ファイルを生成してはならない。

Phase 10 / Task 10.1では、Ollama優先のローカルLLM接続を追加した。LM Studioも同じOpenAI互換adapterで接続できる。実モデルの疎通と文章品質の検証は、READMEの手動手順で別途行う。

Phase 11 / Task 11.1では、主な接続としてChatGPTサブスク連携を追加した。設定画面から公式OAuthで接続し、外部送信に明示同意して使用する。利用枠不足や接続失敗で別providerへ自動切替しない。実アカウントの認証・推論は未検証であり、以下の手動smoke手順で確認する。

Phase 12 / Task 12.1では、プロンプトからの文章挿入と、複数AIへの同時自動送信・比較を追加した。本文で文字を選択せずCmd/Ctrl + Kを押すと「AI文章挿入」を開く。標準では入力プロンプトだけを送信し、1案（最大3案、各3,000文字以内）を確認して「採用」でカーソル位置へ挿入する。本文・前後文脈・共通プロンプト・手動文体・挿入座標は送らない。Task 13.1の作品メモリだけは、生成画面で明示ONにした場合に追加する。候補表示中も編集できるが、本文やカーソル位置が変わると候補は期限切れになる。

比較するAIを2〜3個選び、送信に同意して「同時送信」を押すと、同じ入力を各接続へ並列送信する。回答のコピー＆ペーストは不要。各AIの出力を並べて比較し、選んだ1件のDiffを確認して採用する。一方の失敗で他方の成功を破棄せず、自動再送・他のAIへの切替もしない。各AIの利用枠は個別に消費する。

## 作品メモリの使い方（Task 13.1）

1. 「作品メモリ（設定・背景・登場人物）」を開き、3つのメモ欄へ入力して「メモリを保存」を押す。各欄は最大2,000文字（Unicodeコードポイント）。入力途中のメモはAIへ送信しない。
2. 本文でCmd/Ctrl + Kを開き、「保存済み作品メモリを参照する」をONにする。初期状態と新しいAIセッションではOFF。設定・背景・登場人物を個別に選択し、「送信するメモを確認」で実際に送るメモを確認できる。参照項目を減らすと入力予算も減る。
3. 置換・文章挿入・複数AI比較のいずれでも使用できる。OFFではメモを送信しない。ONでは選んだ各AIへ同じメモを送るため、外部providerへの送信同意も確認する。
4. 本文・設定・メモは「設定とバックアップ」のJSON書き出しと取り込みでバックアップ・復元できる。テキスト書き出しには本文だけを含む。

メモを保存変更すると生成中・表示中の旧候補を期限切れにする。参照ON/OFFの変更でも旧候補は破棄し、自動再生成しない。メモを含む必須入力が予算を超えると生成を止めるので、メモや指示を短くするか参照をOFFにする。ONのメモを黙って削ったり切り詰めたりしない。

未保存メモがある場合は画面内に表示し、reload / 離脱時はbrowser標準の確認を要求する。取込・新規作成・作品切替・現在のタブを閉じる・削除ではメモを破棄するか確認する。取消時は入力を保持する。離脱確認の表示や文面はbrowserが管理し、強制終了・端末障害からの復旧は保証しない。

メモは手入力で管理し、AIによる自動更新・要約・学習は行わない。ファイルシステムのAGENTS.mdも読み込まない。保存とJSONバックアップは暗号化していない。version 6で保存したデータは旧アプリでは開けないため、旧版へ戻す場合は更新前のバックアップを使用する。

## 保存・ロード・作品タブ（Task 14.1）

- 「保存」またはCmd/Ctrl + S：現在の本文と入力中の作品メモリ・章設定・作品名・共通プロンプト・文体設定を保存する。開いているAI接続画面の未保存設定も保存する。本文の自動保存も継続する。
- 「JSONで保存」：上記を保存してから、現在の1作品をJSONファイルとしてdownloadする。全作品まとめてのbackupではない。本文だけの.txt書き出しも既存の設定画面から使用できる。
- 「新規作品」：本文・設定・メモが空の別作品を作る。名前は「設定とバックアップ」で変更できる。
- 「ファイルを開く」：10MiB以下のJSONバックアップまたはUTF-8の.txtを、新しい作品として開く。既存作品を上書きしない。JSONでは本文・設定・メモを引き継ぎ、IDと履歴を新規化し、AI送信同意は復元しない。
- タブで作品を切替。切替前に現在の本文を保存し、失敗時は切替を中止する。閉じたタブは「保存済み作品を開く」から再度開ける。最後のタブは閉じられない。reloadでは保存済み作品をすべてタブへ表示する。

作品切替は新しいAIセッションで開く。候補は破棄し、同じ起動中のUndo・カーソル位置は作品／章ごとのeditorに保持する。本文とメモは作品ごとに分離する。既存の「JSONバックアップを取り込む」は現在作品の置換操作として維持し、別の保存済み作品とIDが衝突する場合は拒否する。

IndexedDB database version 2へ、待機中作品用のstoreを追加する。既存の本文recordはそのまま保持する。旧アプリへ戻すには、更新前のバックアップと別の保存環境を使用する。アップグレードが進まない場合は旧アプリのタブを閉じて再読み込みする。

## 読む順序

1. `AGENTS.md`
2. `docs/REQUIREMENTS.md`
3. `docs/ARCHITECTURE.md`
4. `docs/IMPLEMENTATION_PLAN.md`
5. 対象Taskに関連する仕様とSkill
6. `docs/DEFINITION_OF_DONE.md`

設計変更は`docs/DECISIONS.md`に記録する。

## 開発環境

現在の開発環境：

- Node.js >=24.21.0 <25（CIは24.21.0）
- pnpm 10.34.5
- Next.js 16.4.1
- React / React DOM 19.3.0
- TypeScript 6.0.3
- Playwright 1.63.0

Node.jsの最低版とCI版は`.node-version`、許容範囲は`engines`、pnpmは`packageManager`と`engines`、packageは`package.json`と`pnpm-lock.yaml`を正本とする。

Phase 1 / Task 1.1で固定したバージョン：

- TipTap（core、React統合、ProseMirror束、Document / Paragraph / Text）3.31.3

StarterKitと追加のhistory extensionは導入していない。Task 1.2では`@tiptap/pm`に含まれるhistory pluginを1個だけ構成している。

Phase 2 / Task 2.1で固定したバージョン：

- Zod 4.6.6
- idb 8.0.3
- fake-indexeddb 6.2.5（テスト専用）

保存データはZodで検証するversion 6の作品ごとの`WorkspaceSnapshot`。version 1〜5は読み込み境界でversion 6へmigrationする。IndexedDB database versionは5で、`workspaces`に現在の1作品、`workspace-files`に待機中の作品、`workspace-history`に保存履歴、`workspace-trash`に削除した作品・章を保持する。repositoryの`listFiles` / `activateFile`で一覧取得と原子的な切替を行い、既存の`load` / `save` / `replace` / `delete`を維持する。画面から直接IndexedDBを操作しない。

Phase 8 / Task 8.1で固定したバージョン：

- OpenAI JavaScript / TypeScript SDK 7.20.0

SDKはNode.js 22以上を要求し、固定Node.js 24.21.0で使用する。OpenAI SDKとAPIキーはserver-only境界に置き、browser bundleへ渡さない。

## 標準コマンド

対応範囲内のNode.jsと固定pnpmを用意して、次のコマンドを使用する。

- 依存導入：`pnpm install --frozen-lockfile`
- 開発起動：`pnpm dev`（`http://127.0.0.1:3000`）
- 本番相当起動：`pnpm build`の後に`pnpm start`
- 型検査：`pnpm typecheck`
- 静的検査：`pnpm lint`
- Vitest実行（非watch）：`pnpm test`
- 基本検査一括実行：`pnpm check`
- ビルド：`pnpm build`
- Chromium / WebKitと必要なsystem dependencyの導入：`pnpm exec playwright install --with-deps chromium webkit`
- E2E：`pnpm test:e2e`
- PWA / 同期E2E：`pnpm test:e2e:pwa` / `pnpm test:e2e:sync`

開発サーバーと本番サーバーはloopbackへbindする。LANやインターネットへの公開を標準動作にしない。

## PCの起動ファイル（Task 17.1）

初回だけ、`.node-version`のNode.jsと指定pnpmを用意し、`pnpm install --frozen-lockfile`を実行する。AIの認証・キー設定は従来の手順で行う。ランチャーは依存installや認証設定を自動実行しない。起動ファイルから見えるPATHにも指定Node.jsが必要。

| 環境 | 起動方法 |
|---|---|
| Windows + WSL | プロジェクトの`start-editor.cmd`をダブルクリック。プロジェクトへアクセスでき、Node.jsと依存を用意した既定WSLディストリビューションを使用する |
| macOS | `start-editor.command`をダブルクリック（初回の実行許可はOS側の操作が必要な場合がある） |
| Linux / WSL terminal | `./start-editor.sh`。GUIの「実行」やこのファイルへのショートカットからも起動可能 |
| 共通のterminal操作 | `pnpm launch`。自動でbrowserを開かない場合は`pnpm launch --no-open` |

本番build → このPCの`127.0.0.1:3000`で起動 → 起動確認 → 標準browserで表示、の順に実行する。ソース更新後も古いbuildを使わないよう毎回buildする。最初のウィンドウでCtrl+Cを押すとserverを停止する。browserだけを閉じてもserverは動作する。同じランチャーで起動済みなら、再実行でbrowserだけを開く。

URLは`http://127.0.0.1:3000`へ固定し、子processの`APP_ORIGIN`にも同じ値を使う。port競合で他のportへ逃がさず、browserの保存先originを維持する。独自URL・portを使う場合は従来の開発／本番起動を使用する。`localhost`など別originで書いていた作品は自動移動しないので、元のURLからJSONで書き出して取り込む。

browserを開けない場合もserverを動作させ、手動で開くURLを表示する。WSLではWindowsの標準browserへ表示を依頼する。起動途中・別serverのport使用・異常終了時の残存lockでは処理を止めて案内する。`.novel-editor-launcher.lock`は、全serverを止めたことを確認した場合だけ手動削除する。原稿や認証情報はこのlockに含めない。

Windows native serverへの切替、アプリのインストーラー、常駐サービス登録は行わない。Windows / macOSの実GUIからのダブルクリック確認は未実施。Windowsの[WSLコマンド](https://learn.microsoft.com/en-us/windows/wsl/basic-commands)と、固定Nodeの[TypeScript実行](https://nodejs.org/docs/latest-v24.x/api/typescript.html)を利用する。

スマホからの接続、PCとの作品同期、PC停止中の利用、アプリ形式の配布は[Phase 17の今後の計画](docs/IMPLEMENTATION_PLAN.md#phase-17起動の簡略化と端末連携)へ記録した。現時点ではPC内のローカル利用を維持する。

標準E2EはChromiumでbootstrap、editor、local mock編集、Reject、API failure、stale、応答乱順、Undo/Redo、保存・reload、別タブ、keyboard-only、境界値、外部送信同意とmodel設定を確認する。モバイル幅、PWA（Chromium / WebKit）、同期fixtureも別構成で検査する。privacy E2Eは同一originのAI routeをinterceptし、実APIキーや外部providerを使わない。CIは固定したNode.jsとpnpmで基本検査・依存監査・build・各E2Eを実行する。対応表は [テスト仕様](docs/TESTING.md)、手動確認の残件は [公開前TODO](docs/PUBLISHING.md) を参照する。

## Claudeサブスクの接続と比較の手動確認

このPCへ[公式Claude CLI](https://code.claude.com/docs/en/setup)を導入する。`--safe-mode` / `--restricted`などに対応した現行CLIが必要で、非対応版では生成を失敗させる。アプリがCLIの導入や更新を自動実行することはない。

1. repository外に専用の認証ディレクトリを作成してログインする。既定ディレクトリを使う場合のLinux / WSL例：

   ```bash
   mkdir -p "$HOME/.local/share/novel-ai-editor/claude"
   chmod 700 "$HOME/.local/share/novel-ai-editor/claude"
   CLAUDE_CONFIG_DIR="$HOME/.local/share/novel-ai-editor/claude" claude auth login
   CLAUDE_CONFIG_DIR="$HOME/.local/share/novel-ai-editor/claude" claude auth status
   ```

2. `authMethod`が`claude.ai`または`oauth_token`ならサブスク枠で動作する。アプリはCLIのログイン方法を固定しない。APIキー（`--console`）など、サブスク以外の認証は各自の契約で従量課金となるため、サーバーで`AI_ENABLE_PAID_API=true`を設定した場合だけ生成する。未設定なら本文を送る前に失敗させる。アプリはサーバー自身のAPIキーや環境変数の認証情報をCLIへ渡さず、CLIが専用ディレクトリへ保存したログインだけを使う。サブスク枠のみで使う場合はClaudeアカウント側の追加使用量をOFFにする。CLIの資格・対象モデル・利用枠は[Claudeの契約条件](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan)に従う。
3. `.env.local`で`CLAUDE_MODEL`に使用可能な正確なmodel ID（例：`claude-sonnet-5`）、`AI_COMPARE_PROVIDERS=chatgpt,claude`を設定する。サブスク枠だけで使う場合は`AI_ENABLE_PAID_API=false`のままにする。独自ディレクトリを使う場合だけ`CLAUDE_AUTH_DIR`、PATHにない場合だけ`CLAUDE_CLI_PATH`へ絶対パスを指定する。
4. serverを再起動し、ChatGPTも画面から接続する。作品の使用モデルは「自動」にする。本文でCmd/Ctrl + Kを開き、ChatGPTとClaudeを選択して同意し、同時送信する。2つの出力、提供元、モデルを確認し、片方だけ採用してUndo / Redoする。挿入モードでも同じ比較を確認する。
5. Claudeを未ログインにする、または利用不可モデルを設定した場合、Claudeの失敗が表示され、他方の検証済み候補と本文編集・保存が維持されることを確認する。実アカウント・実推論のこの手順は自動テストとは別で、今回未実施。

アプリは空の一時作業ディレクトリからCLIを実行する。本文はstdinだけへ渡し、ツール・MCP・カスタマイズ・履歴保存・telemetry・自動retry・fallbackを無効にする。生成は1ターンに制限し、設定モデル以外が使用された結果を拒否する。管理者の強制ポリシーやCLI更新の影響は実機で確認が必要である。認証ファイルはCLIが管理し、本文バックアップやブラウザーデータ削除には含めない。

API方式は各サービスの公式エンドポイントへ1回だけ送信する。Claudeは[MessagesのStructured Outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)、Geminiは[公式OpenAI互換API](https://ai.google.dev/gemini-api/docs/openai)、Grokは[Structured Outputs](https://docs.x.ai/developers/model-capabilities/text/structured-outputs)、DeepSeekは[JSON Output](https://api-docs.deepseek.com/guides/json_mode/)を使う。DeepSeekはJSON Schemaの強制を仮定せず、返答全体を共通schemaと候補上限で再検証する。無効JSONの修復呼び出しは行わない。

## 日本語IME手動確認

syntheticなcomposition testは実OSの日本語IME確認を代替しない。macOSまたはWindowsの日本語IMEとChromium系ブラウザーで、次を確認する。

1. editorへ日本語を入力する。
2. 変換候補を選ぶ。
3. Enterで変換を確定し、意図しない段落が増えないことを確認する。
4. composition終了後にEnterを押し、通常の段落分割になることを確認する。
5. Shift + Enterも段落分割になることを確認する。
6. Undoで段落分割または直前の入力が戻ることを確認する。
7. Redoで同じ変更が復元されることを確認する。

実施時はOS、IME、browser version、確認日、結果を記録する。

## AI設定

`AI_PROVIDER`は下表の接続ID、または`disabled`を指定する。未設定時は`disabled`となる。

| 接続ID | 接続方式 | 設定 |
| --- | --- | --- |
| `chatgpt` | ChatGPTサブスク・公式OAuth | `CHATGPT_MODEL`、画面から接続 |
| `claude` | Claudeサブスク・公式CLI | `CLAUDE_MODEL`、専用ディレクトリで事前ログイン |
| `openai` | OpenAI API・別料金 | `OPENAI_API_KEY` / `OPENAI_MODEL` |
| `anthropic` | Claude API・別料金 | `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` |
| `gemini` | Gemini API・別料金 | `GEMINI_API_KEY` / `GEMINI_MODEL` |
| `xai` | Grok API・別料金 | `XAI_API_KEY` / `XAI_MODEL` |
| `deepseek` | DeepSeek API・別料金 | `DEEPSEEK_API_KEY` / `DEEPSEEK_MODEL` |
| `local` | Ollama / LM Studio | `LOCAL_LLM_BASE_URL` / `LOCAL_LLM_MODEL` |
| `mock` | 外部送信しない動作確認 | キー不要 |

サブスクが基本で、API接続は初期OFF。APIを使用する場合は`.env.local`で`AI_ENABLE_PAID_API=true`と対象キー・モデルを設定して再起動し、画面の「設定とバックアップ」でAPI接続を明示的に有効にする。この画面のONは保存・バックアップせず、reloadでOFFへ戻る。同意が保存済みでも、APIがOFFなら送信できない。API使用はChatGPT / Claude / Google AIなどのサブスク契約と別料金である。

比較候補は`AI_COMPARE_PROVIDERS=chatgpt,claude`などで初期設定する。APIも比較する例は`chatgpt,claude,gemini`。サーバー側のAPI設定がOFFの間はAPI接続を候補から除外する。有効にした接続の設定が不正なら比較機能だけを無効にし、本文編集・保存と正常な主接続は維持する。「AI接続の設定・診断」で主接続・比較候補・モデル・loopbackのローカルURLを上書きでき、保存後は再起動せず反映される。外部providerのURLは固定。キー・認証・CLIや環境変数自体の変更にはserver再起動とpage reloadが必要。

Gemini・Grok・DeepSeekのサブスク接続は未対応。特にGemini公式CLIは本文のローカル会話履歴を無効化する方法を確認できていないため、履歴を書かない現在の仕様では採用していない。上表のAPI方式をサブスク枠と同一視しない。

設定例はChatGPTサブスクを使う`chatgpt`を主とする。未接続・未同意では生成できず、利用枠不足・接続失敗でもAPI key方式のOpenAIやローカルLLMへ自動切替しない。必要な設定が不足・不正な場合はAIを無効にする。mockの場合は画面に「デモ候補・外部送信なし」と表示する。

AI routeに関係する環境変数：

- `APP_ORIGIN`
- `AI_PROVIDER`
- `NOVEL_AI_SETTINGS_PATH`（任意。repository外の絶対ファイルパス。画面から保存した接続設定用）
- `CHATGPT_MODEL`（`AI_PROVIDER=chatgpt`で必須。認証済みアカウントで利用可能なmodel）
- `CHATGPT_AUTH_DIR`（任意。repository外の絶対path。未指定時は`~/.local/share/novel-ai-editor/chatgpt`）
- `LOCAL_LLM_BASE_URL`（`AI_PROVIDER=local`で必須。Ollamaは`http://127.0.0.1:11434/v1`）
- `LOCAL_LLM_MODEL`（`AI_PROVIDER=local`で必須。推論サーバー内の正確なmodel ID）
- `LOCAL_LLM_API_KEY`（ローカルサーバーが認証を要求する場合だけ設定）
- `OPENAI_API_KEY`（`AI_PROVIDER=openai`で必須）
- `OPENAI_MODEL`（`AI_PROVIDER=openai`で必須）

APIキーはサーバー専用。ブラウザー、IndexedDB、バックアップ、ログへ保存しない。

`OPENAI_MODEL`に暗黙の「最新モデル」は設定しない。対応値は`gpt-6-astra`、`gpt-5.6-sol`、`gpt-5.6-terra`、`gpt-5.6-luna`であり、server設定とrequest overrideはcanonical registryのallowlist、provider対応、Responses API / text入出力 / Structured Outputs、context・出力上限を外部送信前に検証する。

モデル設定はworkspace単位で保存する。`自動（サーバー既定）`は文章を解析するroutingではなく、設定providerのdefault（サブスクは`CHATGPT_MODEL`、ローカルは`LOCAL_LLM_MODEL`、OpenAI APIは`OPENAI_MODEL`）を使用する。サブスクとローカルのmodel IDはserverで指定し、clientから自由入力しない。明示選択は有効なOpenAI API allowlist IDだけを同一origin APIへ送り、serverが再解決する。利用不能になった明示modelは別modelへfallbackしない。OpenAI API内でmodelだけを変更しても、provider IDとpolicy versionが同じ同意は保持する。model説明はproviderの事実上の位置付けであり、文学的品質のrankingではない。

`POST /api/ai/edits`は同一originのJSONリクエストだけを受け付ける。すべての応答は`Cache-Control: no-store`で、provider deadlineはサブスク・ローカル180秒、OpenAI API・mockは30秒（clientはそれぞれ185秒・35秒）。`mock`は外部通信せず、APIキーも送信同意も不要で、入力件数どおりの決定的なデモ候補を返す。`disabled`ではrouteは`AI_UNAVAILABLE`を返す。

`openai`は外部送信providerであり、provider ID `openai`のpolicy version 1同意が一致する場合だけadapterを呼ぶ。UIは初期状態を未同意とし、送信先、model、送信データの種類、保持方針を表示してから明示同意を保存する。保存完了前はclientからAI routeを呼ばず、server側の同意gateも維持する。同意変更はAI参照設定revisionを増やし、開いているAI編集を期限切れにする。同意は設定画面から撤回でき、撤回後は新規requestを禁止して進行中requestをabortする。

API key方式のOpenAI adapterはResponses APIの非streaming単発requestを使い、Phase 4の固定指示を`instructions`、boundedな入力JSONを`input`へ分ける。frozen candidate schemaを`text.format`のstrict Structured Outputsとして再利用し、`store: false`、SDK retry 0、toolsなし、conversation stateなしで実行する。出力上限は既存の2候補8,192 / 3候補12,288 tokenをそのまま使い、30秒deadlineのAbortSignalをSDKへ渡す。`store: false`はResponses APIで応答を後から取得するための保存を無効にする設定であり、OpenAI側のあらゆる保持がないとの保証ではない。契約、アカウント設定、[OpenAI APIのデータ取扱い](https://developers.openai.com/api/docs/guides/your-data)が別途適用される。

ローカル疎通では`.env.example`を基に`APP_ORIGIN`を起動URLへ合わせ、`AI_PROVIDER=mock`へ変更して起動する。mockを実AIの文章品質確認には使用しない。

### ChatGPTサブスクの設定と手動smoke test

公式の[Sign in with ChatGPT](https://developers.openai.com/siwc/token-sharing-open-source)を使用する。対象はこのPCで動く個人用アプリと、利用資格のあるChatGPT Plus / Proアカウント。アカウントの許可・利用可能model・残量は実際の認証と生成で確認する。このアプリのためにAPI keyやAPI課金設定を用意する必要はない。

1. `.env.local`に次を設定して`pnpm dev`を起動する。既存serverは再起動し、pageをreloadする。

   ```dotenv
   APP_ORIGIN=http://127.0.0.1:3000
   AI_PROVIDER=chatgpt
   CHATGPT_MODEL=gpt-6.1-sol
   ```

2. 「設定とバックアップ」を開く。作品にOpenAIの明示model preferenceが残っている場合は「自動（サーバー既定）」を保存する。
3. 「Continue with ChatGPT」を押し、別windowでアカウントとworkspaceを選び、このアプリのChatGPT利用枠の使用を許可する。popupが開かない場合は表示される認証リンクを使う。接続が完了するとエディタ側に接続済み表示と初回だけの利用枠案内が表示される。
4. 送信対象を確認し、外部送信への同意を保存する。認証だけでは本文送信を始めない。既存のAPI key方式OpenAIへの同意も流用しない。
5. 短い選択範囲からCmd/Ctrl + Kで生成する。候補表示前に本文が変わらないこと、Diff、明示採用、Undo/Redo、保存・reloadを確認する。
6. 生成待機中の本文編集、候補表示中の接続解除・再認証で旧sessionが期限切れになり、古い候補を採用できないことを確認する。
7. 利用枠不足・認証失効時に、本文の編集と保存を維持し、別providerやAPI課金へ自動切替しないことを確認する。利用枠は他のアプリと共有される。ChatGPTの設定のUsageで使用量と上限を管理する。

`gpt-6.1-sol`は[公式の推論例](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)に基づく設定例であり、全アカウントでの利用可否・文章品質を保証しない。生成前にアカウントのmodel catalogを確認し、設定modelが利用できなければ失敗する。model変更は`CHATGPT_MODEL`の変更・server再起動・page reloadで適用する。今回は単一ChatGPTアカウントの接続・再認証・解除に対応し、複数アカウントの切替UIや他社サブスクは実装しない。

サブスクAPIは`stream: true`が必須で`max_output_tokens`が未対応のため、server内だけSSEを受ける。完了と全候補の検証後にだけ通常JSONをbrowserへ返し、途中の文字列を候補として表示しない。server 180秒 / client 185秒、実測SSE 1MiB、候補JSON128KiBと既存文字数上限で停止する。API側の固定出力token数や使用量の回収は保証しない。[公式preview制限](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)を参照する。

credentialはserver側の`~/.local/share/novel-ai-editor/chatgpt/connection.json`に保存する。本文のIndexedDBやJSONバックアップに含めず、ブラウザーデータ削除や作品削除とも別に管理する。「ChatGPTの接続を解除」でlocal tokenを削除し、遠隔失効を要求する。遠隔失効が未確認の場合はUIに表示する。host IDと登録情報は再認証用に保持する。ChatGPT側でアプリの許可も解除したい場合はChatGPTの接続設定から管理する。

保存はUnixのowner権限を使用する。現在の検証対象はLinux / WSL。native Windows serverのcredential ACL対応は未実装なのでWindowsではWSLでserverを動かす。macOSでの実機確認は未実施。残った`connection.lock`は自動削除しないため、crash後に残った場合はserverがすべて停止していることを確認したうえで、そのlockだけを手動で取り除く。

自動テストはOAuth・SSE・UIをmockで確認し、実アカウントや実利用枠を使わない。実際の認証と生成の手動確認は未実施。検証時は実施日・model・結果を本文やtokenを含めず記録する。

### Ollamaの設定と手動smoke test

ローカルLLMを選ぶ場合はOllamaを使用できる。接続は[OllamaのOpenAI互換API](https://docs.ollama.com/api/openai-compatibility)を使う。LM Studioへ切り替える場合も同じadapterを使う。

1. Ollamaを起動し、JSON Schemaに対応したローカルmodelを用意する。`ollama list`で正確なmodel IDを確認する。完全なローカル推論に限定するときは、Ollamaサーバー側で`OLLAMA_NO_CLOUD=1`を設定して再起動する（アプリの`.env.local`へ置くだけではOllamaに適用されない）。[Ollamaのローカル専用設定](https://docs.ollama.com/faq#how-do-i-disable-ollama-cloud-features)を参照する。
2. アプリの`.env.local`に次を設定する。`LOCAL_LLM_MODEL`は`ollama list`にあるローカルmodelの正確な名前へ置き換える。

   ```dotenv
   APP_ORIGIN=http://127.0.0.1:3000
   AI_PROVIDER=local
   LOCAL_LLM_BASE_URL=http://127.0.0.1:11434/v1
   LOCAL_LLM_MODEL=your-local-model:tag
   LOCAL_LLM_API_KEY=
   ```

3. `pnpm dev`で起動する。既に起動中ならserverを再起動し、pageをreloadする。画面のAI実行環境にローカルLLMと指定modelが表示されることを確認する。作品にOpenAIの明示model設定が残っている場合は「設定とバックアップ」で「自動（サーバー既定）」を保存する。
4. 原稿の短い範囲を選択してCmd/Ctrl + Kを開く。外部送信の同意なしで生成できること、候補表示までは本文が変わらないことを確認する。
5. 候補とDiffを確認し、採用で選択範囲だけが変わること、Undo/Redo、自動保存、reload後の復元を確認する。生成待機中に本文を編集し、古い候補が採用できないことも確認する。
6. Ollamaを停止して生成を試し、本文の入力と保存が続けられ、クラウドへの自動切替がないことを確認する。

入力見積もりの上限は24,000 token、出力上限は2候補8,192 / 3候補12,288 token。実際のmodelとOllamaのcontext設定に収まる必要がある。context不足や不正JSONをアプリが自動修復することはない。OllamaのOpenAI互換APIではrequestからcontext sizeを指定できないため、必要なら[Modelfileの`PARAMETER num_ctx`](https://docs.ollama.com/api/openai-compatibility#setting-the-local-context-size)で設定したmodelを作り、そのIDを使う。アプリは個別modelの能力・文章品質を保証しない。

LM Studioを使う場合はDeveloper画面でローカルmodelをloadし、serverを起動する。`LOCAL_LLM_BASE_URL=http://127.0.0.1:1234/v1`と正確なmodel IDへ変更する。[LM StudioのStructured Output](https://lmstudio.ai/docs/developer/openai-compat/structured-output)に対応するmodelが必要。認証を有効にした場合だけ`LOCAL_LLM_API_KEY`を設定する。

接続先はloopbackの`/v1`のみ受け付け、redirectを追わない。LAN / 公開URL、credentials付きURL、query、fragmentを拒否する。ブラウザーは同一originのAI routeだけを呼び、接続URLと認証tokenはserver内に留める。WSLやcontainerでは、アプリserverから同じloopback経由で推論serverへ到達できる配置が必要。

アプリが直接送る先はこのPCだが、推論サーバー自身の転送・ログ・保存設定はそのサーバーで管理する。手動確認の日付、engine / model / context設定、結果を本文・認証情報を含めず記録する。自動テストはHTTP fixtureを使用しており、実Ollama / LM Studioモデルの疎通と文章品質は未検証。

### OpenAI手動smoke test

この確認は実アカウントへのAPI requestと費用が発生し得るため、明示的に実施するときだけ行う。CIでは実行せず、APIキーをshell history、browser storage、スクリーンショット、issue、ログへ残さない。

1. providerアカウント側の利用上限を設定する。
2. `.env.example`を参考に、local-onlyの環境へ`APP_ORIGIN=http://127.0.0.1:3000`、`AI_PROVIDER=openai`、`AI_ENABLE_PAID_API=true`、対応済みの`OPENAI_MODEL`、実APIキーを設定する。画面の設定でAPI接続を有効にする。`.env*`の実値をcommitしない。
3. `pnpm dev`でloopback serverを起動し、画面上部と「設定とバックアップ」でproviderがOpenAI、自動の既定modelが`OPENAI_MODEL`、外部送信あり、未同意と表示されることを確認する。allowlistから明示modelを選んだ場合は保存後の表示も確認する。
4. 原稿の一部を選択してCmd/Ctrl+Kを押し、同意前は「生成」が無効で、Network panelに`POST /api/ai/edits`がないことを確認する。
5. 折りたたみ表示で、選択範囲、最大1,000文字ずつの前後文脈、編集指示、空でない共通プロンプト、空でない手動文体設定が送信対象と説明されることを確認する。
6. checkboxを明示的に選び「同意を保存」を実行する。開いていたAI編集が期限切れになった後、選択し直して新しいセッションを開く。
7. 生成を1回だけ実行し、Network panelの同一origin request bodyが上記のbounded field、`modelId`（自動なら`null`）、`{providerId:"openai",policyVersion:1}`だけを持ち、全文書、PM位置、APIキー、`grantedAt`を含まないことを確認する。providerへのserver-side requestは解決済みmodelを使うResponses API、`store:false`、非streaming、自動retryなしである。
8. 候補をPreviewして、Accept前に本文が変わらないこと、明示Acceptだけが選択範囲を変更すること、Undo/Redoと自動保存が通常経路で動くことを確認する。
9. 設定から同意を撤回し、その後の新規生成が送信前に止まることを確認する。送信済みデータをアプリ側だけで回収できるとは扱わない。

終了後はserverを停止し、手動test用secretを安全に破棄またはrotationする。検証日、model、結果、未確認事項だけを本文を含まない形で記録する。

## 基本の執筆操作

- 「章とアウトライン」で章の追加・切替・並べ替え・改名・削除と手入力アウトラインを保存する。最後の1章は削除不可。章の設定draftも保存／Cmd・Ctrl+Sと離脱警告の対象。
- 「保存履歴・復元」で名前付きcheckpointを作り、全章・メモ・設定の差分を確認して復元する。直近50件。復元前の状態も履歴に残る。自動保存前の記録は作品ごとに明示ON（初期OFF）。履歴の削除もここで行う。
- 「全作品を一括バックアップ」で全作品・全章・メモ・履歴・ごみ箱のJSONを保存する（100MiBまで）。一括復元はコピーとして追加し、既存作品を上書きしない。「JSONで保存」は現在の1作品の全章・設定・メモ。
- 「検索・置換」または本文内のCmd・Ctrl+F / Hで現在の章を検索する。1件／全件置換は確認後に実行し、1回のUndoで戻せる。検索後に本文を編集した場合は再検索する。
- 起動中の作品／章切替ではUndoとカーソル位置を保持する。reload後はタブの開閉と保存本文のrevisionに一致するカーソルを復元し、過去の本文は保存履歴から戻せる。
- 本文の上に現在章と作品全体の文字数を表示する。目標文字数は作品ごとに設定できる。改行は数えず、空白とUnicodeコードポイントを数える。

schema 1〜5の保存データをschema 6へ移行する。DBはversion 5。旧アプリへ戻す場合は更新前のバックアップを使う。自動テストは実LLMやOSの日本語IMEの確認を代替しない。

## 未保存設定・ごみ箱・AI接続（Task 16.1）

作品名・共通プロンプト・文体設定にも未保存表示と離脱確認を提供する。新規作品・作品切替・単体バックアップ取込・削除では破棄確認ができ、取消で入力とAI候補を保持する。通常の保存／Cmd・Ctrl+Sで保存でき、失敗時は入力を保持する。

作品と章の削除はごみ箱へ移す。保存履歴を作っていなくても「ごみ箱・削除の復元」から戻せる。作品は保存済み一覧へ復元し、同じIDの作品が既にある場合はコピーを追加する。章は元の作品を開いて復元する。現在の本文を上書きせず、章のIDは新規発行する。最大200件、期限による自動消去は行わず、満杯なら削除を中止する。「完全削除」は確認後のみ。一括バックアップversion 2にはごみ箱も含まれ、旧version 1も取り込める。単体JSONはごみ箱を含まない。

「AI接続の設定・診断」で主AI、比較候補（0個または2個以上。実際の同時送信は2〜3個）、各モデルIDとローカルURLを設定する。保存はこのPCのアプリ全体に適用され、作品ファイルには含めない。APIはサーバーの`AI_ENABLE_PAID_API=true`と画面の許可が必要で、画面は初期OFF・接続保存後／reload後もOFF。自動切替は行わない。

通常保存では本文・作品設定・メモを先に保存する。AI接続設定だけが保存に失敗した場合は、原稿の保存完了と接続draftの未保存を区別して通知し、本文の編集・保存を維持する。

設定の保存先はserver側の`~/.local/share/novel-ai-editor/ai-settings.json`（Unix owner権限600）。`NOVEL_AI_SETTINGS_PATH`でrepository外の絶対パスへ変更できる。保存済み設定が環境変数の接続・モデル設定を上書きする。「AI接続を環境設定に戻す」で解除できる。APIキー・ChatGPT token・Claude認証ディレクトリ・CLI実行パスはこの画面では扱わず、従来どおりサーバーで管理する。破損／将来versionの設定ではAIを停止し、本文編集と保存は継続する。crashで`.lock`が残った場合はserverをすべて停止してからそのlockだけを手動で取り除く。

診断は保存済み設定への明示操作で、本文・メモ・プロンプトを送らない。HTTP接続はモデル一覧だけを確認し、ClaudeサブスクはCLIの認証状態だけを確認する。生成・文章品質・利用枠残量の確認ではない。設定モデルが最初の一覧ページに見つからない場合も、生成不可とは断定しない。接続の保存や別タブでの変更時は旧候補を無効化する。

## データとプライバシー

本文はブラウザーのIndexedDBに保存する。

ローカルLLM使用時は、選択範囲と組み立てた文脈をこのPCの推論サーバーへ送信する。ChatGPTサブスクやOpenAI APIを明示的に選んだ場合は同じ範囲を外部providerへ送信する。

外部providerへの初回送信前にprovider単位の同意を得る。ローカル推論サーバーの外部転送・保持設定は、そのサーバーで管理する。

候補とAI編集セッションはV0.1ではメモリのみ。再読み込みで消える。本文のUndo履歴も再読み込み後には復元しない。

ブラウザーデータの削除やストレージ回収に備え、JSONバックアップを利用する。

## 開発・公開準備

現在の作業は `docs/IMPLEMENTATION_PLAN.md` と [公開前TODO](docs/PUBLISHING.md) に従う。旧Phase 0の依頼文と検証記録は `docs/archive/` に保管し、公開書き出しには含めない。

スマホのAI画面上部の「本文へ」で指示・候補を保持して本文に戻り、「AI画面に戻る」で再表示できます。生成中も利用でき、本文や選択を変えた場合は保持中の候補を期限切れにします。閉じる操作はそのAIセッションを破棄します。

「診断」から章の日本語表現とリズムをローカル解析できます。指摘は誤りの断定ではなく確認候補です。無視・再解析・個別修正・AI推敲の準備ができ、修正はDiffを確認して「修正を採用」するまで本文を変えません。AI Feedbackは章/選択範囲（6,000文字まで）を確認して明示生成する読み取り専用コメントです。実LLM品質は未検証です。

製品名と互換性の方針は[名称について](docs/BRANDING.md)を参照してください。
