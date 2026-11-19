# 合意要件を実装するための外部機能調査

- Type: research
- Status: current
- Summary: 日時調整、Discord/Riot、音声中継、情報取得について確認済み事実と未検証の運用条件を分ける。
- Read when: 自動化の可否、外部API、手動補助、調査Issueの完了条件を決めるとき。
- Related: [合意要件](../../REQUIREMENTS.md), [実装順](../adr/0007-product-requirements-baseline.md)
- Code: [現行registry](../../bot/src/common/command_registry.ts), [現行Riot client](../../api/src/riot_api.ts)
- Tests: none（新機能の外部統合試験は未実施）。既存mock testを実APIの証明にしない。
- Reviewed: 2026-11-19
- Verified: ヒアリング中の公開資料調査とFxEmbed公開APIのサンプル取得。2026-11-19に保存済みJSONのcode=200と内容を再確認。Discord/Riotの本人同意・実音声接続は未検証。
- Observed: ヒアリング中に公開資料・FxEmbed応答を確認した個々の時刻は未記録。2026-11-19は証拠整理日であり、全外部資料の再取得日ではない。

本書はnon-normative。ユーザーの希望は[合意要件](../../REQUIREMENTS.md)、採用する進め方は[ADR 0007](../adr/0007-product-requirements-baseline.md)に置く。API仕様・利用条件は着手時に再確認する。

## 日時調整

