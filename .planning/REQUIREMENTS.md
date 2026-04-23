# Requirements: Arcanon v0.1.2 — Ligamen Residue Purge

**Defined:** 2026-04-23
**Core Value:** Zero `ligamen` / `LIGAMEN` / `@ligamen` / `.ligamen` references anywhere in the plugin. Arcanon is the product name going forward.

**Milestone intent:** Hard-remove every remaining Ligamen reference from code, config readers, env vars, data-dir fallbacks, tests, docs, and comments. Retract the v0.1.1 "legacy honored for now" promise. Breaking change for any v5.x upgrade path is acceptable.

**Scope discipline:** Refactor only. No new features. No behavior changes outside the rename.

## v1 Requirements (Milestone v0.1.2)

### Environment Variable Purge (ENV)

Hard-remove all `LIGAMEN_*` env var reads. Worker, MCP server, scripts, and libs read **only** their `ARCANON_*` counterparts. No two-read fallbacks. No stderr deprecation warnings for legacy names — simply do not read them.

- [ ] **ENV-01**: `worker/index.js` reads `ARCANON_LOG_LEVEL` and `ARCANON_WORKER_PORT` only; lines 25, 33–35 purged of `LIGAMEN_*` reads
- [ ] **ENV-02**: `worker/server/chroma.js` reads `ARCANON_CHROMA_MODE|HOST|PORT|SSL|API_KEY|TENANT|DATABASE` only; lines 56, 60–63, 70, 80–85 and docstring purged
- [ ] **ENV-03**: `worker/mcp/server.js` reads `ARCANON_LOG_LEVEL`, `ARCANON_DB_PATH`, `ARCANON_PROJECT_ROOT` only; lines 23, 27, 46–47 purged
- [ ] **ENV-04**: `lib/config.sh` reads `ARCANON_CONFIG_FILE` only; back-compat re-export of `LIGAMEN_CONFIG_FILE`, `LIGAMEN_CONFIG_LINKED_REPOS` removed
- [ ] **ENV-05**: `lib/data-dir.sh` reads `ARCANON_DATA_DIR` only; `LIGAMEN_DATA_DIR` branch removed
- [ ] **ENV-06**: `scripts/lint.sh`, `scripts/file-guard.sh`, `scripts/format.sh` read `ARCANON_*` only (`ARCANON_LINT_THROTTLE`, `ARCANON_EXTRA_BLOCKED`, `ARCANON_DISABLE_FORMAT`, `ARCANON_DISABLE_LINT`, `ARCANON_DISABLE_GUARD`)
- [ ] **ENV-07**: `scripts/worker-start.sh`, `worker-stop.sh`, `session-start.sh`, `install-deps.sh` contain zero `LIGAMEN_` references
- [ ] **ENV-08**: `worker/lib/data-dir.js` reads `ARCANON_DATA_DIR` only; `LIGAMEN_DATA_DIR` branch removed
- [ ] **ENV-09**: `worker/lib/config-path.js` reads `arcanon.config.json` only; `ligamen.config.json` fallback removed

### Legacy Data & Config Path Removal (PATH)

Remove `$HOME/.ligamen` and `ligamen.config.json` fallback code paths.

- [ ] **PATH-01**: `lib/data-dir.sh` does NOT check `$HOME/.ligamen` as legacy fallback; only reads `$HOME/.arcanon` (create if missing)
- [ ] **PATH-02**: `worker/lib/data-dir.js` does NOT check `$HOME/.ligamen`; only `$HOME/.arcanon`
- [ ] **PATH-03**: `lib/config-path.sh` does NOT check `ligamen.config.json`; only `arcanon.config.json`
- [ ] **PATH-04**: `worker/lib/config-path.js` does NOT check `ligamen.config.json`; only `arcanon.config.json`
- [ ] **PATH-05**: `lib/linked-repos.sh` has zero `ligamen` references
- [ ] **PATH-06**: `lib/db-path.sh` has zero `ligamen` references (comment cleanup)

### Package Identity (PKG)

