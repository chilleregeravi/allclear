#!/usr/bin/env bats
# tests/session-start-enrichment.bats
# Bats test suite for ARCANON_ENRICHMENT block in scripts/session-start.sh
# Covers SSE-01 (fresh map), SSE-02 (plain banner when fresh), SSE-03 (stale prefix),
#         SSE-04 (hub failure / corrupt DB fallback), SSE-05 (non-Arcanon dir),
#         SSE-06 (< 200ms budget), SSE-07 (silent no-op on all failures)

PROJECT_ROOT="$(cd "$BATS_TEST_DIRNAME/.." && pwd)"

setup() {
  # Create isolated temp plugin root
  MOCK_PLUGIN_ROOT="$(mktemp -d)"
  mkdir -p "$MOCK_PLUGIN_ROOT/scripts"
  mkdir -p "$MOCK_PLUGIN_ROOT/lib"

  # Copy the real hook script
  cp "$PROJECT_ROOT/plugins/arcanon/scripts/session-start.sh" "$MOCK_PLUGIN_ROOT/scripts/session-start.sh"

  # Write a minimal mock lib/detect.sh
  cat > "$MOCK_PLUGIN_ROOT/lib/detect.sh" <<'MOCK'
[[ "${BASH_SOURCE[0]}" != "${0}" ]] || exit 0
detect_project_type() {
  echo "${MOCK_PROJECT_TYPE:-}"
}
MOCK

  # Write a minimal mock lib/worker-client.sh that:
  #  - stubs out worker_running / worker_start_background / worker_status_line
  #  - provides resolve_arcanon_data_dir pointing to ARCANON_DATA_DIR
  cat > "$MOCK_PLUGIN_ROOT/lib/worker-client.sh" <<'MOCK'
worker_running() { return 1; }
worker_start_background() { return 0; }
worker_status_line() { echo ""; }
resolve_arcanon_data_dir() {
  echo "${ARCANON_DATA_DIR:-$HOME/.arcanon}"
}
MOCK

  # Write a mock lib/worker-restart.sh (no-op)
  cat > "$MOCK_PLUGIN_ROOT/lib/worker-restart.sh" <<'MOCK'
restart_worker_if_stale() { return 0; }
MOCK

  # Write the DEFAULT hub.sh stub: credentials=present, auto_upload=false => "manual"
  mkdir -p "$MOCK_PLUGIN_ROOT/scripts"
  cat > "$MOCK_PLUGIN_ROOT/scripts/hub.sh" <<'STUB'
#!/usr/bin/env bash
# Default hub.sh stub — "manual" status
# Set HUB_STUB_EXIT=1 to simulate failure
if [[ "${HUB_STUB_EXIT:-0}" == "1" ]]; then
  exit 1
fi
printf '{"plugin_version":"0.1.0","data_dir":"/tmp/.arcanon","hub_auto_upload":false,"credentials":"present","queue":{"pending":0,"dead":0,"oldestPending":null}}\n'
STUB
  chmod +x "$MOCK_PLUGIN_ROOT/scripts/hub.sh"

  # Create a temp DATA_DIR for fixture isolation
  FIXTURE_DATA_DIR="$(mktemp -d)"

  # A unique CWD for each test run (test-scoped temp dir)
  FIXTURE_CWD="$(mktemp -d)"

  export MOCK_PLUGIN_ROOT
  export FIXTURE_DATA_DIR
  export FIXTURE_CWD
  export ARCANON_DATA_DIR="$FIXTURE_DATA_DIR"
  export MOCK_PROJECT_TYPE=""

  # Source helpers
  # shellcheck source=tests/helpers/mock_detect.bash
  source "$PROJECT_ROOT/tests/helpers/mock_detect.bash"
  # shellcheck source=tests/helpers/arcanon_enrichment.bash
  source "$PROJECT_ROOT/tests/helpers/arcanon_enrichment.bash"

  cleanup_session_flags
}

