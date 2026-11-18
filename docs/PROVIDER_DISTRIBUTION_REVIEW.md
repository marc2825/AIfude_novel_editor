# 外部AIサービスの配布前確認

2026-11-11に調査を始め、2026-11-18に以下の公式文書を再確認しました。これは文書の確認記録であり、提供元から個別に配布許可を受けた記録でも、法的な判断でもありません。公開前に未解決の項目を確認してください。

## 結論（2026-11-18）

| 連携 | 公開文書で確かめられたこと | 未確定のこと |
|---|---|---|
| ChatGPTのプラン連携 | ローカル実行のアプリ向けの登録手順があり、実装は技術要件に沿っている | 「open-source」の定義がなく、商用禁止ライセンスのAIFUDEが対象に含まれるか |
| Claude CLI | 利用者本人が未改変のCLIへ自分のサブスクリプションでログインすることは妨げられていない | Commercial Termsへの同意の要否、認証方法の「制限」に当たるか、`claude -p` の自動実行の扱い |

どちらも公開文書だけでは確定できません。2026-11-18から、両方を実験的な機能として画面と文書に明記しています。一般向けに告知する前に、提供元へ照会してください。

## ChatGPT

確認した文書：[Overview](https://developers.openai.com/siwc/token-sharing-open-source)、[Quickstart](https://developers.openai.com/siwc/quickstart)、[Registration and sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)、[Preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)、[Request a client ID](https://developers.openai.com/siwc/request-client-id)、[UI/UX guidelines](https://developers.openai.com/siwc/ui-ux-guidelines)。利用規約のページ（openai.com/policies）と問い合わせフォームは、自動取得できず読めていません。

### 対象となるアプリ

- 文書の対象は「open-source and locally hosted apps」です。有料またはリモートで動かすアプリは、[問い合わせフォーム](https://openai.com/form/sign-in-with-chatgpt-interest/)を使うよう案内しています。
- Quickstartには「ChatGPT plan usage is available to all open-source partners and selected private clients」とあります。
- 「open-source」の定義、必要なライセンス、非商用・source-availableのライセンスの扱いは書かれていません。Registration and sign-inのページは、対象者・商用利用・データの扱い・禁止事項・ブランド規則を扱わないと明記しています。

AIFUDEは利用者のPCで動く無料のアプリなので「locally hosted」には当たります。一方、2026-11-18にPolyForm Noncommercialへ変えたため、OSIの定義によるオープンソースではありません。「open-source」の条件を満たすかは、文書からは判断できません。

### 技術要件との照合

コードで次を確認しました。実アカウントでの動作は未確認です。

| 文書の要件 | 実装 |
|---|---|
| 初回は `client_id=dynamic_agent_client`、`ext_agent_host_id`、アプリ名の `agent_name_hint` を送る | 送る。アプリ名は「AIFUDE」 |
| 発行された `client_id` を保存して再利用する | 保存して再利用する |
| トークン応答で `chatgpt.tokens.use.direct` を確認する | 確認する |
| 認証情報を所有者だけが読める権限で保存し、ログに出さない | `0600` で保存し、ログに出さない |
| `store: false`、`stream: true` | 指定する |
| 初回の案内、「Continue with ChatGPT」の表示、利用状況（chatgpt.com/settings/usage）への案内 | 表示する |

UI/UX guidelinesは「approved OpenAI branding」を求めています。現在のボタンは文字だけで、公式のブランド素材との照合は済んでいません。

設定例の `gpt-6.1-sol` は [モデル文書](https://developers.openai.com/api/docs/models/gpt-6.1-sol) で確認しました。ただし、APIのモデル一覧とサブスクリプションで使えるモデルは別です。アカウント別のモデルと文章品質は未検証です。

## Claude CLI

確認した文書：[Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance)、[Consumer Terms](https://www.anthropic.com/legal/consumer-terms)（2025-10-08発効）、[Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview)。

### 文書に書かれていること

- 認められている形：利用者本人が、未改変のClaude Codeに自分のClaudeサブスクリプションでサインインすること（「Nor does it prevent an end user from signing in to the unmodified Claude Code binary with their own Claude subscription」）。
- 禁止されている形：第三者の開発者が自分のアプリでClaude.aiのログインを提供すること、認証情報やセッショントークンを収集・保存・仲介すること、利用者に代わって利用料を払う・再販する・仲介すること。
- 製品でClaude Codeを実行する場合の条件：Commercial Termsへの同意、バイナリーを改変しないこと、組み込みの認証方法を削除・無効化・制限しないこと、利用者がそれぞれ自分の認証情報を使うこと。
- Consumer Termsは、APIキー以外で自動化された方法によりサービスへアクセスすることを、明示的に許可された場合を除いて禁止しています。
- 「runs Claude Code」と平文で説明することは認められています。Claude CodeやAnthropicの名前・ロゴを製品名やロゴに使うことは認められていません。

### 実装との照合

適合している点：

- 利用者が自分で導入し、`claude auth login` でログインした未改変のCLIを呼び出します。
- 独自のログイン画面はなく、トークンを読み取り・保存・送信しません。CLIの認証ファイルはCLIが管理します。
- アプリは無料で、利用者のPCで動きます。利用料の支払いや仲介はしません。
- 画面では「Claudeサブスク（公式CLI）」と平文で表示し、製品名・ロゴには使っていません。

未確定の点：

1. Commercial Terms：利用者が自分で入れたCLIをローカルのアプリが呼ぶ形が、「製品でClaude Codeを実行する」に当たるかは定義がありません。当たる場合は、無料・非商用でも同意が必要で、免除の記載はありません。
2. 認証方法の制限：アプリは専用の `CLAUDE_CONFIG_DIR` と許可した環境変数だけをCLIへ渡し、`--setting-sources ""` で設定ファイルを読ませません。そのため、環境変数のAPIキー、設定ファイルの `apiKeyHelper`、Amazon Bedrockなどの外部プロバイダーの認証は、アプリ経由では使えません。`claude auth login` によるログインは使えます。これが「制限」に当たるかは文書に定義がありません。
3. 自動実行：AIFUDEは利用者の操作ごとに1回 `claude -p` を実行します。これがConsumer Termsの「明示的に許可された場合」に含まれるかは書かれていません。

実CLIの `auth status` の値と、`--safe-mode`・`--restricted` などのフラグへの対応も、実機では未確認です。

設定例の `claude-sonnet-5` は、調査時点の [モデル文書](https://platform.claude.com/docs/en/models/sonnet-5/overview) ではlegacyモデルでした。公開前に有効なIDを確認してください。アプリが自動で置き換えることはありません。

## 共通の確認

CLI本体や認証情報はソースに同梱しません。AIFUDEのライセンス（PolyForm Noncommercial License 1.0.0）は、外部サービスの利用権や提供元の承認を与えるものではありません。サブスクリプションがあれば任意の第三者アプリで使える、とは案内しません。

実サービスでは、許可されたテスト用原稿でサインイン・生成・キャンセル・ログアウトを確認します。有料APIの初期OFF、送信先ごとの同意、原稿やトークンをログへ出さない扱いも確認してください。結果は日付・モデル・成否を記録し、原稿・認証情報は残しません。
