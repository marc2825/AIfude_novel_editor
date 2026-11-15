# Data Model

## 共通規約

- IDはランダムUUID。
- timestampはUTCのISO 8601文字列。
- revisionとversionは0以上の整数。
- timestampを競合判定に使用しない。
- 本文はLFで正規化し、それ以外の文字列正規化を行わない。
- API上限の文字数はUnicodeコードポイント数。
- PM位置とJavaScript文字列offsetは別の型または明確な名前で区別する。
- API schema、保存schema、provider schemaのversionを混同しない。

## V0.1で実装するモデル

### Project

| フィールド | 型・制約 | 用途 |
|---|---|---|
| id | UUID | 作品ID |
| title | string、1〜120コードポイント | 表示名 |
| commonPrompt | string、最大2,000コードポイント | 作品共通の編集上の希望 |
| storyMemory | StoryMemory | 手入力の作品設定・背景・登場人物メモ |
| writingGoal | integer、0〜10,000,000 | 作品の目標文字数、0は無効 |
| autoHistoryEnabled | boolean、初期false | 自動保存前の履歴記録 |
| styleProfileId | UUID | 手動StyleProfileへの参照 |
| contextRevision | integer | AI参照設定の変更検出 |
| aiConsent | AiConsentまたはnull | provider単位の送信同意 |
| aiModelPreference | `automatic`またはcanonical model ID | workspace単位のモデル選択 |
| createdAt | timestamp | 作成日時 |
| updatedAt | timestamp | 更新日時 |

作品名変更だけではcontext revisionを増やさない。commonPrompt、manual style、storyMemory、AI送信同意、AIモデル選択の変更では増やす。同じメモの保存再試行では増やさない。

### StoryMemory（Task 13.1）

`settingNotes`、`backgroundNotes`、`characterNotes`の3つの必須stringを持つstrict object。各0〜2,000 Unicodeコードポイントで、不正なsurrogateを拒否する。空文字3つを初期値とする。作品単位の手入力資料で、構造化Character / World / Story Stateとは別のモデルである。AIから更新する経路は持たない。

UIの未保存draftと保存用snapshotを分離する。AI参照ON/OFFの`useStoryMemory`と項目選択の`storyMemoryFields`はAIセッション内だけに保持し、永続化・backupしない。新セッションはOFFで始まり、ONにしたときは保存内容のある全項目を初期選択する。未選択の項目はrequest内で空文字とし、その内容を送らない。全項目を外したままONの場合は生成できない。

`automatic`はserverの設定済みdefault modelを使用する。明示model IDが現在のregistry/runtimeで利用できない場合、保存値は保持したまま利用不可とし、別modelへ暗黙fallbackしない。表示名やcapability metadataは永続化しない。

### AiConsent

| フィールド | 型・制約 |
|---|---|
| providerId | string |
| policyVersion | integer、V0.1では1 |
| grantedAt | timestamp |

モデル変更だけで送信先providerが変わらない場合、同意をそのまま利用できる。

provider変更またはpolicy version変更では再同意を必要とする。

バックアップimportではnullへ戻す。

### Document

実装上の型名はDOMのDocumentと衝突しない`WritingDocument`とする。

| フィールド | 型・制約 |
|---|---|
| id | UUID |
| projectId | UUID |
| title | string、1〜120コードポイント |
| chapterIds | 順序付きUUID配列、1〜200章（Task 15.1） |
| createdAt | timestamp |
| updatedAt | timestamp |

Documentは作品内の原稿単位。V0.1では1個だけ存在する。

### Chapter

| フィールド | 型・制約 |
|---|---|
| id | UUID |
| documentId | UUID |
| title | string、1〜120コードポイント |
| orderIndex | 0〜199。chapterIdsの位置と一致 |
| outlineNotes | 手入力string、最大2,000コードポイント。AIへ暗黙に送らない |
| body | 検証済みPM document JSON |
| contentRevision | integer |
| createdAt | timestamp |
| updatedAt | timestamp |

bodyはparagraphとtextのみ。空文書は空paragraphを1個持つ。

body JSONへselection、候補、注釈用HTMLを混入させない。

### StyleProfile

V0.1はmanual型だけを実装する。

| フィールド | 型・制約 |
|---|---|
| id | UUID |
| projectId | UUID |
| source | V0.1ではmanual |
| manualInstructions | string、最大1,000コードポイント |
| revision | integer |
| updatedAt | timestamp |

