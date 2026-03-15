# AllClear

## What This Is

An open-source Claude Code plugin that provides automated quality gates, cross-repo awareness, and continuous formatting/linting hooks for multi-repository development workflows. Designed for teams managing multiple repos across Python, Rust, TypeScript, and Go — detects project type automatically and runs the right tools without configuration.

## Core Value

Every edit is automatically formatted and linted, every quality check runs with one command, and breaking changes across repos are caught before they ship.

## Requirements

### Validated

- ✓ Universal quality gate command (`/allclear:quality-gate`) with auto-detection of project type — v1.0
- ✓ Cross-repo impact scanning (`/allclear:cross-impact`) — v1.0
- ✓ Cross-repo consistency checking (`/allclear:drift`) — v1.0
- ✓ Live service health checking (`/allclear:pulse`) — v1.0
- ✓ Deploy state verification (`/allclear:deploy-verify`) — v1.0
- ✓ Auto-format hook on edit (PostToolUse) — v1.0
- ✓ Auto-lint hook on edit (PostToolUse) — v1.0
- ✓ Sensitive file guard hook (PreToolUse) — v1.0
- ✓ Session start context hook (SessionStart) — v1.0
- ✓ Git clone + symlink installation path — v1.0
- ✓ Bats test suite (150 tests) — v1.0
- ✓ Plugin commands use `(plugin:allclear)` namespacing via commands/ directory — v1.0
- ✓ Quality gate skill for auto-invocation by agents — v1.0

### Active

(Defined per milestone — see current milestone below)

### Out of Scope

- Linear issue enrichment — other plugins cover this; no external service dependencies
- GitHub Issues integration — same reasoning
- Any issue tracker integration — keep AllClear focused on code and infrastructure
- RamaEdge-specific logic — plugin must remain generic and framework-agnostic
- Auto-fix for test/typecheck failures — unsafe, may silently alter code semantics

## Context

Shipped v1.0 with 4,323 LOC (shell scripts, bats tests, commands, configs). 13 phases, 17 plans, 79 requirements, 150 bats tests passing. Plugin installed via marketplace and operational.

Architecture: commands/ for user-invoked features (namespaced as `plugin:allclear`), skills/ for auto-invoked contextual knowledge (quality-gate only), hooks/ for automated formatting/linting/guarding, lib/ for shared bash libraries, scripts/ for hook implementations.

Post-v1.0 structural changes: migrated from skills/ to commands/ for proper namespacing, renamed siblings to linked-repos terminology.

Design document for v2.0 cross-impact redesign at `.planning/designs/cross-impact-v2.md` — service dependency intelligence with agent-based scanning, SQLite + ChromaDB, MCP server, localhost graph UI.

## Constraints

- **Plugin format**: Must follow Claude Code plugin conventions (commands/, skills/, hooks.json)
- **Framework-agnostic**: Detect project type from files, never assume a specific framework
- **No external service deps**: Every command must work with only local files, git, and optionally kubectl
- **License**: Apache 2.0
- **Testing**: Bats-core for hook shell scripts
- **Detect, don't configure**: Infer everything from project files; zero-config by default with optional overrides via allclear.config.json
- **Non-blocking hooks**: Format/lint hooks must not block edits on failure — warn and continue
- **Cross-repo discovery**: Auto-detect linked repos from parent directory, override with config file

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Dedicated repo (not part of claude-code) | Clean separation between private orchestration and open-source plugin | ✓ Good |
| Drop /allclear scope | Other plugins handle issue enrichment; keeps AllClear zero external deps | ✓ Good |
| Apache 2.0 license | Permissive with patent protection, standard for dev tools | ✓ Good |
| Auto-detect + config override for linked repos | Parent dir scan works for flat layouts, config.json for custom setups | ✓ Good |
| Include pulse/deploy in v1 | Ship with graceful skip if no kubectl | ✓ Good |
| Full plugin scope for v1 | 5 commands + 4 hooks — ambitious but delivered | ✓ Good |
| commands/ over skills/ for user features | Skills don't get plugin namespacing; commands get `(plugin:allclear)` automatically | ✓ Good |
| siblings → linked-repos rename | Repos may not be siblings but connected; linked-repos is more accurate | ✓ Good |
| Cross-impact v2 as separate milestone | Service dependency intelligence is a major new capability, not a patch | — Pending |

---
*Last updated: 2026-03-15 after v1.0 milestone*
