---
phase: 123-pii-path-masking
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - plugins/arcanon/worker/lib/path-mask.js
  - plugins/arcanon/worker/lib/path-mask.test.js
  - plugins/arcanon/worker/mcp/server.js
  - plugins/arcanon/worker/server/http.js
  - plugins/arcanon/worker/lib/logger.js
  - plugins/arcanon/worker/cli/export.js
  - plugins/arcanon/worker/scan/findings.js
  - plugins/arcanon/worker/scan/agent-prompt-service.md
  - tests/pii-masking.bats
autonomous: true
requirements:
  - PII-01
  - PII-02
  - PII-03
  - PII-04
  - PII-05
  - PII-06
  - PII-07
must_haves:
  truths:
    - "After a clean scan, every MCP tool call (impact_query, impact_changed, impact_graph, impact_search, impact_scan) returns a response containing zero `/Users/` or `/home/` strings — repo_path / root_path / source_file / target_file are all `~`-prefixed (PII-02)"
    - "After a clean scan, ~/.arcanon/logs/worker.log contains zero absolute $HOME paths — `extra` fields and `extra.stack` frames are masked (PII-04)"
    - "Default-mode /arcanon:export outputs (mermaid, dot, html) contain zero `/Users/` or `/home/` strings (PII-05)"
    - "GET /graph, GET /api/scan-freshness, and GET /projects HTTP responses contain zero absolute $HOME paths in any nested repos[].path array or per-service repo_path field (PII-03)"
    - "When the scanning agent emits a connection with absolute source_file, the field is dropped with a WARN log; the connection still persists with its other fields; the scan does NOT fail (PII-06)"
    - "maskHome on already-relative paths (e.g. 'src/') round-trips unchanged — agent-emitted relative paths are never re-masked (S1 mitigation)"
  artifacts:
    - path: "plugins/arcanon/worker/lib/path-mask.js"
      provides: "Egress masking primitive (maskHome + maskHomeDeep)"
      exports: ["maskHome", "maskHomeDeep", "PATHY_KEYS"]
    - path: "plugins/arcanon/worker/lib/path-mask.test.js"
      provides: "PII-07 unit tests — round-trips, idempotency, deep walk, M1 + S1 pins"
    - path: "tests/pii-masking.bats"
      provides: "PII-07 integration assertions — zero `/Users/` strings on every egress seam after a clean scan"
    - path: "plugins/arcanon/worker/mcp/server.js"
      provides: "MCP tool responses masked at egress (PII-02)"
    - path: "plugins/arcanon/worker/server/http.js"
      provides: "/projects, /graph, /api/scan-freshness responses masked at egress (PII-03)"
    - path: "plugins/arcanon/worker/lib/logger.js"
      provides: "Single-seam log masking between Object.assign and JSON.stringify (PII-04, M1)"
    - path: "plugins/arcanon/worker/cli/export.js"
      provides: "Mermaid/DOT/HTML emitters mask repo paths (PII-05)"
    - path: "plugins/arcanon/worker/scan/findings.js"
      provides: "parseAgentOutput rejects absolute source_file (PII-06)"
  key_links:
    - from: "plugins/arcanon/worker/mcp/server.js"
      to: "plugins/arcanon/worker/lib/path-mask.js"
      via: "maskHomeDeep wraps each tool's `content[].text` payload before JSON.stringify"
      pattern: "maskHomeDeep\\("
    - from: "plugins/arcanon/worker/server/http.js"
      to: "plugins/arcanon/worker/lib/path-mask.js"
      via: "maskHomeDeep wraps reply.send body for /graph, /api/scan-freshness, /projects"
      pattern: "reply\\.send\\(maskHomeDeep"
    - from: "plugins/arcanon/worker/lib/logger.js"
      to: "plugins/arcanon/worker/lib/path-mask.js"
      via: "Single edit between Object.assign(lineObj, extra) and JSON.stringify (lines 59-61)"
      pattern: "maskHomeDeep\\(lineObj\\)"
    - from: "plugins/arcanon/worker/cli/export.js"
      to: "plugins/arcanon/worker/lib/path-mask.js"
      via: "loadGraph result run through maskHomeDeep before toMermaid/toDot/toHtml"
      pattern: "maskHomeDeep\\(graph\\)"
    - from: "plugins/arcanon/worker/scan/findings.js"
      to: "plugins/arcanon/worker/lib/path-mask.js"
      via: "absolute source_file → WARN with maskHome(value) + drop field (X2 mitigation)"
      pattern: "source_file.*startsWith"
---

<objective>
Stop `$HOME` paths leaking from any worker egress seam. Land a single masking primitive (`worker/lib/path-mask.js`), wire it at four egress seams (MCP responses, HTTP responses, worker logger, exports), and harden the agent contract against future regressions.

Purpose: Closes the third-party PII leak (MCP responses go to Anthropic) and fixes the broader `$HOME` exposure across logs, exports, and HTTP. The masking happens at egress only — the DB still stores absolute paths because git operations need them. This is the **independent** half of milestone v0.1.5 — it ships even if hub-side THE-1030 slips.

Output: New helper module + tests + 4 single-seam egress edits + 1 defensive agent-contract assertion + 1 bats integration suite. Three execution waves keep the diff coherent: Wave 1 ships the primitive; Wave 2 wires four parallel seams; Wave 3 adds the belt-and-suspenders contract assertion plus the cross-seam grep test.
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

@plugins/arcanon/worker/lib/logger.js
@plugins/arcanon/worker/scan/findings.js
@plugins/arcanon/worker/lib/repo-resolver.test.js

<interfaces>
<!-- Conventions and call shapes the executor needs. Do NOT explore the codebase to find these. -->

ESM module style. `import fs from "node:fs";` — confirmed in `worker/lib/logger.js`.

Test runner: `node --test` against colocated `*.test.js` files. Canonical example: `worker/lib/repo-resolver.test.js`. No Jest, no Vitest.

Bats test runner: tests live at `tests/*.bats` (repo root, NOT `plugins/arcanon/tests/`). 15+ existing files confirm convention. Examples: `tests/structure.bats`, `tests/mcp-server.bats`, `tests/correct.bats`. New file goes at `tests/pii-masking.bats`.

Path-y key allowlist (PII-01): `path`, `repo_path`, `source_file`, `target_file`, `root_path`. Per M1 mitigation, `maskHomeDeep` masks ALL string values it walks past (not just keys in this set), so unkeyed stack frames inside `extra.stack` are also masked.

Existing logger seam (`worker/lib/logger.js:42-68`):
```js
function log(level, msg, extra = {}) {
  if (LEVELS[level] < LEVELS[logLevel]) return;
  const lineObj = { ts: ..., level, msg, pid: process.pid };
  if (port !== undefined && port !== null) lineObj.port = port;
  lineObj.component = component;
  Object.assign(lineObj, extra);             // line 59
  // ← INSERT MASKING HERE (single seam, M1 mitigation)
  const line = JSON.stringify(lineObj);     // line 61
  // ...
}
```

MCP tool response shape (`worker/mcp/server.js`, ~9 sites at lines 1255, 1303, 1344, 1385, 1429, 1456, 1481, 1506, 1572):
```js
return { content: [{ type: "text", text: JSON.stringify(result) }] };
```
Mask `result` BEFORE `JSON.stringify`: `JSON.stringify(maskHomeDeep(result))`.

HTTP route response shape (`worker/server/http.js`):
- `/api/scan-freshness` (line 326-379) — `reply.send({ last_scan_iso, last_scan_age_seconds, scan_quality_pct, repos: [{name, path, ...}] })` — `repos[].path` is the absolute repo path from SQLite. Wrap the whole body.
- `/graph` (line 548-583) — `reply.send({ ...graph, boundaries })` where `graph = qe.getGraph()` returns `{services: [{root_path, repo_path, repo_name, ...}], connections, actors, ...}`. Wrap before send.
- `/projects` (line 538-544) — `reply.send(listProjects())` — pool.js returns `[{path, hash, ...}]`. Wrap.

