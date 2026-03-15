# Phase 8: Config Layer - Research

**Researched:** 2026-03-15
**Domain:** Bash config file parsing, environment variable toggles, shell library design
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| CONF-01 | Plugin supports allclear.config.json for overriding sibling repo paths | jq JSON parsing pattern; lib/config.sh loader; consumed by lib/siblings.sh |
| CONF-02 | Plugin supports environment variables for hook toggles (ALLCLEAR_DISABLE_FORMAT, ALLCLEAR_DISABLE_LINT, ALLCLEAR_DISABLE_GUARD) | Env var check pattern in bash; each hook checks var at top before doing any work |
| CONF-03 | Plugin supports ALLCLEAR_LINT_THROTTLE for configuring clippy throttle interval | Numeric env var with default (30); consumed by scripts/lint.sh throttle logic |
| CONF-04 | Plugin supports ALLCLEAR_EXTRA_BLOCKED for additional blocked file patterns in guard hook | Colon- or space-delimited string; consumed by scripts/file-guard.sh pattern loop |
</phase_requirements>

---

## Summary

Phase 8 delivers the configuration layer for AllClear: a `allclear.config.json` project-level override file plus four environment variable knobs. This layer is purely about reading configuration into bash scripts — no new hook or skill logic, just a shared `lib/config.sh` library that loads values and exposes them to the other scripts that already exist (or will exist after their respective phases).

The central design decision is format: `allclear.config.json` uses JSON because the rest of the project already uses `jq` for all JSON work (PLGN-07), and JSON is trivially parseable with `jq` without requiring `yq` or any additional dependency. Environment variables are the lightest possible toggle mechanism — no parsing, no file I/O, just `[[ -n "$VAR" ]]` checks at the top of each hook script.

The file is optional by spec. Absence means auto-detect only. This means every consumer must treat the config as a fallback, never a requirement.

**Primary recommendation:** Implement `lib/config.sh` as a sourceable bash library that reads `allclear.config.json` (if present) using `jq` and exports normalized variables. Each hook/script sources this library once at startup and reads from those variables. Environment variables are checked inline at each consumer; they do not need a config loader — they are already environment.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| jq | 1.6+ | JSON parsing in bash | Already required (PLGN-07); zero new dependency; handles nested arrays cleanly |
| bash | 3.2+ (macOS ships 3.2) | Shell library | All other AllClear scripts are bash; source-able libraries are idiomatic bash |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| realpath | coreutils (macOS: greadlink -f fallback) | Normalize config file path | When resolving config location relative to project root |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| JSON (allclear.config.json) | YAML (.allclear.yaml) | YAML requires `yq` (extra dependency); JSON parsed by already-required `jq` |
| JSON | TOML | TOML has no standard bash parser; would need Python or toml2json shim |
| JSON | markdown frontmatter (.claude/allclear.local.md) | Official plugin-settings pattern uses this for per-user state, not project config; JSON is more familiar for project-level files (similar to .eslintrc.json, tsconfig.json) |
| Single config file | Environment variables only | Config file persists across sessions and can be committed; env vars are ephemeral |

**Installation:**

No additional installation. `jq` is already required by the project.

---

## Architecture Patterns

### Where allclear.config.json Lives

The file lives at the **project root** (where the developer runs Claude Code). It is NOT inside the plugin — it is the project's opt-in configuration. Think of it like `.eslintrc.json` or `pyproject.toml`: it belongs to the repo being worked on, not the tool.

```
<project root>/
├── allclear.config.json    # Optional — read by AllClear at runtime
├── src/
└── ...
```

Inside the AllClear plugin repo itself, `allclear.config.json.example` serves as documentation of the schema.

### Recommended Config Schema (allclear.config.json)

```json
{
  "siblings": [
    "../api",
    "../ui",
    "../sdk"
  ]
}
```

Minimal — only what CONF-01 requires. Future phases may extend this (e.g., per-language formatter overrides), but Phase 8 covers only the sibling path override.

### lib/config.sh — Sourceable Library

```
lib/
├── detect.sh       # Already planned (Phase 2)
├── siblings.sh     # Already planned (Phase 2)
└── config.sh       # NEW in Phase 8 — loads allclear.config.json
```

