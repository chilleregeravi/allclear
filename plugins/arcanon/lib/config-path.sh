#!/usr/bin/env bash
# lib/config-path.sh — Shared config-path resolver.
#
# Usage:
#   source "$PLUGIN_ROOT/lib/config-path.sh"
#   cfg=$(resolve_arcanon_config)         # defaults to $PWD
#   cfg=$(resolve_arcanon_config "$dir")  # explicit directory
#
# Returns: "$dir/arcanon.config.json" unconditionally. Caller must test -f if needed.

resolve_arcanon_config() {
  local dir="${1:-$PWD}"
  printf '%s\n' "$dir/arcanon.config.json"
}
