# Phase 3: Format Hook - Research

**Researched:** 2026-03-15
**Domain:** Claude Code PostToolUse hook — multi-language auto-formatter (Python/Rust/TS/Go/JSON/YAML)
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| FMTH-01 | Auto-format hook fires on PostToolUse for Edit and Write tool events | Confirmed: `matcher: "Write\|Edit\|MultiEdit"` triggers on all file-modification tools |
| FMTH-02 | Hook formats Python files with ruff format (fallback: black) | Confirmed: `ruff format <file>` exits 0 always on success; `command -v` guard enables black fallback |
| FMTH-03 | Hook formats Rust files with rustfmt | Confirmed: `rustfmt <file>` exits 0 on success, 1 on unexpected error, 2 on syntax error, 3 on unresolvable issue — all must be swallowed |
| FMTH-04 | Hook formats TypeScript/JavaScript files with prettier (fallback: eslint --fix) | Confirmed: `prettier --write <file>` exits 0 always on successful write; fallback to `eslint --fix` when prettier absent |
| FMTH-05 | Hook formats Go files with gofmt | Confirmed: `gofmt -w <file>` always exits 0; -w writes in-place |
| FMTH-06 | Hook formats JSON/YAML files with prettier | Confirmed: prettier handles JSON and YAML by extension detection, same `--write` pattern |
| FMTH-07 | Hook is silent on success (no output cluttering conversation) | Confirmed: exit 0 with no stdout = silent; stderr is discarded by Claude Code |
| FMTH-08 | Hook skips formatting if formatter is not installed (no nag) | Confirmed: `command -v <tool> &>/dev/null` guard; silent skip on absence |
| FMTH-09 | Hook skips files in virtual envs, node_modules, and generated directories | Confirmed: path substring match against `/node_modules/`, `/.venv/`, `/target/`, `/.git/`; use case-sensitive pattern matching on file path |
| FMTH-10 | Hook never blocks edits on formatter failure — exits 0 always | Confirmed: all formatter invocations wrapped with `|| true`; final `exit 0` always; PostToolUse exit 2 is non-blocking error display only |
</phase_requirements>

---

## Summary

Phase 3 implements `scripts/format.sh` — a PostToolUse hook script that fires after every Write/Edit/MultiEdit tool call in Claude Code, extracts the `tool_input.file_path` from stdin JSON, detects the file language from its extension, and runs the appropriate formatter in-place. The script is non-blocking by design: it always exits 0, routes formatter output to stderr, and produces no stdout on success (silent mode).

The hook depends on the shared `lib/detect.sh` library (built in Phase 2) for language detection, and on `hooks/hooks.json` (built in Phase 1) for event wiring. All formatter tools are optional: the hook checks for each formatter with `command -v` before invoking it, and silently skips if absent. Directories like `node_modules`, `.venv`, and `target` are filtered by path pattern before any formatter runs.

The primary implementation challenge is correctness of the path-exclusion logic (substring matching absolute paths) and ensuring that formatter exit codes never propagate — rustfmt in particular exits with codes 1/2/3 on syntax errors, which must all be captured and silenced.

**Primary recommendation:** Implement `scripts/format.sh` as a single bash script with a per-extension dispatch table, `|| true` after every formatter call, and a final `exit 0` hard-coded at the bottom. Use `lib/detect.sh` for language classification. Route all formatter output (stdout + stderr) to `/dev/null` on success.

---

## Standard Stack

### Core Formatters

| Tool | Version | Languages | Install Check | In-Place Command |
|------|---------|-----------|--------------|-----------------|
| `ruff` | 0.x (astral-sh) | Python (.py) | `command -v ruff` | `ruff format "$FILE"` |
| `black` | 26.3.0+ | Python (.py) — fallback | `command -v black` | `black "$FILE"` |
| `rustfmt` | (ships with rustup) | Rust (.rs) | `command -v rustfmt` | `rustfmt "$FILE"` |
| `prettier` | 3.x | TS/JS (.ts/.tsx/.js/.jsx), JSON (.json), YAML (.yaml/.yml) | `command -v prettier` or `npx prettier` | `prettier --write "$FILE"` |
| `eslint` | 9.x (flat config) | TS/JS (.ts/.tsx/.js/.jsx) — fallback | `command -v eslint` | `eslint --fix "$FILE"` |
| `gofmt` | (ships with Go toolchain) | Go (.go) | `command -v gofmt` | `gofmt -w "$FILE"` |

