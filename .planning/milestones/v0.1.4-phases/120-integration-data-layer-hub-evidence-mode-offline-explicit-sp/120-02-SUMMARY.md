---
phase: 120-integration-data-layer-hub-evidence-mode-offline-explicit-sp
plan: 02
subsystem: operator-surface
tags: [INT-02, INT-04, sync-offline, drift-openapi-explicit-spec, command-markdown, bats]
requires:
  - DSP-08 (drift-common.sh parse_drift_args + LINKED_REPOS contract)
  - existing /arcanon:sync Step 0 arg-parser prose
provides:
  - "/arcanon:sync --offline" short-circuit (Step 0.5, exit 0, no hub.sh invocation)
  - "/arcanon:drift openapi --spec <path>" repeatable explicit-spec mode bypassing find_openapi_spec discovery
  - drift-common.sh EXPLICIT_SPECS bash array (single accumulator, shared across drift subcommands)
affects:
  - plugins/arcanon/commands/sync.md (argument-hint, Flags row, Step 0.5 block, Examples row)
  - plugins/arcanon/commands/drift.md (argument-hint, Notes bullet)
  - plugins/arcanon/scripts/drift-common.sh (parse_drift_args extended; EXPLICIT_SPECS exported)
  - plugins/arcanon/scripts/drift-openapi.sh (if/else branch on EXPLICIT_SPECS)
tech-stack:
  added: []
  patterns:
    - "Markdown-as-spec contract: command-markdown changes asserted via grep-based bats tests (precedent: tests/commands-surface.bats)"
    - "Drift subcommand args parser as single source of truth (parse_drift_args) — new flag accumulates into one shared array; subcommand scripts branch on its size"
    - "Byte-identical preservation: discovery path moved into else-branch so --spec-absent invocations are bit-for-bit identical to pre-Phase-120 behavior"
key-files:
  created:
    - tests/sync-offline.bats
    - tests/drift-openapi-explicit-spec.bats
    - plugins/arcanon/tests/fixtures/integration/openapi/spec-a.yaml
    - plugins/arcanon/tests/fixtures/integration/openapi/spec-b.yaml
  modified:
    - plugins/arcanon/commands/sync.md
    - plugins/arcanon/commands/drift.md
    - plugins/arcanon/scripts/drift-common.sh
    - plugins/arcanon/scripts/drift-openapi.sh
decisions:
  - "Offline-mode logic lives entirely in command markdown (Step 0.5) — zero Node code changes. The slash command is the spec; bats grep-asserts the spec is correctly written. Stronger end-to-end (assert no hub.sh process spawned) requires a Claude Code harness we don't have."
  - "--offline + --drain rejection at exit 2 (not exit 1): matches the convention used by drift-common's --spec-without-arg branch — exit 2 = user error / arg-validation, distinct from runtime failure."
  - "EXPLICIT_SPECS is initialized inside parse_drift_args (not at module load) so each call resets the accumulator. Avoids cross-invocation contamination if the helper is sourced and called twice."
  - "drift-openapi.sh discovery loop relocated into the else-branch verbatim (no logic change) — guarantees byte-identical behavior when --spec is absent. The downstream pairwise/hub-and-spoke comparison loop is untouched."
metrics:
  tasks: 2
  duration: ~25 minutes
  commits:
    - ecd861f (Task 1 — sync --offline)
    - 0abbac8 (Task 2 — drift openapi --spec)
  tests-added: 10
  files-changed: 8
completed: 2026-04-27
---

# Phase 120 Plan 02: /arcanon:sync --offline + /arcanon:drift openapi --spec (INT-02 + INT-04) Summary

One-liner: Two parallel-safe operator-surface improvements — explicit offline mode for `/arcanon:sync` (Step 0.5 short-circuit, no hub.sh invocation) and repeatable `--spec` paths for `/arcanon:drift openapi` (bypasses `find_openapi_spec` discovery) — shipped as command-markdown patches plus a one-line shell extension to `parse_drift_args`.

## What changed

**1. `/arcanon:sync --offline` (commands/sync.md)**

- Frontmatter `argument-hint` now lists `--offline` as the first option.
- `## Flags` table: new top row documenting `--offline` and explicitly distinguishing it from "hub unreachable" (the latter still attempts upload + queues).
- `## Orchestration` Step 0 prose extended to identify `--offline` alongside `--drain` / `--dry-run`.
- New `### Step 0.5 — --offline short-circuit (NEW)` block enforces three branches:
  - `--offline` alone → `scan persisted locally — offline mode (no upload or drain attempted).` + exit 0.
  - `--offline + --drain` → `arcanon:sync: --offline and --drain are mutually exclusive...` to stderr + exit 2.
  - `--offline + --dry-run` → `would skip all hub interaction (offline mode)` + exit 0.
