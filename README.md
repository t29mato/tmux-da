# tmux 道場（tmux-dojo）

tmux のキー操作を、本物の tmux と同じ画面で身につけるタイムアタック。分割・移動・全画面・ウィンドウ・コピーモードの問題を次々に解く。押すキーはいつも画面に出ているので、遊んでいるうちに指が覚える。

**▶ 今すぐ遊ぶ: https://t29mato.github.io/games/tmux-dojo/**

- **ブラウザ版（`web/`）**: 3 つのコースのタイムアタック。インストール不要。ランキング（ランキング）と端末の引き継ぎは任意
- **CLI 版（`./tmux-da`）**: 本物の tmux の中で 11 面を解く

## ブラウザ版（`web/`）

ページの中の小さな tmux で遊ぶ。`web/index.html` をそのまま開けば動く（`file://` でも静的サーバーでも）。名前か合言葉を付けるまでは一切通信しない。

| コース | 問題数 | 目安 | 中身 |
|---|---|---|---|
| 入門（手ならし・初めてはここ） | 15 | 12 秒 | 分割・移動・全画面・閉じる・ウィンドウの作成と切り替え。1 問 1 キー |
| 中級（腕試し） | 20 | 14 秒 | 大きさ・名前・入れ替え・ウィンドウを閉じる・スクロール（コピーモード）も混ざる |
| 上級（真剣勝負） | 16 | 18 秒 | 1 問で 2〜3 手の連続技 |
| 達人（使っている人へ） | 14 | 1 問 7〜25 秒 | tmux を使っている人向け。join-pane・swap-window・move-window・並べ方（prefix M-1〜M-5 と Space、完成図つき）・synchronize-panes・prefix q と番号・検索して行をコピー・rotate-window・キーのないコマンド（new-window -n、kill-session -t）。tmux 3.8 の既定どおりに動く |