### Hook Runtime Dependencies

| Tool | Version | Purpose | Availability |
|------|---------|---------|-------------|
| `bash` | 4.0+ | Hook script interpreter | Universal on macOS/Linux |
| `jq` | 1.6+ | Parse stdin JSON to extract `tool_input.file_path` | Documented as project standard (PLGN-07) |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `ruff format` | `autopep8`, `yapf` | ruff is faster and covers more style; REQUIREMENTS.md specifies ruff |
| `prettier` for JSON/YAML | `jq .` for JSON, `yamllint` for YAML | prettier handles both in one tool with consistent config; requirement specifies prettier |
| `gofmt` | `goimports`, `gofumpt` | gofmt ships with Go and requires no installation; simplest reliable option |
| Per-file language detection | `lib/detect.sh` project-type detection | Extension-based dispatch is faster and more reliable for single-file formatting than project-type detection |

**Installation (developer tooling check):**
```bash
# The hook itself has no install step — it invokes tools already on PATH.
# Verify formatter availability in dev environment:
command -v ruff || echo "ruff not installed (pip install ruff)"
command -v rustfmt || echo "rustfmt not installed (rustup component add rustfmt)"
command -v prettier || echo "prettier not installed (npm i -g prettier)"
command -v gofmt || echo "gofmt not installed (install Go toolchain)"
```

---

## Architecture Patterns

### Recommended File Structure for This Phase

```
allclear/
├── hooks/
│   └── hooks.json          # Add PostToolUse entry pointing to format.sh
├── scripts/
│   └── format.sh           # PRIMARY DELIVERABLE — auto-format hook
└── lib/
    └── detect.sh           # Dependency from Phase 2 — sourced for language detection
```

### Pattern 1: Read-once stdin then dispatch

