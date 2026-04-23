#!/usr/bin/env bats
#
# impact-merged-features.bats — CLN-10/11/12/13 serialization guard.
# Proves that /arcanon:impact has absorbed all three unique capabilities
# of /arcanon:cross-impact (--exclude, --changed, 3-state degradation
# with grep fallback) BEFORE Plan 97-01 deletes commands/cross-impact.md.
#
# Tests are structural: they grep the merged commands/impact.md for the
# tokens that evidence each capability. They do not execute the slash
# command, which would require a live worker + linked-repo fixture.

setup() {
  PLUGIN_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")/../plugins/arcanon" && pwd)"
  IMPACT_MD="$PLUGIN_DIR/commands/impact.md"
}

@test "CLN-10: /arcanon:impact advertises --exclude in argument-hint" {
  [ -f "$IMPACT_MD" ]
  run grep -E '^argument-hint:.*--exclude' "$IMPACT_MD"
  [ "$status" -eq 0 ]
}

@test "CLN-10: /arcanon:impact documents --exclude filter for graph results" {
  # The --exclude flag must apply to graph results (State C), not just grep
  grep -q -- '--exclude' "$IMPACT_MD"
  # Must appear at least twice: usage table + filter-application note
  run grep -c -- '--exclude' "$IMPACT_MD"
  [ "$status" -eq 0 ]
  [ "$output" -ge 2 ]
}

@test "CLN-10: /arcanon:impact documents --exclude filter for grep results" {
  # The --exclude filter must also apply in Legacy Fallback — one
  # behaviour across both State C and States A/B.
  grep -Eq -i '(legacy|grep).*exclude|exclude.*(legacy|grep)' "$IMPACT_MD"
}

@test "CLN-11: /arcanon:impact advertises --changed in argument-hint" {
  run grep -E '^argument-hint:.*--changed' "$IMPACT_MD"
  [ "$status" -eq 0 ]
}

@test "CLN-11: /arcanon:impact --changed auto-detects from git diff HEAD" {
  grep -q 'git diff --name-only HEAD' "$IMPACT_MD"
}

@test "CLN-11: /arcanon:impact treats no-args invocation as --changed" {
  # Bare /arcanon:impact must behave like --changed (documented equivalence)
  grep -Eq -i '(no.*args|bare|implicit).*--changed|--changed.*(no.*args|bare|implicit)' "$IMPACT_MD"
}

@test "CLN-12: /arcanon:impact documents 3-state degradation model" {
  grep -q 'WORKER_UP' "$IMPACT_MD"
  grep -q 'MAP_HAS_DATA' "$IMPACT_MD"
  # States A, B, C must all be documented
  grep -Eq 'State.*A|A.*No worker' "$IMPACT_MD"
  grep -Eq 'State.*B|B.*Worker up, no map' "$IMPACT_MD"
  grep -Eq 'State.*C|C.*Worker up, map has data' "$IMPACT_MD"
}

@test "CLN-12: State A falls back to scripts/impact.sh grep scanner" {
  grep -q 'scripts/impact.sh' "$IMPACT_MD"
  grep -Eq -i 'legacy.*fallback|legacy.*scan' "$IMPACT_MD"
}

@test "CLN-12: State B prompts user to run /arcanon:map" {
  # The B-state prompt must direct the user to /arcanon:map
  grep -q '/arcanon:map' "$IMPACT_MD"
  grep -Eq -i 'no.*scan.*data|no.*map.*data' "$IMPACT_MD"
}

@test "CLN-12: State C preserves MCP-first graph query flow" {
  grep -q 'mcp__arcanon__impact_query' "$IMPACT_MD"
  grep -q 'mcp__arcanon__impact_graph' "$IMPACT_MD"
  # HTTP fallback via worker_call is also preserved
  grep -q 'worker_call' "$IMPACT_MD"
}

@test "CLN-12: /arcanon:impact never starts the worker (query-only)" {
  # Query-only contract must be explicit — cross-impact.md line 47 equivalent
  grep -Eq -i 'query.?only|do not.*start.*worker|not.*start.*worker' "$IMPACT_MD"
}

@test "CLN-10+11 combine: --changed and --exclude both documented together" {
  # Plans advertise combinability — the usage section must show both in play
  grep -q -- '--changed' "$IMPACT_MD"
  grep -q -- '--exclude' "$IMPACT_MD"
  # An explicit combined example must exist
  grep -Eq -- '--changed.*--exclude|--exclude.*--changed' "$IMPACT_MD"
}

@test "CLN-13: original --direction and --hops flags preserved (not regressed)" {
  # The v0.1.0 impact.md flags must still work after the merge
  grep -q -- '--direction' "$IMPACT_MD"
  grep -q -- '--hops' "$IMPACT_MD"
  grep -Eq 'downstream|upstream' "$IMPACT_MD"
}

@test "CLN-13: frontmatter allowed-tools covers Bash + MCP + AskUserQuestion" {
  # The merged surface needs Bash (state detect + grep fallback),
  # mcp__arcanon__* (State C), and AskUserQuestion (empty-diff prompt,
  # linked-repos config flow).
  run grep -E '^allowed-tools:.*Bash' "$IMPACT_MD"
  [ "$status" -eq 0 ]
  grep -Eq '^allowed-tools:.*mcp__arcanon__' "$IMPACT_MD"
  grep -Eq '^allowed-tools:.*AskUserQuestion' "$IMPACT_MD"
}
