# Phase 2: Shared Libraries - Research

**Researched:** 2026-03-15
**Domain:** Bash library design — project type detection and sibling repo discovery
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| PLGN-02 | Detect project type from manifest files (pyproject.toml → Python, Cargo.toml → Rust, package.json → Node/TS, go.mod → Go) | Manifest-file detection pattern verified via official plugin example (load-context.sh) and ARCHITECTURE.md. Implemented in `lib/detect.sh` as `detect_language()` and `detect_project_type()`. |
| PLGN-03 | Support mixed-language projects by detecting ALL applicable project types in a directory | Standard approach: collect into array rather than early-return on first match. `detect_all_project_types()` function emits space-separated list. |
| PLGN-05 | Provide shared bash library functions in `lib/` for project detection and sibling repo discovery | Architecture calls for `lib/detect.sh` and `lib/siblings.sh` at plugin root. Both are sourced by hook scripts and injected into skills via `!`command``. |
| PLGN-07 | Hook scripts use jq for JSON parsing (`printf '%s\n' "$JSON" \| jq -r '.field // empty'`) | jq 1.7.1 confirmed installed. Pattern from GSD documented; `// empty` default for safe extraction. |
| PLGN-08 | All hook scripts route debug output to stderr only — stdout reserved for structured JSON responses | Verified from official examples and ARCHITECTURE.md patterns. `>&2` on all diagnostic output. |
</phase_requirements>

---

## Summary

Phase 2 builds the shared bash library layer — `lib/detect.sh` and `lib/siblings.sh` — that every subsequent phase sources. These two files are the lowest-level shared dependency in the plugin: hooks source them directly, and skills inject them via `!`command`` shell expansion. Getting the API surface right here defines what all later phases can assume.

The detection problem is simpler than it looks: check for the presence of well-known manifest files (`pyproject.toml`, `Cargo.toml`, `package.json`, `go.mod`) and emit a stable string token. The complexity comes from mixed-language projects (PLGN-03) where multiple manifests coexist, and from the portability requirements of a bash library that runs inside a cached plugin (no absolute paths, no external deps beyond `jq` and standard POSIX tools).

The sibling discovery problem is a parent-directory scan plus optional config override. It is inherently I/O-bound and must complete fast enough for the SessionStart hook timeout. The key design constraint is that absence of siblings must be a graceful no-op, not an error.

Both libraries need Bats unit tests (TEST-05, TEST-06 — Phase 13) to lock the public API and guard against regressions when hook scripts are added in later phases.

**Primary recommendation:** Write `lib/detect.sh` with three public functions (`detect_language`, `detect_project_type`, `detect_all_project_types`) and `lib/siblings.sh` with one public function (`discover_siblings`). All other logic is private. Keep both files under 150 lines. Test each in isolation with Bats.

---

## Standard Stack

### Core

| Library/Tool | Version | Purpose | Why Standard |
|---|---|---|---|
| Bash | 3.2+ (macOS ships 3.2) | Library runtime | Universal on macOS/Linux; POSIX sh for portability where possible |
| jq | 1.7.1 (confirmed installed) | JSON parsing in hook scripts | Project constraint PLGN-07 mandates jq; also de-facto standard across all Claude Code hook examples |
| bats-core | 1.13.0 | Unit test framework for bash | Stack research confirms this is the explicitly chosen test framework for AllClear |
| bats-assert | current | Assertion helpers for bats tests | `assert_output`, `assert_success`, `assert_failure` — covers all library test needs |
| bats-support | current | Formatted bats failure output | Paired with bats-assert; installed as git submodule |

### Supporting Tools (detection targets — must be handled gracefully when absent)

| Tool | Detection Marker | Graceful Absence |
|---|---|---|
| Python (ruff/black) | `pyproject.toml`, `setup.py`, `requirements.txt` | Skip detection; emit nothing |
| Rust (rustfmt/clippy) | `Cargo.toml` | Skip detection; emit nothing |
| Node/TypeScript (prettier/eslint) | `package.json`, `tsconfig.json` | Skip detection; emit nothing |
| Go (gofmt/golangci-lint) | `go.mod` | Skip detection; emit nothing |