**What:** The hook reads all of stdin once into a variable at the top of the script, then extracts `tool_input.file_path` with jq. All subsequent logic uses the extracted value — never re-reads stdin (it's a one-time stream).

**When to use:** Every hook script. Stdin can only be read once; storing it in a variable is mandatory for multiple field extractions.

**Example:**
```bash
#!/usr/bin/env bash
# Source: hooks reference — code.claude.com/docs/en/hooks
INPUT=$(cat)
FILE=$(printf '%s\n' "$INPUT" | jq -r '.tool_input.file_path // empty')

if [[ -z "$FILE" || ! -f "$FILE" ]]; then
  exit 0
fi
```

### Pattern 2: Per-extension formatter dispatch

**What:** Match the file extension to select which formatter to run. Use a case statement for clean dispatch. Each branch checks if the formatter is installed before running.

**When to use:** Single hook script covering multiple languages.

**Example:**
```bash
EXT="${FILE##*.}"

case "$EXT" in
  py)
    if command -v ruff &>/dev/null; then
      ruff format "$FILE" >/dev/null 2>&1 || true
    elif command -v black &>/dev/null; then
      black "$FILE" >/dev/null 2>&1 || true
    fi
    ;;
  rs)
    if command -v rustfmt &>/dev/null; then
      rustfmt "$FILE" >/dev/null 2>&1 || true
    fi
    ;;
  ts|tsx|js|jsx)
    if command -v prettier &>/dev/null; then
      prettier --write "$FILE" >/dev/null 2>&1 || true
    elif command -v eslint &>/dev/null; then
      eslint --fix "$FILE" >/dev/null 2>&1 || true
    fi
    ;;
  go)
    if command -v gofmt &>/dev/null; then
      gofmt -w "$FILE" >/dev/null 2>&1 || true
    fi
    ;;
  json|yaml|yml)
    if command -v prettier &>/dev/null; then
      prettier --write "$FILE" >/dev/null 2>&1 || true
    fi
    ;;
esac
```

### Pattern 3: Path exclusion before formatting

**What:** Check the absolute file path for known generated/dependency directory segments before running any formatter. Use `[[ "$FILE" == *"/node_modules/"* ]]` substring match — simple, fast, zero external deps.

**When to use:** Before every formatter dispatch. Must run before the case statement.

**Example:**
```bash
# Skip generated and dependency directories (FMTH-09)
for SKIP_PAT in "/node_modules/" "/.venv/" "/venv/" "/target/" "/.git/" "/__pycache__/"; do
  if [[ "$FILE" == *"$SKIP_PAT"* ]]; then
    exit 0
  fi
done
```

### Pattern 4: Non-blocking exit guarantee

**What:** All formatter invocations use `|| true` to prevent any non-zero exit from propagating. The script always ends with `exit 0` as the final line, making it impossible to accidentally block.

**When to use:** Every PostToolUse format/lint hook. Non-negotiable per FMTH-10 and project constraint.

**Example:**
```bash
# Formatter invocation — non-blocking
ruff format "$FILE" >/dev/null 2>&1 || true

# Unconditional exit 0 — final line of every PostToolUse hook
exit 0
```

### Pattern 5: hooks.json PostToolUse entry

**What:** Wire the format hook to fire on Write, Edit, and MultiEdit tool calls. Use `${CLAUDE_PLUGIN_ROOT}` for the script path. The matcher is a regex matched against `tool_name`.

**When to use:** In `hooks/hooks.json`. MultiEdit must be included — it's the tool Claude uses for multi-location edits in a single file.

**Example:**
```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit|MultiEdit",
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/scripts/format.sh"
          }
        ]
      }
    ]
  }
}
```

### Anti-Patterns to Avoid

- **Redirect only stderr:** `ruff format "$FILE" 2>/dev/null` — does NOT silence stdout; use `>/dev/null 2>&1` to silence both channels
- **Check exit code without `|| true`:** `ruff format "$FILE" && echo ok` — if ruff exits non-zero, the `&&` chain stops; the `|| true` pattern is safer and simpler
- **Use `set -e` in PostToolUse hooks:** `set -euo pipefail` at the top of the script means any non-zero formatter exit propagates immediately, bypassing `|| true` guards on complex expressions; avoid `set -e` in format hooks or use `set +e` before formatter calls
- **Extract file path without `// empty`:** `jq -r '.tool_input.file_path'` returns the string `null` when the field is absent; `// empty` returns an empty string, which the `[[ -z "$FILE" ]]` guard correctly catches
- **Skip MultiEdit in matcher:** Claude uses MultiEdit for multi-location edits in one file; omitting it means those edits are never formatted

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Python formatting | Custom indent/style normalizer | `ruff format` or `black` | Handles 200+ edge cases: string quoting, trailing commas, blank line rules, magic trailing comma |
| Rust formatting | Custom whitespace normalizer | `rustfmt` | Handles macro expansion, lifetime annotations, complex generics — hand-rolling breaks idiomatic Rust style |
| Go formatting | Any custom formatter | `gofmt` | gofmt is THE standard; every Go developer expects gofmt output; deviating from it is a project smell |
| JSON pretty-printing | `jq .` or custom serializer | `prettier --write` for JSON | prettier preserves key order, handles edge cases like trailing commas in JSONC; consistent with TS/YAML formatting |
| YAML formatting | Custom YAML writer | `prettier --write` | YAML has notorious edge cases (Norway problem, special scalars, anchors); prettier handles them correctly |
| Installed-tool detection | Custom which/locate logic | `command -v <tool>` | POSIX-standard, handles PATH correctly, no subshell overhead, works in all bash versions |

**Key insight:** Every formatter in this phase is well-established tooling with years of edge-case handling. The hook's job is purely orchestration — detect file type, invoke the right tool, stay out of the way.

---

## Common Pitfalls

### Pitfall 1: `set -euo pipefail` breaks non-blocking guarantee

**What goes wrong:** The hook script starts with `set -euo pipefail` (common bash best practice). When a formatter exits non-zero (e.g., rustfmt exits 2 on syntax error), bash propagates the error immediately before reaching `exit 0`. The hook exits non-zero, producing a blocking error in Claude Code.

**Why it happens:** `set -e` applies to all subshell exits, including those inside `||` unless the pattern is `cmd || true` at the exact statement level. Complex expressions can still trigger `set -e` unexpectedly.

**How to avoid:** Do not use `set -e` in PostToolUse hooks. Use explicit error checking where needed, or add `set +e` before the formatter dispatch block.

**Warning signs:** Hook works when formatters succeed, but intermittently blocks Claude's edit cycle when editing files with syntax errors.

### Pitfall 2: rustfmt exits 1/2/3 on valid use cases

**What goes wrong:** rustfmt exits with 1 on configuration errors, 2 on syntax errors in the Rust file, and 3 on unresolvable formatting issues (very long lines, certain macro patterns). These are not hook failures — they are normal user scenarios (mid-edit syntax errors, macro-heavy files).

**Why it happens:** Unlike ruff (which exits 0 even on format changes), rustfmt signals problems with non-zero exit codes that look like tool failures.

**How to avoid:** Always use `rustfmt "$FILE" >/dev/null 2>&1 || true`. Never check rustfmt's exit code in format.sh.

**Warning signs:** Rust files intermittently trigger Claude Code non-blocking error messages during editing.

### Pitfall 3: prettier not found but `npx prettier` is available

**What goes wrong:** `command -v prettier` fails on systems where prettier is installed only locally in a node_modules (project-local, not global). The fallback to eslint --fix runs instead, producing different formatting results.

**Why it happens:** Many projects install prettier as a devDependency, not globally. In those projects, prettier must be invoked via `npx prettier` or `./node_modules/.bin/prettier`.

**How to avoid:** Check for prettier in order: global (`command -v prettier`) → local (`./node_modules/.bin/prettier`) → npx (`command -v npx && npx --yes prettier`). The research recommends checking local node_modules first as a secondary fallback before npx.

**Warning signs:** TypeScript files are formatted inconsistently across projects — some with prettier style, some with eslint style.

### Pitfall 4: Path exclusion misses nested virtual env paths

**What goes wrong:** The skip check uses `[[ "$FILE" == *"/.venv/"* ]]` but the user's virtual env is named `venv` (without leading dot), or is at a non-standard path like `env/` or `.virtualenv/`. Files inside the venv get formatted, causing an error if the formatter fails on generated Python files.

**Why it happens:** Python virtual env naming is not standardized. Common names: `.venv`, `venv`, `env`, `.env`, `virtualenv`.

**How to avoid:** Check for multiple venv patterns:
```bash
for SKIP_PAT in "/node_modules/" "/.venv/" "/venv/" "/env/" "/.env/" "/target/" "/.git/" "/__pycache__/" "/.tox/"; do
```
Note: `.env` at the project root is a file, not a directory — the trailing slash in the pattern avoids false positives.

**Warning signs:** Formatter errors on Python stdlib files or third-party packages inside the virtualenv.

### Pitfall 5: jq returns string "null" not empty string

**What goes wrong:** When `tool_input.file_path` is absent (e.g., for Bash tool PostToolUse events that happen to fire if matcher is too broad), `jq -r '.tool_input.file_path'` returns the literal four-character string `"null"`, not an empty string. The `[[ -z "$FILE" ]]` guard passes `"null"` as a valid path to formatters, causing errors.

**Why it happens:** jq prints `null` as the string `"null"` with `-r` (raw output) when the value is JSON null. This is correct jq behavior but surprising.

**How to avoid:** Always use the jq null-coalescing operator: `jq -r '.tool_input.file_path // empty'`. The `// empty` causes jq to emit nothing (empty string) when the field is null or absent.

**Warning signs:** Formatters report "file not found: null" errors in stderr when hooks fire on non-file tool calls.

### Pitfall 6: Silent success requires silencing BOTH stdout and stderr

**What goes wrong:** The hook redirects only stderr (`ruff format "$FILE" 2>/dev/null`) but ruff's stdout (progress messages, file names) leaks to the hook's stdout. Claude Code treats any non-JSON content on hook stdout as an error or unexpected output.

**Why it happens:** Formatters typically write status messages to stdout (`reformatted file.py`, `All done!`). Only silencing stderr leaves stdout polluted.

**How to avoid:** Redirect both: `ruff format "$FILE" >/dev/null 2>&1 || true`. On success, the hook produces no stdout. On failure, errors are silently discarded.

**Warning signs:** Claude Code shows unexpected messages after edits; hook stdout contains formatter progress text.

---

## Code Examples

Verified patterns from official sources and formatter documentation:

### Complete format.sh skeleton
```bash
#!/usr/bin/env bash
# AllClear: Auto-format hook
# Event: PostToolUse (Write|Edit|MultiEdit)
# Source: hooks reference — code.claude.com/docs/en/hooks
# Non-blocking: always exits 0 (FMTH-10)

# Read stdin once (it's a stream — can only be read once)
INPUT=$(cat)

# Extract file path using null-coalescing // empty to avoid literal "null"
FILE=$(printf '%s\n' "$INPUT" | jq -r '.tool_input.file_path // empty')

# Skip if no file or file doesn't exist (e.g., Bash tool PostToolUse)
[[ -z "$FILE" || ! -f "$FILE" ]] && exit 0

# Skip generated/dependency directories (FMTH-09)
for SKIP_PAT in "/node_modules/" "/.venv/" "/venv/" "/env/" "/target/" "/.git/" "/__pycache__/"; do
  [[ "$FILE" == *"$SKIP_PAT"* ]] && exit 0
done

# Dispatch by file extension
EXT="${FILE##*.}"

case "$EXT" in
  py)
    if command -v ruff &>/dev/null; then
      ruff format "$FILE" >/dev/null 2>&1 || true
    elif command -v black &>/dev/null; then
      black "$FILE" >/dev/null 2>&1 || true
    fi
    ;;
  rs)
    if command -v rustfmt &>/dev/null; then
      rustfmt "$FILE" >/dev/null 2>&1 || true
    fi
    ;;
  ts|tsx|js|jsx|mjs|cjs)
    if command -v prettier &>/dev/null; then
      prettier --write "$FILE" >/dev/null 2>&1 || true
    elif [[ -x "./node_modules/.bin/prettier" ]]; then
      ./node_modules/.bin/prettier --write "$FILE" >/dev/null 2>&1 || true
    elif command -v eslint &>/dev/null; then
      eslint --fix "$FILE" >/dev/null 2>&1 || true
    fi
    ;;
  go)
    if command -v gofmt &>/dev/null; then
      gofmt -w "$FILE" >/dev/null 2>&1 || true
    fi
    ;;
  json|yaml|yml)
    if command -v prettier &>/dev/null; then
      prettier --write "$FILE" >/dev/null 2>&1 || true
    elif [[ -x "./node_modules/.bin/prettier" ]]; then
      ./node_modules/.bin/prettier --write "$FILE" >/dev/null 2>&1 || true
    fi
    ;;
esac

# Non-blocking guarantee — always exit 0 (FMTH-10)
exit 0
```

### hooks.json PostToolUse entry
```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit|MultiEdit",
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/scripts/format.sh"
          }
        ]
      }
    ]
  }
}
```

### Formatter exit code reference

| Formatter | Exit 0 | Exit 1 | Exit 2 | Exit 3 |
|-----------|--------|--------|--------|--------|
| `ruff format` | Success (file may or may not have been changed) | File formatted + `--exit-non-zero-on-format` flag | Config/CLI error | — |
| `black` | Success | — | Config file missing | — |
| `rustfmt` | Success | Unexpected error / config error | Syntax error in file | Unresolvable formatting issue |
| `prettier --write` | Success | — | Prettier internal error | — |
| `eslint --fix` | No lint errors | Lint errors remain | Config/parse error | — |
| `gofmt -w` | Success (always) | — | — | — |

**Implication:** All non-zero exits from all formatters must be suppressed via `|| true`. The hook never inspects exit codes.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `autopep8` / `yapf` for Python | `ruff format` (primary), `black` (fallback) | 2023-2024 | ruff is 100x faster; both produce Black-compatible output |
| ESLint as formatter | `prettier` (primary), `eslint --fix` (fallback) | 2020+ | prettier is formatting-only; eslint is linting; separation of concerns |
| `goimports` or `gofumpt` | `gofmt` (standard) | Stable | gofmt is the one true formatter for Go; others add opinions |
| `eslint` flat config (9.x) | Flat config (`eslint.config.js`) is now default in ESLint v9 | ESLint 9.0 (2024) | `--fix` syntax unchanged but config file format differs; hooks don't need to care |
| prettier v2 | prettier v3 | 2023 | `--write` flag unchanged; async API changed but CLI is same |

**Deprecated/outdated:**
- `autopep8`: Superseded by ruff format / black; much slower; should not be used as fallback
- `tslint`: Removed in 2019; TypeScript linting now via `@typescript-eslint/eslint-plugin`
- `rustfmt --write` (old syntax): Current syntax is just `rustfmt <file>` (writes in-place by default)

---

## Open Questions

1. **Local prettier vs global prettier priority**
   - What we know: `command -v prettier` finds global install; `./node_modules/.bin/prettier` finds project-local
   - What's unclear: Should the hook prefer project-local (uses project's configured prettier version) or global (simpler lookup)?
   - Recommendation: Check global first for simplicity (consistent with other formatters); add local fallback as secondary. Most projects that care about prettier version pin it to devDependencies and invoke it via npm scripts, not direct PATH.

