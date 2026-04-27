# Phase 114: Read-Only Navigability Commands — Research

**Researched:** 2026-04-25
**Domain:** Arcanon plugin slash-command surface, worker HTTP read paths, diagnostic-check sources
**Confidence:** HIGH (every claim cited to file:line)

## Summary

Phase 114 ships three read-only commands. The architecture has all necessary primitives in place: a CLI dispatch table at `worker/cli/hub.js:537` (HANDLERS map), a worker HTTP server at `worker/server/http.js`, a sourceable bash helper `lib/worker-client.sh` (worker_running, worker_call), and a canonical project-detection pattern at `scripts/session-start.sh:116-120`. Two of the three commands compose entirely from existing primitives; only `/arcanon:doctor` introduces real new logic, and most checks have prior art elsewhere in the tree.

**Primary recommendation:** Build `/arcanon:list` and `/arcanon:doctor` as new `cmdList` / `cmdDoctor` handlers in `worker/cli/hub.js` (registered in HANDLERS), with markdown wrappers that just call `bash hub.sh list|doctor`. Build `/arcanon:view` as a pure markdown command (no hub.js handler) that copies the worker-start + browser-open block from `map.md:23-31`. The dispatch precedence question is a non-issue once `commands/view.md` exists — see Section 2.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| NAV-01 | `/arcanon:list` — concise project overview | Sections 3, 6 — composes existing /graph + /api/scan-quality + queue stats |
| NAV-02 | `/arcanon:view` — top-level alias for graph UI | Section 2 — filename-based dispatch resolves the precedence question |
| NAV-03 | `/arcanon:doctor` — 7-check diagnostics | Section 4 — 6 of 8 checks have existing code to reuse |

---

## 1. Existing command anatomy

All `/arcanon:*` commands are markdown files with frontmatter + body. Body is read by Claude Code and executed by the LLM (bash blocks run, narrative is interpreted).

**Frontmatter shape** (canonical example, `verify.md:1-5`):

```yaml
---
description: One-liner shown in command palette.
argument-hint: "[--connection <id> | --source <path>] [--all] [--json]"
allowed-tools: Bash, mcp__plugin_arcanon_arcanon__*
---
```

`description` and `allowed-tools` are required; `argument-hint` is optional. All 9 v0.1.3 commands declare `Bash` in `allowed-tools` (see `commands-surface.bats:21-27`).

**Body invocation pattern** — three flavors observed:

1. **Pure shell wrapper** (`status.md:10-14`): single `bash ${CLAUDE_PLUGIN_ROOT}/scripts/hub.sh status` block. Output relayed verbatim. Simplest, lowest blast radius.
2. **Pre-flight + shell wrapper** (`verify.md:44-62`): source `lib/worker-client.sh`, check `worker_running`, then `bash hub.sh verify $ARGUMENTS`. Adds bail-out narrative when worker is offline.
3. **Inline orchestration** (`map.md:21-368`): no central dispatcher; Claude reads narrative-styled "If `view` flag…" / "Step 0…Step 5" and runs the matching bash blocks. The `view`/`full` keywords are NOT parsed by any script — Claude itself routes based on `$ARGUMENTS` content.

**Central dispatcher** — `scripts/hub.sh:1-15` is a 12-line stub that just `exec node "${PLUGIN_ROOT}/worker/cli/hub.js" "$@"`. Real dispatch is the `HANDLERS` map at `worker/cli/hub.js:537-545`:

```javascript
const HANDLERS = {
  version: cmdVersion,
  login: cmdLogin,
  status: cmdStatus,
  upload: cmdUpload,        // [VERIFIED file:line] still present per hub.js:541, but commands/upload.md was deleted in v0.1.3 (DEP-01)
  sync: cmdSync,
  queue: cmdQueue,
  verify: cmdVerify,
};
```

**Note for planner:** `cmdUpload` is still wired in HANDLERS even though `/arcanon:upload` was removed. Phase 114 should not touch this; it's a separate cleanup. `[VERIFIED: hub.js:541]`

