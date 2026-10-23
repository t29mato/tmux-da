-- scores.own: 1 when the run was played on the player's own .tmux.conf.
-- The Worker adds this itself on first use; run it by hand to be sure:
--   npx wrangler d1 execute tmux-da --remote --file migrations/0001-scores-own.sql
-- (fails harmlessly with "duplicate column name" if it is already there).
ALTER TABLE scores ADD COLUMN own INTEGER NOT NULL DEFAULT 0;
