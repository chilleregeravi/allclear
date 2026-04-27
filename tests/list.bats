#!/usr/bin/env bats
# tests/list.bats — Phase 114-01 (NAV-01).
#
# End-to-end coverage of /arcanon:list driving the real shell wrapper, the
# real worker HTTP endpoint (for happy path / json), and the real
# _arcanon_is_project_dir helper. Modeled on tests/verify.bats:31-66 helpers.
#
# Tests 1-3 — `_arcanon_is_project_dir` shell helper (no worker).
# Test  4   — `bash hub.sh list` exits 0 silently in non-Arcanon directory.
# Tests 5-7 — full `bash hub.sh list` driving the worker against a seeded DB.
#             (These pass once Task 2 lands the cmdList composition.)

REPO_ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
HUB_SH="${REPO_ROOT}/plugins/arcanon/scripts/hub.sh"
WORKER_INDEX="${REPO_ROOT}/plugins/arcanon/worker/index.js"
WORKER_CLIENT_LIB="${REPO_ROOT}/plugins/arcanon/lib/worker-client.sh"
SEED_SH="${REPO_ROOT}/plugins/arcanon/tests/fixtures/list/seed.sh"
WORKER_PORT=37998

# ---------------------------------------------------------------------------
# Helpers — kept local (no edits to tests/test_helper.bash). Cloned verbatim
# from tests/verify.bats:31-66.
# ---------------------------------------------------------------------------

# Compute sha256(input)[0:12] — matches plugins/arcanon/worker/db/pool.js's
# projectHashDir(). Must match exactly or the worker won't find the DB.
_arcanon_project_hash() {
  printf "%s" "$1" | shasum -a 256 | awk '{print substr($1,1,12)}'
}

# Spawn the worker pointed at $ARCANON_DATA_DIR on $WORKER_PORT and block
# until /api/readiness responds 200 (or 30 attempts × 0.2s = 6s elapse).
_start_worker() {
  ARCANON_DATA_DIR="$ARC_DATA_DIR" \
    node "$WORKER_INDEX" --port "$WORKER_PORT" --data-dir "$ARC_DATA_DIR" \
      >"$BATS_TEST_TMPDIR/worker.log" 2>&1 &
  WORKER_PID=$!
  echo "$WORKER_PID" > "$BATS_TEST_TMPDIR/worker.pid"
  for _ in $(seq 1 30); do
    if curl -sf "http://127.0.0.1:${WORKER_PORT}/api/readiness" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.2
  done
  echo "worker failed to start; log:" >&2
  cat "$BATS_TEST_TMPDIR/worker.log" >&2 || true
  return 1
}

_stop_worker() {
  if [ -f "$BATS_TEST_TMPDIR/worker.pid" ]; then
    local pid
    pid="$(cat "$BATS_TEST_TMPDIR/worker.pid")"
    kill "$pid" 2>/dev/null || true
    for _ in 1 2 3 4 5; do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.1
    done
    kill -9 "$pid" 2>/dev/null || true
  fi
}

setup() {
  # Canonicalize via `pwd -P` so the hash matches what the worker computes
  # from process.cwd() — macOS symlinks /var/folders → /private/var/folders.
  mkdir -p "$BATS_TEST_TMPDIR/project"
  PROJECT_ROOT="$(cd "$BATS_TEST_TMPDIR/project" && pwd -P)"
  ARC_DATA_DIR="$BATS_TEST_TMPDIR/.arcanon"
  mkdir -p "$ARC_DATA_DIR"

  export ARCANON_DATA_DIR="$ARC_DATA_DIR"
  export ARCANON_WORKER_PORT="$WORKER_PORT"
}

teardown() {
  _stop_worker 2>/dev/null || true
}

# ---------------------------------------------------------------------------
# Test 1 — _arcanon_is_project_dir returns 0 in a project dir (DB present).
# ---------------------------------------------------------------------------
@test "NAV-01 helper: returns 0 when impact-map.db exists for cwd" {
  local hash
  hash="$(_arcanon_project_hash "$PROJECT_ROOT")"
  local db_path="$ARC_DATA_DIR/projects/$hash/impact-map.db"
  mkdir -p "$(dirname "$db_path")"
  : > "$db_path"  # empty file is fine for the predicate

  cd "$PROJECT_ROOT"
  run bash -c "source '$WORKER_CLIENT_LIB'; _arcanon_is_project_dir"
  [ "$status" -eq 0 ]
  # NIT 10 — must NOT echo the DB path on stdout.
  [ -z "$output" ]
}

# ---------------------------------------------------------------------------
# Test 2 — _arcanon_is_project_dir returns 1 in a non-project dir.
# ---------------------------------------------------------------------------
@test "NAV-01 helper: returns 1 when no impact-map.db exists for cwd" {
  cd "$PROJECT_ROOT"
  run bash -c "source '$WORKER_CLIENT_LIB'; _arcanon_is_project_dir"
  [ "$status" -eq 1 ]
  [ -z "$output" ]
}