`lib/config.sh` is sourced by `lib/siblings.sh` (for CONF-01) and does NOT need to be sourced by hook scripts directly for env var toggles (those are checked inline). However, having a single source function in `lib/config.sh` that all consumers can optionally call for future config fields keeps the library extensible.

### Pattern 1: Reading JSON Config with jq

**What:** Source `lib/config.sh` which reads `allclear.config.json` from the current working directory if present, and exports parsed values as bash variables.

**When to use:** Any script that needs config values. Source once at the top.

**Example:**

```bash
# lib/config.sh
# Sourceable library: loads allclear.config.json if present.
# Safe to source multiple times (uses guard variable).

if [[ -n "${_ALLCLEAR_CONFIG_LOADED:-}" ]]; then
  return 0
fi
_ALLCLEAR_CONFIG_LOADED=1

ALLCLEAR_CONFIG_FILE="${ALLCLEAR_CONFIG_FILE:-allclear.config.json}"

# CONF-01: sibling repo path overrides
ALLCLEAR_CONFIG_SIBLINGS=()
if [[ -f "$ALLCLEAR_CONFIG_FILE" ]]; then
  # Read siblings array from JSON; empty string if key absent
  mapfile -t ALLCLEAR_CONFIG_SIBLINGS < <(
    jq -r '.siblings[]? // empty' "$ALLCLEAR_CONFIG_FILE" 2>/dev/null
  )
fi
export ALLCLEAR_CONFIG_SIBLINGS
```

### Pattern 2: Environment Variable Toggle in Hook Script

**What:** At the very top of each hook script, check the relevant disable variable before doing any work. Exit 0 immediately if the toggle is set.

**When to use:** Every PostToolUse hook (format, lint). The guard hook (PreToolUse) uses a slightly different pattern — if disabled, it allows rather than blocks.

**Example (CONF-02):**

```bash
# scripts/format.sh
#!/usr/bin/env bash

# CONF-02: Honour ALLCLEAR_DISABLE_FORMAT env var
if [[ -n "${ALLCLEAR_DISABLE_FORMAT:-}" ]]; then
  exit 0
fi

INPUT=$(cat)
# ... rest of format logic
```

```bash
# scripts/lint.sh
if [[ -n "${ALLCLEAR_DISABLE_LINT:-}" ]]; then
  exit 0
fi
```

```bash
# scripts/file-guard.sh
if [[ -n "${ALLCLEAR_DISABLE_GUARD:-}" ]]; then
  exit 0  # disabled = allow everything through
fi
```

### Pattern 3: Numeric Env Var with Default (CONF-03)

**What:** Read `ALLCLEAR_LINT_THROTTLE` with a default of 30. Validate it is a positive integer.

**When to use:** In `scripts/lint.sh` throttle logic for `cargo clippy`.

**Example:**

```bash
# CONF-03: Clippy throttle interval (default 30 seconds)
LINT_THROTTLE="${ALLCLEAR_LINT_THROTTLE:-30}"
if ! [[ "$LINT_THROTTLE" =~ ^[0-9]+$ ]]; then
  LINT_THROTTLE=30  # Invalid value — fall back to default
fi
```

### Pattern 4: Extra Blocked Patterns (CONF-04)

**What:** `ALLCLEAR_EXTRA_BLOCKED` holds additional glob patterns to check in `scripts/file-guard.sh`. Patterns are colon-separated (consistent with `PATH` convention) or space-separated.

**When to use:** In `scripts/file-guard.sh`, after the built-in deny list check.

**Example:**

```bash
# CONF-04: Extra blocked patterns
if [[ -n "${ALLCLEAR_EXTRA_BLOCKED:-}" ]]; then
  # Split colon-delimited string into array
  IFS=':' read -ra EXTRA_PATTERNS <<< "$ALLCLEAR_EXTRA_BLOCKED"
  BASENAME=$(basename "$FILE")
  for pat in "${EXTRA_PATTERNS[@]}"; do
    if [[ "$BASENAME" == $pat ]]; then
      printf '{"hookSpecificOutput": {"permissionDecision": "deny"}, "reason": "AllClear: blocked write to extra-blocked pattern: %s"}' "$FILE" >&2
      exit 2
    fi
  done
fi
```

### Anti-Patterns to Avoid