### Alternatives Considered

| Recommended | Alternative | Tradeoff |
|---|---|---|
| Pure bash `[[ -f manifest ]]` detection | `find` with depth limits | `find` adds latency; manifest files are always at project root so direct test is correct and faster |
| `source "${CLAUDE_PLUGIN_ROOT}/lib/detect.sh"` | Copy detection logic into each script | Copy creates drift (Anti-Pattern 4 in ARCHITECTURE.md); single source is required |
| Space-separated string from `detect_all_project_types` | Array return via global variable | Global arrays are bash 4+ only; macOS ships bash 3.2; string output + `read -ra` parsing is portable |
| `// empty` jq default (emits nothing on null) | `// ""` | `// empty` produces zero output on null/false vs. an empty string, preventing downstream `[[ -z "$VAR" ]]` false negatives |

---

## Architecture Patterns

### Recommended File Structure for This Phase

```
allclear/
├── lib/
│   ├── detect.sh       # Public: detect_language, detect_project_type, detect_all_project_types
│   └── siblings.sh     # Public: discover_siblings
└── tests/
    ├── detect.bats     # Unit tests for lib/detect.sh
    └── siblings.bats   # Unit tests for lib/siblings.sh
```

Note: bats test infrastructure (submodules) will be set up in Phase 13, but the `.bats` test files themselves may be authored now as living specs for the library API.

### Pattern 1: Bash Library with Sourced Functions

**What:** `lib/detect.sh` is not an executable script — it is a library intended to be sourced. The sourcing context sets `${CLAUDE_PLUGIN_ROOT}` (in hooks) or a relative path (in skill `!` injections). The library must not assume CWD; it receives a target directory as an argument.

**When to use:** Every hook script and skill that needs to know the project type.

**Sourcing in hook scripts:**
```bash
# Source: ARCHITECTURE.md Pattern 4
source "${CLAUDE_PLUGIN_ROOT}/lib/detect.sh"
LANG=$(detect_language "$FILE")
TYPES=$(detect_all_project_types "$(pwd)")
```

**Sourcing in skill SKILL.md via shell injection:**
```bash
# Source: ARCHITECTURE.md Pattern 3
# In SKILL.md frontmatter body:
Project type: !`source ${CLAUDE_SKILL_DIR}/../../lib/detect.sh && detect_project_type .`
```

**Note on path:** STATE.md records an open concern that `${CLAUDE_SKILL_DIR}/../../lib/detect.sh` (relative) may be less reliable than `${CLAUDE_PLUGIN_ROOT}/lib/detect.sh`. Both should be documented; `${CLAUDE_PLUGIN_ROOT}` is the safer choice whenever available in context.

### Pattern 2: detect_language — File Extension to Language Token

**What:** Given an absolute or relative file path, return a stable lowercase language token. Used by format and lint hooks to select the right tool.

**Expected tokens:** `python`, `rust`, `typescript`, `javascript`, `go`, `json`, `yaml`, `unknown`

```bash
# lib/detect.sh
detect_language() {
  local file="$1"
  local ext="${file##*.}"
  case "$ext" in
    py)              echo "python" ;;
    rs)              echo "rust" ;;
    ts|tsx)          echo "typescript" ;;
    js|jsx|mjs|cjs)  echo "javascript" ;;
    go)              echo "go" ;;
    json)            echo "json" ;;
    yaml|yml)        echo "yaml" ;;
    *)               echo "unknown" ;;
  esac
}
```

### Pattern 3: detect_project_type — Manifest File to Project Token

**What:** Given a directory path, check for manifest files and return the primary project type token. For mixed projects, returns the first matched type (priority: Python > Rust > Node > Go).