2. **ALLCLEAR_DISABLE_FORMAT environment variable**
   - What we know: CONF-02 (Phase 8) adds `ALLCLEAR_DISABLE_FORMAT` toggle; Phase 3 delivers the hook without config layer
   - What's unclear: Should Phase 3 already check this env var (for forward compatibility) or leave it to Phase 8?
   - Recommendation: Add a single guard at the top of format.sh: `[[ "${ALLCLEAR_DISABLE_FORMAT:-}" == "1" ]] && exit 0`. This is a one-liner and makes Phase 8 a no-op for format toggle.

3. **prettier YAML support — @prettier/plugin-yaml required?**
   - What we know: Prettier added YAML support in v1.14 (2018), built-in
   - What's unclear: Some versions require `@prettier/plugin-yaml` plugin; behavior may vary across prettier 2.x vs 3.x
   - Recommendation: Use `prettier --write "$FILE"` and let it silently fail if YAML support is missing (already handled by `|| true`). Do not add plugin installation logic to the hook.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | bats-core 1.13.0 (git submodule per STACK.md) |
| Config file | None (bats runs via `./test/bats/bin/bats tests/`) |
| Quick run command | `./test/bats/bin/bats tests/format.bats` |
| Full suite command | `./test/bats/bin/bats tests/` |

