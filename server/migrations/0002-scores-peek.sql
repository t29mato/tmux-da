-- scores.peek: 1 when the 手順 came out during the run (今日の達人 is played
-- without it). The Worker adds this itself on first use; run it by hand to be sure:
--   npx wrangler d1 execute tmux-da --remote --file migrations/0002-scores-peek.sql
-- (fails harmlessly with "duplicate column name" if it is already there).
ALTER TABLE scores ADD COLUMN peek INTEGER NOT NULL DEFAULT 0;