- **Hardcoding config path:** Never use an absolute path. Config is always relative to cwd (`allclear.config.json`), not relative to `$CLAUDE_PLUGIN_ROOT`.
- **Failing if jq not installed:** jq is required (PLGN-07). But if `allclear.config.json` is absent, skip the jq call entirely to avoid noise.
- **Blocking on invalid config:** If `allclear.config.json` exists but is malformed JSON, log a warning to stderr and continue with defaults. Never block Claude's flow due to a config parse error.
- **yq dependency:** Do not introduce `yq`. JSON + `jq` is already the project standard.
- **sed/grep for JSON:** Do not use `grep`/`sed` to parse JSON fields. Use `jq` exclusively (PLGN-07 pattern).
- **Sourcing lib/config.sh in every hook:** Only source it where config values are needed. For env var toggles, no sourcing needed — env vars are direct.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JSON parsing | custom grep/sed field extraction | `jq -r '.field // empty'` | jq handles nested keys, missing keys, type coercion, and quoting correctly; grep/sed breaks on whitespace variations |
| Type validation for numeric env var | complex awk/sed | `[[ "$VAR" =~ ^[0-9]+$ ]]` | bash regex is sufficient for positive integer validation |
| Config file search (parent walk) | recursive parent search | single `allclear.config.json` at cwd | Phase 8 scope is project root only; walking parents adds complexity with no clear requirement |

**Key insight:** The config layer is thin by design. Its job is to expose values, not to implement logic. Logic lives in the consumers (siblings.sh, lint.sh, file-guard.sh, format.sh).

---

## Common Pitfalls

### Pitfall 1: Config Loaded Before cwd Is Set Correctly

**What goes wrong:** If a hook script is invoked and sources `lib/config.sh` before `cd`-ing to the project root, `allclear.config.json` will not be found even if it exists.

**Why it happens:** Hook scripts inherit cwd from Claude Code, which should be the project root. But if a script changes directory before sourcing config, the relative path breaks.

**How to avoid:** Source `lib/config.sh` at the very beginning of each script, before any `cd` calls. Or use `$(git rev-parse --show-toplevel)/allclear.config.json` as the lookup path.

**Warning signs:** Config is silently ignored even though the file exists; ALLCLEAR_CONFIG_SIBLINGS array is always empty.

### Pitfall 2: ALLCLEAR_EXTRA_BLOCKED With Spaces in Patterns

**What goes wrong:** A pattern like `my file.txt` in the colon-separated list will be split at the colon boundary but retain the space, which is fine for `case`/`==` matching but may confuse glob patterns with `[[ == $pat ]]`.

**Why it happens:** Shell glob matching with `[[ string == pattern ]]` treats spaces literally but asterisks as wildcards. The issue only arises if the user includes patterns with spaces in their colon-separated list.

**How to avoid:** Document that patterns use bash glob syntax. Spaces in pattern names must be quoted when setting the env var. This is a rare edge case; no complex handling needed.

**Warning signs:** Guard hook not blocking a file it should because the pattern has leading/trailing whitespace from the split.

### Pitfall 3: jq mapfile on macOS bash 3.2

**What goes wrong:** `mapfile -t` (also known as `readarray`) is not available in bash 3.2 (macOS default). It requires bash 4.0+.

**Why it happens:** macOS ships bash 3.2 (GPL v2). Homebrew installs bash 5.x separately but it's not the default shell.

**How to avoid:** Use a `while read` loop instead of `mapfile` for the siblings array:

```bash
# Safe for bash 3.2
ALLCLEAR_CONFIG_SIBLINGS=()
while IFS= read -r path; do
  ALLCLEAR_CONFIG_SIBLINGS+=("$path")
done < <(jq -r '.siblings[]? // empty' "$ALLCLEAR_CONFIG_FILE" 2>/dev/null)
```

Or use the shebang `#!/usr/bin/env bash` and document that bash 4+ is required. Since hooks use `set -euo pipefail` which also requires 4+, this is likely already the case — but verify.

**Warning signs:** `mapfile: command not found` error on macOS during testing.

### Pitfall 4: ALLCLEAR_DISABLE_GUARD Env Var Must Allow, Not Block

**What goes wrong:** If someone naively adds `exit 0` to the guard hook when disabled, that is actually the correct behavior (allow). But if they make it exit 2, the guard would block everything.

