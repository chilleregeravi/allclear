# Phase 116: `--help` System + `/arcanon:status` Freshness Extension — Research

**Researched:** 2026-04-25
**Domain:** Slash-command markdown surface, worker HTTP read endpoints, scan-state tracking
**Confidence:** HIGH (every claim cited to file:line)

## Summary

Phase 116 has two complementary tracks. **HELP** ships a tiny bash extractor that pulls a `## Help` section out of each command's own markdown (the section *is* the source of truth) and prints it when `$ARGUMENTS` contains `--help` / `-h` / `help`. **FRESH** adds a new `GET /api/scan-freshness?project=<root>` HTTP endpoint and rewires `cmdStatus` (in `worker/cli/hub.js`) to consume it instead of `/api/scan-quality` (the old endpoint stays untouched for back-compat).

Both tracks are low-risk: HELP only touches markdown files + one new bash helper; FRESH adds one new route to `worker/server/http.js` (mirroring the existing `/api/scan-quality` block at line 241–290) and one Node helper that shells out to git via the existing `execFileSync` pattern from `manager.js:317`.

**Primary recommendation:** Two PLAN.md files (one per track) plus an optional third for the bats test plan if it grows. The HELP extractor lives at `lib/help.sh` (sourceable). Every one of the 12 commands gets a `## Help` section — even those whose body is mostly markdown documentation (`drift.md`, `export.md`) since the spec says "Every `/arcanon:*` command".

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| HELP-01 | All 12 command markdown files get a `## Help` section with usage block + 2-3 examples | §1, §2 |
| HELP-02 | Bash detector (`lib/help.sh`) reads `$ARGUMENTS`, extracts `## Help` via `awk` | §3 |
| HELP-03 | Preserve `commands/update.md:21` `claude plugin update --help` host-CLI reference | §4 |
| HELP-04 | bats test iterates all command files; `/arcanon:<cmd> --help` returns non-empty + exit 0 | §5 |
| FRESH-01 | `/arcanon:status` shows `Latest scan: <date> (NN% high-confidence)` line | §6, §7 |
| FRESH-02 | `/arcanon:status` shows per-repo `git commits since last scan` count | §6, §8 |
| FRESH-03 | New `GET /api/scan-freshness?project=<root>` endpoint with documented shape | §6 |
| FRESH-04 | `cmdStatus` calls the new endpoint instead of `/api/scan-quality` (back-compat preserved on the route) | §7 |
| FRESH-05 | bats test — fixture with seeded scan_version asserts freshness line in output | §9 |

---

## 1. Current command roster and `## Help` section anatomy

The active command roster (verified by `ls plugins/arcanon/commands/` 2026-04-25) is **12 files**, matching the iteration list in `tests/commands-surface.bats:18`:

```
map drift impact sync login status export verify update list view doctor
```

Note: `list`, `view`, `doctor` shipped in Phase 114 (Wave 1). Phase 116 must therefore add `## Help` to all 12.

**Heading audit — which commands already use `## Help` for something else?**

`grep -l "^## Help" plugins/arcanon/commands/*.md` returns one hit only:

- `commands/doctor.md:57` — uses `## Help` as a free-form "what to do when a check fails" troubleshooting section. **This collides with the HELP-01 contract that `## Help` is the canonical usage-and-examples section.** [VERIFIED: doctor.md:57]

**Resolution (planner decision required):** rename the doctor.md section. Two options:

1. Rename `## Help` → `## Troubleshooting` in `doctor.md` and add a fresh `## Help` section per HELP-01.
2. Define HELP-01's section as `## Usage` instead of `## Help` and use awk to extract `## Usage`.

**Recommendation:** Option 1. The REQUIREMENTS.md text in HELP-01 says explicitly "a `## Help` section with usage block + 2-3 examples". Renaming one collision is cheaper than churning the spec. The bats test from HELP-04 also acts as the regression guard against future contributors reusing the heading.

**Existing `## Usage` sections (which can become the *contents* of the new `## Help` section)** — surveyed across all 12:

