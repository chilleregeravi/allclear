# Phase 118: scan_overrides Operator Commands — Research

**Researched:** 2026-04-26
**Domain:** Arcanon plugin slash-command surface, scan manager entry points, repo-table lookup, command-arg parsing
**Confidence:** HIGH on the codebase facts (every claim cited to file:line). MEDIUM on the Phase 117 surface — see §6 for explicit assumptions.

## Summary

Phase 118 ships two operator-facing commands that consume the `scan_overrides` infrastructure delivered by Phase 117. Both commands plug into the existing `worker/cli/hub.js` HANDLERS map and the `scripts/hub.sh` shell wrapper — no new dispatch surface, no new HTTP endpoints required.

- `/arcanon:correct` — stages override rows in `scan_overrides` (one row per invocation). Pure DB write, no scan side-effects. Validates target IDs/names and `--action`-specific payload shape against the migration-017 schema.
- `/arcanon:rescan <repo>` — re-scans exactly one repo, bypassing the incremental change-detection skip path. Resolves `<repo>` via `repos.path` first, then `repos.name`, with friendly errors when neither resolves. Updates `scan_versions` for that repo only.

**Primary recommendation:** Add `cmdCorrect` and `cmdRescan` to `worker/cli/hub.js` HANDLERS. Add a small `scanSingleRepo(repoIdOrPath)` helper to `worker/scan/manager.js` that wraps a single-repo invocation of the existing `scanRepos()` with `options.full = true` (forces full scan, bypasses the `mode: 'skip'` short-circuit at `manager.js:654`). `/arcanon:correct` calls a `upsertOverride(...)` query-engine method shipped by Phase 117 (assumed surface — see §6).

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CORRECT-04 | `/arcanon:rescan <repo-path>` — re-scans one repo, bypasses incremental skip | §3 (manager surface), §4 (reuse `scanRepos` with `options.full=true` + single-element array) |
| CORRECT-05 | `/arcanon:rescan` accepts repo path OR `repos.name` | §2 (lookup), §5 (resolution helper) |
| CORRECT-06 | Node tests — migration 017 idempotent, scan_overrides insert/select, override-applied flow, idempotent re-apply | §7 (test split — Phase 117 owns apply tests, 118 owns insert tests) |
| CORRECT-07 | bats tests — `/arcanon:correct connection|service` happy paths for each action; `/arcanon:rescan` happy path; non-existent repo exits 2 | §8 (verify.bats clone is the proven pattern) |

---

## 1. Existing CLI dispatch (HANDLERS map) — current state

`worker/cli/hub.js:1221-1231` (read in full this session):

```javascript
const HANDLERS = {
  version: cmdVersion,
  login: cmdLogin,
  status: cmdStatus,
  upload: cmdUpload,
  sync: cmdSync,
  queue: cmdQueue,
  verify: cmdVerify, // TRUST-01
  list: cmdList,     // NAV-01
  doctor: cmdDoctor, // NAV-03
};
```

Phase 118 adds two entries:

```javascript
correct: cmdCorrect, // CORRECT-04..07
rescan:  cmdRescan,  // CORRECT-04..07
```

**Argument parsing** — `parseArgs(argv)` at `hub.js:102-123` already handles `--flag value`, bare `--flag` boolean, and bare positional args. It returns `{sub, flags, positional}`. This is sufficient for both commands:

- `/arcanon:correct connection --action delete --connection 5` → `sub=correct`, `positional=['connection']`, `flags={action: 'delete', connection: '5'}`.
- `/arcanon:rescan ../api` → `sub=rescan`, `positional=['../api']`, `flags={}`.

**No changes required to `parseArgs` itself.** The only consumer-side wrinkle is that `--connection 5` puts the integer at `flags.connection`, while `--connection` (no value, e.g. typo) would put `flags.connection = true` — both `cmdCorrect` and `cmdVerify` already need to coerce-and-validate (see `cmdVerify` at `hub.js:414-419` for the canonical pattern).

**File:line summary:**
- HANDLERS map: `worker/cli/hub.js:1221-1231`
- parseArgs: `worker/cli/hub.js:102-123`
- emit() with --json toggle: `worker/cli/hub.js:125-131`
- Exit codes: `hub.js:1240` (exit 2 on unknown subcommand), `hub.js:1247` (exit 1 on uncaught throw)
- `cmdVerify --connection N` int validation pattern: `hub.js:414-419`