- Step 0.5 explicitly says "Do NOT invoke `bash ${CLAUDE_PLUGIN_ROOT}/scripts/hub.sh` in any form when `--offline` is set."
- `## Examples` table appended with `/arcanon:sync --offline` row.

No Node code changes. The existing Step 1 / Step 2 / Step 3 flow is byte-identical when `--offline` is absent.

**2. `/arcanon:drift openapi --spec <path>` (drift-common.sh + drift-openapi.sh + drift.md)**

- `drift-common.sh`:
  - New module-level `EXPLICIT_SPECS=()` array.
  - `parse_drift_args` rewritten as a `while/case` loop (was a `for` loop) so it can consume `--spec <path>` as a two-token flag. `--all` parsing preserved verbatim.
  - `--spec` with no following arg exits 2 with `arcanon:drift: --spec requires a path argument`.
  - Footer comment notes that bash arrays don't truly export across processes — drift-openapi.sh sources this file in the same shell, so the array is visible without `export`.

- `drift-openapi.sh`:
  - Discovery loop wrapped in `if [[ ${#EXPLICIT_SPECS[@]} -gt 0 ]]` / `else`.
  - Explicit branch validates each path exists (exit 2 with `spec not found: <path>` on miss), accumulates into `spec_paths`, derives `repos_with_specs` entry from `basename | sed 's/\.\(yaml\|yml\|json\)$//'`.
  - After collection, requires `${#spec_paths[@]} -ge 2`; otherwise exit 2 with `--spec requires at least 2 paths to compare (got N)`.
  - Else-branch is the original discovery loop verbatim — preserves byte-identical behavior when `--spec` is absent.
  - The downstream pairwise / hub-and-spoke comparison loop (lines 132-156 of original) is unchanged.

- `drift.md`:
  - Frontmatter `argument-hint` extended to `[graph|versions|types|openapi|--all] [--spec <path>]...`.
  - `## Notes` adds one bullet explaining `--spec` semantics and the 2-path minimum.

**3. Fixtures**

- `plugins/arcanon/tests/fixtures/integration/openapi/spec-a.yaml` — minimal OpenAPI 3.0 with `GET /users`.
- `plugins/arcanon/tests/fixtures/integration/openapi/spec-b.yaml` — same `GET /users` plus a new `POST /users` (real structural difference for the comparison happy-path test).

**4. bats tests**

- `tests/sync-offline.bats` — 5 grep-based assertions on commands/sync.md (argument-hint, Flags row, Step 0.5 messages, hub.sh-prohibition clause, Examples row).
- `tests/drift-openapi-explicit-spec.bats` — 5 tests:
  1. `--spec A --spec B` happy path (exit 0).
  2. `--spec A` alone → exit 2 with `--spec requires at least 2 paths`.
  3. `--spec /nonexistent --spec B` → exit 2 with `spec not found: /nonexistent...`.
  4. No `--spec` (with empty `LINKED_REPOS` override) → exit 0 with `Fewer than 2 repos have OpenAPI specs` (proves discovery path is preserved).
  5. drift.md frontmatter argument-hint mentions `--spec`.

## Decision references

- **Offline vs hub-unreachable distinction** (RESEARCH §3) — Two different states, two different exit codes / messages. Offline = "I know there's no hub, exit 0 cleanly." Hub-unreachable = "I tried, queueing for retry." Step 0.5 short-circuits before Step 1 preflight so the existing hub-unreachable code path is never even reached in offline mode.
- **Explicit-spec wiring location** (RESEARCH §4) — `parse_drift_args` is the single shared parser for all drift subcommands; adding `--spec` there means future subcommands can consume `EXPLICIT_SPECS` without reimplementing flag parsing. Even though only drift-openapi.sh uses it today, the surface area is right.
- **Markdown-as-spec testing precedent** — Repository convention (e.g. `tests/commands-surface.bats`) tests command-markdown contracts via grep. There is no Claude Code in-process harness for asserting "no `hub.sh` process was spawned"; the markdown itself IS the contract, and the bats tests assert the contract is correctly written.

## Test summary

10 new tests added; 0 regressions across plan-scope verification:

