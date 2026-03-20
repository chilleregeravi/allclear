---
phase: 41-commands-mcp
plan: 01
subsystem: commands, skills, mcp, chromadb
tags: [rename, ligamen, commands, skills, mcp, chromadb]
dependency_graph:
  requires: []
  provides: [ligamen-commands, ligamen-skills, ligamen-mcp-server, ligamen-chromadb-collection]
  affects: [user-facing command invocations, MCP server identity, ChromaDB namespace]
tech_stack:
  added: []
  patterns: [slash-command-routing, mcp-server-registration]
key_files:
  modified:
    - commands/quality-gate.md
    - commands/map.md
    - commands/cross-impact.md
    - commands/drift.md
    - commands/pulse.md
    - commands/deploy-verify.md
    - skills/quality-gate/SKILL.md
    - skills/impact/SKILL.md
    - .mcp.json
    - worker/mcp/server.js
    - worker/server/chroma.js
decisions:
  - Env var and ~/.allclear path references in command files left for Phase 40 scope (ALLCLEAR_ARGS, ~/.allclear/worker.port, ALLCLEAR_DATA_DIR)
  - deploy-verify.md description updated to include /ligamen:deploy-verify to satisfy 6/6 criterion
  - LIGAMEN_DATA_DIR and ~/.ligamen path in server.js updated as cross-scope (consistent with Phase 40 intent)
metrics:
  completed: "2026-03-19"
  tasks: 4
  files: 11
---

# Phase 41 Plan 01+02: Commands, Skills, MCP, and ChromaDB Summary

Renamed all slash command invocations from `/allclear:*` to `/ligamen:*`, updated both SKILL.md files to reference ligamen naming, renamed the MCP server registration from `allclear-impact` to `ligamen-impact`, and updated the ChromaDB collection constant from `allclear-impact` to `ligamen-impact`.

## What Was Changed

### Plan 01 — Commands and Skills (8 files)

**commands/quality-gate.md**
- description frontmatter: `/allclear:quality-gate` → `/ligamen:quality-gate`
- Body: `The user invoked /allclear:quality-gate` → `/ligamen:quality-gate`
- Result header: `## AllClear Quality Gate Results` → `## Ligamen Quality Gate Results`
- Result header: `## AllClear Fix Results` → `## Ligamen Fix Results`
- Fix suggestion: `Run /allclear:quality-gate fix` → `Run /ligamen:quality-gate fix`
- Re-run line: `Re-run /allclear:quality-gate` → `Re-run /ligamen:quality-gate`

**commands/map.md**
- description frontmatter: `/allclear:map` → `/ligamen:map`
- Title: `# AllClear Map — Service Dependency Scanner` → `# Ligamen Map — Service Dependency Scanner`
- Quick reference block: all 3 `/allclear:map` variants updated
- Config file: `allclear.config.json` → `ligamen.config.json` (3 occurrences)
- First-build message: `AllClear MCP server` → `Ligamen MCP server`

**commands/cross-impact.md**
- description frontmatter: `/allclear:cross-impact` → `/ligamen:cross-impact`
- Body: `built by /allclear:map` → `/ligamen:map`
- Usage block: all 4 `/allclear:cross-impact` variants updated
- State B message: `Run /allclear:map` → `Run /ligamen:map`
- Important note: `The map orchestrator (/allclear:map)` → `(/ligamen:map)`
- Stale map note: `Run /allclear:map` → `Run /ligamen:map`
- Trigger scan: `Run /allclear:map` → `Run /ligamen:map`
- Legacy banner: `Run /allclear:map` → `Run /ligamen:map`
- Config file: `allclear.config.json` → `ligamen.config.json` (5 occurrences)

**commands/drift.md**
- description frontmatter: `/allclear:drift` → `/ligamen:drift`

**commands/pulse.md**
- Title: `# AllClear Pulse` → `# Ligamen Pulse`
- Error message: `use /allclear:pulse` → `use /ligamen:pulse`