---

## 2. `repos` table schema (CORRECT-05 lookup surface)

Migration `001_initial_schema.js:22-29`:

```sql
CREATE TABLE IF NOT EXISTS repos (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  path        TEXT    NOT NULL,
  name        TEXT    NOT NULL,
  type        TEXT    NOT NULL,
  last_commit TEXT,
  scanned_at  TEXT
);
```

There is **no UNIQUE constraint on `name`** (migration 006 added unique only on `path`, per its filename `006_dedup_repos.js`). This means a `/arcanon:rescan myname` could match more than one row in pathological cases (e.g., two different absolute paths whose `basename()` is the same). Resolution strategy (§5) handles this by returning a clear error when the lookup is ambiguous.

**Existing query patterns:**
- `query-engine.js:537` — `SELECT id, path, name FROM repos WHERE path = ?`
- `query-engine.js:840` — `SELECT id FROM repos WHERE path = ?` (used by `upsertRepo` to recover the rowid post-INSERT)
- `query-engine.js:923` — `SELECT path FROM repos WHERE id = ?`

There is no `SELECT id FROM repos WHERE name = ?` lookup today. Phase 118 introduces the first consumer; recommend adding a small `_resolveRepo(repoIdentifier)` helper inside `cmdRescan` (not a query-engine method) since it's CLI-specific behavior with friendly-error semantics.

---

## 3. Scan manager entry points (CORRECT-04)

`worker/scan/manager.js` exports (see line 6 header comment, verified against actual exports):

- `getChangedFiles(repoPath, sinceCommit)` — git diff wrapper
- `buildScanContext(repoPath, repoId, qe, opts)` — determines mode (full/incremental/skip)
- `scanRepos(repoPaths, options, queryEngine)` — main entry; loops over repos
- `setAgentRunner(fn)` — agent-injection (test + MCP server use)
- `runDiscoveryPass(repoPath, template, runner, slog)` — Phase 1 discovery
- `setScanLogger(logger)` — logger injection

**Key finding:** `scanRepos` already accepts an array of repo paths. `/arcanon:rescan one/repo` can simply call `scanRepos(['/abs/path/to/one/repo'], {full: true}, queryEngine)` and reuse the entire pipeline (discovery → deep scan → enrichment → optional hub sync).

**Two-line argument: should we add a `scanSingleRepo()` wrapper?**
- *Pro:* gives `/arcanon:rescan` a clean single-purpose entry point with a focused signature; shields callers from `scanRepos`'s array-shape contract; lets the wrapper enforce `options.full = true` invariantly.
- *Con:* one more name in the API surface for what is a one-line composition.

**Recommendation:** add `scanSingleRepo(repoPath, queryEngine, options = {})` to `manager.js` exports as a thin wrapper:

```javascript
export async function scanSingleRepo(repoPath, queryEngine, options = {}) {
  // CORRECT-04: bypass incremental skip — always full-scan a single repo.
  const results = await scanRepos([repoPath], { ...options, full: true }, queryEngine);
  return results[0]; // single ScanResult — caller doesn't need the array shape
}
```

**Rationale for `options.full=true`:** `buildScanContext` at `manager.js:393-414` returns `{mode: 'skip'}` when `repoState.last_scanned_commit === currentHead`. The `options.full=true` branch at line 395 short-circuits this and forces `mode: 'full'`. This is the documented bypass for the incremental-skip path — exactly what CORRECT-04 requires ("bypasses the incremental change-detection skip").

**Important sub-finding (agentRunner injection):** `scanRepos` throws at line 604-606 if `agentRunner === null`. The MCP server already wires this at import time (per the file header comment at `manager.js:11-13`); when `cmdRescan` is invoked from the CLI subprocess, the agentRunner must be set the same way. The existing `cmdUpload` handler does NOT trigger agent invocation, so this is a new concern for Phase 118. Two options:

- **Option A (recommended):** `cmdRescan` POSTs to a new worker HTTP endpoint (e.g., `POST /api/rescan?repo=<path|name>`) and the worker's pre-wired agent runner handles the scan. This matches the existing `/scan` endpoint pattern at `http.js:525-561` (scan persist endpoint). The CLI becomes a thin trigger.
- **Option B:** `cmdRescan` imports and wires its own agent runner. Awkward — duplicates MCP server's bootstrap, and the agent is normally a Claude Task call which only the host has.

