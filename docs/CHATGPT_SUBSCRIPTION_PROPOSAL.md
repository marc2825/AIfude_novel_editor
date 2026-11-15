# ChatGPT連携で変更した設計

2026-10-14に承認したTask 11.1の記録。連携は実装済みで、ここには導入時の判断を残す。現行の設定は [接続ガイド](AI_CONNECTIONS.md)、利用条件の残件は [配布前の確認](PROVIDER_DISTRIBUTION_REVIEW.md) を参照する。

## 目的

ローカルアプリから、利用者のChatGPTの利用枠で推敲できるようにする。最初の対象はPlus / Pro。APIキー方式とは認証・利用枠が異なり、モデルの利用可否はアカウントの認証結果で確認する。

参照：[公式Cookbook](https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt)、[plan usage](https://developers.openai.com/siwc/token-sharing-open-source)。

## 変更した仕様

| 従来 | ChatGPT連携での扱い |
|---|---|
| 完全な応答を受け取る非ストリーミング方式 | 必須の `stream: true` に対応するため、サーバー内でSSEを受ける。完了と候補の検証後にJSONを返し、途中結果は画面に出さない |
| `max_output_tokens` で出力を制限 | このフィールドは未対応。時間・受信量・候補数・文字数で制限し、上限到達時は中止して途中出力を捨てる |
| APIキーをサーバー環境変数で管理 | OAuthのトークンとhost IDは、リポジトリ外の保護したファイルで管理する |

D-010の例外として、サーバー内のストリーム受信と固定出力トークン上限を使わない方式が承認された。サブスクリプションでも利用は無制限ではなく、中止で使用量が戻る保証もない。利用枠不足や接続失敗で別のAIへ切り替えない。

参照：[プレビュー制限](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)、[推論と完了判定](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)。

## 認証から生成まで

1. 利用者が「Continue with ChatGPT」を押す。サーバーでhost ID、state、nonce、PKCEを用意する。
2. 公式フローで認証し、ループバックcallbackでstateとclient IDを確認してcodeを交換する。ID tokenの署名・issuer・audience・期限・nonce・必要scopeを検証する。
3. 単一アカウントの接続を保存する。再認証・refresh・解除で既存のAIセッションを無効にする。
4. アカウントのモデルカタログを確認し、本文の外部送信に同意を得て生成する。認証だけでは本文を送らない。
5. `response.completed` を受け、候補検証とリクエストID照合が通った結果だけを返す。古い結果や利用枠エラーの途中出力は捨てる。

独自ログイン、cookieの転用、非公開endpoint、既存Codexの認証情報は使わない。トークンはブラウザー、本文のIndexedDB、バックアップ、ログへ渡さない。

参照：[登録と認証](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)、[アカウントとセッション](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)。

## 導入時の検査条件

不正な認証、権限不足、同意前の送信、上限超過、拒否、不正JSON、未完了を拒否する。中止を無視した遅延応答や認証変更後の応答も捨てる。採用以外で本文を変えず、範囲置換・Undo/Redo・保存を維持する。

認証・プロバイダー・接続画面のunit / integration / componentテスト、型・lint・build・E2Eで確認する。実サブスクリプションの認証・生成と実機IMEは別に記録する。本文の保存形式は変えず、他社の未使用アダプターは先行実装しない。
