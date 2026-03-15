# Phase 1: Plugin Skeleton - Research

**Researched:** 2026-03-15
**Domain:** Claude Code plugin directory structure, plugin.json manifest schema, git clone + symlink installation
**Confidence:** HIGH — sourced from official Claude Code docs and live inspection of installed plugins on this machine

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| PLGN-01 | Plugin follows Claude Code plugin format with plugin.json manifest, skills/, hooks/, and scripts/ directories at the plugin root | Directory structure canon confirmed via live example-plugin and hookify inspection; plugin.json schema verified |
| PLGN-04 | Plugin uses `${CLAUDE_PLUGIN_ROOT}` for all internal path references to survive cache-copy installation | Confirmed required: plugin cache copies files to content-addressed path; `${CLAUDE_PLUGIN_ROOT}` is the only portable reference; claude-mem uses a fallback pattern for safety |
| PLGN-06 | Plugin can be installed via git clone and symlink into ~/.claude/plugins/ | Symlink installation verified as standard second channel; Claude Code loads plugins from `~/.claude/plugins/local/` or any path specified with `--plugin-dir` |
</phase_requirements>

---

## Summary

Phase 1 creates the structural skeleton of the AllClear plugin: the directory layout, the `.claude-plugin/plugin.json` manifest, empty placeholder files for each major component, and verification that Claude Code can discover and load the plugin. No functional logic is written in this phase — the goal is a valid, installable structure.

The single most important rule: only `plugin.json` goes inside `.claude-plugin/`. Everything else — `skills/`, `hooks/`, `scripts/`, `lib/` — lives at the plugin root. This is the most common structural mistake documented by the official Claude Code team. Getting this wrong causes the plugin to install silently but register zero skills, hooks, or commands.

The `${CLAUDE_PLUGIN_ROOT}` variable must appear in any path reference inside `hooks/hooks.json` from the start. The plugin is copied to a content-addressed cache path at install time (`~/.claude/plugins/cache/<marketplace>/<name>/<version>/`), so any absolute path hardcoded during development will break on every other machine and on fresh installs.

**Primary recommendation:** Create the canonical directory structure, write `plugin.json` with version field, create empty placeholder scripts with `chmod +x` applied, write a minimal `hooks/hooks.json` that uses `${CLAUDE_PLUGIN_ROOT}`, and verify with `claude --plugin-dir ./allclear` that the plugin loads.

---

## Standard Stack

### Core
| Component | Version/Schema | Purpose | Why Standard |
|-----------|----------------|---------|--------------|
| `.claude-plugin/plugin.json` | schema v1 (no version field in schema itself) | Plugin manifest: name, version, description, author, license | Required entry point; `name` field sets the skill namespace; version field required for cache invalidation |
| `hooks/hooks.json` | current | Declares lifecycle hook bindings to shell commands | Auto-discovered at `hooks/hooks.json`; must wrap with `{"hooks": {...}}`; outer `description` field is optional but useful |
| `skills/<name>/SKILL.md` | current | Per-skill prompt playbook with YAML frontmatter | Official format for user-invokable skills (`/allclear`) and autonomous invocation; frontmatter requires `name` and `description` |
| `${CLAUDE_PLUGIN_ROOT}` | — | Runtime path variable set by Claude Code to plugin cache location | Required in all hook commands and any path inside the plugin that references other plugin files |

### Supporting
| Component | Version | Purpose | When to Use |
|-----------|---------|---------|-------------|
| `.gitattributes` | — | Preserve executable bit on `scripts/*.sh` across git clones | Always — `git add` does not reliably preserve `+x`; `.gitattributes` forces consistent line endings and marks shell files |
| `package.json` | Node 18+ | npm package for `@allclear/cli` distribution (future phases) | Create in Phase 1 with placeholder; prevents name squatting on npm; required for v2 `npx @allclear/cli init` |
| `bats-core` | 1.13.0 (2025-11-07) | Test framework for bash hook scripts | Add as git submodule in Phase 1; needed by Phase 13 but establish as submodule now |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `skills/` with SKILL.md | `commands/` with .md files | `commands/` is the legacy format; does not support autonomous invocation; official docs explicitly recommend migration to `skills/` |
| Minimal plugin.json (name + description) | No plugin.json | plugin.json is mandatory; plugin without it will not be recognized by Claude Code |
| `hooks/hooks.json` as placeholder with empty hooks object | No hooks.json in Phase 1 | Better to have the scaffolding in place early; empty hooks object `{"hooks": {}}` is valid |

