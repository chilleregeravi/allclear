#!/usr/bin/env bats
# tests/shadow-scan.bats — Phase 119-01 (SHADOW-01).
#
# End-to-end coverage of /arcanon:shadow-scan and the underlying
# getShadowQueryEngine() pool helper. Pairs with the rescan/verify pattern:
# real worker, real on-disk fixtures, real shell wrapper.
#
# Test 1-6 cover Task 1 (getShadowQueryEngine) — pure node smoke harnesses,
# no worker needed.
# Test 7-13 cover Task 2 (POST /scan-shadow + cmdShadowScan + slash command)
# — spawn the worker on port 37995 with ARCANON_TEST_AGENT_RUNNER=1.
#
# Hard constraints from PLAN 119-01:
#   - Live impact-map.db MUST be byte-identical before/after a shadow scan
#     (Test 8 — sha256 assertion).
#   - Shadow data MUST NEVER upload to hub (skipHubSync flag — guarded by the
#     route's options.skipHubSync=true and verified indirectly: Test 8's
#     byte-identity assertion would fail if hub upload mutated state).

REPO_ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
PLUGIN_ROOT="${REPO_ROOT}/plugins/arcanon"
HUB_SH="${PLUGIN_ROOT}/scripts/hub.sh"
WORKER_INDEX="${PLUGIN_ROOT}/worker/index.js"
SEED_SH="${PLUGIN_ROOT}/tests/fixtures/shadow/seed.sh"
WORKER_PORT=37995

# ---------------------------------------------------------------------------
# Helpers (kept local — ZERO additions to test_helper.bash, mirrors verify.bats)
# ---------------------------------------------------------------------------

# Compute sha256(input)[0:12] — matches plugins/arcanon/worker/db/pool.js's
# projectHashDir(). Must match exactly or the worker won't find the DB.
_arcanon_project_hash() {
  printf "%s" "$1" | shasum -a 256 | awk '{print substr($1,1,12)}'
}

# sha256 of a file's full bytes (used by Test 8's byte-identity assertion).
_file_sha256() {
  shasum -a 256 "$1" | awk '{print $1}'
}

# Spawn the worker with the test agent runner stub installed. Blocks until
# /api/readiness responds 200 (or 30 attempts × 0.2s = 6s elapse).
_start_worker() {
  ARCANON_DATA_DIR="$ARC_DATA_DIR" \
  ARCANON_TEST_AGENT_RUNNER=1 \
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
      sleep 0.2
    done
    kill -9 "$pid" 2>/dev/null || true
  fi
}

setup() {
  mkdir -p "$BATS_TEST_TMPDIR/project"
  PROJECT_ROOT="$(cd "$BATS_TEST_TMPDIR/project" && pwd -P)"
  ARC_DATA_DIR="$BATS_TEST_TMPDIR/.arcanon"
  mkdir -p "$ARC_DATA_DIR"
  HASH="$(_arcanon_project_hash "$PROJECT_ROOT")"
  PROJECT_DIR="$ARC_DATA_DIR/projects/$HASH"
  LIVE_DB="$PROJECT_DIR/impact-map.db"
  SHADOW_DB="$PROJECT_DIR/impact-map-shadow.db"

  export ARCANON_DATA_DIR="$ARC_DATA_DIR"
  export ARCANON_WORKER_PORT="$WORKER_PORT"
}

teardown() {
  _stop_worker
}

# Latest migration version — derived from the migrations dir at runtime so the
# assertion is future-proof. Migration 017 currently shipped (Phase 117-01).
_latest_migration_version() {
  ls "${PLUGIN_ROOT}/worker/db/migrations/"*.js \
    | grep -v '\.test\.js$' \
    | xargs -n1 basename \
    | sed -E 's/^0*([0-9]+)_.*$/\1/' \
    | sort -n \
    | tail -1
}

# ===========================================================================
# Task 1 — getShadowQueryEngine() (no worker required)
# ===========================================================================

# ---------------------------------------------------------------------------
# Test 1 — fresh-open returns valid QE.
# ---------------------------------------------------------------------------
@test "Task 1 — Test 1: getShadowQueryEngine returns a valid QE for an existing shadow DB" {
  bash "$SEED_SH" "$PROJECT_ROOT" "$SHADOW_DB" >/dev/null

  run node --input-type=module -e "
    import { getShadowQueryEngine } from '${PLUGIN_ROOT}/worker/db/pool.js';
    const qe = getShadowQueryEngine('${PROJECT_ROOT}');
    if (!qe) { console.log(JSON.stringify({ok:false, reason:'null'})); process.exit(1); }
    const out = {
      ok: true,
      dbOpen: qe._db.open === true,
      hasUpsertRepo: typeof qe.upsertRepo === 'function',
      dbName: qe._db.name,
    };
    qe._db.close();
    console.log(JSON.stringify(out));
  "
  [ "$status" -eq 0 ]
  [[ "$output" == *'"ok":true'* ]]
  [[ "$output" == *'"dbOpen":true'* ]]
  [[ "$output" == *'"hasUpsertRepo":true'* ]]
  [[ "$output" == *"impact-map-shadow.db"* ]]
}

