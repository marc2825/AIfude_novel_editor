# Architecture Boundary Skill

## いつ参照するか

依存追加、module移動、interface変更、保存schema変更、provider追加、設計判断変更を行うとき。

## 守るべき原則

- UIはprovider SDKを知らない。
- editorはHTTPを知らない。
- context assemblyはDOMを知らない。
- persistenceは候補UIを知らない。
- serverはclientの現在documentを検証できると仮定しない。
- 将来のためだけのコードを作らない。

## 実装パターン

変更前に次を確認する。

1. どの境界の責務か。
2. 現在のTaskに必要か。
3. 既存の純粋関数や小さなportで足りるか。
4. secretまたは本文の露出を増やさないか。
5. schema、テスト、文書に変更が必要か。

新しい抽象化は、具体的な利用箇所とテストがある場合だけ追加する。

Accepted Decisionを変える場合は、理由、代案、移行、検証方法を記載して承認を得る。

## やってはいけないこと

- 「将来使う」で汎用基盤を追加する。
- provider型をdomain modelへ漏らす。
- React stateとPM documentを双方向同期する。
- local-only制約を外して公開deployする。
- packageのmajor updateを機能修正に混ぜる。
- 未使用のCharacter repositoryやevent busを作る。

## 完了条件

- dependency方向が仕様どおり。
- 新規依存の必要性が説明できる。
- interface変更が文書とテストへ反映されている。
- 未使用抽象化がない。
- 設計判断変更がDecision Logに記録されている。

## 関連文書

- `docs/ARCHITECTURE.md`
- `docs/DECISIONS.md`
- `docs/IMPLEMENTATION_PLAN.md`
