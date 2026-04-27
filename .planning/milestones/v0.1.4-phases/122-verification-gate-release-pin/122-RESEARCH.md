# Phase 122: Verification Gate + Release Pin — Research

**Researched:** 2026-04-25
**Domain:** Release verification (test suites, regression greps, manifest version pinning, CHANGELOG locking, fresh-install smoke)
**Confidence:** HIGH (every claim cited to file:line or commit hash)

## Summary

Phase 122 is the v0.1.4 release gate. It runs end-to-end verification (full bats suite, node test suites, repo-wide `--help` regression grep refined for the new HELP system, fresh-install smoke), then pins the milestone (4 manifest files to `0.1.4`, regenerates `package-lock.json`, collapses `[Unreleased]` CHANGELOG entries from Phases 114-121 into a single `[0.1.4] - <date>` block). It mirrors the v0.1.3 Phase 113 single-plan pattern but is split into two plans here per orchestrator brief (verify half + pin half) so the verify half can fail-fast without blocking the planning of the pin half.

The blueprint commits to model this work after are `a9ca133` (manifest bump + lockfile regen) and `47648fb` (CHANGELOG pin) — both authored 2026-04-25 by Ravi. Both are atomic, well-commented, and pass `npm ci` post-bump. Plan 122-02 should produce the same shape of commit.

**Primary recommendation:** Plan 122-01 (`verify`) gates Plan 122-02 (`pin`) — pin half MUST NOT run if verify half fails. Both plans land 7 files total: 4 manifests + lockfile + CHANGELOG + 122-VERIFICATION.md report.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| VER-01 | bats suite green ≥315 baseline + new tests | §2 — current count is 351 across 30 files; all v0.1.4 phases add tests (Phase 114 added 31, others +N) |
| VER-02 | node test suite green for affected modules | §3 — existing `npm test` runs all `worker/**/*.test.js`; v0.1.3 baseline was 630/631 passing |
| VER-03 | All commands have `## Help` sections; `/arcanon:<cmd> --help` non-empty | §4 — Phase 116 (HELP-01..04) ships this; Phase 122 verifies via bats HELP-04 + `awk` extraction |
| VER-04 | Repo-wide `--help` grep refined (allowed within `## Help` blocks + 1 `update.md:21` host-CLI ref) | §5 — exact grep command pinned, the one preserved hit is `commands/update.md:21` `claude plugin update --help` |
| VER-05 | Fresh-install Node 25 smoke: `claude plugin install` + first session + `/arcanon:doctor` all PASS | §6 — Pattern A (in-session execution) preferred; Pattern B (deferred-to-pre-tag) acceptable per 105/113-VERIFICATION.md precedent |
| VER-06 | 4 manifest files at version 0.1.4 + lockfile regenerated | §1 — exact 4 files identified, 6 strings, regen via `npm install --package-lock-only` |
| VER-07 | CHANGELOG `[0.1.4] - <date>` pinned with all subsections | §7 — collapse 8 phases' `[Unreleased]` entries into one block in Keep-a-Changelog order |

---

## 1. Manifest pinning — exact 4 files / 6 version strings

**Pattern verified against commit `a9ca133` (v0.1.3 release pin).** The list has been stable since v0.1.3 (runtime-deps.json was deleted in Phase 107 / INST-01); v0.1.4 ships no new manifest files.

Current state (all at `0.1.3`):

| File | Line(s) | Version Strings |
|------|---------|-----------------|
| `plugins/arcanon/.claude-plugin/plugin.json` | 3 | 1 |
| `plugins/arcanon/.claude-plugin/marketplace.json` | 9 (plugin entry), 14 (top-level) | 2 |
| `.claude-plugin/marketplace.json` | 9 (plugin entry), 14 (top-level) | 2 |
| `plugins/arcanon/package.json` | 3 | 1 |
| **Total** | — | **6 strings / 4 files** |

