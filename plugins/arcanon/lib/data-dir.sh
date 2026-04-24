#!/usr/bin/env bash
# lib/data-dir.sh — Shared data directory resolver.
#
# Usage:
#   source "$PLUGIN_ROOT/lib/data-dir.sh"
#   dir=$(resolve_arcanon_data_dir)
#
# Preference order:
#   1. $ARCANON_DATA_DIR (explicit override)
#   2. $HOME/.arcanon    (default — caller owns mkdir)

resolve_arcanon_data_dir() {
  if [[ -n "${ARCANON_DATA_DIR:-}" ]]; then
    printf '%s\n' "$ARCANON_DATA_DIR"
    return 0
  fi
  printf '%s\n' "$HOME/.arcanon"
}
