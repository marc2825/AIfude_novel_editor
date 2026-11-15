# Keyboard-first UX Skill

## いつ参照するか

popover、候補比較、focus、keyboard、IME、Diff、error表示、privacy UIを変更するとき。

## 守るべき原則

- 本文が中心。
- AI UIは必要なときだけ表示する。
- DOM focusとPM selectionを分離する。
- マウス専用操作を作らない。
- composition中の入力を妨げない。
- staleとGeneratingを見た目だけでなく操作権限へ反映する。

## 実装パターン

- popoverは非modal dialog。
- 開いたときに指示欄へfocus。
- 候補はtablist。
- Enter/Spaceでbuttonを操作。
- Cmd/Ctrl + Enterはpopover内だけで生成またはAccept。
- Escはcomposition外でcancel。
- 閉じるときは現在のselectionを維持してeditorへfocus。
- live regionは短い状態通知だけ。
- Diffは色以外の意味表示を併用する。

## やってはいけないこと

- 設定dialogとAI popoverのfocus制御を混同する。
- Generating中にeditor全体をreadonlyへする。
- 旧候補のAcceptをRetry中も有効にする。
- stale時に古いselectionを復元する。
- IME確定Enterで生成する。
- 候補全文をlive regionへ読み上げる。
- 保存失敗を一時toastだけで隠す。

## 完了条件

- 起動、候補切替、Accept、Reject、Retry、cancelをキーボードだけで実行できる。
- focusが画面外や破棄済み要素へ消えない。
- popoverへのfocus移動だけでstaleにならない。
- editor操作によるselection変更では確実にstaleになる。
- 自動a11y検査と手動keyboard確認を行った。
- IME実機確認の実施状況を明記した。

## 関連文書

- `docs/UX.md`
- `docs/TESTING.md`
