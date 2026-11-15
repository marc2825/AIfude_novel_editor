# Security and Privacy

## Task 18.5：内容指定の文脈挿入

`context-insert`は空のselectionTextと必須の内容指示・目標文字数を共通schemaで検証する。任意位置でも元の本文を削除せず、ゼロ幅snapshotだけを同期Acceptで適用する。前後の本文・作品資料は未信頼の参照データとし、挿入位置の座標をモデルへ送らない。既存の同意・API opt-in・予算・rate limit・出力検証と遅延応答拒否を使い、別providerへの自動切替を行わない。

## Task 18.4：文脈付き補完

補完は明示選択したモード・生成操作に限定する。clientとserverでoperationごとの選択文字列・前後文脈・目標文字数を検証し、必要な文脈が欠ける入力や不明fieldをprovider前に拒否する。本文から前後各最大1,000文字、作品共通設定と明示ONのメモを送信対象として説明する。章全体や編集座標は送らない。生成本文は未信頼の文字列として検証・エスケープ表示し、同期的なsnapshot検証と明示Accept以外でdocumentへ適用しない。課金APIのopt-in・送信先同意・自動fallback禁止は従来どおり。

## Task 18.3：辞書照会と外部検索

辞書routeは同一origin・Host・Fetch Metadata・JSON・実測body上限の共通guardを通し、語句だけを含むstrict requestを検証する。語句は1〜100コードポイントで、原稿・作品設定・メモ・任意prompt fieldは受け付けない。語句を未信頼JSONデータとしてserverで固定指示へ組み込み、既存のAPI許可・送信同意・接続照合・共有rate limiter・deadline・settings revisionで保護する。provider SDKやキーはclientへ公開しない。

LLM説明はプレーン文字列で描画し、採用・本文挿入・自動リンク化を行わない。旧request IDの応答は破棄する。検索リンクは固定の`https://www.google.com/search`へ語句と「意味」だけをURLエンコードし、明示clickで別タブへ開く。`noopener noreferrer`と`referrerPolicy=no-referrer`を指定し、作品本文やアプリURLを参照元として送らない。リンクの表示・辞書を開く操作では検索先に接続しない。LLM説明を実検索や信頼できる出典として表示しない。

## Threat model

V0.1は、ユーザー自身のPC上で動く単一ユーザー用アプリ。

防止対象：

- APIキーのクライアント流出
- 他originからの無断API呼び出し
- DNS rebinding等による意図しないhost受け入れ
- 過大payload
- provider費用の無制限増加
- 本文や候補のログ漏えい
- prompt injectionによる制約逸脱
- 候補中のHTMLによるXSS
- stale responseによる本文破損
- 別タブの上書き

端末そのもの、ブラウザーextension、OSアカウントが侵害された場合の完全保護は対象外。

## Deployment boundary

dev/startはloopbackへbindする。

`APP_ORIGIN`はloopback hostを持つ単一のoriginとして検証する。

許可するhostはlocalhost、127.0.0.1、IPv6 loopbackのいずれか。

wildcard、任意のLAN address、公開domainをV0.1の実AI設定で許可しない。

実際のbindとserver設定の両方を確認する。

公開deployの認証代わりにOrigin検証を使ってはならない。

Task 17.1のlauncherも127.0.0.1:3000へ固定し、子processのAPP_ORIGINをそのURLにする。依存install、credentialの変更、LAN公開、別portへの切替は自動実行しない。`GET /api/health`はapp名とUUID形式の起動識別子だけを返す。公開識別子は認証の代わりにならず、本文・設定・キー・認証statusを含めない。起動lockにはversionとUUIDだけを保存し、未知／残存lockを自動削除しない。launcherは所有するprocess groupだけを終了する。

## Request guard

