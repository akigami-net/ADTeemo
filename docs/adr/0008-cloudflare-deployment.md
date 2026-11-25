# ADR 0008: Cloudflareを中心とする配備

- Type: adr
- Status: accepted
- Summary: Workers・D1・単一Durable Objectを通常機能の配備先とし、移植と運用の境界を定める。
- Read when: 配備先、DB、Gateway、利用枠の管理を変更するとき。
- Related: [基盤 #159](https://github.com/akigami-net/ADTeemo/issues/159), [通知 #164](https://github.com/akigami-net/ADTeemo/issues/164), [Web #166](https://github.com/akigami-net/ADTeemo/issues/166), [受入 #167](https://github.com/akigami-net/ADTeemo/issues/167)
- Code: none（移植前）。[現行API](../../api/src/app.ts), [Bot](../../bot/src/main.ts), [Compose](../../docker-compose.yml)。
- Tests: [Cloudflare runtime probe](../research/fixtures/cloudflare-runtime-probe.mjs)
- Reviewed: 2026-11-25
- Verified: 2026-11-19、公開仕様とローカルworkerdの基本機構。本番配備・Discord接続は未検証。

## Context

Bot・Web・定期処理を、[OPS-01](../../REQUIREMENTS.md#利用者と提供形態)の利用枠と運用条件に収める必要がある。既存のCloudflare環境を中心に構成し、常設サーバーの管理を減らす。

現行のDenoプロセス、discord.js Client、file SQLiteはWorkersへそのまま移せない。[配備基盤の調査](../research/deployment-platforms.md)で確認した機構に合わせてadapterを分離する。

## Decision

### 配置と採用理由

[全体構成図](../integrations/architecture.md#全体構成)に配置と通信経路をまとめる。

| 配置                               | 採用理由                                                      |
| ---------------------------------- | ------------------------------------------------------------- |
| Workers Static Assets / Hono       | WebとHTTP APIを同じ基盤へ置ける。初期URLは`workers.dev`を使う |
| 単一のSQLite-backed Durable Object | Gateway接続と期限処理を集約し、guildごとの常駐コストを避ける  |
| D1                                 | 募集・戦績・設定・job・outboxの保存先を統一する               |
| UptimeRobot                        | BotやCloudflare自体が停止した場合も外から検知する             |
| 外部LLM API                        | 画像抽出・翻訳・Wiki回答をHTTP受付のCPU枠から分離する         |

音声にはUDPとDAVE対応が必要なため、通常機能とは別の実行基盤を使う。[Cloud Run Jobs案](../proposals/cloud-run-voice-relay.md)は実接続・費用の確認後に採否を決める。VC移動はDiscord RESTで実装できる。

### 移植と状態管理

- Honoの契約、domain処理、message catalogを再利用し、環境変数・DB・Gatewayをadapterへ分離する。DiscordのコマンドとボタンはHTTP Interactionsで受け、生bodyの署名検証後3秒以内に応答またはdeferする。
- D1では条件付きSQLと`batch()`を使う。revision、unique制約、operation keyで競合・再送を扱い、状態変更とoutboxを同じbatchに含める。更新件数も確認し、外部API待ちはtransactionの外へ出す。
- jobの期限・状態・leaseをD1へ保存する。DO内にはGatewayの復帰情報を保持し、古い接続のイベントは世代番号で拒否する。所属同期が終わるまで監視配送を再開しない。
- CPU負荷の高い処理は小分けにし、Discord/Riot APIの呼び出しは永続queueでrate limitを守る。

### 利用枠と保存

Workers・D1・DOはFree枠を使い、上限は[調査表](../research/deployment-platforms.md#cloudflareの確認結果)を参照する。外向きWebSocketはhibernateしないため、Gateway用DOはBot全体で1個とする。他用途・旧版との重複も使用量に含め、shard追加時は予算を見直す。

使用量80%で運用者へ通知する。D1の容量・書込余裕が不足したら過去試合の一括取込、次に自動収集を抑え、exportと復旧方法を案内する。確定済み戦績は古さだけで削除しない。結果画像は一時処理し、確認した戦績と出典を保存する。原画像・音声の恒久保管は初期構成に含めない。

LLMは有効なAPI利用枠・クレジットに限定し、モデル・入出力量・並列数・期間予算をserver側で制御する。自動チャージや有料枠へのfallbackは設定しない。残額・期限が確認できない場合は停止し、結果の手動保存は維持する。

### 配備と復旧

- `/health/ready`はGatewayのACK、所属同期、期限jobの進行、D1の状態から200/503を返す。UptimeRobotは5分間隔で確認し、停止・復帰をDiscordへ通知する。計画停止・更新は配備処理から事前通知する。
- DB復旧はD1 Time TravelとSQL exportを使う。schema変更前と定期作業でexportし、暗号化して管理者が保管する。復元試験を初期受入に含める。
- Wrangler設定、migration、secret名、初回配備・rollback手順をrepoで管理する。配備は`main`のCI成功を条件とし、secretは本番用GitHub Environmentへ置く。previewでは本番DBとBot tokenを使わない。
- 自動CDは初回配備と復旧を確認してから有効化する。

## Consequences

M1でDB契約、Bot/API adapter、Web、配備手順の順に移植する。Docker環境は開発・回帰確認用に残す。音声中継は別基盤の検証が必要になる。

## Rejected alternatives

- 現行Docker構成のWorkersへの直接配置：process・filesystem・DBの実行モデルが異なる。
- 休止するWebホストでGatewayを常駐：HTTP以外のイベントを継続受信できない。
- TURNだけで音声中継を構成：転送に加え、復号・混合・符号化の実行環境が必要。

## Enforcement

移植PRでは署名検証、D1の競合・rollback、Gateway復帰、重複job、所属不明時の配送停止をworkerd上で確認する。専用環境で48時間の使用量、10人規模の操作、再配備・DB復元・停止通知を検証する。受け入れ条件は[#167](https://github.com/akigami-net/ADTeemo/issues/167)で管理する。
