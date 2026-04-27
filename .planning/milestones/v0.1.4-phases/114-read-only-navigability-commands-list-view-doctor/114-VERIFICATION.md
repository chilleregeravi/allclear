---
phase: 114-read-only-navigability-commands-list-view-doctor
verified: 2026-04-25
status: passed
score: 9/9 must-haves verified
re_verification:
  previous_status: none
  note: "Initial gsd-verifier run (parallel to v0.1.3→v0.1.4 audit's spot-check PASS)"
requirements_covered: [NAV-01, NAV-02, NAV-03]
test_results:
  list.bats: 7/7
  doctor.bats: 12/12
  commands-surface.bats: 12/12
  total: 31/31
documented_discrepancies:
  - id: ROADMAP-PROSE-7VS8
    surface: ".planning/ROADMAP.md (Phase 114 detail) + .planning/REQUIREMENTS.md (NAV-03 header line)"
    fix_in: "Phase 122"
    impact: "documentation only — implementation correctly ships 8 checks per REQUIREMENTS.md NAV-03 enumeration"
---

# Phase 114 Verification

**Verified:** 2026-04-25
**Phase:** 114-read-only-navigability-commands-list-view-doctor
**REQs covered:** NAV-01, NAV-02, NAV-03 (3/3)
**Verdict:** PASSED

## Goal Verification

Phase 114 goal (verbatim from ROADMAP): "Operators can inspect any Arcanon project's overview, jump straight into the graph UI, and run a 7/8-check smoke-test diagnostic — all without knowing about hidden subcommands or touching the DB."

| # | Observable Behavior | Status | Evidence |
|---|---|---|---|
| 1 | Operators can inspect any Arcanon project's overview | SATISFIED | `commands/list.md` (frontmatter + auto-start block at lines 78-87) wires through `scripts/hub.sh list` to `cmdList` (`worker/cli/hub.js:571`), which composes `GET /graph` + `GET /api/scan-quality` + `SELECT COUNT(*) FROM repos` + `queueStats()`/`resolveCredentials()`. Output covers the 5 required sections: Repos / Services-by-type / Connections-by-confidence / Actors / Hub. Verified by `tests/list.bats` Test 5 — happy-path 5-line overview with pinned counts. |
| 2 | Jump straight into the graph UI | SATISFIED | `commands/view.md` exists (60 lines) with worker auto-start + cross-platform browser open block cloned verbatim from `map.md:22-32`. `commands/map.md` `## If \`view\` flag` block is preserved (regression test 28 in commands-surface.bats). Negative regression: `worker/cli/hub.js` does NOT contain `view: cmdView` (test 29 — confirmed via grep returning NOT FOUND). |
| 3 | Run a 7/8-check smoke-test diagnostic | SATISFIED | `commands/doctor.md` (75 lines, frontmatter declares all 8 checks in a table). `cmdDoctor` (`worker/cli/hub.js:881`) implements all 8 checks (worker reachable, version match, schema head from filesystem glob, config + linked repos, data-dir writable, DB integrity via `PRAGMA quick_check`, MCP liveness probe via spawn, hub credential round-trip). `--json` flag emits `{version, project_root, checks[], summary}` shape. Critical/non-critical exit-code matrix implemented as specified. Verified by `tests/doctor.bats` 12/12. |
| 4 | All without knowing about hidden subcommands or touching the DB | SATISFIED | Three top-level commands shipped (`list`, `view`, `doctor`) — no need to remember `/arcanon:map view` or any subcommand to access the graph. Zero new migrations between Phase 113's `016_enrichment_log.js` and HEAD (`git diff 568504c..HEAD -- plugins/arcanon/worker/db/migrations/` is empty). `cmdDoctor` uses `new Database(dbPath, { readonly: true, fileMustExist: true })` for checks 3 & 6 — no `openDb()` call, no migration triggering. `cmdList` does a single `SELECT COUNT(*) FROM repos` (read-only). `commands/list.md` and `commands/doctor.md` both gate on `_arcanon_is_project_dir` for the silent-no-op contract in non-Arcanon directories. |

**Score:** 4/4 observable behaviors satisfied.

### Detailed Truth Verification (per-plan must-haves)

