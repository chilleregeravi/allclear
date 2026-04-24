# Phase 106: Critical Hotfixes — Context

**Gathered:** 2026-04-24
**Status:** Ready for execution
**Mode:** Hotfix phase folded into v0.1.2 mid-release (PR #19 still open)

## Why this phase exists

Issue #18 on the repo documents two blocker bugs shipped in v0.1.1 that v0.1.2 inherits unchanged. Without these fixes, v0.1.2 ships with `/arcanon:sync`, `/arcanon:upload`, `/arcanon:impact`, `/arcanon:export`, `/arcanon:drift`, and `/arcanon:status` all broken on fresh installs — making the Ligamen residue purge invisible to users who can't run any signature command.

## Scope

### HOTFIX-01: better-sqlite3 ABI coverage for Node 25

**Problem:** `package.json` pins `better-sqlite3: ^12.8.0`. Version 12.8.0 ships prebuilt binaries only for Node ABIs v115–v137 on darwin-arm64. Node 25 = v141. When a user's npm install falls back to source compile, it fails silently (no `build/` directory), leaving the plugin cache without bindings. Every SQLite-touching command dies.

**Fix:** Bump `package.json` floor to `"^12.9.0"`. Version 12.9.0 (released 2025) ships prebuilt `node-v141` binaries for darwin-arm64, linux-x64, linux-arm64 (verified via GitHub releases API).

**Also update:** `runtime-deps.json` floor to match.

**Defensive layer (optional):** Add a rebuild fallback in `install-deps.sh` — if `require("better-sqlite3")` fails after install, try `npm rebuild better-sqlite3` once before giving up. Covers future ABI drift.

### HOTFIX-02: `services.boundary_entry` column never migrated

**Problem:** `worker/cli/hub.js:194` and `worker/cli/export.js:51` execute `SELECT id, name, root_path, language, type, boundary_entry FROM services`. The column doesn't exist — migrations 001–010 don't add it. Tests hack around with runtime `ALTER TABLE` (see `manager.dep-collector.test.js:35`, `manager.test.js:866`). Production installs hit `SQLITE_ERROR: no such column: boundary_entry`.

**Fix:**
1. Add migration `011_services_boundary_entry.js` — `ALTER TABLE services ADD COLUMN boundary_entry TEXT`.
2. Update `persistFindings` in `worker/db/query-engine.js` to write `svc.boundary_entry` into the services column. Currently it writes to `exposed_endpoints.boundary_entry` only (line 1314). For now, write to BOTH — the coexistence vs. supersede question is deferred (v0.2.0 or later).
3. Remove the `ALTER TABLE` workaround from tests now that the migration provides the column legitimately.

### HOTFIX-03: CHANGELOG + milestone artifact updates

**Update:**
- `plugins/arcanon/CHANGELOG.md` `[0.1.2]` section — add `### Fixed` subsection under the existing `### BREAKING` subsection. List both hotfixes with issue #18 reference.
- `.planning/milestones/v0.1.2-ROADMAP.md` — add Phase 106 to the Phases section.
- `.planning/milestones/v0.1.2-MILESTONE-AUDIT.md` — update phase count from 5 → 6, plan count 9 → ~12, add hotfix summary.

## Constraints

- Must NOT scope-creep beyond issue #18. Other bugs discovered along the way → file separately, don't fold in.
- Must land on `milestone/v0.1.2` branch before PR #19 merges.
- Tests must be green after fixes (no new red beyond the 2 pre-existing node failures documented in 105-VERIFICATION.md).
- The `boundary_entry` design question (supersede vs. coexist with `exposed_endpoints.handler`) is explicitly deferred. For now: write to both. Coexistence is safe.

## Verification gates

- `cd plugins/arcanon && npm install --omit=dev` on Node 25 should produce a working better-sqlite3 with `build/Release/better_sqlite3.node` present
- `node --test plugins/arcanon/worker/db/migrations.test.js` — migration 011 runs idempotently
- Fresh `/arcanon:map` → `/arcanon:upload` sequence completes without `no such column: boundary_entry`
- Test workarounds in `manager.dep-collector.test.js` and `manager.test.js` removed (column now comes from migration)
- bats + node suites green (modulo the 2 documented pre-existing failures from 105-VERIFICATION.md)
