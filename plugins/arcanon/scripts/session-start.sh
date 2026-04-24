#!/usr/bin/env bash
# Arcanon — session-start.sh
# Fires on SessionStart and UserPromptSubmit (UserPromptSubmit fallback for upstream bug #10373).
# Injects project type and available arcanon commands into session context exactly once.
# Non-blocking: always exits 0.
set -euo pipefail

# Non-blocking trap: any unexpected error exits 0 silently
trap 'exit 0' ERR

# SSTH-04: Disable guard — if set to any non-empty value, exit silently
[[ -n "${ARCANON_DISABLE_SESSION_START:-}" ]] && exit 0

# SSTH-03: Require jq for JSON parsing; if unavailable, exit 0 silently (never block)
if ! command -v jq >/dev/null 2>&1; then
  exit 0
fi

# Read full stdin JSON
INPUT=$(cat)

# Extract fields from stdin JSON
SESSION_ID=$(printf '%s\n' "$INPUT" | jq -r '.session_id // empty')
CWD=$(printf '%s\n' "$INPUT" | jq -r '.cwd // empty')
EVENT=$(printf '%s\n' "$INPUT" | jq -r '.hook_event_name // empty')

# CWD fallback to $PWD if empty
[[ -z "$CWD" ]] && CWD="$PWD"

# INTG-02: Version mismatch check — runs BEFORE dedup guard (SSTH-05).
# Must fire on every UserPromptSubmit so mid-session plugin updates are detected.
# The check is cheap (one jq + one curl with 1s timeout) and idempotent.
WORKER_CLIENT_LIB=""
if [[ -n "${CLAUDE_PLUGIN_ROOT:-}" ]] && [[ -f "${CLAUDE_PLUGIN_ROOT}/lib/worker-client.sh" ]]; then
  WORKER_CLIENT_LIB="${CLAUDE_PLUGIN_ROOT}/lib/worker-client.sh"
else
  SCRIPT_DIR="$(dirname "$0")"
  WORKER_CLIENT="${SCRIPT_DIR}/../lib/worker-client.sh"
  [[ -f "$WORKER_CLIENT" ]] && WORKER_CLIENT_LIB="$WORKER_CLIENT"
fi

# DSP-06: restart logic extracted to lib/worker-restart.sh
_worker_restarted=false
_installed_version=""
_running_version=""
if [[ -n "$WORKER_CLIENT_LIB" ]]; then
  # shellcheck source=lib/worker-client.sh
  source "$WORKER_CLIENT_LIB"
  # worker-client.sh sources data-dir.sh, so resolve_arcanon_data_dir is in scope.
  WORKER_RESTART_LIB="$(dirname "$WORKER_CLIENT_LIB")/worker-restart.sh"
  if [[ -f "$WORKER_RESTART_LIB" ]]; then
    # shellcheck source=lib/worker-restart.sh
    source "$WORKER_RESTART_LIB"
    restart_worker_if_stale || true
  fi
fi

# SSTH-05: Deduplication — only inject context once per session
# (version check above is exempt — it must run on every prompt to catch mid-session updates)
if [[ -n "$SESSION_ID" ]]; then
  FLAG_FILE="/tmp/arcanon_session_${SESSION_ID}.initialized"
  if [[ -f "$FLAG_FILE" ]]; then
    exit 0  # already ran for this session
  fi
  touch "$FLAG_FILE"
fi

# INTG-01: Worker auto-start (first session only — dedup guard ensures this)
WORKER_STATUS=""
if [[ -n "$WORKER_CLIENT_LIB" ]]; then
  CONFIG_FILE="${CWD}/arcanon.config.json"
  if [[ -f "$CONFIG_FILE" ]] && jq -e '.["impact-map"]' "$CONFIG_FILE" >/dev/null 2>&1; then
    if [[ "$_worker_restarted" == "true" ]]; then
      WORKER_STATUS="Arcanon worker: restarted (${_running_version} → ${_installed_version})"
    elif ! worker_running 2>/dev/null; then
      worker_start_background 2>/dev/null || true
    else
      WORKER_STATUS=$(worker_status_line 2>/dev/null || echo "")
    fi
  fi
fi