# ---------------------------------------------------------------------------
# Test 3 — ARCANON_DATA_DIR override is honored (not $HOME/.arcanon).
# ---------------------------------------------------------------------------
@test "NAV-01 helper: honors ARCANON_DATA_DIR override" {
  # Custom data dir distinct from default $ARC_DATA_DIR — proves the helper
  # reads the env var on every call, not a hard-coded ~/.arcanon.
  local custom="$BATS_TEST_TMPDIR/custom-data"
  local hash
  hash="$(_arcanon_project_hash "$PROJECT_ROOT")"
  mkdir -p "$custom/projects/$hash"
  : > "$custom/projects/$hash/impact-map.db"

  # Default $HOME/.arcanon (unset) and the bats-default $ARC_DATA_DIR must
  # NOT resolve a DB — only $custom does.
  cd "$PROJECT_ROOT"
  # Unset the bats-default ARCANON_DATA_DIR so we can prove the helper reads
  # the env var on every call (rather than caching at source-time). Then set
  # ARCANON_DATA_DIR to the custom path before invoking the helper.
  run bash -c "unset ARCANON_DATA_DIR; source '$WORKER_CLIENT_LIB'; export ARCANON_DATA_DIR='$custom'; _arcanon_is_project_dir"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

# ---------------------------------------------------------------------------
# Test 4 — /arcanon:list silent in non-project dir (exit 0, no stdout).
# Per the NAV-01 silent contract: no DB → no output, exit 0.
# Worker is intentionally NOT started here.
# ---------------------------------------------------------------------------
@test "NAV-01: bash hub.sh list exits 0 silently when no impact-map.db" {
  cd "$PROJECT_ROOT"
  run bash "$HUB_SH" list
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

# ---------------------------------------------------------------------------
# Test 5 — /arcanon:list happy path with seeded DB + running worker.
# Asserts the 5-line human overview matches NAV-01 spec.
# Per NIT 9: "Services: <ws> 8 mapped" via regex, plus three separate grep -q
# assertions for the per-type counts.
# ---------------------------------------------------------------------------
@test "NAV-01: list happy path prints 5-line overview with correct counts" {
  local hash
  hash="$(_arcanon_project_hash "$PROJECT_ROOT")"
  local db_path="$ARC_DATA_DIR/projects/$hash/impact-map.db"
  bash "$SEED_SH" "$PROJECT_ROOT" "$db_path" >/dev/null
  _start_worker

  cd "$PROJECT_ROOT"
  run bash "$HUB_SH" list
  [ "$status" -eq 0 ]

  # Header + 5 body lines (whitespace-tolerant via grep -q).
  echo "$output" | grep -q "Repos:"
  echo "$output" | grep -q "3"
  echo "$output" | grep -q "Connections:"
  echo "$output" | grep -q "47"
  echo "$output" | grep -q "41 high-conf"
  echo "$output" | grep -q "6 low-conf"
  echo "$output" | grep -q "Actors:"
  echo "$output" | grep -q "4"
  echo "$output" | grep -q "Hub:"

  # Services line — pinned regex per NIT 9.
  [[ "$output" =~ Services:[[:space:]]+8\ mapped ]]
  echo "$output" | grep -q "5 services"
  echo "$output" | grep -q "2 libraries"
  echo "$output" | grep -q "1 infra"
}

# ---------------------------------------------------------------------------
# Test 6 — --json parity: single JSON object with expected fields.
# ---------------------------------------------------------------------------
@test "NAV-01: list --json emits structured object" {
  local hash
  hash="$(_arcanon_project_hash "$PROJECT_ROOT")"
  local db_path="$ARC_DATA_DIR/projects/$hash/impact-map.db"
  bash "$SEED_SH" "$PROJECT_ROOT" "$db_path" >/dev/null
  _start_worker

  cd "$PROJECT_ROOT"
  run bash "$HUB_SH" list --json
  [ "$status" -eq 0 ]

  # Round-trip through jq to assert structural validity + key fields.
  echo "$output" | jq -e '.repos_count == 3' >/dev/null
  echo "$output" | jq -e '.services.total == 8' >/dev/null
  echo "$output" | jq -e '.services.by_type.service == 5' >/dev/null
  echo "$output" | jq -e '.services.by_type.library == 2' >/dev/null
  echo "$output" | jq -e '.services.by_type.infra == 1' >/dev/null
  echo "$output" | jq -e '.connections.total == 47' >/dev/null
  echo "$output" | jq -e '.connections.high_confidence == 41' >/dev/null
  echo "$output" | jq -e '.connections.low_confidence == 6' >/dev/null
  echo "$output" | jq -e '.actors_count == 4' >/dev/null
  echo "$output" | jq -e '.hub | type == "object"' >/dev/null
  echo "$output" | jq -e '.project_root | type == "string"' >/dev/null
}

# ---------------------------------------------------------------------------
# Test 7 — scan_versions empty: no completed scan should NOT crash.
# Header should print "scanned never" (or equivalent) and exit 0.
# ---------------------------------------------------------------------------
@test "NAV-01: list does not crash when scan_versions is empty" {
  local hash
  hash="$(_arcanon_project_hash "$PROJECT_ROOT")"
  local db_path="$ARC_DATA_DIR/projects/$hash/impact-map.db"
  bash "$SEED_SH" "$PROJECT_ROOT" "$db_path" --no-scan >/dev/null
  _start_worker

  cd "$PROJECT_ROOT"
  run bash "$HUB_SH" list
  [ "$status" -eq 0 ]
  echo "$output" | grep -q "scanned never"
}

# ---------------------------------------------------------------------------
# Phase 121 Plan 02 — INT-08: /arcanon:list renders actor labels inline.
# Test 8: human mode shows labeled names in parentheses after the count.
# Test 9: --json mode includes an `actors` array of {name,label} objects.
# Test 10: human mode truncates at 5 labels with "+N more" suffix.
# Test 11: zero actors -> bare "N external" (no parenthetical), JSON empty array.
# ---------------------------------------------------------------------------

@test "INT-08: list shows labeled actor names inline in human mode" {
  local hash
  hash="$(_arcanon_project_hash "$PROJECT_ROOT")"
  local db_path="$ARC_DATA_DIR/projects/$hash/impact-map.db"
  bash "$SEED_SH" "$PROJECT_ROOT" "$db_path" --with-labels >/dev/null
  _start_worker

  cd "$PROJECT_ROOT"
  run bash "$HUB_SH" list
  [ "$status" -eq 0 ]

  # Actors line carries 4 external + parenthetical label list.
  echo "$output" | grep -q "Actors:"
  echo "$output" | grep -q "4 external"
  # Labels: 2 with friendly names, 2 falling back to raw hostnames.
  echo "$output" | grep -q "Stripe API"
  echo "$output" | grep -q "GitHub API"
  echo "$output" | grep -q "raw1.example.com"
  echo "$output" | grep -q "raw2.example.com"
  # Format: parenthetical follows "N external".
  [[ "$output" =~ Actors:[[:space:]]+4\ external\ \( ]]
}

@test "INT-08: list --json includes actors array of {name,label}" {
  local hash
  hash="$(_arcanon_project_hash "$PROJECT_ROOT")"
  local db_path="$ARC_DATA_DIR/projects/$hash/impact-map.db"
  bash "$SEED_SH" "$PROJECT_ROOT" "$db_path" --with-labels >/dev/null
  _start_worker

  cd "$PROJECT_ROOT"
  run bash "$HUB_SH" list --json
  [ "$status" -eq 0 ]

  # Existing fields still pass.
  echo "$output" | jq -e '.actors_count == 4' >/dev/null
  # New field: actors array with 4 entries; each carries name + label.
  echo "$output" | jq -e '.actors | type == "array"' >/dev/null
  echo "$output" | jq -e '.actors | length == 4' >/dev/null
  echo "$output" | jq -e '.actors[] | has("name") and has("label")' >/dev/null
  # Stripe is among the labeled ones.
  echo "$output" | jq -e '[.actors[] | select(.label == "Stripe API")] | length == 1' >/dev/null
  # Raw actor has label == null (NULL in DB surfaces as JSON null).
  echo "$output" | jq -e '[.actors[] | select(.label == null)] | length == 2' >/dev/null
}

@test "INT-08: list truncates at 5 labels with +N more suffix" {
  local hash
  hash="$(_arcanon_project_hash "$PROJECT_ROOT")"
  local db_path="$ARC_DATA_DIR/projects/$hash/impact-map.db"
  bash "$SEED_SH" "$PROJECT_ROOT" "$db_path" --with-many-labels >/dev/null
  _start_worker

  cd "$PROJECT_ROOT"
  run bash "$HUB_SH" list
  [ "$status" -eq 0 ]

  echo "$output" | grep -q "8 external"
  # First 5 of the 8 are inline; remaining 3 surface as "+3 more".
  echo "$output" | grep -q "+3 more"
}

@test "INT-08: zero actors yields bare count with no parenthetical" {
  local hash
  hash="$(_arcanon_project_hash "$PROJECT_ROOT")"
  local db_path="$ARC_DATA_DIR/projects/$hash/impact-map.db"
  bash "$SEED_SH" "$PROJECT_ROOT" "$db_path" --no-actors >/dev/null
  _start_worker

  cd "$PROJECT_ROOT"
  run bash "$HUB_SH" list
  [ "$status" -eq 0 ]
  # Bare line — no parens after "0 external".
  [[ "$output" =~ Actors:[[:space:]]+0\ external$ || "$output" =~ Actors:[[:space:]]+0\ external[[:space:]]*$'\n' ]] || \
    echo "$output" | grep -qE 'Actors:[[:space:]]+0 external([^(]|$)'

  # JSON parity.
  run bash "$HUB_SH" list --json
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.actors_count == 0' >/dev/null
  echo "$output" | jq -e '.actors | length == 0' >/dev/null
}
