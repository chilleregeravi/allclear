#!/usr/bin/env bash
# scripts/impact-hook.sh — PreToolUse ambient cross-repo consumer warning
#
# Fires AFTER file-guard.sh in hooks.json PreToolUse array. Pure bash + jq + (later) curl + sqlite3 CLI.
# Never blocks (never exit 2). On any error: exit 0 silently to preserve edit flow.
#
# Exit codes:
#   0 = allow (with optional {"systemMessage": "..."} on stdout for the warning)
#   0 = also used for silent paths (self-exclusion, no classification, worker down, internal error)
#
# Environment:
#   ARCANON_DISABLE_HOOK=1   — escape hatch; exit 0 silently (HOK-11)
#   ARCANON_IMPACT_DEBUG=1   — append JSONL trace to $DATA_DIR/logs/impact-hook.jsonl (HOK-10)
#
# Flags:
#   --self-test              — runs skeleton smoke test without reading stdin, exits 0

# Defensive: never `set -e`. Every exit must be explicit.

# ---------------------------------------------------------------------------
# t0 — begin latency clock (for debug trace, only when debug is active)
# ---------------------------------------------------------------------------
# macOS BSD date returns "17768000553N" for +%s%3N (%3N is not supported and
# exits 0 with garbage). Validate the result is purely numeric before using it;
# fall back to python3 (which is always available on macOS) otherwise.
#
# PERFORMANCE NOTE: python3 spawn costs ~30-40ms on macOS. _ms_now() is only
# called when ARCANON_IMPACT_DEBUG=1 is set. _t0_ms is captured lazily here
# (only when debug is active) to avoid the overhead on every normal invocation.
_ms_now() {
  local _v
  _v=$(date +%s%3N 2>/dev/null)
  if [[ "$_v" =~ ^[0-9]+$ ]]; then
    printf '%s' "$_v"
  else
    python3 -c 'import time;print(int(time.time()*1000))' 2>/dev/null || echo 0
  fi
}
# Only capture t0 when debug tracing is requested (avoids python3 spawn on macOS hot path)
if [[ "${ARCANON_IMPACT_DEBUG:-0}" == "1" ]]; then
  _t0_ms=$(_ms_now)
else
  _t0_ms=0
fi

# ---------------------------------------------------------------------------
# ARCANON_DISABLE_HOOK (HOK-11) — escape hatch, short-circuit
# ---------------------------------------------------------------------------
if [[ "${ARCANON_DISABLE_HOOK:-0}" == "1" ]]; then
  exit 0
fi

# ---------------------------------------------------------------------------
# Self-test mode — skeleton smoke check, no stdin read
# ---------------------------------------------------------------------------
if [[ "${1:-}" == "--self-test" ]]; then
  echo "impact-hook.sh self-test: ok" >&2
  exit 0
fi

# ---------------------------------------------------------------------------
# Source library helpers — silently swallow errors (HOK-09)
# ---------------------------------------------------------------------------
# Pure-bash hook dir resolution: avoids two subshells (cd + dirname) on every run.
# ${BASH_SOURCE[0]%/*} strips the filename component; works for both absolute and
# relative paths because bash sets BASH_SOURCE[0] to the script path as invoked.
_HOOK_DIR="${BASH_SOURCE[0]%/*}"
# If the script is invoked without a path component (e.g. `bash impact-hook.sh`),
# BASH_SOURCE[0] equals the filename with no slash — fall back to pwd.
[[ "$_HOOK_DIR" == "${BASH_SOURCE[0]}" ]] && _HOOK_DIR="$(pwd)"
_LIB_DIR="${_HOOK_DIR}/../lib"

# shellcheck source=../lib/data-dir.sh
source "${_LIB_DIR}/data-dir.sh" 2>/dev/null || exit 0
# shellcheck source=../lib/db-path.sh
source "${_LIB_DIR}/db-path.sh" 2>/dev/null || exit 0

DATA_DIR=$(resolve_arcanon_data_dir) || exit 0