| # | Plan | Truth | Status | Evidence |
|---|---|---|---|---|
| 1 | 114-01 | `/arcanon:list` in scanned project prints 5-line overview | VERIFIED | tests/list.bats Test 5 PASS — pinned per-type and per-confidence counts. |
| 2 | 114-01 | `/arcanon:list` in non-project produces zero output, exits 0 | VERIFIED | tests/list.bats Test 4 PASS. |
| 3 | 114-01 | `/arcanon:list --json` emits structured object | VERIFIED | tests/list.bats Test 6 PASS — 11× jq assertions. |
| 4 | 114-01 | `_arcanon_is_project_dir()` returns 0/1 only, no echo | VERIFIED | tests/list.bats Tests 1-3 PASS — `[ -z "$output" ]` enforced. Source at `lib/worker-client.sh:86-102` returns via `[[ -f "$db_path" ]]`. |
| 5 | 114-02 | `/arcanon:view` resolves to `commands/view.md` (filename match) | VERIFIED | File exists (60 lines, frontmatter + auto-start block). RESEARCH §2 dispatch-precedence finding documents Claude Code's filename-based resolution. |
| 6 | 114-02 | `view.md` does NOT add `view: cmdView` to HANDLERS | VERIFIED | `grep "view: cmdView" worker/cli/hub.js` → NOT FOUND. tests/commands-surface.bats Test 29 enforces. |
| 7 | 114-02 | `/arcanon:map view` continues to work | VERIFIED | `commands/map.md` still contains `If \`view\` flag` block. tests/commands-surface.bats Test 28 enforces. |
| 8 | 114-03 | `/arcanon:doctor` healthy project: 8 lines PASS, exit 0 | VERIFIED | tests/doctor.bats Tests 1, 2 PASS. |
| 9 | 114-03 | Critical FAIL → exit 1; non-critical FAIL → WARN, exit 0 | VERIFIED | tests/doctor.bats Tests 4, 6 (critical FAIL → exit 1) and Tests 8, 11, 12 (WARN → exit 0). |
| 10 | 114-03 | Migration head from filesystem glob, NOT hardcoded | VERIFIED | `worker/cli/hub.js:943-957` reads `migDir = path.join(__dirname, "..", "db", "migrations")` then regex-filters `^[0-9]+_.*\.js$` and takes `Math.max(...versions)`. No `MIGRATION_HEAD = N` constant exists. Current filesystem head: `016_enrichment_log.js`. |
| 11 | 114-03 | MCP smoke = liveness probe (Option B per FLAG 5) | VERIFIED | `worker/cli/hub.js:1089-1162` spawns `worker/mcp/server.js` via `spawn(process.execPath, [serverPath], ...)`, accepts ANY JSON-RPC line on stdout OR survival-to-1s-deadline as PASS. Does NOT send `tools/list`. |
| 12 | 114-03 | Hub creds SKIP when no credentials configured | VERIFIED | tests/doctor.bats Test 5 PASS. Source at `worker/cli/hub.js:1175-1181` — `try { resolveCredentials() } catch { return SKIP }`. |
| 13 | 114-03 | `--json` emits `{version, project_root, checks[], summary}` | VERIFIED | tests/doctor.bats Test 2 PASS — 11+ jq field assertions. |

## Test Execution

