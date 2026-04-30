---
phase: 127
phase_name: verification-and-release-gate
plan: 01
type: execute
wave: 1
depends_on: [126]
files_modified:
  - plugins/arcanon/package.json
  - plugins/arcanon/.claude-plugin/plugin.json
  - .claude-plugin/marketplace.json
  - plugins/arcanon/package-lock.json
  - plugins/arcanon/CHANGELOG.md
autonomous: false   # Task 4 (e2e walkthrough) is checkpoint:human-verify
requirements: [VER-01, VER-02, VER-03, VER-04]
must_haves:
  truths:
    - "All hand-edited manifest files contain only the version string 0.1.5"
    - "package-lock.json regenerated with version 0.1.5 and committed"
    - "plugins/arcanon/CHANGELOG.md has a pinned [0.1.5] - <date> section under [Unreleased]"
    - "[0.1.5] section explicitly notes hub-side dependency on THE-1030 under BREAKING"
    - "make test (bats) exits 0 with no new pre-existing-mock carryforwards relative to v0.1.4 baseline"
    - "npm test (node) inside plugins/arcanon/ exits 0 with no new failures relative to v0.1.4 baseline"
    - "Operator confirms /arcanon:login round-trips against a real hub instance honoring THE-1030"
    - "Operator confirms /arcanon:status renders an Identity block with resolved org id, key preview, scopes, authorized orgs"
    - "Operator confirms an MCP tool response inspected via the worker contains zero /Users/ strings"
    - "Operator confirms a real /arcanon:sync upload succeeds with X-Org-Id landing server-side"
  artifacts:
    - path: "plugins/arcanon/package.json"
      provides: "plugin npm manifest pinned at 0.1.5"
      contains: "\"version\": \"0.1.5\""
    - path: "plugins/arcanon/.claude-plugin/plugin.json"
      provides: "Claude Code plugin manifest pinned at 0.1.5"
      contains: "\"version\": \"0.1.5\""
    - path: ".claude-plugin/marketplace.json"
      provides: "marketplace discovery manifest pinned at 0.1.5 (both top-level and plugins[0])"
      contains: "\"version\": \"0.1.5\""
    - path: "plugins/arcanon/package-lock.json"
      provides: "regenerated lockfile pinned at 0.1.5"
      contains: "\"version\": \"0.1.5\""
    - path: "plugins/arcanon/CHANGELOG.md"
      provides: "[0.1.5] release notes — Added / Changed / BREAKING with THE-1030 callout"
      contains: "## [0.1.5]"
  key_links:
    - from: "plugins/arcanon/package.json"
      to: "plugins/arcanon/package-lock.json"
      via: "npm install --package-lock-only regenerates the lockfile from package.json"
      pattern: "\"version\": \"0.1.5\""
    - from: ".claude-plugin/marketplace.json"
      to: "plugins/arcanon/package.json"
      via: "marketplace.json plugins[0].version mirrors plugin package.json version"
      pattern: "\"version\": \"0.1.5\""
    - from: "plugins/arcanon/CHANGELOG.md"
      to: "BREAKING — hub-side THE-1030"
      via: "Explicit BREAKING entry naming THE-1030 + the /arcanon:login --org-id remediation"
      pattern: "THE-1030"
    - from: "operator e2e walkthrough"
      to: "real hub honoring THE-1030"
      via: "/arcanon:login → /arcanon:status → MCP tool call → /arcanon:sync, with server-side X-Org-Id verification"
      pattern: "X-Org-Id"
---

<objective>
Pin Arcanon at v0.1.5 and prove the milestone ships green.

Purpose: Close the v0.1.5 Identity & Privacy milestone by (1) bumping every
manifest + the lockfile to `0.1.5`, (2) writing a categorized CHANGELOG entry
that calls out the hard hub-side dependency on THE-1030 under BREAKING,
(3) running both test suites green with no new pre-existing-mock carryforwards
versus the v0.1.4 baseline, and (4) walking through an end-to-end manual
verification against a real hub instance to confirm the auth + PII paths
hold in production conditions.

Output:
  - 3 manifest files at version 0.1.5 (4 version strings total)
  - regenerated package-lock.json at version 0.1.5
  - CHANGELOG.md with a pinned [0.1.5] section under a fresh [Unreleased]
  - bats green, node green, exit codes recorded
  - operator-signed e2e verification log

Hard prerequisites:
  - Phase 126 (auth test suite) PASS
  - Phases 123–125 individually verified (PII, hub auth core, login + status UX)
  - arcanon-hub THE-1030 deployed to a hub instance the operator can reach
    (the e2e walkthrough is impossible without it)

Out of scope (do NOT do in this phase):
  - git tagging, GitHub release, merge ceremony — post-merge mechanics
  - v0.1.6 candidates (multi-level scope grants, service-account credentials,
    multi-org switching) — already deferred in REQUIREMENTS.md `## Future`
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/REQUIREMENTS.md
@.planning/PREDECESSOR-SURFACE.md
@.planning/milestones/v0.1.4-MILESTONE-AUDIT.md
@plugins/arcanon/CHANGELOG.md
@plugins/arcanon/package.json
@plugins/arcanon/.claude-plugin/plugin.json
@.claude-plugin/marketplace.json

<manifest_inventory>
<!-- Ground truth as of plan creation (audited via grep). -->
<!-- 3 hand-edited files + 1 regenerated lockfile = 4 manifests per VER-01. -->

