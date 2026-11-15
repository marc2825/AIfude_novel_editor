# Phase 5: PWAとオフライン復旧

2026-10-28。P-01〜05、M-04/07。Workspace v6/DB v4を維持。変更予定: manifest/icon、静的offline route、build時の資産manifest、Service Worker、接続状態UIとAI送信境界、IndexedDB durability、production Chromium/WebKit E2E。

- `/`は従来通り動的AI実行設定を読み、キャッシュしない。`/offline`はサーバー設定/credentialを一切読まない静的shellで同じWorkspaceAppを起動し、IndexedDBの既存原稿をロードする。初期AIは利用不可。
- オフライン利用の有効化は明示操作。SWはビルドで列挙した静的assetとoffline shell/manifest/iconだけをcredentialなしで取得する。navigationの動的HTML、API、AI応答、本文、認証データはCacheStorageへ入れない。読み込み失敗したinstallは不完全なcacheを削除し、旧SWを維持。
- 新SWでskipWaitingや自動reloadをしない。古いタブが閉じて自然にactivateした後だけ旧cacheを掃除する。本文はcacheから復元せず、検証済みIndexedDBとバックアップを正とする。
- navigator.onLineの切断通知でAIの生成/比較/辞書/Feedbackを無効化し、進行中の候補を失効させる。クライアント送信境界でも接続を確認。復旧してもAIの再実行はしない。offline shellからのオンライン接続復帰は明示操作で保存成功後に通常画面へ戻る。
- IndexedDBのreadwrite transactionはstrict durabilityを指定し、保存完了の通知はtransaction.done後。persist()の結果を正直に表示し、OSによるデータ削除まで防げるとは主張しない。
- テスト: SWのallowlist/credential omit/更新失敗/キャッシュ漏洩、offline編集→reload→ブラウザ再起動/Chromium crash、復旧後の無断AI再送なし、2つのブラウザengine、既存全回帰。OSのホーム画面install/IME/休止・容量圧迫はNOT RUN。

参考: [Next PWA](https://nextjs.org/docs/app/guides/progressive-web-apps)。使用APIは固定されたローカル依存の型と本番E2Eでも検証する。実サービスの公開・認証作成・デプロイは行わない。

実装補足: navigation失敗時はURLを書き換えず静的offline shellを返す。キャッシュが退避/消去されても明示的な更新操作で静的資産を再準備できる。秘密を含む動的画面をfallbackへ使わない。

WebKitのPlaywright `setOffline(true)` はSW navigation自体をinternal errorにする既知の問題があり、[upstream #42775](https://github.com/microsoft/playwright/issues/42775)と同じ症状を再現した。両engineの再読込/再起動試験はloopback中継のsocketを切断する実通信障害で検証する。`navigator.onLine`の切断通知と候補失効は別の両engine試験で検証する。iOS Safariの実機結果とは扱わない。