**Why it happens:** Confusion between "disable guard = exit 0 (allow)" vs. "disable guard = exit 2 (block)". The guard's disabled state is the permissive state.

**How to avoid:** Add a comment in the code: `# ALLCLEAR_DISABLE_GUARD: exit 0 = allow all writes (guard disabled)`.

### Pitfall 5: Sourcing config.sh from within lib/siblings.sh Creates Circular Source Risk

**What goes wrong:** If `lib/siblings.sh` sources `lib/config.sh`, and some future code causes `lib/config.sh` to source `lib/siblings.sh`, you get a circular source. Bash will not infinite-loop (due to the guard variable pattern) but the code becomes hard to reason about.

**How to avoid:** Keep `lib/config.sh` as a leaf node — it sources nothing. `lib/siblings.sh` sources `lib/config.sh`. The source graph must be a DAG.

---

## Code Examples

Verified patterns from official sources:

### allclear.config.json (example file to ship with plugin)

```json
{
  "siblings": [
    "../api",
    "../ui",
    "../sdk"
  ]
}
```

```bash
# Source: PLGN-07 jq pattern from REQUIREMENTS.md + ARCHITECTURE.md
# Reading a JSON array safely with jq:
SIBLINGS=()
while IFS= read -r path; do
  [[ -n "$path" ]] && SIBLINGS+=("$path")
done < <(printf '%s\n' "$CONFIG_JSON" | jq -r '.siblings[]? // empty' 2>/dev/null)
```

### Environment Variable Toggle Pattern

```bash
# Source: ARCHITECTURE.md Pattern 1 (hook stdin + exit 0 non-blocking)
# Applied to env var toggles per CONF-02

if [[ -n "${ALLCLEAR_DISABLE_FORMAT:-}" ]]; then
  exit 0  # Hook disabled via env var
fi
```

### Numeric Env Var with Default and Validation

```bash
# Source: REQUIREMENTS.md CONF-03 + bash arithmetic idiom
THROTTLE="${ALLCLEAR_LINT_THROTTLE:-30}"
[[ "$THROTTLE" =~ ^[0-9]+$ ]] || THROTTLE=30
```

### Extra Blocked Patterns from Env Var

