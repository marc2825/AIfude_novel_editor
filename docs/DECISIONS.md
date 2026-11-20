# 設計の決定記録

採用した設計と、その理由を記録する。初期の決定は後続の決定で拡張されているため、同じ機能については後の記録も確認する。

| 初期の決定 | 後続で認めた拡張 |
|---|---|
| D-002：本文スキーマ | D-041：ルビ・傍点 |
| D-003：選択範囲の編集 | D-026・D-036・D-037：指示による挿入と補完 |
| D-010：ストリーミング禁止 | D-025：ChatGPT接続のサーバー内受信のみ |
| D-029：作品切替 | D-030：章ごとのUndo・カーソル保持 |
| 初期の部分採用・PWA対象外 | D-040・D-042：部分採用と静的PWA |

## 運用

Acceptedの判断をcoding agentが独断で覆してはならない。変更時は新しいDecisionを追加し、旧DecisionをSupersededへ変更する。記録項目：

- ID
- Status
- 背景
- 決定
- 影響
- 見直す条件

依存の正確なバージョンは `package.json` とlockfileを参照する。各検査結果には実施日と対象を記録する。

## D-001：TipTap / ProseMirror

Status：Accepted

背景：選択編集、Undo、将来の注釈や構造化編集を扱いたい。

決定：TipTapをReact統合層、ProseMirrorを状態とトランザクションの正本として使う。

CodeMirrorもプレーンテキスト編集には適するが、本案では文書編集の拡張余地とトランザクションモデルを優先する。

影響：PM位置と段落Sliceの扱いに専門的なテストが必要。

見直す条件：基準文書で入力性能または必要な日本語編集が成立しない場合。

## D-002：最小スキーマ

Status：Accepted

背景：リッチテキストは局所置換と保存の複雑さを増やす。

決定：V0.1はparagraphとtextのみ。StarterKit全体を導入しない。

影響：装飾はできないが、選択範囲外不変条件を明確に検証できる。

見直す条件：明確なユーザー要求とスキーマ migration計画がある場合。

## D-003：Selection-based editing

Status：Accepted

背景：AIが執筆の主導権を取らないことが目的。

決定：ユーザーの明示選択だけを編集対象とする。

影響：自動全文改善や続きを書く機能は作らない。

見直す条件：別プロダクトモードとして明示的に承認された場合。

## D-004：Preview before mutation

Status：Accepted

背景：AIは意味変更や誤りを含み得る。

決定：すべての候補をdocument外でPreviewし、Accept時だけ変更する。

影響：自動適用より1操作多いが、著者の判断を維持できる。

見直す条件：V0.1では変更不可。別仕様として安全性を再評価する場合のみ。

## D-005：Strict stale detection

Status：Accepted

背景：非同期応答の位置を自動追従させると、文脈の変化を見落とす。

決定：文書、選択範囲、インスタンス、参照設定が変われば候補を無効化する。

影響：選択外の軽微な編集でも再生成が必要。

見直す条件：range mappingだけでなく文脈整合性を検証できる設計とテストが用意された場合。

## D-006：Provider abstraction

Status：Accepted

背景：UIとエディタが特定SDKへ依存すると変更が危険になる。

決定：サーバー側の小さなプロバイダー portを設ける。

影響：mockを同じ境界で使える。多プロバイダー用フレームワークは作らない。

見直す条件：portが実際の2つ目のプロバイダーに適合しない場合に最小変更する。

## D-007：Local-first persistence

Status：Accepted

背景：MVPで認証とクラウドDBは中心UXの検証に不要。

決定：IndexedDBに単一workspaceを保存する。

影響：デバイス間同期はない。バックアップと削除手段が必要。

見直す条件：同期の要件、認証、競合解決、migration計画が承認された場合。

## D-008：Single writer

Status：Accepted

背景：別タブの上書きは共同編集ではなくデータ損失になる。

決定：Web Locksとstorage バージョンで単一writerを強制する。

影響：2つ目のタブは読み取り専用。

見直す条件：共同編集仕様を別途設計する場合。

## D-009：Undo isolation

Status：Accepted

背景：1回のdispatchでも、history groupingにより隣接入力と結合する場合がある。

決定：AIの前後にhistory境界を作る。

影響：本文変更transactionとmetadata-only境界transactionを区別する。

見直す条件：採用版のhistory実装でテストが失敗した場合。独自Undo stackへの置換は自動的に許可されない。

## D-010：No ストリーミング / no automatic 再試行

Status：Accepted

背景：部分JSON、費用、競合、キャンセル処理を増やしたくない。

決定：候補は完全な返答の検証後だけ表示し、自動再試行はしない。D-025の承認により、ChatGPTサブスクのサーバー内SSE受信だけを許可する。

影響：応答完了まで本文候補は表示されない。

見直す条件：計測で待機UXの問題が確認され、安全性を維持する追加設計が承認された場合。

## D-011：Local-only deployment

Status：Accepted

背景：認証なしのLLM proxyを公開すると不正利用と費用リスクがある。

決定：V0.1はループバック bindと同一originに限定する。

影響：そのまま公開SaaSへdeployできない。

見直す条件：認証、認可、利用枠、分散rate limit、運用監視を設計した場合。

## D-012：Conservative intent

Status：Accepted

背景：自由指示の解釈で物語上の事実変更を許可すると、本来の目的を逸脱する。

決定：V0.1は保守的なルールベース推定。Preserveは解除できない。

影響：大幅な筋書き変更は手動編集で行う。

見直す条件：変更可能な意味範囲をユーザーが明示的に指定できる仕様が承認された場合。

## D-013：Future models are documentation only

Status：Accepted

背景：将来のStory Stateや学習を先に実装するとMVPが肥大化する。

決定：将来モデルは文書にのみ定義し、空のコードやstoreを作らない。

影響：V0.2以降でスキーマ migrationを実装する。

見直す条件：対応バージョンのTaskが承認された場合。

## D-014：Explicit Skill references

Status：Accepted

背景：coding agentのSkill自動検出方式は実行環境に依存する。

決定：`AGENTS.md`に読み分け表を置き、`skills/`を明示参照する。

影響：自動Skill discoveryに依存せず運用できる。

見直す条件：使用するagent環境を固定し、自動検出が必要になった場合。

## D-015：Phase 0 toolchain versions

Status：Accepted

背景：Node.js 24、pnpm 10、Next.js 16、React 19という目標majorに対し、再現可能なbootstrapと検査環境が必要。

決定：Phase 0 / Task 0.1ではNode.js 24.21.0、pnpm 10.34.5、Next.jsと`eslint-config-next` 16.3.5、ReactとReact DOM 19.3.0、TypeScript 6.0.3、ESLint 9.39.5、Vitest 5.0.1、Vite 8.3.0を固定する。Next.js 16.3.5のNode.js要件は20.9.0以上、React peerは18.2.0または19系。Vitest 5.0.1はNode.js 24をサポートし、`eslint-config-next`が利用するTypeScript ESLintの対応範囲`>=4.8.4 <6.1.0`にTypeScript 6.0.3が収まる。`eslint-config-next`配下のpluginがESLint 9までをpeer範囲とするため、その範囲内の安定版を選定した。これらは公開package メタデータ、install時のpeer解決、実際のtypecheck・lint・test・buildで確認した。

影響：開発と検査には`.node-version`および`packageManager`に記載した正確なruntimeを使用する。2026-09-18時点でESLint 9.39.5はnpm上でsupport終了のdeprecation warningを出すが、ESLint 10では`eslint-config-next`配下のpluginにpeer不整合が生じるため、宣言された互換範囲を優先した。依存更新は別Taskとして互換性を再確認する。

見直す条件：固定版にsecurity issueまたは検査不能な互換性問題が確認された場合。

## D-016：Phase 0 E2E and CI foundation

Status：Accepted

背景：Task 0.1の最小画面を実ブラウザーで確認し、固定runtimeで同じ検査をCIから再現する必要がある。

決定：Playwright 1.63.0とChromium 1種だけを使用し、worker 1でbootstrap画面の公開表示を検証する。Playwrightがループバック上のNext.js dev サーバーを起動する。GitHub Actionsは`actions/checkout@v7.0.1`と`actions/setup-node@v7.0.0`を使用し、`.node-version`のNode.js 24.21.0とCorepackで固定したpnpm 10.34.5により、frozen install、`check`、build、Chromium bootstrap E2Eを順に実行する。CIへ実APIキーを設定しない。

影響：CIは単一jobで基本検査を重複実行せず、ブラウザー matrix、visual regression、deploy、リリース処理を持たない。Playwright ブラウザーとLinux system dependencyはCI実行時に明示導入する。