```
$ bats tests/list.bats tests/doctor.bats tests/commands-surface.bats
1..31
ok 1 NAV-01 helper: returns 0 when impact-map.db exists for cwd
ok 2 NAV-01 helper: returns 1 when no impact-map.db exists for cwd
ok 3 NAV-01 helper: honors ARCANON_DATA_DIR override
ok 4 NAV-01: bash hub.sh list exits 0 silently when no impact-map.db
ok 5 NAV-01: list happy path prints 5-line overview with correct counts
ok 6 NAV-01: list --json emits structured object
ok 7 NAV-01: list does not crash when scan_versions is empty
ok 8 NAV-03: doctor all-pass scenario emits 8 check lines and exits 0
ok 9 NAV-03: doctor --json emits structured object with 8 checks
ok 10 NAV-03: doctor silent in non-Arcanon directory
ok 11 NAV-03: doctor exits 1 when critical check 5 (data dir) FAILs
ok 12 NAV-03: doctor reports SKIP for check 8 when no credentials
ok 13 NAV-03: doctor reports check 1 FAIL + exit 1 when worker unreachable
ok 14 NAV-03: commands/doctor.md exists with frontmatter
ok 15 NAV-03: doctor reports WARN for check 3 when DB schema lags migration head
ok 16 NAV-03: doctor reports check 7 PASS for MCP liveness probe
ok 17 NAV-03: doctor reports check 8 PASS when hub round-trip succeeds
ok 18 NAV-03: doctor reports check 8 WARN when hub unreachable
ok 19 NAV-03: doctor reports check 4 WARN when a linked-repo dir is missing
ok 20 CLN-09: all surviving command files exist
ok 21 CLN-09: all surviving commands have description frontmatter
ok 22 NAV-01: /arcanon:list declares allowed-tools: Bash
ok 23 CLN-01: /arcanon:cross-impact command file has been removed
ok 24 DEP-03: /arcanon:upload command file has been removed (regression guard)
ok 25 CLN-03: /arcanon:sync advertises --drain, --repo, --dry-run, --force in argument-hint
ok 26 CLN-04: /arcanon:sync default behaviour documents upload-then-drain
ok 27 NAV-02: /arcanon:view exists with frontmatter and worker-start block
ok 28 NAV-02: /arcanon:map still contains the inline 'If `view` flag' block
ok 29 NAV-02: worker/cli/hub.js does NOT register a view handler
ok 30 NAV-03: /arcanon:doctor declares allowed-tools: Bash
ok 31 NAV-03: worker/cli/hub.js registers doctor: cmdDoctor
```

