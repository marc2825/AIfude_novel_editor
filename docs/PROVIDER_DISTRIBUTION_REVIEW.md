# 外部AIサービスの配布前確認

2026-11-11に調査を始め、2026-11-15に以下の公式文書を再確認しました。これは文書の確認記録であり、提供元から個別に配布許可を受けた記録ではありません。公開前に未解決の項目を確認してください。

## ChatGPT

[ChatGPT plan usage](https://developers.openai.com/siwc/token-sharing-open-source) は、OSS・ローカルアプリから利用者のプランを使う仕組みを説明しています。有料・リモート運用は別の問い合わせ対象です。

[プレビュー制約](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations) に合わせ、実装では `store: false`、`stream: true`、配列の `input`、`instructions` を使います。host IDを保存して認証へ渡す処理も、2026-11-15にコードで確認しました。ストリームはサーバー内で受信し、画面には検証済みの候補だけを返します。

設定例の `gpt-6.1-sol` は [モデル文書](https://developers.openai.com/api/docs/models/gpt-6.1-sol) で確認しました。ただし、APIのモデル一覧とサブスクリプションで使えるモデルは別です。

公開前には登録・トークン保管・接続解除・画面表示を現行仕様と照合し、実アカウントで認証と生成を確認します。アカウント別のモデルと文章品質は未検証です。

## Claude CLI

[Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance) は、製品からClaude Codeを動かす際のCommercial Terms、未改変バイナリー、利用者本人の認証、利用の仲介・再販に関する条件を説明しています。

アプリは利用者が導入・認証した公式CLIを呼び出します。独自のログイン画面やトークン抽出は実装していません。2026-11-13のD-045で `forceLoginMethod: "claudeai"` を外し、ログイン方法の固定を解除しました。サブスクリプション以外の認証では、`AI_ENABLE_PAID_API=true` の場合だけ生成します。

残る確認事項は次の3つです。

- 製品からCLIを動かす場合のCommercial Termsへの同意と、この配布形態での条件適合。
- サーバーの認証環境変数を引き継がず、`--setting-sources ""` で設定ファイルを読まない実装と、認証方法を制限しない条件との関係。
- 実CLIの `auth status` の値と、`--safe-mode` / `--restricted` などの対応状況。

必要に応じて提供元へ照会します。サブスクリプションがあれば任意の第三者アプリで使える、とは案内しません。実アカウントの検証は未実施です。

設定例の `claude-sonnet-5` は、調査時点の [モデル文書](https://platform.claude.com/docs/en/models/sonnet-5/overview) ではlegacyモデルでした。公開前に有効なIDを確認してください。アプリが自動で置き換えることはありません。

## 共通の確認

CLI本体や認証情報はソースに同梱しません。Apache-2.0は、外部サービスの利用権や提供元の承認を与えるものではありません。

実サービスでは、許可されたテスト用原稿でサインイン・生成・キャンセル・ログアウトを確認します。有料APIの初期OFF、送信先ごとの同意、原稿やトークンをログへ出さない扱いも確認してください。結果は日付・モデル・成否を記録し、原稿・認証情報は残しません。
