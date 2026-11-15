# Definition of Done

各Taskで、該当項目を確認する。

## Scope

- 依頼されたTaskだけを実装した。
- Acceptance Criteriaと変更内容を対応付けられる。
- 無関係なrefactor、依存更新、format変更がない。
- 将来機能の空実装、未使用interface、dead codeがない。
- 未コミットの既存変更を壊していない。

## Code

- TypeScript strictが通る。
- lintが通る。
- 境界で外部入力を検証している。
- 不要な`any`や型assertionがない。
- server moduleがclient bundleへ混入していない。
- secretや本文をログへ出していない。
- ユーザー文字列をHTMLとして解釈していない。

## Editor

editorに関係する変更では以下を必須とする。

- selectionの座標系が明確。
- 古いsnapshotを適用できない。
- 選択範囲外の文字を変更しない。
- documentをReact stateから上書きしない。
- Undo/Redoを壊していない。
- composition中の入力を妨げない。

## Async

非同期処理に関係する変更では以下を必須とする。

- request IDを照合している。
- cancellation後の遅延応答を破棄する。
- 古いerrorで新しい状態を上書きしない。
- Retry開始時に旧候補を無効化する。
- 検証とeditor dispatchの間にawaitがない。

## Persistence

保存に関係する変更では以下を必須とする。

- 保存順序が直列化されている。
- storage versionを検証する。
- 保存失敗でメモリ本文を消さない。
- 初期読み込み失敗で既存データを上書きしない。
- backup/importのversionと参照整合性を確認する。

## Tests

- 関連unit testが成功。
- 関連integration testが成功。
- UI変更ではcomponent testが成功。
- critical flow変更では関連E2Eが成功。
- build境界変更ではbuildが成功。
- テストをskipして成功扱いしていない。
- 実行していない検査を成功として記載していない。

## Documentation

- public interface変更時に関連仕様を更新した。
- 設計判断変更時に`docs/DECISIONS.md`へ記録した。
- 新しい制約や既知の問題を記録した。
- 実機検証が必要なら実施結果または未実施を記録した。

## Completion Report

報告には次を含める。

1. 対象Phase / Task。
2. 変更内容とファイル。
3. Acceptance Criteriaごとの結果。
4. 実行コマンドと成功・失敗・未実行。
5. 残存リスク。
6. 次のTaskへ進まず停止したこと。

既知の失敗が残る場合は、Task完了とは報告しない。