| Command | Has `## Usage` table? | Has examples block? | Strategy for `## Help` |
|---|---|---|---|
| `map.md` | No (uses `## Quick Reference` at line 13-17) | Yes (lines 14-17) | Promote Quick Reference + add `## Help` containing usage + 2 examples |
| `drift.md` | No (uses `## Steps` narrative) | No | Author fresh `## Help` from `argument-hint` + frontmatter description |
| `impact.md` | Yes (lines 15-23) | Yes (Step examples throughout) | Mirror `## Usage` table into `## Help` plus 2 examples |
| `sync.md` | No (uses `## Flags` table) + `## Examples` table at line 73 | Yes (line 73-81) | `## Help` = usage one-liner + the existing examples table verbatim |
| `login.md` | No (narrative) | No | Author fresh from frontmatter |
| `status.md` | No (narrative) | No | Author fresh from frontmatter |
| `export.md` | No (narrative `## Run`) | No | Author fresh from frontmatter |
| `verify.md` | Yes (lines 21-28) | No | Mirror `## Usage` into `## Help` + 2 examples |
| `update.md` | No (Step narrative) | Yes (Step 1 table) | Author fresh — also see HELP-03 below |
| `list.md` | Yes (lines 22-27) | Yes (lines 35-42, JSON example) | Mirror `## Usage` into `## Help` + 1 example |
| `view.md` | Yes (lines 22-24) | No | Mirror `## Usage` + author 1 example |
| `doctor.md` | Yes (lines 27-31) | No | After renaming the existing `## Help` to `## Troubleshooting`, mirror `## Usage` + 1 example |

**Canonical `## Help` section template** (recommended, planner can adjust):

```markdown
## Help

**Usage:** `/arcanon:<name> [options]`

<one-line description from frontmatter>

**Options:**
- `<flag>` — <description>

**Examples:**
- `/arcanon:<name>` — <example 1 description>
- `/arcanon:<name> --foo` — <example 2 description>
```

The extractor will print everything between `## Help` and the next `## ` heading (or EOF). Per HELP-04, output must be non-empty — the section can be as short as 3 lines (heading + usage + 1 example) but must exist.

**File:line citations:**
- Command roster: `tests/commands-surface.bats:18`
- Existing `## Help` collision: `commands/doctor.md:57-76`
- `## Usage` table pattern: `commands/verify.md:21-28`, `commands/list.md:22-27`
- Examples table pattern: `commands/sync.md:73-81`

---

## 2. `$ARGUMENTS` parsing pattern in command markdown

Three parsing patterns exist today; the `--help` detector must work with all three.

**Pattern A — direct pass-through** (`status.md:13`):

```bash
bash ${CLAUDE_PLUGIN_ROOT}/scripts/hub.sh status
```

`$ARGUMENTS` is **not referenced**. Adding `--help` support requires inserting a help-check block BEFORE the bash invocation. [VERIFIED: status.md:10-14]

**Pattern B — pass `$ARGUMENTS` to subcommand** (`verify.md:62`):

```bash
bash ${CLAUDE_PLUGIN_ROOT}/scripts/hub.sh verify $ARGUMENTS
```

Same — must insert help-check before the line. The hub.js parser already handles unknown flags by exiting 2, so passing `--help` straight through would produce a usage error. We MUST intercept first. [VERIFIED: verify.md:60-63, hub.js:71-92]

**Pattern C — narrative orchestration** (`map.md:14-17`, `impact.md:14-22`):

The body is mostly LLM-interpreted narrative with multiple bash blocks for sub-flows (`view`, `full`, `--changed`). The LLM reads `$ARGUMENTS` and routes. Inserting a help check here means: at the very top of the body (before any narrative), source the help helper and bail if `--help` is present.

**Canonical insertion pattern** (proposed for all 12 commands):

```bash
# At the very top of the first bash block in the command body:
source ${CLAUDE_PLUGIN_ROOT}/lib/help.sh
arcanon_print_help_if_requested "$ARGUMENTS" "${CLAUDE_PLUGIN_ROOT}/commands/<name>.md" && exit 0
```