`src/proxy.ts` は全ルートのHostを、検証済みAPP_ORIGINのhostとportへ完全一致させる。通常ページ・API・`/_next/static`・`/_next/image`・service workerを除外しない。APP_ORIGIN未設定時だけ `http://127.0.0.1:3000` を使い、不正な設定値やHost欠落は403で拒否する。forwarded Hostは許可の根拠にしない。Nextの画像最適化は `images.unoptimized: true` で無効にする。

AI routeは以下を要求する。

- POST
- application/json
- Originが設定originと完全一致
- Hostが設定hostと完全一致
- Fetch Metadataが存在する場合は同一origin
- 実測64KiB以下のbody
- 厳格なrequest schema

Content-Lengthだけに依存せず、body streamのbyte数を数える。

欠落Originを、実AI呼び出しについて黙って許可しない。

CORSで他originを許可しない。

forwarded headerを無条件に信頼しない。

V0.1はreverse proxy配下の公開運用を想定しない。

## Rate and cost control

実AIはprocess内のproviderごとに以下を制限する。単独生成routeと比較routeは同じproviderのlimiterを共有する。比較では異なる2〜3providerを同時実行できる。

- 同時実行1件
- 1分間6request
- 1日100request

process再起動でresetされるため、課金上限の保証ではない。

providerアカウント側にも利用上限を設定する。

mockは課金用rate limitの対象外とするが、request guardと入力上限は適用する。

rate limiter自体はfake clockで検証する。

SDKの自動retryを無効化する。

APIは`AI_ENABLE_PAID_API=true`を指定した場合のみ構成し、画面設定も初期OFFとする。API requestの`allowPaidApi:true`と送信先への同意を検証する。比較対象に無許可APIがあれば全対象を呼び出さず拒否する。画面設定はreloadでOFFへ戻り、保存済み送信同意・backupから復元しない。APIをサブスク枠として扱わず、利用枠不足をAPIや別providerで補わない。

## Secret handling

ChatGPTのOAuth access / refresh / ID tokenはserver専用のrepository外credential fileへ保存する。directory 0700、file 0600とし、symlink・破損・過大recordを拒否する。原子的なrenameとfile lockで更新し、refreshの競合を防ぐ。残ったlockを勝手に破棄せずfail closedにする。既定pathは`~/.local/share/novel-ai-editor/chatgpt/connection.json`。本文のIndexedDB、バックアップ、client bundle、ログには含めない。

OAuth callbackは専用loopback listenerで処理し、state / nonce / PKCE、JWKS署名、issuer / audience / expiry / subject、plan用scopeを確認する。callbackは1回だけ消費し、5分で期限切れにする。認証URLにID token hintを含めず、API経由でtokenをbrowserへ渡さない。解除時はlocal tokenを即時無効化し、OpenAI discoveryのrevocation endpointへ失効を要求する。遠隔失効を確認できなくてもlocal tokenは削除し、未確認をUIに表示する。

このcredential file方式はUnixのowner権限を要求する。Linux / WSLで自動検査し、macOSは実機未検証。native Windows serverのACL対応は未実装のため、Windows上ではWSLでserverを動かす。ブラウザー側のWindows IME確認とは別の制約である。

APIキーはserver環境変数のみ。

`NEXT_PUBLIC_`変数へ入れない。

IndexedDB、localStorage、URL、error、telemetry、バックアップへ保存しない。

provider SDKのmoduleへ`server-only`を適用する。

Claudeサブスクでは公式CLIが専用認証ディレクトリを管理する。アプリはtokenを読み出さず`auth status`の認証種別を確認する。CLIのログイン方法を固定しない。subscription以外の認証は従量課金のため`AI_ENABLE_PAID_API=true`のときだけ使用する。server自身のAPIキー・gateway・debug・telemetry等の継承環境変数を渡さず、コマンドはshellを介さない。本文はstdinにだけ渡す。履歴保存・ツール・MCP・customization・hooks・fallback・retryを無効にし、stdout / stderrをログへ転送しない。CLI出力は256KiB、実行は180秒で制限し、abort時に子プロセスを終了する。CLIの管理者強制ポリシーとアカウントの追加使用量設定はユーザー側で確認する。通常テストは専用の偽CLIを使い実認証情報を読まない。