# ---------------------------------------------------------------------------
# Debug trace helper (HOK-10)
# ---------------------------------------------------------------------------
_debug_trace() {
  [[ "${ARCANON_IMPACT_DEBUG:-0}" == "1" ]] || return 0
  local ts file classified service consumer_count latency_ms
  ts=$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo "unknown")
  file="${1:-}"
  classified="${2:-false}"
  service="${3:-null}"
  consumer_count="${4:-null}"
  local _t1_ms
  _t1_ms=$(_ms_now)
  latency_ms=$(( _t1_ms - _t0_ms ))
  local log_dir="${DATA_DIR}/logs"
  mkdir -p "$log_dir" 2>/dev/null || return 0
  # Service/consumer_count may be null; wrap non-null strings in quotes via jq
  printf '{"ts":"%s","file":%s,"classified":%s,"service":%s,"consumer_count":%s,"latency_ms":%d}\n' \
    "$ts" \
    "$(jq -Rn --arg v "$file" '$v' 2>/dev/null || echo '""')" \
    "$classified" \
    "$(if [[ "$service" == "null" ]]; then echo null; else jq -Rn --arg v "$service" '$v' 2>/dev/null || echo '""'; fi)" \
    "$consumer_count" \
    "$latency_ms" \
    >> "${log_dir}/impact-hook.jsonl" 2>/dev/null || true
}

# ---------------------------------------------------------------------------
# Read stdin exactly once
# ---------------------------------------------------------------------------
INPUT=$(cat 2>/dev/null || echo "")
if [[ -z "$INPUT" ]]; then
  _debug_trace "" false null null
  exit 0
fi

RAW_FILE=$(printf '%s\n' "$INPUT" | jq -r '.tool_input.file_path // .tool_input.path // empty' 2>/dev/null)
if [[ -z "$RAW_FILE" ]]; then
  # Not a file op (e.g. Bash tool) — allow silently
  _debug_trace "" false null null
  exit 0
fi

# ---------------------------------------------------------------------------
# Path normalization (mirror file-guard.sh lines 34-42)
# ---------------------------------------------------------------------------
# Avoid calling command -v + realpath -m / probe on every invocation — those are
# two extra subshells. Instead call realpath -m directly and fall back only on
# failure (non-zero exit). On macOS, realpath is available via coreutils or
# as /usr/bin/realpath (macOS 12.3+). The -m flag is GNU-only; BSD realpath
# does not support it, so we test the exit code of the actual call.
FILE=$(realpath -m "$RAW_FILE" 2>/dev/null)
if [[ -z "$FILE" ]]; then
  # realpath unavailable or failed (BSD / older macOS): manual fallback
  _dir="${RAW_FILE%/*}"
  _base="${RAW_FILE##*/}"
  # If no slash in RAW_FILE, _dir would equal RAW_FILE — use pwd
  [[ "$_dir" == "$RAW_FILE" ]] && _dir="$(pwd)"
  _resolved_dir=$(cd "$_dir" 2>/dev/null && pwd || printf '%s' "$_dir")
  FILE="${_resolved_dir}/${_base}"
fi
BASENAME="${FILE##*/}"

# ---------------------------------------------------------------------------
# HOK-07 — Self-exclusion: skip if file is inside $CLAUDE_PLUGIN_ROOT
# ---------------------------------------------------------------------------
if [[ -n "${CLAUDE_PLUGIN_ROOT:-}" ]]; then
  # Normalize plugin root for stable prefix match
  _PLUGIN_ROOT_NORM="${CLAUDE_PLUGIN_ROOT%/}"
  if [[ "$FILE" == "${_PLUGIN_ROOT_NORM}/"* ]]; then
    _debug_trace "$FILE" false null null
    exit 0
  fi
fi

# ---------------------------------------------------------------------------
# HOK-02 Tier 1 — Pure bash pattern match (~0ms)
# Fires warning for: *.proto, openapi.{yaml,yml,json}, swagger.{yaml,yml,json}
# ---------------------------------------------------------------------------
_tier1_match="false"
case "$BASENAME" in
  *.proto) _tier1_match="true" ;;
  openapi.yaml|openapi.yml|openapi.json) _tier1_match="true" ;;
  swagger.yaml|swagger.yml|swagger.json) _tier1_match="true" ;;
esac

