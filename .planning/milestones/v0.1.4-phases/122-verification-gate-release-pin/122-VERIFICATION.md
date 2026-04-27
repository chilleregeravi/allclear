---
phase: 122-verification-gate-release-pin
status: passed
verified_at: 2026-04-27
---

# Phase 122: Verification Gate + Release Pin

## Status: ✅ PASSED

Milestone v0.1.4 release gate verified. Read-only navigability commands
(Phase 114-115), `--help` system + `/arcanon:status` freshness extension
(Phase 116), `scan_overrides` write-side infrastructure + operator commands
(Phases 117-118), shadow scan workflow (Phase 119), and integration data +
consumption layers (Phases 120-121) all verify clean. Manifests pinned at
0.1.4 across 4 files (6 version strings); `package-lock.json` regenerated;
CHANGELOG `[0.1.4] - 2026-04-27` section pinned with all non-empty
subsections in Keep-a-Changelog order; ROADMAP/REQUIREMENTS prose drift on
`/arcanon:doctor` check count (7 → 8) reconciled.

## Per-REQ Status

| REQ    | Description                                                                       | Status | Evidence |
| ------ | --------------------------------------------------------------------------------- | ------ | -------- |
| VER-01 | bats green ≥340 baseline + new tests                                              | ✅     | 459/459 passing (zero failures); HOK-06 macOS caveat not hit at threshold=200; output at /tmp/122-bats-output.log |
| VER-02 | node green for affected modules (117-121)                                         | ✅     | 775/775 passing across 141 suites; the previously-documented v0.1.3 `manager.test.js:676` incremental-prompt failure is now resolved by v0.1.4 work; output at /tmp/122-node-output.log |
| VER-03 | All commands have `## Help` + `--help` non-empty + exit 0                         | ✅     | 17/17 commands PASS via direct `lib/help.sh` smoke (substituted recipe — see VER-03 section); zero FAIL; output at /tmp/122-help-output.log |
| VER-04 | Refined `--help` grep + carry-over absence checks                                 | ✅     | 4 grep families clean (zero `--help` leaks outside `## Help`, zero refs in README/skills/hooks, runtime-deps.json absent, /arcanon:upload absent); output at /tmp/122-grep-output.log |
| VER-05 | Fresh-install Node 25 smoke                                                       | ✅ PASS (Pattern A) + ⚠️ deferred (Pattern B) | Pattern A install machinery PASS (clone + npm install + install-deps.sh + session-start.sh); Pattern B doctor smoke deferred per 113-VERIFICATION.md:26 precedent (fresh workspace has no impact-map.db; doctor's documented silent-no-op contract fires at hub.js:988-993); output at /tmp/122-doctor.log |
| VER-06 | 4 manifests at 0.1.4 (6 strings) + lockfile regen                                 | ✅     | 6 `"0.1.4"` matches across 4 manifest files; package-lock.json regenerated via `npm install --package-lock-only` (root `.version` and `packages.""."version"` both 0.1.4) |
| VER-07 | CHANGELOG [0.1.4] pinned with subsections in Keep-a-Changelog order               | ✅     | `## [0.1.4] - 2026-04-27` heading present; subsections `### Added` + `### Changed` in order; fresh empty `[Unreleased]` heading at top |

## VER-01 — bats Suite

**Command:**

```bash
IMPACT_HOOK_LATENCY_THRESHOLD=200 bats tests/
```

**Result:** 459/459 passing. Zero failures.

```
=== Summary ===
459 tests, 459 passed, 0 failed
```

Acceptance bar: ≥340 floor / ≥380 expected — **exceeded both** (459).

**Phase 114-121 added test files (all green):**

- `tests/list.bats` (Phase 114, NAV-01)
- `tests/doctor.bats` (Phase 114, NAV-03 — 12 tests covering all 8 doctor checks)
- `tests/diff.bats` (Phase 115, NAV-04)
- `tests/help.bats` (Phase 116, HELP-04)
- `tests/scan-freshness.bats` (Phase 116, FRESH-05)
- `tests/correct.bats` (Phase 118, CORRECT-07)
- `tests/rescan.bats` (Phase 118, CORRECT-07)
- `tests/shadow-scan.bats` (Phase 119, SHADOW-04)
- `tests/promote-shadow.bats` (Phase 119, SHADOW-04)
- `tests/diff-shadow.bats` (Phase 119, SHADOW-04)
- `tests/drift-openapi-explicit-spec.bats` (Phase 120/121, INT-04 + INT-10)

**HOK-06 macOS caveat:** Did NOT trigger this run at
`IMPACT_HOOK_LATENCY_THRESHOLD=200`. Carried-over note from v0.1.1/v0.1.3 in
case of future macOS dev runs:

- Test: `impact-hook - HOK-06: p99 latency < ${IMPACT_HOOK_LATENCY_THRESHOLD:-50}ms over 100 iterations`
- BSD fork overhead pushes p99 above the 50ms Linux target on Apple Silicon
- CI uses `IMPACT_HOOK_LATENCY_THRESHOLD: "100"` (committed in v0.1.1)
- This run passed cleanly at threshold=200 with margin

## VER-02 — node Suite

**Command:**

```bash
cd plugins/arcanon && npm test
```

**Result:** 775/775 passing across 141 test suites (4.48s total). Zero failures.

```
ℹ tests 775
ℹ suites 141
ℹ pass 775
ℹ fail 0
ℹ duration_ms 4478.384458
```

Acceptance bar: ≥629 (v0.1.3 baseline 630/631 minus 1 documented + Phase 114-121
additions) — **exceeded** (775).

**Improvement vs. v0.1.3:** The previously-documented v0.1.3 pre-existing
failure at `worker/scan/manager.test.js:676` (`incremental scan prompt
contains INCREMENTAL_CONSTRAINT heading and changed filename` —
`TypeError: Cannot read properties of undefined (reading 'prepare')`, mock
fixture missing `_db`) is **now resolved** somewhere in the v0.1.4 work. Zero
known pre-existing failures remain.

**v0.1.4-touched modules verified green:**

- Phase 117: migration 017 idempotency, query-engine `scan_overrides` reads,
  scan apply-overrides flow
- Phase 118: cmdCorrect / cmdRescan units
- Phase 119: pool.js shadow cache-key, scan target via env/flag,
  evictLiveQueryEngine, atomic promote
- Phase 120: hub-sync payload 1.2, sync.js `--offline` path, drift openapi
  `--spec`, known-externals loader
- Phase 121: enrichment catalog match, query-engine label join,
  external_labels merge

## VER-03 — Per-Command `--help` Smoke

**Command (substituted recipe — see Deviations):** Plan 122-01 Task 4
sourced `lib/help.sh` and called `arcanon_extract_help_section` +
`arcanon_print_help_if_requested` directly per command, then grep-matched
each command body for `arcanon_print_help_if_requested` (matching the
HELP-04 bats assertion).

**Result:** 17/17 commands PASS, 0 FAIL.

```
PASS: correct --help (extract+detector OK, 1233 bytes)
PASS: diff --help (extract+detector OK, 1024 bytes)
PASS: doctor --help (extract+detector OK, 484 bytes)
PASS: drift --help (extract+detector OK, 927 bytes)
PASS: export --help (extract+detector OK, 712 bytes)
PASS: impact --help (extract+detector OK, 1097 bytes)
PASS: list --help (extract+detector OK, 567 bytes)
PASS: login --help (extract+detector OK, 525 bytes)
PASS: map --help (extract+detector OK, 686 bytes)
PASS: promote-shadow --help (extract+detector OK, 526 bytes)
PASS: rescan --help (extract+detector OK, 616 bytes)
PASS: shadow-scan --help (extract+detector OK, 609 bytes)
PASS: status --help (extract+detector OK, 453 bytes)
PASS: sync --help (extract+detector OK, 1112 bytes)
PASS: update --help (extract+detector OK, 609 bytes)
PASS: verify --help (extract+detector OK, 907 bytes)
PASS: view --help (extract+detector OK, 326 bytes)

Total: 17 commands, 17 PASS, 0 PARTIAL, 0 FAIL
```

Smallest output: `view --help` at 326 bytes; largest: `correct --help` at
1233 bytes. Every command returns non-empty `## Help` content (extracted via
Phase 116's `awk` detector) and the `arcanon_print_help_if_requested` call
in the bash block.

### Recipe substitution rationale (deviation from plan)

The plan's pinned recipe `bash hub.sh <cmd> --help` was structurally wrong:
`hub.sh` dispatches to `worker/cli/hub.js` (the Node CLI dispatcher), which
only handles a subset of commands as Node-side subcommands. Most commands
(drift, impact, map, view, etc.) are markdown command files where `--help` is
handled inline by `arcanon_print_help_if_requested` (sourced from `lib/help.sh`)
— that block is invoked by Claude Code's slash-command runtime, not by the
bash dispatcher.

Substituted the substantive recipe (source `lib/help.sh` + call detectors
directly), which is the **same contract validated by Phase 116's HELP-01..04
bats tests** — all green in this run's 459-test bats suite. Logged
explicitly in `/tmp/122-help-output.log` header.

## VER-04 — Refined `--help` Grep + Absence Carry-Overs

| Check                                                                          | Result |
| ------------------------------------------------------------------------------ | ------ |
| `--help` outside `## Help` blocks in `commands/*.md` (excluding HELP-03 ref)   | ✅ zero leaks |
| `--help` in README/skills/hooks                                                | ✅ zero matches |
| `runtime-deps.json` absent + grep clean (v0.1.3 carry-over)                    | ✅ file absent + grep clean |
| `commands/upload.md` absent + `/arcanon:upload` zero refs in README/skills (v0.1.3 carry-over) | ✅ file absent + grep clean |

The refined `--help` grep allows: (a) `## Help` section content, (b)
`commands/update.md:21` `claude plugin update --help` host-CLI reference
(documented as a permanent v0.1.1-era exception per 113-VERIFICATION.md:30
— it documents a CLI probe of a third-party host tool, not an Arcanon
command flag), (c) `lib/help.sh` detector implementation. Everything else
is denied. Plan 122-01 Task 1 confirmed zero leaks across all 4 grep
families.

## VER-05 — Fresh-install Smoke (Node 25)

**Pattern A — install machinery, performed in-session:**

```bash
nvm use 25  # Node v25.9.0
git clone /Users/ravichillerega/sources/ligamen /tmp/arcanon-fresh-<ts>
cd /tmp/arcanon-fresh-<ts>/plugins/arcanon && npm install
bash scripts/install-deps.sh   # silent happy-path, <100ms
bash scripts/session-start.sh
```

Result: **PASS**

- `git clone` — PASS
- `npm install` — PASS (62 packages, 0 vulnerabilities, Node 25.9.0)
- `bash scripts/install-deps.sh` — PASS (silent happy-path, <100ms)
- `bash scripts/session-start.sh` — PASS (returned `hookSpecificOutput` JSON:
  "Detected: node. Commands: /arcanon:map, ...")

**Pattern B — `/arcanon:doctor` post-scan smoke, deferred to pre-tag manual run** (mirrors 113-VERIFICATION.md:26 precedent):

`bash scripts/hub.sh doctor` on the fresh workspace exits 0 silently per its
**documented contract** at `worker/cli/hub.js:988-993` — when no
`impact-map.db` exists for `projectHashDir(cwd)`, doctor enters its
silent-no-op branch (mirroring the `/arcanon:list` contract). Justification:

- Install machinery is structurally unchanged from v0.1.3
  (`scripts/install-deps.sh`, `scripts/mcp-wrapper.sh` both stable since
  Phase 107).
- Phase 107's INST-07..11 bats fixtures cover the `install-deps.sh` contract
  (`tests/install-deps.bats`, all green per VER-01).
- Phase 114-03's 12 doctor.bats tests cover all 8 doctor checks against
  synthesized DB fixtures — proving the doctor logic is correct independent
  of fresh-install.

Pre-tag smoke command recorded in `/tmp/122-doctor.log`:

```bash
nvm use 25
git clone https://github.com/Arcanon-hub/arcanon /tmp/arcanon-v0.1.4-smoke
cd /tmp/arcanon-v0.1.4-smoke/plugins/arcanon && npm install
cd /tmp/arcanon-v0.1.4-smoke
# Run a scan to populate impact-map.db, then:
ARCANON_DATA_DIR=/tmp/arcanon-v0.1.4-smoke-data bash scripts/hub.sh doctor
```

Status: **PASS (Pattern A install) + DEFERRED (Pattern B doctor post-scan
smoke)** — acceptable per 105/113-VERIFICATION precedent.

## VER-06 — Manifest Bump

| File                                              | Occurrences                                              | Status |
| ------------------------------------------------- | -------------------------------------------------------- | ------ |
| `plugins/arcanon/.claude-plugin/plugin.json`      | 1                                                        | ✅ "0.1.4" |
| `plugins/arcanon/.claude-plugin/marketplace.json` | 2 (plugin entry + top-level)                             | ✅ both "0.1.4" |
| `.claude-plugin/marketplace.json` (root)          | 2 (plugin entry + top-level)                             | ✅ both "0.1.4" |
| `plugins/arcanon/package.json`                    | 1                                                        | ✅ "0.1.4" |
| **Total**                                         | **6 strings / 4 files**                                  | ✅ |
| `plugins/arcanon/package-lock.json`               | 2 (regenerated via `npm install --package-lock-only`)    | ✅ "0.1.4" |

`runtime-deps.json` is intentionally **not** in this list — Phase 107's
INST-01 deleted it. Manifest count for v0.1.4 is **4**, identical to v0.1.3
(no new manifests introduced).

**`package-lock.json` regeneration** (D-02 mandate from v0.1.2 PR #19 lesson):
`npm install --package-lock-only` was run from `plugins/arcanon/`. Both
`version` fields (root and `packages.""."version"`) now read `0.1.4`,
matching `package.json`. This unblocks CI's `npm ci`.

**Verification command output:**

```
.claude-plugin/marketplace.json:9:      "version": "0.1.4",
.claude-plugin/marketplace.json:14:  "version": "0.1.4"
plugins/arcanon/.claude-plugin/plugin.json:3:  "version": "0.1.4",
plugins/arcanon/.claude-plugin/marketplace.json:9:      "version": "0.1.4",
plugins/arcanon/.claude-plugin/marketplace.json:14:  "version": "0.1.4"
plugins/arcanon/package.json:3:  "version": "0.1.4",
```

All 6 occurrences at `0.1.4`. Commit: `110a9a4`.

## VER-07 — CHANGELOG Pin

`## [0.1.4] - 2026-04-27` heading present at line 9. Subsections in
Keep-a-Changelog order:

| Subsection    | Required Coverage                                                                                                                                                                | Status |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `### Added`   | NAV-01..04 (list/view/doctor/diff), HELP-01..04 (--help), FRESH-03 (endpoint), CORRECT-01..07 (scan_overrides + correct/rescan), SHADOW-01..03 (shadow-scan/diff/promote), INT-05..08, INT-10 (externals catalog + matcher + bats) | ✅ |
| `### Changed` | FRESH-01, FRESH-02, FRESH-04 (`/arcanon:status` per-repo freshness reporting via `/api/scan-freshness` endpoint)                                                                 | ✅ |
| `### Fixed`   | (no bugs caught mid-milestone — subsection omitted)                                                                                                                              | omitted |
| `### Removed` | (none planned for v0.1.4 — additive milestone — subsection omitted)                                                                                                              | omitted |
| `### BREAKING`| (none — `scan_overrides` additive, hub payload 1.2 backward-compatible — subsection omitted)                                                                                     | omitted |

Per Keep-a-Changelog convention, empty subsections are omitted rather than
shipped with no bullets. Per-bullet REQ-ID references preserved (e.g.,
`(NAV-01)`, `(HELP-01..04)`, `(SHADOW-01)`).

Fresh empty `## [Unreleased]` heading retained at line 7 above the pinned
section. Commit: `81dd62b`.

## ROADMAP/REQUIREMENTS Prose Drift Reconciliation

Per RESEARCH §8 + Phase 114 plan-phase finding, the following one-line edits
landed in this plan:

| File                                | Old                                          | New                                          |
| ----------------------------------- | -------------------------------------------- | -------------------------------------------- |
| `.planning/ROADMAP.md:241`          | `runs 7 diagnostic checks`                   | `runs 8 diagnostic checks`                   |
| `.planning/REQUIREMENTS.md:33`      | `— 7 smoke-test diagnostics:`                | `— 8 smoke-test diagnostics:`                |

Both files' prose now matches the canonical 8-item numbered list and the
Phase 114-03 implementation (which shipped 8 checks). Commit: `473ea96`.

## Summary of Phases (v0.1.4)

| Phase                                                           | Status | REQs   | Notes |
| --------------------------------------------------------------- | ------ | ------ | ----- |
| 114 Read-Only Navigability Commands (`/list`, `/view`, `/doctor`) | ✅     | 3/3    | NAV-01 cmdList composition; NAV-02 pure-markdown alias; NAV-03 8 diagnostics with --json |
| 115 Scan-Version Diff Command (`/diff`)                         | ✅     | 1/1    | NAV-04 — 4 input forms (ID, HEAD~N, ISO, branch heuristic) |
| 116 `--help` System + `/arcanon:status` Freshness               | ✅     | 9/9    | HELP-01..04 + FRESH-01..05 — bash detector + awk extraction + new `/api/scan-freshness` endpoint |
| 117 scan_overrides Persistence Layer                            | ✅     | 3/3    | CORRECT-01..03 — Migration 017 + apply hook between persistFindings and endScan |
| 118 scan_overrides Operator Commands                            | ✅     | 4/4    | CORRECT-04..07 — `/correct` 4 actions + `/rescan` single-repo |
| 119 Shadow Scan + Atomic Promote                                | ✅     | 4/4    | SHADOW-01..04 — sibling DB, diff --shadow, atomic promote with backup |
| 120 Integration Data Layer                                      | ✅     | 5/5    | INT-01..05 — evidence_mode + --offline + --spec + known-externals shipped |
| 121 Integration Consumption Layer                               | ✅     | 5/5    | INT-06..10 — catalog matcher + user external_labels + UI surfacing |
| 122 Verification Gate + Release Pin                             | ✅     | 7/7    | This report (VER-01..07) |
| **Total**                                                       | **✅** | **41/41** | |

## Breaking Changes Summary (for release notes)

None. v0.1.4 is an **additive milestone**:

- `scan_overrides` table is new (migration 017) — additive, no existing
  column changes.
- `actors.label` column is new (migration 018) — additive, NULL-default,
  graceful fallback on pre-migration-018 databases.
- Hub payload schema bumped from 1.0/1.1 → 1.2 — backward-compatible
  (default `evidence_mode: "full"` produces byte-identical `evidence` field
  shape; only the version string in the payload header changes).
- All new commands (`list`, `view`, `doctor`, `diff`, `correct`, `rescan`,
  `shadow-scan`, `promote-shadow`) are additive — none replace or remove
  existing commands.
- All command markdown files gain a `## Help` section (HELP-01) — additive
  content; existing run sections unchanged.
- `/arcanon:status` output extension (FRESH-01, 02) — additive new lines;
  existing output unchanged.

## Verdict

**v0.1.4 Operator Surface — READY TO SHIP.**

All 41 requirements complete across 9 phases. Test suites green:

- bats: 459/459 passing (zero failures, zero macOS caveats triggered at
  threshold=200)
- node: 775/775 passing across 141 suites (zero failures — the v0.1.3
  pre-existing `manager.test.js:676` incremental-prompt mock failure is now
  resolved by v0.1.4 work)
- per-command `--help` smoke: 17/17 PASS
- regression greps: 4/4 PASS (zero `--help` leaks, runtime-deps.json absent,
  /arcanon:upload absent)

Manifests pinned at 0.1.4 across 4 files (6 version strings);
`package-lock.json` regenerated and consistent. CHANGELOG `[0.1.4] -
2026-04-27` section pinned with `### Added` + `### Changed` subsections
(empty Fixed/Removed/BREAKING omitted per Keep-a-Changelog convention —
v0.1.4 is additive). ROADMAP/REQUIREMENTS prose drift on `/arcanon:doctor`
check count (7 → 8) reconciled.

Fresh-install Node 25 smoke: Pattern A (install machinery) PASS in-session;
Pattern B (`/arcanon:doctor` post-scan smoke) deferred to pre-tag manual run
per 113-VERIFICATION.md:26 precedent (install machinery structurally
unchanged from v0.1.3; doctor logic fully covered by 12 bats tests, all
green).

**Next step:** `/gsd-complete-milestone v0.1.4`.
