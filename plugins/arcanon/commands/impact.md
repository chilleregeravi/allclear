---
description: Query cross-repo consumers and downstream impact for a service, endpoint, or schema. Auto-detects changed symbols from git diff when invoked with no target or --changed. Degrades gracefully to grep-based scanning when no dependency map is available.
allowed-tools: Bash, mcp__arcanon__*, Read, Write, AskUserQuestion
argument-hint: "[target] [--direction downstream|upstream] [--hops N] [--changed] [--exclude <repo>]"
---

# Arcanon Impact

Answer the question: **"If I change this, what breaks?"** Queries the Arcanon graph for every
connection, endpoint, or schema that touches the named target, then follows transitive edges
up to the given hop limit. When no map is available, falls back to a grep-based symbol scan
across linked repos so existing users are never blocked.

## Usage

| Invocation | Behaviour |
| --- | --- |
| `/arcanon:impact <target>` | Query impact for the named service, endpoint, or schema. |
| `/arcanon:impact` *(no args)* | Auto-detect changed symbols from `git diff HEAD` and query impact for each. Same as `--changed`. |
| `/arcanon:impact --changed` | Explicit form of the no-args auto-detect. |
| `/arcanon:impact --exclude <repo>` | Filter the named repo out of the results. Repeat for multiple repos. |
| `/arcanon:impact --direction upstream` | "What affects me?" instead of the default "What do I affect?" |
| `/arcanon:impact --hops N` | Max traversal depth (default 3). |

Flags combine: `/arcanon:impact --changed --exclude legacy-repo` auto-detects changed symbols
and filters `legacy-repo` out of every impact result.

---

## Step 0 — Detect State (worker + map availability)

```bash
source ${CLAUDE_PLUGIN_ROOT}/lib/worker-client.sh
WORKER_UP=$(worker_running && echo "yes" || echo "no")
```

If `WORKER_UP=yes`, check whether the map has data:

```bash
GRAPH_RESPONSE=$(worker_call GET /graph 2>/dev/null || echo "[]")
```

Parse: if `GRAPH_RESPONSE` contains at least one service node (non-empty array or non-empty
`services` key), set `MAP_HAS_DATA=yes`; otherwise `MAP_HAS_DATA=no`.

**Three degradation states:**

| State | Condition | Action |
| --- | --- | --- |
| **A — No worker, no map** | `WORKER_UP=no` | Jump to **Legacy Fallback** |
| **B — Worker up, no map data** | `WORKER_UP=yes`, `MAP_HAS_DATA=no` | Print `No scan data found. Run \`/arcanon:map\` to build the dependency map first.` Then jump to **Legacy Fallback** and return its results as a partial answer. |
| **C — Worker up, map has data** | `WORKER_UP=yes`, `MAP_HAS_DATA=yes` | Proceed with **Graph Query Flow** |

> **Important:** Do NOT attempt to start the worker from this command. The map orchestrator
> (`/arcanon:map`) owns the worker lifecycle. Impact is a query-only command.

---

## Step 1 — Parse Arguments

Parse `$ARGUMENTS`:

- **Positional target** — service name, endpoint path, or schema name. Optional.
- **`--changed`** — no positional target required. Auto-detect from git diff (see below). If a
  positional target is ALSO provided alongside `--changed`, the positional target wins and
  the `--changed` auto-detect is skipped.
- **`--exclude <repo>`** — can be repeated. Collect all excluded repo names into a list; apply
  as a filter to every result set (graph or grep). Repo-name match is exact on the result's
  `service` / repo path basename.
- **`--direction downstream|upstream`** — default `downstream`. Orthogonal to `--changed` /
  `--exclude`; applies to every target being queried.
- **`--hops N`** — default 3. Orthogonal; applies to every target.

If no positional target AND no `--changed` flag AND no `$ARGUMENTS` at all, treat this as
implicit `--changed` (user ran `/arcanon:impact` bare).

### `--changed` auto-detect

When `--changed` is active (explicit or implicit), collect changed symbols from git:

```bash
DIFF_UNCOMMITTED=$(git diff --name-only HEAD 2>/dev/null)
DIFF_RECENT=$(git diff --name-only HEAD~1 HEAD 2>/dev/null)
CHANGED_FILES=$(printf "%s\n%s\n" "$DIFF_UNCOMMITTED" "$DIFF_RECENT" | sort -u | grep -v '^$')
```

If `CHANGED_FILES` is empty, ask via AskUserQuestion:

> No changes detected. What would you like to check? (enter a service name or endpoint path)

For each changed file, derive the query target — typically the module name, exported symbol,
or endpoint path the file defines. Run one impact query per target and deduplicate results by
`service` + `change_type`.

