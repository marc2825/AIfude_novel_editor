# 名称と互換性

製品名は **AIFUDE（合い筆）**。人が書く文章にAIの提案を合わせる、という意味を込めた名前です。2026-11-13に所有者が指定しました。

| 用途 | 表記 |
|---|---|
| 画面、ブラウザータイトル、起動メッセージ | AIFUDE |
| 名称の説明 | AIFUDE（合い筆） |
| PWAとホーム画面 | AIFUDE |
| 新規認証で使うアプリ表示名 | AIFUDE |
| npmパッケージ名 | aifude |
| GitHubリポジトリ | AIfude_novel_editor |

## 内部名を変えない理由

保存先の名前まで変えると、既存の原稿や認証情報が見つからなくなります。そのため、次の識別子は従来の名前を使います。

- IndexedDB：`novel-ai-editor`
- Web Lock：`novel-editor:workspace`
- UI状態：`novel-editor-ui-v1`
- 設定・認証の既定ディレクトリ：`~/.local/share/novel-ai-editor/`
- 起動ロック：`.novel-editor-launcher.lock`
- バックアップのkind・schema・ファイル名、Service Workerのキャッシュ名、起動確認用の識別子
- [固定契約のテスト用ファイル](../tests/fixtures/contracts/)

改名によるデータ移行はありません。提供元に登録済みのアプリ名は、新しい表示名へ自動では変わりません。

## 改名時の確認

2026-11-13、Linux / Chromiumの独立コピーで確認しました。現行版と当時の公開用コピーでinstall・型・lint・テスト・buildが成功し、タイトル・PWA・オフライン画面の表記と内部識別子を照合しています。実AI登録・実機IME・OSへのPWAインストール・全E2Eは、その改名検査の対象外でした。

以前の名前と変更理由は [決定記録](DECISIONS.md) に残しています。ライセンスは2026-11-18の指定によりPolyForm Noncommercial License 1.0.0です（それ以前はApache-2.0）。著作権者はmarc2825です。