Note: PII-03's REQUIREMENTS.md wording mentions `/api/repos` — that route does NOT exist on the worker (PREDECESSOR-SURFACE.md S2 verbatim). Actual surface is `GET /projects` plus `repos[]` arrays nested inside `/api/scan-freshness` and `/graph` response bodies. Target those.

Already-relative agent emissions (from `worker/scan/agent-prompt-service.md:104`):
```json
"root_path": "src/"
```
`maskHome` MUST be idempotent on these (S1 mitigation).

Export module (`worker/cli/export.js`):
- `loadGraph(repoPath)` at line 45 returns the graph object.
- `toMermaid({services, connections})` at line 70.
- `toDot({services, connections})` at line 95.
- `toHtml({services, connections}, opts)` at line 124.
- Wire site: in `main()` (line 232) right after `loadGraph()`, replace `const graph = loadGraph(repo)` with `const graph = maskHomeDeep(loadGraph(repo))`. Single edit, masks all three downstream emitters at once.

findings.js parseAgentOutput (line 291): the seam is INSIDE `validateFindings` (called from parseAgentOutput at lines 302/311/323) — specifically, in the per-connection loop at lines 170-223. Add the absolute-source_file check after the existing `typeof conn.source_file !== "string"` guard (line 193).

Agent contract (`worker/scan/agent-prompt-service.md:89`):
> **Format:** `"path/to/caller.ts:functionName"` or `"path/to/caller.ts:42"` (line number fallback).

The contract is documented as relative. PII-06 makes the contract enforceable.
</interfaces>

<wave_structure>
**Wave 1 — Plan A: Helper module + unit tests (REQ PII-01, PII-07-unit)**
- Single sub-plan, 2 tasks. Must complete before any Wave 2 work begins.
- No file overlap with Wave 2/3.

**Wave 2 — Plans B/C/D/E: Four parallel egress seam edits (REQ PII-02, PII-03, PII-04, PII-05)**
- Four sub-plans run in parallel, each touching exactly ONE file from Wave 2 (zero file-overlap → safe parallelism).
- All depend on Wave 1's `path-mask.js`.
- Plan B: PII-02 — `worker/mcp/server.js`
- Plan C: PII-03 — `worker/server/http.js`
- Plan D: PII-04 — `worker/lib/logger.js` (single-seam M1 fix)
- Plan E: PII-05 — `worker/cli/export.js`

**Wave 3 — Plan F: Agent contract assertion + integration grep test (REQ PII-06, PII-07-bats)**
- Two tasks. Depends on Waves 1+2 (the bats grep test exercises Wave-2 seams).
- Touches `worker/scan/findings.js` (PII-06 belt-and-suspenders) + a doc note in `agent-prompt-service.md` + a new `tests/pii-masking.bats` file.
- Acceptance gate at the end of Wave 3 confirms all 5 success criteria simultaneously.
</wave_structure>
</context>

<!-- ============================================================ -->
<!-- WAVE 1 — Plan A: Helper module + unit tests                  -->
<!-- ============================================================ -->

<wave id="1" name="Helper module + unit tests">

<plan id="A" requirements="PII-01, PII-07 (unit half)" autonomous="true">

<plan_objective>
Ship the masking primitive every Wave-2 seam consumes: pure, idempotent, side-effect-free helper module with full PII-07 unit coverage. Without this plan, no other PII-* requirement is shippable.
</plan_objective>

<tasks>

<task type="auto" tdd="true" wave="1">
  <name>Task A1: Implement worker/lib/path-mask.js with maskHome and maskHomeDeep</name>
  <files>plugins/arcanon/worker/lib/path-mask.js</files>
  <commit_message>feat(123): add worker/lib/path-mask.js — egress masking primitive (PII-01)</commit_message>
  <behavior>
    Module exports: `maskHome`, `maskHomeDeep`, `PATHY_KEYS`.

    `maskHome(p)` rules — per PII-01:
    - `typeof p !== "string"` → return `p` unchanged (null, undefined, numbers, booleans).
    - Cache `HOME` at module load: `const HOME = process.env.HOME ?? os.homedir() ?? ""`. If empty, the function is a no-op (returns input unchanged).
    - `p === HOME` → return `"~"` (exact-match rule per PII-01).
    - `p.startsWith(HOME + "/")` → return `"~" + p.slice(HOME.length)`.
    - `p === "~"` or `p.startsWith("~/")` → return `p` (idempotent — already masked).
    - Else → return `p` unchanged. **Critical:** must NOT mask `${HOME}other` (no slash separator).

    `PATHY_KEYS` (Set, exported): `{"path", "repo_path", "source_file", "target_file", "root_path"}`.

    `maskHomeDeep(obj)` rules — per PII-01 + M1 mitigation verbatim:
    - String input → `maskHome(obj)`.
    - Other primitives (number, bool, null, undefined) → return unchanged.
    - Array → `obj.map(v => maskHomeDeep(v, _seen))` (NEW array; do not mutate input).
    - Object → walk keys; for each value: if string, `maskHome(value)` UNCONDITIONALLY (covers `extra.stack`, every keyed path, every unkeyed string). If object/array, recurse. Other primitives copy through.
    - Cycle safety via `WeakSet`: cyclic references emit `"[Circular]"` placeholder, do not infinite-loop.

    Reasoning to capture in JSDoc:
    - "Mask all string values, not just keys in `PATHY_KEYS`": M1 mitigation demands stack-trace masking, and stack frames are unkeyed strings inside `extra.stack`. A key-only filter would leak them. Acceptable trade-off: a non-path string mentioning `/Users/me` gets masked too — goal is zero `/Users/` strings on egress.
    - Idempotency on already-relative paths (e.g. `"src/"`): trivially holds because they have no `$HOME` prefix → S1 mitigation satisfied.
  </behavior>
  <action>
    Create `plugins/arcanon/worker/lib/path-mask.js` (ESM, ~80 lines including JSDoc).

    Imports: `import os from "node:os";` only. No fs, no logging, no fetch.

    Skeleton:
    ```js
    import os from "node:os";

    const HOME = process.env.HOME ?? os.homedir() ?? "";

    export const PATHY_KEYS = new Set([
      "path", "repo_path", "source_file", "target_file", "root_path",
    ]);

    export function maskHome(p) { /* ... */ }

    export function maskHomeDeep(obj, _seen = new WeakSet()) { /* ... */ }
    ```

    Reference STATE.md cross-milestone decision: "Mask `$HOME` at egress seams, not in DB." This module IS the egress primitive.

    Reference S1 mitigation (PREDECESSOR-SURFACE.md verbatim, copied here for executor traceability):
    > "Plan must verify `maskHome` is idempotent on already-relative paths emitted by the agent (`agent-prompt-service.md:104` shows root_path as `src/`). The agent contract is documented to emit relative paths; PII-06 hardens this. Add a unit test under PII-07 confirming an already-relative path round-trips through maskHome unchanged."

    Reference M1 mitigation (PREDECESSOR-SURFACE.md verbatim):
    > "`extra.stack` is a string; `maskHomeDeep` must mask string values, not just keyed paths."

    Document both decisions in JSDoc above the corresponding export.
  </action>
  <verify>
    <automated>cd plugins/arcanon &amp;&amp; node --test worker/lib/path-mask.test.js</automated>
  </verify>
  <done>
    File exists at `plugins/arcanon/worker/lib/path-mask.js`. Exports `maskHome`, `maskHomeDeep`, `PATHY_KEYS`. All 12 Task A2 unit tests pass.
  </done>