- 問題の組は毎回同じで、順番だけが毎回ちがう。全部解くまでの時間を競う。違う操作は +2 秒（問題違い）
- **1 つのセッションが続く**: 1 回の挑戦は 1 つの tmux セッションの上で進む。解いたあとも、ペイン・ウィンドウ・全画面・いま居る場所はそのまま残り、次の問題はその場所から出る。最初の形は全員同じ（main に 3 ペイン、logs と build に 2 ペイン、main から始まる）。問題に足りないものがあるときだけ最小限で補い、一言出る。居場所は変えない
- **指示は平文**: やることは「左右に分割する（split）」「『座敷』へ移動する」「ウィンドウ 2:蔵 を閉じる」のように、動作を先に、tmux の言葉を添えて書く。部屋の名前（茶の間・座敷……）は札として残る
- **時間切れで飛ばさない**: 1 問は解けるまで終わらない。指示には答えの手順（手順）と押すキーがいつも出ている。目安を過ぎると行灯がともるが、先には進まない。タブを離れると自動で一時停止
- 結果は「記録」に残る。自己ベスト、五回平均、お手本タイムとの差、称号（見習い → 初段 → 三段 → 師範代 → 師範）、時間がかかった問題
- 「記録」の画面で、コースごとのタイムの移り変わりと、目安を超えがちな（苦手な）問題とそのキーが見られる
- **素の tmux の画面**: 遊ぶ画面は本物の tmux と同じ見た目（黒い端末、緑のステータスバー）。ペインは名前ではなく `prefix q` と同じ番号で示し、いま居るペインは緑の枠と番号。やることと次のキーは、いま居るペインのプロンプトのすぐ上にシェルのコメント（`#`）として出る。行き先のペインには点線と印、いま居るペインからの矢印（押すキーつき）
- **覚えた問題**: 目安以内・ミスなしで 3 回続けて解いた問題は、手順を畳む（目安を過ぎたら開く）。覚えるまで答えを読むだけにならないように
- **腕前**: コースごとに、そのコースの直近 5 回のペースから Lv.1〜30 と称号を出す（難しいコースに移っても Lv が下がって見えない）。上の帯の Lv はいちばん高いコースのもの。次の Lv まで 1 問題あたり何秒速くすればよいかも出る
- **はじめての回**: 入門の 1 回目は、分割から始まり最初の 3 問に「閉じる」がない専用の順番で出る（1 問目のカードに「ペイン = 画面の区画、ウィンドウ = タブ」）。今日の順番ではないのでランキングには載らない。各コースの 1 回目の結果は、帯・タイム・次の帯までの秒数だけ。お手本との差や Lv などは 2 回目から
- **上級・達人は 2 回目から手順なし**: 手順は 4 秒後か押し違いのあとに出る。出た問題の数は結果とランキングに「手順を見た N 問」と出る（帯はタイムどおり、ランキングにも載る）
- **稽古（手順なしで思い出す）**: 手順を畳んだまま 1 問ずつ出し続ける。手順は 4 秒後か押し違いのあとに出る（出た問題は「見た」と記録される）。入門を終えるまでは入門の問題だけから出る。出る問題は、実際の tmux でよく使う操作（移動・分割・全画面・ウィンドウ・スクロール・デタッチ）を多めに、最近つまずいた操作（押し違い・目安超え・手順を見た）をさらに多めに、同じ種類が続かないように選ぶ。やめる（Esc 2 回）か、選んだ問題数で終わり、手順なし・押し違いなしで続けて解けた最長を結果と記録に出す。ランキングには載らない
- **今日の出題**: 出題の順番は、その日（日本時間）は全員同じ。ランキングが運に左右されない。問題が狙うペインやウィンドウは、その順番と、そのときセッションにあるペインから同じ乱数で選ぶ
- **今日の達人**: 達人の問題から 1 日 1 問（日本時間の日付で決まり、全員同じ）。手順は畳んだまま（4 秒後か押し違いのあとに出て、見たことが記録とランキングに残る）。タイムと「押したキー ／ 標準」（標準手数: 手順どおりのキー数。少なく押せたら「標準より N キー少ない」）で競い、その日だけのランキングと連続日数がある。タイトルの「今日の問題」の下に 1 行で出る（D キーでも始まる）
- **練習（問題なしで自由に）**: 問題も時計も記録もない tmux の画面。キーも `:` のコマンドも全部試せる。タイトル画面（P）と稽古の結果から入り、Esc 2 回か「やめる」で戻る。下に、遊んだコースで覚えたキーの早見表（日本語、たためる）
- **本物の tmux に近い `:` プロンプト**: コマンド名は tmux と同じく、ほかと区別できるところまで縮めてよい（`kill-ses`、`swapw`、`selectl`）。あいまいなら `ambiguous command: kill, could be: …`、ないものは `unknown command:`（tmux 3.8 のコマンド表で判定）。`display-message`（`#S #W #I #P #{…}` を展開）、`send-keys -t`、`list-keys`・`show-messages`（`prefix ?`・`prefix ~`。q で閉じる一覧）、`show-options` がある。見るだけのコマンドと、tmux にあってゲームが再現しないコマンドは問題中でもミスにならない（そう出る）。ないコマンド・あいまいなコマンド・頼まれていない操作はミス
- **コピーモードの vi のキー**: `w b e W B E ^ 0 $ H M L f F t T ; , g G C-u C-d C-b C-f`、emacs の `M-f M-b M-< M->` も tmux 3.8 と同じ位置に動く。`V` で行ごと選べ、行をまるごとコピーする問題の手順と「標準」は `V` を使う
- **キーボードだけで回る**: タイトル画面で Enter（1〜4 でコースを選ぶ、D で今日の達人、K で稽古、P で練習、R で記録）、結果で Enter もう一度、Esc で戻る
- **成**: 解いた問題は「成」の印の下で部屋の動きを見せてから次へ（0.65 秒、時計は止まる。キーを押せばすぐ次へ）
- **隣のペインへの移り方**: 本物の tmux と同じく、端で押すと反対側のペインへ回り込み、全画面中に押すと全画面を解いて移る。手順は矢印に加えて別解（`o` で次のペインへ、`;` で直前のペインへ）も出す
- **自分の .tmux.conf**: タイトル画面の「キー設定」に貼ると、その合図とキーで遊べ、手順もそのキーで出る。読めるのは `set -g prefix`、ゲームにある操作への `bind` / `bind -n` / `bind -r` / `unbind`、vim-tmux-navigator（プラグインの既定どおり `Ctrl+h/j/k/l`、`Ctrl+\`、合図 → `Ctrl+l`）。`renumber-windows`、`break-pane -d`、縮めたコマンド名も読む。読めない行は理由つきで一覧に出す。自分の設定で遊んだ記録も、既定のキーの記録と同じランキングに載る
- **静か**: 右上の「静」で、タイトル画面の飾りの動きを止める（初めは止まっている）
- **影（ゴースト）**: 自分のベストか、今日の一番の走りと競う。1 問題解くたびに、影より何秒前か後ろかが出る
- **ランキング**: 名前を付けると、遊ぶたびに今日・今週・全期間のランキングに載る（ログイン不要）
- **引き継ぎ**: 「記録 → 引き継ぎ」に出る合言葉（例: `matsu-kaze-tsuru-482`）を別の端末で入れると、同じ記録が見られる
- 音は Web Audio で鳴らす（琴・拍子木・鈴。音のファイルは読み込まない）。右上の ♪ で消せる

```bash
open web/index.html                      # macOS
python3 -m http.server -d web 8000       # または http://localhost:8000/
```

- 合図（prefix）は tmux 標準の Ctrl+b。記録と設定は localStorage に残る（無くても動く）
- Mac で Ctrl+矢印が Mission Control に取られるときは、prefix のあと Option+矢印でも大きさを変えられる
- 狭い画面では画面下にキーの列が出るので、iPhone でも遊べる
- ダーク／ライトは OS 設定に従い、右上のボタンで切り替えられる

## サーバ（`server/`）

ランキングと引き継ぎのための小さな API。Cloudflare Workers ＋ D1（SQLite）。アカウントは無く、合言葉は SHA-256 だけを保存する。記録の検証（1 問あたり平均 0.4 秒未満、1 問 0.1 秒未満、合計が合わない記録、その日の出題順でない記録、途中で長く止まった記録、順番を変えた回は弾く）と、アドレスごとの回数制限（分ごと、合言葉の新規作成は日ごとも）をする。自分の .tmux.conf で遊んだ記録はランキングに「自分の設定」と出る。名前は見えない文字を落とし、制御文字や積み重ねたアクセントを弾く。

ランキングに載せる記録には、押したキーの記録（`klog`: キーごとの ms と表示名、問題ごとの開始 ms）が付く（`keylogs` 表）。サーバはそれが記録と合うか（キーの数、最後のキーの時刻 ≈ タイム、問題の切れ目 ≈ 各問の秒）と、人の手らしいか（間隔が 15 ms 未満のキーが 3 割を超える、間隔が全部同じ）を見て、合わなければ 400 で理由（`key log: …`）を返す。古いクライアントのキー記録なしの記録はこれまでどおり受ける。キー記録は影（`/v1/ghost` の `above=` で 1 つ上の人、`name=` でその人のベスト）と「この回を見る」（再生）に使う。名前のある人は遊んでいる .tmux.conf を公開できる（`/v1/conf`、8 KB まで、そのまま保存。`confs` 表）。ランキングの「自分の設定」がそのリンクになる。

`keylogs` と `confs` の表は Worker が初回に自分で作るが、本番のデプロイ前に手で作っておくのが確実（既存のデータには触らない）:

```bash
cd server
npx wrangler d1 execute tmux-da --remote --command "CREATE TABLE IF NOT EXISTS keylogs (key_hash TEXT NOT NULL, run_id TEXT NOT NULL, log TEXT NOT NULL, PRIMARY KEY (key_hash, run_id))"
npx wrangler d1 execute tmux-da --remote --command "CREATE TABLE IF NOT EXISTS confs (key_hash TEXT PRIMARY KEY, text TEXT NOT NULL, at TEXT NOT NULL)"
```

公開された設定を消すには（本人が消せない事情のとき）:

```bash
npx wrangler d1 execute tmux-da --remote --command "DELETE FROM confs WHERE key_hash = (SELECT key_hash FROM players WHERE name = 'その名前')"
```

```bash
cd server
npx wrangler d1 execute tmux-da --remote --file schema.sql   # 表を作る（初回だけ）
npx wrangler deploy
```

表を変えたときは `server/migrations/` に ALTER を置く（既存のデータに安全なものだけ）。Worker は初回に自分でも当てるが、デプロイ前に手で当てておくのが確実:

```bash
npx wrangler d1 execute tmux-da --remote --file migrations/0001-scores-own.sql
```

荒らしの名前や記録を消すには（合言葉は分からないので名前で）:

```bash
npx wrangler d1 execute tmux-da --remote --command "DELETE FROM scores WHERE key_hash = (SELECT key_hash FROM players WHERE name = 'その名前'); UPDATE players SET name = NULL WHERE name = 'その名前'"
```

ステージング（本番と別の Worker と D1）。試しの名前や記録はこちらへ送る。ページは `?api=staging` を付けるとこちらにつながる。

```bash
cd server
npx wrangler d1 execute tmux-da-staging --remote --file schema.sql   # 初回だけ
npx wrangler deploy --env staging      # https://tmux-da-api-staging.starrydata-mcp-cloudflare.workers.dev
```

## テスト

```bash
npm install          # Playwright と wrangler（初回だけ。npx playwright install chromium も）
npm test             # 全部
npm run test:unit    # 単体テストだけ（数秒）
scripts/test.sh game # unit | game | online | cli のどれか 1 つ
```

| 種類 | 場所 | 中身 |
|---|---|---|
| 単体 | `web/test/unit/` | コースと称号、記録（追加・移行・端末の合流・影・苦手）、通信（偽のサーバ相手） |
| 単体＋API | `server/test/` | 合言葉・記録の検証規則、キー記録の検証（Playwright で録った人の手の記録 `fixtures/keylogs.json` と、機械らしい記録）、API 全体を Node 内蔵の SQLite 上で（同期・名前・ランキング・影・公開設定・回数制限・CORS） |
| 結合（ゲーム） | `web/test/playthrough.mjs` | 本物のキーボードイベントで 3 つのコースを通す。手順だけで全種類解けるか、問題の境で居場所と部屋が引き継がれるか、指示の文字が動かないか、飛ばないか、一時停止、行の編集、音 |
| 結合（通信） | `web/test/online.mjs`, `server/smoke.mjs` | `wrangler dev --local` を立て、ブラウザ 2 つを 2 台の端末に見立てて同期・ランキング・影を通す |
| CLI 版 | `test/playthrough.sh` | 下を参照 |

push のたびに GitHub Actions（`.github/workflows/test.yml`）で全部が走る。

### CLI 版のテスト

```bash
test/playthrough.sh
```

キー操作の代わりに tmux のコマンドで全面を解き、見張り役が 1 面ずつ進めるかを確かめる。`script(1)` で疑似端末のクライアントをつなぐので、デタッチと再接続の面も試せる。

## 公開

ブラウザ版は [t29mato.github.io](https://github.com/t29mato/t29mato.github.io) の `games/tmux-dojo/` から配信している。`web/` を更新したら、隣にクローンしてあるサイトのリポジトリへコピーし、そちらでコミットして push する:

```bash
scripts/publish.sh            # ../t29mato.github.io/games/tmux-dojo/ にコピー（SITE_DIR で変更可）
```
