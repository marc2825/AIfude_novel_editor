# AIの接続方法

上部の「AI接続」で、主に使うAI、比較先、モデルを設定します。設定がない初回はAI無効で起動します。本文の編集と保存はそのまま使えます。

## 接続先を選ぶ

| 接続ID | 接続先 | 必要な設定 |
|---|---|---|
| `chatgpt` | ChatGPTの利用枠 | `CHATGPT_MODEL`、画面からサインイン |
| `claude` | 公式Claude CLI | `CLAUDE_MODEL`、CLIでの事前ログイン |
| `local` | Ollama / LM Studio | `LOCAL_LLM_BASE_URL`、`LOCAL_LLM_MODEL` |
| `openai` | OpenAI API | `OPENAI_API_KEY`、`OPENAI_MODEL` |
| `anthropic` | Claude API | `ANTHROPIC_API_KEY`、`ANTHROPIC_MODEL` |
| `gemini` | Gemini API | `GEMINI_API_KEY`、`GEMINI_MODEL` |
| `xai` | Grok API | `XAI_API_KEY`、`XAI_MODEL` |
| `deepseek` | DeepSeek API | `DEEPSEEK_API_KEY`、`DEEPSEEK_MODEL` |
| `mock` | デモ候補 | 認証不要、外部送信なし |
| `disabled` | AI無効 | 本文編集・保存のみ |

`.env.local` の `AI_PROVIDER` に接続IDを指定できます。設定例は [.env.example](../.env.example) を参照してください。外部AIへ本文を送るには、接続先ごとの同意も必要です。

APIの料金は各社のサブスクリプション契約と別です。有料APIを使う場合は、サーバーで `AI_ENABLE_PAID_API=true` を設定し、画面でもAPI接続を有効にしてください。画面の許可は再読み込みや接続設定の保存でOFFに戻ります。接続失敗時に別のAIや有料APIへ自動で切り替わることはありません。

Gemini・Grok・DeepSeekのサブスクリプション接続は未対応です。利用できるのは上表のAPI方式です。CLIを含む外部サービスの利用条件と未確認事項は [配布前の確認](PROVIDER_DISTRIBUTION_REVIEW.md) にまとめています。

## ChatGPT

