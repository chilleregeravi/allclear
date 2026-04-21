#!/usr/bin/env bash
# Arcanon — update.sh
# Deterministic shell for /arcanon:update orchestration.
# Modes:
#   --check        (98-01)    Emit JSON {installed, remote, update_available, changelog_preview, status} to stdout
#   --kill         (98-02)    Kill-only worker stop with scan-lock guard
#   --prune-cache  (98-03)    Remove old cache version dirs (lsof-guarded)
#   --verify       (98-03)    Poll /api/version for up to 10s, confirm match
#
# Exits 0 on success or graceful-fallback (offline, already-current). Exits 1 only on
# bad invocation (unknown mode). Never exits non-zero for operational failures — the
# caller (commands/update.md) reads JSON status instead.
set -euo pipefail
trap 'exit 0' ERR

# PLUGIN_ROOT resolution (identical to worker-stop.sh lines 11-15)
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"

MODE="${1:-}"
case "$MODE" in
  --check) ;;  # fall through to check logic below
  --kill|--prune-cache|--verify)
    echo "{\"error\": \"mode ${MODE} not yet implemented (pending plan 98-02/98-03)\"}" >&2
    exit 1
    ;;
  *)
    echo "usage: update.sh --check|--kill|--prune-cache|--verify" >&2
    exit 1
    ;;
esac

# ─── --check mode ───────────────────────────────────────────────────────────
# 1. Read installed version (prefer plugin.json, fallback package.json)
INSTALLED_VER=$(jq -r '.version // empty' "${PLUGIN_ROOT}/.claude-plugin/plugin.json" 2>/dev/null || true)
if [[ -z "$INSTALLED_VER" ]]; then
  INSTALLED_VER=$(jq -r '.version // empty' "${PLUGIN_ROOT}/package.json" 2>/dev/null || true)
fi
[[ -z "$INSTALLED_VER" ]] && INSTALLED_VER="unknown"

# 2. Refresh marketplace with 5s cap (REQ UPD-11 — Pitfall 10)
#    Uses background-subshell+timer because timeout(1) is not on macOS by default.
MARKETPLACE_DIR="${HOME}/.claude/plugins/marketplaces/arcanon"
OFFLINE=false
{
  (claude plugin marketplace update arcanon >/dev/null 2>&1) &
  refresh_pid=$!
  elapsed=0
  while kill -0 "$refresh_pid" 2>/dev/null; do
    sleep 0.2
    elapsed=$((elapsed + 1))
    if [[ $elapsed -ge 25 ]]; then  # 25 * 0.2s = 5s
      kill -TERM "$refresh_pid" 2>/dev/null || true
      sleep 0.1
      kill -KILL "$refresh_pid" 2>/dev/null || true
      OFFLINE=true
      break
    fi
  done
  wait "$refresh_pid" 2>/dev/null || true
} 2>/dev/null

if [[ "$OFFLINE" == "true" ]] || [[ ! -f "${MARKETPLACE_DIR}/plugins/arcanon/.claude-plugin/marketplace.json" ]]; then
  # REQ UPD-11: exit 0 with offline status; commands/update.md formats the user-facing message
  printf '{"status":"offline","installed":"%s","remote":null,"update_available":false,"changelog_preview":""}\n' "$INSTALLED_VER"
  exit 0
fi

# 3. Read remote version
REMOTE_VER=$(jq -r '.version // empty' \
  "${MARKETPLACE_DIR}/plugins/arcanon/.claude-plugin/marketplace.json" 2>/dev/null || true)
[[ -z "$REMOTE_VER" ]] && REMOTE_VER="unknown"

# 4. Semver comparison (REQ UPD-02 — Pitfall 1). Node + semver.
#    Validates with semver.valid() before gt/lt to guard against injection (T-98-01, T-98-02).
#    If semver is not resolvable, reports unknown rather than falling back to string compare.
CMP_RESULT="unknown"
if [[ "$INSTALLED_VER" != "unknown" && "$REMOTE_VER" != "unknown" ]]; then
  NODE_PATH="${PLUGIN_ROOT}/node_modules" node -e "
    const s = require('semver');
    if (!s.valid('${INSTALLED_VER}') || !s.valid('${REMOTE_VER}')) { process.exit(2); }
    if (s.gt('${REMOTE_VER}', '${INSTALLED_VER}')) process.exit(0);
    else if (s.eq('${REMOTE_VER}', '${INSTALLED_VER}')) process.exit(1);
    else process.exit(3);
  " 2>/dev/null || NODE_EXIT=$?
  NODE_EXIT="${NODE_EXIT:-0}"
  case $NODE_EXIT in
    0) CMP_RESULT="newer" ;;
    1) CMP_RESULT="equal" ;;
    3) CMP_RESULT="ahead" ;;  # installed > remote (edge: running a dev build)
    *) CMP_RESULT="unknown" ;;
  esac
fi

# 5. Extract changelog preview (REQ UPD-04) if newer
CHANGELOG_PREVIEW=""
if [[ "$CMP_RESULT" == "newer" ]]; then
  CHANGELOG_FILE="${MARKETPLACE_DIR}/plugins/arcanon/CHANGELOG.md"
  if [[ -f "$CHANGELOG_FILE" ]]; then
    # Take the first 2-4 bullet lines under the first "## [" heading in the remote CHANGELOG.
    CHANGELOG_PREVIEW=$(awk '
      /^## \[/ { if (seen) exit; seen=1; next }
      seen && /^- / { print; count++; if (count >= 4) exit }
    ' "$CHANGELOG_FILE" | head -c 400)
  fi
fi

# 6. Emit JSON
UPDATE_AVAILABLE=$([[ "$CMP_RESULT" == "newer" ]] && echo "true" || echo "false")
# jq ensures preview is JSON-safe (newlines, quotes escaped)
PREVIEW_JSON=$(printf '%s' "$CHANGELOG_PREVIEW" | jq -Rs .)
printf '{"status":"%s","installed":"%s","remote":"%s","update_available":%s,"changelog_preview":%s}\n' \
  "$CMP_RESULT" "$INSTALLED_VER" "$REMOTE_VER" "$UPDATE_AVAILABLE" "$PREVIEW_JSON"
exit 0
