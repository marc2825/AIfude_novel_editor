# 開発手順

## 環境と起動

Node.js `>=24.21.0 <25`、pnpm 10.34.5を使います。CIのNodeバージョンは [.node-version](../.node-version)、依存のバージョンは [package.json](../package.json) とlockfileで固定しています。

```sh
pnpm install --frozen-lockfile
pnpm dev
```

`http://127.0.0.1:3000` を開きます。AIなしでも編集・保存を試せます。デモ候補を使う場合は、起動前に `.env.example` を `.env.local` へコピーしてください。実AIの設定は [接続ガイド](AI_CONNECTIONS.md) を参照します。

本番相当の起動は `pnpm build` の後に `pnpm start` を実行します。`pnpm launch` はビルド・起動確認・ブラウザーの表示をまとめて行います。Nodeとpnpmを起動プロセスのPATHから使えるようにしてください。

URLやポートを変えるとブラウザー内の保存先も変わります。既存作品を移す場合は元のURLでバックアップを書き出します。サーバーはループバックで起動し、LANやインターネットへ公開しません。

## 検査

```sh
pnpm audit
pnpm check
pnpm build
pnpm exec playwright install --with-deps chromium webkit
pnpm test:e2e
pnpm test:e2e:pwa
pnpm test:e2e:sync
```

`check` は型検査・ESLint・Vitestを実行します。個別には `pnpm typecheck`、`pnpm lint`、`pnpm test` を使います。標準E2Eにはモバイル幅、PWAにはChromium / WebKit、同期にはローカルのテスト用サーバーを使います。

buildと各E2Eは同じ `.next` を使うため、順番に実行してください。ランチャー試験は3000番ポートを使います。原稿を保存して開発サーバーを止めるか、別の検証環境で実行します。実APIキーや実原稿は自動テストへ渡しません。実機IMEなどの手動項目は [テスト仕様](TESTING.md) にあります。

### よくある警告

`unrs-resolver` のビルドスクリプトをpnpmが無視したという警告が出ることがあります。対応するネイティブのoptional依存が使われ、lintが通るなら、その環境では検査できています。解決に失敗する場合はOS / CPUに合うパッケージを確認し、必要なスクリプトだけを検討してください。

開発中のReactはデバッグ用にevalを使うため、開発時だけCSPで許可しています。本番では許可しません。Nextの開発用バッジは下部ボタンに重なるため非表示です。コンパイル・実行時エラーは通常どおり表示されます。

## 変更する前に読む文書

[AGENTS.md](../AGENTS.md)、[要件](REQUIREMENTS.md)、[設計](ARCHITECTURE.md)、対象の [実装計画](IMPLEMENTATION_PLAN.md) を確認します。変更対象に応じた `skills/*/SKILL.md` を読み、完了時は [完了条件](DEFINITION_OF_DONE.md) と照合してください。設計判断は [決定記録](DECISIONS.md) に残します。

## OpenAI APIのモデルを追加する

1. 公式文書と対象アカウントで、モデルID、Responses API、Structured Output、出力上限、必要パラメーターを確認します。
2. `src/domain/ai-models.ts` に定義を追加します。既存のIDや既定モデルは勝手に置き換えません。
3. モデル定義・設定・プロバイダー・契約・同意のテストを更新し、`pnpm check`、build、privacy E2Eを実行します。[接続ガイド](AI_CONNECTIONS.md) の対応表記も更新します。
4. 実APIの検証は、課金を含めて許可を得た場合に行います。通常のCIには入れません。

ChatGPTの利用可能モデルは、API用の一覧とは別にアカウントのカタログで確認します。

## ソースを書き出す

公開用コピーは `scripts/export-public.ts` で作ります。既定ではコミット済みHEADを読み、`--working-tree` で作業中の内容、`--include=相対パス` で新規ファイルを追加できます。履歴や生成物はコピーしません。実行例と公開手順は [公開準備](PUBLISHING.md) を参照してください。
