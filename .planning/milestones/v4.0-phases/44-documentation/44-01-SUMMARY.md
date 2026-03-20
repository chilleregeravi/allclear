---
phase: 44-documentation
plan: "01 + 02"
subsystem: documentation
tags: [rename, documentation, ligamen, branding]
dependency_graph:
  requires: [Phase 41 Commands & MCP]
  provides: [user-facing documentation with Ligamen branding]
  affects: [README.md, docs/, .planning/PROJECT.md, .planning/MILESTONES.md]
tech_stack:
  added: []
  patterns: [global string substitution across markdown files]
key_files:
  created: []
  modified:
    - README.md
    - docs/commands.md
    - docs/configuration.md
    - docs/hooks.md
    - docs/architecture.md
    - docs/service-map.md
    - docs/development.md
    - .planning/PROJECT.md
    - .planning/MILESTONES.md
decisions:
  - "Kept ROADMAP.md allclear references that describe the migration itself (success criteria, before/after comparisons) — these are informative historical context, not product name claims"
  - "PROJECT.md milestone goal description retained 'allclear' in the rename narrative (describing the old name being replaced) as this is context not branding"
metrics:
  duration: "~10 minutes"
  completed: "2026-03-19"
  tasks_completed: 3
  files_modified: 9
---

# Phase 44 Plans 01 + 02: Documentation Rename Summary

**One-liner:** Renamed AllClear to Ligamen across README.md, all six docs/ files, and three planning docs — product name, install commands, slash commands, config filenames, env vars, data paths, and MCP server name.

## Tasks Completed

### Plan 01 — Task 1: README.md

Rewrote README.md replacing every allclear/AllClear/ALLCLEAR reference:

- Product name: `AllClear` → `Ligamen` (title, description, section headings)
- Plugin install: `claude plugin install allclear --repo chilleregeravi/allclear` → `...ligamen --repo chilleregeravi/ligamen`
- Git clone URL: `chilleregeravi/allclear.git` → `chilleregeravi/ligamen.git`
- Plugin dir: `/path/to/allclear` → `/path/to/ligamen`
- All 6 slash commands: `/allclear:*` → `/ligamen:*`
- Project config: `allclear.config.json` → `ligamen.config.json`
- Machine settings: `~/.allclear/settings.json` → `~/.ligamen/settings.json`
- All 13 `ALLCLEAR_*` env vars → `LIGAMEN_*`
- MCP server name: `allclear-impact` → `ligamen-impact`
- Moved MCP server JSON snippet into README (was only in service-map.md)

Commit: `cad2c57` — feat(44-01): rename AllClear to Ligamen in README.md

### Plan 02 — Task 1: All six docs/ files

Updated docs/commands.md, docs/configuration.md, docs/hooks.md, docs/architecture.md, docs/service-map.md, docs/development.md:

- **docs/commands.md**: Opening line and all 6 command headings + usage blocks `/allclear:*` → `/ligamen:*`
- **docs/configuration.md**: `allclear.config.json` → `ligamen.config.json`, `~/.allclear/` → `~/.ligamen/`, all `ALLCLEAR_*` → `LIGAMEN_*` in tables and JSON blocks, data directory tree, `AllClear` product name
- **docs/hooks.md**: `AllClear hooks` → `Ligamen hooks`, four `ALLCLEAR_DISABLE_*` → `LIGAMEN_DISABLE_*`
- **docs/architecture.md**: Directory tree top `allclear/` → `ligamen/`, `(plugin:allclear)` → `(plugin:ligamen)`, command namespace text
- **docs/service-map.md**: `AllClear scans` → `Ligamen scans`, command references, `allclear-impact` → `ligamen-impact`, MCP JSON snippet path
- **docs/development.md**: git clone URL, `cd allclear` → `cd ligamen`, plugin-dir path, `/allclear:quality-gate` → `/ligamen:quality-gate`

### Plan 02 — Task 2: Planning docs

- **.planning/PROJECT.md**: Top heading `# AllClear` → `# Ligamen`, all validated requirements `/allclear:*` → `/ligamen:*`, `(plugin:allclear)` → `(plugin:ligamen)`, constraint `allclear.config.json` → `ligamen.config.json`, out-of-scope "keep AllClear focused" → "keep Ligamen focused", key decisions table `allclear.config.json` → `ligamen.config.json`
- **.planning/MILESTONES.md**: v3.0 boundary grouping line `allclear.config.json` → `ligamen.config.json`
- **.planning/ROADMAP.md**: No changes made — all remaining allclear references are in migration success criteria and before/after comparisons describing the rename itself, not product name claims

Commit: `ad205d7` — feat(44-02): rename AllClear to Ligamen in docs/ and planning docs

## Deviations from Plan

None — plan executed exactly as written. One judgment call made per plan guidance: ROADMAP.md allclear references retained as they are descriptive of the rename migration (success criteria for what old names to replace), not product name claims.

## Verification Results

All acceptance criteria passed:

- `grep -c "allclear\|AllClear\|ALLCLEAR" README.md` → 0 (PASS)
- `grep -c "ligamen\|Ligamen\|LIGAMEN" README.md` → 39 (PASS, >25 required)
- `grep "claude plugin install ligamen" README.md` → match (PASS)
- `grep -c "ligamen.config.json" README.md` → 1 (PASS)
- `grep -c "~/.ligamen/" README.md` → 2 (PASS)
- `grep "LIGAMEN_WORKER_PORT" README.md` → match (PASS)
- `grep "/ligamen:quality-gate" README.md` → match (PASS)
- `grep "ligamen-impact" README.md` → match (PASS)
- `grep -ri "allclear" docs/` → no output (PASS)
- `grep "/ligamen:quality-gate" docs/commands.md` → match (PASS)
- `grep -c "ligamen.config.json" docs/configuration.md` → 1+ (PASS)
- `grep -c "~/.ligamen/" docs/configuration.md` → 5 (PASS, >3 required)
- `grep "LIGAMEN_DISABLE_FORMAT" docs/hooks.md` → match (PASS)
- `grep "plugin:ligamen" docs/architecture.md` → match (PASS)
- `grep "ligamen-impact" docs/service-map.md` → match (PASS)
- `grep "chilleregeravi/ligamen" docs/development.md` → match (PASS)
- `grep "# Ligamen" .planning/PROJECT.md` → match (PASS)
- `grep "ligamen.config.json" .planning/MILESTONES.md` → match (PASS)

## Self-Check: PASSED

All modified files verified present and containing expected Ligamen branding. Both commits exist: cad2c57 and ad205d7.
