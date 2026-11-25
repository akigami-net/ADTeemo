# 配備基盤の比較と検証

- Type: research
- Status: current
- Summary: Cloudflareの利用枠と実行機構、他の配備先、ローカル試験の結果を記録する。
- Read when: ADR 0008の根拠、無料枠変更、runtime移植、音声の配備条件を確認するとき。
- Related: [ADR 0008](../adr/0008-cloudflare-deployment.md), [全体管理 #158](https://github.com/akigami-net/ADTeemo/issues/158)
- Code: [現行DB](../../api/src/db/index.ts), [event transaction](../../api/src/db/repositories/events.ts), [Bot](../../bot/src/main.ts)
- Tests: [ローカルprobe](./fixtures/cloudflare-runtime-probe.mjs)
- Reviewed: 2026-11-25
- Verified: 2026-11-19、以下の公開公式資料、現行code、Miniflare/workerdのローカル試験。実サービスへの配備・利用者アカウントの契約/残額照会は未実施。
- Observed: 2026-11-19。各資料の更新日と、この確認日を区別する。

Cloudflareの公開仕様とローカルruntimeを確認した。採用理由は[ADR 0008](../adr/0008-cloudflare-deployment.md)、音声の追加調査は[Cloud Run Jobs](./cloud-run-voice-relay.md)を参照する。

## Cloudflareの確認結果

| 項目                 | 公式資料から確認した内容                                                        |
| -------------------- | ------------------------------------------------------------------------------- |
| Static Assets        | 静的asset requestは無料・無制限。Worker処理のrequestとは別                      |
| Workers Free         | 100,000 request/日、HTTP/Cron CPU 10 ms、128 MB                                 |
| Durable Objects Free | SQLite-backedのみ。100,000 request/日、13,000 GB-s/日。超過した種類の操作は失敗 |
| 外向きWebSocket      | DOをclientとして使用可能。外向き接続はhibernate対象外                           |
| D1 Free              | 5,000,000 rows read/日、100,000 rows written/日、合計5 GB。ただし1 DBは500 MB   |
| D1原子性             | `batch()`内でSQL失敗時は全体をrollback                                          |
| D1復旧               | FreeのTime Travelは7日                                                          |
| Node互換             | `node:dgram`はimport可能な非機能stub                                            |

出典: [Static Assets](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/)、[Workers limits](https://developers.cloudflare.com/workers/platform/limits/)、[DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)、[DO WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)、[D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)、[D1 limits](https://developers.cloudflare.com/d1/platform/limits/)、[D1 batch](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)、[Node互換](https://developers.cloudflare.com/workers/runtime-apis/nodejs/)。

DOの128 MB固定課金では1日常駐が約1.1万GB-sとなる。これは計算値で、実使用量は未計測。[DOのinvocation CPU](https://developers.cloudflare.com/durable-objects/platform/limits/)は既定30秒で、WorkersのCPU枠とは異なる。

## ローカルruntimeで試したこと

Node 24.19.0、Miniflare 4.20260730.0、workerd 1.20260730.1、compatibility date `2026-07-30`で[probe](./fixtures/cloudflare-runtime-probe.mjs)を実行した。アプリの依存へ追加せず、一時ディレクトリへ固定versionを導入した。

| 試験                             | 結果                                                                |
| -------------------------------- | ------------------------------------------------------------------- |
| D1 batchの後続SQLでunique違反    | 先行INSERTも取り消され、0件を確認                                   |
| 残り1枠への2人の同時参加と各再送 | 条件付きINSERTとoutboxのbatchで参加者1件・outbox1件                 |
| Ed25519の署名検証                | 正しいbodyは成功、改ざんbodyは拒否                                  |
| DOから外へ張ったWebSocket        | 最初のHTTP応答後、別requestから送信し、ローカルechoを受信           |
| `node:dgram`                     | import/create/closeは可能だが送信callbackは500 ms内に完了しなかった |

UDP対応の判断には、ローカル結果と公式の非機能stub指定を併用した。

再実行例（repo root。ローカルlisten権限が必要）:

```bash
probe_dir=$(mktemp -d)
cp docs/research/fixtures/cloudflare-runtime-probe.mjs "$probe_dir/probe.mjs"
npm install --prefix "$probe_dir" --no-audit --no-fund --ignore-scripts miniflare@4.20260730.0 ws@8.23.0
node "$probe_dir/probe.mjs"
```

本番Discordの接続・復帰、長時間運転、Cloudflareでの使用量・リソース作成は未検証。

## 音声と他の配備先

[Discord Voice仕様](https://docs.discord.com/developers/topics/voice-connections)は音声データにUDPを使い、DAVEを規定する。音声WebSocketだけ、またはVC移動のREST APIだけで音声の中継はできない。

[Cloudflare TURN](https://developers.cloudflare.com/realtime/turn/)はTCP/TLSからUDP relayへ接続でき、[SFU/TURN料金](https://developers.cloudflare.com/realtime/sfu/platform/pricing/)には合計1,000 GB/月の無料枠がある。しかしBotのcodec・mixing・DAVEを実行する場所は別に必要で、既存音声ライブラリをそのままWorkersへ置く解にはならない。専用TURN transportによるDiscord接続は実証していない。

| 候補               | 確認結果と不採用理由                                                                                                                                                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Oracle Always Free | [登録条件](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier.htm)に請求先の検証が必要                                                                                                                                                       |
| Koyeb Free         | [billing FAQ](https://www.koyeb.com/docs/faqs/pricing)の請求先設定と、[Free instance](https://www.koyeb.com/docs/reference/instances)の無通信時休止がある                                                                                              |
| Northflank Sandbox | [料金表](https://northflank.com/pricing)は支払情報なしでの利用・常駐を案内する一方、[billing docs](https://northflank.com/docs/v1/application/billing/pricing-on-northflank)は全planでresource作成前にpayment method必須と記載。公開情報の不一致が残る |
| Render Free        | [公式制限](https://render.com/docs/free)に15分間のincoming HTTP/WS無通信時休止、一時filesystem、service起点の過大trafficによる停止がある。外向きDiscord接続だけの常駐を保証しない。UDP実接続は未検証                                                   |
| Deno Deploy        | [changelog](https://docs.deno.com/deploy/changelog/)は組織検証前のFree利用に制限を設けている                                                                                                                                                           |
| Turso Free         | [料金表](https://turso.tech/pricing)でSQLite系DBのFree枠を確認。音声の実行環境は含まれない                                                                                                                                                             |

## API利用枠と外部監視

[OpenAIのAPI credit特典](https://help.openai.com/en/articles/20001626-api-credits-benefit-for-eligible-chatgpt-subscriptions)は対象アカウントで有効化が必要。有償残高を持つ組織では、grant消費後も利用が続く場合がある。[Google Developer Program](https://developers.google.com/profile/help/benefits)の特典も、Cloud Billingへの適用が必要となる。個別アカウントの適用可否・残額は未照会。

[UptimeRobot Free](https://help.uptimerobot.com/en/articles/11604710-who-should-use-uptimerobot-s-free-plan)の5分間隔監視と[Discord連携](https://help.uptimerobot.com/en/articles/11361285-uptimerobot-integrations-basic-information-overview)を確認した。外部監視の設定と通知試験は未実施。

## 再確認条件

利用枠・登録条件・runtime対応の変更、Gateway shardの追加、保存量の増加、API creditの失効時に再確認する。