teardown() {
  cleanup_session_flags
  [[ -d "$MOCK_PLUGIN_ROOT" ]] && rm -rf "$MOCK_PLUGIN_ROOT"
  [[ -d "$FIXTURE_DATA_DIR" ]] && rm -rf "$FIXTURE_DATA_DIR"
  [[ -d "$FIXTURE_CWD"      ]] && rm -rf "$FIXTURE_CWD"
}

# run_hook SESSION_ID [extra_env_vars...]
# Runs session-start.sh with a fresh session ID, CWD=$FIXTURE_CWD,
# ARCANON_DATA_DIR=$FIXTURE_DATA_DIR, CLAUDE_PLUGIN_ROOT=$MOCK_PLUGIN_ROOT.
run_hook() {
  local session_id="$1"
  shift
  run env \
    CLAUDE_PLUGIN_ROOT="$MOCK_PLUGIN_ROOT" \
    ARCANON_DATA_DIR="$FIXTURE_DATA_DIR" \
    MOCK_PROJECT_TYPE="$MOCK_PROJECT_TYPE" \
    "$@" \
    bash "$MOCK_PLUGIN_ROOT/scripts/session-start.sh" \
    <<< "{\"session_id\":\"${session_id}\",\"cwd\":\"${FIXTURE_CWD}\",\"hook_event_name\":\"SessionStart\"}"
  rm -f "/tmp/arcanon_session_${session_id}.initialized"
}

# extract_context OUTPUT
# Uses python3 to pull additionalContext from hook JSON output.
extract_context() {
  printf '%s' "$1" | python3 -c "
import sys, json
d = json.load(sys.stdin)
print(d['hookSpecificOutput']['additionalContext'])
"
}

# ---------------------------------------------------------------------------
# SSE-01: fresh map (<48h) injects full enrichment suffix
# ---------------------------------------------------------------------------

@test "SSE-01: fresh map (<48h) injects full enrichment suffix" {
  # Build fixture: 1h old, 5 services, 3 load-bearing files
  build_enrichment_fixture "$FIXTURE_CWD" "$FIXTURE_DATA_DIR" 1 5 3

  run_hook "bats-sse-01"
  [ "$status" -eq 0 ]

  ctx="$(extract_context "$output")"

  # Must contain count strings
  [[ "$ctx" == *"5 services mapped."* ]]     || { echo "Missing '5 services mapped.' in: $ctx"; return 1; }
  [[ "$ctx" == *"3 load-bearing files."* ]]  || { echo "Missing '3 load-bearing files.' in: $ctx"; return 1; }

  # Must contain "Last scan: YYYY-MM-DD"
  echo "$ctx" | grep -qE 'Last scan: [0-9]{4}-[0-9]{2}-[0-9]{2}\.' || { echo "Missing 'Last scan: YYYY-MM-DD.' in: $ctx"; return 1; }

  # Must contain "Hub:"
  [[ "$ctx" == *". Hub: "* ]] || { echo "Missing '. Hub: ' in: $ctx"; return 1; }

  # Must NOT contain stale prefix
  [[ "$ctx" != *"[stale map"* ]] || { echo "Unexpected '[stale map' in fresh map: $ctx"; return 1; }
}

# ---------------------------------------------------------------------------
# SSE-03: stale map (48h < age < 7d) prepends stale prefix
# ---------------------------------------------------------------------------

