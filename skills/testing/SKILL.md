# Testing Skill

## いつ参照するか

すべてのTaskで参照する。特に非同期、editor mutation、保存を変更するときは必須。

## 守るべき原則

- happy pathだけで完了しない。
- 実APIを通常CIへ入れない。
- abortが成功することを前提にしない。
- PMの実際のtransactionとhistoryを使って検証する。
- 自動IMEテストを実機確認の代替にしない。
- 実行していないテストを成功扱いしない。

## 実装パターン

- pure functionはunit test。
- PM stateとcontrollerはintegration test。
- UIの操作とfocusはcomponent test。
- 保存・keyboard・raceを含む中心UXはE2E。
- 非同期順序はdeferred promiseで制御。
- timerはfake clockで制御。
- テキスト置換はproperty-based testも使用。
- 失敗seedと実行条件を記録。

## やってはいけないこと

- 固定sleepだけでrace testを成立させる。
- snapshot testだけで本文範囲の正しさを判断する。
- 失敗テストをskipしてTaskを完了する。
- mockの都合に合わせて製品APIへテスト用parameterを追加する。
- テスト内で実APIキーを読む。
- テスト不存在をpassWithNoTestsで隠す。

## 完了条件

- selection取得、正しい位置への適用、stale防止、Undo分離、API failure、Retry raceの該当テストがある。
- 変更した境界の失敗経路を検証した。
- 関連検査の実行結果を記録した。
- buildまたはE2E未実行なら理由を明示した。

## 関連文書

- `docs/TESTING.md`
- `docs/DEFINITION_OF_DONE.md`
