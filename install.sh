#!/usr/bin/env bash
# Manual install from a checkout, for people who did not use
# `omarchy plugin add`. Copies a clean tree (no node_modules, no .git) into
# the Omarchy plugins directory, enables the bar widget, and runs the same
# `omadoist setup` the panel's "Set up" button runs.
set -euo pipefail

root="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
plugin_id="omadoist"
plugin_home="${XDG_CONFIG_HOME:-$HOME/.config}/omarchy/plugins"
target="$plugin_home/$plugin_id"

command -v omarchy >/dev/null 2>&1 || { echo "omarchy is required (Omarchy 4+)." >&2; exit 1; }

if [[ -L $target ]]; then
  rm -f "$target"          # an older symlinked install
fi
mkdir -p "$target"
rsync -a --delete \
  --exclude node_modules --exclude .git --exclude bun.lock --exclude '*.bak.*' \
  "$root/" "$target/"
echo "→ $target"

omarchy plugin validate "$target"

if omarchy-shell shell ping >/dev/null 2>&1; then
  omarchy-shell shell rescanPlugins
  if omarchy plugin list | awk -v id="$plugin_id" '$1 == id && $2 == "enabled" { found = 1 } END { exit !found }'; then
    echo "→ $plugin_id already in the bar"
  else
    omarchy plugin enable "$plugin_id"
  fi
else
  echo "→ shell not running; later: omarchy plugin enable $plugin_id"
fi

"$target/bin/omadoist" setup
