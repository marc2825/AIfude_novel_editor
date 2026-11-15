# ChatGPTサブスク連携の変更案

状態：2026-10-14に承認済み。まずChatGPTから対応し、他providerへの自動切替を行わない。Phase 11 / Task 11.1として実装する。

## 目的と対象

ローカルLLMに代わる主な推論先として、ChatGPTの契約済み利用枠を使う。最初の対象はChatGPT Plus / Proとする。他社のサブスク対応は、そのサービスの公式認証・推論仕様を確認した個別Taskとする。

OpenAI公式ガイドは、ローカルで動く個人用アプリもSign in with ChatGPTのplan usageの対象として説明している。API keyを使う既存のOpenAI providerとは認証・利用枠が異なる。アカウントの利用可否・モデル・残量は実際の認証結果で確認する。

参照：[公式Cookbook](https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt)、[plan usage概要](https://developers.openai.com/siwc/token-sharing-open-source)。

## 既存仕様との衝突と提案

| 現在の仕様 | 公式サブスク接続の条件 | 変更案 |
|---|---|---|
| 非streamingで完全な応答を受信する | HTTPの推論requestは`stream: true`が必須 | server adapter内だけSSEを受信し、正常な完了イベントと全候補の検証後に、既存のJSON API responseを返す。画面へ途中の候補を流さない。 |
| providerへ`max_output_tokens`を指定する | このフィールドは未対応 | この接続だけtoken数の固定上限を保証しない。時間、実測受信量、候補数・候補文字数を制限する。上限到達時はabortし、途中の出力を採用しない。 |
| server用API keyは環境変数だけに置く | OAuthのaccess / refresh tokenとhost IDの管理が必要 | 認証情報はserver専用の保護されたlocal storageへ保存する。本文のIndexedDB、workspace JSON、browser storage、client bundleへ渡さない。 |

サブスク利用は無制限を意味しない。送信済み処理の停止・使用量の回収を保証しない。利用枠不足、認証失効、接続失敗で従量課金APIへ自動切替しない。

この変更はD-010とAI_EDITINGのprovider契約に関係する。ユーザーからserver内のstream受信と、固定出力token上限を使わない方式への変更の承認を得た。

参照：[previewのAPI制限](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)、[推論と完了判定](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)。

## 接続設計

1. 設定画面からユーザー操作で「Continue with ChatGPT」を実行する。アプリ自身のログイン・ユーザー管理機能は追加しない。
2. serverでhost ID、試行ごとのstate / nonce / PKCEを用意する。OpenAIへの認証URLを生成し、本文を認証URLへ含めない。
3. `127.0.0.1`のcallbackでstateと発行client IDを確認し、codeをserver内で交換する。ID tokenの署名・issuer・audience・期限・nonceと、plan usage用scopeを検証する。
4. 最小の単一アカウント接続を保存する。再認証・refresh・接続解除を用意し、接続変更で既存のAI sessionを無効化する。
5. 認証されたアカウントのmodel catalogで、使用modelが利用可能かserver側で確認する。既存のAPI用model一覧をサブスクの利用可能一覧とみなさない。
6. 外部送信の表示と明示同意を経て、選択範囲と既存のbounded contextだけを送る。認証の成功だけで本文送信を開始しない。
7. Responsesの`response.completed`を受信した場合だけ、通常のschema / business validation、request ID照合、stale、Previewへ進む。usage制限の失敗が途中で届いた場合は候補を破棄する。

cookie転用、非公開のChatGPT endpoint、既存Codexの認証情報の流用は用いない。

参照：[登録と認証](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)、[アカウントとセッション](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)。

## 実装時に変更する範囲

- server：ChatGPT OAuth、認証情報保存、subscription provider、HTTP認証route、既存config / factory / service。
- domain / UI：接続表示、外部送信同意、runtime / model解決、認証変更時のsession無効化。
- 設定と文書：サブスクを主な接続とする設定例、起動・認証手順、Implementation Planの新Task、関連仕様とDecision。
- テスト：認証とproviderのunit / integration、接続・解除のcomponent、中心UXのE2E。

## 提案するAcceptance Criteria

- API keyなしで、公式のChatGPT認証を開始・完了・再認証・解除できる。
- tokenをclientや本文バックアップへ出さず、不正state・不正ID token・権限不足を拒否する。
- アカウントに許可されたmodelだけを使用し、API providerとの利用枠の違いを表示する。
- 同意前の本文送信は0回。利用枠不足・接続失敗で別providerを呼ばない。
- server内の途中応答はUIへ表示せず、受信上限・時間切れ・不正JSON・拒否・未完了を正常な失敗として扱う。
- abortを無視する遅延応答と、認証切替後の古い応答を破棄する。
- Accept以外で本文を変更せず、範囲置換、stale、Undo/Redo、編集と保存を維持する。
- typecheck、lint、関連Vitest、build、E2Eを実行する。実際のサブスク認証・実推論・OSのIMEの未検証を区別する。

## 承認事項

- 複数providerを希望するが、今回のTaskではChatGPTから対応する。
- server内のstream受信と、API側の固定出力token上限を使わない方式への仕様変更。
- 利用枠不足・認証失効・接続失敗で別providerへ自動切替しない。

本文保存schemaとeditor mutationは変更しない。他社サブスクの未使用adapterを先行実装しない。