# ---------------------------------------------------------------------------
# Test 2 — uncached: separate calls return separate instances.
# ---------------------------------------------------------------------------
@test "Task 1 — Test 2: getShadowQueryEngine is uncached — two calls return DIFFERENT instances" {
  bash "$SEED_SH" "$PROJECT_ROOT" "$SHADOW_DB" >/dev/null

  run node --input-type=module -e "
    import { getShadowQueryEngine } from '${PLUGIN_ROOT}/worker/db/pool.js';
    const qe1 = getShadowQueryEngine('${PROJECT_ROOT}');
    const qe2 = getShadowQueryEngine('${PROJECT_ROOT}');
    if (!qe1 || !qe2) { console.log(JSON.stringify({ok:false, reason:'null-qe'})); process.exit(1); }
    const sameInstance = qe1 === qe2;
    const sameDbHandle = qe1._db === qe2._db;
    // Close qe1; qe2 must still be usable.
    qe1._db.close();
    let qe2StillOpen = qe2._db.open === true;
    let qe2CanQuery = false;
    try {
      qe2._db.prepare('SELECT 1 as x').get();
      qe2CanQuery = true;
    } catch {}
    qe2._db.close();
    console.log(JSON.stringify({ok:true, sameInstance, sameDbHandle, qe2StillOpen, qe2CanQuery}));
  "
  [ "$status" -eq 0 ]
  [[ "$output" == *'"sameInstance":false'* ]]
  [[ "$output" == *'"sameDbHandle":false'* ]]
  [[ "$output" == *'"qe2StillOpen":true'* ]]
  [[ "$output" == *'"qe2CanQuery":true'* ]]
}

# ---------------------------------------------------------------------------
# Test 3 — live and shadow are independent (different files).
# ---------------------------------------------------------------------------
@test "Task 1 — Test 3: live and shadow QE point at different DB files" {
  bash "$SEED_SH" "$PROJECT_ROOT" "$LIVE_DB" >/dev/null
  bash "$SEED_SH" "$PROJECT_ROOT" "$SHADOW_DB" >/dev/null

  run node --input-type=module -e "
    import { getQueryEngine, getShadowQueryEngine } from '${PLUGIN_ROOT}/worker/db/pool.js';
    const liveQe = getQueryEngine('${PROJECT_ROOT}');
    const shadowQe = getShadowQueryEngine('${PROJECT_ROOT}');
    if (!liveQe || !shadowQe) { console.log(JSON.stringify({ok:false, reason:'null-qe'})); process.exit(1); }
    const out = {
      liveDb: liveQe._db.name,
      shadowDb: shadowQe._db.name,
      liveEndsLive: liveQe._db.name.endsWith('impact-map.db'),
      shadowEndsShadow: shadowQe._db.name.endsWith('impact-map-shadow.db'),
      different: liveQe._db.name !== shadowQe._db.name,
    };
    shadowQe._db.close();
    console.log(JSON.stringify(out));
  "
  [ "$status" -eq 0 ]
  [[ "$output" == *'"liveEndsLive":true'* ]]
  [[ "$output" == *'"shadowEndsShadow":true'* ]]
  [[ "$output" == *'"different":true'* ]]
}

# ---------------------------------------------------------------------------
# Test 4 — create=true builds dir + applies migrations.
# ---------------------------------------------------------------------------
@test "Task 1 — Test 4: create=true creates the project dir and opens with migrations" {
  # Do NOT seed — let getShadowQueryEngine create everything from scratch.
  [ ! -e "$PROJECT_DIR" ]

  run node --input-type=module -e "
    import fs from 'node:fs';
    import { getShadowQueryEngine } from '${PLUGIN_ROOT}/worker/db/pool.js';
    const qe = getShadowQueryEngine('${PROJECT_ROOT}', { create: true });
    if (!qe) { console.log(JSON.stringify({ok:false, reason:'null'})); process.exit(1); }
    const dirExists = fs.existsSync('${PROJECT_DIR}');
    const dbExists = fs.existsSync('${SHADOW_DB}');
    const ver = qe._db.prepare('SELECT MAX(version) as v FROM schema_versions').get().v;
    qe._db.close();
    console.log(JSON.stringify({ok:true, dirExists, dbExists, ver}));
  "
  [ "$status" -eq 0 ]
  [[ "$output" == *'"dirExists":true'* ]]
  [[ "$output" == *'"dbExists":true'* ]]
  # Migration head should equal the latest migration on disk (currently 17).
  LATEST=$(_latest_migration_version)
  [[ "$output" == *"\"ver\":${LATEST}"* ]]
}