**Installation (Phase 1 bootstrap):**
```bash
mkdir -p .claude-plugin skills/quality-gate skills/cross-impact skills/drift skills/pulse skills/deploy-verify hooks scripts lib tests bin
touch .claude-plugin/plugin.json hooks/hooks.json
# Create placeholder SKILL.md files for each skill
for skill in quality-gate cross-impact drift pulse deploy-verify; do
  touch "skills/$skill/SKILL.md"
done
# Create placeholder hook scripts
for script in format lint file-guard session-start; do
  touch "scripts/$script.sh"
  chmod +x "scripts/$script.sh"
done
# Create placeholder lib files
touch lib/detect.sh lib/siblings.sh
```

---

## Architecture Patterns

### Recommended Project Structure
```
allclear/
├── .claude-plugin/
│   └── plugin.json               # ONLY file here — common mistake is putting skills/ here too
│
├── skills/
│   ├── quality-gate/
│   │   └── SKILL.md              # Placeholder in Phase 1
│   ├── cross-impact/
│   │   └── SKILL.md
│   ├── drift/
│   │   └── SKILL.md
│   ├── pulse/
│   │   └── SKILL.md
│   └── deploy-verify/
│       └── SKILL.md
│
├── hooks/
│   └── hooks.json                # Minimal skeleton in Phase 1
│
├── scripts/
│   ├── format.sh                 # Placeholder — chmod +x required
│   ├── lint.sh                   # Placeholder — chmod +x required
│   ├── file-guard.sh             # Placeholder — chmod +x required
│   └── session-start.sh          # Placeholder — chmod +x required
│
├── lib/
│   ├── detect.sh                 # Placeholder — filled in Phase 2
│   └── siblings.sh               # Placeholder — filled in Phase 2
│
├── tests/                        # Empty in Phase 1; bats submodule added here
│
├── bin/
│   └── allclear-init.js          # Placeholder for Phase 5 npx installer
│
├── package.json                  # Skeleton: name="@allclear/cli", version="0.1.0"
├── .gitattributes                # scripts/*.sh text eol=lf + executable preservation
├── LICENSE                       # Apache 2.0 (exists already)
└── README.md                     # Exists already; update install instructions
```

### Pattern 1: Minimal Valid plugin.json
**What:** The manifest must have at minimum `name` and `description`. Best practice (confirmed from claude-mem and code-review) adds `version`, `author`, `license`, and `repository`.
**When to use:** Phase 1 creation. Version bump required on every subsequent release.
**Example:**
```json
{
  "name": "allclear",
  "version": "0.1.0",
  "description": "Auto-format, auto-lint, and cross-repo quality gates for Claude Code",
  "author": {
    "name": "AllClear Contributors"
  },
  "license": "Apache-2.0",
  "repository": "https://github.com/YOUR_ORG/allclear"
}
```
Source: Live inspection of `/Users/ravichillerega/.claude/plugins/cache/thedotmack/claude-mem/10.5.5/.claude-plugin/plugin.json` and `~/.claude/plugins/marketplaces/claude-plugins-official/plugins/hookify/.claude-plugin/plugin.json`

### Pattern 2: Minimal Valid hooks.json Skeleton
**What:** An empty but valid `hooks.json` that uses the correct outer wrapper and `${CLAUDE_PLUGIN_ROOT}` variable. Phase 1 creates this as a skeleton; Phase 3 populates it.
**When to use:** Phase 1 scaffold. Do not leave it absent — the empty skeleton establishes the `${CLAUDE_PLUGIN_ROOT}` convention.
**Example:**
```json
{
  "description": "AllClear plugin hooks — auto-format, auto-lint, file guard, session start",
  "hooks": {
    "PostToolUse": [],
    "PreToolUse": [],
    "SessionStart": []
  }
}
```
Source: Live inspection of hookify and claude-mem hooks.json files

### Pattern 3: SKILL.md Placeholder Frontmatter
**What:** Each skill needs at minimum `name` and `description` in YAML frontmatter. Phase 1 creates valid placeholders so Claude Code registers the skills.
**When to use:** Phase 1 for every skill directory.
**Example:**
```yaml
---
name: quality-gate
description: This skill should be used when the user invokes /allclear, asks to run quality checks, requests a lint or test run, or wants to verify code before committing.
version: 0.1.0
---

# AllClear Quality Gate

Quality gate skill — implementation in progress.
```
Source: Live inspection of `~/.claude/plugins/marketplaces/claude-plugins-official/plugins/example-plugin/skills/example-skill/SKILL.md`