### Phase Requirements to Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| FMTH-01 | Hook fires on PostToolUse Write/Edit/MultiEdit | integration | `./test/bats/bin/bats tests/format.bats -f "fires on Write"` | Wave 0 |
| FMTH-02 | Python formatted with ruff; falls back to black | unit | `./test/bats/bin/bats tests/format.bats -f "python ruff"` | Wave 0 |
| FMTH-03 | Rust formatted with rustfmt | unit | `./test/bats/bin/bats tests/format.bats -f "rust rustfmt"` | Wave 0 |
| FMTH-04 | TypeScript formatted with prettier; fallback eslint | unit | `./test/bats/bin/bats tests/format.bats -f "typescript prettier"` | Wave 0 |
| FMTH-05 | Go formatted with gofmt | unit | `./test/bats/bin/bats tests/format.bats -f "go gofmt"` | Wave 0 |
| FMTH-06 | JSON/YAML formatted with prettier | unit | `./test/bats/bin/bats tests/format.bats -f "json yaml"` | Wave 0 |
| FMTH-07 | Silent on success (stdout empty) | unit | `./test/bats/bin/bats tests/format.bats -f "silent success"` | Wave 0 |
| FMTH-08 | Skip silently when formatter not installed | unit | `./test/bats/bin/bats tests/format.bats -f "skip missing"` | Wave 0 |
| FMTH-09 | Skip files in node_modules, .venv, target | unit | `./test/bats/bin/bats tests/format.bats -f "skip directories"` | Wave 0 |
| FMTH-10 | Exit 0 always — even on formatter failure | unit | `./test/bats/bin/bats tests/format.bats -f "non-blocking"` | Wave 0 |