`plugins/arcanon/package-lock.json` is **regenerated**, not authored — 2 occurrences (root `.version` + `packages.""."version"`). Per D-02 lesson from v0.1.2 PR #19, `npm install --package-lock-only` (NOT `npm install`) is the canonical regenerator — it rewrites the lockfile without installing/upgrading dependencies. This keeps `npm ci` happy in CI.

**Verification command (post-bump):**
```bash
cd /Users/ravichillerega/sources/ligamen
[ "$(grep -h '"version"' .claude-plugin/marketplace.json plugins/arcanon/.claude-plugin/plugin.json plugins/arcanon/.claude-plugin/marketplace.json plugins/arcanon/package.json | grep -c '"0.1.4"')" -eq 6 ] && grep -q '"version": "0.1.4"' plugins/arcanon/package-lock.json
```

**Sanity:** runtime-deps.json must remain absent (`test ! -f plugins/arcanon/runtime-deps.json`). It was deleted in Phase 107 and is no longer a manifest. Don't re-add it.

---

## 2. Bats baseline + per-phase additions

**Current bats count (queried 2026-04-25):** **351 tests across 30 files** at `tests/` (repo root, NOT `plugins/arcanon/tests/`). The plugin-scoped `tests/` directory holds only fixtures + helpers.

**Per-file distribution (top 15):**
```
36 tests/file-guard.bats
25 tests/drift-versions.bats
22 tests/session-start.bats
21 tests/update.bats
20 tests/structure.bats
19 tests/detect.bats
16 tests/format.bats
15 tests/config.bats
14 tests/impact-merged-features.bats
13 tests/lint.bats
12 tests/drift-dispatcher.bats
12 tests/doctor.bats          ← NEW in Phase 114-03 (NAV-03)
12 tests/commands-surface.bats
11 tests/integration/impact-flow.bats
11 tests/install-deps.bats
```

**v0.1.3 closing baseline (per 113-VERIFICATION.md line 43):** **315/315 passing.**

**Phase 114 added (already shipped per existing SUMMARY files):**
- `tests/list.bats` (7 tests, NAV-01)
- `tests/doctor.bats` (12 tests, NAV-03)
- `tests/commands-surface.bats` regression rows (NAV-02 + DEP/back-compat)

That's roughly **+19-31 tests already landed** between v0.1.3 close (315) and current state (351), give or take fixture seeders that `bats` doesn't count.

**Phases 115-121 will each add tests** (per their REQ specs):
- Phase 115 (NAV-04 `/diff`): bats E2E for `/arcanon:diff` covering 4 input forms (~6-10 tests)
- Phase 116 (HELP-01..04 + FRESH-01..05): HELP-04 iterates every command (currently ~13) + FRESH-05 freshness fixture (~14-18 tests)
- Phase 117 (CORRECT-01..03): node-side migration + apply tests (~5-8 tests; mostly node, some bats)
- Phase 118 (CORRECT-04..07): `/correct` + `/rescan` bats happy paths + error case (~7-10 tests)
- Phase 119 (SHADOW-01..04): shadow-scan + diff + promote-shadow bats (~6-8 tests)
- Phase 120 (INT-01..05): hub payload schema, offline, explicit-spec drift, externals shipping (~5 node + 2-3 bats)
- Phase 121 (INT-06..10): catalog match + UI surfacing + INT-10 explicit `--spec X --spec Y` bats (~3-5 tests)

**Acceptance bar for VER-01 (Plan 122-01):**
- ✅ ≥**340 tests pass** — minimum gate (current 351 less a small margin; if a phase ships fewer tests than projected, this is the floor)
- ✅ ≥**380 tests pass** — expected target after all of 115-121's additions land
- ⚠️ HOK-06 macOS caveat at `IMPACT_HOOK_LATENCY_THRESHOLD=200` is acceptable IF AND ONLY IF the failure is the documented BSD fork overhead and `IMPACT_HOOK_LATENCY_THRESHOLD=300` makes it pass. Document exactly as 113-VERIFICATION.md did.
- Any other failure: investigate. Likely a real regression — surface to user before proceeding.