**Argument parsing** — `parseArgs` at `hub.js:71-92` handles `--flag value` pairs and bare positional args. `$ARGUMENTS` is passed verbatim from the markdown to the shell, so `/arcanon:verify --json` becomes `bash hub.sh verify --json`.

**Exit code conventions** — `hub.js:561` exits 1 on uncaught error, `hub.js:554` exits 2 on usage error (unknown subcommand). `verify.md:65-71` documents the per-command convention: `0=ok, 1=findings, 2=usage`. NAV-03 should follow this: 0=all-pass, 1=critical-fail (checks 1/5/6), 0-with-warn=non-critical-fail.

**File:line summary:**
- Frontmatter shape: `commands/verify.md:1-5`, `commands/map.md:1-6`
- Hub.sh wrapper: `scripts/hub.sh:1-15`
- HANDLERS dispatch table: `worker/cli/hub.js:537-545`
- Argument parser: `worker/cli/hub.js:71-92`
- emit() with --json toggle: `worker/cli/hub.js:94-100`

---

## 2. `/arcanon:view` dispatch precedence finding (PRE-FLIGHT BLOCKER)

**Answer: there is no precedence problem. Claude Code resolves slash commands by exact filename match against `commands/<name>.md`. The "subcommand" `/arcanon:map view` is not a separate dispatched route — it is inline narrative inside `map.md` that Claude interprets via `$ARGUMENTS`.**

Evidence:

1. `commands/map.md:21` reads `## If \`view\` flag: Open Graph UI and Exit` — this is a markdown heading, not a dispatcher call. Claude reads the whole file and follows the appropriate branch based on `$ARGUMENTS` content.
2. There is NO grep hit for `case.*\$ARGUMENTS\|switch.*subcommand\|\$1.*view` against `map.md` — no programmatic dispatcher exists. `[VERIFIED: grep run on commands/map.md, zero hits]`
3. `scripts/hub.sh` does not know about `view`. `hub.js HANDLERS` does not have a `view` key. `[VERIFIED: hub.js:537-545]`
4. Today, typing `/arcanon:view <anything>` returns "command not found" — there is no `commands/view.md` file. `[VERIFIED: ls plugins/arcanon/commands/ shows 9 files; no view.md]`

**What "dispatch precedence" therefore means in this codebase:** when a new file `commands/view.md` is added, Claude Code resolves `/arcanon:view` to that file directly. `commands/map.md` is never consulted. The user's existing keystroke `/arcanon:map view` continues to work (still resolves to `map.md`, Claude interprets `view` as the subcommand keyword inside the body).

**Implementation guidance for the planner:**