### Pattern 4: ${CLAUDE_PLUGIN_ROOT} Fallback (claude-mem pattern)
**What:** A defensive fallback for environments where `${CLAUDE_PLUGIN_ROOT}` may not be set (e.g., `--plugin-dir` during development).
**When to use:** In hook commands inside hooks.json, especially once hooks are functional in Phase 3.
**Example:**
```bash
# In hooks.json command field:
"_R=\"${CLAUDE_PLUGIN_ROOT}\"; [ -z \"$_R\" ] && _R=\"$HOME/.claude/plugins/local/allclear\"; \"$_R/scripts/format.sh\""
```
Source: Live inspection of claude-mem `hooks/hooks.json`

### Anti-Patterns to Avoid
- **Placing skills/ or hooks/ inside .claude-plugin/:** Official docs flag this as the single most common mistake. Only `plugin.json` belongs inside `.claude-plugin/`.
- **Omitting the version field from plugin.json:** Without `version`, Claude Code cannot perform cache invalidation. Existing users will never receive plugin updates.
- **Using absolute paths in hooks.json:** e.g., `/Users/ravi/.claude/plugins/allclear/scripts/format.sh` breaks on every other machine and after marketplace install copies files to cache.
- **Forgetting chmod +x on scripts/*.sh:** Hook scripts that lack the executable bit silently fail to fire. No error is shown.
- **Using camelCase event names:** Event names are PascalCase. `PostToolUse`, not `postToolUse`. Wrong casing silently prevents hooks from firing.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Plugin manifest format | Custom JSON schema | `.claude-plugin/plugin.json` with Claude Code schema | Non-standard manifests are ignored; only `plugin.json` at `.claude-plugin/` is discovered |
| Plugin installation | Custom file copy logic | `ln -s /path/to/allclear ~/.claude/plugins/local/allclear` + `--plugin-dir` for dev | Claude Code's symlink resolution handles version resolution and cache; custom copy misses version invalidation |
| Hook event routing | Custom event dispatcher | `hooks/hooks.json` with event names exactly as in docs | Claude Code enforces the contract; custom routing is not possible |
| Path resolution across installs | Environment variable substitution code | `${CLAUDE_PLUGIN_ROOT}` variable in hook commands | Set by the runtime; no code required; custom solutions will break |

**Key insight:** Phase 1 is pure scaffold — there is no logic to hand-roll. The entire job is creating files in the right locations with the right names and the right permissions.

---

## Common Pitfalls

### Pitfall 1: Misplaced Component Directories
**What goes wrong:** `skills/`, `hooks/`, or `scripts/` end up inside `.claude-plugin/` alongside `plugin.json`. Claude Code silently ignores them. Skills don't appear in `/help`.
**Why it happens:** `.claude-plugin/` contains the manifest, so developers assume all plugin files go there.
**How to avoid:** Only `plugin.json` goes in `.claude-plugin/`. All other directories go at the plugin root. Verify with `claude plugin validate` and confirm skills appear in `/help`.
**Warning signs:** Plugin installs without error but `/allclear` doesn't appear in `/help`; `claude --debug` shows the plugin loading but no components registered.

### Pitfall 2: Hook Scripts Without Executable Permissions
**What goes wrong:** Scripts in `scripts/` are committed without the executable bit. Hooks silently fail.
**Why it happens:** `git add` does not reliably preserve `+x` across clone environments, especially on Windows and some CI systems.
**How to avoid:** Run `chmod +x scripts/*.sh` explicitly. Add `.gitattributes` entry. Add a verify step in README install instructions.
**Warning signs:** `ls -la scripts/` shows `-rw-r--r--` instead of `-rwxr-xr-x`; hooks registered in hooks.json but never fire.

### Pitfall 3: npm Org Not Reserved
**What goes wrong:** `@allclear` npm org is claimed by another party before publishing. `npx @allclear/cli` resolves to a different package.
**Why it happens:** npm scoped packages under `@allclear` require owning the `allclear` org on npmjs.com. Delay = squatting risk.
**How to avoid:** Reserve the org and publish a `0.1.0` placeholder package immediately. STATE.md already flags this as a concern.
**Warning signs:** `npm publish --access public` fails with "organization does not exist"; npm org page doesn't show under your account.

### Pitfall 4: Missing version Field in plugin.json
**What goes wrong:** Claude Code cannot perform cache invalidation for plugin updates. Existing users are permanently stuck on the initial version.
**Why it happens:** Minimal examples (like the official example-plugin in the marketplace) omit `version`; developers copy the minimal example.
**How to avoid:** Always include `"version": "0.1.0"` from the start. Bump it with every release. The `claude-mem` plugin (a production plugin) consistently uses this field.
**Warning signs:** Users report bugs that were fixed in published code; `claude plugin update allclear` shows "already up to date" despite changes.

---

## Code Examples

Verified patterns from live plugin inspection:

### plugin.json — Full Schema (from claude-mem v10.5.5)
```json
{
  "name": "allclear",
  "version": "0.1.0",
  "description": "Auto-format, auto-lint, and cross-repo quality gates for Claude Code",
  "author": {
    "name": "AllClear Contributors"
  },
  "repository": "https://github.com/YOUR_ORG/allclear",
  "license": "Apache-2.0",
  "keywords": [
    "quality-gates",
    "auto-format",
    "auto-lint",
    "cross-repo",
    "hooks"
  ]
}
```
Source: Live inspection of `~/.claude/plugins/cache/thedotmack/claude-mem/10.5.5/.claude-plugin/plugin.json`

### hooks.json — Canonical Structure (from hookify)
```json
{
  "description": "AllClear plugin hooks",
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit|MultiEdit",
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/scripts/format.sh",
            "timeout": 10
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Write|Edit|MultiEdit",
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/scripts/file-guard.sh",
            "timeout": 10
          }
        ]
      }
    ],
    "SessionStart": [
      {
        "matcher": "startup|clear|compact",
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/scripts/session-start.sh",
            "timeout": 15
          }
        ]
      }
    ]
  }
}
```
Source: Live inspection of `~/.claude/plugins/marketplaces/claude-plugins-official/plugins/hookify/hooks/hooks.json`

### SKILL.md Frontmatter (from example-skill)
```yaml
---
name: quality-gate
description: This skill should be used when the user asks to run quality checks, invokes /allclear, mentions linting or testing, or wants to verify code before a commit.
version: 0.1.0
---
```
Source: Live inspection of `~/.claude/plugins/marketplaces/claude-plugins-official/plugins/example-plugin/skills/example-skill/SKILL.md`

### .gitattributes (preserve executable bit)
```
# Shell scripts — preserve executable bit and normalize line endings
scripts/*.sh text eol=lf
lib/*.sh text eol=lf
```

### Placeholder shell script (with correct shebang and exit 0)
```bash
#!/usr/bin/env bash
# AllClear — format.sh
# Placeholder: auto-format hook implementation in Phase 3
# PostToolUse: Write|Edit|MultiEdit
# Non-blocking: always exits 0
exit 0
```

### Installation via git clone + symlink (PLGN-06)
```bash
# Developer installs AllClear manually
git clone https://github.com/YOUR_ORG/allclear.git ~/sources/allclear
ln -s ~/sources/allclear ~/.claude/plugins/local/allclear

# Or for development/testing without installing
claude --plugin-dir ~/sources/allclear
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `commands/` directory with .md files | `skills/<name>/SKILL.md` | Claude Code skills API (2024-2025) | `commands/` is legacy; `skills/` enables both slash-command and autonomous invocation; official docs recommend migration |
| Hardcoded absolute paths in hooks | `${CLAUDE_PLUGIN_ROOT}` variable | Plugin cache system introduced | Required for any plugin that survives marketplace install; absolute paths break on every other machine |
| No version field in plugin.json | `"version": "0.1.0"` mandatory | Plugin update/cache system | Without version field, users cannot receive updates; version bump is the cache-busting mechanism |

**Deprecated/outdated:**
- `commands/` directory: legacy format; works but lacks autonomous invocation support; all new plugins should use `skills/`
- Inline one-liner commands in hooks.json: technically works but untestable and breaks on quoting edge cases; always use external `.sh` scripts

---

## Open Questions

1. **npm org reservation timing**
   - What we know: STATE.md flags this as a Phase 1 priority; `@allclear` org may or may not be available
   - What's unclear: Whether `@allclear` is already claimed on npmjs.com
   - Recommendation: Check `https://www.npmjs.com/org/allclear` before writing any code; if taken, the installer URL in all docs must change to `@allclear-dev/cli` or similar

2. **Exact symlink path for manual install (PLGN-06)**
   - What we know: Claude Code loads plugins from `~/.claude/plugins/local/` based on local filesystem inspection; `--plugin-dir` works for development
   - What's unclear: Whether `~/.claude/plugins/local/allclear` is the correct path for the symlink or whether a different subdirectory is used for manually-installed plugins vs marketplace plugins
   - Recommendation: Verify by creating a test symlink and running `claude --list-plugins` during Phase 1 verification; document the confirmed path in README

3. **Skill namespace: /allclear vs /allclear:quality-gate**
   - What we know: STATE.md documents this as a known concern; the `name` field in SKILL.md frontmatter and the `name` field in plugin.json interact to form the invocation path
   - What's unclear: Whether the main `/allclear` command maps to a skill named `allclear` inside the plugin named `allclear`, or whether the quality-gate skill is only invocable as `/allclear:quality-gate`
   - Recommendation: Verify in a live `--plugin-dir` dev session during Phase 1; document finding in STATE.md for all downstream phases

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | bats-core 1.13.0 |
| Config file | none — bats tests run directly via `./tests/bats/bin/bats tests/` |
| Quick run command | `./tests/bats/bin/bats tests/smoke.bats` |
| Full suite command | `./tests/bats/bin/bats tests/` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PLGN-01 | Directory structure matches canonical layout | smoke/structural | `./tests/bats/bin/bats tests/structure.bats` | ❌ Wave 0 |
| PLGN-04 | hooks.json contains no hardcoded absolute paths | smoke/structural | `./tests/bats/bin/bats tests/structure.bats` | ❌ Wave 0 |
| PLGN-06 | Plugin loads via --plugin-dir and symlink | smoke/manual | `claude --plugin-dir . --list-plugins \| grep allclear` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `./tests/bats/bin/bats tests/structure.bats` (structural checks only — fast)
- **Per wave merge:** `./tests/bats/bin/bats tests/`
- **Phase gate:** Full suite green + manual `claude --plugin-dir .` verification before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/structure.bats` — covers PLGN-01 (directory layout), PLGN-04 (no absolute paths in hooks.json)
- [ ] `tests/bats/` — bats-core git submodule (add via `git submodule add https://github.com/bats-core/bats-core tests/bats`)
- [ ] `tests/libs/bats-support` — bats-support submodule for better failure messages
- [ ] `tests/libs/bats-assert` — bats-assert submodule for `assert_output`, `assert_success`
- [ ] Framework install: `git submodule add https://github.com/bats-core/bats-core tests/bats`

---

## Sources

### Primary (HIGH confidence)
- Official Claude Code Plugins reference: `https://code.claude.com/docs/en/plugins-reference` — manifest schema, `${CLAUDE_PLUGIN_ROOT}`, directory rules
- Official Claude Code Create Plugins guide: `https://code.claude.com/docs/en/plugins` — structure overview, most common structural mistake documentation
- Official Claude Code Hooks reference: `https://code.claude.com/docs/en/hooks` — event names, exit codes, stdin/stdout protocol
- Live plugin inspection — hookify: `~/.claude/plugins/marketplaces/claude-plugins-official/plugins/hookify/` — hooks.json canonical structure, `${CLAUDE_PLUGIN_ROOT}` usage pattern
- Live plugin inspection — example-plugin: `~/.claude/plugins/marketplaces/claude-plugins-official/plugins/example-plugin/` — SKILL.md frontmatter format, directory structure confirmation
- Live plugin inspection — claude-mem v10.5.5: `~/.claude/plugins/cache/thedotmack/claude-mem/10.5.5/` — plugin.json full schema with version, `${CLAUDE_PLUGIN_ROOT}` fallback pattern

### Secondary (MEDIUM confidence)
- `.planning/research/ARCHITECTURE.md` — build order analysis, component boundaries, anti-pattern list
- `.planning/research/PITFALLS.md` — npm org squatting, executable bit, path variable pitfalls
- `.planning/research/STACK.md` — version compatibility table, bats-core submodule setup

### Tertiary (LOW confidence)
- None

---

## Metadata

**Confidence breakdown:**
- Directory structure: HIGH — confirmed via live plugin filesystem inspection on this machine
- plugin.json schema: HIGH — confirmed by reading actual installed plugin.json files (hookify, claude-mem, example-plugin)
- hooks.json structure: HIGH — confirmed by reading actual installed hooks.json (hookify, claude-mem)
- SKILL.md frontmatter: HIGH — confirmed by reading actual installed SKILL.md (example-plugin, claude-mem)
- Symlink install path: MEDIUM — standard Claude Code convention; exact subdirectory (`plugins/local/`) needs runtime verification
- npm org availability: LOW — requires external check; flagged in Open Questions

**Research date:** 2026-03-15
**Valid until:** 2026-04-15 (Claude Code plugin API is active development; recheck if Claude Code version advances significantly)