**Plan-time decision:** go with Option A — a new worker HTTP endpoint `POST /api/rescan?project=<root>&repo=<identifier>` that resolves the repo and calls `scanSingleRepo`. This mirrors the existing `POST /scan` write path and avoids agent-runner duplication.

**File:line summary:**
- `scanRepos` entry: `manager.js:603`
- `agentRunner === null` throw: `manager.js:604-606`
- `options.full=true` short-circuit: `manager.js:393-396`
- `mode: 'skip'` branch: `manager.js:654-657`
- POST /scan endpoint pattern (model for /api/rescan): `worker/server/http.js:525-561` (cited at 114-RESEARCH.md §3)

---

## 4. Existing argument-parsing patterns for positional + flags

The closest analog to `cmdCorrect`'s `correct connection --action delete --connection 5` shape is `cmdVerify`:

`hub.js:408-426`:

```javascript
async function cmdVerify(flags) {
  const repoPath = path.resolve(flags.repo || process.cwd());
  const params = new URLSearchParams();
  params.set("project", repoPath);
  if (flags.connection !== undefined && flags.connection !== true) {
    const idStr = String(flags.connection);
    if (!/^\d+$/.test(idStr) || Number(idStr) <= 0) {
      console.error("error: --connection requires a positive integer ID");
      process.exit(2);
    }
    params.set("connection_id", idStr);
  } else if (flags.source !== undefined && flags.source !== true) {
    params.set("source_file", String(flags.source));
  }
  // ...
```

This is the canonical pattern: `flags.X !== undefined && flags.X !== true` is the "explicit value provided" check. Reuse verbatim in `cmdCorrect` and `cmdRescan`.

Positional args come in via `parseArgs`'s third return field, but only `sub` and `flags` are passed to handlers today (see `main()` at `hub.js:1233-1248`). **Phase 118 needs to extend `main()` to pass `positional` through to handlers** OR have handlers re-parse `process.argv` themselves. Cleaner: extend `main()`.

**Required change to main():**

```javascript
async function main() {
  const { sub, flags, positional } = parseArgs(process.argv.slice(2));
  // ...
  await handler(flags, positional);
}
```

And update existing handlers' signatures. Most ignore `positional`; only `cmdCorrect` (`positional[0]` = `'connection'|'service'`) and `cmdRescan` (`positional[0]` = repo identifier) actually consume it. This is a backward-compatible change — JavaScript silently ignores extra args.

---

## 5. Repo resolution helper (CORRECT-05)

`/arcanon:rescan` accepts either:
- **Filesystem path** — relative or absolute. Canonicalize via `path.resolve(cwd, arg)`, then look up by `WHERE path = ?`.
- **Repo name** — the value of `repos.name` (which is `basename(repoPath)` at insert time per `manager.js:646`).

**Resolution algorithm (proposed, lives inside `cmdRescan`):**

```javascript
function _resolveRepo(identifier, qe, cwd) {
  // 1. Try absolute path lookup (canonicalize first)
  const absPath = path.resolve(cwd, identifier);
  const byPath = qe._db.prepare("SELECT id, path, name FROM repos WHERE path = ?").get(absPath);
  if (byPath) return byPath;

  // 2. Try name lookup
  const byName = qe._db.prepare("SELECT id, path, name FROM repos WHERE name = ?").all(identifier);
  if (byName.length === 1) return byName[0];
  if (byName.length > 1) {
    throw Object.assign(new Error(
      `repo name "${identifier}" matches ${byName.length} repos: ${byName.map(r => r.path).join(", ")}. ` +
      `Use the absolute path to disambiguate.`
    ), { exitCode: 2 });
  }

  // 3. Not found — friendly error with available repos listed
  const all = qe._db.prepare("SELECT name, path FROM repos ORDER BY name").all();
  const available = all.length === 0
    ? "(no repos in this project — run /arcanon:map first)"
    : all.map(r => `  - ${r.name} (${r.path})`).join("\n");
  throw Object.assign(new Error(
    `repo "${identifier}" not found. Available repos:\n${available}`
  ), { exitCode: 2 });
}
```

**Why exit 2 on not-found:** matches existing convention (`hub.js:1240` returns exit 2 for unknown subcommand → "user error"). Roadmap text for CORRECT-07 explicitly says "rescan on non-existent repo exits 2 with friendly error".

---

## 6. Phase 117 surface assumptions

