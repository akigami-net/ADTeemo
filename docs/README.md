# ドキュメント索引

全体像は[システム構成](./integrations/architecture.md#全体構成)、開発・配備手順は[CONTRIBUTING](../CONTRIBUTING.md)、利用方法は[README](../README.md)から読む。

## 文書の役割

| 文書                                                           | 書くこと                               | 書かないこと                         |
| -------------------------------------------------------------- | -------------------------------------- | ------------------------------------ |
| [合意要件](../REQUIREMENTS.md)                                 | 利用者が達成したいこと、提供条件       | 実装状況、具体的なAPIや保存schema    |
| [システム構成](./integrations/architecture.md)                 | 全体図、責務、通信とデータの境界       | 起動コマンド、料金表、詳細な調査記録 |
| [開発者ガイド](../CONTRIBUTING.md)                             | 準備、起動、検証、配備、復旧の手順     | 設計判断の長い説明                   |
| ADR                                                            | 採用した判断、理由、影響、守る制約     | 実験の全記録、タスクの進捗           |
| Proposal                                                       | 未採用の設計案、利点と制約、採用条件   | 実装済み機能としての説明             |
| Research                                                       | 観測日、出典、方法、結果、未検証の範囲 | 設計手順、作業checklist              |
| User guide                                                     | 現在使える操作と利用上の制約           | 未提供の機能、内部実装の詳細         |
| [GitHub Issues](https://github.com/akigami-net/ADTeemo/issues) | 作業範囲、受け入れ条件、依存、進捗     | 文書の長文コピー                     |

API契約・schema・定数はcode/tests、依存・taskは`deno.json`、設定名は[.env.example](../.env.example)を参照する。利用者向けの文言はmessage catalogに置く。

## 書き方

- 最初に、その文書で分かることを示す。構成図や結論を先に置き、説明を続ける。
- 同じ説明は一か所にまとめ、他の文書から参照する。会話の経緯や作業実況は残さない。
- 短い日本語で書き、専門用語は識別に必要な箇所で使う。自明な説明や目的のない注意書きを加えない。
- 現行実装・採用済み設計・候補を区別する。検証範囲や重要な制約は該当節で明示し、各節で繰り返さない。

## 変更対象から探す

| Topic / path                                     | 最初に読む文書                                                      | 次に確認するもの                                                                                              |
| ------------------------------------------------ | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 全体構成、workspace境界、`api/src/db/schema.ts`  | [システム構成](./integrations/architecture.md)                      | 関連repository / migration tests                                                                              |
| Botのproduction権限、`bot/deno.json`、Docker起動 | [Bot実行権限](./integrations/bot-runtime-permissions.md)            | permission smoke、CONTRIBUTING                                                                                |
| 認証、`api/src/service_auth.ts`、Docker公開設定  | [ADR 0001](./adr/0001-bot-service-authentication.md)                | CONTRIBUTING、auth tests                                                                                      |
| ログ、`lib/logger/`、API request middleware      | [ADR 0002](./adr/0002-structured-logging-trust-boundary.md)         | logger tests                                                                                                  |
| API route、`api/src/contract/`、Bot API client   | [APIエラー契約](./api-error-contract.md)                            | schema / route / client tests                                                                                 |
| パッチノート・ニュース・Rioterプレビュー配信     | [合意要件](../REQUIREMENTS.md#公式情報とパッチプレビュー)           | M5で採用。[旧GAS側のみの判断](./proposals/project-scope.md#採用しない範囲)は履歴。                            |
| RSO、auth callback、OAuth identity               | [RSOと登録アカウント](./integrations/rso.md)                        | provider / callback縦断tests、command registry                                                                |
| イベント作成・取消、`events.ts`、event saga      | [イベント整合性・復旧](./custom-game-event-consistency.md)          | [現在の操作](./user/custom-games.md)、[フロー案](./proposals/custom-game-flow.md)                             |
| 戦績、`matches.ts`、record-match                 | [戦績整合性・移行](./record-match-consistency.md)                   | repository / 縦断tests                                                                                        |
| 通知outbox、再試行、Discord送信・状態保存        | [通知deliveryと復旧](./integrations/match-notification-delivery.md) | notification delivery tests                                                                                   |
| 監視renderer / notifier / state                  | [試合通知ガイド](./user/match-display.md)                           | [表示ADR](./adr/0003-match-display-priorities.md)、[追加案](./proposals/match-display-extensions.md)          |
| League-v4、rank snapshot、LP計算                 | [ランクADR](./adr/0004-ranked-snapshot-lifecycle.md)                | [ランク表示ガイド](./user/ranked-lp.md)                                                                       |
| OP.GG client / service                           | [OP.GG連携](./integrations/opgg.md)                                 | [判断](./adr/0005-optional-opgg-integration.md)、[観測記録](./research/opgg-server-actions.md)                |
| 登録・複数account・watcher policy                | [opt-out Proposal](./proposals/default-watch-opt-out.md)            | [Discord調査](./research/discord-lol-connections.md)、[#89](https://github.com/akigami-net/ADTeemo/issues/89) |
| `messages/**/*.json` / message key               | [messages編集ガイド](../messages/README.md)                         | [Teemo文体](../messages/TEEMO_STYLE.md)、[参考記録](./research/teemo-character-notes.md)                      |
| 新機能のscope判断                                | [合意要件](../REQUIREMENTS.md)                                      | [ADR 0007](./adr/0007-product-requirements-baseline.md)、GitHub Issues。旧scope案は履歴。                     |

## 種別別索引

- ADR: [0001 認証](./adr/0001-bot-service-authentication.md)、[0002 ログ](./adr/0002-structured-logging-trust-boundary.md)、[0003 表示](./adr/0003-match-display-priorities.md)、[0004 ランク](./adr/0004-ranked-snapshot-lifecycle.md)、[0005 OP.GG](./adr/0005-optional-opgg-integration.md)、[0006 accountと監視](./adr/0006-account-monitoring-policy.md)、[0007 実装方針](./adr/0007-product-requirements-baseline.md)、[0008 配備](./adr/0008-cloudflare-deployment.md)。
- Proposal: [既定監視](./proposals/default-watch-opt-out.md)、[表示拡張](./proposals/match-display-extensions.md)、[イベントフロー](./proposals/custom-game-flow.md)、[未採用の拡張](./proposals/project-scope.md)、[Cloud Run音声中継](./proposals/cloud-run-voice-relay.md)。
- Research: [Podman互換性（保留）](./research/podman-compatibility.md)、[OP.GG Server Action](./research/opgg-server-actions.md)、[Discord connected accounts](./research/discord-lol-connections.md)、[Teemo参考記録](./research/teemo-character-notes.md)、[外部機能](./research/requirements-feasibility.md)、[配備基盤](./research/deployment-platforms.md)、[Cloud Run音声](./research/cloud-run-voice-relay.md)。
- Integration: [account監視の運用](./integrations/account-monitoring.md)、[監視テストの責務](./match-tracking-test-ownership.md)、[RSO](./integrations/rso.md)、[通知delivery](./integrations/match-notification-delivery.md)、[構成](./integrations/architecture.md)、[OP.GG](./integrations/opgg.md)、[APIエラー](./api-error-contract.md)、[イベント整合性](./custom-game-event-consistency.md)、[戦績整合性](./record-match-consistency.md)。
- User: [account管理と監視](./user/riot-accounts-and-monitoring.md)、[カスタムゲーム](./user/custom-games.md)、[試合通知](./user/match-display.md)、[ランク・LP](./user/ranked-lp.md)。
- Content: [messages](../messages/README.md)、[Teemo](../messages/TEEMO_STYLE.md)。
- 旧pathの移管案内: [試合表示](./match-display.md)、[ランク](./ranked-lp.md)、[OP.GG](./opgg.md)、[opt-out](./default-watch-opt-out.md)、[Discord調査](./discord-lol-connections.md)、[メッセージ](./messages.md)、[Teemo](./teemo.md)。rootの旧入口は[SPEC](../SPEC.md)、[TASKS](../TASKS.md)。

## 種別と状態

| Type / 配置                                   | Status                               |
| --------------------------------------------- | ------------------------------------ |
| `adr` / `adr/`                                | `accepted`, `superseded`             |
| `proposal` / `proposals/`                     | `proposed`, `rejected`, `superseded` |
| `research` / `research/`                      | `current`, `historical`              |
| `integration` / `integrations/`または既存path | `current`, `superseded`              |
| `user` / `user/`                              | `current`, `superseded`              |
| `content` / 対象workspace                     | `current`, `superseded`              |
| `navigation` / 旧pathの移管案内               | `moved`                              |

状態は文書の位置づけを表す。実装の完了状態はIssueで管理する。

## 共通headerと命名

文書名はIssue番号でなく安定した英小文字のtopic名をkebab-caseで付ける。ADRだけは通し番号を先頭に付ける。root入口、中央索引、旧pathの移管案内を除き、本文の前に次のheaderを置く。

```text
# Topic

- Type: proposal
- Status: proposed
- Summary: 何が分かる文書かを1文で記す。
- Read when: topicまたは変更対象pathから読む条件。
- Related: 関連Issueへのリンク。なければ none と理由。
- Code: 相対リンク。未実装なら none と理由。
- Tests: 相対リンク。未検証なら none と理由。
- Reviewed: YYYY-MM-DD（本文を見直した日）
- Verified: YYYY-MM-DDと検証範囲、または unknown / not adopted と理由
```

Researchには`Observed`、外部出典、調査方法、確認済み事実、未検証点、再確認条件を加える。元資料に日付がなければunknownとし、再編日を実観測日に置き換えない。Integrationも外部情報を扱う場合は検証範囲と再確認条件を持つ。

## 採用・更新時の扱い

ADRはContext → Decision → Consequences → Rejected alternatives → Enforcementを基本とする。重要な判断を変える場合は後続ADRを作り、旧文書と相互リンクする。Proposalの採用時はADRへ判断を残し、Researchには当時の観測を保持する。

Issue・PRの運用規則は[CONTRIBUTING](../CONTRIBUTING.md)、テスト規約は[TESTING_STYLE](../TESTING_STYLE.md)、agent向け指示は[AGENTS](../AGENTS.md)を参照する。

## 文書の検証

変更したファイルのformatと、索引・metadata・相対リンクを確認する。

```bash
deno fmt --check --no-config --prose-wrap=preserve <変更したMarkdown>
deno run --allow-read scripts/check-docs.ts
git diff --check
```

リンク先の実在・見出しと必須metadataは自動検査する。外部URLの内容や検証日の正しさはreviewで確認する。