@test "SSE-03: stale map (48h < age < 7d) prepends stale prefix" {
  # Build fixture: 72h old (3 days), 5 services, 3 load-bearing files
  build_enrichment_fixture "$FIXTURE_CWD" "$FIXTURE_DATA_DIR" 72 5 3

  run_hook "bats-sse-03"
  [ "$status" -eq 0 ]

  ctx="$(extract_context "$output")"

  # Must start with stale prefix
  echo "$ctx" | grep -qE '^\[stale map — last scanned [0-9]+d ago\]' \
    || { echo "Expected '[stale map — last scanned Xd ago]' prefix in: $ctx"; return 1; }

  # Must still contain enrichment data
  [[ "$ctx" == *"5 services mapped."* ]]    || { echo "Missing '5 services mapped.' in stale: $ctx"; return 1; }
  [[ "$ctx" == *"3 load-bearing files."* ]] || { echo "Missing '3 load-bearing files.' in stale: $ctx"; return 1; }
  echo "$ctx" | grep -qE 'Last scan: [0-9]{4}-[0-9]{2}-[0-9]{2}\.' \
    || { echo "Missing 'Last scan: YYYY-MM-DD.' in stale: $ctx"; return 1; }
}

# ---------------------------------------------------------------------------
# SSE-01: map > 7d old produces no enrichment
# ---------------------------------------------------------------------------

@test "SSE-01: map > 7d old produces no enrichment" {
  # Build fixture: 200h old (> 7 days), 5 services, 3 load-bearing files
  build_enrichment_fixture "$FIXTURE_CWD" "$FIXTURE_DATA_DIR" 200 5 3

  run_hook "bats-sse-01b"
  [ "$status" -eq 0 ]

  ctx="$(extract_context "$output")"

  # Must NOT contain enrichment suffix
  [[ "$ctx" != *"services mapped"* ]] || { echo "Unexpected 'services mapped' in >7d banner: $ctx"; return 1; }
  [[ "$ctx" != *"load-bearing files"* ]] || { echo "Unexpected 'load-bearing files' in >7d banner: $ctx"; return 1; }

  # Must contain the minimal Arcanon active banner
  [[ "$ctx" == *"Arcanon active"* ]] || { echo "Missing 'Arcanon active' in >7d banner: $ctx"; return 1; }
}

# ---------------------------------------------------------------------------
# SSE-05: non-Arcanon directory (no impact-map.db) produces no enrichment
# ---------------------------------------------------------------------------

@test "SSE-05: non-Arcanon directory (no impact-map.db) produces no enrichment and no 'inactive' text" {
  # No fixture built — FIXTURE_CWD has no impact-map.db in FIXTURE_DATA_DIR

  run_hook "bats-sse-05"
  [ "$status" -eq 0 ]

  ctx="$(extract_context "$output")"

  # Must NOT contain enrichment
  [[ "$ctx" != *"services mapped"* ]]  || { echo "Unexpected enrichment in non-Arcanon dir: $ctx"; return 1; }
  [[ "$ctx" != *"load-bearing"* ]]     || { echo "Unexpected enrichment in non-Arcanon dir: $ctx"; return 1; }
  [[ "$ctx" != *"inactive"* ]]         || { echo "Unexpected 'inactive' in non-Arcanon dir: $ctx"; return 1; }

  # Must contain the minimal banner
  [[ "$ctx" == *"Arcanon active"* ]] || { echo "Missing 'Arcanon active' in non-Arcanon dir: $ctx"; return 1; }
}

# ---------------------------------------------------------------------------
# SSE-04: hub.sh status failure degrades gracefully
# ---------------------------------------------------------------------------

@test "SSE-04: hub.sh status failure degrades gracefully to Hub: unknown" {
  # Build a fresh valid fixture
  build_enrichment_fixture "$FIXTURE_CWD" "$FIXTURE_DATA_DIR" 1 5 3

  # Force hub.sh stub to exit non-zero
  run_hook "bats-sse-04a" HUB_STUB_EXIT=1
  [ "$status" -eq 0 ]

  ctx="$(extract_context "$output")"

  # Enrichment must still be present (hub failure is graceful)
  [[ "$ctx" == *"5 services mapped."* ]]    || { echo "Missing enrichment after hub failure: $ctx"; return 1; }
  [[ "$ctx" == *"3 load-bearing files."* ]] || { echo "Missing enrichment after hub failure: $ctx"; return 1; }

  # Hub status must be "unknown"
  [[ "$ctx" == *"Hub: unknown"* ]] || { echo "Expected 'Hub: unknown' after hub failure, got: $ctx"; return 1; }
}