見直す条件：対応ブラウザー要件が増えるか、CI時間またはflakinessの計測により分割・キャッシュ・再試行が必要になった場合。

## D-017：Phase 1 minimal エディタ dependencies

Status：Accepted

背景：paragraphとtextだけのエディタを、Phase 0で固定したReact 19上へ再現可能に導入する必要がある。StarterKitはTask 1.1のスキーマを越えるnode、mark、history、キーボード behaviorを含む。

決定：`@tiptap/core`、`@tiptap/react`、`@tiptap/pm`、`@tiptap/extension-document`、`@tiptap/extension-paragraph`、`@tiptap/extension-text`をすべて3.31.3へ固定する。StarterKitとhistory extensionは導入しない。`@tiptap/react` 3.31.3のReact / React DOM peer範囲は17、18、19系であり、core、React統合、各node extensionが要求するTipTap peerは同じ3.31.3であることを公開package メタデータで確認した。

影響：スキーマはdoc、paragraph、textだけで構成でき、Task 1.2のhistoryとキーボード behaviorを先行実装しない。TipTapパッケージの更新時は一式を同じバージョンへ揃え、peer解決とエディタ検査を再実行する。

見直す条件：固定版にsecurity issueまたはReact / Next.jsとの互換性問題が確認された場合。

## D-018：Phase 2 persistence スキーマ and repository

Status：Accepted

背景：V0.1の単一workspaceを、破損データや古い書き込みで本文を失わない形でIndexedDBへ保存する境界が必要。保存値はブラウザー内の値であっても未信頼入力であり、取り込み由来のstorage バージョンを現在の競合判定へ流用してはならない。

決定：Zod 4.6.5で、Project、WritingDocument、Chapter、manual StyleProfileを含むstrictな`WorkspaceSnapshot` バージョン 1を検証する。本文はdoc / paragraph / textだけの正規PM JSONとし、選択範囲、history、plugin stateは含めない。idb 8.0.3を使う単一`workspaces` object storeのrepositoryは`load`、`save`、`replace`、`delete`だけを公開する。`save`はsnapshotのstorage バージョンを期待値として同一readwrite トランザクション内で比較し、既存record更新時にバージョンを1増やす。`replace`は現在recordのIDとバージョンを別の参照値で照合し、取り込み値のstorage バージョンを無視して0または現在値+1を割り当てる。`delete`も期待バージョンを照合する。テストはfake-indexeddb 6.2.5で実データから隔離する。3 packageは正確なバージョンで固定し、Zodとidbには追加のengine / peer dependency宣言がなく、fake-indexeddbのNode.js要件`>=18`を固定Node.js 24.21.0が満たすことを公開package メタデータと検査で確認した。

影響：不明スキーマバージョン、破損record、参照ID不整合、storage バージョン競合は安全側に停止となり、自動初期化や上書きを行わない。PM documentは編集時の唯一の本文正本のままで、repositoryはsnapshot境界に留まる。hydration、自動保存queue、保存状態UI、Web LocksはTask 2.2まで実装しない。

見直す条件：WorkspaceSnapshot バージョン 2の仕様とmigration、または複数workspaceの要件が承認された場合。

## D-019：Phase 2 local バックアップ and restore boundary

Status：Accepted

背景：現在の未保存本文を欠落させず、将来のmigrationやブラウザーデータ消失に備えて、V0.1の単一workspaceを人が保持できる形式で書き出し・復元する必要がある。並行autosave、取り込み由来のstorage バージョン、外部送信同意、Undo履歴をそのまま復元すると、競合判定やprivacy境界を壊す。

決定：JSONバックアップは追加envelopeを作らず、export時のPM documentと現在設定から構築して検証したcanonical `WorkspaceSnapshot` バージョン 1をUTF-8 JSONとして出力する。本文テキストは正規プレーンテキストをUTF-8で出力する。ファイル名は作品名を安全化した`<作品名>-backup.json`と`<作品名>.txt`とする。JSON 取り込みは10MiB以下だけを一度読み、全体を同じスキーマで検証してから明示確認を行う。旧save coordinatorを停止して開始済み保存を待った後、repositoryの`replace`で原子的に置換する。取り込みされた`storageVersion`は無視し、AI同意はnullへ初期化し、エディタ インスタンスとUndo履歴を新しくする。作品名、共通プロンプト、手動文体設定は既存snapshotへ保存し、共通プロンプトまたは手動文体の変更時だけcontext リビジョンを増やす。ローカル削除もロック所有者による確認後のrepository `delete`に限定する。

影響：JSONバックアップは保存スキーマと同じバージョン互換性を持ち、選択範囲、history、plugin state、Web Lock、保存queueを含まない。importと削除はread-only タブから実行できず、失敗時は現在のPM documentと保存recordを維持する。別形式への移行には明示的なバックアップ migrationが必要になる。

見直す条件：WorkspaceSnapshot バージョン 2、複数workspace、暗号化・圧縮バックアップ、またはcloud保存の要件とmigration方針が承認された場合。

## D-020：Phase 3 replacement property testing

Status：Accepted

背景：厳密な範囲置換について、段落境界、空段落、Unicodeを組み合わせた入力でも正規テキスト不変条件とUndo / Redoを実ProseMirror stateで検証する必要がある。`docs/TESTING.md`はproperty-based testにfast-checkを指定している。

決定：テスト専用依存としてfast-check 4.10.1を正確に固定し、ランダムなcanonical plain text、有効選択範囲、replacementに対して、prefix＋replacement＋suffix、スキーマ適合、Undo、Redoを検証する。fast-check 4.10.1のNode.js要件は12.17.0以上で、固定Node.js 24.21.0が満たし、peer dependencyがないことを公開package メタデータで確認した。

影響：失敗時はfast-checkが再現用seedとpathを報告する。製品bundleと実行時の置換処理には新しい依存を追加しない。

見直す条件：同等のproperty-based test基盤が既存toolchainへ統合されるか、固定版にsecurityまたは互換性問題が確認された場合。

## D-021：Phase 7 grapheme Diff implementation

Status：Accepted

背景：日本語、emoji、結合文字、空白、改行を壊さず、active候補の表示専用Diffを150msで打ち切れる形で実装する必要がある。独自の編集距離matrixは候補上限までのメモリ増加と保守対象を増やし、文字列単位の既定diffはuser-perceived characterを分割する。

決定：`Intl.Segmenter`の`grapheme`単位で原文と候補を配列化し、`diff` 9.0.0の`diffArrays`へ渡す。計算はactive候補についてWeb Worker内だけで実行し、main thread側が150msでworkerを終了する。応答はリクエストIDと候補IDで照合し、期限超過、worker failure、不正応答では原文と候補の並列表現へ代替への切替する。Diff結果は候補Previewの表示専用型に留め、Acceptは従来どおりvalidated `candidate.replacementText`を直接安全な置換境界へ渡す。`diff` 9.0.0は組込TypeScript型とブラウザー bundleを提供し、peer dependencyはなく、宣言Node.js要件を固定Node.js 24.21.0が満たすことを公開package メタデータ、typecheck、build、実ブラウザー検査で確認する。

影響：最短編集列は固定版jsdiffのMyers系algorithmと、同到達位置では削除側を選ぶ探索順により決定的になる。入力文字列はtrim、Unicode正規化、改行変換を受けない。計算量は編集距離をD、grapheme総数をNとして概ねO(ND)で、候補契約の上限、worker隔離、150ms終了により本文入力をブロックしない。依存のunpacked sizeはnpm メタデータ上615,597 bytesだが、利用する`diffArrays`はWorker bundleへ分離される。

見直す条件：固定版にsecurityまたはブラウザー互換性問題が確認されるか、基準端末の測定で通常候補が継続的にタイムアウトする場合。

## D-022：Phase 8 OpenAI Responses adapter

Status：Accepted

背景：既存のprovider-neutralなprompt、候補契約、同意、制限時間、検証境界を変えず、最初の外部プロバイダーを接続する必要がある。Chat Completionsやプロバイダー側conversation stateを使うと、現在の単発局所編集に不要な分岐と保持を増やす。OpenAI JavaScript / TypeScript SDKは既定で自動再試行を行う。

決定：OpenAI SDK 7.20.0を正確に固定し、server-onlyの`EditingProvider` adapterからResponses APIを非ストリーミングで1回呼ぶ。Phase 4の`systemInstruction`を`instructions`、`inputDataJson`を`input`へ写像し、frozen 候補 JSON Schemaを変換せず`text.format`の`json_schema`、`strict: true`として渡す。`store: false`を明示し、tools、conversation、`previous_response_id`、background、sampling・reasoning調整は指定しない。既存output トークン budgetとserviceのAbortSignalを渡し、SDK クライアントは`maxRetries: 0`、`logLevel: off`で最初のプロバイダー invocationまで遅延生成する。サーバー configの対応モデル 許可リストは、2026-09-20時点でResponses API、Structured Outputs、64,000以上のcontext ウィンドウ、12,288以上のmax outputを確認した`gpt-6-astra`、`gpt-5.6-sol`、`gpt-5.6-terra`、`gpt-5.6-luna`とする。adapterは検証済みモデルをconfigから受け取り、モデル固有分岐を持たない。