| File | Current version strings | Where |
|------|-------------------------|-------|
| `plugins/arcanon/package.json` | 1 × `"version": "0.1.4"` | line 3 |
| `plugins/arcanon/.claude-plugin/plugin.json` | 1 × `"version": "0.1.4"` | line 3 |
| `.claude-plugin/marketplace.json` | 2 × `"version": "0.1.4"` | line 9 (plugins[0].version), line 14 (top-level version) |
| `plugins/arcanon/package-lock.json` | regenerated by `npm install --package-lock-only` | derived from package.json |

**Note on REQ VER-01 wording.** REQUIREMENTS.md VER-01 lists "4 manifests"
including a repo-root `package.json`. **No repo-root `package.json` exists**
(verified by `ls` and `git log -- package.json`). The 4 manifests in the
v0.1.4 audit (`v0.1.4-MILESTONE-AUDIT.md` §8 — "6 strings at 0.1.4") count
the lockfile as the 4th. We honor the spec by editing the 3 files above
plus regenerating the lockfile. Total expected `"version": "0.1.5"` strings
after Task 1: 4 in source + N in lockfile (npm-generated; do not hand-edit).
</manifest_inventory>

<test_baseline_v0.1.4>
<!-- From v0.1.4-MILESTONE-AUDIT.md §6. Use as the floor for VER-03. -->
- bats: 448/449 (1 pre-existing perf flake — `impact-hook` HOK-06 p99 latency)
- node: 774/775 / 141 suites (1 pre-existing env flake — `worker/mcp/server-search.test.js` reads user's real `~/.arcanon/worker.port`)
- A v0.1.5 result of "448 bats + 774 node" or better, with the same two flakes
  (and no others), counts as "no new pre-existing-mock carryforwards."
- Phase 126 added `worker/hub-sync/whoami.test.js` (new file) plus extended
  `client.test.js` and `integration.test.js` — node count expected to grow.
- Phase 123 added `worker/lib/path-mask.test.js` plus PII bats grep-assertions
  in `commands-surface.bats` (or a dedicated `pii-egress.bats`) — both counts
  expected to grow.
</test_baseline_v0.1.4>

<changelog_format_pin>
<!-- The CHANGELOG follows Keep-a-Changelog 1.1.0. v0.1.4 precedent at -->
<!-- plugins/arcanon/CHANGELOG.md:9–157 — `### Added` and `### Changed` -->
<!-- only, empty subsections omitted. v0.1.3 precedent at lines 159–238 -->
<!-- includes `### BREAKING`, `### Added`, `### Changed`, `### Fixed`, -->
<!-- `### Removed`. v0.1.5 needs `### BREAKING` (THE-1030 + upgrade path), -->
<!-- `### Added` (whoami, path-mask, Identity block, X-Org-Id), -->
<!-- `### Changed` (resolveCredentials shape, login flow, MCP/HTTP/log -->
<!-- masking). `### Fixed` and `### Removed` are likely empty for v0.1.5 -->
<!-- and should be omitted. -->
</changelog_format_pin>

<e2e_environment_pin>
<!-- The walkthrough requires a hub honoring THE-1030. Operator must -->
<!-- pre-confirm: -->
<!--   - Hub URL with THE-1030 deployed (could be staging or local dev) -->
<!--   - A live `arc_…` API key authorized for ≥1 org -->
<!--   - Network reachability from the operator's workstation to the hub -->
<!-- If any of these is missing, the e2e walkthrough cannot complete and -->
<!-- the phase BLOCKS — do NOT ship v0.1.5 until VER-04 actually passes. -->
</e2e_environment_pin>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Bump all manifests to 0.1.5 + regenerate lockfile</name>
  <files>
    plugins/arcanon/package.json,
    plugins/arcanon/.claude-plugin/plugin.json,
    .claude-plugin/marketplace.json,
    plugins/arcanon/package-lock.json
  </files>
  <action>
**Goal:** every hand-edited manifest carries `"version": "0.1.5"`; the
lockfile is regenerated from the bumped `package.json` and committed.

**Exact diffs (deterministic):**

1. `plugins/arcanon/package.json` — line 3:
   ```diff
   -  "version": "0.1.4",
   +  "version": "0.1.5",
   ```

2. `plugins/arcanon/.claude-plugin/plugin.json` — line 3:
   ```diff
   -  "version": "0.1.4",
   +  "version": "0.1.5",
   ```

3. `.claude-plugin/marketplace.json` — line 9 AND line 14 (both):
   ```diff
   -      "version": "0.1.4",
   +      "version": "0.1.5",
   ...
   -  "version": "0.1.4"
   +  "version": "0.1.5"
   ```

4. Regenerate `plugins/arcanon/package-lock.json`:
   ```bash
   cd plugins/arcanon && npm install --package-lock-only
   ```
   This rewrites the lockfile's two `"version": "0.1.4"` occurrences
   (root package, plus the self-referential `packages."".version`) to
   `0.1.5`. **Do NOT run plain `npm install`** — that would also drift
   transitive dep resolutions and is out of scope for a release-gate
   bump. `--package-lock-only` is the v0.1.4 precedent (per
   `v0.1.4-MILESTONE-AUDIT.md` §8: "regenerated via
   `npm install --package-lock-only`").

**Verify after the edits and lockfile regen, BEFORE moving on:**

```bash
# Expected: exactly 4 hits across the 3 hand-edited files
grep -rn '"version": "0.1.5"' \
  plugins/arcanon/package.json \
  plugins/arcanon/.claude-plugin/plugin.json \
  .claude-plugin/marketplace.json
# Expected: 0 hits — no leftover 0.1.4 in any hand-edited manifest
grep -rn '"version": "0.1.4"' \
  plugins/arcanon/package.json \
  plugins/arcanon/.claude-plugin/plugin.json \
  .claude-plugin/marketplace.json
# Expected: at least 2 hits in lockfile (root + self-ref); no 0.1.4 in lockfile
grep -c '"version": "0.1.5"' plugins/arcanon/package-lock.json
grep -c '"version": "0.1.4"' plugins/arcanon/package-lock.json   # must be 0
# JSON validity belt-and-suspenders
jq empty plugins/arcanon/package.json
jq empty plugins/arcanon/.claude-plugin/plugin.json
jq empty .claude-plugin/marketplace.json
jq empty plugins/arcanon/package-lock.json
```

**Note on the spec's "repo-root package.json":** REQ VER-01 lists a repo-root
`package.json` as one of the 4 manifests. No such file exists today (verified
via `ls /Users/ravichillerega/sources/arcanon/package.json` and
`git log -- package.json`). The "4 manifests" wording refers to the 3 files
above plus the lockfile, matching the v0.1.4 audit's accounting (which counted
6 version strings across "4 manifest files"). Do NOT create a repo-root
`package.json` to satisfy the wording — it would be an unowned manifest with
no purpose and would invent a new release surface to maintain.

**Commit (atomic):**
```
chore(127): bump manifests to 0.1.5 + regen lockfile (VER-01)
```
  </action>
  <verify>
    <automated>
test "$(grep -c '"version": "0.1.5"' plugins/arcanon/package.json plugins/arcanon/.claude-plugin/plugin.json .claude-plugin/marketplace.json | awk -F: '{s+=$2} END {print s}')" -eq 4 \
  && test "$(grep -c '"version": "0.1.4"' plugins/arcanon/package.json plugins/arcanon/.claude-plugin/plugin.json .claude-plugin/marketplace.json | awk -F: '{s+=$2} END {print s}')" -eq 0 \
  && test "$(grep -c '"version": "0.1.4"' plugins/arcanon/package-lock.json)" -eq 0 \
  && jq empty plugins/arcanon/package.json \
  && jq empty plugins/arcanon/.claude-plugin/plugin.json \
  && jq empty .claude-plugin/marketplace.json \
  && jq empty plugins/arcanon/package-lock.json
    </automated>
  </verify>
  <done>
3 hand-edited manifests show exactly 4 `"version": "0.1.5"` strings and zero
`"version": "0.1.4"` strings; package-lock.json shows zero `"version": "0.1.4"`;
all four files are valid JSON; the bump is committed atomically as
`chore(127): bump manifests to 0.1.5 + regen lockfile (VER-01)`.
  </done>
</task>

<task type="auto">
  <name>Task 2: Pin CHANGELOG [0.1.5] section with categorized entries</name>
  <files>plugins/arcanon/CHANGELOG.md</files>
  <action>
**Goal:** transform the current `## [Unreleased]` placeholder (line 7 of
CHANGELOG.md, today empty above the `## [0.1.4]` heading) into a pinned
`## [0.1.5] - <YYYY-MM-DD>` section with `### BREAKING`, `### Added`, and
`### Changed` subsections, then re-introduce a fresh empty `## [Unreleased]`
heading above it for v0.1.6 work.

**Date:** use `$(date -u +%Y-%m-%d)` — the actual ship date (UTC) at the
moment of the commit.

**Exact replacement** — replace lines 7–8 of CHANGELOG.md (the current
`## [Unreleased]` heading and the blank line below it):

```markdown
## [Unreleased]

## [0.1.5] - YYYY-MM-DD

### BREAKING

- **Hub-side dependency on arcanon-hub THE-1030.** The plugin's `/arcanon:sync`
  upload path now requires the hub to honor THE-1030 (personal-credential
  rewrite + `GET /api/v1/auth/whoami` + `X-Org-Id` enforcement). Pointing
  v0.1.5 at a pre-THE-1030 hub WILL fail at upload time with a clear error.
  Coordinate the upgrade with your arcanon-hub deployment.
- **Existing v0.1.4 users must re-run `/arcanon:login` after upgrade.** The
  on-disk credential file `~/.arcanon/config.json` gains a new
  `default_org_id` field (AUTH-04). Previously-stored credential pairs
  (`api_key` + `hub_url` only) cannot resolve an `orgId` → `/arcanon:sync`
  fails fast with `AuthError: missing org id` naming the three resolution
  sources (`opts.orgId` → `ARCANON_ORG_ID` env → `~/.arcanon/config.json`
  `default_org_id`) and the remediation `/arcanon:login --org-id <uuid>`.
  No silent breakage: the error message is actionable.
- **`uploadScan(payload, opts)` signature requires `opts.orgId` (AUTH-01).**
  Internal API only — no public-facing breakage. External tooling that
  imported `worker/hub-sync/client.js` directly must thread an org id.

### Added

- **`X-Org-Id` header on every scan upload** (AUTH-01). `uploadScan` sends
  the resolved org id on every POST to `${hubUrl}/api/v1/scans/upload`.
  Missing `orgId` throws `HubError(status=400, code='missing_org_id')`
  before any network call. No retry on missing-org-id (it would never
  succeed).
- **`worker/hub-sync/whoami.js` module** (AUTH-02). New module exporting
  `getKeyInfo(apiKey, hubUrl)` that calls `GET /api/v1/auth/whoami` and
  returns `{ user_id, key_id, scopes, grants }`. Auth-class HTTP errors
  throw `AuthError`; transport errors throw `HubError`.
- **`/arcanon:login [arc_xxx] [--org-id <uuid>]` whoami flow** (AUTH-06).
  With `--org-id`: store the credential triple after a `whoami` verification
  pass (warn-but-allow if the key isn't authorized for that org — the hub
  rejects at upload time anyway). Without `--org-id`: call `whoami` and
  branch — exactly **1 grant** auto-selects, **N grants** prompt via
  AskUserQuestion, **0 grants** fail loud with "key has no org grants —
  ask your admin". Hub-unreachable case: store the credential anyway with
  the user-supplied `--org-id` (if given), emit a WARN that grants couldn't
  be verified.
- **Identity block in `/arcanon:status`** (AUTH-07). Renders resolved org
  id + source (env / repo config / machine default), key preview
  (`arc_xxxx…1234`), scopes, and the list of orgs the key is authorized
  for. Shows `(missing)` when no org id resolves. `--json` mode emits
  `identity: {…}` as a nested object (no top-level field churn for
  existing JSON consumers).
- **`worker/lib/path-mask.js` module** (PII-01). Exports `maskHome(p)`
  (`$HOME` prefix → `~`; idempotent; non-string passes through; exact-`$HOME`
  match returns `~`) and `maskHomeDeep(obj)` (walks an object/array,
  masks any string property whose key is path-y: `path`, `repo_path`,
  `source_file`, `target_file`, `root_path`, plus a configurable allowlist).
- **`ARCANON_ORG_ID` environment variable** (AUTH-03). Mid-precedence
  source for org id: `opts.orgId` → `ARCANON_ORG_ID` env →
  `~/.arcanon/config.json` `default_org_id`.
- **`arcanon.config.json hub.org_id` per-repo override** (AUTH-05).
  Threaded into `uploadScan` ahead of the resolver chain (per-repo override
  beats env beats machine default).
- **Server error code parsing on `uploadScan` failures** (AUTH-08).
  Recognized: `missing_x_org_id`, `invalid_x_org_id`, `insufficient_scope`,
  `key_not_authorized_for_org`, `not_a_member`, `forbidden_scan`,
  `invalid_key`. Each surfaces a user-actionable message; unknown codes
  fall back to the existing RFC 7807 `body.title` rendering. `HubError`
  gains a `.code` field (string|null) without breaking `.status`,
  `.retriable`, `.body`, `.attempts`.
- **PII test gates** (PII-07). New `worker/lib/path-mask.test.js`
  (round-trip cases). New bats grep-assertions in `commands-surface.bats`
  (or `pii-egress.bats`) confirming no `/Users/` strings appear in MCP
  tool responses (`tools/list` + sample tool call), default-mode
  `/arcanon:export` outputs, `/api/scan-freshness` JSON, or worker log
  lines after a clean scan.
- **Auth test suite** (AUTH-10). New `worker/hub-sync/whoami.test.js`
  (parsed grants; auth error → `AuthError`; network error → `HubError`).
  Extended `client.test.js` (`X-Org-Id` lands; missing-orgId throws before
  fetch; each of the 7 server error codes produces its own
  `HubError`; success → `scan_upload_id`). Extended `integration.test.js`
  (`/arcanon:login` round-trips with/without `--org-id`; resolution-order
  precedence: per-repo `hub.org_id` beats `ARCANON_ORG_ID` beats
  `default_org_id`).

### Changed

- **`resolveCredentials(opts)` return shape** (AUTH-03). Now returns
  `{ apiKey, hubUrl, orgId, source }` (was `{ apiKey, hubUrl, source }`).
  Strict superset — existing destructures `{ apiKey, hubUrl }` continue
  to work. Missing org id throws `AuthError` whose message names the
  three resolution sources and suggests `/arcanon:login --org-id <uuid>`.
- **`storeCredentials()` persists the credential triple** (AUTH-04).
  `~/.arcanon/config.json` mode 0600 now contains
  `{ api_key, hub_url, default_org_id }`. The existing spread-merge
  preserves unknown keys; existing `api_key` / `hub_url` are not clobbered
  on incremental writes.
- **MCP tool responses are masked** (PII-02). Every MCP tool response
  payload referencing `repo.path`, `path`, `source_file`, `target_file`,
  or `root_path` runs through `maskHomeDeep` before returning to the
  client. **Highest priority** — only egress to a third party (Anthropic).
- **HTTP responses are masked** (PII-03). `/api/scan-freshness`,
  `/projects`, and `/graph` responses run through `maskHomeDeep` before
  serialization. The `repo_path` projection from `query-engine.js:1591`
  is masked at the response boundary, not in the DB.
- **Worker logger masks `extra` and stack traces** (PII-04). A single
  masking seam in `worker/lib/logger.js` (between the `Object.assign(lineObj,
  extra)` merge and the `JSON.stringify` serialize) routes all log output
  through `maskHomeDeep`. Stack-trace strings inside `extra.stack` are
  also masked. Console (TTY) output uses the same path.
- **CLI exporters mask repo paths** (PII-05). `worker/cli/export*.js` —
  mermaid, dot, and html exports run repo path strings through
  `maskHome` before emitting.
- **`parseAgentOutput` rejects absolute `source_file` values** (PII-06).
  `worker/scan/findings.js` logs WARN with the offending value (also
  masked), drops the field, does not fail the scan. Belt-and-suspenders
  against future agent regressions; the agent prompt contract already
  mandates relative paths.
- **`_readHubConfig` reads `cfg.hub.org_id`** (AUTH-05). `worker/scan/manager.js`
  threads the per-repo override into `uploadScan` ahead of the resolver
  chain.
- **`commands/login.md`, `arcanon.config.json.example`, `docs/hub-integration.md`,
  `docs/getting-started.md`, `docs/configuration.md`** (AUTH-09). Document
  the new `default_org_id` field, the `ARCANON_ORG_ID` env var, the
  `/arcanon:login --org-id <uuid>` flow, and the resolution order.
```

**Notes on the format:**

- Date format `YYYY-MM-DD` matches v0.1.4 (`## [0.1.4] - 2026-04-27`) and
  v0.1.3 precedent.
- Keep `### BREAKING` first (matches v0.1.3 precedent at line 161).
- `### Fixed` and `### Removed` are intentionally omitted — v0.1.5 ships no
  bug fixes and removes no surfaces. (If a phase 123–126 SUMMARY indicates
  otherwise at execution time, add the missing subsection — Keep-a-Changelog
  conventions take precedence over this draft.)
- The fresh empty `## [Unreleased]` heading at the top is REQUIRED per
  Keep-a-Changelog 1.1.0 (it's the link target for "what's brewing").

**Commit (atomic):**
```
docs(127): pin CHANGELOG [0.1.5] section (VER-02)
```
  </action>
  <verify>
    <automated>
grep -q '^## \[0.1.5\] - 20[0-9][0-9]-[0-9][0-9]-[0-9][0-9]' plugins/arcanon/CHANGELOG.md \
  && grep -q '^### BREAKING' plugins/arcanon/CHANGELOG.md \
  && grep -q '^### Added' plugins/arcanon/CHANGELOG.md \
  && grep -q '^### Changed' plugins/arcanon/CHANGELOG.md \
  && grep -q 'THE-1030' plugins/arcanon/CHANGELOG.md \
  && grep -q '/arcanon:login --org-id' plugins/arcanon/CHANGELOG.md \
  && grep -q 'X-Org-Id' plugins/arcanon/CHANGELOG.md \
  && grep -q 'maskHome' plugins/arcanon/CHANGELOG.md \
  && head -8 plugins/arcanon/CHANGELOG.md | grep -q '^## \[Unreleased\]'
    </automated>
  </verify>
  <done>
CHANGELOG.md has a `## [0.1.5] - <date>` section directly below a fresh
`## [Unreleased]` heading. The 0.1.5 section contains `### BREAKING`,
`### Added`, and `### Changed` subsections in that order. The BREAKING
section names THE-1030 explicitly and prescribes `/arcanon:login --org-id <uuid>`
as the upgrade remediation. The Added section names `X-Org-Id`, `whoami`,
the Identity block, and `path-mask`. Commit is atomic as `docs(127): pin
CHANGELOG [0.1.5] section (VER-02)`.
  </done>
</task>

<task type="auto">
  <name>Task 3: Run full bats + node test suites green (VER-03)</name>
  <files>
    <!-- No file edits in this task — invocation only. Failures here -->
    <!-- gate the phase; fixes go back to phases 123-126, not here. -->
  </files>
  <action>
**Goal:** prove `make test` (bats) AND `npm test` (node, run from
`plugins/arcanon/`) both exit 0 with no new pre-existing-mock carryforwards
relative to the v0.1.4 baseline (bats 448/449, node 774/775).

**Run order — bats first (faster), node second:**

```bash
# 1. Bats — at repo root
make test 2>&1 | tee /tmp/127-bats.log
echo "BATS EXIT: $?"

# 2. Node — inside plugins/arcanon/
cd plugins/arcanon && npm test 2>&1 | tee /tmp/127-node.log
echo "NODE EXIT: $?"
cd ../..
```

**Acceptance — both must hold:**

1. `make test` exits 0. Acceptable carryforward flakes (do not block):
   - `tests/impact-hook.bats` HOK-06 p99 latency (environmental — passes
     on clean dev boxes; carry-forward from v0.1.4).
   - **Anything else failing is a regression** — go back to phase 123–126
     to fix. DO NOT skip / disable / mark expected-failure here.

2. `npm test` exits 0 inside `plugins/arcanon/`. Acceptable carryforward
   flakes:
   - `worker/mcp/server-search.test.js` "queryScan: returns unavailable
     when port file does not exist" — leaks the user's real
     `~/.arcanon/worker.port`; passes on clean dev boxes; carry-forward
     from v0.1.4. **Anything else failing is a regression.**

3. **Count diff vs v0.1.4 baseline.** Phases 123–126 added tests; the
   counts must rise, not fall. Expected ranges (informational, not gating):
   - bats: ≥ 460 (v0.1.4 floor + Phase 123 PII-07 grep tests + a few new
     auth bats from 125–126).
   - node: ≥ 790 (v0.1.4 floor + `path-mask.test.js` round-trips + extended
     `client.test.js` + new `whoami.test.js` + extended `integration.test.js`).
   If counts are LOWER, something was deleted that shouldn't have been —
   investigate before proceeding.

4. **No new pre-existing-mock carryforwards.** A "carryforward" is a node
   test asserting "this is mocked because the real thing breaks" beyond
   the v0.1.4-baseline `server-search.test.js` worker-port flake. Grep
   for any new `it.skip`, `test.skip`, `// FIXME`, `// PRE-EXISTING`,
   `// FLAKE` markers introduced in v0.1.5 work and reject:
   ```bash
   git diff v0.1.4..HEAD -- 'plugins/arcanon/worker/**/*.test.js' \
     | grep -E '^\+.*(\.skip|FIXME|PRE-EXISTING|FLAKE|carryforward)' \
     || echo "OK: no new pre-existing-mock carryforwards"
   ```

5. **Capture exit codes + counts in the SUMMARY.** Save `/tmp/127-bats.log`
   and `/tmp/127-node.log` excerpts (the "ok N" / "not ok N" lines and the
   final summary) into the phase SUMMARY artifact for the milestone audit.

**If either suite fails non-flake:** stop, do NOT commit anything in this
task, return to the appropriate phase (123–126) and fix the regression
there. The release gate is a verification, not a fix layer.

**No commit at the end of this task** — it's pure verification. The
SUMMARY produced at end of phase records the counts.
  </action>
  <verify>
    <automated>
make test > /tmp/127-bats-verify.log 2>&1; BATS_EXIT=$?
(cd plugins/arcanon && npm test) > /tmp/127-node-verify.log 2>&1; NODE_EXIT=$?
test "$BATS_EXIT" -eq 0 && test "$NODE_EXIT" -eq 0
    </automated>
  </verify>
  <done>
`make test` exits 0; `npm test` (run inside `plugins/arcanon/`) exits 0.
Bats count ≥ 460; node count ≥ 790. Only the two v0.1.4-baseline flakes
(`impact-hook` HOK-06 perf + `server-search` worker-port env-leak) appear
in the failure-or-skip rows. No new `.skip` / `FIXME` / pre-existing-mock
carryforwards introduced in `worker/**/*.test.js` since the v0.1.4 tag.
Both logs (`/tmp/127-bats.log`, `/tmp/127-node.log`) captured for the
SUMMARY artifact.
  </done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 4: End-to-end manual verification against a real hub honoring THE-1030 (VER-04)</name>
  <what-built>
The full v0.1.5 surface — auth (AUTH-01..09 across phases 124-125), PII
masking (PII-01..06 in phase 123), and the auth test pin (AUTH-10 in
phase 126) — has shipped, manifests are at 0.1.5, CHANGELOG is pinned.
This checkpoint confirms the surface actually works against a real hub.
  </what-built>
  <how-to-verify>

**Pre-flight (operator, before starting):**

1. Confirm a hub URL with arcanon-hub THE-1030 deployed and reachable. Note
   the URL: `_______________________________________________`
2. Confirm a live `arc_…` API key authorized for ≥1 org. Note the org id
   you expect to be auto-selected (should be the only grant if N=1):
   `_______________________________________________`
3. Confirm a workstation reachable to that hub (curl smoke):
   ```bash
   curl -fsS -H "Authorization: Bearer arc_xxxxxxxx..." \
     "${HUB_URL}/api/v1/auth/whoami" | jq .
   # Expected: { "user_id": "...", "key_id": "...", "scopes": [...], "grants": [...] }
   # If 404 or 5xx: hub is NOT honoring THE-1030 yet — STOP, do not proceed.
   ```
4. Back up the operator's existing `~/.arcanon/config.json` (the walkthrough
   will overwrite it):
   ```bash
   cp ~/.arcanon/config.json ~/.arcanon/config.json.pre-127-backup
   ```
5. Pick a real Arcanon-scanned project to upload from (`arcanon.config.json`
   present, prior `/arcanon:map` run). Note the path:
   `_______________________________________________`

**Walkthrough — execute these 4 steps in order. Mark each PASS / FAIL.
Any FAIL blocks the phase.**

---

**Step 1: `/arcanon:login` round-trip against the real hub.**

```bash
# Inside Claude Code, in the chosen project directory:
/arcanon:login arc_xxxxxxxx...
```

Expected behavior — pick the matching branch:

- **If the key has exactly 1 grant:** auto-select. Output should announce:
  ```
  Logged in. Default org: <org-name> (<uuid>) — auto-selected (only authorized org).
  Stored to ~/.arcanon/config.json (mode 0600).
  ```
- **If the key has N>1 grants:** prompt via AskUserQuestion. Pick one
  manually. Output should announce the selection and persist.
- **If the key has 0 grants:** the command MUST fail loud with "key has no
  org grants — ask your admin". (If you have a 0-grant test key, run this
  branch too. Otherwise skip.)

