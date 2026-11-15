# 開発と検査

Node.jsは `>=24.21.0 <25`、pnpmは10.34.5を使用する。CIの再現用バージョンは `.node-version`、依存は `package.json` / `pnpm-lock.yaml` を正本とする。

```sh
pnpm install --frozen-lockfile
pnpm audit
pnpm check
pnpm build
pnpm exec playwright install --with-deps chromium webkit
pnpm test:e2e
pnpm test:e2e:pwa
pnpm test:e2e:sync
```

標準E2EにはモバイルChromiumも含む。PWAはChromium / WebKit、同期はローカルfixtureを使用する。実APIキーや実原稿を自動テストへ渡さない。同じ `.next` を使うbuild・各E2Eは順番に実行する。実機IME、実モデル品質、スマホのホーム追加を自動テストの成功で代替しない。

`.env.example` はmockのデモ候補を使う。環境変数も保存済みAI設定もない場合はAI無効で、本文編集と保存を利用できる。主AI・比較を明示設定したときだけ実providerを使う。

## install警告

`unrs-resolver` のビルドスクリプトをpnpmが無視した旨の警告が出る場合がある。既定では任意の依存スクリプトを追加許可しない。対応するnative optional packageが使われ、lintが成功していればその環境では検査できている。解決失敗時はOS / CPU向けoptional依存の導入状態を確認し、必要なスクリプトだけ個別に検討する。警告の消去を目的に一括許可しない。

## OpenAI APIモデルを追加する

APIキーで利用するOpenAIモデルは `src/domain/ai-models.ts` のallowlistで管理する。ChatGPTサブスクのアカウント別カタログとは別である。

1. 公式モデル文書と実際のアカウントで、モデルID、Responses API、Structured Output、出力上限、必要パラメーターを確認する。
2. `src/domain/ai-models.ts` のモデル定義・IDを追加し、providerで扱えることを確認する。既存モデルIDや既定値を黙って置き換えない。
3. モデル定義・server config・provider・契約・同意の関連テストを更新し、`pnpm check` / build / privacy E2Eを実行する。READMEの対応表も更新する。
4. 必要なら別途、明示的に許可した実API検証を行う。自動テストで課金APIを呼ばない。

## 正本と公開候補

統合後はmainを正本とする。公開候補は `scripts/export-public.ts` で生成し、手作業で分岐させない。既定はコミット済みHEAD。未コミットの修正は明示的な `--working-tree`、新規ファイルは `--include=相対パス` で含める。新リポジトリ名は `AIfude_novel_editor`、Apache-2.0でソースを配布する。独立コピーでの検査・新しいprivateリポジトリへの移行・public切替の順序は [公開前TODO](PUBLISHING.md) に従う。内部レポート・旧プロンプトは配布から除外する。固定契約fixtureは `tests/fixtures/contracts/` にある。