# SSE-01..07: ARCANON_ENRICHMENT — impact-map stats suffix injected into session banner.
# SSE-01/02: fresh map => full suffix. SSE-03: stale (48h<age<7d) => stale prefix.
# SSE-04/07: any failure (missing DB, corrupt DB, query error, hub down) => ENRICHMENT=""
# SSE-05: non-Arcanon dir (no DB) => silent no-op. SSE-06: total overhead < 200ms.
# The entire block runs in a subshell so failures never leak to the outer script.
ENRICHMENT=""
ENRICHMENT="$(
  set -euo pipefail

  # Require non-empty CWD
  [[ -n "${CWD:-}" ]] || exit 0

  # Resolve sha256 hasher (macOS: shasum; Linux: sha256sum)
  if command -v shasum >/dev/null 2>&1; then
    HASHER="shasum -a 256"
  elif command -v sha256sum >/dev/null 2>&1; then
    HASHER="sha256sum"
  else
    exit 0
  fi

  # Compute project hash: printf '%s' (no newline) matches Node crypto.createHash('sha256').update(cwd)
  PROJECT_HASH="$(printf '%s' "$CWD" | $HASHER 2>/dev/null | awk '{print $1}' | cut -c1-12)"
  [[ -n "$PROJECT_HASH" ]] || exit 0

  # Resolve data dir: use sourced resolve_arcanon_data_dir if available, else env/default
  if declare -f resolve_arcanon_data_dir >/dev/null 2>&1; then
    DATA_DIR="$(resolve_arcanon_data_dir 2>/dev/null || echo "")"
  else
    DATA_DIR="${ARCANON_DATA_DIR:-$HOME/.arcanon}"
  fi
  [[ -n "$DATA_DIR" ]] || exit 0

  DB_PATH="${DATA_DIR}/projects/${PROJECT_HASH}/impact-map.db"
  [[ -f "$DB_PATH" ]] || exit 0  # SSE-05: non-Arcanon dir — silent no-op

  # Validate DB integrity before any real query (SSE-04: corrupt DB => silent fallback)
  sqlite3 "$DB_PATH" "PRAGMA quick_check;" 2>/dev/null | grep -q '^ok$' || exit 0

  # Run the three stat queries (SSE-01/03)
  SVC_COUNT=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM services;" 2>/dev/null)
  LB_COUNT=$(sqlite3 "$DB_PATH" \
    "SELECT COUNT(DISTINCT source_file) FROM connections WHERE source_file IS NOT NULL AND source_file != '';" 2>/dev/null)
  LAST_SCAN_ISO=$(sqlite3 "$DB_PATH" \
    "SELECT MAX(completed_at) FROM scan_versions WHERE completed_at IS NOT NULL;" 2>/dev/null)

  [[ -n "$SVC_COUNT" && -n "$LAST_SCAN_ISO" ]] || exit 0

  # Age calculation (portable: GNU date -d first, then BSD date -jf)
  NOW_EPOCH=$(date -u +%s 2>/dev/null) || exit 0
  SCAN_EPOCH=$(date -u -d "$LAST_SCAN_ISO" +%s 2>/dev/null) \
    || SCAN_EPOCH=$(date -ju -f '%Y-%m-%d %H:%M:%S' "$LAST_SCAN_ISO" +%s 2>/dev/null) \
    || exit 0
  [[ -n "$SCAN_EPOCH" ]] || exit 0

  AGE_HOURS=$(( (NOW_EPOCH - SCAN_EPOCH) / 3600 ))
  # SSE-01: map > 7 days old => no enrichment (silent)
  (( AGE_HOURS >= 168 )) && exit 0

  SCAN_DATE="$(printf '%s' "$LAST_SCAN_ISO" | cut -c1-10)"

  # Hub status (SSE-04: any failure => "unknown")
  HUB_STATUS="unknown"
  HUB_SH=""
  if [[ -n "${CLAUDE_PLUGIN_ROOT:-}" ]] && [[ -x "${CLAUDE_PLUGIN_ROOT}/scripts/hub.sh" ]]; then
    HUB_SH="${CLAUDE_PLUGIN_ROOT}/scripts/hub.sh"
  else
    _SCRIPT_DIR="$(dirname "${BASH_SOURCE[0]}" 2>/dev/null || echo "")"
    [[ -x "${_SCRIPT_DIR}/hub.sh" ]] && HUB_SH="${_SCRIPT_DIR}/hub.sh"
  fi
  if [[ -n "$HUB_SH" ]]; then
    HUB_JSON="$(bash "$HUB_SH" status --json 2>/dev/null)" || HUB_JSON=""
    if [[ -n "$HUB_JSON" ]]; then
      CREDS="$(printf '%s' "$HUB_JSON" | jq -r '.credentials // "missing"' 2>/dev/null)" || CREDS="missing"
      AUTO="$(printf '%s' "$HUB_JSON" | jq -r '.hub_auto_sync // .hub_auto_upload // false' 2>/dev/null)" || AUTO="false"
      case "${CREDS}:${AUTO}" in
        present:true)  HUB_STATUS="auto-sync on" ;;
        present:false) HUB_STATUS="manual" ;;
        missing:*)     HUB_STATUS="offline" ;;
        *)             HUB_STATUS="unknown" ;;
      esac
    fi
  fi

  # Assemble enrichment suffix (SSE-01)
  ENRICHMENT_VAL="${SVC_COUNT} services mapped. ${LB_COUNT:-0} load-bearing files. Last scan: ${SCAN_DATE}. Hub: ${HUB_STATUS}."

  # SSE-03: stale map (48h <= age < 168h) => prepend stale prefix
  if (( AGE_HOURS >= 48 )); then
    DAYS=$(( AGE_HOURS / 24 ))
    ENRICHMENT_VAL="[stale map — last scanned ${DAYS}d ago] ${ENRICHMENT_VAL}"
  fi

  printf '%s' "$ENRICHMENT_VAL"
)" 2>/dev/null || ENRICHMENT=""

