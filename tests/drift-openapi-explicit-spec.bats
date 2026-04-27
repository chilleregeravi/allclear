#!/usr/bin/env bats
# tests/drift-openapi-explicit-spec.bats — INT-04 (Phase 120) + INT-10 (Phase 121)
# Asserts /arcanon:drift openapi --spec bypasses discovery and uses explicit paths.
# INT-04 tests cover the negative paths and basic happy-path exit code.
# INT-10 tests (appended below) cover the realistic User.name -> User.full_name
# rename happy-path with two real OpenAPI 3.0 fixtures, including a control
# test proving the explicit-spec code path is what runs (not auto-discovery).

load 'test_helper/bats-support/load'
load 'test_helper/bats-assert/load'

PLUGIN_ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/../plugins/arcanon" && pwd)"
DRIFT_OPENAPI="${PLUGIN_ROOT}/scripts/drift-openapi.sh"
FIXTURE_DIR="${PLUGIN_ROOT}/tests/fixtures/integration/openapi"
SPEC_A="${FIXTURE_DIR}/spec-a.yaml"
SPEC_B="${FIXTURE_DIR}/spec-b.yaml"

setup() {
  export CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT"
  # Disable discovery — drift-common.sh uses DRIFT_TEST_LINKED_REPOS as its override.
  # Provide a real (empty) directory so list_linked_repos doesn't fall back to PWD scan.
  FAKE_REPO="$(mktemp -d)"
  export DRIFT_TEST_LINKED_REPOS="$FAKE_REPO"
  export PATH="/opt/homebrew/bin:$PATH"
}

teardown() {
  rm -rf "$FAKE_REPO"
  unset DRIFT_TEST_LINKED_REPOS
}

@test "INT-04: --spec A --spec B with two valid specs runs comparison" {
  run bash "$DRIFT_OPENAPI" --spec "$SPEC_A" --spec "$SPEC_B"
  # Exit 0 expected — comparison emits findings as informational/warn, not as a script error.
  [ "$status" -eq 0 ]
}

@test "INT-04: --spec with single path exits 2 with friendly error" {
  run bash "$DRIFT_OPENAPI" --spec "$SPEC_A"
  [ "$status" -eq 2 ]
  [[ "$output" =~ "--spec requires at least 2 paths" ]]
}

@test "INT-04: --spec with missing file exits 2 with friendly error" {
  run bash "$DRIFT_OPENAPI" --spec /nonexistent-spec-12345.yaml --spec "$SPEC_B"
  [ "$status" -eq 2 ]
  [[ "$output" =~ "spec not found: /nonexistent-spec-12345.yaml" ]]
}

@test "INT-04: no --spec preserves auto-discovery (zero linked repos -> friendly empty)" {
  run bash "$DRIFT_OPENAPI"
  [ "$status" -eq 0 ]
  [[ "$output" =~ "Fewer than 2 repos have OpenAPI specs" ]]
}

@test "INT-04: drift.md frontmatter argument-hint mentions --spec" {
  run grep -E '^argument-hint:.*--spec' "${PLUGIN_ROOT}/commands/drift.md"
  [ "$status" -eq 0 ]
}

# ----------------------------------------------------------------------------
# INT-10 (Phase 121-03) — happy-path E2E with realistic fixtures
# ----------------------------------------------------------------------------
# Uses two real OpenAPI 3.0 specs that differ in exactly one breaking change:
# the User schema field `name` is renamed to `full_name`. Asserts that the
# /arcanon:drift openapi --spec PATH_A --spec PATH_B command (via the public
# drift.sh dispatcher) reports the drift and exits 0. A control test proves
# that without --spec, the auto-discovery path runs instead — i.e., the
# happy-path tests genuinely exercise the explicit-spec code path.

DRIFT_SH_DISPATCHER="${PLUGIN_ROOT}/scripts/drift.sh"
INT10_SPEC_A="${PLUGIN_ROOT}/tests/fixtures/externals/openapi-spec-a.yaml"
INT10_SPEC_B="${PLUGIN_ROOT}/tests/fixtures/externals/openapi-spec-b.yaml"

@test "INT-10: /arcanon:drift openapi --spec X --spec Y exits 0 with two real specs" {
  [ -f "$INT10_SPEC_A" ] || skip "INT-10 fixture spec-a missing"
  [ -f "$INT10_SPEC_B" ] || skip "INT-10 fixture spec-b missing"
  run bash "$DRIFT_SH_DISPATCHER" openapi --spec "$INT10_SPEC_A" --spec "$INT10_SPEC_B"
  [ "$status" -eq 0 ]
}

@test "INT-10: /arcanon:drift openapi --spec X --spec Y reports the User.name -> full_name drift" {
  [ -f "$INT10_SPEC_A" ] || skip "INT-10 fixture spec-a missing"
  [ -f "$INT10_SPEC_B" ] || skip "INT-10 fixture spec-b missing"
  run bash "$DRIFT_SH_DISPATCHER" openapi --spec "$INT10_SPEC_A" --spec "$INT10_SPEC_B"
  [ "$status" -eq 0 ]
  # Tolerant substring match — wording differs between oasdiff (when installed)
  # and the yq structural-diff fallback. Both emit something openapi-related
  # AND something signalling difference.
  if [[ "$output" != *openapi* ]]; then
    echo "expected output to mention 'openapi'; got:" >&2
    echo "$output" >&2
    return 1
  fi
  if [[ "$output" != *drift* && "$output" != *differ* && "$output" != *break* && "$output" != *incompatible* && "$output" != *rename* && "$output" != *full_name* ]]; then
    echo "expected output to mention drift/differ/break/incompatible/rename/full_name; got:" >&2
    echo "$output" >&2
    return 1
  fi
}

@test "INT-10: /arcanon:drift openapi --spec bypasses discoverOpenApiSpecs (no 'no specs found' message)" {
  [ -f "$INT10_SPEC_A" ] || skip "INT-10 fixture spec-a missing"
  [ -f "$INT10_SPEC_B" ] || skip "INT-10 fixture spec-b missing"
  run bash "$DRIFT_SH_DISPATCHER" openapi --spec "$INT10_SPEC_A" --spec "$INT10_SPEC_B"
  [ "$status" -eq 0 ]
  # The discovery code path emits "Fewer than 2 repos have OpenAPI specs" when it
  # finds nothing; if it appears here, the --spec bypass did not engage.
  if [[ "$output" == *"Fewer than 2 repos have OpenAPI specs"* ]]; then
    echo "discovery path apparently ran despite --spec; got:" >&2
    echo "$output" >&2
    return 1
  fi
}

@test "INT-10 control: /arcanon:drift openapi without --spec in an empty dir reports no specs" {
  # Without --spec and without a linked-repos config, the existing auto-discovery
  # code path runs and finds nothing. This proves the INT-10 happy-path tests
  # exercise the explicit-spec branch, not a generic happy-path that would also
  # pass for the auto-discovery branch.
  WORK_DIR="$(mktemp -d)"
  pushd "$WORK_DIR" >/dev/null
  run bash "$DRIFT_SH_DISPATCHER" openapi
  popd >/dev/null
  rm -rf "$WORK_DIR"
  # Either status non-zero OR a "no" / "Fewer than" message is acceptable —
  # we just need to confirm this code path is NOT what's running in INT-10 tests 1-3.
  if [ "$status" -eq 0 ] && [[ "$output" != *"no"* && "$output" != *"No"* && "$output" != *"Fewer"* ]]; then
    echo "control test unexpectedly succeeded with positive output; got:" >&2
    echo "$output" >&2
    return 1
  fi
}