</task>

<task type="auto" tdd="true" wave="1">
  <name>Task A2: Write worker/lib/path-mask.test.js — 12 PII-07 unit cases</name>
  <files>plugins/arcanon/worker/lib/path-mask.test.js</files>
  <commit_message>test(123): pin maskHome/maskHomeDeep round-trips, idempotency, deep walk (PII-07)</commit_message>
  <behavior>
    Convention: `node:test` + `node:assert/strict` per `worker/lib/repo-resolver.test.js`. Set `process.env.HOME = '/tmp/fake-home-pii07'` BEFORE any import of `./path-mask.js`, then dynamic-import to ensure module-load HOME read sees the fixture.

    Required 12 cases (test name → assertion):

    1. **maskHome — HOME prefix replaced with ~**: `maskHome($HOME + '/foo')` → `'~/foo'`.
    2. **maskHome — no prefix passes through**: `maskHome('/etc/passwd')` → `'/etc/passwd'`.
    3. **maskHome — exact HOME match returns ~**: `maskHome($HOME)` → `'~'`.
    4. **maskHome — ${HOME}other (no slash) is NOT masked**: `maskHome($HOME + 'extra')` → `$HOME + 'extra'` unchanged. False-positive guard per PII-07.
    5. **maskHome — non-string input passes through**: null, undefined, 0, false, NaN, `{}`, `[]` all return unchanged via `assert.strictEqual` / `assert.deepStrictEqual`.
    6. **maskHome — idempotent on already-relative paths (S1 mitigation)**: `maskHome('src/')` → `'src/'`. Verbatim test demand from PREDECESSOR-SURFACE.md S1.
    7. **maskHome — idempotent on already-masked paths**: `maskHome('~/foo')` → `'~/foo'`. `maskHome(maskHome($HOME + '/x')) === maskHome($HOME + '/x')`.
    8. **maskHomeDeep — nested object walk**: `{repo: {path: $HOME + '/r', name: 'svc'}}` → `{repo: {path: '~/r', name: 'svc'}}`. Original input NOT mutated (assert via deepStrictEqual on a deep-clone snapshot).
    9. **maskHomeDeep — nested array walk**: `[{path: $HOME + '/a'}, {path: $HOME + '/b'}]` → both masked.
    10. **maskHomeDeep — masks raw string values regardless of key (M1 mitigation)**: `{stack: $HOME + '/foo.js:42'}` → `{stack: '~/foo.js:42'}`. Verbatim test demand from PREDECESSOR-SURFACE.md M1. Asserts that `stack` (not in `PATHY_KEYS`) is masked because `maskHomeDeep` masks all string values.
    11. **maskHomeDeep — cycle safety**: `const a = {}; a.self = a;` → does not throw within 1s; `result.self === '[Circular]'` (or whatever sentinel the impl uses; assertion is "completes synchronously without throwing").
    12. **maskHomeDeep — non-object passes through maskHome**: `maskHomeDeep($HOME + '/x')` → `'~/x'`; `maskHomeDeep(42)` → `42`.
  </behavior>
  <action>
    Create `plugins/arcanon/worker/lib/path-mask.test.js` (~120 lines). Top of file:
    ```js
    process.env.HOME = '/tmp/fake-home-pii07';
    import { test } from 'node:test';
    import assert from 'node:assert/strict';
    const { maskHome, maskHomeDeep, PATHY_KEYS } = await import('./path-mask.js');
    ```
    Each test 3-8 lines. Mirror the case names from `<behavior>` so traceability to PII-07 is grep-able.
  </action>
  <verify>
    <automated>cd plugins/arcanon &amp;&amp; node --test worker/lib/path-mask.test.js</automated>
  </verify>
  <done>
    All 12 tests pass. Exit code 0. `grep -c "^test\\|^test(" worker/lib/path-mask.test.js` returns ≥ 12.
  </done>
</task>

</tasks>

</plan>

</wave>

<!-- ============================================================ -->
<!-- WAVE 2 — Plans B/C/D/E: Four parallel egress seams           -->
<!-- ============================================================ -->

<wave id="2" name="Four parallel egress seams" parallelism="full">

**Wave-2 parallelism guarantee:** Plans B/C/D/E touch zero shared files. Plan B → `mcp/server.js`. Plan C → `server/http.js`. Plan D → `lib/logger.js`. Plan E → `cli/export.js`. All four can run in any order or simultaneously.

<plan id="B" requirements="PII-02" autonomous="true" depends_on="A">

<plan_objective>
Mask `$HOME` paths in every MCP tool response payload before serialization. **Highest-priority seam — only egress to a third party (Anthropic).**
</plan_objective>

<tasks>

<task type="auto" tdd="true" wave="2">
  <name>Task B1: Wire maskHomeDeep into all 9 MCP tool returns</name>
  <files>plugins/arcanon/worker/mcp/server.js</files>
  <commit_message>fix(123): mask $HOME at every MCP tool response (PII-02)</commit_message>
  <behavior>
    Every `server.tool(...)` callback returns:
    ```js
    return { content: [{ type: "text", text: JSON.stringify(<resultObj>) }] };
    ```
    PII-02 wraps the result object — NOT the JSON string — through `maskHomeDeep` before stringification. Idempotent S1 mitigation means agent-emitted relative paths (`"src/"`) round-trip unchanged.

    9 tool sites to update (line numbers from PREDECESSOR-SURFACE.md MCP table):
    - `impact_query` (line ~1255)
    - `impact_changed` (line ~1303)
    - `impact_graph` (line ~1344)
    - `impact_search` (line ~1385)
    - `impact_scan` (line ~1429)
    - `drift_versions` (line ~1456)
    - `drift_types` (line ~1481)
    - `drift_openapi` (line ~1506)
    - `impact_audit_log` (line ~1572)

    Error-path returns also masked: `{ error: err.message }` may contain a path in `err.message` (e.g. ENOENT messages). Wrap those too.

    Implementation pattern: introduce a single helper at the top of the file (just below imports):
    ```js
    import { maskHomeDeep } from "../lib/path-mask.js";

    function mcpReply(obj) {
      return { content: [{ type: "text", text: JSON.stringify(maskHomeDeep(obj)) }] };
    }
    ```
    Then every existing `return { content: [{ type: "text", text: JSON.stringify(X) }] };` becomes `return mcpReply(X);`. Minimizes diff; one place to test.
  </behavior>
  <action>
    1. Add `import { maskHomeDeep } from "../lib/path-mask.js";` near the existing imports.
    2. Add `mcpReply(obj)` helper near the top.
    3. Replace every `return { content: [{ type: "text", text: JSON.stringify(...) }] };` with `return mcpReply(...);`. Approximately 14-20 sites (9 success + ~5 error).
    4. Verify with grep: `grep -c "JSON.stringify" worker/mcp/server.js` should drop close to zero (only legitimate non-MCP stringify calls survive).
    5. Verify no behavior change for already-relative paths: the `impact_search` results in `worker/scan/agent-prompt-service.md:104`-style strings (`root_path: "src/"`) MUST round-trip unchanged. This is enforced by `maskHome` idempotency (Wave-1 Task A2 test 6).

    Reasoning trace per S1 mitigation (PREDECESSOR-SURFACE.md verbatim):
    > "MCP tool response masking changes a wire format consumed by Claude... Plan must add a unit test confirming a Claude-tool-call's downstream consumer (the `Explore` agent prompts in `agent-prompt-*.md`) still works with `~`-prefixed paths. Confirm that `worker/scan/agent-prompt-service.md:104` (`root_path: "src/"`) — already relative — won't be re-masked redundantly. Idempotent maskHome (PII-01 spec) handles this."

    Wave-1 idempotency test (Task A2 test 6) covers this; no additional unit test needed in Wave 2. The bats integration grep in Wave-3 task F2 is the cross-seam regression guard.
  </action>
  <verify>
    <automated>cd plugins/arcanon &amp;&amp; node --check worker/mcp/server.js &amp;&amp; grep -E "return.*content.*JSON\\.stringify" worker/mcp/server.js | wc -l | awk '$1 == 0 {exit 0} {exit 1}'</automated>
  </verify>
  <done>
    All 9 tool sites use `mcpReply()` helper. Zero unmasked `return { content: [{ type: "text", text: JSON.stringify(...) }] }` patterns remain (grep returns 0). File parses (`node --check`).
  </done>
