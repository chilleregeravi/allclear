#!/usr/bin/env bats
# tests/drift-dispatcher.bats — scripts/drift.sh unified dispatcher
# Covers: DSP-01 (subcommand set), DSP-02 (subprocess not source),
#         DSP-03 (direct invoke regression), DSP-04 (Bash 4+ guard),
#         DSP-08 (no linked repos message), DSP-14 (bats coverage)

load 'test_helper/bats-support/load'
load 'test_helper/bats-assert/load'

PLUGIN_ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/../plugins/arcanon" && pwd)"
DISPATCHER="${PLUGIN_ROOT}/scripts/drift.sh"

setup() {
  export CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT"
  FAKE_REPO="$(mktemp -d)"
  # Minimal marker so extract_* functions don't choke — an empty dir is enough to exercise routing.
  export DRIFT_TEST_LINKED_REPOS="$FAKE_REPO"
  # Ensure Homebrew bash (4+) is on PATH so `bash drift.sh` satisfies the Bash 4+ version guard.
  # macOS ships Bash 3.2 at /bin/bash; the dispatcher requires 4+ for declare -A safety (DSP-04).
  export PATH="/opt/homebrew/bin:$PATH"
}

teardown() {
  rm -rf "$FAKE_REPO"
  unset DRIFT_TEST_LINKED_REPOS
}

# ─────────────────────────────────────────────────────────────────────────────
# DSP-02: subcommand routing — each subcommand is invoked as a subprocess
# ─────────────────────────────────────────────────────────────────────────────

@test "drift.sh versions routes to drift-versions.sh (exit 0 for single-repo case)" {
  run bash "$DISPATCHER" versions
  assert_success
}

@test "drift.sh types routes to drift-types.sh (exit 0 for single-repo case)" {
  run bash "$DISPATCHER" types
  assert_success
}

@test "drift.sh openapi routes to drift-openapi.sh (exit 0 for single-repo case)" {
  run bash "$DISPATCHER" openapi
  assert_success
}

@test "drift.sh all runs versions + types + openapi sequentially" {
  run bash "$DISPATCHER" all
  assert_success
}

@test "drift.sh with no args defaults to 'all'" {
  run bash "$DISPATCHER"
  assert_success
}

# ─────────────────────────────────────────────────────────────────────────────
# DSP-01: reserved slots licenses|security print TBD, exit 2
# ─────────────────────────────────────────────────────────────────────────────

@test "drift.sh licenses prints 'not yet implemented' and exits 2" {
  run bash "$DISPATCHER" licenses
  [[ "$status" -eq 2 ]] || { echo "expected exit 2, got $status"; return 1; }
  [[ "$output" == *"not yet implemented"* ]] || { echo "missing TBD message: $output"; return 1; }
}

@test "drift.sh security prints 'not yet implemented' and exits 2" {
  run bash "$DISPATCHER" security
  [[ "$status" -eq 2 ]] || { echo "expected exit 2, got $status"; return 1; }
  [[ "$output" == *"not yet implemented"* ]] || { echo "missing TBD message: $output"; return 1; }
}

@test "drift.sh unknown-subcommand prints 'unknown subcommand' and exits 1" {
  run bash "$DISPATCHER" bogus-subcommand
  [[ "$status" -eq 1 ]] || { echo "expected exit 1, got $status"; return 1; }
  [[ "$output" == *"unknown subcommand"* ]] || { echo "missing error message: $output"; return 1; }
}

# ─────────────────────────────────────────────────────────────────────────────
# DSP-03: regression — direct invocation of drift-versions.sh still works
# ─────────────────────────────────────────────────────────────────────────────

@test "direct invocation: bash drift-versions.sh --all still works (DSP-03 regression guard)" {
  run bash "${PLUGIN_ROOT}/scripts/drift-versions.sh" --all
  assert_success
}

# ─────────────────────────────────────────────────────────────────────────────
# DSP-02 (static): dispatcher uses `bash` not `source`
# DSP-04 (static): Bash 4+ guard present at top of dispatcher
# ─────────────────────────────────────────────────────────────────────────────

@test "drift.sh uses 'bash' subprocess for subcommands, never 'source'" {
  run grep -E '^[[:space:]]*source[[:space:]]+.*drift-(versions|types|openapi)\.sh' "$DISPATCHER"
  [[ "$status" -ne 0 ]] || { echo "drift.sh must NOT source subcommand scripts: $output"; return 1; }

  run grep -E 'bash.*drift-versions\.sh' "$DISPATCHER"
  assert_success
}

@test "drift.sh has Bash 4+ version guard at top (DSP-04)" {
  run grep -q 'BASH_VERSINFO\[0\]' "$DISPATCHER"
  assert_success
  run grep -q 'exit 1' "$DISPATCHER"
  assert_success
}

# ─────────────────────────────────────────────────────────────────────────────
# DSP-08: drift-common.sh emits canonical "no linked repos configured" message
# ─────────────────────────────────────────────────────────────────────────────

@test "drift.sh versions with no linked repos emits canonical DSP-08 stderr line" {
  unset DRIFT_TEST_LINKED_REPOS
  # Run in a temp dir with no arcanon.config.json so list_linked_repos returns empty.
  cd "$(mktemp -d)"
  run bash "$DISPATCHER" versions
  # Exit code 0 (subcommand's drift-common.sh returns 0 on empty); message on stderr.
  [[ "$output" == *"drift: no linked repos configured"* ]] || { echo "missing DSP-08 message: $output"; return 1; }
}
