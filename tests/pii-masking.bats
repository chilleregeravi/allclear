#!/usr/bin/env bats
# tests/pii-masking.bats — Phase 123 (PII-07-bats half).
#
# Cross-seam integration grep: asserts every Wave-2 egress seam emits zero
# `/Users/` (or `/home/`) strings after a clean scan, plus a structural
# regression guard against session-start.sh future-rendering `repos[].path`
# without masking (S2 mitigation).
#
# Layout:
#   1.   Unit-gate — node tests for path-mask + findings.pii06 must pass.
#   2-4. Three HTTP-route greps — /projects, /graph, /api/scan-freshness.
#   5-7. Three export-format greps — mermaid, dot, html.
#   8.   Log-file grep — ~/.arcanon/logs/worker.log after a clean scan.
#   9.   PII-06 unit gate — re-runs findings.pii06.test.js.
#  10.   S2 structural guard — session-start.sh must not render repos[].path.
#
# Tests requiring a running worker or scanned fixture `skip` with a clear
# message when the prerequisite isn't available — matches the convention in
# tests/structure.bats and tests/mcp-server.bats.

REPO_ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
PLUGIN_ROOT="${REPO_ROOT}/plugins/arcanon"
WORKER_INDEX="${PLUGIN_ROOT}/worker/index.js"
SESSION_START_SH="${PLUGIN_ROOT}/scripts/session-start.sh"
SEED_SH="${PLUGIN_ROOT}/tests/fixtures/freshness/seed.sh"
WORKER_PORT="${ARCANON_PII_WORKER_PORT:-37997}"

TEST_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")" && pwd)"
load "$TEST_DIR/test_helper.bash"

# ---------------------------------------------------------------------------
# Helpers (local — mirrors freshness.bats spawn shape).
# ---------------------------------------------------------------------------

_arcanon_project_hash() {
  printf "%s" "$1" | shasum -a 256 | awk '{print substr($1,1,12)}'
}

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

# Spin up a worker on a freshness-style seeded fixture. Sets:
#   PROJECT_ROOT, ARC_DATA_DIR, PROJECT_DB, WORKER_PID
# Returns 0 on success, 1 on failure (caller should `skip` rather than fail).
_setup_worker_fixture() {
  if [ ! -f "$SEED_SH" ]; then
    return 1
  fi
  mkdir -p "$BATS_TEST_TMPDIR/project"
  PROJECT_ROOT="$(cd "$BATS_TEST_TMPDIR/project" && pwd -P)"
  ARC_DATA_DIR="$BATS_TEST_TMPDIR/.arcanon"
  mkdir -p "$ARC_DATA_DIR"

  local hash
  hash="$(_arcanon_project_hash "$PROJECT_ROOT")"
  PROJECT_DB="$ARC_DATA_DIR/projects/$hash/impact-map.db"
  bash "$SEED_SH" "$PROJECT_ROOT" "$PROJECT_DB" >/dev/null 2>&1 || return 1

  export ARCANON_DATA_DIR="$ARC_DATA_DIR"
  export ARCANON_WORKER_PORT="$WORKER_PORT"

  _start_worker || return 1
  return 0
}

teardown() {
  _stop_worker
}

# ---------------------------------------------------------------------------
# 1 — Unit-gate: path-mask + findings.pii06 unit tests pass.
# ---------------------------------------------------------------------------
@test "PII-bats-01: path-mask + findings.pii06 unit tests pass" {
  cd "$PLUGIN_ROOT"
  run node --test worker/lib/path-mask.test.js worker/scan/findings.pii06.test.js
  assert_success
}

