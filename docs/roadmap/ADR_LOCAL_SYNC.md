# Phase 6: 原稿同期のローカル基盤

2026-10-28。C-01〜08。インターネット用認証/接続先/HTTPS配備は未決定であり、本番画面からネットワーク同期を有効にしない。認証情報の発行・クラウド契約・サーバー公開は行わない。ローカルで検証できる契約・永続化・競合保護・UIを実装する。

## 契約と移行

- WorkspaceSnapshot v6を維持。IndexedDB v4→v5では同期状態storeだけを追加し、旧原稿を変換/削除しない。v1〜v5 workspaceの読み込み・backup復元は既存migrationを使用する。
- SyncPayload v1は作品/全章/メモリ/authoring profile/文体/執筆設定/保存履歴50件以下の明示whitelist。AI同意、モデル接続設定、credential、UI位置、local storageVersionは含めない。ユーザー自身が本文/メモへ書いた文字列の秘密検出は保証しない。
- 10MiB上限をclient/serverで検査し、履歴や章を黙って省略しない。不正schema/ID参照/重複/将来versionは拒否する。章は順序を正規化し、現在開いている章だけの差で同期しない。
- サーバーは作品単位のrevision CASを使う。全章を原子的にcommitすることで章とメモリの整合性を維持する。章単位の独立merge/CRDTは未実装。

## 永続送信と競合

- 同期は初期OFF。明示的に保存済みの原稿から送信待ちを作り、pending requestはoperation IDごとに不変とする。待機中の新しい編集は通常の自動保存へ継続し、前のack後に次の原稿を準備する。通信復旧は原稿送信の同意ではなく、再実行は明示操作。
- pending/ack/競合コピーはIndexedDBのstrict readwrite transactionでCAS。main原稿/履歴を同一transactionで読み取ってstageし、Web Locksを同期プロトコルへ持ち込まない。現在のeditor writer保護には既存Web Locksを維持する。
- ackは現在のpending IDと照合する。古い/重複/順序逆転した応答は新しいpendingを変更しない。切断/認証切れ/timeout時は同じoperation IDで再実行し、サーバーreceiptで重複commitしない。
- CAS競合では送信した原稿とサーバー原稿を同じtransactionで保存し、自動上書き/自動mergeしない。両方をプレビューし、既存の原子的library importでコピーとして復元できる。競合解決後の送信準備は明示選択。サーバー側が更に進めば再び競合として保持する。
- 同期コピーは20件まで。上限到達は保留して失敗を表示し、未確認コピーを自動削除しない。確認済みコピーの明示削除はsequence CASで行い、競合未解決中は削除不可。コピー/送信待ちの内容を移行ファイルへ書き出せる。通常のworkspace/library backupに同期状態そのものは含めず、必要なコピーを作品として復元してbackupする。
- 作品を通常削除してごみ箱へ移した段階では同期状態を残す。最後の作品/ごみ箱コピーを完全削除するtransactionで、その作品にだけ残るoutbox/同期コピーも削除する。サーバー削除には変換しない。
- 初期提供の受信適用はコピー復元。編集中の正本をリモート応答から差し替えない。既存作品への自動反映、周期的background sync、同期削除/tombstoneは未実装。端末削除をサーバー削除として送らない。

## サーバー/セキュリティ境界

- Node 24のSQLiteを使うローカル検証用service。BEGIN IMMEDIATE、WAL、synchronous FULLでrevision更新/receipt/過去改訂を原子保存し、別connectionからのCASにも対応する。失敗時はROLLBACK。IDは検証しSQL値はparameter binding。
- SQLite schemaはuser_version=1、未知versionを拒否。暫定上限はaccountごと100作品/1,000 receipts/100MiB。古いreceiptや改訂を勝手に消して再送の安全性を失わず、上限で新規commitを拒否する。実運用のretention設計は未確定。参照: [Node 24 SQLite](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html)、ローカルNode 24.21.0型/実行でも検証。
- principalは認証済みadapterからのみ渡し、request bodyにaccount/ownerを置かない。accountで作品/receiptを分離する。未認証、別account、異なるpayloadで同じoperation ID、不正base revisionを拒否する。公開routeは作らない。
- HTTP transportは同一origin・HTTPSを条件とし、test fixtureだけloopback HTTPを許可。credentialはcookie/認証adapterの責任でpayloadへ入れない。redirect禁止、no-store、応答上限・timeout・遅延応答照合。fixtureはOrigin/header/content-typeとテスト用sessionを検証する。
- E2EE/ゼロ知識は未実装。サーバー管理者が原稿を読める設計。暗号化保管、鍵管理、account回復/端末失効、cookie発行/CSRF方式、rate limitと保管容量の運用値、HTTPS終端の選定後に別セキュリティ審査が必要。

## 検証計画

secret whitelistと旧backup migration、2つのIDB connection/SQLite connectionのCAS、応答喪失後のreplay、認証失効/再認証、順序逆転、不正request、競合2コピー、quota/transaction失敗、プロセス再open、2 browser profileのoffline編集・再送・コピー復元を検証する。実クラウド・iOS/Android実機はNOT RUN。C-02/04/08の公開運用を含む判定はPARTIAL/NO-GOのままにする。
