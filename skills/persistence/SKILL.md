# Local Persistence Skill

## いつ参照するか

IndexedDB、hydration、自動保存、バックアップ、import、削除、別タブ制御を変更するとき。

## 守るべき原則

- 保存失敗でメモリ本文を消さない。
- 読み込み失敗を空データと同一視しない。
- 書き込み順序を直列化する。
- storage versionは同一transactionで比較更新する。
- 1つのworkspaceにwriterは1つ。
- 未確認のmigrationでデータを削除しない。

## 実装パターン

1. Web Lock取得結果を確認する。
2. 保存データを読み、schemaと参照IDを検証する。
3. 検証完了後にeditorを初期化する。
4. document変更ごとにdirty sequenceを増やす。
5. debounceと最大待機を使って最新snapshotを保存する。
6. 最新sequenceまで保存された場合だけ保存済みとする。
7. 保存失敗時は未保存表示と書き出しを提供する。

importでは現在データの保護、上書き確認、schema検証、同意reset、editor instance更新を行う。

## やってはいけないこと

- React componentから直接IndexedDBへ書く。
- unload時の非同期保存を完了保証として扱う。
- 複数の保存promiseを無制御に並列実行する。
- 古い保存完了でdirty状態を消す。
- 未対応versionを初期化して上書きする。
- APIキーや候補をworkspaceへ混入させる。
- Web Locks非対応時に無条件で書き込みを許可する。

## 完了条件

- 保存とreloadが一致する。
- 保存順序の逆転を防げる。
- quota errorでもメモリ本文が残る。
- 別タブが上書きできない。
- backup/importがround tripする。
- 不正importで現在データが変更されない。

## 関連文書

- `docs/ARCHITECTURE.md`
- `docs/DATA_MODEL.md`
- `docs/SECURITY.md`