**Result: 31/31 PASS** (12 doctor.bats + 7 list.bats + 12 commands-surface.bats — matches orchestrator's last-known count).

## REQ Coverage

| REQ | Plan | Status | Evidence |
|-----|------|--------|----------|
| NAV-01 | 114-01 | SATISFIED | `commands/list.md` + `worker/cli/hub.js cmdList` (line 571) registered as `list: cmdList` in HANDLERS (line 1229). 5-line overview format matches REQUIREMENTS.md NAV-01 verbatim. tests/list.bats 7/7. |
| NAV-02 | 114-02 | SATISFIED | `commands/view.md` exists with worker auto-start + cross-platform browser open. No Node handler (negative regression test 29 in commands-surface.bats). `/arcanon:map view` preserved (test 28). |
| NAV-03 | 114-03 | SATISFIED | `commands/doctor.md` + `worker/cli/hub.js cmdDoctor` (line 881) registered as `doctor: cmdDoctor` in HANDLERS (line 1230). All 8 checks implemented per REQUIREMENTS.md NAV-03 enumeration. tests/doctor.bats 12/12. Critical/non-critical exit-code matrix correct (1, 5, 6 critical → exit 1; 2, 3, 4, 7, 8 non-critical → WARN/SKIP, exit 0). |

## Cross-Check vs SUMMARYs

### 114-01 SUMMARY claims vs reality

| File | SUMMARY says | Verified |
|------|-------------|----------|
| `plugins/arcanon/commands/list.md` | created | YES — 103 lines, frontmatter + auto-start block + read-only guarantee section |
| `tests/list.bats` | created (7 tests at REPO ROOT) | YES — 7 @test blocks, all PASS |
| `plugins/arcanon/tests/fixtures/list/seed.sh` | created | YES — 1344 bytes |
| `plugins/arcanon/tests/fixtures/list/seed.js` | created | YES — 8816 bytes |
| `plugins/arcanon/lib/worker-client.sh` | modified (+`_arcanon_is_project_dir`) | YES — line 86, returns 0/1 only via `[[ -f "$db_path" ]]` (no echo) |
| `plugins/arcanon/worker/cli/hub.js` | modified (+`cmdList`, +`list: cmdList` in HANDLERS, +`import { projectHashDir }`) | YES — function at line 571, HANDLERS entry at line 1229 |
| `plugins/arcanon/worker/db/pool.js` | modified (`projectHashDir` made public via `export`) | YES — line 34: `export function projectHashDir(projectRoot)` |
| `tests/commands-surface.bats` | iteration list extended; +allowed-tools regression for list.md | YES — test 22 PASS |
| `plugins/arcanon/CHANGELOG.md` | Added entry under [Unreleased] | YES — diff confirms +22 lines |

Diff stats: `git diff --stat 568504c..HEAD -- plugins/arcanon/CHANGELOG.md plugins/arcanon/lib/worker-client.sh plugins/arcanon/worker/cli/hub.js plugins/arcanon/worker/db/pool.js tests/commands-surface.bats` — all 5 modified files appear with non-zero deltas.

### 114-02 SUMMARY claims vs reality

| File | SUMMARY says | Verified |
|------|-------------|----------|
| `plugins/arcanon/commands/view.md` | created (60 lines) | YES — 58 lines actual; frontmatter + worker-start block + read-only guarantee |
| `tests/commands-surface.bats` | +3 NAV-02 @test blocks | YES — tests 27, 28, 29 PASS |
| `plugins/arcanon/CHANGELOG.md` | Added entry | YES |
| `plugins/arcanon/worker/cli/hub.js` | UNCHANGED by 114-02 | Confirmed: no `cmdView` function defined; no `view: cmdView` in HANDLERS |

### 114-03 SUMMARY claims vs reality

| File | SUMMARY says | Verified |
|------|-------------|----------|
| `plugins/arcanon/commands/doctor.md` | created (~70 lines) | YES — 75 lines, table of 8 checks + auto-start block + per-check Help section |
| `plugins/arcanon/tests/fixtures/doctor/seed.sh` | created | YES — 2078 bytes |
| `plugins/arcanon/tests/fixtures/doctor/mock-hub.js` | created (17-line http server on 127.0.0.1:37996) | YES — 1072 bytes; `http.createServer`, listens on PORT env or 37996; returns 200 `{"version":"x"}` for `/api/version` |
| `tests/doctor.bats` | created (12 tests at REPO ROOT) | YES — 12 @test blocks, all PASS |
| `plugins/arcanon/worker/cli/hub.js` | +`cmdDoctor` (~210 lines), +`fetchWithTimeout`, +`runCheck`, +`formatDoctorTable`, +`doctor: cmdDoctor` in HANDLERS, +`spawn` import, +`Database` import | YES — all landmarks present at lines 87 (fetchWithTimeout), 811 (runCheck), 840 (formatDoctorTable), 881 (cmdDoctor), 1230 (HANDLERS entry) |
| `tests/commands-surface.bats` | +2 NAV-03 @test blocks | YES — tests 30, 31 PASS |
| `plugins/arcanon/CHANGELOG.md` | Added entry | YES |

**All 5 commits land cleanly:** `5c428ca` (114-01 scaffold), `865fc33` (114-01 ship), `51b4cc9` (114-02), `86b9d4f` (114-03 scaffold), `d730a4a` (114-03 finish).

## Pre-Flight Resolution

**v0.1.3→v0.1.4 audit pre-flight requirement for Phase 114:** `/arcanon:view` dispatch precedence against `/arcanon:map view`.

**How it shipped:**

1. **`commands/view.md` exists** — Claude Code resolves `/arcanon:view` to this file by exact filename match (per RESEARCH §2). Verified via `ls plugins/arcanon/commands/ | grep view.md`.
2. **`worker/cli/hub.js` does NOT contain `view: cmdView`** — verified via `grep "view: cmdView" worker/cli/hub.js` returning NOT FOUND. tests/commands-surface.bats Test 29 enforces this as a permanent regression guard.
3. **`commands/map.md`'s `view` keyword still routes correctly** — `grep "If \`view\` flag" commands/map.md` returns the existing block (preserved). tests/commands-surface.bats Test 28 enforces.

**No double-dispatch guard ships.** Per RESEARCH §2, Claude Code's filename-based resolution means there is no router to double-fire. The negative regression test is the contract that prevents a future contributor from creating the dispatch ambiguity the audit warned about.

## Threat Model

| Threat | Status | Evidence |
|--------|--------|----------|
| Zero DB writes | CONFIRMED | `cmdList` does only `SELECT COUNT(*) FROM repos`. `cmdDoctor` checks 3 & 6 use `new Database(dbPath, { readonly: true, fileMustExist: true })` — `readonly: true` prevents writes at the SQLite layer. Check 5's data-dir writability test writes a PID-suffixed probe under `$ARCANON_DATA_DIR` (not the DB) and unlinks immediately. |
| Zero migrations introduced | CONFIRMED | `git diff 568504c..HEAD -- plugins/arcanon/worker/db/migrations/` is empty. Migration head remains `016_enrichment_log.js` (Phase 113's last). `cmdDoctor` checks 3 & 6 deliberately bypass `openDb()` (which would auto-run migrations) per the in-source comments at hub.js:940-941, 1040-1043. |
| Zero new auth surface | CONFIRMED | Check 8 reads existing `resolveCredentials()` (`worker/cli/hub.js:1178`) — same helper `cmdSync`/`cmdStatus` use. No new credential storage, no new auth headers in HTTP layer. Bearer token is only ever passed as `Authorization` header to `fetchWithTimeout`; never logged in WARN detail strings (T-114-03-05 mitigation honored). |
| No new HTTP routes | CONFIRMED | `cmdList` consumes existing `/graph` + `/api/scan-quality`. `cmdDoctor` consumes existing `/api/readiness` + `/api/version`. Neither adds routes to `worker/server/http.js`. |
| Silent in non-Arcanon directories | CONFIRMED | Both `commands/list.md:80-82` and `commands/doctor.md:45-47` gate on `_arcanon_is_project_dir`; `cmdList` and `cmdDoctor` both perform Node-side `fs.existsSync(dbPath)` and `process.exit(0)` if absent (verified at hub.js:584 and hub.js:898). tests/list.bats Test 4 + tests/doctor.bats Test 10 enforce. |

**Threat model honesty: the read-only contract is real, not aspirational.**

## Documented Discrepancies for Downstream

### 1. ROADMAP-PROSE-7VS8 (8-vs-7 doctor checks prose drift)

- **Surface:** `.planning/ROADMAP.md` Phase 114 detail says "7-check smoke-test diagnostic"; `.planning/REQUIREMENTS.md` NAV-03 header says "7 smoke-test diagnostics" but enumerates 8 numbered checks immediately below.
- **Implementation:** ships 8 checks (matches REQUIREMENTS.md enumeration, the more authoritative source).
- **114-03 SUMMARY explicitly flagged this** under "## Discrepancies" for downstream resolution.
- **Fix in:** Phase 122 (verification gate / docs reconciliation) — either update ROADMAP/REQUIREMENTS prose to "8-check" or accept with footnote.
- **Impact:** documentation only; no functional gap.

### 2. (No other discrepancies surfaced.)

The 114-01, 114-02, 114-03 SUMMARY "Open Items" sections list only the README quick-start update for Phase 122 (a known v0.1.4 release-cut task) and a deferred future MCP-conformance-test plan (intentionally scoped out of NAV-03 per FLAG 5). Neither is a real gap.

## Anti-Patterns Found

None. Spot-checks of the modified files (`worker/cli/hub.js cmdList` and `cmdDoctor`, `commands/list.md`, `commands/view.md`, `commands/doctor.md`, `lib/worker-client.sh _arcanon_is_project_dir`) found no TODO/FIXME/PLACEHOLDER markers, no empty handlers, no console.log-only implementations, no hardcoded empty-data props that flow to user-visible output. Stub patterns are limited to test fixtures (intentional) and to legitimate fallback defaults that get overwritten by real fetches.

## Verdict

**PASSED**

Phase 114 ships exactly what its goal promised. Three top-level read-only commands (`/arcanon:list`, `/arcanon:view`, `/arcanon:doctor`) deliver project overview, graph-UI shortcut, and 8-check smoke diagnostic respectively — without requiring users to remember subcommands and without touching the DB beyond a single `SELECT COUNT(*) FROM repos` and read-only `PRAGMA quick_check` / `SELECT MAX(version) FROM schema_versions`. All 31/31 bats tests across `list.bats`, `doctor.bats`, and `commands-surface.bats` pass. The pre-flight `/arcanon:view` dispatch-precedence concern is resolved via filename-based resolution (RESEARCH §2) plus a permanent negative regression test in `commands-surface.bats` Test 29. Zero new migrations, zero new auth surface, zero new HTTP routes — the read-only contract is honored at the code level, not just claimed in SUMMARY prose. The single documented discrepancy (ROADMAP/REQUIREMENTS prose says "7-check" while implementation correctly ships 8 per REQUIREMENTS.md enumeration) is already queued for Phase 122 documentation reconciliation and has zero functional impact.

---

_Verified: 2026-04-25_
_Verifier: Claude (gsd-verifier)_