任意のprovider base URLをclientから受け付けない。

## Logging

許可する運用情報：

- request ID
- provider ID
- safe error code
- 処理時間
- token usage
- HTTP status

禁止するもの：

- 本文
- 前後文脈
- 共通プロンプト
- 設定・背景・登場人物メモ
- 指示
- 候補
- APIキー
- providerのraw error body
- request/response全体

consoleへの一時debug出力も残さない。

## XSS

本文、候補、作品メモリはReactの文字列として描画する。

`dangerouslySetInnerHTML`を使用しない。

LLM由来のHTML、Markdown、URLを自動実行・自動リンク化しない。

Diffのins/del相当表示も、子要素はescapeされた文字列とする。

import JSONはschema検証し、任意objectのdeep mergeをしない。

## Browser headers

AI responseはCache-Control no-store。

基本headerとしてnosniff、frame embedding禁止、不要なbrowser permissionの制限を設定する。

CSPは少なくともobject、base、frame ancestorを制限する。

本番相当設定へ開発用unsafe-evalを持ち込まない。

Task 20.4では `NODE_ENV === "development"` の場合だけscript-srcへ `unsafe-eval` を追加する。Reactの開発用デバッグ機能に必要なためであり、production・test・未設定では許可しない。[Next.js公式CSPガイド](https://nextjs.org/docs/app/guides/content-security-policy)に従う。本番buildの通常ページとoffline画面のHTTP headerでも不許可を検証する。その他のCSP、Host / Origin境界は維持する。

CSPだけでXSS対策が完了したと扱わない。

外部analytics、外部font、外部画像を標準で読み込まない。

## Provider privacy

ローカルLLMの生成はserverで検証したloopback URLの`/v1/chat/completions`へ接続する。credentials付きURL、query、fragment、LAN・公開hostを拒否し、HTTP redirectを追わない。生成payloadから接続URL・任意model IDを受け取らず、任意のクラウドURLへのfallbackも行わない。Task 16.1の設定routeだけがloopback URLとmodel IDの保存を許可し、同じserver検証を適用する。任意の認証tokenは`LOCAL_LLM_API_KEY`としてserver内だけで扱う。

アプリが直接送る先はこのPCの推論サーバーであり、外部providerの同意は不要とする。ただしloopbackは推論サーバー自身による外部転送やログ保持を保証しない。ローカル実行するmodelを選択し、推論サーバーの転送・保存設定を別途確認することをUIとREADMEに示す。実LLMの同時実行・request数制限はローカルにも適用し、mockだけを除外する。

OpenAI adapterでは対応APIのstore falseを使用する。

これはprovider側のすべての保持がなくなる保証ではない。

provider、契約、アカウント設定に応じた保持方針が適用されることをUIで説明する。

外部送信同意はproviderとpolicy versionに結び付ける。

同意撤回後は新規requestを禁止し、進行中requestをabortして候補を無効化する。

送信済み情報をアプリ側だけで回収できるとは表示しない。

## Local data

IndexedDBはアプリ独自に暗号化しない。

同じブラウザープロファイルや端末の利用者から秘密になるとは保証しない。

バックアップには未公開原稿と作品メモリが含まれることを表示する。

Task 13.1のメモは本文と同じIndexedDB・JSON backupへ保存し、暗号化・cloud同期を追加しない。AI参照はセッションごとに初期OFFで、OFFではrequestから完全に省略する。ONの場合は送信する保存済みメモを表示し、選択したproviderへの既存の外部送信同意も要求する。共通プロンプトと同様に未信頼dataとして扱い、固定制御指示へ昇格しない。ファイルシステムのAGENTS.mdや認証情報を読み込む機能は持たない。

Task 14.1では項目別参照を追加し、未選択項目の内容はrequestへ含めない（canonical object内の値は空文字）。生成前の予算・送信内容・応答検証は同じ選択を使う。参照選択はbackupへ保存しない。

ファイルopenはユーザーが選んだ10MiB以下のJSON / UTF-8 .txtだけを読み、新しい作品IDとして保存する。設定画面からの既存backup置換は別の保存済み作品とのID衝突を拒否する。待機中作品も平文IndexedDB内に保存し、キー・認証情報は持たない。単一writer lockとversion比較を全作品で維持する。JSON downloadは1作品分で、browserが保存先を管理する。

ローカルデータ削除は確認付きで提供する。

ブラウザーデータ削除、ストレージ回収、プライベートモードによる消失可能性を説明する。

## Public SaaSへ移行する条件

次を別途設計・承認するまで公開しない。

- 認証とユーザーごとの認可
- tenant境界
- 利用枠と課金管理
- 永続・分散rate limit
- secret管理
- データ保持と削除
- abuse対応
- auditと監視
- cloud保存時の脅威分析
- origin、proxy、deployment設定


Task 15.1の保存履歴は本文・手入力メモを含む平文ローカルデータ。自動記録は初期OFF、手動保存は明示操作。直近50件を保持し、全削除と書き出しを提供する。Task 16.1では作品削除時に履歴もごみ箱へ移し、完全削除まで保持する。全作品backupは100MiBまでの検証済みJSONだけを扱い、復元先は新UUIDのコピーで外部送信同意をresetする。候補・APIキー・provider credential・嗜好学習は含まない。localStorageへ保存するのはtab UUIDとcaret / revisionだけで、本文やメモは含めない。

## AI接続の設定と診断（Task 16.1）

設定routeはAPP_ORIGINのloopback host、origin、Sec-Fetch-Siteとbounded JSONを検証する。保存するのは接続ID・model ID・比較候補・loopback URLだけ。APIキー・OAuth token・CLI実行path・認証directoryをclientから受け取らず、公開するキー情報は設定有無だけ。APIのserver opt-inと画面の初期OFFを維持する。設定fileはrepository外、owner-only 600、symlink拒否、strict version / revision検証、lock + CAS + atomic rename。未知versionや破損を自動resetしない。Unix権限を前提とするためnative Windows serverは未対応（WSLを使用）。

診断は明示操作のみ、metadata GET（ChatGPT / OpenAI、Anthropic、Gemini、xAI、DeepSeek、local）またはClaude CLI auth statusに限定する。認証はserver内header／既存認証serviceで扱い、本文・メモ・プロンプトも推論requestも作らない。HTTP redirect拒否、10秒deadline、256KiB・最大1,000モデルの応答制限、provider rate limiterを適用する。最初の一覧ページだけを確認し、生成可否・残量を保証しない。Claudeは空の一時cwdとallowlist envで認証確認する。接続変更中の診断・推論結果はrevisionで拒否する。

## PWAと原稿同期の検証基盤

Service Workerはbuild生成の静的allowlistだけをcredentialなしでcacheする。動的通常画面、API、AI応答、原稿、認証情報をcacheしない。オフラインではAIを送信せず、復旧後も自動再送しない。cacheと原稿のIndexedDB保存を分離する。

Phase 6に公開sync routeはない。本番の接続は未設定・同期準備は初期OFF。HTTP transportの同一origin/HTTPS、認証済みprincipalを要求するSQLite service、CAS/receipt/所有者分離をローカルfixtureで検証する。fixtureのsessionはテスト専用であり、製品の認証方式ではない。E2EE/ゼロ知識・運用TLS・本物のaccount回復/失効は未実装。公開前のgateは[同期ADR](roadmap/ADR_LOCAL_SYNC.md)を参照する。ローカル完全削除は孤立した同期データも同じtransactionで削除し、サーバー削除には伝播しない。