if [[ "$_tier1_match" == "true" ]]; then
  _TIER1_MSG="Arcanon: schema file ${BASENAME} edited — cross-repo consumers may be impacted. Run /arcanon:impact for details."
  printf '{"systemMessage": %s}\n' "$(jq -Rn --arg v "$_TIER1_MSG" '$v' 2>/dev/null || printf '"%s"' "${_TIER1_MSG//\"/\\\"}")"
  _debug_trace "$FILE" true null null
  exit 0
fi

# ---------------------------------------------------------------------------
# HOK-02 Tier 2 — SQLite root_path prefix match + HOK-03 trailing-slash norm
# HOK-09 — All errors exit 0 silently
# ---------------------------------------------------------------------------

# Resolve project root by walking up from the edited file.
# Looks for arcanon.config.json -> .arcanon/ -> .git/ (in that order)
# Uses bash parameter expansion (${dir%/*}) instead of $(dirname) to avoid
# forking a subprocess per directory level — saves ~2ms per level traversed.
_find_project_root() {
  local dir="${1%/*}"  # strip filename component in pure bash
  while [[ "$dir" != "/" && -n "$dir" ]]; do
    if [[ -f "$dir/arcanon.config.json" ]] || [[ -d "$dir/.arcanon" ]] || [[ -d "$dir/.git" ]]; then
      printf '%s\n' "$dir"
      return 0
    fi
    dir="${dir%/*}"
  done
  return 1
}

PROJECT_ROOT=$(_find_project_root "$FILE" 2>/dev/null) || {
  _debug_trace "$FILE" false null null
  exit 0
}

DB_PATH=$(resolve_project_db_path "$PROJECT_ROOT" 2>/dev/null) || {
  _debug_trace "$FILE" false null null
  exit 0
}

if [[ ! -f "$DB_PATH" ]]; then
  # No impact-map for this project — hook has nothing to say
  _debug_trace "$FILE" false null null
  exit 0
fi

# sqlite3 must be available (already required by existing plugin scripts)
if ! command -v sqlite3 &>/dev/null; then
  _debug_trace "$FILE" false null null
  exit 0
fi

# Query: tab-separated name\tabsolute_prefix rows.
# root_path is relative (pre-flight Finding 3) — JOIN repos to get absolute prefix.
# Bare "." means the repo root itself is the service root.
# -readonly prevents accidental writes; ".timeout 500" caps to 500ms.
_SERVICE_ROWS=$(sqlite3 -readonly -cmd ".timeout 500" -separator $'\t' "$DB_PATH" \
  "SELECT s.name, r.path || '/' || s.root_path FROM services s JOIN repos r ON s.repo_id = r.id;" \
  2>/dev/null) || {
  _debug_trace "$FILE" false null null
  exit 0
}

SERVICE=""
# Read tab-separated rows; find first prefix match with trailing-slash normalization
# (HOK-03: "auth-legacy" must not match "auth" — trailing-slash norm prevents it)
while IFS=$'\t' read -r _svc_name _svc_abs; do
  [[ -z "$_svc_name" || -z "$_svc_abs" ]] && continue
  _svc_abs_norm="${_svc_abs%/}"
  # Handle bare "." case: repo root itself is the service root_path
  if [[ "$_svc_abs_norm" == *"/." ]]; then
    _svc_abs_norm="${_svc_abs_norm%/.}"
  fi
  # Prefix match with trailing slash — prevents "services/auth-legacy" matching "services/auth"
  if [[ "$FILE" == "${_svc_abs_norm}/"* ]]; then
    SERVICE="$_svc_name"
    break
  fi
done <<< "$_SERVICE_ROWS"

if [[ -z "$SERVICE" ]]; then
  # No Tier 2 match — allow silently
  _debug_trace "$FILE" false null null
  exit 0
fi

# ---------------------------------------------------------------------------
# HOK-08 — Staleness prefix: prepend [stale map — scanned Xd ago] when DB mtime > 48h
# ---------------------------------------------------------------------------
_STALE_PREFIX=""
if [[ -f "$DB_PATH" ]]; then
  # Portable mtime: GNU stat (-c %Y) vs BSD stat (-f %m)
  _db_mtime=$(stat -c %Y "$DB_PATH" 2>/dev/null || stat -f %m "$DB_PATH" 2>/dev/null || echo 0)
  _now=$(date +%s 2>/dev/null || echo 0)
  if [[ "$_db_mtime" -gt 0 && "$_now" -gt "$_db_mtime" ]]; then
    _age_sec=$(( _now - _db_mtime ))
    _age_hours=$(( _age_sec / 3600 ))
    if [[ "$_age_hours" -gt 48 ]]; then
      _age_days=$(( _age_hours / 24 ))
      _STALE_PREFIX="[stale map — scanned ${_age_days}d ago] "
    fi
  fi
fi

# ---------------------------------------------------------------------------
# HOK-04 — Consumer query: worker HTTP primary, direct SQLite fallback
# ---------------------------------------------------------------------------

# Source worker-client (safe to re-source; functions just redefine)
# shellcheck source=../lib/worker-client.sh
source "${_LIB_DIR}/worker-client.sh" 2>/dev/null || true

CONSUMERS=""
CONSUMER_COUNT=0

_query_consumers_via_worker() {
  # URL-encode project and change via jq @uri (jq is already required by this hook)
  local proj_q chg_q resp
  proj_q=$(jq -rn --arg v "$PROJECT_ROOT" '$v | @uri' 2>/dev/null) || return 1
  chg_q=$(jq -rn --arg v "$SERVICE" '$v | @uri' 2>/dev/null) || return 1
  resp=$(worker_call "/impact?project=${proj_q}&change=${chg_q}" 2>/dev/null) || return 1
  # Extract consumer names — support both response shapes defensively
  # Shape A: { "consumers": [ { "name": "svc-a" }, ... ] }
  # Shape B: [ { "name": "svc-a" }, ... ]
  # Shape C: { "impacted": [ ... ] } (fallback if worker emits this key)
  printf '%s' "$resp" | jq -r '
    (.consumers // .impacted // . // []) |
    if type == "array" then .[] | (.name // .service // empty) else empty end
  ' 2>/dev/null
}

_query_consumers_via_sqlite() {
  # Fallback: direct sqlite3. A "consumer" of service S = any service with a
  # connection where target_service_id = S's id. Return unique source service names.
  # SQL injection mitigation: SERVICE name is escaped via sed s/'/''/g (T-100-09)
  local _svc_escaped
  _svc_escaped=$(printf '%s' "$SERVICE" | sed "s/'/''/g")
  sqlite3 -readonly -cmd ".timeout 500" "$DB_PATH" <<SQL 2>/dev/null
SELECT DISTINCT src.name
FROM connections c
JOIN services tgt ON tgt.id = c.target_service_id
JOIN services src ON src.id = c.source_service_id
WHERE tgt.name = '${_svc_escaped}';
SQL
}

# Primary: worker HTTP (~5ms warm)
_consumer_list=""
if worker_running 2>/dev/null; then
  _consumer_list=$(_query_consumers_via_worker) || _consumer_list=""
fi

# Fallback: direct sqlite3 (~5-15ms)
if [[ -z "$_consumer_list" ]]; then
  _consumer_list=$(_query_consumers_via_sqlite) || _consumer_list=""
fi

# Normalize: strip blank lines, count, build comma-separated preview (max 3 names)
if [[ -n "$_consumer_list" ]]; then
  CONSUMER_COUNT=$(printf '%s\n' "$_consumer_list" | grep -vcE '^\s*$' 2>/dev/null || echo 0)
  CONSUMERS=$(printf '%s\n' "$_consumer_list" | grep -vE '^\s*$' | head -3 | paste -sd ',' -)
fi

# ---------------------------------------------------------------------------
# HOK-05 — Emit warning (warn-only, never block)
# ---------------------------------------------------------------------------
_MSG=""
if [[ "$CONSUMER_COUNT" -gt 0 ]]; then
  _MSG="${_STALE_PREFIX}Arcanon: ${SERVICE} has ${CONSUMER_COUNT} consumer(s): ${CONSUMERS}. Run /arcanon:impact for details."
else
  # Service identified but no consumers (or query failed) — still useful to surface
  _MSG="${_STALE_PREFIX}Arcanon: editing service ${SERVICE}. Run /arcanon:impact for cross-repo impact."
fi

# jq-escape message body to produce valid JSON (handles quotes, backslashes, newlines)
printf '{"systemMessage": %s}\n' "$(jq -Rn --arg v "$_MSG" '$v' 2>/dev/null || printf '"%s"' "${_MSG//\"/\\\"}")"
_debug_trace "$FILE" true "$SERVICE" "$CONSUMER_COUNT"
exit 0

# ---------------------------------------------------------------------------
# Default: allow silently
# ---------------------------------------------------------------------------
_debug_trace "$FILE" false null null
exit 0
