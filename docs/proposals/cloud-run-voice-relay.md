# Cloud Run Jobsによる音声中継案

- Type: proposal
- Status: proposed
- Summary: Cloudflareで中継を制御し、必要な間だけCloud Run Jobsで音声を処理する。
- Read when: 音声中継の起動停止、接続管理、認証を設計するとき。
- Related: [音声検証 #172](https://github.com/akigami-net/ADTeemo/issues/172), [中継制御 #174](https://github.com/akigami-net/ADTeemo/issues/174)
- Code: none（製品への音声中継は未実装）。
- Tests: [独立probe](../research/fixtures/cloud-run-voice/probe.mjs), [検証結果](../research/cloud-run-voice-relay.md)
- Reviewed: 2026-11-25
- Verified: 2026-11-24、独立probe。Cloud RunとDiscordの実接続は未検証。

## 構成

[全体構成図](../integrations/architecture.md#全体構成)の音声部分を担う。Cloudflareが操作権限・合意・中継状態を管理し、Jobが受信・復号・Opus変換・混合・送信を行う。音声はメモリ上で処理する。DAVEは各VCとの接続で終端し、混合後に再暗号化する。

常駐VMを持たず、会議の開始と終了をJobの実行期間に合わせられる。一方、起動待ちと接続の再確立が必要になり、実行中の待機時間にも課金される。

| 通信               | 経路                                                    |
| ------------------ | ------------------------------------------------------- |
| BotのメインGateway | Discord ↔ 単一DO                                        |
| 中継制御           | JobからDOへ張るWSS                                      |
| 入退室情報         | `@discordjs/voice`のcustom adapter ↔ DO ↔ メインGateway |
| 音声               | Job ↔ 各VCのVoice WebSocket・UDP                        |

Bot tokenはCloudflareで保持し、Jobには対象VCの接続情報だけを渡す。

## 中継の単位

1会議につき1回のJob実行（execution）・1 taskとする。A/B/Cの3者会議は1 Job、A↔BとC↔Dは2 Jobs。同じBotは1guild内の複数VCへ同時参加できない。同じguildを複数の会議へ重複予約させない。

送信先には他guildの音声だけを混合し、Bot自身の音声を入力から除く。一時停止は自guildからの送信だけを止め、受信を維持する。相手向けの状態や通知へ停止フラグを含めない。

## 起動と停止

1. Workerが操作権限・双方の合意・集合先を確認する。DOが中継IDと世代番号を作り、guild、同時実行枠、最大実行時間を予約する。
2. Jobs APIを呼び、operation/execution IDを保存する。JobはWSS接続後に実行leaseを取得し、対象VCへ接続する。全VCが準備できてから「中継中」と表示する。
3. 制御断では転送を止め、再認証と状態確認後に再開する。旧世代やleaseを失ったJobの入退室操作は拒否する。
4. 2者の片側停止では全体を終了する。3者から1者が離脱した場合は、そのguildだけを外して残り2者を継続する。
5. 終了時は音声queueを破棄し、退室を指示してVoice WS/UDPを閉じ、exit 0で終了する。応答しないJobは取消APIで止め、終了を照合して予約を解放する。

run要求には重複排除用request IDがないため、応答喪失時に無条件で再実行しない。起動予約・operation・executionを照合し、重複Jobはlease取得前に終了させる。

## 検証用の実行設定

| 項目         | 初期値                                                      |
| ------------ | ----------------------------------------------------------- |
| region       | `asia-northeast1`                                           |
| runtime      | Node 24.19.0 / Linux amd64、native Opus・DAVE               |
| task         | 1 CPU、512 MiB、taskCount 1、parallelism 1                  |
| 終了と再試行 | timeout 3,600秒、maxRetries 0                               |
| 同時実行     | DO側でexecutionを最大2に制限                                |
| 通信         | public egress。VPC connector・Cloud NATは初期構成に含めない |
| 音声         | 48 kHz、20 ms/frame、送信先ごとにOpus 64 kbps               |

`parallelism`はexecution内のtask数を制限する設定であり、別executionの起動数はDOで制御する。上の値は実機検証の初期値とし、性能・品質の測定後に運用上限を決める。

## 認証と費用管理

起動用identityとJobのruntime service accountを分離する。起動用には対象Jobの実行・取消権限と状態照会権限を限定して与える。初期案は専用service accountの認証をWorker secretで管理する方式。JobのWSS接続ではGoogle発行identity tokenのissuer・audience・subjectと、短期の中継権限を検証する。

起動前に最大実行時間分を予約し、利用枠・クレジットが不足または失効した場合は新規起動を止める。実行時間・再試行・同時実行の制限を組み合わせる。料金とspend capの制限は[調査結果](../research/cloud-run-voice-relay.md#費用と利用枠)を参照する。

## 採用条件

Cloud RunからのUDP往復、DAVEによる実音声、2者・3者・独立2組の分離、障害時の停止、運用予算を実機で確認する。手順と受け入れ条件は[#172](https://github.com/akigami-net/ADTeemo/issues/172)で管理し、採用時にADRへ反映する。