- [ ] **PKG-01**: `plugins/arcanon/runtime-deps.json` `"name"` field changed from `"@ligamen/runtime-deps"` to `"@arcanon/runtime-deps"`
- [ ] **PKG-02**: No `package-lock.json` / `node_modules` references to `@ligamen/runtime-deps` remain after reinstall
- [ ] **PKG-03**: `scripts/install-deps.sh` references to package name updated (if any)

### Source Code Cosmetic (SRC)

Rename every `Ligamen` / `ligamen` / `LIGAMEN` mention in comments, docstrings, log messages, and string literals that aren't env var reads.

- [ ] **SRC-01**: All `worker/**/*.js` (non-test) files have zero `ligamen|Ligamen|LIGAMEN` references (except unavoidable keywords in already-updated env var reads)
- [ ] **SRC-02**: All `worker/scan/agent-prompt-*.md` files have zero ligamen references (discovery, common, service, library, infra)
- [ ] **SRC-03**: All `worker/scan/agent-schema.json`, `worker/scan/findings.js`, `worker/scan/confirmation.js`, `worker/scan/discovery.js`, `worker/scan/manager.js` have zero ligamen references
- [ ] **SRC-04**: All `worker/db/*.js` (non-test) files (`database.js`, `pool.js`, `query-engine.js`) have zero ligamen references
- [ ] **SRC-05**: All `worker/server/*.js` (non-test) files (`http.js`, `chroma.js`) have zero ligamen references
- [ ] **SRC-06**: `worker/hub-sync/auth.js`, `worker/ui/modules/export.js` have zero ligamen references
- [ ] **SRC-07**: All `scripts/*.sh` (non-test) files have zero ligamen references
- [ ] **SRC-08**: All `lib/*.sh` files have zero ligamen references

### Test Updates (TST)

Update every test file that pins legacy names to assert on `ARCANON_*` / `arcanon.config.json` / `~/.arcanon/` instead.

- [ ] **TST-01**: `tests/config.bats` (33 refs) — rewrite all fixture `LIGAMEN_CONFIG_FILE` / `ligamen.config.json` assertions to `ARCANON_*`
- [ ] **TST-02**: `tests/detect.bats`, `tests/format.bats`, `tests/file-guard.bats`, `tests/structure.bats` — all `LIGAMEN_*` env var references removed or renamed
- [ ] **TST-03**: `tests/mcp-chromadb-fallback.bats`, `tests/mcp-launch.bats`, `tests/mcp-server.bats` — `LIGAMEN_CHROMA_*`, `LIGAMEN_DB_PATH`, `LIGAMEN_PROJECT_ROOT` renamed
- [ ] **TST-04**: `tests/fixtures/config/mock-*.sh` fixture files have zero ligamen references
- [ ] **TST-05**: All `worker/**/*.test.js` files rewritten to exercise `ARCANON_*` env vars and `arcanon.config.json` paths (`chroma.test.js`, `manager.test.js`, `discovery.test.js`, `http.test.js`, `server.test.js`, `server-drift.test.js`, `database.test.js`, `migrations.test.js`, `pool-repo.test.js`, `pragma.test.js`, `query-engine-*.test.js`, `snapshot.test.js`, `auth.test.js`)
- [ ] **TST-06**: Full `make test` bats suite green after rename (all 310+ tests pass)
- [ ] **TST-07**: `node --test worker/**/*.test.js` green after rename

### Command and Skill Documentation (DOC)

- [ ] **DOC-01**: `plugins/arcanon/commands/drift.md`, `commands/status.md` have zero ligamen references
- [ ] **DOC-02**: `plugins/arcanon/skills/impact/SKILL.md` references `ARCANON_CHROMA_*` env vars (fixing the user-reported inconsistency)
- [ ] **DOC-03**: `plugins/arcanon/CHANGELOG.md` has a dedicated `### BREAKING` subsection under `[Unreleased]` documenting the rename removal. Reads: "Removed all `LIGAMEN_*` env var reads, `$HOME/.ligamen` fallback, and `ligamen.config.json` reader. Users upgrading from any Ligamen version must migrate their config file, data directory, and env vars to the `arcanon` / `ARCANON_` / `~/.arcanon/` equivalents."

### README Cleanup (README)