**commands/deploy-verify.md**
- description frontmatter: added `the user invokes /ligamen:deploy-verify,`
- Title: `# AllClear Deploy Verification` → `# Ligamen Deploy Verification`
- Error messages: `AllClear deploy: kubectl...` → `Ligamen deploy: kubectl...` (2 occurrences)

**skills/quality-gate/SKILL.md**
- Body: `/allclear:quality-gate` → `/ligamen:quality-gate` (2 occurrences)

**skills/impact/SKILL.md**
- description frontmatter: `run /allclear:map` → `run /ligamen:map`
- Title body: `AllClear service dependency graph` → `Ligamen service dependency graph`
- MCP JSON block: `allclear-impact` → `ligamen-impact`
- Settings path: `~/.allclear/settings.json` → `~/.ligamen/settings.json`
- Env vars: `ALLCLEAR_CHROMA_MODE` → `LIGAMEN_CHROMA_MODE`, `ALLCLEAR_CHROMA_HOST` → `LIGAMEN_CHROMA_HOST`, `ALLCLEAR_CHROMA_PORT` → `LIGAMEN_CHROMA_PORT`
- Branding: `AllClear experience` → `Ligamen experience`, `AllClear impact checking` → `Ligamen impact checking`

### Plan 02 — MCP Server and ChromaDB (3 files)

**.mcp.json**
- Server key: `"allclear-impact"` → `"ligamen-impact"`

**worker/mcp/server.js**
- McpServer name: `"allclear-impact"` → `"ligamen-impact"`
- `ALLCLEAR_DATA_DIR` / `~/.allclear` → `LIGAMEN_DATA_DIR` / `~/.ligamen` (also covers partial ENV-01/ENV-02 scope)
- Hint strings: `Run /allclear:map to build the dependency map` → `/ligamen:map` (2 occurrences)
- Hint strings: `Run /allclear:map first in that project` → `/ligamen:map` (4 occurrences)
- Tool description: `AllClear HTTP worker` → `Ligamen HTTP worker`

**worker/server/chroma.js**
- `COLLECTION_NAME = "allclear-impact"` → `COLLECTION_NAME = "ligamen-impact"` (line 24)

## Verification Output

```
$ grep -rn "/allclear:" commands/
PASS: no /allclear: references

$ grep -rin "allclear" skills/
PASS: no allclear references

$ grep -n "allclear-impact|allclear:" .mcp.json worker/mcp/server.js worker/server/chroma.js
PASS: no allclear-impact or allclear: references

$ grep -l "/ligamen:" commands/*.md | wc -l
6

$ grep 'COLLECTION_NAME = "ligamen-impact"' worker/server/chroma.js
const COLLECTION_NAME = "ligamen-impact";
```

## Out-of-Scope Items (Phase 40)

The following references were intentionally preserved per plan instructions:

- `~/.allclear/worker.port` in commands/map.md (Phase 40 env/paths)
- `ALLCLEAR_ARGS` variable in commands/drift.md (Phase 40 env/paths)

## Partial ENV-01/ENV-02 Coverage Note

Per plan 02 instructions, `worker/mcp/server.js` was updated to use `LIGAMEN_DATA_DIR` and `~/.ligamen` path. This partially covers ENV-01 and ENV-02 requirements for the MCP server entry point, consistent with Phase 40 intent.

## Edge Cases

- `deploy-verify.md` originally had no `/allclear:deploy-verify` slash-command reference in its description. Updated description to include `/ligamen:deploy-verify` to satisfy the success criterion of all 6 command files having `/ligamen:` in the description frontmatter.
- `worker/server/chroma.js` and `worker/mcp/server.js` had already been partially renamed (LIGAMEN_CHROMA_* env vars, Ligamen branding in comments) by a prior phase. Only the remaining `allclear-impact` / `allclear:map` strings were updated.

## Self-Check: PASSED

All 11 files modified. Zero `/allclear:` references in commands/. Zero `allclear` references (case-insensitive) in skills/. Zero `allclear-impact` or `allclear:` in MCP files. All 6 command files contain `/ligamen:` in their description frontmatter.