# SSTH-02: Project detection — source shared library
# Use CLAUDE_PLUGIN_ROOT if set, otherwise fall back to script-relative path
DETECT_LIB=""
if [[ -n "${CLAUDE_PLUGIN_ROOT:-}" ]] && [[ -f "${CLAUDE_PLUGIN_ROOT}/lib/detect.sh" ]]; then
  DETECT_LIB="${CLAUDE_PLUGIN_ROOT}/lib/detect.sh"
else
  SCRIPT_DIR="$(dirname "$0")"
  RELATIVE_LIB="${SCRIPT_DIR}/../lib/detect.sh"
  if [[ -f "$RELATIVE_LIB" ]]; then
    DETECT_LIB="$RELATIVE_LIB"
  fi
fi

PROJECT_TYPES=""
if [[ -n "$DETECT_LIB" ]]; then
  # shellcheck source=lib/detect.sh
  source "$DETECT_LIB"
  if declare -f detect_project_type >/dev/null 2>&1; then
    PROJECT_TYPES=$(detect_project_type "$CWD")
    # Normalize: if detect_project_type returns "unknown" treat as empty
    [[ "$PROJECT_TYPES" == "unknown" ]] && PROJECT_TYPES=""
  fi
fi

# SSTH-02: Build context message
CONTEXT="Arcanon active."
if [[ -n "$PROJECT_TYPES" ]]; then
  CONTEXT="Arcanon active. Detected: ${PROJECT_TYPES}."
fi
CONTEXT="${CONTEXT} Commands: /arcanon:map, /arcanon:drift, /arcanon:impact, /arcanon:login, /arcanon:upload, /arcanon:status, /arcanon:sync, /arcanon:export."
[[ -n "$WORKER_STATUS" ]] && CONTEXT="${CONTEXT} ${WORKER_STATUS}"
[[ -n "${ENRICHMENT:-}" ]] && CONTEXT="${CONTEXT} ${ENRICHMENT}"

# SSTH-01: Output hookSpecificOutput.additionalContext JSON to stdout
# Use jq -Rs . for safe escaping of the context string (handles quotes, backslashes, newlines)
CONTEXT_JSON=$(printf '%s' "$CONTEXT" | jq -Rs .)
printf '{"hookSpecificOutput":{"hookEventName":"%s","additionalContext":%s}}\n' \
  "$EVENT" \
  "$CONTEXT_JSON"

exit 0
