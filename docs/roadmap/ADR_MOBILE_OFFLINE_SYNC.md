# ADR: レスポンシブWeb → PWA → 任意の認証済み同期

日付: 2026-10-26。Phase 1のレスポンシブ方針はユーザーの明示依頼により採択。後続のインフラ・暗号方式は提案であり実装承認ではない。

## 現在の判断

Next.js/React/TipTapを維持する。PCは中央本文と右パネル、狭幅では同じeditorとフォームを再配置する。drawerの開閉でunmountせずdraftを保持。AIは非modal sheet、本文は編集中も利用できる。タップ起動も既存capture→controller→同期Acceptへ接続する。native touch selectionを横取りせず、composition中は操作を拒否。blurやresizeで旧selectionを再設定しない。

viewportのCSS fallbackはdvh、実browserではVisualViewportのheight/offsetを使いキーボード表示に追従。safe-areaを予約しzoomを禁止しない。入力欄は狭幅で16px以上、主要targetは44pxを目標。スクロール中・回転でeditorを再生成しない。背景化のflushはbest-effortであり、OS killやstorage evictionへの保存保証ではない。

## 段階と境界

1. Phase 1は表示・操作のみ。loopback bind/APP_ORIGIN/資格情報/保存versionを維持。スマホ幅で動くことと実スマホからPCへ接続することは別。LAN公開で穴埋めしない。
2. Phase 5ではmanifestと静的app shellのみcache。API、AIのPOST/結果、認証、本文、backup、接続設定はCacheStorageに入れない。作品は既存IndexedDBに残す。静的shellが資格情報を埋め込まないことをbuildで検証。version付きcacheを事前検証してから切替し、未保存draftがある画面を強制reloadしない。新旧schema混在はwriter停止・backup案内。
3. Phase 6はlocal-firstの追加層。同期初期OFF、未接続/期限切れ/ネットワーク失敗でもローカル編集保存を継続。「ローカル保存済み」と「同期済み」を別表示。既存AI APIを公開同期APIへ転用しない。

## 同期方式の候補（未決定）

| 方式 | 利点 | 負担 / 採択条件 |
|---|---|---|
| 自己ホストのHTTPS+認証付き同期 | 保存先を管理できる、データモデルをCASへ合わせやすい | 証明書・更新・認証・backup・端末到達性を運用する必要 |
| 管理サービスの認証+DB | TLS/認証/運用の一部を委任 | 契約・費用・データ所在地・権限規則・vendor依存を評価。資格情報を自動作成しない |
| 明示backup移送 | 現在の安全な復元を利用、インフラ不要 | 自動同期ではない。併存コピーと重複をユーザーが管理 |

共同編集/CRDTは導入せず、作品/章revision・ETagを用いる楽観的CASを第一候補とする。ローカルoutboxのoperation IDで再送を冪等化し、base revision不一致ではサーバー版/端末版/共通祖先のメタデータを保持して競合提示。最終書込時刻による自動勝者選択はしない。解決は新revisionの明示保存、削除はtombstoneで期限と復元を設計。同期解除でlocal原稿を消さず、遠隔削除と端末削除を分ける。

## セキュリティgate

HTTPS、強い認証、作品ごとの認可、session失効/再認証、CSRF/Origin/Host、rate/容量制限、redirect/SSRF、ログ秘匿を別ADRで具体化。ブラウザーへprovider keyを渡さず、sync credentialを作品backupへ入れない。認証なし公開は不可。認証済みだから他作品へアクセスできるとはしない。

E2EEは未採択。TLS/サーバー保存時暗号化と区別する。採択するなら端末鍵配布・紛失復旧・rotation・metadata漏えい・バックアップ鍵まで定義し、未監査でゼロ知識/サーバー不可視を主張しない。

## 移行・検証・代案

Phase 1はmigrationなし。将来はIMPLEMENTATION_PLAN.mdの非破壊段階を先に実施。2つの分離browser profileとローカル認証fixtureでoffline同時編集、CAS競合、再送、期限切れ、削除/復元、quota、rollbackを検証してから実端末へ。native appは別schema/同期実装が増えるため今回採用しない。無認証LANや自動last-write-winsは原稿/認証情報を危険にするため採用しない。

スマホのAI画面上部の「本文へ」で指示・候補を保持して本文に戻り、「AI画面に戻る」で再表示できます。生成中も利用でき、本文や選択を変えた場合は保持中の候補を期限切れにします。閉じる操作はそのAIセッションを破棄します。
