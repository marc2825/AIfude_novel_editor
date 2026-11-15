# Phase 4: 創作支援と日本語組版

2026-10-27。対象A-03/06、T-01〜04。変更予定はdomain workspace/typography、editor schema/初期化/注釈transaction、創作ツールUI、組版panel/exportと対応テスト。

## 保存と編集

Workspace v6で、paragraph内のtext配列とruby/emphasis markを許可する。rubyはreadingと元のbase文字列を属性に保持し、傍点とルビは重ねない。v1〜v5は元のplain schemaで厳密に検証後、文字/ID/改行を変えずv6へ移行。DB versionは4。旧アプリはfuture versionとして拒否する。markup風の既存文字列を自動解析・変換しない。

初期化だけで構造化PM documentを渡し、保存/rerender時のsetContentは禁止。横書きは正本のまま、ルビ範囲は印付き表示。縦書きreaderはRuby/rtと傍点を安全なReact要素で表示する。読みの文字は本文文字数/LLM payload/selection座標へ混ぜない。

注釈の明示適用・解除は既存snapshotの同期検証後、1 history単位。AI/検索の文字置換が注釈を黙って消さないよう、注釈を含む対象は拒否して解除・再付与を案内。通常の手入力は続行し、rubyの元baseと現在の親文字が違う場合もreadingを失わず保持するが、投稿用exportは確認・再付与するまで拒否する。範囲外のmarkを保持する。IME中の適用を拒否する。

## 出力

JSONは完全復元用。plain txtは本文文字だけという既存契約を保持。投稿用はカクヨム/なろうの明示ルビ記法を生成し、サイト別上限・予約記号・未対応表現を事前検証する。根拠のないエスケープや切り捨てをせず、変換を拒否して理由を示す。章は個別出力と章見出し付き全章出力を区別し、投稿先への自動送信は行わない。

公式資料（2026-10-27）: [カクヨム](https://kakuyomu.jp/help/entry/notation)は親文字20/読み50、ルビと傍点は併用不可。[なろうルビ](https://syosetu.com/helpcenter/helppage/helppageid/42)は親文字10/読み10。[なろう傍点](https://syosetu.com/helpcenter/helppage/helppageid/43/)は記法詳細がこの資料だけでは確定できないため、明示ルビの点による代替を別表示するか出力拒否とし、ネイティブ対応を主張しない。サイト記法の完全parserではなく、このアプリが出力する安全な範囲だけをround-trip検証する。

## 創作支援

Describe/Guided Writeは既存context-insert（手動カーソル位置・前後文脈・明示採用）の入口とする。五感/比喩/内面、次の展開、長さ、追加事実の許可を指示欄で確認し、2案以上で比較する。送信・再送信・採用は明示操作。LLMの出力座標や実行可能patchは使わない。保持条件は指示であり意味を機械保証しない。

## 検証設計

先に旧v1〜v5 migration/JSON backup/保存reload、markと本文/改行のproperty round-trip、注釈guard/stale/IME/Undo/Redo/範囲外mark、AIと検索の注釈保護を検証する。続いてcomponentの確認操作、E2Eのルビ作成→reload→export→復元、縦書きで本文不変、Describe/Guided Writeの2候補/明示採用/Undo、既存全回帰、type/lint/build。実機縦書き・日本語IME・投稿先表示・実LLM品質はNOT RUN。