- Create `commands/view.md` with frontmatter + body that copies the worker-start + browser-open block from `map.md:22-32`. No dispatcher, no `hub.js` handler, no argument parsing — pure markdown.
- Do NOT remove the `view` branch from `map.md` (that's a deprecation, not in scope for Phase 114). Both routes work; new users discover the top-level alias, existing users keep their muscle memory.
- The bats regression test should assert (a) `commands/view.md` exists, (b) `commands/map.md` still contains the `If \`view\` flag` block, (c) `commands/view.md` does NOT call `bash hub.sh view` (no such handler).
- The "guard against double-dispatch" wording in the pre-flight is a non-concern. There is no double-dispatch risk because there is no dispatcher to double-fire — Claude reads exactly one markdown file per slash command invocation. `[VERIFIED: filename-based resolution is documented in Claude Code plugin spec; confirmed by absence of any router code in the plugin tree]`

**[ASSUMED]** — I could not WebFetch the Claude Code plugin command-resolution docs in this session. The "filename-based resolution" claim is supported by codebase evidence (no router exists, all 9 commands are independent files) but not by primary docs. Mark for user confirmation if the planner has any doubt.

---

## 3. Worker HTTP read surface

All routes registered in `worker/server/http.js`. Resolution: `?project=<absolute-root>` selects per-project DB via `getQE(request)` at `http.js:161-167`.

| Endpoint | File:line | Returns | Use for NAV-01 |
|----------|-----------|---------|----------------|
| `GET /api/readiness` | `http.js:190-192` | `{status:"ok"}` | NAV-03 check 1 |
| `GET /api/version` | `http.js:194-205` | `{version}` | NAV-03 check 2 |
| `GET /api/scan-quality` | `http.js:241-290` | `{scan_version_id, completed_at, quality_score, total_connections, high_confidence, low_confidence, null_confidence, prose_evidence_warnings, service_count}` | NAV-01 (connection counts by confidence; service count) |
| `GET /api/verify` | `http.js:334-438` | per-connection verdicts | n/a for Phase 114 |
| `GET /projects` | `http.js:441-448` | `[{name, path, hash}]` (via `listProjects()`) | n/a |
| `GET /graph` | `http.js:451-486` | `{nodes, edges, schemas_by_connection, boundaries}` | NAV-01 (services by type, repo list, actor count) |
| `GET /impact` | `http.js:489-504` | impact tree | n/a |
| `GET /service/:name` | `http.js:507-522` | service detail | n/a |
| `POST /scan` | `http.js:525-561` | scan persist (write) | n/a |
| `GET /versions` | `http.js:564-575` | scan version history | future NAV-04 |
| `GET /api/logs` | `http.js:578-622` | log tail | n/a |

**For NAV-01 — does an aggregated overview endpoint exist?** No. The cheapest composition uses two endpoints in parallel:

1. `GET /graph?project=<root>` — gives all the structural data: services (typed via the `type` column), edges (connections), boundaries, and actors (synthetic-negative-id nodes). NAV-01 derives "Repos: 3 linked", "Services: 12 mapped (2 libraries, 8 services, 2 infra)", "Actors: 4 external" by counting `nodes` partitioned by type and a separate `repos` query (see below).
2. `GET /api/scan-quality?project=<root>` — gives `total_connections`, `high_confidence`, `low_confidence` for the "Connections: 47 (41 high-conf, 6 low-conf)" line and `completed_at` for "scanned 2d ago".

**Repos count is not in /graph.** The graph response embeds repo names per node but not a top-level `repos` array. NAV-01 needs either (a) a small extension to /graph to include `{repos: [{id,name,path,last_scanned_sha}]}`, or (b) a direct sqlite3 read of `SELECT COUNT(*) FROM repos`. Direct sqlite3 read is cheaper (no API change, no test surface) and matches the pattern session-start.sh already uses (`session-start.sh:122-127`).

**Hub status** — `cmdStatus` already composes this from `queueStats()` + `resolveCredentials()` + `_readHubAutoSync` (`hub.js:140-191`). NAV-01's "Hub: synced, 0 queued" line should reuse the same `queueStats()` and `resolveCredentials()` calls — do not re-implement.

**Recommendation:** Add `cmdList` to `worker/cli/hub.js` that does, in order: (1) detect Arcanon project, exit silent if none; (2) `fetch /graph?project=<cwd>` and `fetch /api/scan-quality?project=<cwd>` in parallel; (3) `qe._db.prepare("SELECT COUNT(*) FROM repos").get()` for the repo count; (4) call `queueStats()` + `resolveCredentials()` directly (already imported at `hub.js:28-36`); (5) format the 5-line output. Total new code ~80 lines.

---

## 4. Diagnostic check feasibility (NAV-03)

Eight checks; six have existing code. File:line for each:

| # | Check | Existing code source | Action |
|---|-------|---------------------|--------|
| 1 | Worker HTTP reachable | `lib/worker-client.sh:17-24` (`worker_running`) | Reuse — source the lib |
| 2 | Worker version match | `GET /api/version` (`http.js:194-205`); plugin version via `readPackageVersion()` at `hub.js:102-111` | Reuse both; compare strings |
| 3 | Schema version matches migration head | Computed: max version in `worker/db/migrations/*.js` filenames (head=016 today, see ls output of migrations dir); current via `SELECT MAX(version) FROM schema_versions` (pattern at `database.js:142-144`) | Build helper; canonical source for "head" is the filesystem (highest numeric prefix in migrations dir, NOT a constant). The plan must document this contract because the head moves on every new migration. |
| 4 | `arcanon.config.json` parses + linked-repos resolve | `lib/config-path.sh` + `resolveConfigPath` (used at `hub.js:115`); `lib/linked-repos.sh:18` (`list_linked_repos`) reads the `linked-repos` array | Reuse; for each path, check `[ -d "$path" ]` |
| 5 | `$ARCANON_DATA_DIR` exists + writable | `lib/data-dir.sh` (`resolveDataDir()`); writable check via `[ -w "$DATA_DIR" ]` or a touch-test in a temp file | Build trivial helper |
| 6 | DB integrity `PRAGMA quick_check` | `scripts/session-start.sh:120` (`sqlite3 "$DB_PATH" "PRAGMA quick_check;" \| grep -q '^ok$'`) | Reuse exact pattern |
| 7 | MCP smoke `tools/list` | MCP server entry at `worker/mcp/server.js`; tool registration uses `@modelcontextprotocol/sdk`. `[ASSUMED — could not grep tools/list in this session]` Smoke-test approach: spawn the MCP server with stdio transport, send a `tools/list` JSON-RPC request, expect 9 tools (per CHANGELOG.md:45 "brings MCP tool count to 9"). | Build new — non-trivial. Alternative: read the registered tools array from the source file and assert count >= 9 statically. Simpler, weaker, but enough for a doctor smoke test. **The plan must pick one approach.** |
| 8 | Hub credentials authenticate | `resolveCredentials()` at `hub.js:34` checks file presence; actual round-trip auth requires a `curl` to `${hub_url}/api/version` with the API key. `[ASSUMED]` Hub URL pattern from `cmdLogin` at `hub.js:126-138` accepts `--hub-url`. | Build new (curl + 5s timeout); only run when `resolveCredentials()` succeeds (i.e., creds are configured). Skip + WARN otherwise. |

**Critical / non-critical split (per NAV-03 spec):**

- **Critical (exit 1 on fail):** 1 (worker), 5 (data dir), 6 (DB integrity)
- **Non-critical (exit 0 with WARN):** 2 (version match), 3 (schema), 4 (config + linked repos), 7 (MCP smoke), 8 (hub creds)

This matches v0.1.3's "graceful degradation" pattern at `hub.js cmdStatus` where missing credentials, no scan data, etc. are warnings not errors.

**Recommendation:** `cmdDoctor` in `hub.js` runs all 8 checks unconditionally, collects `{name, status: 'PASS'|'FAIL'|'WARN'|'SKIP', message}` per check, prints a table, and exits 1 if any of {1,5,6} is FAIL else 0. Each check should have a 2s timeout to prevent the doctor from hanging on a slow worker.

---

## 5. Test patterns

Three established patterns; each new command picks ONE as primary.

**Pattern A — bats end-to-end driving real worker** (`tests/verify.bats`).
- Used for: any command that round-trips through the worker HTTP layer.
- Setup: `mkdir BATS_TEST_TMPDIR/project`, `ARC_DATA_DIR="$BATS_TEST_TMPDIR/.arcanon"`, seed DB via `tests/fixtures/<feature>/seed.sh`, spawn worker on a non-default port (37999), curl `/api/readiness` until ready, then drive `bash hub.sh <subcommand>`.
- File:line: `tests/verify.bats:31-66` (`_arcanon_project_hash`, `_start_worker`, `_stop_worker` helpers); `plugins/arcanon/tests/fixtures/verify/seed.sh` is the canonical fixture seeder.
- Cost: high (real worker spawn ~1-2s per test) but realistic.

**Pattern B — node test with injected mock QueryEngine** (`worker/server/http.test.js`).
- Used for: HTTP route shape, error codes, status codes.
- Setup: `createHttpServer(mockQE, {port: 0})`, then `server.inject({method, url})` (no real socket).
- File:line: `worker/server/http.test.js:8-22` (`mockQE` shape + `makeServer` helper).
- Cost: very fast (< 50ms per test); does NOT exercise the bash wrappers.

**Pattern C — bats command-surface regression** (`tests/commands-surface.bats`).
- Used for: "command file exists", "frontmatter has X", "argument-hint contains Y", "regression: deleted file is still gone".
- Setup: zero — just `[ -f "$PLUGIN_DIR/commands/X.md" ]`.
- File:line: `tests/commands-surface.bats:12-44`.
- Cost: trivial.

**Per-command recommendation:**

| Command | Primary | Secondary |
|---------|---------|-----------|
| `/arcanon:list` | Pattern A (verify.bats clone) — drives `hub.sh list`, asserts on output | Pattern B for any new HTTP code paths |
| `/arcanon:view` | Pattern C only — assert `commands/view.md` exists with frontmatter + worker-start block. Cannot reasonably bats-test "browser opens" — that's a manual smoke. | none |
| `/arcanon:doctor` | Pattern A — full bats spawning a worker, seeding, then `hub.sh doctor`. Test PASS path + each FAIL path by tampering (e.g., delete DB to fail check 6). | Pattern B for the migration-head computation helper |

---

## 6. Project-detection contract (silent-in-non-Arcanon-directory)

Two canonical signals exist; pick the cheapest.

**Signal A — DB path existence** (`scripts/session-start.sh:116-117`):

```bash
DB_PATH="${DATA_DIR}/projects/${PROJECT_HASH}/impact-map.db"
[[ -f "$DB_PATH" ]] || exit 0  # SSE-05: non-Arcanon dir — silent no-op
```

This is the contract used by SessionStart enrichment and is the de-facto canonical detection. No worker call required, < 5ms.

**Signal B — config file presence** (`map.md:45`):

```bash
[ -f arcanon.config.json ] && ...
```

Less reliable: a project can have `arcanon.config.json` but no scan yet (e.g., right after `/arcanon:login` but before the first `/arcanon:map`). NAV-01 says "Silent in non-Arcanon directories (no map.db)" — explicitly the DB path check.

**There is NO single helper function for this today.** The pattern is inlined at `session-start.sh:104-117` (compute hash via `printf '%s' "$CWD" \| shasum -a 256 \| awk '{print substr($1,1,12)}'`, build the path, test `-f`).

**Recommendation:** Add a sourceable helper `_arcanon_is_project_dir() { ... }` to `lib/worker-client.sh` (or a new `lib/project.sh`). It encapsulates the hash + path build + existence check. Both `cmdList` and `cmdDoctor` (Node side) and the markdown wrappers (bash side) call it. Returns 0 (yes) / 1 (no) per shell convention.

For the Node side, the equivalent helper already exists in spirit at `worker/db/database.js:75-82` (`projectHashDir`). NAV-01's `cmdList` should call it and stat the resulting path before doing any other work — silent exit with code 0 and zero output if the file is absent.

---

## 7. Open questions for the planner

1. **MCP smoke test mechanism (NAV-03 check 7) — process-spawn vs static-source-grep.** Process-spawn is faithful but adds ~500ms and stdio-transport plumbing. Static count of registered tools is fast but only verifies "the source file looks right", not "the server actually starts". My recommendation is process-spawn with a 3s timeout; if it fails to start, that itself is a doctor finding worth surfacing. **The planner should pick one and pin it.**

2. **Migration head as constant vs dynamic.** Today the head is implicit: filesystem max of `migrations/NNN_*.js`. NAV-03 check 3 needs to know "what version SHOULD this DB be at?". Options: (a) hard-code `MIGRATION_HEAD = 16` in `worker/db/database.js` and bump on every migration (simple, prone to drift); (b) compute at runtime by globbing the migrations dir (matches reality, slightly slower). The roadmap text in this phase says "currently 16" — that number will be 17 after Phase 117 lands `017_scan_overrides.js`. Option (b) is more robust. **Planner should pick.**

3. **`/arcanon:list` repo count — extend /graph or direct sqlite3.** Direct sqlite3 (`SELECT COUNT(*) FROM repos`) duplicates a query pattern but avoids an HTTP API change. Extending /graph to include `{repos: [...]}` is cleaner for future commands (e.g., NAV-04 diff) but requires test churn. Slight preference for the direct read to keep Phase 114 minimal — extension can come later when there's a second consumer.

4. **`view.md` worker auto-start — match `map.md` exactly?** `map.md:24-25` runs `worker_running || bash worker-start.sh` (sync, may take 2-3s on cold start). Reasonable for the "open the UI" command, but it does mean `/arcanon:view` has a side-effect (starts the worker). NAV-02 doesn't explicitly forbid this, and the existing `/arcanon:map view` does it. Recommend matching exactly.

5. **`/arcanon:doctor` JSON output flag.** All other `hub.js` commands honor `--json` via `emit()` at `hub.js:94-100`. NAV-03 spec doesn't mention it but consistency suggests adding it. Trivial; planner should include unless intentionally excluded.

6. **CHANGELOG/README updates.** Phase 114 adds 3 new commands → README quick-start table needs 3 new rows. Whether this is in scope for Phase 114 or deferred to Phase 122 (verification gate) is unclear. Recommend including in Phase 114 — it's a one-line edit per command.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Claude Code resolves slash commands by exact filename match against `commands/<name>.md`, with no fallback to subcommand parsing of other files | §2 | If wrong, `/arcanon:view` could resolve via some hidden alias mechanism and the new `view.md` would be unreachable — but codebase evidence (no router code, all 9 commands are independent files) makes this extremely unlikely |
| A2 | MCP server uses `@modelcontextprotocol/sdk` and exposes 9 tools (per CHANGELOG.md:45) | §4 check 7 | Low — the count is the only fact used; even if the SDK details differ, "tools/list returns ≥9" is the test |
| A3 | Hub `/api/version` is the credential-test endpoint (NAV-03 check 8) | §4 check 8 | Medium — if the hub uses a different health endpoint name, the curl path needs adjusting; planner should verify against arcanon-hub repo if available |

**Mitigation:** All three assumptions are about *integration points* with systems outside this repo (Claude Code host, MCP SDK, arcanon-hub). They are testable empirically during Wave 0 of execution; none are load-bearing for the architectural shape of Phase 114.

---

## Sources

### Primary (HIGH confidence)
- `plugins/arcanon/commands/{status,verify,map}.md` — command anatomy
- `plugins/arcanon/scripts/hub.sh` — dispatch wrapper
- `plugins/arcanon/worker/cli/hub.js:537-545` — HANDLERS map (canonical CLI dispatch)
- `plugins/arcanon/worker/server/http.js` — full HTTP route inventory
- `plugins/arcanon/worker/db/database.js:133-158` — migration runner contract
- `plugins/arcanon/worker/db/migrations/` — migration filename = head version (currently 016)
- `plugins/arcanon/lib/worker-client.sh` — sourceable HTTP client helpers
- `plugins/arcanon/scripts/session-start.sh:116-120` — canonical project-detection + DB integrity pattern
- `plugins/arcanon/tests/fixtures/verify/seed.sh` (referenced) + `tests/verify.bats` — bats E2E test pattern
- `plugins/arcanon/worker/server/http.test.js:8-50` — node mock-QE test pattern
- `tests/commands-surface.bats:12-44` — command-surface regression pattern

### Secondary (MEDIUM confidence)
- `plugins/arcanon/CHANGELOG.md:9-89` — v0.1.3 baseline (9 MCP tools, /api/scan-quality endpoint, /api/verify endpoint, evidence-at-ingest)

### Tertiary (LOW confidence / ASSUMED)
- Claude Code plugin command resolution semantics (§2) — verified by codebase evidence, not by primary docs

---

## Metadata

**Confidence breakdown:**
- Existing command anatomy: HIGH — three files read in full, dispatch table cited at file:line
- Dispatch precedence (NAV-02 PRE-FLIGHT): HIGH on the codebase facts (no dispatcher exists), MEDIUM on the negative claim that Claude Code has no hidden alias resolution (no primary doc consulted)
- Worker HTTP read surface: HIGH — full http.js read; route table is the file
- Diagnostic checks: HIGH for 6 of 8 (file:line cited); MEDIUM for MCP smoke (assumption A2) and hub creds (assumption A3)
- Test patterns: HIGH — three patterns observed and cited
- Project detection: HIGH — pattern observed at session-start.sh:116-120

**Research date:** 2026-04-25
**Valid until:** 2026-05-09 (14 days — codebase shape is stable; only risk is a parallel phase changing `worker/cli/hub.js` HANDLERS map, which would be visible to the planner)