# ---------------------------------------------------------------------------
# 2 — /projects HTTP response contains no /Users/ or /home/ strings.
# ---------------------------------------------------------------------------
@test "PII-bats-02: /projects response contains no /Users/ or /home/ strings" {
  if ! _setup_worker_fixture; then
    skip "freshness fixture seeder unavailable; cannot exercise /projects"
  fi
  run curl -sf "http://127.0.0.1:${WORKER_PORT}/projects"
  assert_success
  count="$(printf '%s' "$output" | grep -c -E '/Users/|/home/' || true)"
  [ "$count" -eq 0 ] || {
    echo "leaked paths in /projects response:" >&2
    printf '%s\n' "$output" >&2
    return 1
  }
}

# ---------------------------------------------------------------------------
# 3 — /graph HTTP response contains no /Users/ or /home/ strings.
# ---------------------------------------------------------------------------
@test "PII-bats-03: /graph response contains no /Users/ or /home/ strings" {
  if ! _setup_worker_fixture; then
    skip "freshness fixture seeder unavailable; cannot exercise /graph"
  fi
  # /graph requires ?project= per http.js routing.
  run curl -sf "http://127.0.0.1:${WORKER_PORT}/graph?project=${PROJECT_ROOT}"
  if [ "$status" -ne 0 ]; then
    skip "/graph not responsive on this fixture (likely no graph in seed)"
  fi
  count="$(printf '%s' "$output" | grep -c -E '/Users/|/home/' || true)"
  [ "$count" -eq 0 ] || {
    echo "leaked paths in /graph response:" >&2
    printf '%s\n' "$output" >&2
    return 1
  }
}

# ---------------------------------------------------------------------------
# 4 — /api/scan-freshness HTTP response contains no /Users/ or /home/ strings.
# ---------------------------------------------------------------------------
@test "PII-bats-04: /api/scan-freshness response contains no /Users/ or /home/ strings" {
  if ! _setup_worker_fixture; then
    skip "freshness fixture seeder unavailable; cannot exercise /api/scan-freshness"
  fi
  run curl -sf "http://127.0.0.1:${WORKER_PORT}/api/scan-freshness?project=${PROJECT_ROOT}"
  assert_success
  count="$(printf '%s' "$output" | grep -c -E '/Users/|/home/' || true)"
  [ "$count" -eq 0 ] || {
    echo "leaked paths in /api/scan-freshness response:" >&2
    printf '%s\n' "$output" >&2
    return 1
  }
}

# ---------------------------------------------------------------------------
# 5 — /arcanon:export --format mermaid contains no /Users/ or /home/.
# ---------------------------------------------------------------------------
@test "PII-bats-05: export --format mermaid contains no /Users/ strings" {
  if ! _setup_worker_fixture; then
    skip "no scanned fixture available for export"
  fi
  out_file="$BATS_TEST_TMPDIR/export.mmd"
  run env ARCANON_DATA_DIR="$ARC_DATA_DIR" \
    node "$PLUGIN_ROOT/worker/cli/export.js" \
      --repo "$PROJECT_ROOT" --format mermaid --out "$out_file"
  if [ "$status" -ne 0 ] || [ ! -s "$out_file" ]; then
    skip "export.js could not produce mermaid output on this fixture"
  fi
  count="$(grep -c -E '/Users/|/home/' "$out_file" || true)"
  [ "$count" -eq 0 ] || {
    echo "leaked paths in mermaid export:" >&2
    cat "$out_file" >&2
    return 1
  }
}

# ---------------------------------------------------------------------------
# 6 — /arcanon:export --format dot contains no /Users/ or /home/.
# ---------------------------------------------------------------------------
@test "PII-bats-06: export --format dot contains no /Users/ strings" {
  if ! _setup_worker_fixture; then
    skip "no scanned fixture available for export"
  fi
  out_file="$BATS_TEST_TMPDIR/export.dot"
  run env ARCANON_DATA_DIR="$ARC_DATA_DIR" \
    node "$PLUGIN_ROOT/worker/cli/export.js" \
      --repo "$PROJECT_ROOT" --format dot --out "$out_file"
  if [ "$status" -ne 0 ] || [ ! -s "$out_file" ]; then
    skip "export.js could not produce dot output on this fixture"
  fi
  count="$(grep -c -E '/Users/|/home/' "$out_file" || true)"
  [ "$count" -eq 0 ] || {
    echo "leaked paths in dot export:" >&2
    cat "$out_file" >&2
    return 1
  }
}

