#!/usr/bin/env bats
#
# commands-surface.bats — CLN-09 regression: the seven surviving commands
# of v0.1.1 are present with valid frontmatter, the deprecated /arcanon:upload
# stub is in place with proper deprecation markers, and /arcanon:cross-impact
# has been fully removed.

setup() {
  PLUGIN_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")/../plugins/arcanon" && pwd)"
}

@test "CLN-09: all 7 surviving command files exist" {
  for cmd in map drift impact sync login status export; do
    [ -f "$PLUGIN_DIR/commands/$cmd.md" ] || {
      echo "MISSING: commands/$cmd.md"
      return 1
    }
  done
}

@test "CLN-09: all 7 surviving commands have description frontmatter" {
  for cmd in map drift impact sync login status export; do
    run grep -c '^description:' "$PLUGIN_DIR/commands/$cmd.md"
    [ "$status" -eq 0 ]
    [ "$output" -ge 1 ]
  done
}

@test "CLN-01: /arcanon:cross-impact command file has been removed" {
  [ ! -f "$PLUGIN_DIR/commands/cross-impact.md" ]
}

@test "CLN-05: /arcanon:upload exists as deprecated stub" {
  [ -f "$PLUGIN_DIR/commands/upload.md" ]
  run grep -c 'DEPRECATED' "$PLUGIN_DIR/commands/upload.md"
  [ "$status" -eq 0 ]
  [ "$output" -ge 1 ]
}

@test "CLN-05: /arcanon:upload stub description starts with [DEPRECATED]" {
  run grep -E '^description: "\[DEPRECATED\]' "$PLUGIN_DIR/commands/upload.md"
  [ "$status" -eq 0 ]
}

@test "CLN-05: /arcanon:upload stub emits deprecation warning to stderr" {
  run grep '>&2' "$PLUGIN_DIR/commands/upload.md"
  [ "$status" -eq 0 ]
}

@test "CLN-05: /arcanon:upload stub forwards arguments to hub.sh upload" {
  run grep 'hub.sh upload \$ARGUMENTS' "$PLUGIN_DIR/commands/upload.md"
  [ "$status" -eq 0 ]
}

@test "CLN-05: /arcanon:upload stub carries v0.2.0 removal anchor" {
  run grep 'remove in v0.2.0' "$PLUGIN_DIR/commands/upload.md"
  [ "$status" -eq 0 ]
}

@test "CLN-03: /arcanon:sync advertises --drain, --repo, --dry-run, --force in argument-hint" {
  run grep -E '^argument-hint:' "$PLUGIN_DIR/commands/sync.md"
  [ "$status" -eq 0 ]
  # All four flag names must appear in the hint or flag table
  grep -q -- '--drain' "$PLUGIN_DIR/commands/sync.md"
  grep -q -- '--repo' "$PLUGIN_DIR/commands/sync.md"
  grep -q -- '--dry-run' "$PLUGIN_DIR/commands/sync.md"
  grep -q -- '--force' "$PLUGIN_DIR/commands/sync.md"
}

@test "CLN-04: /arcanon:sync default behaviour documents upload-then-drain" {
  # The flag table must describe the no-flag path
  run grep -E '\*\(none\)\*|no flags' "$PLUGIN_DIR/commands/sync.md"
  [ "$status" -eq 0 ]
  grep -q 'upload' "$PLUGIN_DIR/commands/sync.md"
  grep -q -i 'drain' "$PLUGIN_DIR/commands/sync.md"
}
