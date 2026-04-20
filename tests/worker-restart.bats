#!/usr/bin/env bats
# tests/worker-restart.bats — lib/worker-restart.sh
# Covers: DSP-05 (API surface), DSP-06/07 (behavior parity with old inline code)

load 'test_helper/bats-support/load'
load 'test_helper/bats-assert/load'

PLUGIN_ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/../plugins/arcanon" && pwd)"

setup() {
  export ARCANON_DATA_DIR="$(mktemp -d)"
  export CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT"
  export ARCANON_WORKER_PORT="37998"
}

teardown() {
  if [[ -f "${ARCANON_DATA_DIR}/worker.pid" ]]; then
    local pid; pid=$(cat "${ARCANON_DATA_DIR}/worker.pid")
    kill "$pid" 2>/dev/null || true
    sleep 0.3
  fi
  rm -rf "$ARCANON_DATA_DIR"
}

# ─── WR1: cold start — no PID file ───────────────────────────────────────────

@test "should_restart_worker: no PID file → _should_restart=true, _restart_reason=no_pid_file" {
  run bash -c "
    source '$PLUGIN_ROOT/lib/worker-client.sh'
    source '$PLUGIN_ROOT/lib/worker-restart.sh'
    should_restart_worker
    echo \"should_restart=\$_should_restart reason=\$_restart_reason\"
  "
  assert_success
  [[ "$output" == *"should_restart=true"* ]] || { echo "expected should_restart=true, got: $output"; return 1; }
  [[ "$output" == *"reason=no_pid_file"* ]] || { echo "expected reason=no_pid_file, got: $output"; return 1; }
}

# ─── WR2: stale PID ──────────────────────────────────────────────────────────

@test "should_restart_worker: stale PID file → _should_restart=true, _restart_reason=stale_pid" {
  # Write a PID that almost certainly doesn't exist (unused high PID)
  echo "99999" > "${ARCANON_DATA_DIR}/worker.pid"
  run bash -c "
    source '$PLUGIN_ROOT/lib/worker-client.sh'
    source '$PLUGIN_ROOT/lib/worker-restart.sh'
    should_restart_worker
    echo \"should_restart=\$_should_restart reason=\$_restart_reason\"
  "
  assert_success
  [[ "$output" == *"should_restart=true"* ]] || { echo "expected should_restart=true, got: $output"; return 1; }
  [[ "$output" == *"reason=stale_pid"* ]] || { echo "expected reason=stale_pid, got: $output"; return 1; }
}

# ─── WR3: running worker, versions match ─────────────────────────────────────

@test "should_restart_worker: running worker with matching version → _should_restart=false" {
  # Start real worker using worker-start.sh
  run bash "$PLUGIN_ROOT/scripts/worker-start.sh"
  assert_success

  # Wait for readiness
  source "$PLUGIN_ROOT/lib/worker-client.sh"
  wait_for_worker 20 250

  run bash -c "
    source '$PLUGIN_ROOT/lib/worker-client.sh'
    source '$PLUGIN_ROOT/lib/worker-restart.sh'
    should_restart_worker
    echo \"should_restart=\$_should_restart reason=\$_restart_reason\"
  "
  assert_success
  [[ "$output" == *"should_restart=false"* ]] || { echo "expected should_restart=false, got: $output"; return 1; }
  [[ "$output" == *"reason=ok"* ]] || { echo "expected reason=ok, got: $output"; return 1; }
}

# ─── WR4: running worker, version mismatch ───────────────────────────────────

@test "should_restart_worker: running worker with version mismatch → _should_restart=true, _restart_reason=version_mismatch" {
  # Start real worker (reports its real package.json version via /api/version)
  run bash "$PLUGIN_ROOT/scripts/worker-start.sh"
  assert_success

  source "$PLUGIN_ROOT/lib/worker-client.sh"
  wait_for_worker 20 250

  # Point CLAUDE_PLUGIN_ROOT at a fake plugin root whose package.json reports a DIFFERENT version
  FAKE_ROOT="$(mktemp -d)"
  echo '{"version": "99.99.99"}' > "${FAKE_ROOT}/package.json"
  # Symlink lib/ so worker-client.sh resolves — we only care about version comparison
  mkdir -p "${FAKE_ROOT}/lib"
  cp "$PLUGIN_ROOT/lib/data-dir.sh"      "${FAKE_ROOT}/lib/data-dir.sh"
  cp "$PLUGIN_ROOT/lib/worker-client.sh" "${FAKE_ROOT}/lib/worker-client.sh"
  cp "$PLUGIN_ROOT/lib/worker-restart.sh" "${FAKE_ROOT}/lib/worker-restart.sh"

  run bash -c "
    export CLAUDE_PLUGIN_ROOT='$FAKE_ROOT'
    source '$FAKE_ROOT/lib/worker-client.sh'
    source '$FAKE_ROOT/lib/worker-restart.sh'
    should_restart_worker
    echo \"should_restart=\$_should_restart reason=\$_restart_reason installed=\$_installed_version running=\$_running_version\"
  "
  assert_success
  [[ "$output" == *"should_restart=true"* ]] || { echo "expected should_restart=true, got: $output"; return 1; }
  [[ "$output" == *"reason=version_mismatch"* ]] || { echo "expected reason=version_mismatch, got: $output"; return 1; }
  [[ "$output" == *"installed=99.99.99"* ]] || { echo "expected installed=99.99.99, got: $output"; return 1; }

  rm -rf "$FAKE_ROOT"
}

# ─── WR5: restart_worker_if_stale is a no-op when not stale ─────────────────

@test "restart_worker_if_stale: no-op when worker running and versions match" {
  run bash "$PLUGIN_ROOT/scripts/worker-start.sh"
  assert_success

  source "$PLUGIN_ROOT/lib/worker-client.sh"
  wait_for_worker 20 250

  local pid_before; pid_before=$(cat "${ARCANON_DATA_DIR}/worker.pid")

  run bash -c "
    source '$PLUGIN_ROOT/lib/worker-client.sh'
    source '$PLUGIN_ROOT/lib/worker-restart.sh'
    restart_worker_if_stale
    echo \"worker_restarted=\$_worker_restarted\"
  "
  assert_success
  [[ "$output" == *"worker_restarted=false"* ]] || { echo "expected worker_restarted=false, got: $output"; return 1; }

  # PID file still references the same process
  local pid_after; pid_after=$(cat "${ARCANON_DATA_DIR}/worker.pid")
  [[ "$pid_before" == "$pid_after" ]] || { echo "PID changed unexpectedly: $pid_before → $pid_after"; return 1; }
}

# ─── WR6: direct execution refusal ───────────────────────────────────────────

@test "worker-restart.sh refuses direct execution (exit 1 + stderr message)" {
  run bash "$PLUGIN_ROOT/lib/worker-restart.sh"
  [[ "$status" -eq 1 ]] || { echo "expected exit 1, got $status"; return 1; }
  [[ "$output" == *"Source this file"* ]] || { echo "missing refusal message: $output"; return 1; }
}