---

## State C — Graph Query Flow (worker up, map has data)

### Step 2 — Query the impact graph

Prefer MCP — call `mcp__arcanon__impact_query` (for transitive consumer walks) or
`mcp__arcanon__impact_graph` (for a bounded subgraph). Payload:

```json
{ "target": "<name>", "direction": "downstream", "hops": 3 }
```

Fall back to HTTP if MCP isn't available:

```bash
worker_call "/api/impact?target=<name>&direction=<direction>&hops=<hops>"
```

For each target from Step 1, collect the `affected` array. **Apply `--exclude` filter here:**
drop any row whose `service` or repo basename matches an entry in the excluded-repo list.

The worker returns JSON in this shape:

```json
{
  "affected": [
    {
      "service": "auth-service",
      "change_type": "endpoint_removed",
      "severity": "CRITICAL",
      "consumers": ["api-gateway", "user-service"],
      "transitive_depth": 2,
      "files": ["src/client/auth.ts:42"]
    }
  ]
}
```

Severity mapping: `endpoint_removed` → **CRITICAL**, `field_type_changed` → **WARN**,
`field_added` → **INFO**.

### Step 3 — Render the report

Produce a structured report grouped by severity (CRITICAL first, then WARN, then INFO).
Highlight cross-repo edges with a ↪ marker so the user sees which changes ripple out of their
own repo. End with a "Transitive blast radius: N unique services" line.

If all rows were filtered out by `--exclude` (empty result after filtering), say so explicitly:
`No impact found after applying --exclude filters (N rows filtered).`

### Step 4 — Suggest re-scan if map may be stale

Check the `repo_state` table (via `/graph` or a direct query) — if the `last_scanned_commit`
for any linked repo is earlier than its current HEAD, the map may be stale. If so:

```
Note: Your dependency map may not reflect recent code changes.
Run `/arcanon:map` to re-scan and catch any new or removed connections.
```

---

## Legacy Fallback — States A and B

Print this banner before running the legacy scan:

```
[Legacy mode — dependency map not available]
Using grep-based symbol scan. Run /arcanon:map for full dependency intelligence.
```

In State B, print the State B prompt first (see state table above), THEN this banner, THEN
proceed with the scan as a partial answer.

### Linked-repos configuration check

- Config file exists: !`test -f arcanon.config.json && echo "yes" || echo "no"`
- Config contents: !`test -f arcanon.config.json && cat arcanon.config.json || echo "{}"`
- Auto-discovered repos: !`source ${CLAUDE_PLUGIN_ROOT}/lib/linked-repos.sh && list_linked_repos 2>/dev/null`

If `arcanon.config.json` exists with a non-empty `linked-repos` array, use it. If not, ask the
user to choose: (1) Auto-detect + confirm, (2) Manual entry, (3) Skip (use auto-discovery for
this run only). The prompt flow and decision tree are identical to the behaviour documented
in the legacy cross-impact command — preserve it verbatim for users who relied on it.

### Legacy scan

Run the v1.0 impact scanner. Pass through the same argument surface — positional symbols,
`--changed`, `--exclude`:

```bash
bash ${CLAUDE_PLUGIN_ROOT}/scripts/impact.sh [args]
```

Each match line is tab-separated:

```
{repo}  {term}  {type}  {filepath}
```

**Apply `--exclude` filter here too:** drop any match line whose `{repo}` matches an entry in
the excluded-repo list.

Summarise by repo: which repos have matches, what match types appear, how many unique files
per repo. Highlight `code`-type matches as highest risk — these are direct source references
that will break if the symbol is removed or renamed.

Match types and risk levels:

| Type | Risk | Meaning |
| --- | --- | --- |
| code | HIGH | Direct source reference — will break if symbol is removed/renamed |
| config | MEDIUM | Configuration reference — may need updating |
| test | LOW | Test reference — tests will need updating, not a runtime break |
| docs | LOW | Documentation reference — no runtime impact |

Lead with a one-line summary: `X repos reference <symbol>, Y with code matches.` Report unique
file count per repo (not line count) — one file with 40 references is less significant than 40
files with one reference each.

If no matches remain after filtering, confirm the symbol appears safe to change or remove.

---

## When there's no scan data

In State B, always tell the user to run `/arcanon:map` first — the grep fallback is a partial
answer, not a replacement for the graph. In State A, the same suggestion applies once they've
run the worker (`/arcanon:map` will start it).

## Hub freshness hint

If `/arcanon:status` reports credentials as present and the user hasn't run a sync recently,
mention:

> Want up-to-date cross-org impact? Run `/arcanon:sync` then re-query — the hub may have
> fresher data from teammates.
