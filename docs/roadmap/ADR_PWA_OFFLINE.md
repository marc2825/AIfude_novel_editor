# Phase 5：PWAとオフライン復旧

2026-10-28の設計。P-01〜05、M-04/07を対象とし、Workspace v6 / DB v4を維持する。

## 保存する画面

通常の `/` はAI設定を読む動的画面なのでキャッシュしない。`/offline` はサーバー設定・認証情報を読まない静的な画面とし、同じWorkspaceAppでIndexedDBの原稿を開く。AIは無効で始める。

利用者が準備を指示すると、Service Workerがビルド時に列挙した静的資産・画面・manifest・アイコンだけをcredentialなしで取得する。動的HTML、API、AI応答、本文、認証情報はCacheStorageへ入れない。準備に失敗したら不完全なキャッシュを消し、旧Service Workerを残す。

## 更新と復旧

新しいService Workerで `skipWaiting` や強制再読み込みはしない。古いタブが閉じて自然にactivateした後で、古いキャッシュを片付ける。原稿はキャッシュでなく、検証したIndexedDBとバックアップから復元する。

`navigator.onLine` の切断通知で生成・比較・辞書・Feedbackを無効にし、候補を期限切れにする。送信直前にも接続を確認する。復旧時にAIを自動再送しない。通常画面へ戻る操作は、利用者の指示と保存成功を待つ。

IndexedDBはreadwriteトランザクションにstrict durabilityを指定し、`transaction.done` の後で保存済みと表示する。`persist()` の結果もそのまま示す。OSによる削除まで防げるとは案内しない。

## 検査

キャッシュの許可リスト・認証情報の除外・更新失敗、オフラインでの編集・再読み込み・ブラウザー再起動・Chromiumクラッシュ後の復元、復旧時の無断AI送信がないことを検査する。キャッシュ消去後も、更新操作で資産を準備し直せることを確認する。動的な画面を代用キャッシュには使わない。

WebKitの `setOffline(true)` ではService Workerのnavigation自体が失敗する症状を再現した（[upstream #42775](https://github.com/microsoft/playwright/issues/42775)）。両エンジンの復元試験には、ループバック中継のsocketを切断する通信障害を使う。切断通知と候補の失効は別に試験する。

Chromium / WebKitの自動検査を、iOS SafariやOSへのホーム追加、実機IME、休止・容量不足の結果とは扱わない。参考：[Next.jsのPWAガイド](https://nextjs.org/docs/app/guides/progressive-web-apps)。