自動推定用フィールドはV0.4で追加する。空のmetricsや未使用モデルをV0.1へ持ち込まない。

### WorkspaceSnapshot

| フィールド | 型・制約 |
|---|---|
| schemaVersion | 現在は4（Task 15.1） |
| storageVersion | integer |
| project | Project |
| document | WritingDocument |
| chapter | 現在開いているChapter |
| additionalChapters | 残りのChapter配列（現在章の重複なし） |
| styleProfile | StyleProfile |

参照IDの整合性を検証する。

IndexedDBのobject storeは`workspaces`。キーはproject ID。

`workspaces`には現在のworkspaceを1個だけ保持する。Task 14.1では`workspace-files`に待機中のWorkspaceSnapshotをproject IDで保存する。同じproject IDを両storeへ重複登録しない。

保存時は同一transactionで現在のstorage versionを読み、期待値一致時だけ更新する。

初期作成、import、削除もworkspace lock下で行う。

importされたstorage versionを、そのまま現在の競合判定に使用しない。

## 実行時だけ存在するモデル

### EditorIdentity

| フィールド | 型 |
|---|---|
| editorInstanceId | UUID |
| projectId | UUID |
| documentId | UUID |
| chapterId | UUID |
| contentRevision | integer |
| selectionRevision | integer |
| contextRevision | integer |

editor instance IDはreload、import、再mountで変わる。

### SelectionSnapshot

| フィールド | 型 |
|---|---|
| identity | EditorIdentity |
| originalSelection | PM Selection |
| from | PM位置 |
| to | PM位置 |
| plainTextFrom | UTF-16 offset |
| plainTextTo | UTF-16 offset |
| originalText | string |
| originalSlice | PM Slice |
| beforeText | string |
| afterText | string |
| commonPrompt | string |
| manualStyle | string |
| storyMemory | optional StoryMemory。capture時にコピーしてfreezeする |

PM objectをJSON保存したりAPIへ送ったりしない。

### EditIntent

| フィールド | 型 |
|---|---|
| kind | polish、shorten、dialogue、connection、custom |
| inferredFrom | preset、exact-rule、conservative-default |
| preserve | 許可された固定enumの配列 |
| allowedChanges | 許可された固定enumの配列 |
| lengthTarget | similar、shorter |
| note | UI向けの短い説明 |

preserveの基本要素はevents、participants、pov、timeline、dialogueMeaning、facts、properNames。

allowedChangesはdiction、syntax、sentenceSplitMerge、connectives、redundancy、dialogueRegister、localExpressionから選ぶ。

UIから任意のpreserve解除を送信できない。

### EditRequest

| フィールド | 型・用途 |
|---|---|
| id | UUID。HTTP request ID |
| sessionId | UUID |
| snapshot | SelectionSnapshot |
| instruction | string |
| presetId | enumまたはnull |
| candidateCount | 2または3 |
| intent | EditIntent |
| status | generating、completed、failed、cancelled、stale、superseded |
| startedAt | timestamp |
| completedAt | timestampまたはnull |

Retryごとに別EditRequestを作る。

### EditCandidate

| フィールド | 型・用途 |
|---|---|
| id | serverが生成するUUID |
| requestId | UUID |
| index | 0始まり整数 |
| replacementText | LF正規化済みstring |
| explanation | string、最大160コードポイント |
| riskNotes | 最大3件、各120コードポイント |
| providerId | string |
| model | string |
| generatedAt | timestamp |

candidate IDやrequest IDをLLMに生成させない。

候補はimmutableとする。ユーザーが候補本文を直接編集する機能はV0.1に含めない。

### EditSession

| フィールド | 型 |
|---|---|
| id | UUID |
| status | closed、command、generating、preview、error、stale |
| snapshot | SelectionSnapshot |
| activeRequestId | UUIDまたはnull |
| instruction | string |
| presetId | enumまたはnull |
| candidateCount | 2または3 |
| candidates | EditCandidate配列 |
| activeCandidateId | UUIDまたはnull |
| consumed | boolean |

AbortControllerはcontroller内部資源であり、domainの保存データではない。

## 将来モデル：定義のみ

以下はV0.1でTypeScript型、table、repository、UIを生成しない。

### Character：V0.2

- id、projectId、revision、updatedAt
- name
- aliases
- personality
- firstPerson
- speechStyle
- relationships：相手character ID、関係説明
- notes
- approved：ユーザー確認済みか

人物の恒常設定と、現在の居場所・知識を混同しない。後者はStoryStateへ置く。

