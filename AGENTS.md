# Coding Agent Instructions

## プロダクトの目的

このアプリは、人間が書いた小説の選択範囲をAIで局所編集するエディタである。

本文編集が主機能。AIが失敗しても、本文編集と保存を維持しなければならない。

常時表示のチャット、全文自動生成、物語の自動進行を追加してはならない。

## 作業開始時

1. 現在のrepository、作業差分、package設定を確認する。
2. `docs/IMPLEMENTATION_PLAN.md`で依頼されたPhaseとTaskを特定する。
3. 関連仕様と下表のSkillを読む。
4. 変更予定ファイル、実行する検査、対応するAcceptance Criteriaを短く示す。
5. 依頼されたTaskだけ実装する。
6. 検査結果と未完了事項を報告して停止する。

未コミット変更を上書きしない。無関係なformat変更、依存更新、rename、refactorをしない。

仕様が矛盾する場合、都合のよい解釈で続行しない。影響と選択肢を示して確認する。

## 最重要UX

選択 → Cmd/Ctrl + K → 指示 → 候補 → Diff → 明示的Accept。

Accept以外の操作で本文を変更してはならない。

候補表示までの間も、ユーザーは本文を編集できる。ただし本文やselectionを変更した時点で、そのAIセッションをstaleにする。

## 不変条件

- 本文の正本はProseMirror documentである。
- React stateへ本文をcontrolled valueとして複製しない。
- LLMに編集座標、HTML、ProseMirror JSON、実行可能patchを生成させない。
- LLMの返答を直接documentへ適用しない。
- 古い候補を新しいselectionへ適用しない。
- 位置のmapping、文字列検索、類似度検索による自動再配置をしない。
- Acceptは検証とdispatchを同期的に実行する。
- AI適用は1回のUndoで戻せる。
- API失敗、キャンセル、Retry、候補切替は本文を変更しない。
- APIキーとprovider SDKをクライアントへ持ち込まない。

## Editor stateの取り扱い

`docs/ARCHITECTURE.md`のsnapshotとrevisionの定義を守る。

ProseMirror位置はUTF-16に基づく構造的位置であり、プレーンテキストの文字位置と同一ではない。

selectionの変化は`selectionSet`だけで判定しない。新旧selectionの等価性を比較する。

DOMのblurと、ProseMirror selectionの変化を混同しない。

保存、候補切替、React rerenderを理由に`setContent()`を呼ばない。

初期データを読み込む前に編集可能な空documentを表示しない。

IME composition中はAIショートカットを処理せず、入力イベントをpreventDefaultしない。

履歴pluginは1つだけ導入する。AI適用transactionを`addToHistory: false`にしない。

## コーディング方針

- TypeScript strictを有効にする。
- 外部入力は境界で検証し、未検証値には`unknown`を使用する。
- `any`、強制的な型assertion、lint無効化は理由なく追加しない。
- UI、editor adapter、AI controller、server provider、persistenceを分離する。
- 純粋関数で表現できる処理にReact依存を持ち込まない。
- provider固有型は`src/server/ai/`の外へ公開しない。
- ProseMirrorのimportは`@tiptap/pm`に統一する。
- 本文、候補、設定、API payloadをログへ出力しない。
- ユーザー文字列をHTMLとして描画しない。
- 必要になるまで抽象基底クラス、汎用repository、event bus、plugin frameworkを作らない。

## LLM実装時

- クライアントとサーバーの両方で入力上限を検証する。
- providerのStructured Outputも信用し切らず、返答を再検証する。
- refusal、incomplete、timeout、無効JSONを正常な失敗経路として扱う。
- SDKの暗黙の自動retryを無効にする。
- キャンセル後の遅延応答をrequest IDで破棄する。
- 共通プロンプトや小説本文を、アプリの制御指示として扱わない。
- 自動修復のための追加LLM呼び出しを勝手に実装しない。
- semanticな意味保存を機械的に保証したと表示しない。

## Scope

依頼されたTaskのAcceptance Criteriaを優先する。

将来の便利さを理由に、次の機能を先行実装しない。

- Character、World、Story Stateの保存・検索
- embeddings、vector database、RAG framework
- 自動要約、自動設定更新
- 個人化、編集嗜好学習
- 認証、課金、クラウド同期
- 共同編集、CRDT
- partial Accept
- streaming
- モバイル専用UI

文書に将来の型が定義されていても、対応するコードを生成する許可ではない。

## 変更サイズ

1回の依頼は1 Taskを基本とする。

通常は少数の本体ファイルと対応テストで完了させる。bootstrap設定とlockfileは例外だが、プロダクト機能を混ぜない。

Taskを越える変更が必要になった場合、その理由を示して停止する。

## テスト

関連unit、integration、componentテストを実行する。

editor mutationを変更した場合は、範囲置換、stale、Undo/Redoのテストを必須とする。

非同期処理を変更した場合は、abortを無視して遅延応答するmockでも検証する。

UIフローを変更した場合は関連E2Eを実行する。

日本語IMEの実機確認を、合成イベントのテストだけで代替したと報告してはならない。

未実行の検査を成功として報告しない。

## Skills参照表

| 変更対象 | 必須Skill |
|---|---|
| schema、selection、transaction、Undo | `skills/editor/SKILL.md` |
| prompt、context、provider、候補検証 | `skills/ai-editing/SKILL.md` |
| 保存、読み込み、バックアップ、別タブ | `skills/persistence/SKILL.md` |
| popover、IME、キーボード、Diff UI | `skills/ux/SKILL.md` |
| テスト追加・変更 | `skills/testing/SKILL.md` |
| 境界変更、依存追加、設計判断変更 | `skills/architecture/SKILL.md` |

`skills/`は明示参照用である。特定のCodex環境による自動検出を前提にしない。

## 完了時

`docs/DEFINITION_OF_DONE.md`を確認する。

報告には、変更ファイル、満たしたAcceptance Criteria、実行したコマンドと結果、残存リスクを含める。

勝手に次のTaskへ進まない。commit、push、公開デプロイは明示的に依頼された場合のみ行う。