# ---------------------------------------------------------------------------
# Test 5 — create=false (default) returns null when shadow DB absent.
# ---------------------------------------------------------------------------
@test "Task 1 — Test 5: getShadowQueryEngine returns null and creates nothing when shadow DB absent" {
  # Do NOT seed.
  [ ! -e "$SHADOW_DB" ]

  run node --input-type=module -e "
    import fs from 'node:fs';
    import { getShadowQueryEngine } from '${PLUGIN_ROOT}/worker/db/pool.js';
    const qe = getShadowQueryEngine('${PROJECT_ROOT}');
    const dbExistsAfter = fs.existsSync('${SHADOW_DB}');
    console.log(JSON.stringify({qeIsNull: qe === null, dbExistsAfter}));
  "
  [ "$status" -eq 0 ]
  [[ "$output" == *'"qeIsNull":true'* ]]
  [[ "$output" == *'"dbExistsAfter":false'* ]]
}

# ---------------------------------------------------------------------------
# Test 6 — migrations applied (schema_versions head matches latest on disk).
# Already partly covered by Test 4; this version asserts the schema head
# explicitly via the disk-derived LATEST helper so the test is future-proof.
# ---------------------------------------------------------------------------
@test "Task 1 — Test 6: fresh-open with create=true applies all migrations on disk" {
  run node --input-type=module -e "
    import { getShadowQueryEngine } from '${PLUGIN_ROOT}/worker/db/pool.js';
    const qe = getShadowQueryEngine('${PROJECT_ROOT}', { create: true });
    const ver = qe._db.prepare('SELECT MAX(version) as v FROM schema_versions').get().v;
    // scan_overrides table exists (mig 017) — direct table-existence probe.
    const tbl = qe._db.prepare(
      \"SELECT name FROM sqlite_master WHERE type='table' AND name='scan_overrides'\"
    ).get();
    qe._db.close();
    console.log(JSON.stringify({ver, hasScanOverrides: !!tbl}));
  "
  [ "$status" -eq 0 ]
  LATEST=$(_latest_migration_version)
  [[ "$output" == *"\"ver\":${LATEST}"* ]]
  [[ "$output" == *'"hasScanOverrides":true'* ]]
}

# ===========================================================================
# Task 2 — POST /scan-shadow + cmdShadowScan + slash command
# ===========================================================================

# ---------------------------------------------------------------------------
# Test 7 — HTTP route exists and dispatches scanRepos through the shadow QE.
# ---------------------------------------------------------------------------
@test "Task 2 — Test 7: POST /scan-shadow returns 200 with results array" {
  bash "$SEED_SH" "$PROJECT_ROOT" "$LIVE_DB" >/dev/null
  _start_worker

  # POST /scan-shadow?project=<encoded-root>
  ENCODED=$(node -e "process.stdout.write(encodeURIComponent('${PROJECT_ROOT}'))")
  run curl -sS -X POST "http://127.0.0.1:${WORKER_PORT}/scan-shadow?project=${ENCODED}" \
    -H 'content-type: application/json' -d '{}'
  [ "$status" -eq 0 ]
  [[ "$output" == *'"ok":true'* ]]
  [[ "$output" == *'"results"'* ]]
  [[ "$output" == *'"shadow_db_path"'* ]]
  [[ "$output" == *"impact-map-shadow.db"* ]]
}

# ---------------------------------------------------------------------------
# Test 8 — Live DB is BYTE-IDENTICAL before/after a shadow scan, AND the
# shadow DB exists with the scanned data. Anchors the read-only contract
# for live + the no-hub-upload guard (T-119-01-06).
# ---------------------------------------------------------------------------
@test "Task 2 — Test 8: shadow scan leaves live impact-map.db byte-identical" {
  bash "$SEED_SH" "$PROJECT_ROOT" "$LIVE_DB" >/dev/null
  LIVE_HASH_BEFORE=$(_file_sha256 "$LIVE_DB")
  [ ! -f "$SHADOW_DB" ]

  _start_worker

  ENCODED=$(node -e "process.stdout.write(encodeURIComponent('${PROJECT_ROOT}'))")
  run curl -sS -X POST "http://127.0.0.1:${WORKER_PORT}/scan-shadow?project=${ENCODED}" \
    -H 'content-type: application/json' -d '{}'
  [ "$status" -eq 0 ]
  [[ "$output" == *'"ok":true'* ]]

  # Live byte-identity assertion.
  LIVE_HASH_AFTER=$(_file_sha256 "$LIVE_DB")
  [ "$LIVE_HASH_BEFORE" = "$LIVE_HASH_AFTER" ]

  # Shadow DB now exists.
  [ -f "$SHADOW_DB" ]
}

