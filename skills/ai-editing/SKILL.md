# AI Editing Skill

## いつ参照するか

API契約、prompt、Edit Intent、context、provider、候補検証、retry、timeoutを変更するとき。

## 守るべき原則

- LLMは選択範囲の置換文字列だけを返す。
- providerをUIとeditorへ依存させない。
- 制約と未信頼資料を分離する。
- Structured Outputの後にも検証する。
- 意味保存を完全保証したと表示しない。
- 新しいLLM呼び出しは明示的なユーザー操作だけ。

## 実装パターン

1. requestをschemaで検証する。
2. serverで保守的intentを決める。
3. deterministicにcontextを組み立てる。
4. 上限超過はprovider呼び出し前に拒否する。
5. provider adapterへAbortSignalと出力上限を渡す。
6. refusal、incomplete、timeoutを正規化する。
7. candidate count、長さ、重複を検証する。
8. server生成IDを付けて返す。

wire schemaは`contracts/llm-candidates.schema.ts`を使用する。

## やってはいけないこと

- clientから任意のPreserve解除を受け付ける。
- 共通プロンプトを固定制約より優先する。
- 全文を「念のため」送る。
- providerにPM JSONや編集位置を返させる。
- 無効JSONを無断で別LLMへ修復依頼する。
- SDKの暗黙retryを放置する。
- API error bodyをそのままclientへ返す。
- 候補や指示をログへ記録する。

## 完了条件

- 正常、refusal、incomplete、timeout、invalid outputをテストした。
- 未同意で外部呼び出しが発生しない。
- 無効入力でproviderが呼ばれない。
- request乱順でも旧結果が利用されない。
- provider固有型がserver境界内に収まる。

## 関連文書

- `docs/AI_EDITING.md`
- `docs/SECURITY.md`
- `docs/DATA_MODEL.md`
