#!/usr/bin/env bash
# Copy the browser version into the t29mato.github.io checkout, where it is
# served at https://t29mato.github.io/games/tmux-dojo/. Commit and push there.
# The copy's js/version.js gets the deploy number (this is the Nth commit of
# games/tmux-dojo there), the commit and the day, so publish committed work.
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
site="${SITE_DIR:-$here/../t29mato.github.io}"
[ -d "$site/games" ] || { echo "site checkout not found: $site" >&2; exit 1; }
if [ -n "$(git -C "$here" status --porcelain -- web)" ]; then
  echo "web/ has uncommitted changes: commit them first (the version names the commit)" >&2
  exit 1
fi
rsync -a --delete --exclude test/ --exclude .DS_Store "$here/web/" "$site/games/tmux-dojo/"
deploy=$(( $(git -C "$site" rev-list --count HEAD -- games/tmux-dojo) + 1 ))
commit="$(git -C "$here" rev-parse --short=7 HEAD)"
day="$(TZ=Asia/Tokyo date +%Y-%m-%d)"
sed -i '' -E "s/deploy: [0-9]+, commit: '[^']*', at: '[^']*'/deploy: $deploy, commit: '$commit', at: '$day'/" "$site/games/tmux-dojo/js/version.js"
grep -q "deploy: $deploy," "$site/games/tmux-dojo/js/version.js" || { echo "could not stamp js/version.js" >&2; exit 1; }
echo "copied web/ -> $site/games/tmux-dojo/ (deploy $deploy, $commit)"