```bash
# lib/detect.sh
detect_project_type() {
  local dir="${1:-.}"
  if [[ -f "$dir/pyproject.toml" || -f "$dir/setup.py" ]]; then
    echo "python"
  elif [[ -f "$dir/Cargo.toml" ]]; then
    echo "rust"
  elif [[ -f "$dir/package.json" ]]; then
    echo "node"
  elif [[ -f "$dir/go.mod" ]]; then
    echo "go"
  else
    echo "unknown"
  fi
}
```

### Pattern 4: detect_all_project_types — Mixed-Language Support (PLGN-03)

**What:** Unlike `detect_project_type`, this function does NOT early-return on first match. It checks all manifests and emits space-separated tokens. Callers split on space: `read -ra TYPES <<< "$(detect_all_project_types .)"`.

```bash
# lib/detect.sh
detect_all_project_types() {
  local dir="${1:-.}"
  local types=()
  [[ -f "$dir/pyproject.toml" || -f "$dir/setup.py" ]] && types+=("python")
  [[ -f "$dir/Cargo.toml" ]]  && types+=("rust")
  [[ -f "$dir/package.json" ]] && types+=("node")
  [[ -f "$dir/go.mod" ]]      && types+=("go")
  echo "${types[*]}"
  # Returns empty string if no manifest found — callers check [[ -z "$result" ]]
}
```

**Portability note:** Array literals (`types=()`, `types+=()`) require bash ≥ 3.2. Confirmed safe on macOS which ships bash 3.2.57. The `[*]` expansion produces a space-separated string, which is portable as a function return value.

### Pattern 5: discover_siblings — Parent Directory Scan

**What:** Scans the parent directory (`../`) for directories containing `.git/`. Returns a newline-separated list of sibling repo absolute paths. Respects a cap to avoid SessionStart timeout.

```bash
# lib/siblings.sh
discover_siblings() {
  local project_dir="${1:-$(pwd)}"
  local parent_dir
  parent_dir="$(dirname "$project_dir")"
  local count=0
  local max_siblings=10

  for dir in "$parent_dir"/*/; do
    [[ -d "$dir/.git" ]] || continue
    # Exclude the current project itself
    [[ "$(realpath "$dir")" == "$(realpath "$project_dir")" ]] && continue
    echo "$(realpath "$dir")"
    (( count++ ))
    [[ $count -ge $max_siblings ]] && break
  done
}
```

**Config override:** When `allclear.config.json` exists in the project root, `discover_siblings` reads `$.siblingRepos` (array of paths) instead of scanning. This is the Phase 8 concern; Phase 2 should stub the config read path but not implement it fully.

### Pattern 6: jq Parsing Idiom (PLGN-07)