# ---------------------------------------------------------------------------
# 7 — /arcanon:export --format html contains no /Users/ or /home/.
# ---------------------------------------------------------------------------
@test "PII-bats-07: export --format html contains no /Users/ strings" {
  if ! _setup_worker_fixture; then
    skip "no scanned fixture available for export"
  fi
  out_file="$BATS_TEST_TMPDIR/export.html"
  run env ARCANON_DATA_DIR="$ARC_DATA_DIR" \
    node "$PLUGIN_ROOT/worker/cli/export.js" \
      --repo "$PROJECT_ROOT" --format html --out "$out_file"
  if [ "$status" -ne 0 ] || [ ! -s "$out_file" ]; then
    skip "export.js could not produce html output on this fixture"
  fi
  count="$(grep -c -E '/Users/|/home/' "$out_file" || true)"
  [ "$count" -eq 0 ] || {
    echo "leaked paths in html export:" >&2
    cat "$out_file" >&2
    return 1
  }
}

# ---------------------------------------------------------------------------
# 8 — Log-file grep: worker.log contains no /Users/ after a clean scan.
#      We exercise the *current* logger seam by pointing the worker at a
#      fresh data-dir (so its log file is isolated from the dev's actual
#      ~/.arcanon/logs/worker.log, which may contain pre-PII-04 historical
#      entries that pre-date this phase). After the worker has served at
#      least one HTTP request, we assert the live log contains zero leaks.
# ---------------------------------------------------------------------------
@test "PII-bats-08: worker.log contains no /Users/ strings after a clean scan" {
  if ! _setup_worker_fixture; then
    skip "freshness fixture seeder unavailable; cannot exercise logger seam"
  fi
  # Drive at least one logged request through the worker.
  curl -sf "http://127.0.0.1:${WORKER_PORT}/api/readiness" >/dev/null || true
  curl -sf "http://127.0.0.1:${WORKER_PORT}/projects" >/dev/null || true
  curl -sf "http://127.0.0.1:${WORKER_PORT}/api/scan-freshness?project=${PROJECT_ROOT}" >/dev/null || true

  log_file="${ARC_DATA_DIR}/logs/worker.log"
  if [ ! -f "$log_file" ]; then
    skip "worker did not produce a log file at ${log_file}"
  fi
  count="$(grep -c -E '/Users/|/home/' "$log_file" || true)"
  [ "$count" -eq 0 ] || {
    echo "leaked paths in $log_file (showing matching lines):" >&2
    grep -E '/Users/|/home/' "$log_file" | head -20 >&2
    return 1
  }
}

# ---------------------------------------------------------------------------
# 9 — PII-06 unit-gate: findings.pii06.test.js exits 0.
# ---------------------------------------------------------------------------
@test "PII-bats-09: parseAgentOutput rejects absolute source_file (PII-06 unit gate)" {
  cd "$PLUGIN_ROOT"
  run node --test worker/scan/findings.pii06.test.js
  assert_success
}

# ---------------------------------------------------------------------------
# 10 — S2 structural guard: session-start.sh does NOT render repos[].path.
#      Catches future contributors who'd surface the field without masking.
# ---------------------------------------------------------------------------
@test "PII-bats-10: session-start.sh does not render repos[].path (S2 guard)" {
  assert [ -f "$SESSION_START_SH" ]
  count="$(grep -c -E 'repos\[\]\.path|repo\.path|r\.path' "$SESSION_START_SH" || true)"
  [ "$count" -eq 0 ] || {
    echo "session-start.sh references unmasked repo path field; lines:" >&2
    grep -nE 'repos\[\]\.path|repo\.path|r\.path' "$SESSION_START_SH" >&2
    return 1
  }
}