### WorldEntry：V0.2

- id、projectId、revision、updatedAt
- kind：place、organization、term、technology、magic、culture、rule、other
- name
- aliases
- description
- relatedCharacterIds
- tags
- approved

### ChapterSummary：V0.2

- id、chapterId
- sourceContentRevision
- summary
- approved
- generatedBy：manualまたはmodel
- coveredThrough：要約が含む最後の物語位置
- updatedAt

元の章revisionが変わった場合はstale扱いにする。

生成要約を確認なしで「確定した過去」として扱わない。

### NarrativePosition：V0.3

- chapterId
- sceneId
- sequence：作品内の叙述順序
- anchorRevision

実際の作中時刻と、読者へ提示される順序を区別する。

### StoryState：V0.3

- id、projectId、revision
- asOf：NarrativePosition
- sourceReferences
- approved
- characterStates：居場所、状態、所持品
- knowledgeStates：人物ごとの知っている事実
- relationships：人物間の状態
- worldStates：橋の破壊等の世界の状態
- validUntil：適用終了位置またはnull

各事実はsource、確度、承認状態を持つ。

選択位置より未来のstateを渡さない。適切なstateが不明なら「不明」とし、最新stateを代用しない。

### StyleProfile拡張：V0.4

- source：manual、derived、mixed
- sentenceLengthStats
- punctuationStats
- dialogueRatio
- descriptiveDensity
- vocabularyPreferences
- preferredExpressions
- avoidedExpressions
- sampleReferences
- confidence
- approved
- sourceRevision

対象はユーザー自身の文章。特定作家の模倣を目的にしない。

### EditHistory：V0.4

- id、projectId、documentId、chapterId
- sessionId、requestId
- sourceContentRevision
- originalText
- instruction
- intent
- contextReferences
- generatedCandidates
- selectedCandidateId
- outcome
- appliedContentRevision
- subsequentUserEdit
- createdAt
- retentionConsentVersion

outcomeはaccepted、explicitly-rejected、cancelled、retried、stale、failed、not-selectedを区別する。

未採用候補をすべて「嫌い」と学習しない。

subsequentUserEditは任意の観測記録。AI適用後の編集を、確実な嗜好ラベルだと断定しない。

raw textを含む履歴保存は初期状態off。保持期間、削除、書き出し、外部利用の同意を別途設計する。

## Migration

IndexedDBのdatabase versionとWorkspaceSnapshotのschemaVersionを分離する。

current WorkspaceSnapshot schemaはversion 4。version 1〜3はそれぞれのstrict schemaと参照IDを検証して移行する。version 1 / 2は空のstoryMemory、version 1はautomaticモデルも補う。全旧versionへoutlineNotes空文字、additionalChapters空配列、writingGoal:0、autoHistoryEnabled:falseを補い、本文・メモ・既存設定・ID・revision・storageVersionを保持する。read時は既存recordを書き換えず、次のsaveでversion 4になる。

IndexedDB database versionは4。既存のworkspaces / workspace-files / workspace-historyを維持し、workspace-trash storeを追加する。作品切替は2storeの同一transactionでIDとstorageVersionを検証する。移動だけではstorageVersionを変更しない。

単体JSON backupはcanonical WorkspaceSnapshot version 4（10MiBまで）。全作品backupはkind:novel-editor-library、version:2、exportedAt、workspaces、history、trashのstrict envelope（100MiB、1,000作品、ごみ箱200件まで）。旧version 1はtrash空配列として移行する。ごみ箱だけのbackupも許可する。全snapshotのversion、参照、重複と履歴の所有作品を検証する。復元はUUIDを一貫して再発行したコピーを追加し、既存作品を上書きしない。履歴・ごみ箱内の章IDも同じ対応表で移行し、同意・storageVersion・revisionをresetする。

### ごみ箱と接続設定（Task 16.1）

workspace-trashのkeyはentry UUID。schemaVersion:1、id、kind（workspace / chapter）、projectId、chapterId（作品はnull）、deletedAt、snapshot、historyを持つ。章削除では削除前のworkspaceを保持し、historyは空。作品削除では全章・メモ・設定と直近50件の履歴を同時に退避する。全体最大200件、保持期限なし、完全削除は明示操作だけ。復元作品はID衝突時のみコピー、復元章は常に新ID。作品復元では外部送信同意をresetする。

