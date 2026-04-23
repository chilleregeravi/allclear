#!/usr/bin/env bats
# tests/impact-hook.bats — HOK-13 fixtures + HOK-06 p99 latency benchmark
#
# Tests:
#   1  Tier 1 match       — *.proto edit emits systemMessage (no DB needed)
#   2  Tier 2 match       — file inside tracked service root_path emits consumer warning
#   3  False-positive guard — auth-legacy does NOT match auth service
#   4  Self-exclusion     — file inside $CLAUDE_PLUGIN_ROOT produces empty stdout
#   5  Worker-down fallback — SQLite direct path warns without worker running
#   6  Latency p99 < 50ms — 100 iterations, p99 must be under 50ms
#   7  Invariant: never exits 2 on malformed stdin
#   8  Invariant: ARCANON_DISABLE_HOOK=1 silences everything
#
# Run:
#   tests/bats/bin/bats tests/impact-hook.bats

setup() {
  load 'test_helper/bats-support/load'
  load 'test_helper/bats-assert/load'

  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/.." && pwd)"
  SCRIPT="${REPO_ROOT}/plugins/arcanon/scripts/impact-hook.sh"
  export CLAUDE_PLUGIN_ROOT="${REPO_ROOT}/plugins/arcanon"

  # Unique temp root per test — prevents parallel-run collisions
  TMP_ROOT="$(mktemp -d /tmp/arcanon-impact-hook.XXXXXX)"
  export ARCANON_DATA_DIR="${TMP_ROOT}/data"
  export PROJECT_ROOT="${TMP_ROOT}/project"
  mkdir -p "$ARCANON_DATA_DIR"

  # Unset any env vars that could leak between tests
  unset ARCANON_DISABLE_HOOK  || true
  unset ARCANON_IMPACT_DEBUG  || true

  # Source the fixture factory (provides setup_fake_db / teardown_fake_db)
  # shellcheck source=./fixtures/impact-hook/setup-fake-db.sh
  source "${BATS_TEST_DIRNAME}/fixtures/impact-hook/setup-fake-db.sh"
}

teardown() {
  teardown_fake_db
  # Belt-and-suspenders: also remove the whole TMP_ROOT
  [[ -n "${TMP_ROOT:-}" && -d "$TMP_ROOT" ]] && rm -rf "$TMP_ROOT"
}

# ─────────────────────────────────────────────────────────────────────────────
# HOK-13 fixture 1: Tier 1 match — *.proto edit triggers warning
# Pure bash path — no DB required.
# ─────────────────────────────────────────────────────────────────────────────
@test "impact-hook - Tier 1: .proto edit emits systemMessage" {
  local json='{"tool_name":"Write","tool_input":{"file_path":"/tmp/api.proto"}}'
  run bash -c "printf '%s' '${json}' | bash '${SCRIPT}'"
  assert_success
  assert_output --partial 'systemMessage'
  assert_output --partial 'api.proto'
}

# ─────────────────────────────────────────────────────────────────────────────
# HOK-13 fixture 2: Tier 2 match — file inside tracked service root_path
# Expects: stdout contains "auth" and "web" (consumer), exits 0.
# ─────────────────────────────────────────────────────────────────────────────
@test "impact-hook - Tier 2: file inside service root_path emits consumer warning" {
  setup_fake_db

  local file json
  file="${PROJECT_ROOT}/services/auth/index.js"
  json=$(printf '{"tool_name":"Write","tool_input":{"file_path":"%s"}}' "$file")

  run bash -c "
    export ARCANON_DATA_DIR='${ARCANON_DATA_DIR}'
    export PROJECT_ROOT='${PROJECT_ROOT}'
    printf '%s' '${json}' | bash '${SCRIPT}'
  "
  assert_success
  assert_output --partial 'systemMessage'
  assert_output --partial 'auth'
  assert_output --partial 'web'
}

# ─────────────────────────────────────────────────────────────────────────────
# HOK-13 fixture 3: False-positive guard — auth-legacy must NOT match auth
# DB only has "auth" and "web" services; auth-legacy is NOT tracked.
# ─────────────────────────────────────────────────────────────────────────────
@test "impact-hook - HOK-03: auth-legacy does NOT match auth service" {
  setup_fake_db

  local file json
  file="${PROJECT_ROOT}/services/auth-legacy/foo.js"
  json=$(printf '{"tool_name":"Write","tool_input":{"file_path":"%s"}}' "$file")

  run bash -c "
    export ARCANON_DATA_DIR='${ARCANON_DATA_DIR}'
    export PROJECT_ROOT='${PROJECT_ROOT}'
    printf '%s' '${json}' | bash '${SCRIPT}'
  "
  assert_success
  # auth-legacy is not in the DB — no Tier 2 match — output must be empty
  if [[ -n "$output" ]]; then
    echo "Expected empty output for auth-legacy; got: $output" >&2
    return 1
  fi
}

