# 公開準備

公開先は `marc2825/AIfude_novel_editor`、ライセンスはPolyForm Noncommercial License 1.0.0（2026-11-18にApache-2.0から変更）、著作権者はmarc2825です。この文書ではソース公開の手順を扱います。アプリのサーバーは引き続きPC内で使います。

## 公開前に確認すること

- [ ] 素材の権利：`public/icons/source.svg` と派生PNG、`docs/images/` のロゴを配布できることを確認する。2026-11-18に作り直した図形で、「合い筆」の字形はNoto Serif CJK JP（OFL 1.1）に由来する。最終確認は所有者が行う。[第三者ライセンス](THIRD_PARTY_LICENSES.md) も確認する。
- [ ] 外部AIの利用条件：特にClaude CLIを製品から動かす条件、Commercial Terms、認証方法の制限との関係を確認する。ChatGPTのプラン連携が、商用禁止ライセンスのアプリでも対象になるかも確認する。[確認記録](PROVIDER_DISTRIBUTION_REVIEW.md) に未解決の項目がある。
- [ ] 実サービスの動作：テスト用原稿でサインイン・生成・キャンセル・ログアウトを確認する。ChatGPTの利用可能モデルと、Claude CLIの対応フラグも調べる。
- [ ] 実機の操作：Windows / macOSの日本語IME、キーボード、スクリーンリーダー、案内する端末でのPWAと休止復帰を確認する。未確認の項目はプレビューの説明に残す。
- [ ] 配布内容：原稿・バックアップ・秘密情報・個人メール・旧Git履歴が含まれないことを目視する。自動スキャンだけでは任意名の機密ファイルを判別できない。
- [ ] 新リポジトリのCI：最終内容で依存監査とGitHub Actionsを通す。作者名・noreplyメール、登録ファイル、ログ、License表示も確認する。

原稿がある環境では、更新前に全作品バックアップを保存してください。自動テストの成功は、実サービス・実機・GitHub上のCIの確認を兼ねません。

## ソースを移す

移行用フォルダの中身を、隠しファイルも含めてコピーします。`.github`、`.env.example`、`.node-version` などが必要です。古い `.git`、`node_modules`、`.next`、`.env.local`、認証ディレクトリは持ち込まず、旧履歴をmerge・mirrorしないでください。

以下はまだGitを初期化していないコピー用です。移行先にすでに `.git` がある場合は再実行せず、リモート・作者設定・差分の確認へ進みます。

```sh
cd /path/to/AIfude_novel_editor
# ZIP展開で実行属性が失われた場合
chmod +x start-editor.sh start-editor.command

git init -b main
git config user.name 'marc2825'
# GitHub Settings → Emails の正確なnoreplyメールに置き換える
git config user.email 'YOUR_GITHUB_NOREPLY_EMAIL'
git add .
git diff --cached --stat
git diff --cached --check
# 内容・作者設定を確認してからコミットする
git commit -m 'Initial public source release'
```

GitHubには空の非公開リポジトリを作り、用意したREADME・LICENSE・gitignoreを使います。所有者とURLを確認してから登録します。

```sh
git remote add origin https://github.com/marc2825/AIfude_novel_editor.git
git push -u origin main
```

実APIキー・原稿・認証トークンをCIへ渡す必要はありません。登録内容とCIを確認してから公開を判断します。

## GitHubで公開するとき

1. Dependabot alerts / security updates、secret scanning、push protection、mainの保護と必須CI（verify）を設定する。使える機能はプランと公開範囲によって異なる。
2. 公開切替と同時に [Private vulnerability reporting](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configure-for-a-repository) を有効にする。この機能は公開リポジトリ向け。
3. `https://github.com/marc2825/AIfude_novel_editor/security/advisories/new` で窓口を確認し、[SECURITY.md](../SECURITY.md) の状態を更新する。窓口が使えるまでは告知しない。有効化できなければ非公開へ戻すか、別の非公開窓口を用意する。
4. 説明・Topics・プレビュー表記を整える。GitHub上で成功した検査だけを、公開先で検証済みと記載する。

## 公開用コピーを作り直す

コピー元の外に、未使用のフォルダ名を指定します。親ディレクトリは先に用意してください。

```sh
# コミット済みHEADから作る
node scripts/export-public.ts /path/to/new/AIfude_novel_editor

# 作業中の変更と、新しい文書も含める
node scripts/export-public.ts /path/to/new/AIfude_novel_editor --working-tree --include=docs/USAGE.md --include=docs/AI_CONNECTIONS.md
```

`--working-tree` はHEADに含まれる配布対象ファイルの現内容を使います。新規ファイルは `--include=相対パス` で1つずつ指定します。ステージ済みでも、指定しない新規ファイルは入りません。

書き出しは既存フォルダを上書きせず、削除された追跡ファイルやシンボリックリンクがあると停止します。履歴・開発資料のarchive・生成物・未指定の未追跡ファイルは除外します。文書内の個人パスと一部のメール形式も検出しますが、秘密情報の完全な検出は保証しません。

Gitの初期化・ステージ・コミット・pushは行いません。検査は出力の別コピーで実行し、依存やビルド結果を配布物に戻さないでください。コマンドは [開発手順](DEVELOPMENT.md) にあります。

## 検査の記録

以下は各日付のローカル検査です。現在のGitHub CIや実機の結果を示すものではありません。

| 日付・対象 | 結果 |
|---|---|
| 2026-11-15、Task 20.3の移行ソース | frozen install、型・lint、1,084テスト、build、E2E 111件成功。依存監査550件で全severity 0。配布344ファイル、相対文書リンクと代表的な秘密情報形式の確認も完了 |
| 2026-11-16、Task 20.4の画面・CSP修正 | 型・lint、1,088テスト、build、標準・モバイルE2E 105件、PWA E2E 7件成功。詳細は [実装計画](IMPLEMENTATION_PLAN.md#task-204の変更検査結果2026-11-16) |

Node.js 24.21.0 / pnpm 10.34.5、Linuxの独立コピーで実行しました。Git子プロセス・監査の名前解決に関する実行環境の制限と、WebKitの共有ライブラリ不足は検査環境側で解消して再実行しています。OS設定や製品の依存は変更していません。

`unrs-resolver` のビルドスクリプト未許可と色指定の警告は残ります。開発時のReact evalエラーはTask 20.4で修正しました。GitHub CI、実AI、実機IME、Windows / macOSのGUI起動、実スマホ・スクリーンリーダーは未確認です。

長いコンポーネントの整理、ランチャーのビルド再利用、APIの429専用表示、CSPのnonce化は別の変更として扱います。
