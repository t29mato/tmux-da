#!/usr/bin/env bash
# Copy the browser version into the t29mato.github.io checkout, where it is
# served at https://t29mato.github.io/games/tmux-da/. Commit and push there.
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
site="${SITE_DIR:-$here/../t29mato.github.io}"
[ -d "$site/games" ] || { echo "site checkout not found: $site" >&2; exit 1; }
rsync -a --delete --exclude test/ --exclude .DS_Store "$here/web/" "$site/games/tmux-da/"
echo "copied web/ -> $site/games/tmux-da/"
