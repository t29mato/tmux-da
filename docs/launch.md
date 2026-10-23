# 公開の下書き

投稿は自分の手で。どれも、そのまま貼れる形にしてある。動画は 37 秒の上級プレイ（英語）。

- 英語: https://t29mato.github.io/games/tmux-dojo/?lang=en
- 日本語: https://t29mato.github.io/games/tmux-dojo/
- 数字の確認: `npm run stats`（始めた人、1 問目を解いた人、最後まで解いた人、2 日目に来た人）

## Show HN（英語）

Title:

    Show HN: tmux Dojo – learn tmux keys in a browser time attack

URL: https://t29mato.github.io/games/tmux-dojo/?lang=en

First comment:

    I kept forgetting tmux keys between the times I needed them, so I made a
    small game that drills them on a screen that behaves like tmux: panes,
    windows, sessions, copy mode (scrollback, search, copy and paste),
    detach and attach.

    - The keys are tmux's defaults (Ctrl+b, then %, ", o, z, x, c, l, !, d,
      [ …), and the next key is always on screen, so a beginner can finish
      the first course. Three courses, 15 to 20 questions each; the top one
      has sessions (new -s, switch, tmux attach -t from outside the game's
      shell).
    - Paste your own .tmux.conf and it plays with your bindings (prefix,
      bind/unbind, -n root keys, -r repeats, vim-tmux-navigator). Lines it
      can't use are listed with the reason.
    - Once you've solved a question five times quickly, its steps hide and
      you recall it; a drill mode asks only from memory, weighting what you
      get wrong. Your time per question gives a level and a dojo title
      (Apprentice up to Shihan).
    - Every course asks the same order for everyone each day (JST), with a
      daily ranking and a ghost of today's best to race. Results share as a
      row of squares, Wordle style.
    - No build, no account. Records stay in the browser unless you add a
      name for the ranking or a sync key to carry them to another device.

    It's plain JS; the server is a Cloudflare Worker with D1 for the
    rankings. I'd love to hear which tmux behavior it gets wrong.

## Reddit r/tmux（英語）

Title:

    I made a browser game to drill tmux keys (works with your own .tmux.conf)

Body:

    tmux Dojo: https://t29mato.github.io/games/tmux-dojo/?lang=en

    Questions like "go to pane 2", "zoom it", "swap it to the top left",
    "rename the window", "find the WARN line in the scrollback", "detach,
    then attach to the work session" come one after another against the
    clock, with tmux's default keys. Paste your .tmux.conf and the steps
    show your keys instead (vim-tmux-navigator included). Questions you can
    do fast fold their steps away, and a drill mode asks only from memory.
    Same order for everyone each day, with a daily ranking.

    Feedback on anything that doesn't match real tmux is very welcome.

## X（日本語）

    tmux のキー操作を、本物と同じ画面でタイムアタックで覚えるゲームを作りました。
    分割・移動・全画面・入れ替え・コピーモード。押すキーはいつも画面に出ています。
    自分の .tmux.conf を貼るとそのキーで遊べます。今日の問題はみんな同じ順番。
    https://t29mato.github.io/games/tmux-dojo/

## Zenn / Qiita の記事（日本語）の骨組み

1. tmux のキーが覚えられない理由（使う間隔が空く、prefix のあとに押すキーが多い）
2. 本物と同じ画面で 1 問ずつ解く。指示はいつも画面に出ている
3. 自分の .tmux.conf をそのまま貼れる。読めない行は理由つきで返す
4. 今日の問題とランキング、結果のシェア
5. 作り方（ビルドなしの JS、Cloudflare Workers と D1）
6. 本物と違う所の報告がほしい