# ─────────────────────────────────────────────────────────────────────────────
# HOK-13 fixture 4: Self-exclusion — file inside $CLAUDE_PLUGIN_ROOT is ignored
# ─────────────────────────────────────────────────────────────────────────────
@test "impact-hook - HOK-07: self-exclusion for \$CLAUDE_PLUGIN_ROOT" {
  local file json
  file="${CLAUDE_PLUGIN_ROOT}/worker/foo.js"
  json=$(printf '{"tool_name":"Write","tool_input":{"file_path":"%s"}}' "$file")

  run bash -c "
    export CLAUDE_PLUGIN_ROOT='${CLAUDE_PLUGIN_ROOT}'
    printf '%s' '${json}' | bash '${SCRIPT}'
  "
  assert_success
  if [[ -n "$output" ]]; then
    echo "Expected empty output for self-exclusion; got: $output" >&2
    return 1
  fi
}

# ─────────────────────────────────────────────────────────────────────────────
# HOK-13 fixture 5: Worker-down fallback — hook warns via SQLite even with no worker
# worker.port file is absent → worker_running returns non-zero → SQLite fallback fires.
# ─────────────────────────────────────────────────────────────────────────────
@test "impact-hook - HOK-04: worker-down fallback uses SQLite" {
  setup_fake_db

  # Ensure no worker.port (worker is "down") — ARCANON_DATA_DIR is our temp dir
  rm -f "${ARCANON_DATA_DIR}/worker.port"

  local file json
  file="${PROJECT_ROOT}/services/auth/index.js"
  json=$(printf '{"tool_name":"Write","tool_input":{"file_path":"%s"}}' "$file")

  run bash -c "
    export ARCANON_DATA_DIR='${ARCANON_DATA_DIR}'
    export PROJECT_ROOT='${PROJECT_ROOT}'
    printf '%s' '${json}' | bash '${SCRIPT}'
  "
  assert_success
  assert_output --partial 'systemMessage'
  assert_output --partial 'auth'
  assert_output --partial 'web'
}

# ─────────────────────────────────────────────────────────────────────────────
# HOK-06 fixture 6: p99 latency benchmark over 100 iterations
# Delegates to impact-hook-latency.sh (shared benchmark body).
#
# Default threshold: 50ms (HOK-06 requirement).
# Override on slow CI/dev machines via IMPACT_HOOK_LATENCY_THRESHOLD env var:
#   IMPACT_HOOK_LATENCY_THRESHOLD=200 tests/bats/bin/bats tests/impact-hook.bats
# When overriding, the actual p99 is printed so it can be tracked over time.
# ─────────────────────────────────────────────────────────────────────────────
@test "impact-hook - HOK-06: p99 latency < \${IMPACT_HOOK_LATENCY_THRESHOLD:-50}ms over 100 iterations" {
  setup_fake_db

  export THRESHOLD_MS="${IMPACT_HOOK_LATENCY_THRESHOLD:-50}"
  export ITERATIONS=100

  run bash "${BATS_TEST_DIRNAME}/impact-hook-latency.sh"
  assert_success
  assert_output --partial 'p99='
}

# ─────────────────────────────────────────────────────────────────────────────
# Invariant: hook NEVER exits 2 regardless of input quality
# ─────────────────────────────────────────────────────────────────────────────
@test "impact-hook - invariant: never exits 2 on malformed stdin" {
  run bash -c "printf 'not json at all !@#\$%%^&*' | bash '${SCRIPT}'"
  # Must be exit 0 — never 2, never any non-zero value
  assert_success
}

# ─────────────────────────────────────────────────────────────────────────────
# Invariant: ARCANON_DISABLE_HOOK=1 silences everything — exits 0, no stdout
# ─────────────────────────────────────────────────────────────────────────────
@test "impact-hook - invariant: ARCANON_DISABLE_HOOK=1 silences everything" {
  local json='{"tool_name":"Write","tool_input":{"file_path":"/tmp/api.proto"}}'
  # The proto path would trigger Tier 1 — DISABLE_HOOK must short-circuit before that
  run bash -c "ARCANON_DISABLE_HOOK=1 bash '${SCRIPT}' <<< '${json}'"
  assert_success
  if [[ -n "$output" ]]; then
    echo "Expected empty output with ARCANON_DISABLE_HOOK=1; got: $output" >&2
    return 1
  fi
}