### Sampling Rate

- **Per task commit:** `./test/bats/bin/bats tests/format.bats`
- **Per wave merge:** `./test/bats/bin/bats tests/`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `tests/format.bats` — covers all FMTH-01 through FMTH-10 (primary test file for this phase)
- [ ] `test/bats/` — bats-core submodule (if not already installed by Phase 1 or 2)
- [ ] `test/libs/bats-support/` — bats-support submodule (if not already installed)
- [ ] `test/libs/bats-assert/` — bats-assert submodule (if not already installed)
- [ ] Framework install: `git submodule add https://github.com/bats-core/bats-core test/bats` (if absent)

---

## Sources

### Primary (HIGH confidence)

- [code.claude.com/docs/en/hooks](https://code.claude.com/docs/en/hooks) — PostToolUse stdin JSON schema, matcher syntax, exit code semantics, stdout/stderr behavior, `systemMessage` field
- [docs.astral.sh/ruff/formatter/](https://docs.astral.sh/ruff/formatter/) — ruff format CLI syntax, exit codes (0/1/2), `--exit-non-zero-on-format` flag, in-place formatting
- [prettier.io/docs/cli](https://prettier.io/docs/cli) — `--write` flag, exit codes (0/1/2), JSON/YAML support by extension

### Secondary (MEDIUM confidence)

- [github.com/rust-lang/rustfmt](https://github.com/rust-lang/rustfmt) — rustfmt exit codes (0/1/2/3), in-place formatting behavior, syntax error handling
- [pkg.go.dev/cmd/gofmt](https://pkg.go.dev/cmd/gofmt) — `-w` flag always exits 0, in-place write semantics
- [eslint.org/docs/latest/use/command-line-interface](https://eslint.org/docs/latest/use/command-line-interface) — `--fix` flag, exit codes, ESLint v9 flat config compatibility
- [github.com/anthropics/claude-code/issues/6403](https://github.com/anthropics/claude-code/issues/6403) — Community confirmation of PostToolUse trigger behavior for Edit/Write/MultiEdit
- [code.claude.com/docs/en/hooks](https://code.claude.com/docs/en/hooks) + search result cross-ref — MultiEdit confirmed as file-modification tool requiring inclusion in matcher

### Tertiary (LOW confidence — flagged for validation)

- Community source confirming `matcher: "Write|Edit|MultiEdit"` is the correct pattern for all file modifications — verify against live `--plugin-dir` test session before finalizing hooks.json

---

## Metadata

**Confidence breakdown:**
- Standard stack (formatters + versions): HIGH — official formatter docs verified
- Hook protocol (stdin schema, matcher, exit codes): HIGH — official Claude Code docs fetched directly
- Architecture patterns (dispatch table, path exclusion): HIGH — based on project PITFALLS.md + ARCHITECTURE.md (confirmed correct by official docs)
- Pitfalls: HIGH — derived from official docs + pitfalls research + formatter exit code docs

**Research date:** 2026-03-15
**Valid until:** 2026-06-15 (formatters are stable; Claude Code hook schema is stable as of current docs)
