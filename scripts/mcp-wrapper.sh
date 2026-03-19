#!/usr/bin/env bash
# Wrapper to launch the Ligamen MCP server.
# Resolves CLAUDE_PLUGIN_ROOT from env or falls back to script-relative path.
_R="${CLAUDE_PLUGIN_ROOT:-}"
[ -z "$_R" ] && _R="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec node "$_R/worker/mcp/server.js"
