#!/usr/bin/env bats
#
# commands-surface.bats — CLN-09 regression: the seven surviving commands
# of v0.1.1 are present with valid frontmatter, /arcanon:cross-impact has
# been fully removed (CLN-01), and /arcanon:upload has been fully removed
# (DEP-03 regression guard against accidental re-add).

setup() {
  PLUGIN_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")/../plugins/arcanon" && pwd)"
}

@test "CLN-09: all surviving command files exist" {
  # Iteration list extended (114-01 / NIT 8) to cover the full v0.1.4-WIP
  # command surface. The original CLN-09 list was the seven v0.1.1 survivors;
  # `verify` and `update` shipped in v0.1.3 and `list` ships in v0.1.4 (NAV-01)
  # but neither was added to this loop until now. (`view`/`doctor` from plans
  # 114-02 / 114-03 will join via additive edits in those plans.)
  for cmd in map drift impact sync login status export verify update list; do
    [ -f "$PLUGIN_DIR/commands/$cmd.md" ] || {
      echo "MISSING: commands/$cmd.md"
      return 1
    }
  done
}

@test "CLN-09: all surviving commands have description frontmatter" {
  for cmd in map drift impact sync login status export verify update list; do
    run grep -c '^description:' "$PLUGIN_DIR/commands/$cmd.md"
    [ "$status" -eq 0 ]
    [ "$output" -ge 1 ]
  done
}

# NAV-01 (114-01): /arcanon:list must declare allowed-tools: Bash so the
# slash-command runtime grants the bash block in the body the right to
# invoke hub.sh. Mirrors the same assertion implicit in CLN-09 above for the
# other commands.
@test "NAV-01: /arcanon:list declares allowed-tools: Bash" {
  run grep -E '^allowed-tools:' "$PLUGIN_DIR/commands/list.md"
  [ "$status" -eq 0 ]
  grep -q 'Bash' "$PLUGIN_DIR/commands/list.md"
}

@test "CLN-01: /arcanon:cross-impact command file has been removed" {
  [ ! -f "$PLUGIN_DIR/commands/cross-impact.md" ]
}

@test "DEP-03: /arcanon:upload command file has been removed (regression guard)" {
  [ ! -f "$PLUGIN_DIR/commands/upload.md" ]
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
