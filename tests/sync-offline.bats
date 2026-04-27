#!/usr/bin/env bats
# tests/sync-offline.bats — INT-02
# Asserts /arcanon:sync --offline is wired into commands/sync.md per Plan 120-02.

load 'test_helper/bats-support/load'
load 'test_helper/bats-assert/load'

PLUGIN_ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/../plugins/arcanon" && pwd)"
SYNC_MD="${PLUGIN_ROOT}/commands/sync.md"

@test "INT-02: sync.md frontmatter argument-hint mentions --offline" {
  run grep -E '^argument-hint:.*--offline' "$SYNC_MD"
  [ "$status" -eq 0 ]
}

@test "INT-02: sync.md Flags table contains --offline row" {
  run grep -E '^\| `--offline` \|' "$SYNC_MD"
  [ "$status" -eq 0 ]
}

@test "INT-02: sync.md Step 0.5 short-circuit exists with the correct exit-0 message" {
  run grep -F 'scan persisted locally — offline mode' "$SYNC_MD"
  [ "$status" -eq 0 ]
  run grep -F -- '--offline and --drain are mutually exclusive' "$SYNC_MD"
  [ "$status" -eq 0 ]
  run grep -F 'would skip all hub interaction (offline mode)' "$SYNC_MD"
  [ "$status" -eq 0 ]
}

@test "INT-02: sync.md Step 0.5 explicitly forbids hub.sh invocation in offline mode" {
  run grep -F 'Do NOT invoke' "$SYNC_MD"
  [ "$status" -eq 0 ]
}

@test "INT-02: sync.md Examples table mentions --offline usage" {
  run grep -F '/arcanon:sync --offline' "$SYNC_MD"
  [ "$status" -eq 0 ]
}