影響：OpenAIはexternal data transferとなり、プロバイダーID `openai`の明示同意がserviceで確認されるまでSDK リクエストは発生しない。refusalとincompleteは既存taxonomyへ正規化し、completed出力もcanonical runtime / business validationを必ず通る。`store: false`はプロバイダーへ応答 stateを保存しないよう要求するが、プロバイダー契約やabuse monitoring等を含む全保持の不存在は保証しない。通常テストはfake SDKだけを使用し、実アカウント、課金、networkを必要としない。user-facing同意はTask 8.2、canonical 対応機能 定義一覧とモデル選択UIはTask 8.3で扱う。

見直す条件：Responses APIまたはSDKの互換性・保持仕様が変わる、許可リストモデルが廃止される、またはTask 8.3でprovider/model 定義一覧を導入する場合。

## D-023：Canonical provider/model 定義一覧とworkspace モデル preference

Status：Accepted

背景：複数の対応OpenAI モデルをユーザーが選べるようにしつつ、任意モデルIDのSDK到達、client/server 許可リストの乖離、サーバー既定値の喪失、モデル変更による古いAIセッションの再利用を防ぐ必要がある。モデルはEdit Intent、StyleProfile、task instructionとは別の実行設定であり、文学的品質の一律rankingは根拠を持たない。

決定：provider/model定義の正本を`src/domain/ai-models.ts`のcanonical 定義一覧とする。2026-09-21にOpenAI公式model documentationでResponses API、text入出力、Structured Outputs、1,050,000 トークン context、128,000 トークン最大出力を確認した`gpt-6-astra`、`gpt-5.6-sol`、`gpt-5.6-terra`、`gpt-5.6-luna`をOpenAIの選択可能モデルとする。workspaceのProjectへ`aiModelPreference`を保存し、`automatic`は`OPENAI_MODEL`で構成されたサーバーの既定モデルを使う意味に限定する。明示モデルIDはAPI リクエストへsemantic 選択範囲として渡すが、サーバーが定義一覧からプロバイダー対応とrequired 対応機能を再解決した場合だけ同一adapterへ渡す。明示モデルが利用不能なら代替への切替しない。モデル変更は`contextRevision`を増加させる。OpenAI内の変更ではプロバイダーID / consent policy バージョンが変わらないため同意を維持する。

影響：WorkspaceSnapshot current スキーマはバージョン 2となり、バージョン 1はモデル preferenceを`automatic`として読み込み・取り込み時に明示migrationする。IndexedDB database バージョンとstore構造は変えない。公開runtimeにはUIに必要なsafe 定義一覧 fieldと既定モデルIDだけを渡し、secret、account、SDK設定は含めない。サーバー success メタデータは選択値ではなく実際に解決・使用したcanonical モデルIDを返す。Automaticは動的振り分けではなく、自動再試行、別モデル 代替への切替、モデルごとのエディタ分岐も追加しない。

見直す条件：OpenAI公式対応機能やモデル lifecycleが変わる、別プロバイダーを追加する、workspace以外のモデル preference ownershipが必要になる、またはスキーマバージョン 3のmigrationを設計する場合。

## D-024：Ollama優先のローカル推論adapter

Status：Accepted（ユーザーのローカルLLM主用途化とOllama優先・LM Studio拡張の依頼に基づく）

背景：本文をローカル保存する既存構成に加え、推論もこのPCで行いたい。OllamaとLM StudioはOpenAI互換のChat Completionsを提供するが、既存OpenAI Responses adapterの接続先変更だけではStructured Outputの形式が一致しない。

決定：新規依存を追加せず、server-onlyの`local` adapterからループバック `/v1/chat/completions`へJSON Schema付きの非ストリーミング リクエストを1回送る。Ollamaを標準設定例とし、LM StudioはURLとモデル設定で切り替える。任意URLをクライアントから受け取らず、redirectを禁止する。個別native API adapterを2つ作る案は、今回必要な機能が共通APIで足りるため採用しない。SDKのbase URL差し替え案も既存OpenAI adapterの責務を増やすため採用しない。

移行：`local-default`は個別モデルではなくサーバー設定枠としてcanonical 定義一覧へ追加し、具体的なモデルは検証済み`LOCAL_LLM_MODEL`から解決する。候補メタデータは具体的なモデルIDを返す。`automatic`は選択プロバイダーのサーバーの既定モデルを使う意味に拡張する。workspace スキーマ バージョン 2を維持し、既存の明示OpenAI モデル設定は黙って書き換えず、ローカル使用時にユーザーがautomaticへ変更する。設定変更はサーバー再起動とページ 再読み込み後の新セッションから適用する。

影響：未設定時は引き続きdisabled、設定例はlocal。失敗時のクラウド代替への切替、自動再試行、追加LLM修復は行わない。ローカル推論のサーバー期限180秒 / クライアント期限185秒を設け、既存OpenAI / mockの30秒 / 35秒は維持する。ローカルの上限・個別モデル能力を自動保証せず、通常候補検証を通す。ループバック到達は推論サーバー自身のクラウド転送・保持を保証しないため、Ollamaのcloud無効化設定とlocal モデル使用を説明する。

検証：config / プロバイダー / serviceのunit・integration、中止を無視する遅延応答、コントローラーの35秒超待機、実adapterとループバック HTTP テスト用データを使う採用・Undo/Redo・保存E2Eで検証する。実LLMの疎通・文章品質・OSの日本語IMEは自動テストの成功と区別する。

見直す条件：native APIでしか得られない機能、runtime モデル一覧UI、任意LAN接続、個別モデル能力検証やworkspace単位のlocal モデル切替が明示要求された場合。

## D-025：公式ChatGPTサブスク接続

Status：Accepted（2026-10-14。複数プロバイダーの最初をChatGPTとし、サーバー内ストリーム受信と固定出力トークン上限を使わない方式をユーザーが承認。「自動切り替えはしない」と明示）

背景：ローカルで動く個人用アプリ向けのSign in with ChatGPTは、API keyなしで契約済み利用枠を使える。公式プレビューではSSEが必須で`max_output_tokens`が未対応のため、既存の非ストリーミング プロバイダーとは別のadapterが必要。

決定：`chatgpt` プロバイダーを追加する。OAuthのstate / nonce / PKCEとID トークンを検証し、署名検証にはjose 6.2.12を固定する。登録クライアント IDとhost IDを保持し、refresh トークンをファイルロック下で直列更新する。credentialはrepository外のowner-only local ファイル、本文は従来のIndexedDBへ分離する。callback専用の127.0.0.1 listenerを使い、認証codeをNextのリクエスト logへ出さない。cookieやCodex トークンは流用しない。

移行：workspace スキーマ バージョン 2を維持する。既存の明示OpenAI モデル preferenceは自動変更せず、サブスク利用時にautomaticを選ぶ。`chatgpt-default`は設定枠とし、`CHATGPT_MODEL`をアカウントcatalogで検証する。APIとサブスクはプロバイダーIDを分け、既存OpenAI同意をChatGPT同意へ流用しない。接続UUIDはAPIのoptional control fieldであり、プロンプトや本文保存には含めない。

影響：APIの固定出力トークン上限をサブスクでは保証できない。サーバー内のSSEを180秒・1MiB、候補JSONを128KiBと既存文字数制限で打ち切り、完了・全候補検証後にだけ返す。クライアントは185秒で停止する。解除・再認証は同期的にAIセッションをstale化し、サーバーも応答完了時の接続IDを確認する。利用枠・認証・モデル・接続失敗では従量課金APIを含む別プロバイダーへ切り替えず、自動再試行・追加LLM修復もしない。

検証：OAuth改ざん・範囲・トークン署名・認証情報保護・refresh直列化、SSEの途中失敗と中止を無視する遅延応答、解除時のstale、同意・採用・Undo/Redo・保存をmock / HTTP テスト用データ / ブラウザー interceptionで確認する。実アカウント認証・推論は未実施として区別する。通常CIで実トークンや実利用枠を使わない。

見直す条件：他社サブスク、複数ChatGPTアカウント、公開hosting、サブスク用モデル picker、OSの認証情報 store、プレビューの仕様変更が明示要求された場合。