APIキーは不要です。公式の [Sign in with ChatGPT](https://developers.openai.com/siwc/token-sharing-open-source) を使い、自分のアカウントの利用枠で生成します。

```dotenv
APP_ORIGIN=http://127.0.0.1:3000
AI_PROVIDER=chatgpt
CHATGPT_MODEL=gpt-6.1-sol
```

1. 設定後にサーバーを再起動し、画面を再読み込みします。
2. 「設定とバックアップ」で作品のモデルを「自動（サーバー既定）」にします。
3. 「Continue with ChatGPT」から、別ウィンドウでアカウントとワークスペースを選びます。開かない場合は画面の認証リンクを使います。
4. 接続後、本文の送信内容を確認して同意を保存します。

利用できるモデルはアカウントごとに異なります。上記のIDは設定例です。アカウントのカタログにない場合は生成できません。モデルを変えるときは `CHATGPT_MODEL` を変更し、再起動・再読み込みしてください。接続するChatGPTアカウントは1つです。

認証情報はサーバー側の `~/.local/share/novel-ai-editor/chatgpt/connection.json` に保存します。保存先は `CHATGPT_AUTH_DIR` でリポジトリ外の絶対パスへ変更できます。作品のバックアップやブラウザーデータには含みません。

「ChatGPTの接続を解除」はローカルのトークンを削除し、提供元にも失効を要求します。遠隔での失効を確認できない場合は画面に表示します。host IDと登録情報は再認証用に残ります。アプリへの許可はChatGPT側の接続設定からも管理してください。利用枠は他のアプリと共有されます。

## Claude CLI

[公式Claude CLI](https://code.claude.com/docs/en/setup) を別途導入し、アプリ専用のディレクトリでログインします。Linux / WSLでの例です。

```sh
mkdir -p "$HOME/.local/share/novel-ai-editor/claude"
chmod 700 "$HOME/.local/share/novel-ai-editor/claude"
CLAUDE_CONFIG_DIR="$HOME/.local/share/novel-ai-editor/claude" claude auth login
CLAUDE_CONFIG_DIR="$HOME/.local/share/novel-ai-editor/claude" claude auth status
```

```dotenv
AI_PROVIDER=claude
CLAUDE_MODEL=claude-sonnet-5
AI_ENABLE_PAID_API=false
```

`CLAUDE_MODEL` には自分の契約とCLIで使える正確なモデルIDを指定します。上記は設定例です。認証ディレクトリを変える場合は `CLAUDE_AUTH_DIR`、CLIがPATHにない場合は `CLAUDE_CLI_PATH` に絶対パスを指定します。

アプリはCLIのログイン方法を指定しません。`authMethod` が `claude.ai` または `oauth_token` ならサブスクリプションとして扱います。それ以外の認証では、`AI_ENABLE_PAID_API=true` の場合だけ生成します。利用料金と追加使用量は自分の契約で確認してください。

CLIには専用ディレクトリの認証を使い、サーバー自身のAPIキーやクラウド認証の環境変数は渡しません。設定ファイルも `--setting-sources ""` で読み込みません。この制限と、製品内でCLIを動かす条件との関係は未解決の項目として [配布前の確認](PROVIDER_DISTRIBUTION_REVIEW.md) に記録しています。

本文は標準入力だけで渡します。空の一時ディレクトリで、ツール・MCP・履歴保存などを無効にして1ターンだけ実行します。`--safe-mode` / `--restricted` などのフラグに対応しないCLIでは生成できません。認証ファイルはCLIが管理します。

## Ollama / LM Studio

JSON Schema形式の出力に対応するモデルを用意し、推論サーバーを起動します。Ollamaでは `ollama list` でモデルIDを確認します。

```dotenv
APP_ORIGIN=http://127.0.0.1:3000
AI_PROVIDER=local
LOCAL_LLM_BASE_URL=http://127.0.0.1:11434/v1
LOCAL_LLM_MODEL=your-local-model:tag
LOCAL_LLM_API_KEY=
```

LM Studioではモデルを読み込み、Developer画面でサーバーを起動します。URLを `http://127.0.0.1:1234/v1` に変更し、実際のモデルIDを設定してください。認証を有効にした場合だけ `LOCAL_LLM_API_KEY` が必要です。

接続先はループバックアドレスの `/v1` に限ります。LAN・公開URL、認証情報・クエリ・フラグメントを含むURLは使えません。リダイレクトも追いません。WSLやコンテナーでは、アプリのサーバーから同じループバック経由で推論サーバーへ届く配置が必要です。

入力見積もりは最大24,000トークンです。2候補の出力上限は8,192、3候補は12,288トークンで、実モデルのコンテキスト上限にも収まる必要があります。Ollamaのコンテキスト設定は、必要に応じて [Modelfileの `PARAMETER num_ctx`](https://docs.ollama.com/api/openai-compatibility#setting-the-local-context-size) で調整します。

推論サーバー側の外部転送・ログ・保存設定も確認してください。Ollamaを完全なローカル推論に限定する場合は、[Ollama側で `OLLAMA_NO_CLOUD=1`](https://docs.ollama.com/faq#how-do-i-disable-ollama-cloud-features) を設定して再起動します。アプリの `.env.local` に書くだけではOllamaへ適用されません。LM Studioについては [Structured Outputの対応](https://lmstudio.ai/docs/developer/openai-compat/structured-output) を確認してください。

## API接続とモデル

各社のAPIキーとモデルIDをサーバーの `.env.local` に設定します。有料APIの許可は、このページ冒頭のサーバー設定と画面設定の両方で必要です。キーをブラウザーや作品JSONへ入力しないでください。

OpenAI APIで選べるモデルは `gpt-6-astra`、`gpt-5.6-sol`、`gpt-5.6-terra`、`gpt-5.6-luna` です。対応一覧は [モデル定義](../src/domain/ai-models.ts) で管理します。ChatGPTのアカウント別カタログとは別の一覧です。

作品の「自動（サーバー既定）」は、接続先に設定したモデルを使うという意味です。文章に合わせた自動選択ではありません。利用できないモデルを選んだ場合は生成を止めます。別モデルへの自動切替はありません。

OpenAI APIでは `store: false` を指定しますが、提供元で一切保持されないという保証ではありません。[APIのデータ取扱い](https://developers.openai.com/api/docs/guides/your-data) と、自分の契約・アカウント設定を確認してください。応答形式や上限の実装は [AI編集仕様](AI_EDITING.md) に記載しています。

## 設定の保存と比較

「AI接続」で主接続・比較先・モデル・ローカルURLを保存すると、再起動せず反映します。接続設定はこのPCのアプリ全体で共通です。保存済み設定が環境変数より優先され、「AI接続を環境設定に戻す」で解除できます。

環境変数で比較先を初期設定する例は `AI_COMPARE_PROVIDERS=chatgpt,claude` です。画面で選ぶ比較候補は0個または2個以上、実際の同時送信は2〜3個です。有料APIが無効な間は、その接続先を候補から除外します。

保存先は `~/.local/share/novel-ai-editor/ai-settings.json` です。`NOVEL_AI_SETTINGS_PATH` でリポジトリ外の絶対パスへ変更できます。APIキー、ChatGPTトークン、Claude認証ディレクトリ、CLIのパスはこのファイルや画面では扱いません。環境変数・認証・CLIの設定を変えた場合は、サーバーの再起動と画面の再読み込みが必要です。

「診断」は保存済み設定に対して実行します。本文・メモ・プロンプトは送らず、HTTPのモデル一覧やCLIの認証状態だけを調べます。生成品質や利用枠残量の確認ではありません。一覧の最初のページにモデルがなくても、生成できないとは限りません。

## つながらないとき

| 症状 | 対処 |
|---|---|
| モデルが利用不可 | 正確なIDと契約を確認し、作品のモデル設定を「自動」に戻して試す |
| 接続を変更しても反映されない | 画面の保存済み設定が優先されていないか確認する |
| 設定ファイルが壊れている | AIは停止するが、本文は編集・保存できる。「環境設定に戻す」などで接続を設定し直す |
| 異常終了後にロックが残る | すべてのサーバーを停止してから、該当する `.lock` だけを取り除く。起動ランチャーは `.novel-editor-launcher.lock`、ChatGPTは `connection.lock` を使う |

認証情報の保存はUnixの所有者権限を前提とします。WindowsではWSLでサーバーを動かしてください。macOS、実アカウントの認証・生成、実ローカルモデルの品質確認は未実施です。確認手順は [手動テスト](TESTING.md#実サービスの手動確認) を参照してください。