**What:** The exact jq idiom mandated by PLGN-07. Every hook script that reads hook stdin must use this pattern. Although `detect.sh` and `siblings.sh` are not hook scripts themselves (they don't read stdin), all consumers follow this pattern.

```bash
# Source: PLGN-07 requirement, consistent with GSD tool pattern
INPUT=$(printf '%s\n' "$HOOK_JSON" | jq -r '.tool_input.file_path // empty')
# NOT: echo "$HOOK_JSON" | jq ...  (echo treats backslashes; printf is safer)
# NOT: jq '.field' <<< "$HOOK_JSON" (herestring not POSIX)
```

### Pattern 7: stderr-only Debug Output (PLGN-08)

**What:** All diagnostic, debug, or informational output in hook scripts routes to stderr. stdout is reserved for the JSON response Claude Code reads. This pattern applies to hook scripts that SOURCE the lib functions, not to the lib functions themselves. However, lib functions should never write to stdout except to return values.

```bash
# In any hook script sourcing lib/detect.sh
echo "[allclear debug] detected language: $LANG" >&2   # diagnostic: stderr
echo '{"systemMessage": "lint warning"}' >&1            # response: stdout (explicit)
```

### Anti-Patterns to Avoid

- **Early-return in `detect_all_project_types`:** Using `detect_project_type` inside mixed-language detection instead of checking all manifests independently. PLGN-03 requires ALL applicable types, not just the first.
- **Using `echo` for passing values between functions:** bash functions return strings via stdout capture — never via global variables (hard to test) or via echo to stdout while also emitting debug output (mixes channels).
- **Hardcoded paths in lib files:** `lib/detect.sh` must work when sourced from any location. Never hardcode `/home/user/...` or `~/.claude/...` paths inside the lib. The sourcing script owns path resolution.
- **`set -e` in a library file:** `set -e` in a sourced library interacts badly with callers that handle non-zero returns themselves. Leave `set -euo pipefail` for the sourcing scripts, not the library.
- **`$(pwd)` default in library functions without explanation:** Functions default to CWD when no directory arg is provided. This is correct for hook scripts (they run in the project dir), but must be documented clearly so skill injections pass an explicit path.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---|---|---|---|
| JSON parsing from stdin | Custom regex/grep-based parser | `jq -r '.field // empty'` | jq handles escaping, unicode, nested objects; regex breaks on multi-line values |
| File extension extraction | Manual string splitting | `"${file##*.}"` (bash parameter expansion) | Bash built-in; zero subprocess cost; handles dotfiles correctly |
| Absolute path resolution | Manual `../` normalization | `realpath "$dir"` (GNU coreutils) or `$(cd "$dir" && pwd)` | `realpath` handles symlinks; POSIX fallback `$(cd)` works without coreutils |
| Bats test fixtures | Custom temp dir management | `bats_tmpdir` + `setup()`/`teardown()` bats lifecycle hooks | bats manages temp isolation; avoids leaving test artifacts |
| Library sourcing guard | Custom `SOURCED` flag | Standard `[[ "${BASH_SOURCE[0]}" != "${0}" ]]` idiom | Prevents accidental direct execution; idiomatic |

**Key insight:** The bash libraries are intentionally thin wrappers over file existence checks and string operations. The value is in centralization (single source of truth), not in algorithmic complexity. Resist the temptation to add configuration parsing, caching, or async logic to the lib layer.

---

## Common Pitfalls

### Pitfall 1: `set -e` Leaks into the Sourcing Context

**What goes wrong:** If `lib/detect.sh` contains `set -euo pipefail` at the top level, sourcing it in a hook script enables strict mode for the entire hook — including the hook's own error handling. A function returning 1 (e.g., a failed `[[ -f ]]` check) silently exits the hook.

**Why it happens:** `source` runs in the current shell context; `set` options are global.

**How to avoid:** Do NOT put `set -e` in library files. Put `set -euo pipefail` only in scripts that are executed as entry points (hook scripts, bats test files).

**Warning signs:** Hook silently exits 0 without producing any output; detection functions appear to return empty unexpectedly.

### Pitfall 2: stdout Pollution from Library Functions

**What goes wrong:** A library function uses `echo` for a debug message instead of `>&2`, then the caller captures its output: `TYPE=$(detect_project_type .)`. The debug message gets captured as part of the return value.

**Why it happens:** Bash returns values from functions by printing to stdout; any `echo` without `>&2` becomes part of that return value.

**How to avoid:** Strict rule: every `echo`/`printf` in a library function is either the intended return value (no redirect) or diagnostic output (`>&2`). Never mix in the same function.

**Warning signs:** `$TYPE` contains "python" prepended by debug text; `[[ "$TYPE" == "python" ]]` fails despite correct detection.

### Pitfall 3: Mixed-Language Detection Order Mattering Unexpectedly

**What goes wrong:** A repo has both `package.json` (for tooling scripts) and `pyproject.toml` (the actual project). `detect_project_type` returns "node" because `package.json` was checked first, and format/lint hooks run prettier instead of ruff on `.py` files.

**Why it happens:** Single-return detection functions must pick a priority; the choice is arbitrary and may not match user intent.

**How to avoid:** For single-type contexts (format/lint hooks), use `detect_language` (file-extension-based) — not `detect_project_type` (manifest-based). `detect_project_type` is for session context and skill invocation; `detect_language` is for per-file operations. Document this distinction clearly.

**Warning signs:** Python files getting formatted by prettier; Rust files being linted by eslint.

### Pitfall 4: discover_siblings Performance in Large Parent Directories

**What goes wrong:** Parent directory contains 50+ subdirectories (downloads, archives, etc.); `discover_siblings` globs all of them and runs `[[ -d "$dir/.git" ]]` on each, taking 2-3 seconds.

**Why it happens:** No depth cap on the glob; each `[[ -d ]]` is an `stat()` syscall.

**How to avoid:** Cap at `max_siblings=10` (architecture research confirms this is the documented limit). Add a guard: if total dirs in parent exceeds 50, emit a warning to stderr and stop after the cap regardless.

**Warning signs:** SessionStart hook takes > 2 seconds; Claude Code session start feels slow.

### Pitfall 5: Sourcing with Relative Paths from Skill `!` Injections

**What goes wrong:** SKILL.md uses `!`source ../../lib/detect.sh && detect_project_type .`` but the `!` injection executes in the shell's CWD at invocation time, not relative to the skill file. The relative path breaks.

**Why it happens:** `!` injections are shell commands; relative paths are resolved from CWD of the executing process, not from the skill directory.

**How to avoid:** In skills, prefer `${CLAUDE_PLUGIN_ROOT}/lib/detect.sh` when `CLAUDE_PLUGIN_ROOT` is available. Document the `${CLAUDE_SKILL_DIR}/../../lib/detect.sh` pattern as a fallback only, with the caveat from STATE.md (needs runtime verification).

**Warning signs:** Skill shows empty project type; `source` error in skill output.

---

## Code Examples

### detect.sh: Complete Public API

```bash
#!/usr/bin/env bash
# lib/detect.sh — Project type and language detection library
# Source this file; do not execute directly.
# No set -e here — sourcing context owns error handling.

# detect_language FILE
# Returns: lowercase language token (python|rust|typescript|javascript|go|json|yaml|unknown)
detect_language() {
  local file="$1"
  local ext="${file##*.}"
  case "$ext" in
    py)              echo "python" ;;
    rs)              echo "rust" ;;
    ts|tsx)          echo "typescript" ;;
    js|jsx|mjs|cjs)  echo "javascript" ;;
    go)              echo "go" ;;
    json)            echo "json" ;;
    yaml|yml)        echo "yaml" ;;
    *)               echo "unknown" ;;
  esac
}

# detect_project_type DIR
# Returns: primary project type token (python|rust|node|go|unknown)
# Priority: python > rust > node > go
detect_project_type() {
  local dir="${1:-.}"
  if [[ -f "$dir/pyproject.toml" || -f "$dir/setup.py" ]]; then
    echo "python"
  elif [[ -f "$dir/Cargo.toml" ]]; then
    echo "rust"
  elif [[ -f "$dir/package.json" ]]; then
    echo "node"
  elif [[ -f "$dir/go.mod" ]]; then
    echo "go"
  else
    echo "unknown"
  fi
}

# detect_all_project_types DIR
# Returns: space-separated list of ALL detected project types
# Empty string if none detected (not "unknown")
detect_all_project_types() {
  local dir="${1:-.}"
  local types=()
  [[ -f "$dir/pyproject.toml" || -f "$dir/setup.py" ]] && types+=("python")
  [[ -f "$dir/Cargo.toml" ]]  && types+=("rust")
  [[ -f "$dir/package.json" ]] && types+=("node")
  [[ -f "$dir/go.mod" ]]      && types+=("go")
  echo "${types[*]}"
}
```

### siblings.sh: Complete Public API

```bash
#!/usr/bin/env bash
# lib/siblings.sh — Sibling repo discovery library
# Source this file; do not execute directly.

# discover_siblings [PROJECT_DIR]
# Scans parent directory for sibling git repos.
# Returns: newline-separated list of absolute paths (max 10)
# Defaults to CWD if PROJECT_DIR not provided.
discover_siblings() {
  local project_dir="${1:-$(pwd)}"
  local parent_dir
  parent_dir="$(dirname "$(realpath "$project_dir")")"
  local count=0
  local max_siblings=10

  for dir in "$parent_dir"/*/; do
    [[ -d "$dir/.git" ]] || continue
    local abs_dir
    abs_dir="$(realpath "$dir")"
    # Exclude current project
    [[ "$abs_dir" == "$(realpath "$project_dir")" ]] && continue
    echo "$abs_dir"
    (( count++ )) || true
    [[ $count -ge $max_siblings ]] && break
  done
}
```

Note: `(( count++ )) || true` prevents `set -e` in caller from treating arithmetic increment of 0 as a failure (bash quirk: `(( expr ))` returns 1 when result is 0).

### Bats Test Pattern for Library Functions

```bash
# tests/detect.bats
# Requires bats-core, bats-assert, bats-support as git submodules

setup() {
  load 'test_helper/bats-support/load'
  load 'test_helper/bats-assert/load'
  # Create temp fixture directory
  FIXTURE="$(mktemp -d)"
  # Source the library
  source "${BATS_TEST_DIRNAME}/../lib/detect.sh"
}

teardown() {
  rm -rf "$FIXTURE"
}

@test "detect_language identifies Python by extension" {
  run detect_language "/some/path/main.py"
  assert_success
  assert_output "python"
}

@test "detect_language identifies TypeScript by .tsx extension" {
  run detect_language "component.tsx"
  assert_success
  assert_output "typescript"
}

@test "detect_project_type returns python for pyproject.toml" {
  touch "$FIXTURE/pyproject.toml"
  run detect_project_type "$FIXTURE"
  assert_success
  assert_output "python"
}

@test "detect_all_project_types returns both types for mixed project" {
  touch "$FIXTURE/pyproject.toml"
  touch "$FIXTURE/package.json"
  run detect_all_project_types "$FIXTURE"
  assert_success
  assert_output --partial "python"
  assert_output --partial "node"
}

@test "detect_project_type returns unknown for empty directory" {
  run detect_project_type "$FIXTURE"
  assert_success
  assert_output "unknown"
}
```

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | bats-core 1.13.0 |
| Config file | none — bats is invoked directly |
| Quick run command | `./tests/bats/bin/bats tests/detect.bats` |
| Full suite command | `./tests/bats/bin/bats tests/` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PLGN-02 | detect_project_type returns correct token for each manifest file | unit | `./tests/bats/bin/bats tests/detect.bats` | Wave 0 |
| PLGN-03 | detect_all_project_types returns all types when multiple manifests present | unit | `./tests/bats/bin/bats tests/detect.bats` | Wave 0 |
| PLGN-05 | lib/detect.sh and lib/siblings.sh can be sourced without errors | smoke | `./tests/bats/bin/bats tests/detect.bats tests/siblings.bats` | Wave 0 |
| PLGN-07 | jq idiom parses hook stdin without error on valid JSON | unit | `./tests/bats/bin/bats tests/detect.bats` | Wave 0 |
| PLGN-08 | Library functions produce no stdout except return values | unit | `./tests/bats/bin/bats tests/detect.bats` | Wave 0 |

### Sampling Rate

- **Per task commit:** `./tests/bats/bin/bats tests/detect.bats tests/siblings.bats`
- **Per wave merge:** `./tests/bats/bin/bats tests/`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `tests/detect.bats` — covers PLGN-02, PLGN-03, PLGN-05, PLGN-08
- [ ] `tests/siblings.bats` — covers PLGN-05 (discover_siblings)
- [ ] `tests/test_helper/` — bats-support and bats-assert submodule symlinks
- [ ] `tests/bats/` — bats-core submodule
- [ ] Framework install: `git submodule add https://github.com/bats-core/bats-core tests/bats && git submodule add https://github.com/bats-core/bats-support tests/test_helper/bats-support && git submodule add https://github.com/bats-core/bats-assert tests/test_helper/bats-assert`

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|---|---|---|---|
| Detecting language from file content / shebang parsing | Detecting from file extension (fast) + manifest presence (for project context) | Always best practice | Shebang parsing is slow and unreliable; extension is O(1) |
| Each script re-implementing detection | Shared library sourced by all consumers | Anti-Pattern 4 in ARCHITECTURE.md | Eliminates drift between hook scripts |
| `echo` for debug output in libraries | `>&2` redirect for all non-return output | Standard for hook contexts | stdout is reserved for JSON responses in Claude Code hooks |

**Deprecated/outdated:**

- Individual inline detection in each hook script: superseded by `lib/detect.sh` pattern established in this phase.
- `requirements.txt` as sole Python detector: `pyproject.toml` is the modern Python standard (PEP 518/621); `setup.py` is legacy fallback. `requirements.txt` alone without `pyproject.toml`/`setup.py` is not a reliable signal.

---

## Open Questions

1. **`${CLAUDE_SKILL_DIR}` vs `${CLAUDE_PLUGIN_ROOT}` in skill injections**
   - What we know: STATE.md flags `${CLAUDE_SKILL_DIR}/../../lib/detect.sh` as needing runtime verification
   - What's unclear: Whether `CLAUDE_SKILL_DIR` is reliably set in the `!` injection context
   - Recommendation: Implement `lib/detect.sh` to work with both paths; document `${CLAUDE_PLUGIN_ROOT}` as primary and test the relative path approach in a live session before Phase 7

2. **`realpath` availability**
   - What we know: `realpath` is GNU coreutils; macOS does not ship it by default (but Homebrew installs it)
   - What's unclear: Whether Claude Code execution environment guarantees `realpath`
   - Recommendation: Use `$(cd "$dir" && pwd)` as the POSIX fallback inside `discover_siblings`; test on a clean macOS environment without Homebrew

3. **bats submodule vs. system install**
   - What we know: Stack research recommends git submodule for reproducibility
   - What's unclear: Whether bats is available system-wide on the dev machine (`which bats` returned not found in this environment)
   - Recommendation: Submodule is the right call; document the setup command clearly in README

---

## Sources

### Primary (HIGH confidence)

- ARCHITECTURE.md (project) — Pattern 4 (shared library sourcing), Anti-Pattern 4 (no duplicate detection logic), data flow diagrams
- STACK.md (project) — bats-core 1.13.0, jq usage pattern, `${CLAUDE_PLUGIN_ROOT}` requirement
- `/Users/ravichillerega/.claude/plugins/marketplaces/claude-plugins-official/plugins/plugin-dev/skills/hook-development/examples/load-context.sh` — Official example of manifest-file project type detection (if/elif chain verified)
- `/Users/ravichillerega/.claude/plugins/marketplaces/claude-plugins-official/plugins/plugin-dev/skills/hook-development/examples/validate-write.sh` — Official example of jq stdin parsing (`jq -r '.tool_input.file_path // empty'`) and stderr-only guard messages
- `/Users/ravichillerega/.claude/plugins/cache/thedotmack/claude-mem/10.5.5/hooks/hooks.json` — Production example of `${CLAUDE_PLUGIN_ROOT}` runtime path variable usage

### Secondary (MEDIUM confidence)

- FEATURES.md (project) — Sibling repo discovery design, 10-sibling cap, allclear.config.json override notes
- STATE.md (project) — Open concern about `${CLAUDE_SKILL_DIR}/../../lib/detect.sh` path reliability

### Tertiary (LOW confidence)

- None — all findings confirmed by project research files and live plugin inspection

---

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — jq confirmed installed (1.7.1), bats-core version confirmed in STACK.md, bash version verified (macOS 3.2+)
- Architecture: HIGH — lib/ structure documented in ARCHITECTURE.md, patterns confirmed via official plugin examples
- Pitfalls: HIGH — `set -e` leakage and stdout pollution are well-documented bash library hazards; confirmed in practice

**Research date:** 2026-03-15
**Valid until:** 2026-09-15 (stable domain — bash and jq APIs change rarely; Claude Code hook protocol may evolve faster, recheck if plugin API version bumps)
