# 外部サービスと配布前の確認

初回確認日：2026-11-11。2026-11-15に下記ChatGPT overview / preview limitations、Claude Legal and complianceを再確認した。公式文書を読んだ記録であり、個別アカウントや配布形態について提供元の承認を得た記録ではない。未確定項目は [公開前TODO](PUBLISHING.md) に残す。

## Sign in with ChatGPT

公式の [ChatGPT plan usage](https://developers.openai.com/siwc/token-sharing-open-source) は、OSS / ローカルホストのアプリを対象に利用者のプランで対象リクエストを実行する仕組みを説明している。有料・リモートホスト形態については別の問い合わせ経路が案内されており、ローカルOSS公開と同じ条件とは扱わない。

[プレビュー制約](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations) にはResponses APIの `store: false` / `stream: true`、入力形式、未対応フィールド等の条件がある。公開前に現在のadapter、登録・token保管・ログアウト・画面表示を現行仕様と照合する。ブラウザーへのストリーミングを新設するという意味ではない。

`.env.example` の `gpt-6.1-sol` は [公式モデル文書](https://developers.openai.com/api/docs/models/gpt-6.1-sol) に存在する。ただしAPIカタログの存在はサブスクの各アカウントでの利用可能性を保証しない。サインイン後のカタログと実生成で確認する。

## Claude CLI

公式の [Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance) は、製品内でCLIを動かす場合のCommercial Terms、未改変binary、利用者本人の認証、利用の仲介・再販禁止を説明している。また、開発者によるClaude.aiログインの独自提供や、利用者に代わってサブスク資格情報で要求を中継することを制限している。

現在のadapterは各PCに別途導入・認証した公式CLIを呼び出し、独自ログインやtoken抽出を実装していない。この構成のOSS配布について、上記条件への適合と必要なら提供元への照会を所有者が最終確認する。「サブスクがあれば任意の第三者アプリで利用可能」とは案内しない。実アカウントの確認は未実施。

2026-11-13に同文書を再確認した。製品内でClaude Codeを動かす条件には「組み込みの認証方法を削除・無効化・制限しない（Claudeアカウントと利用者自身のAPIキーによるサインインを含む）」がある。以前のadapterは`forceLoginMethod: "claudeai"`でログイン方法を固定し、subscription以外の認証を拒否していたため、この条件に反するおそれがあった。D-045で固定を外し、subscription以外の認証は従量課金として既存の`AI_ENABLE_PAID_API=true`があるときだけ使う形へ変更した。

残る確認事項：

- 製品内でClaude Codeを動かす場合のCommercial Termsへの同意。相互の合意がない限り必要とされている。
- server自身の環境変数（APIキー・クラウド認証）と、設定ファイル（`--setting-sources ""`で読み込まない）を経由する認証方法を引き継がない点。安全境界として維持しているが、条件との関係は未確認。
- 実CLIでの`auth status`の値と、`--safe-mode` / `--restricted`等のフラグ対応。

`claude-sonnet-5` は [公式モデル文書](https://platform.claude.com/docs/en/models/sonnet-5/overview) に残るlegacyモデルで、最新版ではない。今回モデルを自動置換せず、利用者がCLIと契約で利用できる正確なIDを設定する。公開直前に有効性を再確認する。

## 配布前の残件

- OSSのライセンスは外部サービスやCLIの利用権を付与しない。CLI binary・認証情報を同梱しない。
- 実アカウントでのサインイン／生成／キャンセル／ログアウトを、明示的に許可したテスト原稿だけで確認する。
- 有料APIの初期OFF、provider別の送信同意、原稿・tokenをログへ出さない境界を維持する。

2026-11-15の静的照合では、ChatGPT adapterに `store: false` / `stream: true` / 配列input / instructionsがあり、host IDを保存して認証へ渡す実装を確認した。実認証、アカウント別モデル、文章品質は未検証。ClaudeはD-045の実装を維持し、上記の契約・環境変数と設定の扱い・実CLI確認を未解決のまま残す。Apache-2.0の採用を、外部サービス提供元による承認とは扱わない。