Sources：[登録と認証](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)、[preview制限](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)、[アカウントとセッション](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)。

## D-026：プロンプトからの文章挿入

Status：Accepted（2026-10-16。ユーザーが「プロンプトを送って、帰ってきた文章を挿入する機能」を明示依頼）

決定：空のTextSelectionでCmd/Ctrl + Kを押した場合だけ、boundedな文章挿入モードを開く。本文の正本・リビジョン・snapshot・同期的Accept・単一Undoは維持し、ゼロ幅のfrom = toを既存の安全な適用境界へ追加する。挿入ではプロンプトだけをLLMへ送り、作品本文・設定・座標を暗黙に送らない。標準1案、最大3案、各3,000コードポイント。全文自動執筆、常設チャット、自動的な続き生成は追加しない。

代案：非空選択の置換に限定すると依頼を満たせない。エディタへの直接挿入は既存の明示Acceptとstale不変条件を失うため採用しない。移行：保存スキーマバージョン 2は維持、APIの省略時は従来の置換契約を保つ。検証：実ProseMirror、80例のproperty test、stale・遅延応答・Undo/Redo・保存再読み込みのブラウザーテスト。

## D-027：サブスクを基本にした複数AIの同時比較とAPI opt-in

Status：Accepted（2026-10-16。ユーザーが「複数AIへの同時自動送信が必須」「サブスク枠のみがベースで、設定でAPI接続も可能にする（デフォルトはOFF）」と明示回答）

決定：同一入力を明示選択・同意した2〜3providerへ並列送信し、プロバイダーごとの成功・失敗を保持する。候補のコピー＆ペーストを接続の代用にしない。採用する1件だけを既存の安全なAccept境界へ渡す。単独生成と比較はプロバイダーごとの同じrate limiterを使う。失敗を理由に対象追加・自動再試行・API 代替への切替を行わない。

接続：既存ChatGPT OAuthに加え、Claudeの公式CLIによるサブスクリプション認証を使う。非公開トークンやcookieを転用しない。CLIは空の一時cwd、環境許可リスト、tools / MCP / customization / 履歴 / 再試行 / 代替への切替なし、単一turnで実行する。本文はstdin、stdout / stderrはログへ出さず上限256KiB、実行期限180秒。API認証を拒否し、使用モデルの不一致も拒否する。

API：OpenAI、Claude Messages、Gemini、Grok、DeepSeekを別プロバイダーとして任意に構成する。サーバーの`AI_ENABLE_PAID_API=true`と画面設定ONの両方を必要とし、リクエストの`allowPaidApi`を検証する。画面設定は初期OFFで再読み込み後もOFFへ戻す。本文バックアップにAPI許可や認証情報を含めない。DeepSeek JSON objectを含め、出力は共通スキーマとbusiness ruleで検証し、修復呼び出しを行わない。

代案：第三者web画面の自動操作・cookie読取は安定した公式接続と本文保持制御を得られないため採用しない。Gemini公式CLIは会話履歴の保存を無効化する方法を確認できておらず、現在の本文ログ禁止を守るため今回サブスクadapterを追加しない。Gemini / Grok / DeepSeekのAPI接続をそれらのサブスク枠と表示しない。

移行：保存スキーマを維持し、既存の送信同意だけではAPIをONにしない。既存OpenAI利用者もサーバー opt-inと画面設定が必要になる。比較の設定不備は比較だけを無効にする。新規runtime依存は追加しない。CLIの導入・ログインはユーザーが行う。

検証：並列開始・部分失敗・入力/対象/同意拒否・API OFF・クライアント identity・中止無視の遅延応答・共有rate limitをunit / integrationで確認する。ブラウザーでは挿入・置換の同時比較、3providerの比較（偽Claude CLI）、採用・Undo/Redo・保存再読み込みを確認する。実認証・実モデル・native IMEは別途手動検証として記録する。

