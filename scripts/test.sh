#!/usr/bin/env bash
# Every test, in order of speed:
#   1. unit      web/test/unit (levels, records, net) and server/test (rules, the API on SQLite)
#   2. game      web/test/playthrough.mjs: the browser game end to end (Playwright)
#   3. online    web/test/online.mjs + server/smoke.mjs against `wrangler dev --local`
#   4. cli       test/playthrough.sh: the real-tmux version (skipped without tmux)
#
#   scripts/test.sh            all of them
#   scripts/test.sh unit       just one part (unit | game | online | cli)
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$PWD
only=${1:-all}
want() { [ "$only" = all ] || [ "$only" = "$1" ]; }
step() { printf '\n== %s ==\n' "$1"; }

if want unit; then
  step unit
  node --test 'web/test/unit/*.test.mjs' 'server/test/*.test.mjs'
fi

if want game; then
  step game
  node web/test/playthrough.mjs
fi

if want online; then
  step online
  PORT=${PORT:-8788}
  LOG=$(mktemp)
  rm -rf server/.wrangler/state
  (cd server && npx wrangler d1 execute tmux-da --local --file schema.sql >/dev/null)
  (cd server && exec npx wrangler dev --local --port "$PORT" >"$LOG" 2>&1) &
  SERVER=$!
  trap 'kill $SERVER 2>/dev/null || true; pkill -f "wrangler dev --local --port $PORT" 2>/dev/null || true' EXIT
  for _ in $(seq 60); do curl -s -o /dev/null "http://localhost:$PORT/v1/board?course=easy&span=today" && break; sleep 1; done
  curl -s -o /dev/null "http://localhost:$PORT/v1/board?course=easy&span=today" || { cat "$LOG"; echo 'server did not start'; exit 1; }
  API=http://localhost:$PORT node server/smoke.mjs
  API=http://localhost:$PORT node web/test/online.mjs
fi

if want cli; then
  step cli
  if command -v tmux >/dev/null; then "$ROOT/test/playthrough.sh"; else echo 'tmux not found: skipped'; fi
fi

printf '\nall tests passed\n'
