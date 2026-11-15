# AIfude_novel_editor の公開準備

更新日：2026-11-15。対象はTask 20.3。新リポジトリ名は **AIfude_novel_editor**、著作権者は **marc2825**、ライセンスは **Apache-2.0**。製品名AIFUDE（合い筆）とpackage名aifudeは維持する。ソースの公開準備であり、ローカル専用アプリのLAN・インターネット公開運用は対象外。

今回GitHubリポジトリの作成、既存リポジトリのpublic化、commit、push、公開デプロイは実施していない。

## 今回整えたもの

- LICENSEにApache公式の全文、NOTICEに `Copyright 2026 marc2825`、package.jsonに `Apache-2.0` を設定。npm誤公開防止の `private: true` は維持。
- [第三者ライセンスと素材](THIRD_PARTY_LICENSES.md) に、ソース配布範囲と依存ライセンスの確認を記録。
- 公開書き出しに、コミットせず今回の修正と指定した追加ファイルを含めるモードを追加。既定は引き続きコミット済みHEAD。既存フォルダの上書き、symlink、除外対象の追加指定を拒否。
- Git履歴、archive、旧二重設計フォルダ、未指定の未追跡ファイル、環境設定、認証情報、node_modules、build、テスト生成物を移行フォルダから除外。archiveへのMarkdownリンクは説明ラベルへ変換。
- READMEに最短の起動手順とライセンス・報告窓口を追加し、PWA・テスト範囲の古い説明を更新。
- 既存のloopback Host制限、mockの環境例、有料API初期OFF、CI / Dependabotを維持。本文編集・保存・AI providerの動作は変更していない。

## 公開前に所有者が行うこと

1. **素材の出所を確認する。** `public/icons/source.svg` と派生PNGをApache-2.0で配布できる権利を保有していることを確認する。SVG・生成コード・Git上の経緯は調査済みだが、外部素材の不使用を自動検査だけで断定していない。
2. **外部AI連携の条件と実動作を確認する。** [外部サービス確認](PROVIDER_DISTRIBUTION_REVIEW.md) の残件、とくにClaude CLIの製品内実行条件・Commercial Terms・認証方法の扱いを確認する。ChatGPTの現行登録／推論仕様、アカウントの利用可能モデル、実CLIのフラグも確認する。実アカウントのサインイン→生成→キャンセル→ログアウトは今回未実施。条件が解消しない連携は、公開前に提供範囲を別途決定する。
3. **実機を確認する。** Windows / macOSの日本語IME、候補確定中のショートカット、キーボードのみの操作、スクリーンリーダー、対応を案内する端末のPWA・休止復帰を確認する。未実施の機能を検証済みと表示しない。プレビュー表記と、スマホ接続・製品同期が未提供という説明を維持する。
4. **移行フォルダの内容を目視する。** 原稿・バックアップ・個人メール・秘密情報・環境ファイル・旧リポジトリの履歴がないことを確認する。検査で値を表示せず確認していても、任意名の機密ファイルを完全に判定できるわけではない。既存の原稿がある場合は更新前に全作品バックアップを保存する。
5. **新しいprivateリポジトリでCIを確認する。** 下記の手順で新しい履歴を開始する。実APIキー・原稿・認証tokenをGitHub SecretsやCIへ追加する必要はない。最終内容で依存監査とCIを通す。ローカル成功をGitHub Actions成功とは扱わない。

## 新リポジトリへ移す手順

移行用フォルダ `AIfude_novel_editor/` の中身だけを使用する。圧縮ファイルを使う場合は、隠しファイルを含めて展開する。ファイルマネージャーで一部だけ選ぶと `.github` / `.env.example` / `.node-version` 等が欠落するため、フォルダ単位で扱う。

古い `.git`、node_modules、`.next`、`.env.local`、認証ディレクトリはコピーしない。古い履歴のmerge・mirrorも行わない。

以下は**所有者が公開準備を確認した後に実行する手順**。今回の作業では実行していない。

```sh
cd /path/to/AIfude_novel_editor
# ZIP展開ツールが実行属性を落とした場合のみ必要
chmod +x start-editor.sh start-editor.command

git init -b main
git config user.name 'marc2825'
# GitHub Settings → Emails に表示される正確なnoreplyメールへ置き換える
# 数字を含む形式もあるため、推測したメールを使わない
git config user.email 'YOUR_GITHUB_NOREPLY_EMAIL'
git add .
git diff --cached --stat
git diff --cached --check
# 内容・秘密情報・作者設定を確認してから実行
git commit -m 'Initial public source release'
```

GitHubで所有者marc2825の **AIfude_novel_editor** を空のprivateリポジトリとして作成する。README・LICENSE・gitignoreの自動生成を選ばず、準備済みファイルを使う。意図した所有者・URLを確認してから実行する。

```sh
git remote add origin https://github.com/marc2825/AIfude_novel_editor.git
git push -u origin main
```

初回CIを確認し、登録ファイル、初回コミットの作者／メール、CIログ、License表示をレビューする。公開を決めるまではprivateを維持する。新リポジトリのソース公開は、アプリserverの公開デプロイを意味しない。

## 公開切替時のGitHub設定

- Dependabot alerts / security updates、secret scanning、push protection、mainの保護ルールと必須CI（verify）を設定する。プランと公開範囲による利用可否を確認する。
- Private vulnerability reportingは [GitHubの公式案内](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configure-for-a-repository) でpublicリポジトリ向けの機能。private段階で有効化済みと扱わず、公開切替と同じ作業で有効化する。
- `https://github.com/marc2825/AIfude_novel_editor/security/advisories/new` で報告先を確認し、[SECURITY.md](../SECURITY.md) の未開設表示を更新する。窓口を確認するまでリリース告知をしない。有効化できなければ公開を戻すか、所有者が利用できる非公開窓口を決める。
- Description / Topics / プレビュー表示を整える。GitHub上のCI完走後にのみ、公開先で検証済みと記載する。