Sources：[Claude契約でのCLI / SDK利用](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan)、[CLI認証とフラグ](https://code.claude.com/docs/en/cli-reference)、[環境変数](https://code.claude.com/docs/en/env-vars)、[モデルfallback](https://code.claude.com/docs/en/model-config)、[Gemini公式API](https://ai.google.dev/gemini-api/docs/openai)、[Grok Structured Outputs](https://docs.x.ai/developers/model-capabilities/text/structured-outputs)、[DeepSeek JSON Output](https://api-docs.deepseek.com/guides/json_mode/)。

## D-028：手入力の作品メモリと生成ごとの任意参照

Status：Accepted（2026-10-16。ユーザーがメモリ機能を明示依頼し、「アプリ内に保存（設定・背景・登場人物のメモ欄＋バックアップ）」を選択）

決定：作品ごとに3つのboundedな手入力メモを保存する。各2,000コードポイント、不正Unicode・未知fieldを拒否する。WorkspaceSnapshotをバージョン 3にし、バージョン 1 / 2をそれぞれ検証して空のメモを補う。既存本文・モデル preference・リビジョンを保持し、IndexedDB database バージョンとstoreは変更しない。JSONバックアップにも含める。

AI参照は生成セッションごとに初期OFF。OFFではメモをHTTP / モデル入力から省略し、ONでは送信内容を表示した上で選択した各AIへ渡す。挿入の「プロンプトだけ」からの例外はこの明示ONに限定する。参照切替は旧候補を破棄し、保存変更はcontextRevisionとsnapshotの実値比較でstale化する。Accept・Undo・本文正本の境界を維持する。

メモを固定指示へ補間せずJSON dataとして扱い、選択原文の意味保持制約を上書きさせない。ONのメモを暗黙にtruncate / 省略せず、必須入力が予算を超える場合は生成を止める。クライアント / サーバーで同じ計算を使うため、既存の純粋なプロンプト plannerを共有feature モジュールへ移し、server-only再exportを残す。SDKやsecretを共有しない。

代案：filesystemのAGENTS.mdはユーザーが選んだアプリ内保存・バックアップ方式を満たさない。構造化人物CRUD、RAG、embeddings、自動要約・更新・学習は今回の依頼に不要なため追加しない。参照設定の永続化は前回のONを暗黙再利用するため採用しない。

影響：バージョン 3を旧版アプリでは読めない。旧版へ戻す場合は更新前バックアップを使用する。メモはIndexedDB / JSON内の平文で、各欄上限内でも合計入力予算に収まらない場合がある。実LLMによる設定遵守は自動保証しない。

検証：migrationと非破壊read、バックアップ復元、文字数・Unicode、OFFの完全省略、ONの全プロバイダー共通入力、予算超過で呼び出し0回、メモ変更時stale、中止無視の遅延応答、明示AcceptとUndo/Redo、保存失敗の同値再試行を各層で確認する。

## D-029：作品ごとのタブ・明示保存・未保存メモ保護・項目別参照

Status：Accepted（2026-10-16。ユーザーが追加実装を依頼し、「作品ごとのタブ（本文・設定・メモをまとめて切替）」を選択）

決定：D-007 / D-018の単一作品UI制限を今回の依頼に限り拡張する。既存active storeの保存・競合境界を維持し、IndexedDB バージョン 2に待機中作品のstoreだけを追加する。切替は現在作品の保存完了後に、active / archiveの原子的な交換として行う。保存や読み込みの失敗で現在のエディタを捨てない。タブを閉じてもデータを削除せず、一覧から開き直せる。

保存は本文と未保存メモを対象とし、Cmd/Ctrl + S、JSON download、JSON / UTF-8 .txtから新しい作品を開く操作を提供する。JSON openは新UUIDで複製し、既存作品の上書きとAI同意の復元を避ける。設定画面のバックアップ置換は既存の明示確認を維持し、別作品とIDが衝突すれば拒否する。

未保存メモは入力途中の値と成功した保存baselineを比較して検出する。再読み込み / 離脱はブラウザー標準確認、破棄につながるアプリ操作は明示確認を要求する。取消ではAIも無効化しない。メモ項目別参照は新しいwire スキーマを増やさず、未選択項目を空文字にして既存の全境界検証へ通す。ONで選択0件は生成を拒否する。初期OFFと明示Acceptを維持する。

代案：全作品を一括snapshotにすると既存のバックアップ / storageVersionを大きく変えるため採用しない。全タブのエディタを同時にmountする方式は本文と履歴の状態・保存競合を増やすため採用しない。今回は1つのエディタを明示再初期化し、切替でUndo履歴とAI候補をリセットする。章管理・履歴永続化・cloud同期は追加しない。

移行・制約：WorkspaceSnapshot スキーマは3のまま。database upgradeで既存recordを書き換えない。旧database バージョン 1のアプリには戻せず、更新前バックアップが必要。タブの開閉状態は再読み込みでリセットする。1つのJSONは1作品だけで、全作品一括バックアップではない。ブラウザーが離脱確認を表示しない状況や強制終了を完全保護とは表示しない。

検証：旧DBの非破壊upgrade、原子的切替、storage競合・不正target・バックアップ衝突、保存失敗で切替中止、切替直後の入力保存、未保存メモ取消、実beforeunload、項目別送信・予算削減、遅延AI応答破棄、タブ閉じる・再度開く・再読み込みを確認する。

## D-030：基本執筆機能と過去データの復元

Status：Accepted（2026-10-17、提案した6機能すべてを実装するユーザーの明示依頼）

決定：Task 15.1として章管理、保存履歴、全作品バックアップ、検索・置換、編集状態保持、文字数・目標を実装する。D-029の単一章／切替時Undo破棄／タブ開閉の一時保持を更新する。スキーマ 4とDB 3へ非破壊移行し、現在章をchapter、他章をadditionalChaptersへ保持する。1作品最大200章、アウトライン各2,000コードポイント。

履歴は手動保存記録と初期OFFの自動記録。学習と結び付けず、作品ごとの直近50件、削除、一括exportを提供する。復元前保存記録と本文・メモの復元を同じCAS トランザクションで保存する。自動履歴の容量失敗で本文saveを巻き戻さない。履歴の比較・復元は人の明示操作であり、AIのAccept境界は維持する。

全作品バックアップは単体バックアップと別のversioned envelope（100MiBまで）。復元はUUID対応表を使ったコピー追加で、過去の履歴も一貫したIDで保持する。既存作品を上書きせず、プロバイダー同意を初期化する。単体JSONは全章を含み、複数章のtext exportは章見出しを付けて順番に結合する。

EditorSessionsに実Editorを保持し、active EditorContentだけmountする。通常の作品／章切替でUndoと選択範囲を維持し、復元・単体取り込みはepochを変えて再初期化する。localStorageにはUI メタデータだけを保存し、再読み込みで一致するリビジョンのカーソルを復元する。Undo plugin stateは永続化せず、再読み込み後の過去復元は保存履歴で提供する。

検索はliteralの現在章に限定。人が確認した置換を同期検証し、単一トランザクションと履歴境界で1Undoにする。検索後の本文変更を検出して拒否する。文字数は改行を除くコードポイント、作品目標は0で無効。代案：PM historyのJSON永続化はplugin stateとバージョン互換性の契約を増やすため採用しない。全EditorのDOMをmountし続ける方式も不要。全文や章アウトラインをLLMへ自動送信しない。

検証：migration、参照破損、容量エラー・原子的ロールバック、CAS、履歴保持上限、未保存の入力、live Undo / カーソル、旧AI遅延応答の破棄を各層で確認し、ブラウザーで復元取消・検索置換・一括復元・再読み込みを確認する。実LLMとnative IMEは自動テストの対象外。

## D-031：未保存保護・復元できる削除・サーバー側AI接続設定

Status：Accepted（2026-10-17、ユーザーの「最優先〜高の実装」依頼）

決定：Task 16.1は作品設定未保存の入力保護、ごみ箱、接続設定／診断の3件に限定する。通常保存を未保存の入力の順次保存へ拡張し、破棄取消ではAI状態も保持する。作品スキーマは4のままDBを4へ上げ、trash storeを追加する。作品／章削除は退避と削除を同じCAS トランザクションで行い、履歴なしでも復元する。ごみ箱最大200件・自動失効なし、満杯は削除を拒否する。完全削除は明示操作のみ。一括バックアップをバージョン 2へ更新し、バージョン 1も非破壊migrationする。

AI接続の保存はcredentialと分離したserver-only ファイル。環境変数の接続・モデル・ループバック URLに上書きし、キー・CLI・auth ディレクトリ・API サーバー許可は変更しない。原子的保存とリビジョンを使い、推論前後のリビジョン照合・クライアント無効化・BroadcastChannelで旧候補を拒否する。接続保存後と再読み込みで画面API許可をOFFにする。設定破損時はAIを停止する。別プロバイダーへ自動切替しない。

診断はメタデータ／authだけ。本文やテストプロンプトを生成エンドポイントへ送らず、モデル一覧の最初のページまたはCLI auth statusを確認する。生成可否・品質・残量は保証しない。固定エンドポイント、10秒制限時間、256KiB制限、リクエストID／リビジョン照合を使う。主な参照は[ChatGPT models](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)、[OpenAI list models](https://developers.openai.com/api/reference/resources/models/methods/list)、[Gemini models](https://ai.google.dev/api/models)、[xAI models](https://docs.x.ai/developers/rest-api-reference/inference/models)、[DeepSeek models](https://api-docs.deepseek.com/api/list-models/)。

代案：ブラウザーへAPIキーを保存する方式、推論による自動疎通、モデルの自動選択、削除の自動期限切れは採用しない。作品のcloud同期や中優先度の追加機能は今回の範囲外。Unix ファイル権限、ブラウザーの離脱確認、実サービスの認証・利用資格の確認はそれぞれの制約として残る。

## D-032：端末連携の計画とPC起動ランチャー

Status：Accepted（2026-10-21、ユーザーが今後の対応の記録と容易な機能の実装を依頼）

決定：Task 17.1では既存Webアプリの起動だけを簡略化する。Node標準機能のTypeScript実行・プロセス管理を使い、新規依存を追加しない。OS用entrypointと`pnpm launch`でbuild、ループバック start、専用health確認、ブラウザー表示を順番に実行する。Windowsは既存のUnix 認証情報境界を維持するためWSL経由とする。

buildを毎回行い、source更新後の古いbuild起動を避ける。URLとAPP_ORIGINは127.0.0.1:3000に固定し、port自動変更でIndexedDBのoriginを変えない。起動ロックと公開UUIDのhealth応答で所有するサーバーだけを再利用し、別プロセスを停止しない。healthは推論・認証読み込み・作品参照をしない。UUIDは起動確認用で、認証として扱わない。

所有する子プロセスのgroupへ終了signalを送り、5秒で終了しなければ強制終了する。build5分、サーバー準備30秒、ブラウザー起動10秒、個別probe1秒の上限を設ける。ブラウザー起動失敗はサーバー停止にしない。残存／不正ロックは勝手に消さず、手動でサーバー停止を確認して復旧する。

代案：desktop shellや自動依存installは配布・更新・権限の範囲を広げるため今回は採用しない。LAN公開、HTTPS・認証、共通保存・競合制御、常時稼働基盤、アプリ配布はTask 17.2〜17.5として未実装の計画に記録する。本文の正本・保存スキーマ・AI送信経路は変更しない。

検証：core プロセスとローカルHTTP テスト用データで二重起動、port競合、失敗・取消・SIGTERM無視、ロック保護、準備待ちの遅延応答を確認する。実Next本番build・起動smokeとブラウザー編集保存を確認し、Windows／macOSのGUI実機確認と区別する。

## D-033：本文中心のワークスペースと選択からの推敲

Status：Accepted（2026-10-22、ユーザーの画面刷新・右クリック提案・日本語局所推敲の明示依頼）

決定：Task 18.1では既存エディタ・コントローラー・保存処理を保持し、表示構成を中央本文／上部操作／右パネルへ変える。WorkspaceLayoutのパネル選択はUI状態とし、非表示パネルもmountを維持して未保存の入力を守る。接続設定と履歴の読み込みはパネル表示時に行い、保存スキーマの移行は不要とする。

EditorSurfaceに右クリック／Shift+F10の一時menuを置く。メニューは現在のdocと選択範囲を保持し、変更時に閉じる。AI提案の選択時に既存captureSelectionを再使用し、編集座標や実行patchを新たに生成しない。IME・readonly・空選択ではnative操作を維持する。

候補カードと文字数差は表示専用で、本文へのプレビュー適用は行わない。日本語補助指示は既存custom intentへ渡す。複数AI送信の同意・上限・失敗分離・リクエストID・同期Accept・Undo境界を変えない。ポップオーバーはWorkspaceLayoutの表示領域を参照して操作バーと補助パネルを避けるが、コントローラーとエディタ adapterはレイアウトを知らない。

代案：常設AIチャットや別ページの設定画面は、本文と候補の比較から離れるため採用しない。パネルを条件付き破棄する方式は未保存入力を失うため採用しない。検証：右クリック・キーボード・IME合成イベント、パネル切替時の未保存の入力保持、局所採用とUndo、viewport、複数プロバイダー比較と遅延応答拒否をテストし、実ブラウザーで描画とアクセシビリティを確認する。native日本語IMEは別途実機確認が必要。

## D-034：選択範囲の5種類の編集ツール

Status：Accepted（2026-10-24、ユーザーによるTransform・Expand・Condense・Customと画面端の切替の明示依頼）

決定：Task 18.2は右端のradio選択を起動中だけのUI stateとして持ち、次に開く既存AIセッションの初期入力へ変換する。選択だけでは送信しない。モード変更時は既存controller.closeで中止・旧結果拒否を行う。エディタ adapter・Accept トランザクション・保存スキーマ・プロバイダーを変えない。

Transform・Expand・Customには既存preset enumへtransform・expand・freeformを追加し、サーバーで固定のallowedChangesとlengthTargetを決定する。Condenseは既存shortenを使う。自由指示での既定値customは保守的な既存仕様を維持する。新presetを明示した要求への応答だけが新intentを使うため、API バージョンは1を維持する。旧リクエスト・保存データのmigrationは不要。本文の既存Preserveと出力上限を解除しない。

代案：UIから追加指示文字列だけを送る方法は、Expandが既存similar制約、Transformが基本文体維持の指示と競合するため採用しない。ユーザーに任意の保持条件を渡させる方式も採用しない。検証：preset / プロンプト境界、全モードの実API routeを通るmock E2E、遅延応答拒否、範囲採用・Undo/Redo、stale、キーボード・a11yを確認する。実LLMの品質とOS日本語IMEは自動検査と区別する。

## D-035：本文を変更しない辞書モード

Status：Accepted（2026-10-24、ユーザーが単語の意味をLLMまたは検索で調べる辞書モードを明示依頼）

決定：辞書は右端の追加radioから開く読み取り専用ポップオーバーとする。既存のsnapshot・stale判定を利用するが、編集コントローラーのsubmit / acceptを使わず、独立した照会状態で結果を表示する。保存やエディタトランザクションは追加しない。

専用の語句リクエストとHTTP入口を設け、クライアント / サーバーの両方で1〜100文字とstrict スキーマを検証する。サーバーで固定辞書プロンプトを組み、既存のprompt-only service・プロバイダー・wire スキーマ・応答検証・利用制限を共有する。内部のreplacementTextは説明専用として扱い、本文適用経路へ渡さない。プロバイダーに辞書専用スキーマを新設して全adapterを変える方式は、このTaskには不要のため採用しない。

検索は固定Google URLへの明示リンクで、別タブに語句だけを送る。アプリ内で検索結果を収集する方式は、検索プロバイダー契約・キー・取得結果の検証が別途必要なため今回は採用しない。LLMの説明は検索結果・出典付き辞書として扱わず、語義の正確さを保証しない。検証：語句の境界、HTTP 検証、同意・API許可、プロバイダー失敗・不正出力、取消を無視する遅延応答、本文とUndo不変、選択変更・mode変更、外部検索の送信範囲・referrer抑止を確認する。

## D-036：明示した空白／章末尾への文脈付き補完

Status：Accepted（2026-10-24。ユーザーがInfillと指定文字数の続き執筆を明示依頼し、デフォルトにしないと指定）

決定：Task 18.4でinfill / continueを明示操作専用として追加する。従来の5編集モードは固定Preserveを維持し、今回の補完だけが既存文脈と整合する新規創作を行う。自動進行禁止は継続し、単発の候補生成・Diff・明示Acceptだけを提供する。目標文字数は1〜3,000、実際の文字数を併記する。選択した空白または空段落／章末尾カーソルを固定snapshotとして扱い、後から位置を探し直さない。

代案：自由指示への埋め込みだけではblank選択拒否や置換長上限と衝突し、前後文脈のある補完とprompt-only挿入の送信契約を区別できない。文字数一致の自動再試行は追加費用と無断呼出しを生むため採用しない。本文への自動採用・章の先頭からの全文生成も採用しない。

移行：保存スキーマ、wire候補スキーマ、プロバイダー adapterと依存は変更なし。operation省略時の従来編集とinsertは従来のまま。API スキーマバージョン 1へoptional operation値とtargetCharactersを追加する。検証：範囲外不変、空段落／改行／Unicode、stale、Undo/Redo、入力出力境界、遅延応答、比較送信、ブラウザー操作・保存再読み込み。実モデルの文字数遵守と整合性は未検証。

## D-037：任意のカーソル位置への内容指定・文脈挿入

Status：Accepted（2026-10-26。ユーザーが「指定した箇所に、指定したプロンプト（内容）＋前後の文脈に沿って文章を書いてくれる機能」を明示依頼）

決定：「文脈で挿入」を明示選択するoperation `context-insert`として追加する。任意のゼロ幅TextSelectionから、ユーザーの内容指示と前後各最大1,000文字・作品設定を参照して候補を作る。内容は初期空で必須、目標400文字／1案を初期値とする。既存の文脈・予算・メモ参照・比較と、同期Accept・単一Undoを再利用する。

代案：従来のinsertへ暗黙に前後本文を追加すると「プロンプトだけ」という送信契約を変えてしまう。infillの空白制約だけを解除すると、空白の補完と任意位置への内容指定挿入を画面から区別しづらいため、独立した明示ツールを採用した。範囲選択の置換、自動カーソル移動、自動挿入は追加しない。

移行：保存スキーマ・プロバイダー固有adapter・候補wire スキーマ・依存の変更なし。既存API スキーマバージョン 1へoperation値を追加する。検証：Unicode・段落境界・先頭／末尾／空章の挿入、範囲選択拒否、入力と送信範囲、内容変更、stale・遅延応答、Undo/Redo・保存再読み込み、比較・a11y。実LLMの内容遵守と文章品質は別途人手確認とする。

## D-038：スマホ幅の編集・タップ操作（新ロードマップPhase 1）

Status：Accepted（2026-10-26、ユーザーがPhase 0〜1を明示依頼）。従来のモバイルUI非目標はこの範囲に限り拡張。将来のPWA・同期のコード実装は含まない。

決定：同じPM エディタとmounted panelをレスポンシブ配置し、900px以下で本文全幅、作品操作の折りたたみ、下部ツール選択、引き出しを使用する。タップAI起動は既存snapshot capture / コントローラー / 同期Acceptへ接続する。明示ボタンのpointerdownだけでフォーカス移動を防ぎ、native touch 選択範囲とcomposition中のイベントは妨げない。古い選択の復元や座標mappingは行わない。Undo/Redo ボタンも既存history commandを呼ぶ。

小幅のAIはVisualViewport内の非モーダル sheet。比較カードの全文重複表示を避け、タブで選んだ候補・提供元・原文・Diffを表示する。PCのカード比較は維持する。viewportの変化は座標とCSSだけに反映し、エディタ再生成やsetContentは行わない。背景化は既存直列保存へbest-effort flush、未保存の入力の表示を維持する。

代案：常設chat、スマホ専用エディタ、独自Undo、旧選択範囲の復元は正本と安全性の経路を増やすため採用しない。ネイティブ長押しmenuの横取りはtouchでは避ける。

移行：workspace v4 / DB / PM スキーマ / プロバイダー / 資格情報・ループバック境界は変更なし。詳しい後続設計・移行確認条件は [ADR](roadmap/ADR_MOBILE_OFFLINE_SYNC.md) と [段階計画](roadmap/IMPLEMENTATION_PLAN.md)。検証はphone emulation、PC全回帰、composition/viewport/背景化component、build。実スマホ接続・実IME・SR・実LLMは別確認条件。

## D-039：日本語診断と独立した読み取り専用Feedback

Status：Accepted（2026-10-27、ユーザーがPhase 2〜6を明示依頼）。Phase単位で設計・検査・commitを行う。

決定：日本語規則の結果は確認候補とし、Intl.Segmenterと明示閾値をWorkerで使用する。本文位置は元PM document/content revision/instanceと照合し、変更で失効。個別修正は既存snapshot 検証・同期Accept・単一Undo。AIコメントは専用の読み取り専用routeに分離し、既存プロバイダー・同意・Origin・rate limit・制限時間を再利用。6,000文字の明示範囲だけを送信し、引用が曖昧なら位置を推測しない。

代案：正規表現だけで日本語単語を決める、全文を自動送信する、コメントを置換候補として直接採用する方式は採用しない。形態素辞書は容量・ライセンス・品詞精度の追加評価が必要であり、今回の観測項目には導入しない。migrationなし、実LLM品質と実OSは未検証。

## D-040：人物・文体設定と安全な部分採用（Phase 3）

Status: Accepted（2026-10-27、ユーザーのPhase 3明示依頼）。[ADR](roadmap/ADR_AUTHORING_AND_PARTIAL_ACCEPT.md)。Workspace v5で人物/資料/語彙/文体観測/保持条件/プリセットを作品に保存し、旧v1〜v4はstrict検証後に空profileを補う。DB スキーマはv4を維持。資料は生成ごとに初期OFF、既存未信頼メモ契約と入力上限を使用する。スキーマ正規化後の値でsnapshotを照合し、項目順だけでは失効させない。

部分採用はgrapheme差分hunkと文単位の選択UIを用い、Accept時に元の候補から置換文字列を再合成する。曖昧な位置対応は拒否。既存同期検証・1 トランザクション・Undoを維持する。登録した字面の出現回数だけを採用時に強制し、人物/人称/数値の変化と口調規則は確認警告。文学的・意味的整合性は保証しない。

## D-041：構造化ルビ・傍点と創作支援（Phase 4）

Status: Accepted（2026-10-27、Phase 4の明示依頼）。[ADR](roadmap/ADR_TYPOGRAPHY_AND_CREATIVE_TOOLS.md)。Workspace v6でPM text markとしてreading/baseと傍点を保存し、初期化・保存・履歴・バックアップで保持する。AI/検索の文字置換は注釈を含む範囲を拒否する。注釈の付与/解除は同期snapshot 検証とUndo境界を使い、本文文字を変えない。縦書きは閲覧専用。

投稿用出力は公式資料で確認できる範囲の明示記法と上限だけを扱い、予約記号や未対応のなろう傍点を黙って変換しない。Describe/Guided Writeはcontext-insertを再利用し、内容・五感/内面・追加事実の許可を確認して2案以上比較する。コピーは明示操作、本文変更は採用だけ。

## D-042：静的shellだけを保存するPWA（Phase 5）

Status: Accepted（2026-10-28）。[ADR](roadmap/ADR_PWA_OFFLINE.md)。AI設定を読まない静的offline routeとbuild時許可リストを使い、利用者の操作でSWを準備する。認証情報なしで静的資産のみCacheStorageへ保存し、動的navigation/API/原稿/AI応答をキャッシュしない。更新でskipWaiting/reloadを行わず、通信復旧でもAIを自動再送しない。IndexedDBの原稿保存はstrict durabilityで完了を待ち、キャッシュと分離する。端末/OSの削除まで保証しない。

## D-043：公開しない同期基盤と非破壊のコピー復元（Phase 6）

Status: Accepted（2026-10-28、ユーザーのローカル同期基盤・自動検証の明示依頼）。[ADR](roadmap/ADR_LOCAL_SYNC.md)。Workspace v6を維持しDB v5へ同期状態storeを追加。秘密を除いたSyncPayload v1、作品全体のリビジョン CAS、不変outbox、サーバーreceiptによる冪等性、競合の両コピーを実装する。SQLiteのtransactionで改訂/receipt/過去データを原子保存する。同期にWeb Locksを使わない。

公開route・実認証は追加しない。同一origin/HTTPS transportの接続先は製品では未設定。localhost専用の別テスト用データで認証・失効・再送・2 profileを検証する。受信は明示コピー復元とし、編集中のdocumentを差し替えない。認証方式、account binding、TLS配備、保管暗号化/retention、background sync、章単位merge/同期削除は後続gate。推測でE2EEや公開運用可能とは表示しない。

## 製品名：bunsAI++

この決定は2026-11-13のAIFUDEへの改名により置き換えられた。以下は当時の記録。

Status: Accepted（2026-11-03、所有者の明示指定）。製品名はbunsAI++、package.jsonのnameはbunsai-pp。表示名を画面・文書・新規認証のアプリ表示名・PWA メタデータへ反映し、既存の原稿・設定・認証を継続利用できるよう内部の保存名・形式・起動照合は維持する。保存先を単純置換する案は、原稿や認証が見えなくなるため採用しない。詳細は[製品名](BRANDING.md)。

## D-044：公開前整備とmainの正本化

Status: Accepted（2026-11-11、公開前指摘の修正と修正後のマージを明示依頼）。Task 20.1。正本を統合後のmainへ集約し、公開候補はコミット済みHEADからスクリプトで再生成する。旧履歴の書き換えや既存リポジトリのpublic化は行わない。古いレポートをprivateなarchiveへ残し、公開先へ含めない。

全ルートでAPP_ORIGINのloopback Hostに完全一致させ、既存APIのOrigin / body 検証も維持する。Nextの画像最適化を停止。Nodeは最低24.21.0以上の24系、CIは固定版とする。初期環境例はmock・比較なし。

依存更新は同一majorの修正版と推移依存の更新を基本とする。例外は開発用のminimatch（GHSA-g3hv-75wg-m249）で、既存の10系には修正版がないため、対象範囲だけ11.0.1へoverrideしlint・全テストを検証する。OpenAI SDK本体は7.20.0を維持し、監査で検出したjsdom経路とSDKのoptional peerで共有されるundiciを修正版へ更新する。公開前に再監査し、上流が解消したらoverrideを外す。

ライセンス・アイコンの権利確認・外部サービス条件・GitHub側設定・実機確認は公開前TODOの確認条件とし、未決定を推測で完了扱いしない。製品の本文処理・新しいmigration・公開同期は追加しない。

## 製品名：AIFUDE（合い筆）

Status: Accepted（2026-11-13、所有者の明示指定）。現行の製品名はAIFUDE、読みは「合い筆」、package.jsonのnameはaifude。画面・現行文書・PWA メタデータ・新規認証の表示名・起動メッセージへ反映する。以前の製品名決定を置き換え、過去の実装記録は履歴として残す。保存先・バックアップ形式・認証・起動照合の内部識別子は維持し、データ移行を発生させない。詳細は[製品名](BRANDING.md)。

## D-045：Claude CLIのログイン方法を固定しない

Status: Accepted（2026-11-13、所有者が「固定だけ外す」方式を選択）。Task 20.2。[Claude Codeの公式条件](https://code.claude.com/docs/en/legal-and-compliance)は、製品内でClaude Codeを動かす場合に組み込みの認証方法を削除・無効化・制限しないことを求める。以前の`forceLoginMethod: "claudeai"`と、サブスクリプション以外の認証を常に拒否する判定を廃止する。

`auth status`の`claude.ai` / `oauth_token`はサブスクリプションとして従来どおり使う。それ以外（API key・key helper・third-party・未知の値）は利用者の契約で従量課金となるため、有料API初期OFFの方針に合わせ、サーバー設定`AI_ENABLE_PAID_API=true`のときだけ生成する。未設定・未ログイン・不正な状態出力では本文を送る前に`auth-required`で止める。診断はサブスクリプション、従量課金の許可済み・未許可、未認証を区別して表示する。

サーバー自身のAPIキー等の環境変数をCLIへ渡さない許可リスト、`--setting-sources ""`、tools / MCP / hooks無効、1ターン、モデル一致の検証は維持する。Claude CLIモードの削除、API プロバイダーの変更、画面の表示名変更は行わない。Commercial Termsへの同意と実CLIでの確認は[外部サービス確認](PROVIDER_DISTRIBUTION_REVIEW.md)の残件とする。

## D-046：Apache-2.0と履歴なしの公開ソース

Status: Accepted（2026-11-15、所有者が公開用フォルダの提供、Apache-2.0、著作権者marc2825、新リポジトリ名AIfude_novel_editorを指定）。Task 20.3。ライセンスはD-048で変更した。

LICENSEに正式なApache-2.0本文、NOTICEに著作権表示、package.jsonにSPDX識別子を置く。npmの誤公開を防ぐ `private: true` は維持する。第三者依存と外部サービスの条件は個別に扱う。

D-044のコミット済みHEADからの書き出しを既定として維持し、コミットを伴わず依頼された修正を提供するため、明示的な `--working-tree` と `--include=相対パス` を追加する。HEADに含まれる配布対象の現ファイルと指定された新規ファイルだけを読み、他の未追跡ファイルは含めない。追加ファイルにも除外規則・通常ファイル確認を適用する。元のGit index・履歴を変更せず、既存出力の上書きやsymlink経由の混入を拒否する。

配布物はソースのみとし、node_modules・ビルド・ブラウザー・CLI バイナリーを含めない。新しいGit履歴は所有者が別フォルダで開始する。旧履歴のmirror・mergeや、既存リポジトリのpublic化は行わない。

## D-047：開発時だけReactのevalを許可する

Status: Accepted（2026-11-15、所有者が開発時のCSP Console Error修正を明示依頼）。Task 20.4。

Reactの開発用デバッグが使うevalを `NODE_ENV === "development"` のときだけCSPへ許可する。本番・test・未設定では許可しない。Console Errorを隠す方法や全環境のCSPを緩める方法は採用しない。保存形式・依存の移行は不要。環境別unit test、開発時Console Error、本番HTTP headerとPWAで検証する。[根拠](https://nextjs.org/docs/app/guides/content-security-policy)。

## D-048：ライセンスをPolyForm Noncommercial 1.0.0へ変更する

Status: Accepted（2026-11-18、所有者が「一旦商用禁止（厳し目）」を指定し、PolyForm Noncommercial License 1.0.0を選択）。Task 20.12。D-046のライセンス部分を置き換える。

LICENSEにPolyForm Noncommercial License 1.0.0の公式本文をそのまま置き、`Required Notice:` の著作権表示はNOTICEに書く。package.jsonのSPDX識別子は `PolyForm-Noncommercial-1.0.0`。`private: true` は維持する。

個人・研究・教育・非営利団体での利用と、非営利目的での改変・再配布を許可し、営利目的の利用は許可しない。改変と再配布も禁じるPolyForm Strictは、利用者が自分用に直すこともできなくなるため採用しない。CC BY-NC-SA 4.0は、Creative Commonsがソフトウェアへの使用を推奨しておらず特許も扱わないため採用しない。

影響：OSIの定義によるオープンソースではなくなる。これまでApache-2.0で公開した版（mainの1939ba5まで）は、入手した人が引き続きApache-2.0で利用できる。著作権者はmarc2825だけで、ほかのコミットはDependabotによる依存バージョンの更新である。ChatGPTのプラン連携の文書は対象を「open-source and locally hosted apps」と書くだけで、ライセンスの条件を示していない。この形態が対象に含まれるかは公開前に確認する。第三者依存のライセンスは変わらない。

## D-049：修正版のない開発依存の脆弱性を個別に除外する

Status: Accepted（2026-11-18、所有者が「この脆弱性だけ除外」を選択）。Task 20.13。

2026-11-17に更新された [GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf)（`picomatch` のReDoS、high）で、CIの `pnpm audit --audit-level=moderate` が失敗した。対象は `picomatch` 4.0.7以下で、修正版はない。経路は `eslint-config-next` のlint用開発依存（2.3.2と4.0.7）だけで、アプリの実行時やbuild結果には含まれない。

このGHSAだけを `package.json` の `pnpm.auditConfig.ignoreGhsas` で除外する。監査の対象範囲と重大度の基準は変えず、ほかの脆弱性は開発依存を含めて引き続きCIで検出する。CIを本番依存だけの監査に変える案は検出範囲が広く減るため、修正を待つ案はその間のbuild・E2Eが止まるため採用しない。修正版が公開されたら依存を更新し、除外を外す。

## D-050：ChatGPTとClaude CLIのサブスクリプション連携を実験的な機能とする

Status: Accepted（2026-11-18、所有者が両方を実験的な機能として明記するよう指定）。Task 20.15。

[外部AIサービスの配布前確認](PROVIDER_DISTRIBUTION_REVIEW.md) の通り、どちらの連携も公開文書だけでは利用条件への適合を確定できない。提供元の確認が取れるまで、画面の接続先名に「実験的」を付け、接続設定に「提供元の利用条件を確認中の実験的な機能です。」と表示する。README・AI接続ガイド・ROADMAPにも同じ扱いを書く。連携の動作、初期設定、APIキーによる接続は変えない。確認が取れたら表示を外すか、連携を無効にするかを改めて決める。

## D-051：pixiv向け出力はルビだけを扱う

Status: Accepted（2026-11-18、所有者が投稿先にpixivを追加するよう依頼）。Task 21.4。

自動取得で確認できた公式資料は、pixivのお知らせ（2014-12-24「pixivの小説にルビ（ふりがな）機能を追加」）だけだった。ルビの記法は `[[rb:親文字 > 読み]]` で、読みにはひらがな・カタカナ・漢字・英字が使える。ヘルプセンターは自動取得を拒否するため、特殊タグの一覧、傍点、エスケープ方法、本文の上限は確認できていない。

そのため、出力はルビだけにする。読みはNFCに正規化して判定し、合成済みの形がない結合濁点・半濁点も認める（2026-11-20、Issue #8）。読みに上記以外の文字を含むルビ、親文字の「>」、本文の半角 [ ]、既存の投稿記法に似た記号、傍点は出力を拒否し、JSON・プレーンテキストを案内する。字数の上限は追加しない。公式資料で確認できたら、範囲を広げるか改めて決める。

## D-052：説明はHelpTipへ移し、補助パネルの見出しを揃える

Status: Accepted（2026-11-18、所有者が説明の冗長さと見出しの見分けにくさの改善を依頼）。Task 21.6。

補助パネルの初期表示は、操作に必要な短い1行と、プライバシー・削除の注意に絞る。詳しい説明は見出しや項目の横の「?」（`HelpTip`）に移す。ホバー・フォーカス・タップで開き、説明は `aria-describedby` で読み上げる。見出しの名前に「説明」が混ざらないよう、HelpTipは見出し要素の外に置く（`HelpHeading`）。表示は `position: fixed` にして、スクロールするパネルで切れないようにする。

見出し・補足説明・状態表示の書式は、補助パネル全体に共通の規則として `Workspace.module.css` に置く。個々のパネルのCSSより優先させるため、`[data-writing-panel]` を前置きする。

## D-053：診断に誤字の候補とAI Feedbackの確認の種類を追加する

Status: Accepted（2026-11-18、所有者が誤字脱字と日本語の自然さの確認を依頼）。Task 21.5。

日本語の誤字や不自然さを端末内の規則だけで確実に見つけることはできない。ローカル診断には誤検出の少ないものだけを加える：語の区切り（Intl.Segmenter）で助詞「を」「が」「に」「で」が2つ続く場合と、同じ漢字語の連続。文字列だけで判定すると「彼ががんばる」のような通常の文を拾うため、トークンで判定する（2026-11-20、Issue #7）。「まだまだ」のような重ね言葉や「々」は対象にしない。

AI Feedbackのリクエストに任意の `focus`（`general` / `typos` / `naturalness`）を加え、種類ごとの固定指示をサーバーで付ける。本文はコードポイントの上限に加え、プロンプトのJSONに入れたときのUTF-8バイト数を20,000までとする。これでスキーマに合う入力が、サーバーの入力見積もり（24,000）で拒否されることはなくなる。超える場合は送信前に理由を示す（2026-11-20、Issue #8）。未知の値は拒否する。結果は従来どおり読み取り専用のコメントで、本文は変えない。

## D-054：シークレット作品を暗号化して保存する

Status: Accepted（2026-11-20、所有者が保護の強さ・ロックの単位・自動ロックを選択）。設計は [ADR](roadmap/ADR_SECRET_WORKS.md)。

作品ごとにシークレットをONにでき、パスワードはアプリ全体で1つとする。画面のロックだけでなく、作品・保存履歴・ごみ箱の記録をAES-GCMで暗号化して保存する。鍵はWebCryptoで作り、パスワードから作った鍵でデータ鍵を包む。再読み込み時と10分間の無操作でロックし、ロック中はタイトルも隠す。パスワードを忘れると復元できず、復旧手段は提供しない。実装では中身だけを暗号化する「シェル」を保存し、ID・保存version・章の数・日時・保存履歴の名前は平文に残す。全作品バックアップは暗号化したまま書き出し、単体の書き出しは確認してから行い、端末同期は使えない（2026-11-20、所有者が了承）。

## D-055：Meta Muse APIを接続先に追加する

Status: Accepted（2026-11-21、所有者がアプリのAI接続先への追加とMeta Museを選択）。

Meta Model APIのOpenAI互換Chat Completions（`https://api.meta.ai/v1/chat/completions`）を、接続ID `meta` の有料APIとして追加する。ほかの各社APIと同じく、サーバーの `AI_ENABLE_PAID_API=true`、画面のAPI許可、接続先ごとの同意を必要とする。APIキー（`META_API_KEY`）はサーバーだけに置く。応答はJSON Schemaを要求し、出力上限は `max_completion_tokens` で送る。診断は `GET /v1/models` だけを使い、本文を送らない。

末尾が `-contributor` のモデルIDは、送った内容が学習に使われることがあるため、環境変数・保存設定・画面の保存のすべてで拒否する。Meta追加前に保存した `ai-settings.json` は、`meta` のモデルIDを空として読み込む。比較候補として保存できる数の上限は、接続先の数に合わせて10にする。

Grokは既存の `xai`（xAI API）で対応済みのため変更しない。

Sources：[Chat Completions](https://dev.meta.ai/docs/protocols/chat-completions)、[モデル](https://dev.meta.ai/docs/models)、[料金と制限](https://dev.meta.ai/docs/pricing-rate-limits)、[エラー](https://dev.meta.ai/docs/error-handling)、[地域の利用方針](https://dev.meta.ai/legal/geographic-use-policy)。
