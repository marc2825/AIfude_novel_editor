# AIFUDE（合い筆）の製品名

2026-11-13、所有者の指定により改名した。「合い筆」と読み、人間の執筆にAIの提案を合わせる小説エディタの名前として使用する。

| 用途 | 表記 |
|---|---|
| 画面・ブラウザータイトル・起動メッセージ | AIFUDE |
| README・名称の説明 | AIFUDE（合い筆） |
| PWAのname / short_name・Appleホーム画面名 | AIFUDE |
| 新規認証時に渡すアプリ表示名 | AIFUDE |
| package.jsonのname | aifude |

## 既存データとの互換性

改名で原稿や設定が見えなくならないよう、以下の内部識別子を維持する。

- IndexedDBの`novel-ai-editor`、Web Lockの`novel-editor:workspace`、UI状態の`novel-editor-ui-v1`。
- サーバー設定・認証の既定ディレクトリ`~/.local/share/novel-ai-editor/`と既存の環境変数名。
- バックアップ・移行ファイルのkind・schema・ファイル名とservice workerのcache識別子。
- 起動済みprocessを照合するhealth識別子と`.novel-editor-launcher.lock`。
- 固定スキーマの検査fixtureの内容（`tests/fixtures/contracts/`）。

保存schemaの移行は行わない。既存のprovider側のアプリ登録が以前の名前を保持する場合は、この変更だけでは登録を更新しない。改名時点ではライセンス未設定だったが、2026-11-15に所有者がApache-2.0、著作権者marc2825を指定した。新リポジトリ名は `AIfude_novel_editor`。製品表示とpackage名は上表を維持する。

## 過去の名称変更と今回の検証

以前の名称と検査記録は`DECISIONS.md`、Task 19.1、archiveに残す。以下は今回の改名だけの結果を記録する。

今回の改名は独立コピーで検証し、元の作業ツリーへビルド結果やブラウザーデータを持ち込んでいない。

| 検査 | 結果 |
|---|---|
| `pnpm install --frozen-lockfile --offline` | 現行版・公開用フォルダ版とも成功。依存バージョンとlockfileは維持 |
| 現行版の`pnpm check` | 型・lint成功、84ファイル / 1,066テスト成功 |
| 公開用フォルダ版の`pnpm check` | 型・lint成功、81ファイル / 1,014テスト成功 |
| `pnpm build` | 両版で成功。PWAの静的資産生成も成功 |
| 現行版の既存E2E | bootstrap・Host境界の2件成功。AIFUDEのタイトルと見出しを確認 |
| 公開用フォルダ版の既存E2E | bootstrapの1件成功。AIFUDEのタイトルと見出しを確認 |
| PWA本番生成物 | 両版のmanifest name / short_name、Appleホーム画面名、offline titleがAIFUDEで一致 |
| データ互換性 | DB・保存形式・ロック・認証先・healthの識別子とlockfileが変更前と一致 |
| main / jpの照合 | 追跡されたsrc / scripts / tests / publicが一致。jp単独のテスト再実行は行わず、同じコードを現行版で検証 |
| 文書と表記 | 現行ソースに以前の表示名を検出せず。変更した文書の相対ファイルリンクは有効 |

Node.js 24.21.0 / pnpm 10.34.5、Linux / Chromiumで実行した。ブラウザーには既存の検証用共有ライブラリを指定。実AI登録・文章品質・実機IME・PWAの実OSインストール・全E2Eの再検証は行っていない。新規認証時の表示名はmockの既存テストで確認した。
