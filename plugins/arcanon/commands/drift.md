---
description: Check cross-repo consistency for version alignment, type definitions, and OpenAPI specs. Use when the user invokes /arcanon:drift or asks about dependency drift.
allowed-tools: Bash
argument-hint: "[versions|types|openapi|--all]"
---

Check cross-repo drift for linked repositories.

Linked repos: !`source "${CLAUDE_PLUGIN_ROOT}/lib/linked-repos.sh" && list_linked_repos "${CLAUDE_PLUGIN_ROOT}"`

## Steps

1. Parse arguments to determine subcommand and flags:
   - Subcommand: `versions`, `types`, or `openapi` (default: run all three)
   - Flags: `--all` enables INFO-level output in addition to CRITICAL and WARN

2. For `versions` (or no subcommand specified):
   Run: `"${CLAUDE_PLUGIN_ROOT}/scripts/drift-versions.sh" $LIGAMEN_ARGS`

3. For `types` (or no subcommand specified):
   Run: `"${CLAUDE_PLUGIN_ROOT}/scripts/drift-types.sh" $LIGAMEN_ARGS`

4. For `openapi` (or no subcommand specified):
   Run: `"${CLAUDE_PLUGIN_ROOT}/scripts/drift-openapi.sh" $LIGAMEN_ARGS`

5. Report findings grouped by severity:
   - CRITICAL first (breaking version mismatches, incompatible API changes)
   - WARN next (likely issues: different locking strategies, non-breaking diffs)
   - INFO suppressed unless `--all` was passed

6. For each finding, state:
   - Which package or definition has drift
   - Which repos are affected
   - The specific version or value each repo holds (not just "differ")

## Notes

- Run `drift versions` alone for fastest check (pure bash + jq, no optional tools required)
- `drift types` is best-effort heuristic (grep-based interface/struct name matching, same-language only)
- `drift openapi` uses `oasdiff` when available; falls back to structural yq comparison
- If no sibling repos are found, the command exits with a helpful message
- Expected runtime: versions <5s, types <15s, openapi <10s for typical repo sets