# ---------------------------------------------------------------------------
# Test 9 — cmdShadowScan happy path via the shell wrapper.
# ---------------------------------------------------------------------------
@test "Task 2 — Test 9: bash hub.sh shadow-scan exits 0, reports completion, creates shadow DB" {
  bash "$SEED_SH" "$PROJECT_ROOT" "$LIVE_DB" >/dev/null
  _start_worker

  cd "$PROJECT_ROOT"
  run bash "$HUB_SH" shadow-scan
  [ "$status" -eq 0 ]
  [[ "$output" == *"Shadow scan complete"* ]]
  [ -f "$SHADOW_DB" ]
}

# ---------------------------------------------------------------------------
# Test 10 — Existing shadow DB triggers a one-line warning, then proceeds.
# ---------------------------------------------------------------------------
@test "Task 2 — Test 10: cmdShadowScan warns when shadow DB already exists, then proceeds" {
  bash "$SEED_SH" "$PROJECT_ROOT" "$LIVE_DB" >/dev/null
  bash "$SEED_SH" "$PROJECT_ROOT" "$SHADOW_DB" >/dev/null
  _start_worker

  cd "$PROJECT_ROOT"
  run bash "$HUB_SH" shadow-scan
  [ "$status" -eq 0 ]
  [[ "$output" == *"Existing shadow DB will be overwritten"* ]]
  [[ "$output" == *"Shadow scan complete"* ]]
}

# ---------------------------------------------------------------------------
# Test 11 — Silent in non-Arcanon directory (mirrors NAV-01 / CORRECT-04).
# ---------------------------------------------------------------------------
@test "Task 2 — Test 11: shadow-scan is silent (exit 0, no output) in non-Arcanon dir" {
  cd "$PROJECT_ROOT"
  # No live DB — cmdShadowScan must silent-exit 0.
  run bash "$HUB_SH" shadow-scan
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

# ---------------------------------------------------------------------------
# Test 12 — commands-surface regression: shadow-scan.md exists with valid
# frontmatter and is iterated by tests/commands-surface.bats.
# ---------------------------------------------------------------------------
@test "Task 2 — Test 12: shadow-scan.md has description + allowed-tools: Bash frontmatter" {
  [ -f "$PLUGIN_ROOT/commands/shadow-scan.md" ]
  run grep -E '^description:' "$PLUGIN_ROOT/commands/shadow-scan.md"
  [ "$status" -eq 0 ]
  run grep -E '^allowed-tools:' "$PLUGIN_ROOT/commands/shadow-scan.md"
  [ "$status" -eq 0 ]
  grep -q 'Bash' "$PLUGIN_ROOT/commands/shadow-scan.md"
  # Must dispatch through hub.sh shadow-scan.
  grep -q 'hub.sh shadow-scan' "$PLUGIN_ROOT/commands/shadow-scan.md"
  # HANDLERS map must register the hyphenated key.
  grep -q '"shadow-scan": cmdShadowScan' "$PLUGIN_ROOT/worker/cli/hub.js"
}

# ---------------------------------------------------------------------------
# Test 13 — --json output: single JSON object with shadow_db_path + results.
# ---------------------------------------------------------------------------
@test "Task 2 — Test 13: cmdShadowScan --json emits structured output" {
  bash "$SEED_SH" "$PROJECT_ROOT" "$LIVE_DB" >/dev/null
  _start_worker

  cd "$PROJECT_ROOT"
  run bash "$HUB_SH" shadow-scan --json
  [ "$status" -eq 0 ]
  # Must be a single JSON object with the documented fields.
  echo "$output" | node -e "
    let s=''; process.stdin.on('data', d => s += d); process.stdin.on('end', () => {
      const o = JSON.parse(s);
      if (typeof o.shadow_db_path !== 'string') { console.error('missing shadow_db_path'); process.exit(1); }
      if (!Array.isArray(o.results)) { console.error('missing results'); process.exit(1); }
      if (typeof o.reused_existing !== 'boolean') { console.error('missing reused_existing'); process.exit(1); }
    });
  "
}