**Run command (mirrors Phase 113 Task 2):**
```bash
cd /Users/ravichillerega/sources/ligamen
IMPACT_HOOK_LATENCY_THRESHOLD=200 bats tests/ 2>&1 | tee /tmp/122-bats-output.log
```

---

## 3. Node test suite — affected modules

**`npm test` script** at `plugins/arcanon/package.json:37`:
```
find worker -name '*.test.js' -not -path '*/node_modules/*' -print0 | xargs -0 node --test
```

This runs every `worker/**/*.test.js`. v0.1.3 baseline was 630/631 passing (113-VERIFICATION.md:80). v0.1.4 affected modules (each phase's plan must land green for VER-02):

- **Phase 117 (CORRECT-01..03):** `worker/db/migration-017.test.js` (idempotency); `worker/db/query-engine-overrides.test.js` (insert/select); `worker/scan/manager.test.js` apply-overrides flow
- **Phase 118 (CORRECT-04..07):** `worker/cli/hub.js` cmdCorrect / cmdRescan unit tests
- **Phase 119 (SHADOW-01..04):** `worker/db/pool.js` shadow cache-key behavior; `worker/scan/manager.js` shadow-DB-target handling
- **Phase 120 (INT-01..05):** `worker/hub-sync/payload.js` (1.2 schema bump + `evidence_mode`); `worker/sync/sync.js` `--offline` path; `worker/drift/openapi.js` `--spec` plumbing; `worker/data/known-externals.js` loader
- **Phase 121 (INT-06..10):** `worker/scan/enrichment.js` catalog match; `worker/db/query-engine.js` label join; merge with user `external_labels`

**Pre-existing non-regression failure carried from v0.1.3 (per 113-VERIFICATION.md:91-94):**
- `worker/scan/manager.test.js:676` — `incremental scan prompt contains INCREMENTAL_CONSTRAINT heading and changed filename` — `TypeError: Cannot read properties of undefined (reading 'prepare')` at `worker/scan/manager.js:806` (mock fixture missing `_db`)

This is acceptable IF the same failure + same line number reappears. Any NEW failure must be investigated as a real regression introduced by 114-121.

**Run command (mirrors Phase 113 Task 3):**
```bash
pkill -f "node.*worker/index" 2>/dev/null
pkill -f "node.*worker/mcp/server" 2>/dev/null
sleep 1
cd /Users/ravichillerega/sources/ligamen/plugins/arcanon
npm test 2>&1 | tee /tmp/122-node-output.log
```

(`pkill` block prevents the same long-lived-worker-port cascade that bit v0.1.2 — see 105-VERIFICATION.md line 43.)

---

## 4. `## Help` sections + `--help` exit

Phase 116 (HELP-01..04) ships:
- Every command markdown file gets a `## Help` section with usage block + 2-3 examples (HELP-01)
- A bash detector (`lib/help.sh` or inline) inspects `$ARGUMENTS` for `--help` / `-h` / `help`, prints the `## Help` section content via `awk` extraction, exits 0 (HELP-02)
- `commands/update.md:21` (existing) `claude plugin update --help` reference is preserved as-is (HELP-03 — that's the upstream Claude Code host CLI flag, not an Arcanon command flag)
- bats test iterates every command file under `plugins/arcanon/commands/*.md`, invokes `<cmd> --help`, asserts non-empty output and exit 0 (HELP-04)

**Current command count (v0.1.3 baseline + v0.1.4 additions):**
- v0.1.3 baseline: 9 commands (`map`, `impact`, `drift`, `sync`, `login`, `status`, `export`, `update`, `verify`)
- Phase 114 added: `list`, `view`, `doctor` (+3) → **12**
- Phase 115 will add: `diff` (+1) → **13**
- Phase 118 will add: `correct`, `rescan` (+2) → **15**
- Phase 119 will add: `shadow-scan`, `promote-shadow` (+2) → **17**

**v0.1.4 ships ~17 commands** by VER-03 verification time. The bats HELP-04 test (Phase 116) will iterate all of them.

**VER-03 verification command (Plan 122-01):**
```bash
# Iterate every command file, invoke --help, assert non-empty + exit 0
for cmd in plugins/arcanon/commands/*.md; do
  name=$(basename "$cmd" .md)
  out=$(bash plugins/arcanon/scripts/hub.sh "$name" --help 2>&1)
  rc=$?
  if [ -z "$out" ] || [ "$rc" -ne 0 ]; then
    echo "FAIL: $name --help (rc=$rc, out=${#out} bytes)"
    exit 1
  fi
done
echo "PASS: all $(ls plugins/arcanon/commands/*.md | wc -l) commands have working --help"
```

Should be a no-op given Phase 116 already lands HELP-04 in bats — Plan 122-01 just re-runs it as part of `bats tests/help.bats` (or whatever Phase 116 names its file).

---

## 5. `--help` regression grep — refined for v0.1.4

**v0.1.3 rule (113-VERIFICATION.md:587, Phase 113 Task 1 #3):** zero `--help` strings in `plugins/arcanon/commands/*.md`. Documented one pre-existing exception: `commands/update.md:21` `claude plugin update --help` (host-CLI reference, NOT an Arcanon flag).

**v0.1.4 refines this rule** — Phase 116 (HELP-01..04) introduces:
1. `## Help` sections in EVERY command file (HELP-01) — these contain the substring `--help` inside the usage block (e.g., `Usage: /arcanon:list [--json] [--help]`).
2. Bash detector code that pattern-matches `$ARGUMENTS` against `--help` / `-h` / `help` (HELP-02) — these match `--help` inside a `case` or `if` branch.

**The refined grep allows `--help` ONLY:**
- (a) within the `## Help` section block of any command file (between `## Help` and the next `##`-level heading or EOF)
- (b) the existing `commands/update.md:21` `claude plugin update --help` host-CLI reference (HELP-03 explicit exception)
- (c) the help-detector branches in `lib/help.sh` (or wherever Phase 116 puts the bash detector)

**The refined grep DENIES `--help` everywhere else** — README, skills/, hooks/, scripts/ outside `lib/help.sh`, agent prompts, etc. This catches scope creep (random other places "documenting" `--help` that no actual command supports).

**Pinned grep command (Plan 122-01 Task 1):**
```bash
# Find all --help mentions in plugins/arcanon/commands/, exclude the allowed contexts:
#   1. Within ## Help sections (use awk to delete those blocks first)
#   2. The known commands/update.md:21 host-CLI reference
ALLOWED_HOST_CLI_REF="commands/update.md:21:claude plugin update --help"

# Step 1: strip ## Help sections from every command file, then grep
for f in plugins/arcanon/commands/*.md; do
  # Print only content OUTSIDE ## Help sections (delete from "## Help" to next "## " or EOF)
  awk 'BEGIN{p=1} /^## Help/{p=0; next} p==0 && /^## /{p=1} p' "$f" \
    | grep -nH --label="$f" -- "--help" \
    | grep -v "claude plugin update --help"   # Phase 116 HELP-03 exception
done
```

Expected: zero output. If anything matches, surface to user — likely scope creep.

**Per-tree grep (separate from commands/, the v0.1.3 rule already covered "no `--help` anywhere"):**
```bash
# README, skills, hooks, scripts (excluding lib/help.sh which IS the detector)
! grep -rn -- "--help" README.md plugins/arcanon/skills/ plugins/arcanon/hooks/ 2>/dev/null \
  | grep -v "node_modules"
```

Expected: zero matches. The v0.1.4 `--help` system is contained to `commands/*.md ## Help` sections + `lib/help.sh`. Anything else is documentation drift.

---

## 6. Fresh-install integration smoke (VER-05)

**Per REQUIREMENTS.md:173 (VER-05):** Fresh-install smoke on Node 25 — `claude plugin install` + first session + `/arcanon:doctor` reports all PASS.

**Two patterns (precedent set by 105 + 113):**

**Pattern A — in-session:**
```bash
# Kill any existing arcanon worker
pkill -f "node.*worker" 2>/dev/null

# Clone the v0.1.4 tag (or current HEAD) into a fresh workspace
WORK=/tmp/arcanon-fresh-$(date +%s)
git clone --branch v0.1.4 https://github.com/Arcanon-hub/arcanon "$WORK" || \
  git clone --branch main https://github.com/Arcanon-hub/arcanon "$WORK"

# Simulate marketplace install (manual, since real `claude plugin marketplace add`
# requires the host CLI; the stand-in is a clean npm install + first-session hook run)
cd "$WORK/plugins/arcanon"
npm install
node -v   # should print v25.x.x
bash scripts/install-deps.sh   # should be a no-op happy path (<100ms)
bash scripts/session-start.sh   # first-session enrichment

# Run the doctor
ARCANON_DATA_DIR="$WORK/.arcanon-data" \
  bash scripts/hub.sh doctor 2>&1 | tee /tmp/122-doctor.log

# Acceptance: all 8 checks PASS or WARN (no critical FAIL)
grep -E "^(PASS|WARN|FAIL):" /tmp/122-doctor.log
```

Acceptance: zero `FAIL:` lines for critical checks (1 = worker reachable, 5 = data-dir writable, 6 = DB integrity per REQUIREMENTS.md:43). Non-critical FAILs (4 = config + linked repos, 7 = MCP smoke, 8 = hub credentials) get reported as WARN.

**Pattern B — deferred to pre-tag manual run (105/113 precedent):**

If Pattern A is not feasible in-session (no Node 25 on dev machine, no network, etc.), deferral is acceptable IF AND ONLY IF the report explicitly states:

> The fresh-install machinery is unchanged structurally from v0.1.3 (`scripts/install-deps.sh`, `scripts/mcp-wrapper.sh` both stable). Phase 107's INST-07..11 bats fixtures cover the install-deps.sh contract (`tests/install-deps.bats`, 11 tests, all green). Manual smoke deferred to pre-tag run; recorded here once executed.

The 113-VERIFICATION.md:26 used Pattern B verbatim. This phase should prefer Pattern A but Pattern B is a valid fallback.

---

## 7. CHANGELOG `[0.1.4]` collapse — what entries from which phases

**Mechanism:** Phase 122 takes everything currently under `## [Unreleased]` (cumulatively appended by Phases 114-121's individual SUMMARY/commit work) and re-organizes into a single `## [0.1.4] - <date>` block in Keep-a-Changelog order, with subsection headings re-applied. A fresh empty `## [Unreleased]` heading stays at the top.

**Current state of `## [Unreleased]`** (CHANGELOG.md lines 7-29) **— verified 2026-04-25:**

```
## [Unreleased]

### Added

- /arcanon:list (NAV-01)
- /arcanon:view (NAV-02)
- /arcanon:doctor (NAV-03)
```

That's ONLY Phase 114's entries. Phases 115-121 will each append their own bullets to `## [Unreleased]` as part of their execution work (each phase plan should mandate the CHANGELOG append in its task list — the v0.1.3 phases did this consistently).

**Phase 122 collapses according to this map:**

| v0.1.4 Phase | REQs | CHANGELOG subsection(s) |
|---|---|---|
| 114 | NAV-01, NAV-02, NAV-03 | **Added** — `/arcanon:list`, `/arcanon:view`, `/arcanon:doctor` |
| 115 | NAV-04 | **Added** — `/arcanon:diff` (4 input forms) |
| 116 | HELP-01..04, FRESH-01..05 | **Added** — `## Help` sections + `--help` flag for every command, `/api/scan-freshness` endpoint, `/arcanon:status` freshness line. **Changed** — `/arcanon:status` output extension. |
| 117 | CORRECT-01..03 | **Added** — `scan_overrides` table (migration 017), pending-overrides apply hook in scan pipeline |
| 118 | CORRECT-04..07 | **Added** — `/arcanon:correct` (4 actions), `/arcanon:rescan` (single-repo) |
| 119 | SHADOW-01..04 | **Added** — `/arcanon:shadow-scan`, `/arcanon:diff --shadow`, `/arcanon:promote-shadow` (atomic backup + swap) |
| 120 | INT-01..05 | **Added** — `hub.evidence_mode` config, `/arcanon:sync --offline`, `/arcanon:drift openapi --spec`, `data/known-externals.yaml`. **Changed** — hub payload schema bumped to 1.2 (back-compat). |
| 121 | INT-06..10 | **Added** — known-externals catalog matcher, `external_labels` user extension, labeled actor names in `/arcanon:list` + graph UI |
| 122 | VER-01..07 | (no entries — verification phase) |

**Result block (template — actual narrative re-derived from each phase's SUMMARY):**

```markdown
## [Unreleased]

## [0.1.4] - YYYY-MM-DD

### Added

- **`/arcanon:list` command** (NAV-01). Concise project overview ...
- **`/arcanon:view` command** (NAV-02). Top-level alias for `/arcanon:map view` ...
- **`/arcanon:doctor` command** (NAV-03). 8 smoke-test diagnostics ...
- **`/arcanon:diff <scanA> <scanB>` command** (NAV-04). Compare two scan_versions ...
- **`## Help` sections + `--help` flag** (HELP-01..04). Every command supports `--help` ...
- **`/api/scan-freshness` endpoint** (FRESH-03). Returns ...
- **`/arcanon:status` freshness line** (FRESH-01, 02, 04). New "N repos have new commits" line ...
- **`scan_overrides` table** (CORRECT-01..03). Migration 017 + apply hook ...
- **`/arcanon:correct` command** (CORRECT-02, 04..07). 4 actions: delete, update, rename, set-base-path ...
- **`/arcanon:rescan` command** (CORRECT-04, 05). Single-repo re-scan ...
- **`/arcanon:shadow-scan`** (SHADOW-01). Writes to `impact-map-shadow.db` ...
- **`/arcanon:diff --shadow`** (SHADOW-02). Compares shadow vs live ...
- **`/arcanon:promote-shadow`** (SHADOW-03). Atomic backup + swap ...
- **`hub.evidence_mode` config** (INT-01, 03). full | hash-only | none ...
- **`/arcanon:sync --offline`** (INT-02). Intentional-offline exit-clean ...
- **`/arcanon:drift openapi --spec <path>`** (INT-04). Bypass discovery, repeatable ...
- **`data/known-externals.yaml` catalog** (INT-05). ~20 common third parties shipped ...
- **External label matching** (INT-06..08). Catalog match + user `external_labels` extension + UI surfacing ...

### Changed

- **`/arcanon:status` output extension** (FRESH-01, 02). New freshness line ...
- **Hub payload schema bumped to 1.2** (INT-01, 03). Back-compat: v1.0/v1.1 receivers see byte-identical `evidence` for `evidence_mode: "full"` (default) ...

### Fixed

- (Any bug discovered during 114-121 implementation work — likely empty for v0.1.4 unless a regression was caught and fixed mid-milestone.)

### Removed

- (None planned for v0.1.4 — additive milestone. If a phase removed something, list here.)

### BREAKING

- (None planned — `scan_overrides` is additive; hub payload 1.2 is backward-compatible per Phase 120 plan-phase pre-flight.)
```

**Subsections actually present in the final block depend on what the Phase 114-121 SUMMARYs report.** The plan's Task 5 (CHANGELOG pin) MUST:
1. Read the current `## [Unreleased]` block contents.
2. Re-organize into `## [0.1.4] - <date>` with BREAKING / Added / Changed / Fixed / Removed in Keep-a-Changelog order.
3. Drop empty subsections (don't ship "### Removed" with no bullets).
4. Replace `## [Unreleased]` with a fresh empty heading at top.
5. Reference REQ IDs in each bullet (e.g., `**(NAV-01)**`).

**Verification (mirrors 113 Task 5):**
```bash
TODAY=$(date -u +%Y-%m-%d)
grep -q "^## \[0.1.4\] - $TODAY$" plugins/arcanon/CHANGELOG.md
[ "$(awk '/^## \[0\.1\.4\]/,/^## \[0\.1\.3\]/' plugins/arcanon/CHANGELOG.md | grep -cE '^### ')" -ge 1 ]
grep -q "^## \[Unreleased\]$" plugins/arcanon/CHANGELOG.md
```

---

## 8. ROADMAP "7 vs 8 doctor checks" reconciliation

**Drift identified during Phase 114 plan-phase (per orchestrator brief):** ROADMAP.md:241 prose says:

> `/arcanon:doctor` runs 7 diagnostic checks (worker reachability, version match, schema-version match against migration head 16, config + linked-repo resolution, data-dir perms, DB integrity via `PRAGMA quick_check`, MCP smoke via `tools/list`, hub credential check)

That's **8 checks listed in prose, prefixed with "7"**. The list is correct (8 items); only the cardinal number is wrong.

**REQUIREMENTS.md:33 says "7" too** but lists 8 items (numbered 1-8) — so the canonical truth IS 8 (the list, not the prefix).

**Phase 114-03 SUMMARY (already shipped):** built 8 checks per the list, not 7.

**Fix (Plan 122-02 Task 6 — one-line edit):**

```bash
# ROADMAP.md:241
sed -i.bak 's|`/arcanon:doctor` runs 7 diagnostic checks|`/arcanon:doctor` runs 8 diagnostic checks|' \
  /Users/ravichillerega/sources/ligamen/.planning/ROADMAP.md
rm /Users/ravichillerega/sources/ligamen/.planning/ROADMAP.md.bak
```

Or use the `Edit` tool — that's only one occurrence. The `7` → `8` change is the entire fix; the prose list of 8 items is already correct.

**Also fix REQUIREMENTS.md:33** (`7 smoke-test diagnostics` → `8 smoke-test diagnostics`) — same one-line edit, since the list below has 8 numbered items.

---

## 9. Plan structure recommendation

Per orchestrator brief, **2 plans**:

**Plan 122-01 — Verify (run-everything-and-prove-it-passes):**
- Task 1: Run regression greps (4 sub-greps from §5)
- Task 2: Run bats suite (`IMPACT_HOOK_LATENCY_THRESHOLD=200 bats tests/`)
- Task 3: Run node test suite (`cd plugins/arcanon && npm test`)
- Task 4: Verify all commands have `## Help` and `--help` returns non-empty + exit 0 (VER-03)
- Task 5: Fresh-install Node 25 smoke (Pattern A or Pattern B per §6)

**Plan 122-02 — Pin (commit the version):**
- Task 1: Bump 4 manifest files to 0.1.4 + regenerate package-lock.json (VER-06)
- Task 2: Pin CHANGELOG `[0.1.4] - <date>` section (collapse `[Unreleased]` per §7) (VER-07)
- Task 3: One-line ROADMAP + REQUIREMENTS prose fix `7 → 8` doctor checks (§8)
- Task 4: Write `122-VERIFICATION.md` report (mirrors 113-VERIFICATION.md exactly)

**Wave / dependency:** Plan 122-02 depends on Plan 122-01 — pin half MUST NOT run if verify half fails. Wave 1 (122-01) → Wave 2 (122-02). Both serial, no parallelism.

**Total file output:** 7 files modified
- `plugins/arcanon/.claude-plugin/plugin.json`
- `plugins/arcanon/.claude-plugin/marketplace.json`
- `.claude-plugin/marketplace.json`
- `plugins/arcanon/package.json`
- `plugins/arcanon/package-lock.json` (regenerated)
- `plugins/arcanon/CHANGELOG.md` (Plan 122-02)
- `.planning/ROADMAP.md` (one-line `7 → 8` fix in Plan 122-02)
- `.planning/REQUIREMENTS.md` (one-line `7 → 8` fix in Plan 122-02)
- `.planning/phases/122-verification-gate-release-pin/122-VERIFICATION.md` (new — Plan 122-02)

---

## 10. Open questions / answered open questions

| Q | A |
|---|---|
| Q1: Are there pre-existing `--help` strings in commands/ outside `## Help` sections that 122 must whitelist? | A: One — `commands/update.md:21`'s `claude plugin update --help` (host-CLI reference, HELP-03 explicit exception per REQUIREMENTS.md:61). Grep allows it. |
| Q2: Does Phase 116 introduce any new manifest files? | A: No. v0.1.4 ships zero new manifest files. The 4-file / 6-string manifest count is identical to v0.1.3. |
| Q3: Is HOK-06 macOS latency caveat still relevant for v0.1.4? | A: Yes — same BSD fork overhead, same threshold pattern. v0.1.3 ran at threshold=200 without hitting it. v0.1.4 should run identically; if it triggers, document with same wording as 113-VERIFICATION.md:63-70. |
| Q4: Does the `npm install --package-lock-only` regen require any flags for Node 25? | A: No — flag is the same on Node 18/20/22/25. Verified against `a9ca133` v0.1.3 commit (Node 22 then). |
| Q5: Will the `/arcanon:doctor` check 8 (hub credentials) FAIL in the fresh-install smoke if no creds are configured? | A: It returns SKIP (per Phase 114-03 implementation) when no creds exist. SKIP is acceptable — only a hard FAIL with creds present-but-invalid would block VER-05. |
| Q6: Does Phase 122 need to run `/arcanon:list`, `/arcanon:view`, etc. as smoke tests beyond what bats covers? | A: No — bats E2E tests for each new command (Phase 114-19 each ship their own bats files) cover the smoke. Phase 122 just runs the suite. |
| Q7: What if a Phase 114-121 SUMMARY adds a CHANGELOG entry that's not aligned with Keep-a-Changelog (e.g., uses wrong subsection)? | A: Plan 122-02 Task 2 re-organizes regardless. Don't trust the in-progress `[Unreleased]` ordering — re-derive from REQ → subsection mapping in §7. |

---

## 11. Risk register (for plan-checker review)

| Risk | Mitigation |
|------|------------|
| Bats baseline drift between research and execution | Plan 122-01's acceptance bar uses ≥340 floor (current is 351) with margin for bat fixtures changing. Plan must re-count at execution time, not bake in a hard 351 number. |
| `--help` grep produces false-positive on Phase 116's bash detector code | Detector lives in `lib/help.sh`, NOT in `commands/*.md`. Refined grep §5 only scans `commands/*.md` (excluding `## Help` sections). Detector itself is in `lib/help.sh` and is NOT subject to the "no `--help` in commands/" rule. |
| Node 25 fresh-install Pattern A fails because dev machine lacks Node 25 | Pattern B (deferred-to-pre-tag) is the documented fallback per 105/113 precedent. Plan must allow either pattern. |
| `npm install --package-lock-only` accidentally upgrades a transitive dependency | Use `npm install --package-lock-only` (regenerator), NOT `npm install` (installer). The former rewrites the lock without touching node_modules. Verified against `a9ca133`. |
| ROADMAP/REQUIREMENTS `7 → 8` edit conflicts with concurrent Phase 114-121 summary commits | One-line edit at known location (ROADMAP.md:241, REQUIREMENTS.md:33). Last-write-wins is fine; if a conflict occurs, re-apply the `7 → 8` change after rebase. |
| CHANGELOG collapse loses an entry that a Phase 114-121 plan added but the SUMMARY didn't document | Plan 122-02 Task 2 reads the actual `## [Unreleased]` content as the source of truth — re-organizes verbatim into `[0.1.4]`. If a phase forgot to append, it's caught at this gate (the bullet is missing from `[Unreleased]` and the verifier notices). |

---

*Research complete. Phase is process-only — no new code, no new schema, no new design surface. Two plans recommended (verify + pin); both serial.*
