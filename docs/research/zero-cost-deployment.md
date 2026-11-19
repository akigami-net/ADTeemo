# 追加費用なしの配備先調査

- Type: research
- Status: current
- Summary: 無料枠・カード条件・Discord接続の実行要件を照合し、Cloudflare採用の根拠と音声の不足を記録する。
- Read when: ADR 0008の根拠、無料枠変更、runtime移植、音声の配備条件を確認するとき。
- Related: [ADR 0008](../adr/0008-zero-cost-cloudflare-deployment.md), [全体管理 #158](https://github.com/akigami-net/ADTeemo/issues/158)
- Code: [現行DB](../../api/src/db/index.ts), [event transaction](../../api/src/db/repositories/events.ts), [Bot](../../bot/src/main.ts)
- Tests: [ローカルprobe](./fixtures/cloudflare-runtime-probe.mjs)
- Reviewed: 2026-11-19
- Verified: 2026-11-19、以下の公開公式資料、現行code、Miniflare/workerdのローカル試験。実サービスへの配備・利用者アカウントの契約/残額照会は未実施。
- Observed: 2026-11-19。各資料の更新日と、この確認日を区別する。

本書はnon-normative。採用判断は[ADR 0008](../adr/0008-zero-cost-cloudflare-deployment.md)。契約・配備先を未定のままIssueへ送るための調査計画ではなく、この時点で確認した結果である。

## Cloudflareの確認結果

| 項目                 | 公式資料から確認した内容                                                        | 設計への反映                                               |
| -------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Static Assets        | 静的asset requestは無料・無制限。Worker処理のrequestとは別                      | 静的Webを配信し、動的APIを分離                             |
| Workers Free         | 100,000 request/日、HTTP/Cron CPU 10 ms、128 MB                                 | 署名・routingを軽くし、重い処理は分割/DO/外部APIへ         |
| Durable Objects Free | SQLite-backedのみ。100,000 request/日、13,000 GB-s/日。超過した種類の操作は失敗 | 常駐Gatewayは全体で1個。共有アカウントの合計を監視         |
| 外向きWebSocket      | DOをclientとして使用可能。外向き接続はhibernate対象外                           | heartbeat・Resumeを実装し、常駐時間を無料枠へ計上          |
| D1 Free              | 5,000,000 rows read/日、100,000 rows written/日、合計5 GB。ただし1 DBは500 MB   | 初期DB容量を500 MBとして扱う。indexの書込も計上            |
| D1原子性             | `batch()`内でSQL失敗時は全体をrollback                                          | interactive transactionの単純置換を避け、条件付きSQLへ移す |
| D1復旧               | FreeのTime Travelは7日                                                          | 復元試験と変更前exportを配備条件へ                         |
| Node互換             | `node:dgram`はimport可能な非機能stub                                            | import成功だけでDiscord音声対応と判断しない                |

出典: [Static Assets](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/)、[Workers limits](https://developers.cloudflare.com/workers/platform/limits/)、[DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)、[DO WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)、[D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)、[D1 limits](https://developers.cloudflare.com/d1/platform/limits/)、[D1 batch](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)、[Node互換](https://developers.cloudflare.com/workers/runtime-apis/nodejs/)。

DOの128 MB固定課金から、1日常駐を約1.1万GB-sと見積もった。13,000 GB-sとの比較は計算であり、実アカウントの課金計測ではない。WorkerのCPU 10 msとDOのinvocation上限を混同しない。[DO limits](https://developers.cloudflare.com/durable-objects/platform/limits/)はinvocationの既定CPUを30秒とし、incoming HTTP/WebSocket message等を境界としている。無期限の計算時間やCPU処理能力を保証する意味ではない。

## ローカルruntimeで試したこと

Node 24.19.0、Miniflare 4.20260730.0、workerd 1.20260730.1、compatibility date `2026-07-30`で[probe](./fixtures/cloudflare-runtime-probe.mjs)を実行した。アプリの依存へ追加せず、一時ディレクトリへ固定versionを導入した。

| 試験                             | 結果                                                                |
| -------------------------------- | ------------------------------------------------------------------- |
| D1 batchの後続SQLでunique違反    | 先行INSERTも取り消され、0件を確認                                   |
| 残り1枠への2人の同時参加と各再送 | 条件付きINSERTとoutboxのbatchで参加者1件・outbox1件                 |
| Ed25519の署名検証                | 正しいbodyは成功、改ざんbodyは拒否                                  |
| DOから外へ張ったWebSocket        | 最初のHTTP応答後、別requestから送信し、ローカルechoを受信           |
| `node:dgram`                     | import/create/closeは可能だが送信callbackは500 ms内に完了しなかった |

UDP試験はローカルstubの観測であり、500 ms timeoutだけを全環境の不可能性の証明にしない。音声の不採用根拠は公式の非機能stub指定とDiscordのUDP要件を合わせた判断である。

再実行例（repo root。ローカルlisten権限が必要）:

```bash
probe_dir=$(mktemp -d)
cp docs/research/fixtures/cloudflare-runtime-probe.mjs "$probe_dir/probe.mjs"
npm install --prefix "$probe_dir" --no-audit --no-fund --ignore-scripts miniflare@4.20260730.0 ws@8.23.0
node "$probe_dir/probe.mjs"
```

これは本番DiscordのIdentify/Resume、音声/DAVE、長時間接続、CloudflareのCPU計測、Freeアカウントのresource作成を試したものではない。2026-11-19のCloudflare本番runtimeと同一versionとも主張しない。HTTP応答期限や原子性を備えた移植が可能な基本機構を確かめた範囲に限る。

## 音声と他の配備先

[Discord Voice仕様](https://docs.discord.com/developers/topics/voice-connections)は音声データにUDPを使い、DAVEを規定する。音声WebSocketだけ、またはVC移動のREST APIだけで音声の中継はできない。

[Cloudflare TURN](https://developers.cloudflare.com/realtime/turn/)はTCP/TLSからUDP relayへ接続でき、[SFU/TURN料金](https://developers.cloudflare.com/realtime/sfu/platform/pricing/)には合計1,000 GB/月の無料枠がある。しかしBotのcodec・mixing・DAVEを実行する場所は別に必要で、既存音声ライブラリをそのままWorkersへ置く解にはならない。専用TURN transportによるDiscord接続は実証していない。TURNの転送枠だけを理由に、VOICEが0円で成立したと結論しない。

| 候補               | 確認結果と不採用理由                                                                                                                                                                                                                                                   |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Oracle Always Free | [登録条件](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier.htm)に通常カード確認があり、今回の条件から除外                                                                                                                                                 |
| Koyeb Free         | [billing FAQ](https://www.koyeb.com/docs/faqs/pricing)のカード確認と、[Free instance](https://www.koyeb.com/docs/reference/instances)の無通信時休止がある                                                                                                              |
| Northflank Sandbox | [料金表](https://northflank.com/pricing)はカード不要・常駐とする一方、[billing docs](https://northflank.com/docs/v1/application/billing/pricing-on-northflank)は全planでresource作成前にpayment method必須と記載。公開情報が相反するため、カード不要の確定先にできない |
| Render Free        | [公式制限](https://render.com/docs/free)に15分間のincoming HTTP/WS無通信時休止、一時filesystem、service起点の過大trafficによる停止がある。外向きDiscord接続だけの常駐を保証しない。音声だけを会話時に起動する案も、UDP実接続と停止条件の実証がないため採用しない       |
| Deno Deploy        | [changelog](https://docs.deno.com/deploy/changelog/)はカードによる組織検証前に制限付きFreeとする。料金表の全Free枠をカード不要で使えるとは扱わない                                                                                                                     |
| Turso Free         | [料金表](https://turso.tech/pricing)でカード不要のSQLite系DBを確認。DB候補にはなるが音声runtimeの不足は解消しない。今回は運用先を増やさずD1へ統合                                                                                                                      |

これらは調べた候補の結論であり、世界中の無料サービスが原理的に不可能だと証明したものではない。確認できていない配備先を採用済みとせず、現条件でVOICEが未充足である事実を残す。

## LLMと監視

[OpenAI公式のAPI credit特典](https://help.openai.com/en/articles/20001626-api-credits-benefit-for-eligible-chatgpt-subscriptions)には、対象の有料ChatGPT契約でAPI用creditを有効化でき、付与済みのpromotional grantはAPI側のpayment method追加なしで利用できる旨がある。自動付与済みとは限らず、対象地域/アカウント、初回按分、期限、受取API組織を確認する必要がある。有償creditが同じ組織に残っていれば、grant消費後も実行が続く点に注意する。個人アカウントの実際の適用可否や残高は調べていない。

[Google Developer Program](https://developers.google.com/profile/help/benefits)にもGoogle AI planに付帯する開発者creditがある。[FAQ](https://developers.google.com/profile/help/faq)では適用先Cloud Billing accountの選択が必要。対話サービスの契約だけでBotのAPI・VMが稼働済みになるわけではないため、初期hostingの必須条件にはしない。

[UptimeRobot Free](https://help.uptimerobot.com/en/articles/11604710-who-should-use-uptimerobot-s-free-plan)の5分間隔監視と、[無料planを含むDiscord連携](https://help.uptimerobot.com/en/articles/11361285-uptimerobot-integrations-basic-information-overview)を確認した。独立した外部監視として採用し、Bot自身の停止通知だけに頼らない。監視resourceやDiscord webhookの作成・送信はこの調査で行っていない。

## 再確認条件と実装時の検収

無料枠・カード条件・runtime対応の変更、共有アカウントの他用途追加、Gateway shard追加、保存量増加、API credit失効時は該当公式資料を再確認する。現在の採用構成を説明する根拠と、実装後の専用環境での受入を区別する。

必要な検収はADR 0008と既存のM1受入Issueへ具体化する。本番のsecretや利用者データを使って調査を代用しない。VOICEについては実行先が確定していないため、音声の実証済み・提供可能という記録を作らない。
