# Cloud Run JobsによるDiscord音声中継の検証

- Type: research
- Status: current
- Summary: Cloud Runと音声ライブラリの仕様、費用、ローカル試験の結果を記録する。
- Read when: 音声中継案の根拠、測定値、未検証の条件を確認するとき。
- Related: [音声 #172](https://github.com/akigami-net/ADTeemo/issues/172), [全体 #158](https://github.com/akigami-net/ADTeemo/issues/158), [ADR 0008](../adr/0008-cloudflare-deployment.md)
- Code: [独立probe](./fixtures/cloud-run-voice/probe.mjs)。製品の音声処理は未実装。
- Tests: [probe](./fixtures/cloud-run-voice/probe.mjs), [固定依存](./fixtures/cloud-run-voice/package-lock.json), [検証用Dockerfile](./fixtures/cloud-run-voice/Dockerfile)。
- Reviewed: 2026-11-25
- Verified: 2026-11-24に公開仕様・Node/Linuxでの11項目を確認。Cloud Runへの配備、Discord実接続、実課金は未検証。
- Observed: 2026-11-24。資料の公開・更新日と本書の確認日を区別する。

Cloud Run JobsはUDPとネイティブライブラリを扱えるため、音声処理の候補になる。構成と制御方式は[中継案](../proposals/cloud-run-voice-relay.md)、全体の配置は[システム構成](../integrations/architecture.md#全体構成)を参照する。

## 公開仕様から確認したこと

| 論点         | 確認した仕様                                                                                         |
| ------------ | ---------------------------------------------------------------------------------------------------- |
| UDP          | Jobsの外向き通信はTCP/UDP。Discord音声はVoice WebSocketとUDPを使う                                   |
| 実行時間     | CPU Jobは既定10分、上限168時間                                                                       |
| 課金時間     | 起動から終了まで、最低1分。待機・一時停止中も対象                                                    |
| 終了         | 正常完了はexit 0。timeout時はSIGTERM後10秒でSIGKILL                                                  |
| 再試行       | max retriesは0〜10                                                                                   |
| 並列数       | `parallelism`は1 execution内のtask数を制限する                                                       |
| メンテナンス | CPU Jobの移行はSIGTSTP/SIGCONTで通知。VPC接続は移行時に切断され、一般の外向き接続にもresetがあり得る |
| 音声受信     | `@discordjs/voice`は受信機能の安定性を保証していない                                                 |

出典: [Cloud Runのネットワーク](https://docs.cloud.google.com/run/docs/securing/security)、[task timeout・maintenance](https://docs.cloud.google.com/run/docs/configuring/task-timeout)、[container契約](https://docs.cloud.google.com/run/docs/container-contract)、[retry](https://docs.cloud.google.com/run/docs/configuring/max-retries)、[parallelism](https://docs.cloud.google.com/run/docs/configuring/parallelism)、[Discord voice](https://docs.discord.com/developers/topics/voice-connections)、[voice library](https://github.com/discordjs/discord.js/tree/main/packages/voice)。

追加資料: [jobs.runのschema](https://docs.cloud.google.com/run/docs/reference/rest/v2/projects.locations.jobs/run)には重複排除用request IDがない。[IAM roles](https://docs.cloud.google.com/run/docs/reference/iam/roles)では実行・取消用の権限を分離できる。

## 費用と利用枠

公開のTier 1単価はCPU $0.000018/vCPU秒、RAM $0.000002/GiB秒。1 CPU・512 MiBで合計10 job時間なら、無料枠・クレジット適用前のcomputeは **$0.684**。2会議を1時間同時に動かすと2 job時間になる。無料枠は課金アカウント合計でCPU 240,000秒・RAM 450,000 GiB秒/月。配備時にregionとSKUを照合する。[Cloud Run pricing](https://cloud.google.com/run/pricing)

転送・image保存・build・ログ等は別料金。3guildへ64 kbpsずつ10時間送る場合、payloadは約0.805 GiBで、UDP/RTP/DAVE等のoverheadが加わる。東京からのDiscord通信に北米向けの無料転送枠は適用できない。[network pricing](https://cloud.google.com/vpc/network-pricing)、[Artifact Registry pricing](https://cloud.google.com/artifact-registry/pricing)

Google AI Proの公開特典には月$10のGoogle Cloud developer creditがある。適格なCloud製品に利用でき、Developer Programでの有効化とCloud Billingへの適用が必要。付与日は初回有効化日が基準で、期限は付与から1年。実アカウントへの適用は未確認。[特典FAQ](https://developers.google.com/profile/help/benefits)

Cloud Billingでは既存のGoogle payments profileを選択できるが、請求先設定と追加の確認が必要になる場合がある。[Billing設定](https://docs.cloud.google.com/billing/docs/how-to/create-billing-account)

Cloud Runのspend capは1 project・1 service・暦月単位で、割引やクレジット適用前の推定額を使う。反映には遅延があり、超過分が請求され得る。実行中Jobの即時停止や他サービスの料金制御には使えない。[spend capの制限](https://docs.cloud.google.com/billing/docs/how-to/budgets-spend-caps)

## ローカルで実施した検証

Node 24.19.0 / Linux x64 / AMD EPYC 9V45で、`@discordjs/voice` 0.19.2、`@discordjs/opus` 0.11.0、lockfile内の`@snazzah/davey` 0.1.12を使用した。

| 対象                         | 観測した結果                                                                                               |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 振り分けモデル7項目          | 3guildのmix-minus、送信のみpause、重複guild拒否、3→2継続、2者終了、独立2組と自己音声除外、制御断停止が成功 |
| 実ライブラリのcustom adapter | join/leaveのGateway payloadを捕捉し、destroy時の退室とadapter破棄を確認                                    |
| native DAVE                  | protocol 1のsession作成とkey package生成に成功。ready=falseを確認                                          |
| 実UDP                        | loopbackでOpus packet送受信・decodeに成功                                                                  |
| SIGTERM                      | 実子プロセスがUDP socketとtimerを閉じ、約5.56 msで自然終了                                                 |

計11項目に成功した。

合成PCMの入力packetを計測前に用意し、話者ごとに別のOpus decoder、送信先ごとに別のencoderを使った。各ケースで30秒相当の1,500 frameをdecode→mix→encodeした。全員が同時に発話する条件、20 ms/frame、出力64 kbpsで測った単発のmicrobenchmarkである。

| ケース          | 同時入力数 | 1秒分の音声に使ったCPU時間 | frame処理p95 / p99 | 計測後RSS  |
| --------------- | ---------- | -------------------------- | ------------------ | ---------- |
| A↔B、各5人      | 10         | 31.47 ms                   | 0.72 / 0.89 ms     | 96.09 MiB  |
| A/B/C、各5人    | 15         | 43.76 ms                   | 0.97 / 1.27 ms     | 107.96 MiB |
| A↔BとC↔D、各5人 | 20         | 51.89 ms                   | 1.23 / 1.43 ms     | 112.09 MiB |

ホストのpeak RSSは112.21 MiB。2組のケースも同一probe内で実行した。ネットワークとDAVEの暗号処理コストは計測に含まない。

### 再現方法

fixtureはダミーIDと合成音声を使い、Discordへ接続せずに実行できる。

```sh
cd docs/research/fixtures/cloud-run-voice
npm ci
node probe.mjs
docker build -t adteemo-cloud-run-voice-probe .
docker run --rm --network=none --cpus=1 --memory=512m --memory-swap=512m --read-only --cap-drop=ALL --pids-limit=64 adteemo-cloud-run-voice-probe
```

Dockerfileはprobe用。検証環境でimage内のnpm依存取得がtimeoutしたため、1 CPU・512 MiB制限での動作は未確認。

## 未検証の範囲

Cloud RunからDiscordへのUDP往復、DAVE鍵交換と実音声、制限付きコンテナ、通信品質、実課金は未検証。上の数値はhost上の合成音声処理だけを測ったもの。実機の受け入れ条件は[#172](https://github.com/akigami-net/ADTeemo/issues/172)で管理する。

Cloud Runの料金・通信仕様・IAM、クレジット、Discord/DAVE、音声ライブラリの更新時に再確認する。