| Suite | New tests | Total | Result |
|---|---|---|---|
| `tests/sync-offline.bats` | 5 | 5 | green |
| `tests/drift-openapi-explicit-spec.bats` | 5 | 5 | green |
| `tests/drift-dispatcher.bats` | 0 | 12 | green (no regression) |
| `tests/drift-versions.bats` | 0 | 27 | green (no regression) |
| `tests/drift-types.bats` | 0 | 9 | green (no regression) |
| **Combined plan-scope run** | 10 | 58 | **all green** |

Verification command:
```
bats tests/sync-offline.bats tests/drift-openapi-explicit-spec.bats \
     tests/drift-dispatcher.bats tests/drift-versions.bats tests/drift-types.bats
# → 1..58, zero failures
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocker] Test loader path mismatch**

- **Found during:** Task 1 (writing tests/sync-offline.bats).
- **Issue:** PLAN.md template calls `load test_helper/common`, but the actual repo convention (per `tests/drift-dispatcher.bats`, `tests/test_helper.bash`, etc.) is to load `bats-support` and `bats-assert` directly. There is no `test_helper/common` file in this repo.
- **Fix:** Both new bats files use `load 'test_helper/bats-support/load'` + `load 'test_helper/bats-assert/load'` — the established pattern across all 40+ existing bats files.
- **Files modified:** tests/sync-offline.bats, tests/drift-openapi-explicit-spec.bats (initial creation only — never used the broken path).
- **Commit:** ecd861f, 0abbac8

**2. [Rule 3 - Blocker] `bats run grep` consumed `--offline` as a flag**

- **Found during:** Task 1 verification (initial bats run).
- **Issue:** First run of `tests/sync-offline.bats` failed test #3 because `run grep -F '--offline and --drain are mutually exclusive' "$SYNC_MD"` was parsed by `grep` as having `--offline...` as an option flag rather than a search pattern.
- **Fix:** Added `--` separator: `run grep -F -- '--offline and --drain are mutually exclusive' "$SYNC_MD"`. Test passes.
- **Files modified:** tests/sync-offline.bats
- **Commit:** ecd861f (in-task fix before commit)

### Scope confirmations (no deviation)

- **NO Node code change.** Both INT-02 and INT-04 are pure markdown + shell. `worker/` was not touched.
- **NO change to /arcanon:sync flag behavior when --offline is absent.** Step 0 / 1 / 2 / 3 prose is byte-identical to pre-plan markdown.
- **NO change to /arcanon:drift openapi auto-discovery when --spec is absent.** Discovery loop relocated verbatim into the else-branch; `find_openapi_spec` and the downstream pairwise/hub-and-spoke loop are untouched.
- **No CLAUDE.md gitnexus_impact run for this plan.** The changes are command markdown + shell scripts (not Node symbols indexed by gitnexus); no symbols renamed, no functions extracted. The single shell function modified (`parse_drift_args`) preserves its existing call signature and only extends behavior; no callers need updating.

## Open follow-ups for Phase 121+

1. **End-to-end harness for slash-command behavior.** The current bats tests assert the markdown spec is correctly written, not that the slash-command runtime executes Step 0.5 correctly. A future `tests/integration/slash-command-runner.bats` would spawn the actual command runtime and assert no `hub.sh` process is created when `--offline` is set. Out-of-scope for INT-02 (no harness exists today).
2. **`oasdiff` install hint when --spec mode finds no oasdiff.** Currently the explicit-spec path falls back to `yq` structural diff just like discovery mode. A future enhancement could surface a more prominent hint when the user explicitly asked for a comparison via `--spec` (intent signal: they care about the result).

## Self-Check: PASSED

- sync.md `--offline` argument-hint: FOUND (line 4)
- sync.md `--offline` Flags row: FOUND (line 22)
- sync.md Step 0.5 block: FOUND (lines 38-46)
- sync.md `Do NOT invoke` clause: FOUND (line 46)
- sync.md `--offline` Examples row: FOUND (line 99)
- drift-common.sh `EXPLICIT_SPECS=()` declaration: FOUND
- drift-common.sh `parse_drift_args` while/case rewrite: FOUND
- drift-openapi.sh `if [[ ${#EXPLICIT_SPECS[@]} -gt 0 ]]` branch: FOUND
- drift.md `--spec` argument-hint: FOUND
- drift.md Notes bullet about --spec: FOUND
- Fixture spec-a.yaml: FOUND
- Fixture spec-b.yaml: FOUND
- tests/sync-offline.bats: FOUND (5 @test blocks, all green)
- tests/drift-openapi-explicit-spec.bats: FOUND (5 @test blocks, all green)
- Commit ecd861f (Task 1): FOUND
- Commit 0abbac8 (Task 2): FOUND
- Plan-scope verification (58 tests across 5 bats files): all green, zero regressions