## 書き出しを再現する

書き出し元の外に、存在する親ディレクトリと未使用の出力フォルダ名を指定する。スクリプトはGitの初期化・index変更・commit・pushを行わない。

コミット済みHEADだけを渡す場合：

```sh
node scripts/export-public.ts /path/to/new/AIfude_novel_editor
```

今回のように未コミットの修正も含める場合：

```sh
node scripts/export-public.ts /path/to/new/AIfude_novel_editor --working-tree --include=LICENSE --include=NOTICE --include=docs/THIRD_PARTY_LICENSES.md
```

`--working-tree` はHEADに含まれる配布対象ファイルの現内容を読む。新規ファイルは `--include=相対パス` で一つずつ明示する。未指定の新規ファイルは、stageされていても自動では含まれない。追跡ファイルの削除やsymlink化はエラーとして止まる。文書内の個人パス・一部メールドメインは検出するが、秘密情報を完全に検出するスキャナーではない。

依存導入・build・テストは**移行フォルダの独立コピー**で行う。検査後のnode_modulesやbuildを配布物へ戻さない。現在の全コマンドは [開発手順](DEVELOPMENT.md) を参照。

## 今回の検査結果

2026-11-15、移行ソースの独立コピーで実行。Node.js 24.21.0 / pnpm 10.34.5、Linux。下表は今回の実測であり、過去の公開候補やarchiveの結果は流用していない。製品コード・テスト・設定は検査後に変更していない（この結果欄などの文書更新のみ）。

| コマンド・検査 | 結果 |
|---|---|
| `pnpm install --frozen-lockfile --offline` | 成功。既存キャッシュから固定依存を導入 |
| `pnpm audit --json` | 成功。550依存、全severity 0件 |
| `pnpm licenses list --json` | 確認済み。[申告ライセンス一覧](THIRD_PARTY_LICENSES.md) に整理 |
| `pnpm check` | 型・lint成功。84ファイル / 1,084テスト成功 |
| `pnpm exec vitest run tests/unit/public-export.test.ts tests/integration/public-export.test.ts` | 元の作業ツリーで40件成功。全体のcheckでも同じテストを実行 |
| `pnpm build` | 成功。PWAの公開静的資産24件を生成 |
| `pnpm test:e2e` | 104件成功（標準70、privacy 1、local 2、ChatGPT mock 2、比較6、モバイル23） |
| `pnpm test:e2e:pwa` | 5件成功（Chromium 3、WebKit 2） |
| `pnpm test:e2e:sync` | 2件成功。E2E合計111件 |
| `git diff --check` | 成功 |
| 配布内容の確認 | 344ファイル。相対Markdownリンクの欠落0件。旧Git履歴のメール・個人パス・旧リポジトリURL・代表的な秘密鍵／token形式の検出0件 |
| ライセンス・整合性 | LICENSEがApache公式テキストと一致。元のsrc / public / lockfile、Git indexを変更していない |

環境上の初回失敗：sandbox内のGit子プロセス起動（EPERM）とnpm監査の名前解決が制限され、許可された実行経路で再実行した。WebKitの最小起動確認は共有ライブラリ不足で失敗し、Ubuntu配布パッケージを一時ディレクトリへ展開して解消した。最終のWebKit smokeとPWA E2Eは成功。ブラウザー検査には一時的な `LD_LIBRARY_PATH` と `NOVEL_WEBKIT_EXECUTABLE` を使用し、OS設定・製品コード・Playwright cacheを変更していない。

install時の `unrs-resolver` build script未許可、開発モードのCSPによるReact eval警告、色指定の警告は残る。lint・build・上記テストは成功しており、警告を消すための一括スクリプト許可やCSP緩和はしていない。

未実施：GitHub上のCI、実AIアカウント・課金API、実機IME、macOS / Windows GUI起動、実スマホのPWA・スクリーンリーダー。自動E2Eの成功で代替しない。

## 変更ファイルとAcceptance Criteria

- ライセンス：`LICENSE`、`NOTICE`、`package.json`、`docs/THIRD_PARTY_LICENSES.md`。所有者の指定を反映し、第三者ライセンスと素材の未確認範囲を分離した。
- 配布境界：`scripts/export-public.ts`、`tests/unit/public-export.test.ts`、`tests/integration/public-export.test.ts`。修正を含む書き出し、未指定ファイルの除外、symlink・不正パス・上書きの拒否、元のGit状態の保持を検証した。
- 公開手順：`README.md`、`SECURITY.md`、`docs/PUBLISHING.md`、`docs/DEVELOPMENT.md`、`docs/PROVIDER_DISTRIBUTION_REVIEW.md`。起動、移行、公開切替、外部確認の手順を更新した。
- 決定記録：`docs/BRANDING.md`、`docs/DECISIONS.md`、`docs/IMPLEMENTATION_PLAN.md`。Task 20.3、名称、Apache-2.0、書き出し方針を記録した。

ソース一式の提供と自動検査は完了。公開判断には上記の所有者確認とGitHub側の作業が残る。次のTask、commit、push、公開操作には進まない。

## 公開後でもよい改善

長いcomponentの整理、フォーマッタ、ランチャーのbuild再利用、英語文書、クラウドAPIの429専用表示、静的PWAと整合するCSP nonce化は別Taskで扱う。認証・クラウド同期・モバイルserver公開などを公開準備に混ぜない。