</task>

</tasks>

</plan>

<plan id="C" requirements="PII-03" autonomous="true" depends_on="A">

<plan_objective>
Mask `$HOME` paths in `/projects`, `/api/scan-freshness`, and `/graph` HTTP responses before serialization. Targets the actual surface (NOT `/api/repos` which doesn't exist — S2 mitigation).
</plan_objective>

<tasks>

<task type="auto" tdd="true" wave="2">
  <name>Task C1: Wire maskHomeDeep into HTTP responses for /projects, /graph, /api/scan-freshness</name>
  <files>plugins/arcanon/worker/server/http.js</files>
  <commit_message>fix(123): mask $HOME in /graph, /projects, /api/scan-freshness responses (PII-03)</commit_message>
  <behavior>
    Per S2 mitigation (PREDECESSOR-SURFACE.md verbatim):
    > "PII-03's REQ wording references `/api/repos`, but that route does NOT exist on the worker. The actual surface is `GET /projects` plus the `repos[]` array nested inside `/api/scan-freshness` and `/graph` response bodies — target those routes."

    Three reply.send sites to wrap:

    1. **`/api/scan-freshness`** (`worker/server/http.js:374-379`):
       ```js
       return reply.send({ last_scan_iso, last_scan_age_seconds, scan_quality_pct, repos });
       ```
       Wrap: `return reply.send(maskHomeDeep({ last_scan_iso, ..., repos }));` — masks `repos[].path` (the absolute repo path from SQLite at line 369).

    2. **`/graph`** (`worker/server/http.js:578`):
       ```js
       return reply.send({ ...graph, boundaries });
       ```
       `graph = qe.getGraph()` returns `{ services: [{root_path, repo_path, repo_name, ...}], connections, actors, ... }` per `worker/db/query-engine.js:1591` (where `r.path AS repo_path`). Wrap: `return reply.send(maskHomeDeep({ ...graph, boundaries }));`.

    3. **`/projects`** (`worker/server/http.js:540`):
       ```js
       return reply.send(listProjects());
       ```
       `listProjects()` from `worker/db/pool.js` returns `[{path, hash, ...}]`. Wrap: `return reply.send(maskHomeDeep(listProjects()));`.

    Error-path replies (`reply.code(500).send({ error: err.message })`) optionally wrapped — `err.message` may contain absolute paths from sqlite errors. Defensive: also pass through `maskHomeDeep` for consistency.
  </behavior>
  <action>
    1. Add `import { maskHomeDeep } from "../lib/path-mask.js";` near existing imports.
    2. Update the three success-path replies above.
    3. Optionally wrap error-path replies too (defensive; tiny diff).
    4. **Do NOT** wrap unrelated routes (`/api/readiness`, `/api/version`, `/impact`, `/service/:name`, `/api/scan-quality`, `/api/verify`, `/versions`, `/api/logs`). PII-03 scope is exactly the three routes above. Documenting non-scope avoids reviewer confusion.

    Note on `/api/verify` (line 431): per PREDECESSOR-SURFACE.md "Untouched Predecessor Surfaces" — response already uses relative `source_file`; PII-02-style masking on its results would be a no-op via idempotency. Out of PII-03 scope.

    Note on `/api/logs` (line 675): returns log lines that pass through the logger. PII-04 masks log content at write time, so `/api/logs` reads already-masked data. No double-masking needed (idempotency guarantees safety).
  </action>
  <verify>
    <automated>cd plugins/arcanon &amp;&amp; node --check worker/server/http.js &amp;&amp; grep -E "reply\\.send\\(maskHomeDeep" worker/server/http.js | wc -l | awk '$1 &gt;= 3 {exit 0} {exit 1}'</automated>
  </verify>
  <done>
    `/projects`, `/graph`, `/api/scan-freshness` all wrap their reply body in `maskHomeDeep(...)`. Grep finds at least 3 wrapping sites. File parses.
  </done>
</task>

</tasks>

</plan>

<plan id="D" requirements="PII-04" autonomous="true" depends_on="A">

<plan_objective>
Mask `$HOME` from worker log lines at a single seam in `worker/lib/logger.js` — verbatim M1 mitigation. Do NOT touch the ~30 logger call sites scattered across `worker/`.
</plan_objective>

<tasks>

<task type="auto" tdd="true" wave="2">
  <name>Task D1: Single-seam mask in logger.js between Object.assign and JSON.stringify</name>
  <files>plugins/arcanon/worker/lib/logger.js</files>
  <commit_message>fix(123): single-seam mask in logger.js between Object.assign and JSON.stringify (PII-04)</commit_message>
  <behavior>
    Per M1 mitigation (PREDECESSOR-SURFACE.md verbatim):
    > "Plan must add masking as a SINGLE seam in worker/lib/logger.js between lines 59 and 60 (after `Object.assign(lineObj, extra)`, before `JSON.stringify`). Do NOT add masking calls at the ~30 logger call sites scattered across worker/. Stack-trace masking: `extra.stack` is a string; `maskHomeDeep` must mask string values, not just keyed paths. Add a unit test asserting log line contains `~/path/to/repo` not `/Users/me/path/to/repo` after `logger.info('x', {stack: '/Users/me/foo.js:42'})`."

    Current state at `worker/lib/logger.js:59-61`:
    ```js
    Object.assign(lineObj, extra);                    // line 59
    const line = JSON.stringify(lineObj);             // line 61
    ```

    Target state (single edit):
    ```js
    Object.assign(lineObj, extra);
    const masked = maskHomeDeep(lineObj);             // ← single new line
    const line = JSON.stringify(masked);
    ```

    Wave-1 Task A2 test 10 already pins the M1 stack-frame masking behavior (`{stack: '/Users/me/foo.js:42'}` → `{stack: '~/foo.js:42'}`). The integration grep in Wave-3 Task F2 confirms zero `/Users/` strings in `~/.arcanon/logs/worker.log` after a clean scan.

    **CRITICAL:** Do NOT mask `lineObj.ts`, `lineObj.level`, `lineObj.msg`, `lineObj.pid`, `lineObj.port`, `lineObj.component` — these are non-path strings. They pass through `maskHomeDeep` cleanly because none contain `$HOME` prefixes (they're ISO timestamps, level names, message strings, integers, port numbers, component tags). The "mask all string values" semantic is safe here because `maskHome` is a no-op on strings without HOME prefix.

    **CRITICAL:** Do NOT touch any of the ~30 logger call sites in `worker/scan/manager.js`, `worker/server/http.js`, `worker/mcp/server.js`, etc. The whole point of M1 is that the seam is a single edit in one file.
  </behavior>
  <action>
    1. Add `import { maskHomeDeep } from "./path-mask.js";` to top of `worker/lib/logger.js`.
    2. Insert one line between current line 59 and line 61: `const masked = maskHomeDeep(lineObj);` — then change `JSON.stringify(lineObj)` to `JSON.stringify(masked)`.
    3. Net change: +2 lines (import + mask), +0 deletions, ~1 token modification (`lineObj` → `masked`).
    4. Confirm zero changes elsewhere: `git diff --stat worker/` should show only `worker/lib/logger.js` and Wave-2's other 3 seams.
  </action>
  <verify>
    <automated>cd plugins/arcanon &amp;&amp; node --check worker/lib/logger.js &amp;&amp; grep -E "maskHomeDeep\\(lineObj\\)" worker/lib/logger.js | wc -l | awk '$1 == 1 {exit 0} {exit 1}'</automated>
  </verify>
  <done>
    Single `maskHomeDeep(lineObj)` line present. Import added. No call-site edits anywhere else under `worker/`.
  </done>
</task>

</tasks>

</plan>

<plan id="E" requirements="PII-05" autonomous="true" depends_on="A">

<plan_objective>
Mask `$HOME` in default-mode `/arcanon:export` outputs (mermaid, dot, html). Single edit at `loadGraph()` consumption point in `worker/cli/export.js` covers all three downstream emitters.
</plan_objective>

<tasks>

<task type="auto" tdd="true" wave="2">
  <name>Task E1: Mask graph object before mermaid/dot/html emission in worker/cli/export.js</name>
  <files>plugins/arcanon/worker/cli/export.js</files>
  <commit_message>fix(123): mask $HOME in mermaid/dot/html exports (PII-05)</commit_message>
  <behavior>
    Per PII-05: mermaid, dot, and html exports run repo path strings through `maskHome` before emitting. Single edit point: in `main()` (line 232) right after `loadGraph()`, mask the graph object once. All three downstream emitters (`toMermaid`, `toDot`, `toHtml` at lines 70/95/124) receive the masked input.

    Current pattern (~line 233-244):
    ```js
    async function main() {
      const flags = parseArgs(process.argv);
      const repo = flags.repo || process.cwd();
      const format = flags.format || "all";
      // ...
      const graph = loadGraph(repo);
      // ...
      if (format === "mermaid" || format === "all") { /* writes toMermaid(graph) */ }
      if (format === "dot" || format === "all") { /* writes toDot(graph) */ }
      if (format === "html" || format === "all") { /* writes toHtml(graph, ...) */ }
      if (format === "json" || format === "all") { /* writes JSON.stringify(graph) */ }
    }
    ```

    Target: replace `const graph = loadGraph(repo);` with `const graph = maskHomeDeep(loadGraph(repo));`. JSON export ALSO benefits (one of the success-criteria victories — JSON is a default-mode output).

    No changes to `toMermaid`, `toDot`, or `toHtml` themselves. They receive an already-masked input.
  </behavior>
  <action>
    1. Add `import { maskHomeDeep } from "../lib/path-mask.js";` near existing imports at top of file.
    2. Replace the single `const graph = loadGraph(repo);` line with `const graph = maskHomeDeep(loadGraph(repo));`.
    3. Net change: +1 import line, ~1 modified line.
    4. The HTML export at line 124 escapes content for HTML; `~` survives HTML escaping (it's not a special char). No additional escaping concerns.
  </action>
  <verify>
    <automated>cd plugins/arcanon &amp;&amp; node --check worker/cli/export.js &amp;&amp; grep -E "loadGraph.*maskHomeDeep|maskHomeDeep.*loadGraph" worker/cli/export.js | wc -l | awk '$1 &gt;= 1 {exit 0} {exit 1}'</automated>
  </verify>
  <done>
    `main()` masks the graph object exactly once at the `loadGraph` call site. File parses. The bats grep test in Wave 3 confirms zero `/Users/` strings in mermaid/dot/html output.
  </done>
</task>

</tasks>

</plan>

</wave>

<!-- ============================================================ -->
<!-- WAVE 3 — Plan F: Agent contract assertion + integration test -->
<!-- ============================================================ -->

<wave id="3" name="Agent contract assertion + integration grep">

<plan id="F" requirements="PII-06, PII-07 (bats half)" autonomous="true" depends_on="A,B,C,D,E">

<plan_objective>
Belt-and-suspenders: harden the agent contract so future agent regressions can't leak absolute paths through the scan pipeline. Then ship the cross-seam integration grep that asserts every Wave-2 seam emits zero `/Users/` strings after a clean scan.
</plan_objective>

<tasks>

<task type="auto" tdd="true" wave="3">
  <name>Task F1: Reject absolute source_file in parseAgentOutput → WARN + drop field (PII-06, X2 mitigation)</name>
  <files>plugins/arcanon/worker/scan/findings.js, plugins/arcanon/worker/scan/agent-prompt-service.md</files>
  <commit_message>fix(123): reject absolute source_file in parseAgentOutput — WARN+drop, do not fail scan (PII-06)</commit_message>
  <behavior>
    Per X2 mitigation (PREDECESSOR-SURFACE.md verbatim):
    > "No composition risk with applyPendingOverrides (PII-06 fires at parseAgentOutput, well before persistFindings). Plan must spec: rejection logs WARN with the masked offending value, drops just the source_file field (not the whole connection), does not fail the scan. Belt-and-suspenders only — agent contract already mandates relative paths per agent-prompt-service.md:89."

    Behavior contract:

    1. Inside `validateFindings` (the function called by `parseAgentOutput`), in the per-connection loop (lines 170-223 in `worker/scan/findings.js`), AFTER the existing string-type guard at line 193 but BEFORE the `target_file` check at line 198, add an absolute-path guard:
       ```js
       if (typeof conn.source_file === "string" && conn.source_file.startsWith("/")) {
         warnings.push(
           `connection[${i}].source_file is absolute ("${maskHome(conn.source_file)}") — agent contract requires relative paths; dropping field`
         );
         conn.source_file = null;  // drop the offending field; KEEP the connection
       }
       ```

    2. **Imports:** `import { maskHome } from "../lib/path-mask.js";` at top of file. Used to mask the offending value in the WARN message itself (irony: the rejection message would otherwise leak the path).

    3. **Connection survives:** the rest of the connection (source, target, protocol, method, path, evidence, confidence, target_file, crossing) flows through unchanged. The scan does NOT fail; `validateFindings` does NOT return `err(...)` for this case. The connection persists into the DB with `source_file = null`.

    4. **Existing warnings collector:** the `warnings` array already exists (initialized at line 121). The new WARN message lands in it alongside the existing `null` source_file warning at line 263. The eventual logger emission of these warnings (downstream in manager.js or wherever validateFindings's warnings are surfaced) goes through the PII-04 logger seam, so the warning text gets masked again at log-write time — defense in depth.

    5. **Composition with applyPendingOverrides (CORRECT-03, manager.js:810-819):** order in scan pipeline is: `parseAgentOutput → validateFindings → persistFindings → applyPendingOverrides → endScan → enrichment`. PII-06 fires inside `validateFindings`, well before `persistFindings`. Zero composition risk per X2.

    Agent contract doc update: add a single line to `worker/scan/agent-prompt-service.md` at the end of the "source_file Requirement" section (around line 93) that hardens the contract:
    > "Absolute paths starting with `/` are REJECTED at parse time — the field is dropped, the connection still persists. The agent MUST emit relative paths."
  </behavior>
  <action>
    1. Edit `plugins/arcanon/worker/scan/findings.js`:
       - Add `import { maskHome } from "../lib/path-mask.js";` to imports.
       - Insert the absolute-source_file guard inside the connections loop, between the string-type check (line 193) and the target_file check (line 198).
       - Confirm: the existing `null` warning collection at line 263 still fires for nulled-out fields (because the guard sets `conn.source_file = null`).

    2. Edit `plugins/arcanon/worker/scan/agent-prompt-service.md`:
       - Append the rejection-rule sentence to the "source_file Requirement" section (after line 93). Single sentence, no new heading.

    3. Add 2 unit tests inside the existing `findings.test.js` if it exists, OR create `worker/scan/findings.pii06.test.js`:
       - Test 1: `parseAgentOutput(input)` where input has `source_file: "/Users/me/foo.ts"` → `result.valid === true`, `result.findings.connections[0].source_file === null`, `result.warnings` contains a string matching `/source_file is absolute.*~\/me\/foo\.ts.*dropping/`.
       - Test 2: `parseAgentOutput(input)` where input has `source_file: "src/foo.ts"` → `result.valid === true`, `result.findings.connections[0].source_file === "src/foo.ts"` (relative path passes through unchanged — NO warning fires).

    4. Confirm via grep that PII-06 belongs to `parseAgentOutput`/`validateFindings` and NOT to `persistFindings`: `grep -n "applyPendingOverrides\\|persistFindings" worker/scan/findings.js` — both should be absent (PII-06 is purely a parse-time check). Per X2 mitigation, no composition risk.
  </action>
  <verify>
    <automated>cd plugins/arcanon &amp;&amp; node --test worker/scan/findings.pii06.test.js 2&gt;/dev/null || node --test worker/scan/findings.test.js</automated>
  </verify>
  <done>
    Absolute source_file inputs produce WARN + dropped field; relative inputs pass through. Tests assert both. Agent contract doc has the rejection-rule sentence. The scan does NOT fail on absolute input.
  </done>
</task>

<task type="auto" tdd="true" wave="3">
  <name>Task F2: tests/pii-masking.bats — cross-seam integration grep (PII-07 bats half)</name>
  <files>tests/pii-masking.bats</files>
  <commit_message>test(123): bats grep — zero /Users/ on every PII egress seam after clean scan (PII-07)</commit_message>
  <behavior>
    Per PII-07 (REQUIREMENTS.md line 67):
    > "bats — grep-assertion that no `/Users/` strings appear in MCP tool responses (`tools/list` + sample tool call), default-mode `/arcanon:export` outputs, worker log lines after a clean scan, `/api/scan-freshness` JSON."

    Per S2 mitigation (PREDECESSOR-SURFACE.md verbatim):
    > "Plan must spec a single bats grep-assertion against `cmdStatus` JSON output (hub.js:196) confirming no `/Users/` or `/home/` strings escape after a clean scan. session-start.sh confirmed not to render `repos[].path` today (grep returns 0 hits) so no script edit is needed; pin this as a structural regression guard in commands-surface.bats."

    Bats convention (per existing `tests/*.bats` 15+ files at repo root): each test is a `@test "..."` block. Setup/teardown via `setup()` and `teardown()` functions. Helpers from `tests/helpers/` if needed (existing pattern).

    Required tests:

    1. **`@test "PII: maskHome unit tests pass"`** — runs `cd plugins/arcanon && node --test worker/lib/path-mask.test.js`; asserts exit 0. Smoke gate that Wave 1 didn't regress.

    2. **`@test "PII: /api/scan-freshness JSON contains no /Users/ or /home/ strings"`** — assumes a worker is running with a clean scan. `curl -s http://localhost:${PORT}/api/scan-freshness | grep -c '/Users/\\|/home/' | grep -q '^0$'`. If no worker available in CI, gate this test on an env var (e.g. `[ -z "$ARCANON_WORKER_PORT" ] && skip "no worker running"`).

    3. **`@test "PII: /graph response contains no /Users/ or /home/ strings"`** — same shape as #2 against `/graph`.

    4. **`@test "PII: /projects response contains no /Users/ or /home/ strings"`** — same shape against `/projects`.

    5. **`@test "PII: default-mode /arcanon:export mermaid contains no /Users/ strings"`** — runs `node plugins/arcanon/worker/cli/export.js --format mermaid --out /tmp/pii-export-${BATS_TEST_NUMBER}.mmd` against a fixture project; greps the output file. (May require an existing scanned fixture; gate behind `skip` if absent.)

    6. **`@test "PII: default-mode /arcanon:export dot contains no /Users/ strings"`** — same against `--format dot`.

    7. **`@test "PII: default-mode /arcanon:export html contains no /Users/ strings"`** — same against `--format html`.

    8. **`@test "PII: worker.log contains no /Users/ strings after a clean scan"`** — asserts `grep -c '/Users/\\|/home/' ~/.arcanon/logs/worker.log` returns 0. Gate behind a clean-scan setup.

    9. **`@test "PII: parseAgentOutput rejects absolute source_file (PII-06)"`** — runs the Task F1 unit tests via `node --test worker/scan/findings.pii06.test.js`; asserts exit 0.

    For tests requiring a running worker or scanned fixture, use `skip` with a clear message rather than failing — this matches the convention in `tests/structure.bats` and `tests/mcp-server.bats`. CI can set the env vars to enable full coverage.

    **Key insight per S2 mitigation:** session-start.sh already does NOT render `repos[].path`, so no separate session-start test is needed. Pin a structural regression guard inline:

    10. **`@test "PII: session-start.sh does not render repos[].path (S2 structural guard)"`** — `grep -c 'repo_path\\|repos\\.path' scripts/session-start.sh` returns 0. Catches future contributors who'd surface the field without masking.
  </behavior>
  <action>
    1. Create `tests/pii-masking.bats` with 10 `@test` blocks per `<behavior>`.
    2. Use `setup()` to detect optional dependencies (running worker, scanned fixture); use `skip` rather than failing when prerequisites absent.
    3. Use the same shebang and helper-loading conventions as existing files (`tests/structure.bats` is the simplest reference).
    4. Confirm bats discovers the file: `bats --list tests/pii-masking.bats` should print all 10 test names.
  </action>
  <verify>
    <automated>bats tests/pii-masking.bats</automated>
  </verify>
  <done>
    All 10 bats tests run (passing or `skip`-ing per env). At least tests 1, 9, 10 pass unconditionally (structural / unit-only). The remaining 7 pass when worker + fixture are available; otherwise they `skip` with a clear message.
  </done>
</task>

</tasks>

</plan>

</wave>

<!-- ============================================================ -->
<!-- Risk Mitigations — verbatim from PREDECESSOR-SURFACE.md       -->
<!-- ============================================================ -->

<risk_mitigations>

| Risk | Source | REQ | Mitigation in plan |
|------|--------|-----|--------------------|
| **S1** | PREDECESSOR-SURFACE.md line 305, ROADMAP.md line 730 | PII-02 | "Plan must verify `maskHome` is idempotent on already-relative paths emitted by the agent (`agent-prompt-service.md:104` shows root_path as `src/`). The agent contract is documented to emit relative paths; PII-06 hardens this. Add a unit test under PII-07 confirming an already-relative path round-trips through maskHome unchanged." → **Wave 1 Task A2 test 6 pins this verbatim.** Wave 2 Plan B (PII-02) relies on `maskHome` idempotency to avoid re-masking already-relative paths from the agent. |
| **S2** | PREDECESSOR-SURFACE.md line 306, ROADMAP.md line 732 | PII-03 | "Plan must spec a single bats grep-assertion against `cmdStatus` JSON output (hub.js:196) confirming no `/Users/` or `/home/` strings escape after a clean scan. session-start.sh confirmed not to render `repos[].path` today (grep returns 0 hits) so no script edit is needed; pin this as a structural regression guard in commands-surface.bats. **REQUIREMENTS.md note:** PII-03's REQ wording references `/api/repos`, but that route does not exist on the worker. The actual surface is `GET /projects` (project-list) plus the `repos[]` array nested inside `/api/scan-freshness` and `/graph` response bodies — target those routes." → **Wave 2 Plan C targets the correct three routes (`/projects`, `/graph`, `/api/scan-freshness`).** Wave 3 Task F2 test 10 is the structural guard against session-start.sh regressing. |
| **M1** | PREDECESSOR-SURFACE.md line 307, ROADMAP.md line 734 | PII-04 | "Plan must add masking as a SINGLE seam in worker/lib/logger.js between lines 59 and 60 (after `Object.assign(lineObj, extra)`, before `JSON.stringify`). Do NOT add masking calls at the ~30 logger call sites scattered across worker/. Stack-trace masking: `extra.stack` is a string; `maskHomeDeep` must mask string values, not just keyed paths. Add a unit test asserting log line contains `~/path/to/repo` not `/Users/me/path/to/repo` after `logger.info('x', {stack: '/Users/me/foo.js:42'})`." → **Wave 2 Plan D Task D1 implements EXACTLY this single seam edit.** Wave 1 Task A2 test 10 pins the stack-frame masking semantic verbatim. |
| **X2** | PREDECESSOR-SURFACE.md line 309, ROADMAP.md line 736 | PII-06 | "No composition risk with applyPendingOverrides (PII-06 fires at parseAgentOutput, well before persistFindings). Plan must spec: rejection logs WARN with the masked offending value, drops just the source_file field (not the whole connection), does not fail the scan. Belt-and-suspenders only — agent contract already mandates relative paths per agent-prompt-service.md:89." → **Wave 3 Plan F Task F1 implements EXACTLY this contract: WARN with masked value, drop field, keep connection, do not fail scan.** Verified by grep that `parseAgentOutput`/`validateFindings` runs before `persistFindings`/`applyPendingOverrides` — zero composition risk. |

</risk_mitigations>

<!-- ============================================================ -->
<!-- Test Plan — per REQ                                           -->
<!-- ============================================================ -->

<test_plan>

| REQ | Layer | Test file | Coverage |
|-----|-------|-----------|----------|
| PII-01 | unit | `plugins/arcanon/worker/lib/path-mask.test.js` | 12 cases: HOME-prefix, no-prefix, exact-HOME, `${HOME}other` false-positive, non-string, idempotency on relative + masked, deep object, deep array, M1 stack-frame, cycle safety, primitive pass-through |
| PII-02 | unit (idempotency relied-upon) | reuses `path-mask.test.js` test 6 | Already-relative paths from agent round-trip unchanged through MCP responses |
| PII-02 | bats integration | `tests/pii-masking.bats` test 1 (relies on transitive grep — see PII-07) | Worker MCP responses contain zero `/Users/` (gated on running worker) |
| PII-03 | bats integration | `tests/pii-masking.bats` tests 2, 3, 4 | `/api/scan-freshness`, `/graph`, `/projects` JSON contain zero `/Users/` |
| PII-04 | unit | `path-mask.test.js` test 10 (M1 pin) | `extra.stack` strings are masked |
| PII-04 | bats integration | `tests/pii-masking.bats` test 8 | `~/.arcanon/logs/worker.log` contains zero `/Users/` after a clean scan |
| PII-05 | bats integration | `tests/pii-masking.bats` tests 5, 6, 7 | mermaid/dot/html exports contain zero `/Users/` |
| PII-06 | unit | `worker/scan/findings.pii06.test.js` (created in Task F1) | Absolute source_file → WARN + drop field, connection survives, scan does not fail; relative source_file → unchanged |
| PII-06 | bats integration | `tests/pii-masking.bats` test 9 | Wraps Task F1's unit tests as a bats gate |
| PII-07 | unit | `path-mask.test.js` (12 cases) | All round-trip + idempotency cases |
| PII-07 | bats | `tests/pii-masking.bats` (10 tests) | Cross-seam grep regression guard |

**S2 structural guard (no REQ — defensive):** `tests/pii-masking.bats` test 10 — `scripts/session-start.sh` does not render `repos[].path`. Catches future contributors who'd add a reference without masking.

</test_plan>

<!-- ============================================================ -->
<!-- Dependency Graph + Wave Summary                               -->
<!-- ============================================================ -->

<dependency_graph>

```
Wave 1 (Plan A — REQ PII-01, PII-07-unit)
  └── A1: worker/lib/path-mask.js
  └── A2: worker/lib/path-mask.test.js
       │
       ▼  (Plans B/C/D/E all import path-mask.js)
       │
Wave 2 (parallel; zero file overlap)
  ├── Plan B (REQ PII-02): worker/mcp/server.js          ← only file
  ├── Plan C (REQ PII-03): worker/server/http.js          ← only file
  ├── Plan D (REQ PII-04): worker/lib/logger.js           ← only file (M1 single-seam)
  └── Plan E (REQ PII-05): worker/cli/export.js           ← only file
       │
       ▼  (F2's bats grep exercises every Wave-2 seam)
       │
Wave 3 (Plan F — REQ PII-06, PII-07-bats)
  ├── F1: worker/scan/findings.js + agent-prompt-service.md doc + findings.pii06.test.js
  └── F2: tests/pii-masking.bats
```

**Parallelism:** Wave 2 has zero `files_modified` overlap → all four plans are simultaneously safe.

**Critical path length:** 3 waves; Wave 1 → any single Wave 2 plan → Wave 3.

</dependency_graph>

<!-- ============================================================ -->
<!-- Threat Model                                                  -->
<!-- ============================================================ -->

<threat_model>

## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| MCP wire | Worker → Anthropic (tool call responses). Third-party trust boundary. **Highest priority** for PII-02. |
| HTTP wire | Worker → local Claude Code / browser UI. Same machine but log-aggregation tooling may ship logs off-machine. |
| Filesystem (logs) | Worker → `~/.arcanon/logs/worker.log`. Local but consumed by user-facing tooling, support bundles, etc. |
| Filesystem (exports) | Worker → `.arcanon/reports/<timestamp>/*.{mmd,dot,html}`. Often committed to repos or shared in PRs. |
| Agent input | Anthropic → worker. Untrusted; scanning agent could regress and emit absolute paths (PII-06 defends). |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-123-01 | Information Disclosure | MCP tool response leaks `$HOME` to Anthropic | mitigate | Wave 2 Plan B wraps every tool return in `maskHomeDeep`. F2 bats test 1 (transitive) confirms zero `/Users/` on the wire. |
| T-123-02 | Information Disclosure | HTTP response leaks `$HOME` to local clients / log aggregators | mitigate | Wave 2 Plan C wraps `/projects`, `/graph`, `/api/scan-freshness`. F2 bats tests 2-4. |
| T-123-03 | Information Disclosure | Worker log file at `~/.arcanon/logs/worker.log` leaks `$HOME` (especially in stack traces shipped to support) | mitigate | Wave 2 Plan D single-seam edit + Wave 1 Task A2 test 10 (M1 pin). F2 bats test 8. |
| T-123-04 | Information Disclosure | `/arcanon:export` outputs (mermaid/dot/html) committed to public repos leak `$HOME` | mitigate | Wave 2 Plan E single-edit at `loadGraph`. F2 bats tests 5-7. |
| T-123-05 | Tampering | Future agent regression emits absolute `source_file` → propagates through pipeline | mitigate | Wave 3 Plan F Task F1: `parseAgentOutput` rejects + WARN + drop. Per X2, fires before `persistFindings` so DB never sees it. |
| T-123-06 | Information Disclosure | Rejection WARN message itself leaks the offending absolute path | mitigate | Task F1 masks the offending value via `maskHome(...)` before pushing to warnings array. Defense in depth: warnings flow through PII-04 logger seam → masked again at log-write. |
| T-123-07 | Denial of Service | maskHomeDeep on cyclic input infinite-loops | mitigate | Wave 1 Task A1 WeakSet cycle guard; Task A2 test 11 asserts no throw / no hang. |
| T-123-08 | Information Disclosure | `${HOME}other` (no slash) false-positive masking corrupts a non-HOME path | mitigate | Wave 1 Task A2 test 4 pins the no-slash boundary check. |
| T-123-09 | Tampering | maskHomeDeep mutates caller's input → Wave-2 seams accidentally lose data | mitigate | Implementation creates new objects/arrays; Wave 1 Task A2 test 8 asserts no mutation. |
| T-123-10 | Information Disclosure | session-start.sh future contributor adds `repos[].path` rendering without masking (S2 regression) | mitigate | Wave 3 Task F2 test 10: `grep -c 'repo_path\\|repos\\.path' scripts/session-start.sh == 0`. Structural regression guard. |
| T-123-11 | Repudiation | The masking seam silently drops legitimate absolute system paths (e.g. `/etc/passwd` mentioned in an error message) | accept | Goal is zero `/Users/` egress; non-`$HOME` absolute paths ARE preserved (maskHome only matches HOME prefix). `/etc/passwd` would NOT be masked — that's correct behavior. Confirmed by Task A2 test 2. |

</threat_model>

<!-- ============================================================ -->
<!-- Acceptance Gate (verbatim from ROADMAP.md success criteria)   -->
<!-- ============================================================ -->

<acceptance_gate>

The phase is complete when ALL FIVE success criteria from ROADMAP.md line 720-725 are TRUE simultaneously:

1. **MCP responses zero-leak (PII-02):** After a clean scan, calling `impact_query`, `impact_changed`, `impact_graph`, `impact_search`, or `impact_scan` via MCP returns a response containing zero `/Users/` or `/home/` strings — `repo_path`, `root_path`, `source_file`, and `target_file` are all `~`-prefixed.
   - **Evidence:** `bats tests/pii-masking.bats` tests 2-4 pass (transitive HTTP coverage exercises the same `getGraph()` path that MCP uses); manual MCP tool call inspection.

2. **Worker log zero-leak (PII-04):** After a clean scan, `~/.arcanon/logs/worker.log` contains zero absolute `$HOME` paths — stack traces and `extra` fields are masked.
   - **Evidence:** `bats tests/pii-masking.bats` test 8 passes; `node --test worker/lib/path-mask.test.js` test 10 passes (M1 stack-frame unit pin).

3. **Export zero-leak (PII-05):** Default-mode `/arcanon:export` outputs (mermaid, dot, html) contain zero `/Users/` or `/home/` strings.
   - **Evidence:** `bats tests/pii-masking.bats` tests 5, 6, 7 pass.

4. **HTTP zero-leak (PII-03):** `GET /graph`, `GET /api/scan-freshness`, and `GET /projects` HTTP responses contain zero absolute `$HOME` paths in any nested `repos[].path` array or per-service `repo_path` field.
   - **Evidence:** `bats tests/pii-masking.bats` tests 2, 3, 4 pass.

5. **Agent contract hardened (PII-06):** When the scanning agent emits a connection with an absolute `source_file`, the field is dropped with a WARN log; the connection still persists with its other fields; the scan does NOT fail.
   - **Evidence:** `node --test worker/scan/findings.pii06.test.js` Tasks F1 unit tests pass; `bats tests/pii-masking.bats` test 9 wraps it as a gate.

**Single-command verification of all 5 criteria:**
```bash
cd plugins/arcanon && node --test worker/lib/path-mask.test.js worker/scan/findings.pii06.test.js && cd .. && bats tests/pii-masking.bats
```

**S1 + S2 + M1 + X2 mitigation evidence:**
- S1: `path-mask.test.js` test 6 passes (relative paths idempotent).
- S2: `pii-masking.bats` test 10 passes (session-start.sh structural guard).
- M1: `path-mask.test.js` test 10 passes (stack-frame mask pin); `worker/lib/logger.js` has exactly one masking seam (Task D1 grep verification).
- X2: `findings.pii06.test.js` passes (WARN + drop, scan does NOT fail).

</acceptance_gate>

<!-- ============================================================ -->
<!-- Out of Scope (boundary fence)                                 -->
<!-- ============================================================ -->

<out_of_scope>

Explicit non-goals for Phase 123 — these belong to other phases or other milestones:

- **AUTH-* requirements** — Phases 124-127 (gated on hub-side THE-1030).
- **DB schema change to store relative paths** — REQUIREMENTS.md "Future Requirements (Deferred)" line 86; bigger refactor; not necessary if masking-at-egress works.
- **ChromaDB vector content audit** — REQUIREMENTS.md "Future Requirements (Deferred)" line 87; embeddings could carry path text; separate audit.
- **arcanon-hub side PII audit** — separate codebase, separate issue under arcanon-hub project.
- **Manifest version bumps to 0.1.5** — VER-01 is Phase 127.
- **CHANGELOG entry for v0.1.5** — VER-02 is Phase 127.
- **Editing logger call sites** — explicitly forbidden by M1 mitigation; the seam is single-edit in `logger.js`.
- **Touching `/api/verify`, `/api/logs`, `/api/scan-quality`, `/impact`, `/service/:name`, `/versions`, `/api/version`, `/api/readiness`** — out of PII-03 scope; those routes either don't return paths (`readiness`, `version`) or already use relative paths (`verify`'s `source_file`) or are post-PII-04-mask reads (`logs`).

</out_of_scope>

<verification>
Phase verification (run all in repo root unless noted):

```bash
# Wave 1 unit tests
cd plugins/arcanon && node --test worker/lib/path-mask.test.js && cd ..

# Wave 2 syntax checks
cd plugins/arcanon && node --check worker/mcp/server.js worker/server/http.js worker/lib/logger.js worker/cli/export.js && cd ..

# Wave 3 unit + bats
cd plugins/arcanon && node --test worker/scan/findings.pii06.test.js && cd ..
bats tests/pii-masking.bats

# Single-seam M1 verification (logger.js touched once, no call-site edits)
git diff --stat plugins/arcanon/worker/ | grep -E "logger\\.js" | wc -l   # → 1
git diff plugins/arcanon/worker/scan/manager.js plugins/arcanon/worker/server/http.js plugins/arcanon/worker/mcp/server.js | grep -E "^\\+.*logger\\.(info|warn|error|debug|log)" | wc -l   # should be 0 — no new logger calls were added; only egress wrapping

# Cross-seam grep regression: zero `/Users/` in any wave-2 seam after a clean scan (gated on env)
bats tests/pii-masking.bats
```

</verification>

<success_criteria>
See `<acceptance_gate>` above. All 5 ROADMAP success criteria must be true; all 4 risk mitigations (S1, S2, M1, X2) must have passing test evidence; all 7 REQ IDs (PII-01..07) must have passing test coverage per `<test_plan>`.
</success_criteria>

<output>
After completion, create:
- `.planning/phases/123-pii-path-masking/123-A-SUMMARY.md` (Wave 1)
- `.planning/phases/123-pii-path-masking/123-B-SUMMARY.md` (Wave 2 / Plan B — PII-02)
- `.planning/phases/123-pii-path-masking/123-C-SUMMARY.md` (Wave 2 / Plan C — PII-03)
- `.planning/phases/123-pii-path-masking/123-D-SUMMARY.md` (Wave 2 / Plan D — PII-04)
- `.planning/phases/123-pii-path-masking/123-E-SUMMARY.md` (Wave 2 / Plan E — PII-05)
- `.planning/phases/123-pii-path-masking/123-F-SUMMARY.md` (Wave 3 — PII-06 + PII-07 bats)
- `.planning/phases/123-pii-path-masking/123-SUMMARY.md` (overall phase rollup)

Each per-plan SUMMARY documents: files modified, REQ IDs closed, risk mitigations evidenced, test results, any deviations from this PLAN with rationale.
</output>
</content>
</invoke>