# セキュリティ上の問題の報告

このアプリはプレビュー版のローカル専用ソフトウェアです。サーバーはloopbackへbindし、LANやインターネットへ公開運用しないでください。

公開後の報告窓口は、公開リポジトリの **Security → Report a vulnerability**（GitHub Private vulnerability reporting）とします。公開先予定は `marc2825/AIfude_novel_editor`。現在は公開リポジトリも報告窓口も未開設です。

[GitHubの公式案内](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configure-for-a-repository) に従い、publicへの切替と同じ作業で所有者が窓口を有効化し、利用できることを確認してこの未開設表示を更新します。窓口を確認するまでリリース告知は行いません。

脆弱性の再現手順、認証情報、APIキー、原稿やバックアップを公開Issueへ投稿しないでください。報告には、利用バージョン、OS、影響範囲、実データを含まない最小の再現手順を記載してください。

修正は現在の開発版を対象とします。正式なサポート期間や応答期限は未設定です。アプリの設計上の対策は [設計文書](docs/SECURITY.md)、公開前の残件は [公開準備](docs/PUBLISHING.md) に記載しています。