# ---------------------------------------------------------------------------
# SSE-04: corrupt DB file falls back silently
# ---------------------------------------------------------------------------

@test "SSE-04: corrupt DB file falls back silently" {
  # Compute the expected DB path and write garbage there
  local hash
  hash="$(_compute_project_hash "$FIXTURE_CWD")"
  local db_dir="${FIXTURE_DATA_DIR}/projects/${hash}"
  mkdir -p "$db_dir"
  printf 'not-a-sqlite-file\n' > "${db_dir}/impact-map.db"

  run_hook "bats-sse-04b"
  [ "$status" -eq 0 ]

  ctx="$(extract_context "$output")"

  # Must NOT contain enrichment
  [[ "$ctx" != *"services mapped"* ]]  || { echo "Unexpected enrichment from corrupt DB: $ctx"; return 1; }

  # Must NOT contain error tokens
  [[ "$output" != *"sqlite"* ]]        || { echo "sqlite error leaked to output: $output"; return 1; }
  [[ "$output" != *"malformed"* ]]     || { echo "malformed error leaked to output: $output"; return 1; }
  [[ "$output" != *"Error"* ]]         || { echo "Error token leaked to output: $output"; return 1; }

  # Must still exit 0 and produce the minimal banner
  [[ "$ctx" == *"Arcanon active"* ]]   || { echo "Missing 'Arcanon active' after corrupt DB: $ctx"; return 1; }
}

# ---------------------------------------------------------------------------
# SSE-06: total overhead < 200ms budget on warm cache
# ---------------------------------------------------------------------------

@test "SSE-06: total overhead < 200ms budget on warm cache" {
  # Build a fresh valid fixture
  build_enrichment_fixture "$FIXTURE_CWD" "$FIXTURE_DATA_DIR" 1 5 3

  # Warmup invocation (primes filesystem cache, sqlite page cache)
  env \
    CLAUDE_PLUGIN_ROOT="$MOCK_PLUGIN_ROOT" \
    ARCANON_DATA_DIR="$FIXTURE_DATA_DIR" \
    MOCK_PROJECT_TYPE="" \
    bash "$MOCK_PLUGIN_ROOT/scripts/session-start.sh" \
    <<< "{\"session_id\":\"bats-sse-06-warm\",\"cwd\":\"${FIXTURE_CWD}\",\"hook_event_name\":\"SessionStart\"}" \
    > /dev/null 2>&1 || true
  rm -f "/tmp/arcanon_session_bats-sse-06-warm.initialized"

  # Timed invocation
  local start_ns end_ns elapsed_ms
  start_ns=$(date +%s%N 2>/dev/null || echo "0")

  env \
    CLAUDE_PLUGIN_ROOT="$MOCK_PLUGIN_ROOT" \
    ARCANON_DATA_DIR="$FIXTURE_DATA_DIR" \
    MOCK_PROJECT_TYPE="" \
    bash "$MOCK_PLUGIN_ROOT/scripts/session-start.sh" \
    <<< "{\"session_id\":\"bats-sse-06\",\"cwd\":\"${FIXTURE_CWD}\",\"hook_event_name\":\"SessionStart\"}" \
    > /dev/null 2>&1 || true

  end_ns=$(date +%s%N 2>/dev/null || echo "0")
  rm -f "/tmp/arcanon_session_bats-sse-06.initialized"

  if [[ "$start_ns" == "0" ]] || [[ "$end_ns" == "0" ]]; then
    # date +%s%N not supported — skip timing assertion but log a warning
    echo "WARNING: date +%s%N not supported; 200ms budget assertion skipped" >&2
    return 0
  fi

  elapsed_ms=$(( (end_ns - start_ns) / 1000000 ))
  [ "$elapsed_ms" -lt 200 ] || { echo "Budget exceeded: ${elapsed_ms}ms >= 200ms"; return 1; }
}