Phase 117 is being planned in parallel. Phase 118 makes the following assumptions about Phase 117's deliverables. Each is surfaced explicitly in each plan's `<assumptions_about_phase_117>` block:

| # | Assumption | Source / Risk |
|---|-----------|---------------|
| P117-1 | Migration `017_scan_overrides.js` ships the table with columns: `override_id PK AUTOINCREMENT`, `kind TEXT CHECK IN ('connection','service')`, `target_id INTEGER NOT NULL`, `action TEXT CHECK IN ('delete','update','rename','set-base-path')`, `payload TEXT` (JSON), `created_at TEXT`, `applied_in_scan_version_id INTEGER NULLABLE`, `created_by TEXT`. | ROADMAP §Phase 117 + REQUIREMENTS CORRECT-01. Risk: column names or types may shift in 117's discuss-phase; tests in 118 should query by column names defensively (`SELECT * FROM scan_overrides WHERE override_id = ?` then assert keys exist). |
| P117-2 | A `query-engine.js` method `upsertOverride({kind, target_id, action, payload, created_by})` exists and returns the new `override_id`. | Phase 117 plans not yet written — name is best-guess. If 117 names it `insertOverride` or `addOverride`, 118 plans must rename. Mitigation: 118-01-PLAN.md uses the name `upsertOverride` and explicitly notes this assumption in its `<assumptions_about_phase_117>` block. |
| P117-3 | `payload` is a JSON string (TEXT column). Per-action shape (118 picks a shape; 117 may revise): **`delete`** → `null` or `{}`. **`update` (connection)** → `{"source": "<svc-name>", "target": "<svc-name>"}`. **`rename` (service)** → `{"new_name": "<name>"}`. **`set-base-path` (service)** → `{"base_path": "<path>"}`. | REQUIREMENTS CORRECT-01 says "JSON blob with action-specific fields, e.g. `{source, target}` for update". Risk: 117's discuss-phase may rename fields. Mitigation: 118-01 plan locks the field names *as 118 writes them*; if 117 picks different names, the apply hook in 117 must read what 118 wrote OR the two plans coordinate via the discuss-phase output. |
| P117-4 | `applyPendingOverrides(scanVersionId, queryEngine)` is the apply-hook function name, called between `persistFindings` and `endScan` in `scanRepos`. | ROADMAP §Phase 117 PRE-FLIGHT explicitly names this function. HIGH confidence. |
| P117-5 | The `scan_overrides` table is shipped before Phase 118 execution starts (Wave 3 ordering enforces this — both 117 and 118 are Wave 3 but 118's REQs depend on 117's table). | ROADMAP. Phase 118 plans assume 117 ships first. Bats tests for 118 that need the table can run after 117 lands. |
| P117-6 | The `target_id` column refers to: **`kind = 'connection'`** → `connections.id`; **`kind = 'service'`** → `services.id`. NOT a target by name. CORRECT-02 in REQUIREMENTS uses `<id>` for connection and `<name>` for service ("`/arcanon:correct service <name> --action rename`") — so for service overrides, `cmdCorrect` MUST resolve `<name>` to `services.id` before insert. | REQUIREMENTS CORRECT-02. Risk: 117 may pick a different convention (e.g., target_name TEXT). 118 plan picks "always resolve to integer id at insert time" — surfaces this as an explicit assumption. |

---

## 7. Test split between Phase 117 and Phase 118

**Critical hard constraint (from prompt):** "Bats tests can't drive `/arcanon:correct connection --action delete` end-to-end without 117's `applyPendingOverrides` being implementable; structure tests so the override-row insertion is unit-testable independent of 117 (test the row goes IN; let Phase 117's tests verify the row gets APPLIED)."

**Translation into the test matrix:**

