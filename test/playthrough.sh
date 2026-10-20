#!/usr/bin/env bash
# Plays all levels with tmux commands (not keystrokes) and checks that the
# watcher advances each one. A pty client is attached with script(1) so the
# popups and the attach/detach level behave as they would for a player.
#
#   test/playthrough.sh

set -u
cd "$(dirname "$0")/.."
GAME="$PWD/tmux-da"

export XDG_STATE_HOME
XDG_STATE_HOME=$(mktemp -d)
STATE="$XDG_STATE_HOME/tmux-da"
unset HERDR_ENV TMUX
# CI runners have no terminal type; tmux will not attach to a "dumb" one.
case "${TERM:-dumb}" in dumb|unknown) export TERM=xterm-256color ;; esac

t() { tmux -L tmux-da "$@"; }
level() { cat "$STATE/level" 2>/dev/null; }
target() { cat "$STATE/target"; }

# script(1) takes the command as arguments on macOS/BSD and as -c on Linux.
ATTACH="tmux -L tmux-da attach -t adv"
pty() {
  if script --version >/dev/null 2>&1; then script -q -c "$ATTACH" /dev/null
  else script -q /dev/null $ATTACH; fi
}

CLIENT_PID=
ATTACH_LOG=$(mktemp)
attach() {
  (sleep 600 | pty) >"$ATTACH_LOG" 2>&1 &
  CLIENT_PID=$!
  for _ in $(seq 50); do
    [ -n "$(t list-clients -F x 2>/dev/null)" ] && return 0
    sleep 0.1
  done
  echo "client did not attach:"; cat "$ATTACH_LOG"; return 1
}

fail=0
expect_level() {
  local want=$1 what=$2
  for _ in $(seq 50); do
    [ "$(level)" = "$want" ] && { echo "ok   $what"; return 0; }
    sleep 0.1
  done
  echo "FAIL $what (level is $(level), wanted $want)"
  fail=1
}

cleanup() {
  "$GAME" reset >/dev/null 2>&1
  [ -n "$CLIENT_PID" ] && { kill "$CLIENT_PID"; wait "$CLIENT_PID"; } 2>/dev/null
  pkill -f "script -q.*tmux -L tmux-da" 2>/dev/null
  rm -rf "$XDG_STATE_HOME"
}
trap cleanup EXIT

"$GAME" reset >/dev/null 2>&1
"$GAME" start --no-attach --prefix C-b || exit 1
attach || exit 1

t split-window -h -t adv:;                    expect_level 2 "1 split left/right"
t split-window -v -t adv:;                    expect_level 3 "2 split top/bottom"
t select-pane -t "$(target)";                 expect_level 4 "3 focus the treasure pane"
t resize-pane -Z -t adv:;                     expect_level 5 "4 zoom"
t kill-pane -t "$(target)";                   expect_level 6 "5 close the monster pane"
t resize-pane -t "$(target)" -L 12;           expect_level 7 "6 resize"
t new-window -t adv;                          expect_level 8 "7 new window"
t rename-window -t adv: camp;                 expect_level 9 "8 rename to camp"
t select-window -t adv:home;                  expect_level 10 "9 back to home"
t select-pane -t "$(target)"
t copy-mode -t "$(target)"
t send-keys -t "$(target)" -X history-top;    expect_level 11 "10 copy mode to the top"
t detach-client -a 2>/dev/null; t detach-client 2>/dev/null
{ kill "$CLIENT_PID"; wait "$CLIENT_PID"; } 2>/dev/null
sleep 1
[ "$(level)" = 11 ] && echo "ok   11 still waiting while detached" || { echo "FAIL 11 advanced while detached"; fail=1; }
attach;                                       expect_level 12 "11 detach and come back"

exit $fail