AI接続設定はIndexedDBと作品backupに含めない。serverのJSONはversion:1、revision:UUID、settingsのstrict object。settingsはprimary、comparison（0または2〜9個、重複不可）、8接続のmodels、loopback localBaseUrlだけ。キー・credential・CLI実行path・API opt-inは含まない。更新はrevisionのCASと排他的lock、原子的renameで行う。公開応答にはモデル等の設定、利用可能接続、APIキーの設定有無booleanだけを含む。

### 執筆の保存履歴（Task 15.1）

workspace-historyのkeyはentry UUID。schemaVersion:1、id、projectId、createdAt、label（1〜120文字）、reason（manual / autosave / before-restore）、snapshotを持つ。自動保存は初期OFF、手動ボタンはその保存への明示操作。作品ごとの直近50件を保持し、全削除と一括書き出しを提供する。AI候補・嗜好・学習データは含まない。

復元は現在データのCAS確認、復元前checkpoint追加、復元先の保存を同一transactionで行う。章revisionとcontextRevisionを現在／過去の最大値+1へ進め、現在の送信同意と自動履歴設定を維持する。過去の同意を復活させない。失敗は全体rollback。自動履歴の失敗は本文saveの成功を取り消さず、履歴欠落を画面に表示する。

localStorageのnovel-editor-ui-v1はversion、閉じた作品UUID、作品／章ごとのcaret anchor / headとcontentRevisionだけ。本文・候補・メモは含めない。保存本文とrevisionが一致し範囲内の場合だけcaretを復元する。Undoは起動中のPM state内だけで、reload後は保存履歴を使う。

旧アプリはschema 4 / DB 3を読めない。旧版へ戻す場合は更新前backupを使用する。

将来versionを読み込んだ場合はfail closedとし、自動的に削除・初期化しない。

破壊的migration前にバックアップ手段を用意する。

## Phase 3 / WorkspaceSnapshot v5

`Project.authoringProfile`を追加。内部version:1、revision、人物/語彙/構造化資料/名前付き推敲プリセットのUUID・revision・updatedAt、任意の出典chapterId/contentRevision/quote、作者文体観測、字面保持文字列とAI向け保持条件を保存する。既存storyMemoryは独立して保持する。型と上限は`src/domain/authoring-profile.ts`を正とする。AI参照のON/OFFはセッション入力だけで保存しない。

v1〜v4は元のstrict schemaで検証した後、空のprofileを補う純粋migration。読み込み時にrecordを上書きせず、CASを通る通常保存でv5になる。DBは引き続きv4。復元コピーでは人物/資料/出典章を同じID対応表で複製し、外部送信同意をresetする。詳細は`roadmap/ADR_AUTHORING_AND_PARTIAL_ACCEPT.md`。

## Phase 4 / WorkspaceSnapshot v6

paragraphのcontentを複数text nodeへ拡張し、`ruby {reading, base}` または `emphasis` のmarkを一つ許可する。baseは読みを付けた時点の親文字。通常入力で親文字が変わってもreadingを捨てず、出力前に確認を促す。注釈を本文文字数・plain txt・LLM本文・PM位置の追加文字として数えない。

旧v1〜v5は従来の単一plain text node schemaで検証してからv6へ移す。既存の`｜…《…》`のような文字列は自動的に注釈へ変換しない。初期editorだけに構造化bodyを渡し、保存時のsetContentはしない。投稿用はサイトの制限に合う範囲だけを変換し、完全復元にはJSONを使用する。DB versionは4のまま。詳細は`roadmap/ADR_TYPOGRAPHY_AND_CREATIVE_TOOLS.md`。

## Phase 6 / IndexedDB v5・SyncPayload v1

現在のWorkspaceSnapshotはv6。DB v4→v5では`workspace-sync` storeだけを追加し、原稿recordを上書きしない。作品UUIDごとの同期状態はversion/sequence/deviceId/enabled/remoteRevision/pending/lastUploaded/conflict/copies/lastError。pendingは不変のoperation ID付きであり、送信後の追加入力と混ぜない。同期CASはWeb Locksに依存しない。

SyncPayload v1は作品・全章（order順）・style・作品メモリ・authoring profile・保存履歴を含み、AI同意/モデル接続設定/local storageVersionは除く。10MiB・50履歴までをstrict検証し、章/履歴を自動削減しない。受信データは直接editorへ適用せず、コピーとして復元する。通常backupに同期状態は含めない。同期コピーは個別移行ファイルか作品への復元でbackupできる。詳細は[同期ADR](roadmap/ADR_LOCAL_SYNC.md)。