| Test layer | Phase 118 owns | Phase 117 owns |
|---|---|---|
| Migration 017 idempotency (CORRECT-06) | — | YES (table is 117's deliverable) |
| `upsertOverride` insert/select round-trip (CORRECT-06) | YES (uses 117's API) | — |
| `applyPendingOverrides` during scan (CORRECT-06) | — | YES |
| Idempotent re-apply (CORRECT-06) | — | YES |
| `/arcanon:correct connection --action delete` row-inserted assertion (CORRECT-07) | YES — assert the row appears in `scan_overrides` after the command runs. Do NOT assert the connection is deleted from the graph (that's 117's apply pass). | — |
| `/arcanon:correct service --action rename --new <name>` row-inserted assertion (CORRECT-07) | YES | — |
| `/arcanon:rescan <path>` happy path (CORRECT-07) | YES — full E2E since rescan does NOT depend on overrides being applied | — |
| `/arcanon:rescan <name>` happy path (CORRECT-07) | YES | — |
| `/arcanon:rescan nonexistent` exits 2 (CORRECT-07) | YES | — |

**Mechanism for "row goes IN" tests without 117's apply hook:** The bats test seeds a project DB with the `scan_overrides` table present (via running migration 017 — which Phase 117 ships). It runs `/arcanon:correct ...`. It then runs a `sqlite3 -line` query against `scan_overrides` to assert the row exists with the expected `kind`, `target_id`, `action`, and `payload` JSON. No scan is invoked, so no apply hook is exercised.

This means Phase 118's bats tests have a soft dependency on Phase 117 having shipped (so migration 017 exists when the bats fixture seeds the DB), but no dependency on the apply hook being correct.

---

## 8. Test patterns (which to use for each command)

Three established patterns documented in 114-RESEARCH.md §5; for Phase 118:

| Command/test | Primary pattern | Justification |
|---|---|---|
| `/arcanon:correct` row-inserted bats E2E | Pattern A (verify.bats clone) | Spawns the worker (needed because `cmdCorrect` runs through `bash hub.sh correct` → `node hub.js correct`), seeds a DB with migration 017 applied, drives the command, asserts on `scan_overrides` row count. |
| `/arcanon:rescan` happy path bats E2E | Pattern A (verify.bats clone) | Needs a real worker (the new `POST /api/rescan` endpoint runs in-process there) and a real DB. |
| `/arcanon:rescan nonexistent` error case | Pattern A | Cheaper to clone the same setup than to construct a separate one. |
| Node test for `_resolveRepo` helper | Plain Node test (in `worker/cli/hub.test.js` or new `cli/correct.test.js`) | Pure function; no worker/HTTP needed. |

**Fixture location:** per the prompt's hard constraint, fixtures go to `plugins/arcanon/tests/fixtures/correct/` and `plugins/arcanon/tests/fixtures/rescan/`. Bats files go to repo-root `tests/`. This matches the verify-fixture convention.

**Fixture seed.sh contract** (cloning the verify pattern at `plugins/arcanon/tests/fixtures/verify/seed.sh`):

```bash
seed.sh <project-root> <db-path>
```

Both correct and rescan fixtures need:
- A `repos` row with a known `path` and `name` (so `/arcanon:rescan` can resolve it).
- For correct fixtures: a couple of `services` rows and a `connections` row, so the override target IDs exist (per assumption P117-6, `target_id` is a real `connections.id` / `services.id`).

---

## 9. Open questions for the planner

1. **`/arcanon:correct service` — accept `<id>` instead of `<name>`?** REQUIREMENTS CORRECT-02 explicitly uses `<name>` ("`/arcanon:correct service <name> --action rename`"). Per assumption P117-6, the override row's `target_id` is an integer. So `cmdCorrect` resolves the service `<name>` to `services.id` before insert. **What if multiple services share a name across repos?** Match `query-engine.js`'s scoped behavior (Phase 65, SVCR-01) — return an error listing the matches. *Plan-time decision: same friendly-error pattern as `_resolveRepo`.*

2. **`/arcanon:rescan` — should it bypass the agent-call entirely if the worker is dead?** Today, `cmdVerify` exits with a friendly "worker not running" message (`hub.js:445-453`). `/arcanon:rescan` should do the same — there's no point trying to start the worker from inside the CLI subprocess (Option A in §3 is HTTP-based, so worker presence is a hard prerequisite). *Plan-time decision: clone the verify worker-down message verbatim.*

3. **`/arcanon:correct` — `--connection 5 --action delete` vs `--connection-id 5 --action delete`?** The roadmap text uses `--connection <id>`. The flag name `--connection` collides visually with the value type ("--connection 5"); `cmdVerify` already uses `--connection <id>`. *Plan-time decision: `--connection <id>` for consistency with `cmdVerify`. Same for `--service <id>`.*

4. **`scan_overrides.created_by` value when invoked from CLI.** REQUIREMENTS says "defaults to `system` or whatever user-tracking we have". Phase 118 has no user-tracking; default to `"cli"` (or `"operator"`). *Plan-time decision: hard-code `"cli"` in 118; let Phase 117 layer in $USER tracking later if it wants.*

5. **`/arcanon:rescan` — does it trigger hub auto-sync?** `scanRepos` already does conditional hub sync at `manager.js:884-946` based on `hub.auto-sync` config. Reusing `scanRepos` means hub sync fires for free if configured. *Plan-time decision: yes, accept this — single-repo rescan should behave identically to a single-repo scan from `/arcanon:map`.*

6. **`--json` output for `/arcanon:correct` and `/arcanon:rescan`.** Both should honor `--json` for consistency with every other `hub.js` command (see `emit()` pattern at `hub.js:125-131`). Trivial; included in plans.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Phase 117's `applyPendingOverrides(scanVersionId, queryEngine)` is the named hook between `persistFindings` and `endScan` | §6 P117-4 | LOW — explicitly named in ROADMAP Phase 117 PRE-FLIGHT |
| A2 | Phase 117 exposes a `qe.upsertOverride({kind, target_id, action, payload, created_by})` method | §6 P117-2 | MEDIUM — Phase 117 may name it differently. Plan documents this as the assumed name; rename in execution if 117 picks otherwise |
| A3 | `target_id` is always an integer; `cmdCorrect` resolves `<service-name>` → `services.id` before insert | §6 P117-6 | MEDIUM — 117 may add a `target_name TEXT` alternative column. If so, 118's resolution can be skipped |
| A4 | `payload` is JSON-encoded TEXT; per-action field names as listed in §6 P117-3 | §6 P117-3 | MEDIUM — 117 picks the canonical field names. 118 plans use these names; 117's apply hook must read them OR the two plans coordinate at execution time |
| A5 | A new `POST /api/rescan?project=<root>&repo=<identifier>` worker HTTP endpoint is the right architecture for `/arcanon:rescan` (avoids CLI-side agent-runner wiring) | §3 | LOW — mirrors existing `POST /scan` pattern |
| A6 | Migration 017 ships before Phase 118 bats tests run (Wave 3 ordering is enforced) | §6 P117-5, §7 | LOW — orchestrator runs phases in wave order |

---

## Sources

### Primary (HIGH confidence)
- `plugins/arcanon/worker/cli/hub.js:1-1258` — full file read this session (HANDLERS, parseArgs, emit, cmdVerify, cmdList, cmdDoctor)
- `plugins/arcanon/scripts/hub.sh:1-15` — dispatch wrapper
- `plugins/arcanon/worker/scan/manager.js:1-962` — scanRepos, buildScanContext, agent runner injection, scan lock
- `plugins/arcanon/worker/db/migrations/001_initial_schema.js:22-29` — repos table schema
- `plugins/arcanon/worker/db/query-engine.js:820-906` — upsertRepo, upsertService, upsertConnection patterns
- `plugins/arcanon/commands/list.md:1-104`, `commands/verify.md:1-101` — markdown wrapper patterns (for new `correct.md` / `rescan.md`)
- `plugins/arcanon/tests/fixtures/list/seed.sh`, `tests/list.bats:1-219`, `tests/verify.bats:1-100` — bats test pattern + fixture seeder convention
- `.planning/phases/114-read-only-navigability-commands-list-view-doctor/114-RESEARCH.md` — HANDLERS pattern, dispatch precedence (no router exists), test pattern catalog

### Secondary (MEDIUM confidence)
- `.planning/REQUIREMENTS.md` lines 91-116 — CORRECT-01..07 spec
- `.planning/ROADMAP.md` lines 265-277 — Phase 117 + 118 detail (phase 117 is Phase 118's dependency)

### Tertiary (LOW confidence / ASSUMED)
- Phase 117's exact column names + method names — see §6 P117-1 / P117-2 (Phase 117 not yet planned)

---

## Metadata

**Confidence breakdown:**
- HANDLERS map + parseArgs surface: HIGH — full file read
- repos table schema: HIGH — migration 001 read in full
- scan manager entry points: HIGH — full file read; recommendations match verified internal contracts (mode='skip', options.full=true)
- Test patterns: HIGH — three patterns in 114-RESEARCH.md, plus the verify.bats clone is the canonical Pattern A reference
- Phase 117 surface: MEDIUM — assumptions explicitly listed, mitigations documented

**Research date:** 2026-04-26
**Valid until:** 2026-05-10 (14 days — codebase shape is stable; Phase 117 may shift assumed surface, but assumptions are gated by explicit blocks in each plan)