After login, verify the on-disk file:
```bash
jq . ~/.arcanon/config.json
# Expected keys: api_key, hub_url, default_org_id (all 3 present)
ls -l ~/.arcanon/config.json
# Expected mode: -rw------- (0600)
```

PASS / FAIL: `_____________`
Notes (org name auto-selected, prompt branch hit, file mode):
`______________________________________________________________`

---

**Step 2: `/arcanon:status` shows the Identity block.**

```bash
/arcanon:status
```

Expected — the Identity block must contain (per AUTH-07):

- `Org: <org-name> (<uuid>) — source: machine default` (or `repo config` /
  `env` if you've set `cfg.hub.org_id` or `ARCANON_ORG_ID` for this run)
- `Key: arc_xxxx…<last4>` (preview, not the full key)
- `Scopes: [scan:write, ...]` (whatever the key has)
- `Authorized orgs: <name1> (<uuid1>), <name2> (<uuid2>), ...`

JSON-mode check:
```bash
/arcanon:status --json | jq .identity
# Expected: nested {org_id, org_name, source, key_preview, scopes, authorized_orgs}
# Top-level fields unchanged from v0.1.4 (no field-name churn at the root).
```

PASS / FAIL: `_____________`
Notes (Identity block fields visible, --json identity nested):
`______________________________________________________________`

---

**Step 3: MCP tool response inspection — zero `/Users/` strings.**

The plugin's MCP server is auto-started. The cleanest way to inspect a
tool response is via the MCP wrapper's stdio transport — but that's
awkward for a manual walkthrough. Easier: hit the worker HTTP surfaces
that the MCP tools wrap (since PII-02 and PII-03 share the same masking
seam, and PII-02 is the one Claude actually consumes).

```bash
# 3a. Hit /graph (consumed by the graph UI; same masking as MCP tools)
curl -fsS http://127.0.0.1:${ARCANON_WORKER_PORT:-$(cat ~/.arcanon/worker.port)}/graph \
  | tee /tmp/127-graph.json \
  | grep -c '/Users/'
# Expected: 0

# 3b. Hit /api/scan-freshness
curl -fsS http://127.0.0.1:${ARCANON_WORKER_PORT:-$(cat ~/.arcanon/worker.port)}/api/scan-freshness \
  | tee /tmp/127-freshness.json \
  | grep -c '/Users/'
# Expected: 0

# 3c. Sanity check the masking ACTUALLY applied (we expect ~ prefixes,
# not just absence of /Users/ — a fully empty response would also have 0
# hits and falsely pass).
grep -c '"~/' /tmp/127-graph.json
# Expected: ≥ 1 (your scanned repos under $HOME show up as `~/...`)

# 3d. (optional, gold-standard) — drive an MCP tool directly
# Inside Claude Code: ask Claude to call `impact_query` on a known service
# in the project. In Claude's response, search for `/Users/` — must be 0.
```

PASS / FAIL: `_____________`
Notes (counts from 3a/3b/3c, MCP tool call inspected):
`______________________________________________________________`

---

**Step 4: `/arcanon:sync` upload with `X-Org-Id` landing server-side.**

```bash
# 4a. Run the upload from the chosen project directory
/arcanon:sync
# Expected: succeeds; emits `scan_upload_id: <uuid>` from the hub response.
# If it fails with `missing_org_id` → AUTH-03 resolution chain is broken,
# go back to phase 124. If it fails with `key_not_authorized_for_org` →
# wrong org id was stored, redo Step 1 with `--org-id <correct-uuid>`.
```

**Server-side proof of `X-Org-Id` landing.** The plugin alone cannot prove
the header arrived at the server — that requires the operator with hub
admin access:

```bash
# 4b. Fetch the upload row from the hub (hub admin tooling) and inspect
# its `received_headers` / `org_id_observed` field (depends on what
# THE-1030 records). Acceptable proofs:
#   - hub admin endpoint shows `org_id == <uuid stored in step 1>`
#   - hub access log line shows `X-Org-Id: <uuid>`
#   - hub DB row shows the upload tagged to the correct org
#
# OR — simpler — if your hub instance has a debug echo endpoint:
# curl -fsS -H "Authorization: Bearer arc_..." \
#   -H "X-Org-Id: <uuid>" \
#   "${HUB_URL}/api/v1/debug/echo-headers"
# (proves the header travels; not a substitute for proof on the real
# upload path, but a useful smoke test.)
```

PASS / FAIL: `_____________`
Server-side evidence (admin endpoint, log line, or DB row):
`______________________________________________________________`

---

**After the walkthrough:**

```bash
# Restore the operator's pre-test config if it was overwritten with a
# different credential triple than they want to keep
mv ~/.arcanon/config.json.pre-127-backup ~/.arcanon/config.json
```

(Or keep the new triple if it's the operator's intended steady state.)

  </how-to-verify>
  <resume-signal>
Reply with one of:

- `approved — VER-04 e2e walkthrough PASSED on all 4 steps; <hub-url>; logs in /tmp/127-graph.json + /tmp/127-freshness.json`
- `blocked — step <N> failed: <one-line description>` — phase BLOCKS, return to fix in phase 123–126.
- `blocked — hub THE-1030 not deployed at <url>` — phase BLOCKS until hub-side ships.

Do NOT ship v0.1.5 without an `approved` line.
  </resume-signal>
</task>

</tasks>

<threat_model>

## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| operator workstation → real hub | THE-1030 hub is the upload destination; auth header lands here |
| MCP tool stdio → Anthropic | Third-party egress; PII-02 masks here |
| `~/.arcanon/config.json` → process memory | Mode-0600 file; resolveCredentials reads |
| CHANGELOG.md → public | Notice of BREAKING + remediation flows to operators of v0.1.4 |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-127-01 | I (Information disclosure) | CHANGELOG drafting | mitigate | The CHANGELOG draft contains no real api keys, no org uuids, no hub URLs — only placeholders. Operator must verify before commit. Task 2 verify step does not grep for secrets (none in the draft) but the file is reviewed in the commit hunk. |
| T-127-02 | T (Tampering) | manifest bumps | mitigate | Atomic commit (Task 1) ensures the 4 manifest files + lockfile move together. Reverting v0.1.5 is `git revert <bump-sha>`. Partial commits would leave inconsistent versions across files. |
| T-127-03 | I (Information disclosure) | e2e walkthrough — Step 3 grep | accept | The grep is `/Users/` — narrow to macOS-style HOME prefix. Linux operators run on `/home/<user>/...` — extend the grep to include `/home/` if the operator runs on Linux. The `~/` positive-control check (Step 3c) backstops false-pass on empty responses. |
| T-127-04 | S (Spoofing) | e2e walkthrough — Step 4 server-side proof | mitigate | The walkthrough requires hub admin proof (admin endpoint / access log / DB row) that `X-Org-Id` landed on the upload — the plugin alone cannot prove this. Operator must have hub admin access; if not, the phase BLOCKS until they do. No "trust the plugin's success message" shortcut. |
| T-127-05 | D (Denial of service) | Task 3 test suites | accept | The two known flakes (`impact-hook` HOK-06 perf, `server-search` worker-port env-leak) are both environmental and reproduce on the operator's machine but not on clean dev boxes. Carry-forward only — no new flakes accepted. |
| T-127-06 | E (Elevation of privilege) | `/arcanon:login --org-id <uuid>` warn-but-allow | mitigate | Already mitigated in phase 125 design: warn-but-allow only stores the credential; the hub still rejects at upload time if the key isn't authorized for that org. The walkthrough's Step 4 will catch this (`key_not_authorized_for_org` error code). |
| T-127-07 | R (Repudiation) | release ship | mitigate | The atomic commit chain (Task 1, 2) plus the operator's `approved` line on Task 4 forms the audit trail. No silent ship. |

</threat_model>

<verification>

**Phase-wide acceptance gate** — every line below MUST be true before
the milestone-audit step closes v0.1.5:

1. **Manifests pinned.** `grep -c '"version": "0.1.5"'` returns 4 across the
   3 hand-edited files; 0 returns of `0.1.4` in those 3 files; 0 returns of
   `0.1.4` in `plugins/arcanon/package-lock.json`. JSON valid in all 4.
2. **CHANGELOG pinned.** `## [0.1.5] - <YYYY-MM-DD>` heading present, with
   `### BREAKING` first, naming `THE-1030` and the
   `/arcanon:login --org-id <uuid>` remediation. Fresh empty `## [Unreleased]`
   above it.
3. **bats green.** `make test` exit 0; ≥ 460 tests; no failures except
   the v0.1.4-baseline `impact-hook` HOK-06 perf flake.
4. **node green.** `cd plugins/arcanon && npm test` exit 0; ≥ 790 tests; no
   failures except the v0.1.4-baseline `server-search` worker-port env-leak.
5. **No new pre-existing-mock carryforwards.** `git diff v0.1.4..HEAD -- 'plugins/arcanon/worker/**/*.test.js'`
   shows zero new `.skip` / `FIXME` / `PRE-EXISTING` / `FLAKE` markers.
6. **e2e walkthrough PASSED.** Operator returned an `approved` resume-signal
   on Task 4 covering all 4 steps (login, status Identity block, MCP zero
   `/Users/`, sync with server-side `X-Org-Id` proof).

**Ship-block list — if ANY of the below is true, do NOT tag v0.1.5:**

- [ ] Any of the 4 manifest files contain a `0.1.4` string
- [ ] CHANGELOG `## [0.1.5]` heading missing OR missing `### BREAKING` OR
      missing the `THE-1030` token OR missing `/arcanon:login --org-id`
- [ ] `make test` exit non-zero
- [ ] `npm test` (inside `plugins/arcanon/`) exit non-zero
- [ ] New `.skip` / `FIXME` / `PRE-EXISTING` markers since v0.1.4 tag
- [ ] Operator did NOT return `approved` for Task 4 — OR returned `approved`
      but Step 4 (the upload + server-side `X-Org-Id` proof) was skipped or
      partially observed

</verification>

<success_criteria>

Phase 127 success when, simultaneously:

1. **VER-01 — manifest pin.** 4 manifests at `0.1.5`, lockfile regenerated,
   committed atomically as `chore(127): bump manifests to 0.1.5 + regen lockfile (VER-01)`.
2. **VER-02 — CHANGELOG pin.** `[0.1.5] - <ship-date>` section with
   `### BREAKING` (THE-1030 + upgrade path), `### Added` (X-Org-Id, whoami,
   Identity block, path-mask, env var, per-repo override, error codes, tests),
   `### Changed` (resolveCredentials shape, storeCredentials triple, MCP /
   HTTP / logger / exporter masking, parseAgentOutput rejection, _readHubConfig,
   docs). Fresh `## [Unreleased]` heading above. Committed atomically as
   `docs(127): pin CHANGELOG [0.1.5] section (VER-02)`.
3. **VER-03 — suites green.** `make test` exits 0; `npm test` (inside
   `plugins/arcanon/`) exits 0; counts ≥ v0.1.4 floor + 12 (PII-07 +
   AUTH-10 additions); no new pre-existing-mock carryforwards. Logs
   captured for milestone audit.
4. **VER-04 — e2e walkthrough.** Operator-confirmed PASS on all 4 steps:
   login round-trip, status Identity block, MCP zero-`/Users/`, sync with
   server-side `X-Org-Id` evidence.

After all four pass: `gsd-complete-milestone v0.1.5` is the next operator
action. Tagging, GitHub release, and merge mechanics are explicitly out of
scope for this phase.

</success_criteria>

<output>
After completion, create `.planning/phases/127-verification-and-release-gate/127-01-SUMMARY.md`
recording:

- Manifest bump commit SHA
- CHANGELOG pin commit SHA
- bats final count + exit code (e.g., "464/465 — 1 carryforward HOK-06")
- node final count + exit code (e.g., "812/813 — 1 carryforward server-search worker-port")
- Operator's `approved` resume-signal verbatim, with the hub URL used
- Per-step PASS/FAIL marks from Task 4
- Server-side evidence type for Step 4b (admin endpoint / log line / DB row)
- Any deferred items at ship (expect zero — surface them loudly if any)

The SUMMARY is what the milestone-audit step reads to close v0.1.5.
</output>
