#!/usr/bin/env bash
set -euo pipefail

plugin_id="omadoist"
target="${XDG_CONFIG_HOME:-$HOME/.config}/omarchy/plugins/$plugin_id"

if [[ -x $target/bin/omadoist ]]; then
  "$target/bin/omadoist" uninstall
elif command -v omadoist >/dev/null 2>&1; then
  omadoist uninstall
fi

if command -v omarchy >/dev/null 2>&1; then
  omarchy plugin remove "$plugin_id" --yes 2>/dev/null || true
fi
rm -rf "$target"
echo "omadoist removed. Your token is still in ${XDG_CONFIG_HOME:-$HOME/.config}/omadoist/."