```bash
# Source: REQUIREMENTS.md CONF-04
# Colon-delimited, consistent with PATH convention
if [[ -n "${ALLCLEAR_EXTRA_BLOCKED:-}" ]]; then
  IFS=':' read -ra _EXTRA_PATTERNS <<< "$ALLCLEAR_EXTRA_BLOCKED"
  for _pat in "${_EXTRA_PATTERNS[@]}"; do
    if [[ "$(basename "$FILE")" == $_pat ]]; then
      exit 2
    fi
  done
fi
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| YAML config files (requires yq) | JSON config (requires jq, already present) | N/A for this project | No new dependencies |
| ini-style config parsing | jq for JSON | Standard in modern bash projects | Clean, correct handling of nested keys and arrays |

**Deprecated/outdated:**

- sed/grep for JSON parsing: Replaced by jq in any project that already uses jq. Never use sed to extract JSON fields.

---

## Open Questions

1. **bash version requirement for project**
   - What we know: macOS ships bash 3.2; `mapfile` requires bash 4+; `set -euo pipefail` works on 3.2
   - What's unclear: Whether AllClear will formally require bash 4+ (homebrew) or must work on the system bash
   - Recommendation: Use `while IFS= read -r` loop instead of `mapfile` to stay safe on 3.2. If bash 4+ is ever required, document it in README.

2. **Config file location: project root vs. .claude/ subdirectory**
   - What we know: ARCHITECTURE.md says "allclear.config.json (project)" at root; this matches common tool conventions (eslintrc, tsconfig)
   - What's unclear: Whether placing it in `.claude/allclear.config.json` would reduce root directory clutter
   - Recommendation: Use project root per ARCHITECTURE.md. It is more discoverable and consistent with how other tool configs work.

3. **Whether CONF-01 (siblings override) should support both absolute and relative paths**
   - What we know: Auto-detection uses `../reponame` (relative to parent dir)
   - What's unclear: Whether a user might need absolute paths (e.g., `/opt/repos/api`)
   - Recommendation: Support both. If path starts with `/`, use as-is. Otherwise, resolve relative to cwd. `jq` returns the string; bash resolves it.

---

## Validation Architecture

nyquist_validation is enabled. Test infrastructure: bats is the project standard (TEST-01 through TEST-08). bats-core is not currently installed on this machine but is the planned framework. Wave 0 must install it.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | bats-core (Bash Automated Testing System) |
| Config file | none required — tests run as `bats tests/` |
| Quick run command | `bats tests/config.bats` |
| Full suite command | `bats tests/` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CONF-01 | lib/config.sh exports ALLCLEAR_CONFIG_SIBLINGS from allclear.config.json | unit | `bats tests/config.bats` | Wave 0 |
| CONF-01 | lib/config.sh returns empty array when allclear.config.json absent | unit | `bats tests/config.bats` | Wave 0 |
| CONF-01 | lib/siblings.sh uses ALLCLEAR_CONFIG_SIBLINGS when set | unit | `bats tests/config.bats` | Wave 0 |
| CONF-02 | ALLCLEAR_DISABLE_FORMAT causes format hook to exit 0 without formatting | unit | `bats tests/config.bats` | Wave 0 |
| CONF-02 | ALLCLEAR_DISABLE_LINT causes lint hook to exit 0 without linting | unit | `bats tests/config.bats` | Wave 0 |
| CONF-02 | ALLCLEAR_DISABLE_GUARD causes guard hook to exit 0 (allow) for blocked files | unit | `bats tests/config.bats` | Wave 0 |
| CONF-03 | ALLCLEAR_LINT_THROTTLE overrides default 30s throttle interval | unit | `bats tests/config.bats` | Wave 0 |
| CONF-03 | Invalid ALLCLEAR_LINT_THROTTLE falls back to 30s default | unit | `bats tests/config.bats` | Wave 0 |
| CONF-04 | ALLCLEAR_EXTRA_BLOCKED causes guard to block matching extra patterns | unit | `bats tests/config.bats` | Wave 0 |
| CONF-04 | Multiple colon-separated patterns in ALLCLEAR_EXTRA_BLOCKED all checked | unit | `bats tests/config.bats` | Wave 0 |

### Sampling Rate

- **Per task commit:** `bats tests/config.bats`
- **Per wave merge:** `bats tests/`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `tests/config.bats` — covers CONF-01 through CONF-04
- [ ] Framework install: `brew install bats-core` — bats-core not currently installed

---

## Sources

### Primary (HIGH confidence)

- ARCHITECTURE.md (project) — lib/config.sh role, allclear.config.json placement, jq pattern mandate (PLGN-07), `${CLAUDE_PLUGIN_ROOT}` path conventions
- REQUIREMENTS.md (project) — CONF-01, CONF-02, CONF-03, CONF-04 exact spec text
- `/Users/ravichillerega/.claude/plugins/marketplaces/claude-plugins-official/plugins/plugin-dev/skills/plugin-settings/references/parsing-techniques.md` — official bash config parsing patterns (sed/jq, frontmatter extraction, defaults, edge cases)
- `/Users/ravichillerega/.claude/plugins/marketplaces/claude-plugins-official/plugins/plugin-dev/skills/plugin-settings/references/real-world-examples.md` — multi-agent-swarm and ralph-loop production patterns

### Secondary (MEDIUM confidence)

- jq manual (https://jqlang.github.io/jq/manual/) — `.siblings[]? // empty` null-safe array iteration pattern; verified against known jq behavior

### Tertiary (LOW confidence)

- bash 3.2 mapfile limitation — from training knowledge; should be verified with `bash --version` on target systems before choosing `mapfile` vs `while read`

---

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — jq is already mandated by PLGN-07; no new dependencies introduced
- Architecture: HIGH — lib/config.sh as leaf library matches existing lib/ pattern from ARCHITECTURE.md; env var patterns are standard bash
- Pitfalls: HIGH — bash 3.2 mapfile issue is a well-known macOS gotcha; circular source risk is a real structural concern
- Test mapping: HIGH — requirement IDs are concrete and map cleanly to testable behaviors

**Research date:** 2026-03-15
**Valid until:** 2026-09-15 (stable domain — bash config patterns don't change)