- [ ] **README-01**: `README.md` L63 retracts "Legacy `ligamen.config.json` is still honored — rename it when convenient." paragraph entirely
- [ ] **README-02**: `README.md` L107 retracts "Arcanon was formerly known as **Ligamen** (v1.0–v5.7.0). The `0.1.0` release is the first public version under the new name; legacy `~/.ligamen/` data dirs and `LIGAMEN_*` env vars are still honored for now." — replace with a single line: "Arcanon `0.1.0` was the first release under the current name."
- [ ] **README-03**: `README.md` entire `## Related repos` section (L94–101) removed — no arcanon-hub, arcanon-scanner, arcanon-plugin, arcanon-skills links

### Verification Gate (VER)

- [ ] **VER-01**: Final `grep -rli "ligamen" plugins/ tests/ .claude-plugin/ README.md CHANGELOG.md` returns zero lines (excluding historical CHANGELOG entries under `[0.1.0] Pre-release fixes` or earlier that reference Ligamen's own past name in context, which are acceptable)
- [ ] **VER-02**: bats and node tests both green after the purge
- [ ] **VER-03**: Fresh install from `main` (via `claude plugin marketplace add` + `claude plugin install`) completes with no `LIGAMEN_*` or `ligamen.config.json` paths referenced in runtime

## Future Requirements (Deferred)

None — this milestone is fully scoped.

## Out of Scope

Explicit exclusions for v0.1.2.

| Feature | Reason |
|---------|--------|
| Migration tooling (`ligamen-to-arcanon` script) | Breaking change accepted; v5.x users can rename their config/dirs manually. Tooling encodes the legacy name, defeating the purpose. |
| Two-read fallback with stderr warning | Explicitly rejected per "no ligamen references anywhere" policy. |
| One-release grace period (deprecation stubs) | Same reason — stubs encode the legacy name in the codebase. |
| Any new features, bugfixes, or behavior changes | Scope discipline — refactor only. Real bugs filed to Linear/new milestone. |
| Updating historical CHANGELOG entries under `[0.1.0] Pre-release fixes` | Historical record — past releases shipped under Ligamen; rewriting history would falsify the record. |
| `arcanon-hub` / `arcanon-scanner` / related-repo work | Out of this plugin's scope; README entries removed because those aren't shipping relative to this plugin. |

## Traceability

Populated by gsd-roadmapper during ROADMAP.md creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| ENV-01 | TBD | Pending |
| ENV-02 | TBD | Pending |
| ENV-03 | TBD | Pending |
| ENV-04 | TBD | Pending |
| ENV-05 | TBD | Pending |
| ENV-06 | TBD | Pending |
| ENV-07 | TBD | Pending |
| ENV-08 | TBD | Pending |
| ENV-09 | TBD | Pending |
| PATH-01 | TBD | Pending |
| PATH-02 | TBD | Pending |
| PATH-03 | TBD | Pending |
| PATH-04 | TBD | Pending |
| PATH-05 | TBD | Pending |
| PATH-06 | TBD | Pending |
| PKG-01 | TBD | Pending |
| PKG-02 | TBD | Pending |
| PKG-03 | TBD | Pending |
| SRC-01 | TBD | Pending |
| SRC-02 | TBD | Pending |
| SRC-03 | TBD | Pending |
| SRC-04 | TBD | Pending |
| SRC-05 | TBD | Pending |
| SRC-06 | TBD | Pending |
| SRC-07 | TBD | Pending |
| SRC-08 | TBD | Pending |
| TST-01 | TBD | Pending |
| TST-02 | TBD | Pending |
| TST-03 | TBD | Pending |
| TST-04 | TBD | Pending |
| TST-05 | TBD | Pending |
| TST-06 | TBD | Pending |
| TST-07 | TBD | Pending |
| DOC-01 | TBD | Pending |
| DOC-02 | TBD | Pending |
| DOC-03 | TBD | Pending |
| README-01 | TBD | Pending |
| README-02 | TBD | Pending |
| README-03 | TBD | Pending |
| VER-01 | TBD | Pending |
| VER-02 | TBD | Pending |
| VER-03 | TBD | Pending |

**Coverage:**
- v1 requirements: 42 total
- Mapped to phases: 0, Unmapped: 42 (roadmapper fills this)

---
*Requirements defined: 2026-04-23*