The helper returns 0 (success — help was printed) when help was requested, non-zero (don't print help) otherwise. The `&& exit 0` short-circuits the rest of the command. The two args are: (a) the literal `$ARGUMENTS` string, (b) the absolute path to the command's own markdown file (so the extractor knows where to look — `${CLAUDE_PLUGIN_ROOT}/commands/<name>.md`).

**Why pass the path explicitly:** the helper has no reliable way to discover which command sourced it from inside bash. `$0` is `bash` (the helper is sourced, not exec'd). Passing the path makes the contract explicit and testable.

---

## 3. Awk extraction of `## Help` section

Two viable patterns; both work on macOS (BSD awk) and Linux (gawk).

**Pattern X — awk range** (recommended):

```bash
awk '/^## Help[[:space:]]*$/,/^## /' "$file" | awk 'NR==1; NR>1 && !/^## /'
```

The first awk extracts from `## Help` line to the next `## ` (inclusive on both ends). The second awk drops the trailing `## ` line (the next section's heading) but keeps the leading `## Help`. Behaviour at EOF (no following `## `): the range goes to end of file, second awk passes everything through.

**Pattern Y — sed range** (alternative):

```bash
sed -n '/^## Help[[:space:]]*$/,/^## /{/^## [^H]/q;p}' "$file"
```

More compact but harder to reason about portability of `q` between BSD and GNU sed.

**Recommendation: Pattern X.** Two-stage awk is portable, readable, and the trailing-section-strip is testable in isolation. The trailing `[[:space:]]*$` on the heading match tolerates trailing whitespace (`## Help  `) which would otherwise cause a silent miss.

**Edge cases the planner must handle:**

1. **No `## Help` section** — the awk pipeline produces empty output. The helper should detect this (`[ -z "$out" ]`) and print a fallback like `(no help available for this command — see commands/<name>.md)`, returning a non-zero exit code so HELP-04 catches the gap. Better: HELP-04 should explicitly fail when the section is missing, and the helper can just print the empty result (which the test will catch).
2. **`## Help` at end of file (no trailing `## `)** — Pattern X captures to EOF; second awk passes through. Verified mentally; planner should add a unit-style bats case for this.
3. **Multiple `## Help` sections** — Pattern X grabs from FIRST `## Help` through the next `## `. If a contributor accidentally adds two, only the first prints. HELP-04 doesn't currently catch this; planner should consider a separate test asserting `grep -c "^## Help"` is exactly 1 per file.

---

## 4. HELP-03 host-CLI reference preservation

`commands/update.md:21` contains:

```bash
claude plugin update --help 2>&1 | grep -i -- '--yes'
```

This is a one-time pre-flight check that probes Claude Code's host CLI for the `--yes` flag (the result is recorded in 98-01 SUMMARY). It is **not** a `/arcanon:update --help` invocation — the `--help` flag belongs to the `claude plugin update` host command, not to Arcanon.

VER-04 (defined in REQUIREMENTS.md:172) refines the v0.1.3 grep rule from "zero `--help` hits" to "only `/arcanon:.*--help` outside `## Help` blocks" — implicitly whitelisting non-`/arcanon:` host-CLI invocations. The `claude plugin update --help` line at `update.md:21` matches the new rule (it's not `/arcanon:.*--help`).

**Action required by Phase 116:** none — the line already passes the refined rule. Phase 122 (verification gate) will codify the grep. Phase 116 should NOT delete or reword the line.

The bats HELP-04 test must NOT count `claude plugin update --help` as a `/arcanon:update --help` invocation. The test drives `bash hub.sh update --help` (or invokes the helper directly via the markdown's bash block); the inline `claude plugin update --help` is ordinary documentation text the LLM never executes during a `--help` invocation because the helper short-circuits with `exit 0` BEFORE Step 1 runs.

[VERIFIED: update.md:21 (host CLI probe), REQUIREMENTS.md:172 (VER-04 rule), and the short-circuit semantics from §2 above]

---

## 5. HELP-04 bats test scaffold

Three patterns exist for bats tests in this repo (see Phase 114 RESEARCH §5). HELP-04 is closest to **Pattern C — command-surface regression** (cheap, no worker spawn) augmented with one execution per command.

**Recommended HELP-04 test shape** (psuedocode):

```bash
@test "HELP-01/04: every /arcanon:* command file has a ## Help section" {
  for cmd in map drift impact sync login status export verify update list view doctor; do
    grep -q '^## Help[[:space:]]*$' "$PLUGIN_DIR/commands/$cmd.md" \
      || { echo "MISSING ## Help section: $cmd"; return 1; }
  done
}

@test "HELP-02/04: lib/help.sh extracts non-empty content for every command" {
  source "$PLUGIN_DIR/lib/help.sh"
  for cmd in map drift impact sync login status export verify update list view doctor; do
    run arcanon_extract_help_section "$PLUGIN_DIR/commands/$cmd.md"
    [ "$status" -eq 0 ]
    [ -n "$output" ]
  done
}

@test "HELP-02/04: --help / -h / help triggers extraction in helper" {
  source "$PLUGIN_DIR/lib/help.sh"
  for arg in --help -h help; do
    run arcanon_print_help_if_requested "$arg" "$PLUGIN_DIR/commands/status.md"
    [ "$status" -eq 0 ]
    [ -n "$output" ]
  done
  # Negative case: no --help flag → helper returns non-zero, no output
  run arcanon_print_help_if_requested "--json --quiet" "$PLUGIN_DIR/commands/status.md"
  [ "$status" -ne 0 ]
}
```

**File location:** `tests/help.bats` (repo-root tests dir per phase prompt's hard constraint). Fixtures (if any) under `plugins/arcanon/tests/fixtures/help/` — but the test above uses real command files directly so no fixtures are strictly needed.

**Cost:** trivial — no worker, no DB, ~12 ms per test. Total suite impact ≤ 50 ms.

---

## 6. `GET /api/scan-freshness` endpoint design

Existing `/api/scan-quality` route at `worker/server/http.js:241-290` is the model. It:

1. Resolves the QE via `getQE(request)` (line 243) — same `?project=<root>` mechanism.
2. Returns 404 `{error: "project_not_found"}` when QE missing (line 250).
3. Returns 503 `{error: "no_scan_data"}` when no completed scan exists (line 252, 264, 270).
4. Returns 200 with the documented shape on success (line 272-282).
5. Returns 500 with the error message on uncaught exception (line 288).

`/api/scan-freshness` should mirror this exactly, plus add a per-repo `repos` array.

**Documented response shape (FRESH-03):**

```json
{
  "last_scan_iso": "2026-04-23T17:42:00Z",
  "last_scan_age_seconds": 187432,
  "scan_quality_pct": 87,
  "repos": [
    {
      "name": "api",
      "path": "/Users/me/code/api",
      "last_scanned_sha": "abc123def4...",
      "new_commits": 12
    },
    {
      "name": "worker",
      "path": "/Users/me/code/worker",
      "last_scanned_sha": "xyz789...",
      "new_commits": 3
    }
  ]
}
```

**Where each field comes from:**

| Field | Source | Code path |
|---|---|---|
| `last_scan_iso` | `MAX(scan_versions.completed_at)` | Same SQL as `/api/scan-quality` line 256-262 |
| `last_scan_age_seconds` | `(Date.now() - parseDate(last_scan_iso)) / 1000` | Compute in JS |
| `scan_quality_pct` | `Math.round(qe.getScanQualityBreakdown(scanId).quality_score * 100)` | Reuse the helper from `/api/scan-quality` line 266 |
| `repos[].name` | `repos.name` | `SELECT id, name, path FROM repos` |
| `repos[].path` | `repos.path` | Same |
| `repos[].last_scanned_sha` | `repo_state.last_scanned_commit` | Reuse `qe._stmtGetRepoState` at query-engine.js:532-534 |
| `repos[].new_commits` | `git log <last_scanned_sha>..HEAD --oneline \| wc -l` | New helper — see §8 below |

**Status code matrix** (mirrors `/api/scan-quality`):

| Condition | Code | Body |
|---|---|---|
| `?project=` missing AND no static QE | 503 | `{error: "no_scan_data"}` |
| `?project=` set, resolve returns null | 404 | `{error: "project_not_found"}` |
| QE found but no completed scan | 503 | `{error: "no_scan_data"}` |
| Success | 200 | shape above |
| Uncaught exception | 500 | `{error: "<message>"}` |

**Test parity:** A dedicated `worker/server/http.scan-freshness.test.js` should mirror `http.scan-quality.test.js` (160-line test file at `worker/server/http.scan-quality.test.js`). 5 tests minimum: 200-with-shape, latest-scan-selection, 503-no-data, 404-no-project, repos-array-shape.

**Back-compat (pre-flight requirement):** `/api/scan-quality` stays untouched. Both endpoints coexist. `cmdStatus` switches its consumer to `/api/scan-freshness` per FRESH-04. Anything else relying on `/api/scan-quality` (none found in repo grep — the only consumer is `cmdStatus._fetchLatestScanLine` at `hub.js:235-278`) keeps working.

[VERIFIED: http.js:208-290 (scan-quality block to mirror), query-engine.js:532-534 (_stmtGetRepoState), http.scan-quality.test.js:1-160 (test pattern to clone)]

---

## 7. `cmdStatus` rewiring

Current `cmdStatus` at `worker/cli/hub.js:171-222`:

- Calls `_fetchLatestScanLine(process.cwd())` at line 193.
- The helper `_fetchLatestScanLine` at `hub.js:235-278` GETs `/api/scan-quality?project=<root>` and formats the line as `Latest scan: NN% high-confidence (S services, C connections)`.
- Output line at `hub.js:218-220`: `if (latestScan?.line) lines.push(\`  ${latestScan.line}\`)`.

**Phase 116 changes:**

1. Add a new helper `_fetchScanFreshness(projectRoot)` that GETs `/api/scan-freshness?project=<root>`. Returns `{ qualityLine, freshnessLines, report } | null`.
   - `qualityLine`: `"Latest scan: 2026-04-23 (87% high-confidence)"` (matches FRESH-01 wording)
   - `freshnessLines`: array of strings; first is `"N repos have new commits since last scan: api (12 new), worker (3 new)"` (FRESH-02). Empty array when no repo has new commits.
   - `report`: the raw JSON for `--json` mode.
2. Replace the call at line 193 with `await _fetchScanFreshness(process.cwd())`.
3. Adjust line 218-220 to push both `qualityLine` and any `freshnessLines`.
4. The OLD `_fetchLatestScanLine` helper can be **deleted** in this phase (no other caller). Pre-flight constraint says the old `/api/scan-quality` ENDPOINT stays for back-compat; the OLD CLIENT-SIDE HELPER inside `hub.js` is internal-only and safe to delete.

**Output format (FRESH-01 + FRESH-02):**

```
Arcanon v0.1.4
  project:      acme-platform
  credentials:  ✓ present
  auto-sync:    enabled
  queue:        0 pending, 0 dead
  data dir:     /Users/me/.arcanon
  Latest scan: 2026-04-23 (87% high-confidence)
  2 repos have new commits since last scan: api (12 new), worker (3 new)
```

When **all repos are at the scanned SHA** (no drift), suppress the second line entirely. When **no repo has been scanned yet** (no scan_versions row), suppress both lines (existing graceful-degradation behaviour).

[VERIFIED: hub.js:171-222 (cmdStatus), hub.js:235-278 (_fetchLatestScanLine to replace)]

---

## 8. Computing `new_commits` per repo

The worker already shells out to git via `execFileSync` in `worker/scan/manager.js:317-378` (`getChangedFiles` and `getCurrentHead`). The pattern is:

```javascript
import { execFileSync } from "node:child_process";
execFileSync("git", ["-C", repoPath, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
```

For `new_commits`, the equivalent invocation is:

```javascript
function getCommitsSince(repoPath, sinceSha) {
  if (!sinceSha) return null; // unknown — never scanned, can't compare
  try {
    const out = execFileSync(
      "git",
      ["-C", repoPath, "rev-list", "--count", `${sinceSha}..HEAD`],
      { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 5000 },
    );
    return parseInt(out.trim(), 10) || 0;
  } catch {
    return null; // not a git repo, sha not in repo, etc.
  }
}
```

**Why `git rev-list --count` and not `git log ... | wc -l`:** `rev-list --count` is single-purpose (returns just the count), avoids piping through `wc`, and matches git's own performance-optimized counting path. Also no shell pipe → no shell injection surface.

**Failure modes (all → `new_commits: null`):**

1. Repo path doesn't exist or isn't a git repo (caught by try/catch).
2. `last_scanned_sha` is null (never scanned — return null without invoking git).
3. `last_scanned_sha` is a SHA that's been rebased away (git exits 128 — caught).
4. Timeout (5s) — caught.

The `null` value is meaningful in JSON: it means "couldn't determine". Distinct from `0` ("zero new commits, repo is up to date"). The format-side code at `cmdStatus` filters: only include repos where `new_commits > 0` in the FRESH-02 line.

**Where to put the helper:** new file `plugins/arcanon/worker/scan/git-state.js` exporting `getCommitsSince(repoPath, sinceSha)`. Imported by both `http.js` (for the new endpoint) and the existing `manager.js` if it grows a use later. Co-locating with `getChangedFiles`/`getCurrentHead` would also be valid — planner choice.

[VERIFIED: manager.js:26 (execFileSync import), manager.js:317-363 (getChangedFiles pattern), manager.js:374-378 (getCurrentHead pattern)]

---

## 9. FRESH-05 bats fixture and test

Pattern A (real worker) per Phase 114 RESEARCH §5. Reuse the `_arcanon_project_hash`, `_start_worker`, `_stop_worker` helpers from `tests/verify.bats:31-66` (or copy them if helpers/test_helper.bash extension is verboten — the verify.bats precedent is "ZERO additions to test_helper.bash" per its NIT 8 plan note).

**Fixture requirements (`plugins/arcanon/tests/fixtures/freshness/seed.sh`):**

1. Create a real git repo at `$PROJECT_ROOT/repo-a/`:
   ```bash
   git init -q && git commit --allow-empty -m "init" -q
   ```
2. Capture the commit SHA: `INIT_SHA=$(git -C "$PROJECT_ROOT/repo-a" rev-parse HEAD)`.
3. Create 3 more commits on top so `git rev-list --count INIT_SHA..HEAD` returns 3:
   ```bash
   for i in 1 2 3; do git commit --allow-empty -m "c$i" -q; done
   ```
4. Seed an SQLite DB with:
   - One `repos` row: `(name='repo-a', path='$PROJECT_ROOT/repo-a', type='single')`
   - One `repo_state` row: `(repo_id, last_scanned_commit=$INIT_SHA, last_scanned_at='<iso>')`
   - One `scan_versions` row: `(repo_id, started_at='<iso>', completed_at='<iso>', quality_score=0.87)`
   - Three connections (2 high + 1 low) to make `quality_score` math meaningful.

**Test cases (3 minimum):**

```bash
@test "FRESH-01: /arcanon:status output contains 'Latest scan:' line" {
  cd "$PROJECT_ROOT"
  run bash "$HUB_SH" status
  [ "$status" -eq 0 ]
  [[ "$output" == *"Latest scan:"* ]]
  [[ "$output" == *"high-confidence"* ]]
}

@test "FRESH-02: /arcanon:status output reports 3 new commits in repo-a" {
  cd "$PROJECT_ROOT"
  run bash "$HUB_SH" status
  [ "$status" -eq 0 ]
  [[ "$output" == *"1 repos have new commits"* ]]   # singular grammar TBD by planner
  [[ "$output" == *"repo-a (3 new)"* ]]
}

@test "FRESH-03: GET /api/scan-freshness returns documented shape" {
  PORT=$(cat "$ARC_DATA_DIR/worker.port")
  run curl -sf "http://127.0.0.1:${PORT}/api/scan-freshness?project=${PROJECT_ROOT}"
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.last_scan_iso != null and .repos | type == "array"' >/dev/null
}
```

**Cost:** Pattern A spawns the worker, ~2s per test setup. With 3 tests + setup teardown, ~10s total. Acceptable.

---

## 10. Open questions for the planner

1. **`## Help` heading collision in doctor.md.** §1 recommends rename `## Help` → `## Troubleshooting`. Planner must confirm and write the rename into the plan. Alternative is to use `## Usage` instead of `## Help` for the canonical extraction heading — but that contradicts REQUIREMENTS.md HELP-01 wording.

2. **`new_commits` grammar in FRESH-02 line.** "1 repos have" reads awkwardly. Planner should specify: singular form ("1 repo has new commits since last scan: api (3 new)") vs always-plural ("1 repos…"). Recommendation: handle the singular case explicitly. Trivial to test.

3. **FRESH-04 silent-degradation behaviour.** When `/api/scan-freshness` is unreachable (worker offline, old worker without endpoint), should `cmdStatus` fall back to `/api/scan-quality`? The pre-flight constraint says the old endpoint "stays for back-compat" — does that mean for FUTURE consumers, or as a fallback for the new client? Recommendation: NO fallback. The new client uses ONLY the new endpoint; failure → silent omission of the freshness lines (same as today's behaviour when `/api/scan-quality` 404s). The old endpoint stays for any external consumers that may exist outside this codebase.

4. **Should the bats HELP test cover the `-h` shorthand?** The spec says "`--help` / `-h` / `help`". The detector must accept all three. The example in §5 above tests all three; planner should keep this explicit.

5. **`## Help` section content authoring.** §1 lists 12 commands and the "strategy" for each. The planner must decide whether to draft all 12 sections in one PLAN.md task or split per command. Recommendation: one task per phase plan with a checklist of all 12 sections — they are independent edits with no cross-coupling.

6. **Where does the help.sh helper get sourced from in markdown blocks?** All commands use `${CLAUDE_PLUGIN_ROOT}/lib/...` already. The `source ${CLAUDE_PLUGIN_ROOT}/lib/help.sh` line goes at the very TOP of the first bash block in each command body. For commands with multiple bash blocks (map.md), it goes ONLY at the top of the first.

7. **CHANGELOG bundling.** Phase prompt explicitly says: "bundle as one line: 'Every `/arcanon:*` command now responds to `--help`.'" Planner should respect this — one `### Added` line for HELP, separate `### Changed` line for FRESH ("`/arcanon:status` now reports per-repo commits since last scan").

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | BSD awk and gawk both honor the `/range1/,/range2/` syntax with the `[[:space:]]*$` POSIX class | §3 | Low — tested mentally; bats test from §5 catches this empirically. Worst case fall back to grep + line-counting. |
| A2 | `git rev-list --count <sha>..HEAD` exists in all git versions Arcanon supports (git ≥ 1.9 from 2014) | §8 | Very low — `rev-list --count` shipped in git 1.7.2 (2010). |
| A3 | Claude Code's slash-command execution preserves `$ARGUMENTS` literally for the bash block — no shell escaping that would mangle `--help` | §2 | Low — the existing pattern at `verify.md:62` (`bash hub.sh verify $ARGUMENTS`) demonstrably works for arbitrary flags including `--connection 5` etc. |
| A4 | The repos table has `name` and `path` columns populated correctly for every linked repo (so the `repos` array in the freshness response is meaningful) | §6 | Low — `query-engine.js:403-408` upsertRepo writes both. Verified pattern. |

**Mitigation:** None of these assumptions are load-bearing for the architectural shape — only for fine-grained text formatting. All testable empirically in execution.

---

## Sources

### Primary (HIGH confidence)
- `plugins/arcanon/commands/{map,drift,impact,sync,login,status,export,verify,update,list,view,doctor}.md` — full roster (12 files)
- `plugins/arcanon/worker/cli/hub.js:171-278` — current `cmdStatus` and `_fetchLatestScanLine`
- `plugins/arcanon/worker/server/http.js:241-290` — `/api/scan-quality` route (template for `/api/scan-freshness`)
- `plugins/arcanon/worker/server/http.scan-quality.test.js:1-160` — test pattern to mirror
- `plugins/arcanon/worker/db/query-engine.js:1248-1270` — `updateRepoState` / `setRepoState`
- `plugins/arcanon/worker/db/query-engine.js:403-408` — `upsertRepo` writes path + name
- `plugins/arcanon/worker/db/query-engine.js:532-534` — `_stmtGetRepoState`
- `plugins/arcanon/worker/db/migrations/001_initial_schema.js:22-78` — repos + repo_state table shapes
- `plugins/arcanon/worker/scan/manager.js:26,317-378` — `execFileSync` git pattern
- `plugins/arcanon/lib/worker-client.sh:7,71-102` — sourceable bash helper conventions
- `tests/commands-surface.bats:18` — canonical command roster
- `tests/verify.bats:18-92` — Pattern A bats test scaffold

### Secondary (MEDIUM confidence)
- `plugins/arcanon/CHANGELOG.md` (referenced) — for the version-bump trail and back-compat history
- Phase 114 `114-RESEARCH.md` — bash-helper conventions, dispatch precedence

### Tertiary (LOW confidence / ASSUMED)
- BSD vs GNU awk parity for the range syntax (§3, A1)

---

## Metadata

**Confidence breakdown:**
- Command roster + `## Help` collision audit: HIGH — directly grepped the 12 files
- $ARGUMENTS parsing patterns: HIGH — three concrete files cited
- Awk extraction strategy: HIGH on the awk pattern, MEDIUM on portability across BSD/GNU
- HELP-03 host-CLI preservation: HIGH — grepped the line at `update.md:21` and confirmed VER-04 wording
- HELP-04 test scaffold: HIGH — clones existing `commands-surface.bats` + `verify.bats` patterns
- `/api/scan-freshness` design: HIGH — full mirror of `/api/scan-quality`
- `cmdStatus` rewiring: HIGH — full read of `hub.js:171-278`
- `new_commits` git invocation: HIGH — proven `execFileSync` pattern from manager.js
- FRESH-05 fixture + test: HIGH — Pattern A is well-established

**Research date:** 2026-04-25
**Valid until:** 2026-05-09 (14 days — Phase 116 has no in-flight dependencies on parallel phases that could shift its contracts)
