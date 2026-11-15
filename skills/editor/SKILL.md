# Editor Safety Skill

## いつ参照するか

schema、selection、transaction、貼り付け、IME、Accept、Undo/Redoを変更するとき。

## 守るべき原則

- PM documentを唯一の正本にする。
- UTF-16 offsetとPM位置を区別する。
- snapshotは不変。
- V0.1では自動rebaseしない。
- Accept以外で本文を変更しない。
- history pluginは1個だけ。

## 実装パターン

1. 純粋なserializationと位置変換を先にテストする。
2. guard pluginでcontent/selection revisionを同期的に観測する。
3. 非同期結果はcontrollerへ保持する。
4. Accept時に現在のPM stateを読み直す。
5. 候補をschemaのnodeからSliceへ変換する。
6. transactionの正規テキストをprefix＋candidate＋suffixと照合する。
7. 1つの本文変更transactionをdispatchする。
8. 前後のhistory境界を設定する。

selectionの変更は等価比較で判定する。

DOM blurだけでselectionを消さない。

## やってはいけないこと

- 保存後に`setContent()`する。
- AI結果をHTMLとしてinsertする。
- `from`と`to`をplain-text offsetとして扱う。
- stale位置を文字列検索で探し直す。
- selectionだけが一致すれば安全だと判断する。
- AI適用transactionを履歴対象外にする。
- 候補Previewを本文の一時置換で表現する。
- composition中にshortcutを横取りする。

## 完了条件

- 単一・複数段落の置換テストが通る。
- 空段落、絵文字、末尾改行のテストが通る。
- stale documentとstale selectionを拒否する。
- AI前後の手入力とUndoが分離される。
- property-based testで範囲外不変条件が成立する。

## 関連文書

- `docs/ARCHITECTURE.md`
- `docs/UX.md`
- `docs/TESTING.md`