[Doodle](https://help.doodle.com/en/articles/9457279-how-do-i-participate-in-a-group-poll)の候補投票と[WhenIsGood](https://www.whenisgood.net/FAQ)の範囲入力を比較し、5〜10人のDiscord利用では候補投票を先に、候補が合わない時は範囲入力へ広げる設計を採る。[日程交渉の研究](https://www.ifaamas.org/Proceedings/aamas2014/aamas/p1345.pdf)は調整回数と不便さのtrade-offを扱う理論・simulationであり、「3〜5候補が実証的に最適」という根拠にはしない。

[Google Calendarの空き時間検索](https://support.google.com/calendar/answer/6294878?hl=ja)は共有権限のある予定に依存するため、全員のカレンダー連携を参加条件にしない。[DiscordネイティブPoll](https://docs.discord.com/developers/resources/poll)は作成後の編集制限・選択肢数の制限があるため、候補追加・○△×・未回答・企画との同期を自前Componentsで扱う。[Components仕様](https://docs.discord.com/developers/components/reference)を参照し、modalはテキスト専用という古い前提を使わない。

検証: スマートフォンで文字入力なしの回答/変更、追加候補が未回答、同じ人の連続空き時間、陣営別人数をfixtureとUI試験で確認する。

## Riot/Discord連携と試合取得

[Riot公式のDiscord連携](https://www.riotgames.com/ja/riot-games-discord-account-linking)はゲーム側の招待等に利用できるが、第三者BotへのRiot ID/ロビー/履歴APIの一般開放を意味しない。[Discordの議論 #8430](https://github.com/discord/discord-api-docs/discussions/8430)には新しい連携が従来のconnectionsに返らない報告がある。[Application identities](https://docs.discord.com/developers/resources/application-identity-profile#get-application-identities-by-user-id)も自applicationの範囲であり、他社連携を自由に参照する根拠にならない。

[RSO](https://developer.riotgames.com/docs/lol#rso-integration)・[RSO match API](https://developer.riotgames.com/apis#lol-rso-match-v1)・[Tournament API](https://developer.riotgames.com/docs/lol#tournament-api)は別の承認・利用条件を持つ。Tournamentの試合設定、ロビーevent、結果callbackがあることを、一般の手作業customや普通のゲーム内ロビーが常時取得できることへ拡張しない。[custom取得の関連報告](https://github.com/RiotGames/developer-relations/issues/472)も確認対象とする。Local Client APIは利用者側の追加ソフトが必要になり、Bot+Webのみの初期構成には含めない。

メイヘムは[報告 #1109](https://github.com/RiotGames/developer-relations/issues/1109)、[報告 #1204](https://github.com/RiotGames/developer-relations/issues/1204)、[OP.GG案内](https://help.op.gg/hc/en-us/articles/60909599637657-How-to-Check-ARAM-Mayhem-Match-History)を参照。デスクトップによる収集実績は通常のMatch-v5で取得できる証拠ではない。Bot+Webでの詳細取得は未確立であり、custom向け画像補助をメイヘムへ義務化しない。

着手時にモード×情報項目×API/認証×取得時点の能力表を作る。平均ランクは観測したrankを説明可能な方法で集計し、LP変動は取得時点や同時進行試合による曖昧さを明記する。過去のrank/真のMMR、全期間の履歴取得を保証しない。利用権がなければ手入力等で主要flowを成立させる。

## Bot音声中継

[discord.js guide](https://discordjs.guide/voice/voice-connections)、[connection store](https://github.com/discordjs/discord.js/blob/main/packages/voice/src/DataStore.ts)、[voice package](https://github.com/discordjs/discord.js/blob/main/packages/voice/README.md)により、同じBotアカウントの同一guild内で異なるVCへ同時接続する構成を前提にしない。別guildの3者会議や互いに重ならないA↔B/C↔Dは構成上の候補である。これは参加者を同じサーバーのRed/Blue VCへ移動する操作とは別の制限。

受信音声の混合・配信、[DAVE](https://docs.discord.com/developers/topics/voice-connections#end-to-end-encryption-dave-protocol)、遅延、負荷、再接続・echo抑制は実験が必要。実音声中継の試験は未実施。「可能」は設計候補であり本番保証ではない。専用環境で片方向pause、3者の1人退出、独立2会議、同一guild競合を検証して採否を記録する。成立しない場合はM4の制約として提示し、未達のまま中継完了にはしない。

2026-11-19の[配備先調査](./zero-cost-deployment.md)では、採用するCloudflare Workers構成のUDP非対応を確認した。[ADR 0008](../adr/0008-zero-cost-cloudflare-deployment.md)の通常機能の配備先決定を、音声中継の実行先確定とみなさない。追加費用0円・カード追加なしの条件で採用できる音声実行先は未確定であり、VOICE要件を保持したままM4の制約とする。

## 導入と絵文字

[Guild API](https://docs.discord.com/developers/resources/guild)、[channel権限](https://docs.discord.com/developers/resources/channel#edit-channel-permissions)、[role階層](https://docs.discord.com/developers/topics/permissions#permission-hierarchy)に従う。role/channel作成に必要な権限と、channel overwriteの変更権限を分けて確認する。Administratorを一律に要求しない。

[Application-owned emoji](https://docs.discord.com/developers/resources/emoji#application-owned-emoji)を採用する。Bot専用のためguild絵文字slotを使わず、各サーバーへの追加を要求しない。導入fixtureは権限不足・高位roleの参照/編集の違い・途中失敗と再実行を含める。

## 公式ニュースとRioterプレビュー

[FxEmbed公開API](https://docs.fxembed.com/api/introduction)と[OpenAPI定義](https://github.com/FxEmbed/FxEmbed/blob/main/docs/specs/fxtwitter-openapi.json)を調べ、Xの有料API/keyや個人cookieなしのサンプル取得に成功した。参照したspec blobは`b227a8817b72a551e2a7f39211e864d93f290dd8`。採用候補はFxEmbedであり、第三者Reddit転載を本人の一次情報へ置き換える案ではない。

| 観測した経路                                                      | 確認結果                                                                                                                                                                                  |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/2/profile/RiotPhroxzon/statuses?count=10&with_replies=1`        | HTTP 200/code 200。投稿・返信を取得。引用/前後関係/他者の投稿も混ざるためauthor IDの照合が必要。                                                                                          |
| `/2/thread/2120428437378896095`                                   | [26.23 Preview](https://x.com/RiotPhroxzon/status/2120428437378896095)の本文1866文字と添付画像を取得。画像1202×649を目視確認。                                                            |
| `/2/search` に `from:RiotPhroxzon to:RiotPhroxzon filter:replies` | HTTP 200/code 200。本人の返信を取得。検索だけで対象threadへの所属を保証しない。                                                                                                           |
| `/2/thread/2009764739560419639`                                   | [26.01b Preview](https://x.com/RiotPhroxzon/status/2009764739560419639)と[本人の修正返信](https://x.com/RiotPhroxzon/status/2009768869452447774)を取得。同じauthor ID、返信先rootを確認。 |

RiotPhroxzonの観測author IDは`1227269677`。表示名だけで本人判定しない。追加指定者も同様に識別する。`with_replies`だけで本人の全補足を取得したとはみなさず、thread/conversation/search・cursor・重複する期間の巡回を組み合わせ、対象rootまでの返信関係を確認する。`since`による204は現在page内で新しい投稿がない場合があり、全履歴に新規投稿なしの保証にはしない。

本番前に継続取得・欠落・rate limit・利用条件・削除訂正への追従を検証する。普段は低頻度、投稿予定付近に集中し、時差/DST/遅延にも対応する。本文だけでなく画像中の数値・変更対象・自己返信の訂正を照合する。停止時は未確認を表示し、古い内容を最新確認済みにしない。サンプル成功を永続的な可用性・無料提供の保証にしない。

RSSHubはcookieや別認証方式の運用負担があるため主経路にしない。Nitter等の継続運用を未確認のままfallbackと約束しない。外部SNS内容の保存条件は戦績の長期保持とは別に確認する。

## Wikiとティーモ

[RiotのWiki案内](https://www.leagueoflegends.com/ja-jp/news/announcements/the-official-league-of-legends-wiki/)と[League of Legends Wiki](https://wiki.leagueoflegends.com/en-us/)を出典候補とする。ページ取得/再利用条件、出典・版・更新日、引用方法を確認する。資料中の命令をBotへの指示として扱わず、外部知識を勝手に混ぜない。LoL外/根拠なし/古いページ/追加質問の評価例を先に作る。

ティーモは[公式開発記事](https://www.leagueoflegends.com/ja-jp/news/dev/dev-scouting-out-teemo/)・[公式紹介](https://www.leagueoflegends.com/ja-jp/champions/teemo/)等の公式表現を分析する。[日本語Wikiの台詞資料](https://www.loljp-wiki.jp/wiki/?Champion%2FTeemo)は二次資料として区別する。大量の台詞転載や音声再現を要求するものではない。既存の文体資料を再評価し、誤案内や数値変更なしで人格・口調を表現できるかを例文で確認する。

## 再確認条件

各外部統合の実装開始時、仕様/認証/利用条件/ライブラリ更新時、取得欠落・権限エラー・音声不調が生じた時に該当資料とサンプルを再確認する。検証した日・対象・制限を追記し、文書整理日で過去の未検証点を消さない。
