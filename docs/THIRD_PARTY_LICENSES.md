# 第三者ライセンスと素材の確認

確認日：2026-11-15。`pnpm install --frozen-lockfile` の依存構成に対して `pnpm licenses list --json` を確認した。以下はインストール済みLinux x64向けパッケージが申告するライセンスであり、全OSのoptional依存やファイル単位の法的判断を保証する一覧ではない。

## 配布範囲

- 本配布物はAIFUDEのソース・文書・テスト・lockfileとPWAアイコンのみ。node_modules、Nextのbuild、Playwrightブラウザー、Claude CLI、認証情報は含めない。
- AIFUDEのライセンスは [PolyForm Noncommercial License 1.0.0](../LICENSE)、著作権表示は [NOTICE](../NOTICE)。2026-11-18より前に公開した版はApache-2.0。第三者パッケージのライセンスを変更するものではない。
- 実行可能bundle、Docker image、node_modules、ブラウザー、CLIなどを今後配布する場合は、その配布内容ごとに上流のLICENSE / NOTICE、組み込みコード、ソース提供要件を改めて確認する。今回のソース配布の確認を転用しない。

## 直接依存

| パッケージ | 固定バージョン | 申告ライセンス | 用途 |
|---|---|---|---|
| `@tiptap/core` | 3.31.3 | MIT | 実行 |
| `@tiptap/extension-document` | 3.31.3 | MIT | 実行 |
| `@tiptap/extension-paragraph` | 3.31.3 | MIT | 実行 |
| `@tiptap/extension-text` | 3.31.3 | MIT | 実行 |
| `@tiptap/pm` | 3.31.3 | MIT | 実行 |
| `@tiptap/react` | 3.31.3 | MIT | 実行 |
| `diff` | 9.0.0 | BSD-3-Clause | 実行 |
| `idb` | 8.0.3 | ISC | 実行 |
| `jose` | 6.2.12 | MIT | 実行 |
| `next` | 16.4.1 | MIT | 実行 |
| `openai` | 7.20.0 | Apache-2.0 | 実行 |
| `react` | 19.3.0 | MIT | 実行 |
| `react-dom` | 19.3.0 | MIT | 実行 |
| `zod` | 4.6.6 | MIT | 実行 |
| `@playwright/test` | 1.63.0 | Apache-2.0 | 開発・テスト |
| `@testing-library/dom` | 10.4.2 | MIT | 開発・テスト |
| `@testing-library/jest-dom` | 7.0.1 | MIT | 開発・テスト |
| `@testing-library/react` | 16.3.3 | MIT | 開発・テスト |
| `@types/node` | 24.13.5 | MIT | 開発・テスト |
| `@types/react` | 19.3.0 | MIT | 開発・テスト |
| `@types/react-dom` | 19.3.0 | MIT | 開発・テスト |
| `@vitejs/plugin-react` | 6.1.1 | MIT | 開発・テスト |
| `eslint` | 9.39.5 | MIT | 開発・テスト |
| `eslint-config-next` | 16.4.1 | MIT | 開発・テスト |
| `fake-indexeddb` | 6.2.5 | Apache-2.0 | 開発・テスト |
| `fast-check` | 4.10.1 | MIT | 開発・テスト |
| `jsdom` | 30.1.0 | MIT | 開発・テスト |
| `typescript` | 6.0.3 | Apache-2.0 | 開発・テスト |
| `vite` | 8.3.3 | MIT | 開発・テスト |
| `vitest` | 5.0.3 | MIT | 開発・テスト |

## 推移依存の集計

| 申告ライセンス | パッケージ数 |
|---|---:|
| 0BSD | 1 |
| Apache-2.0 | 27 |
| BSD-2-Clause | 9 |
| BSD-3-Clause | 4 |
| BlueOak-1.0.0 | 3 |
| CC-BY-4.0 | 1 |
| CC0-1.0 | 2 |
| ISC | 14 |
| LGPL-3.0-or-later | 1 |
| MIT | 375 |
| MIT-0 | 2 |
| MPL-2.0 | 3 |
| Python-2.0 | 1 |

上表はpnpmのライセンスレポートでまとめられたパッケージ単位の件数。監査の依存グラフ件数とは数え方が異なる。特に次の依存を含む実行物を再配布するときは、各パッケージのライセンス本文と同梱NOTICEを確認する。

| パッケージ | バージョン | 申告ライセンス |
|---|---|---|
| `@img/sharp-libvips-linux-x64` | 1.3.4 | LGPL-3.0-or-later |
| `axe-core` | 4.13.0 | MPL-2.0 |
| `lightningcss` | 1.33.0 | MPL-2.0 |
| `lightningcss-linux-x64-gnu` | 1.33.0 | MPL-2.0 |
| `caniuse-lite` | 1.0.30001810 | CC-BY-4.0 |
| `argparse` | 2.0.1 | Python-2.0 |

## 同梱素材

`public/icons/source.svg` は図形だけのSVGで、外部URL参照・埋め込み画像・フォントを含まない。3つのPNGは `scripts/build-icons.mjs` に同SVGからの生成手順がある。Git上の追加経緯と生成コードは確認したが、素材の権利・出所について所有者による最終確認は公開前TODOとして残す。第三者の画像・フォント・CLI バイナリーを追加同梱していない。

## 再確認

依存を変更した場合は、frozen install後に `pnpm licenses list` を再実行し、この一覧と配布内容を更新する。JSON出力にはローカルの絶対パスが入るため、生のレポートをリポジトリへ追加しない。
