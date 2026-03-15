# Phase 13: Tests - Research

**Researched:** 2026-03-15
**Domain:** bats-core shell script testing — hook exit codes, stdin/stdout JSON contracts, library function verification
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| TEST-01 | Bats test suite covers auto-format hook for each language (Python, Rust, TS, Go) | bats `run` + PATH-stub pattern for mocking absent/present formatters; stdin JSON fixture pattern for file_path injection |
| TEST-02 | Bats test suite covers auto-lint hook for each language | Same stdin fixture pattern; assert `systemMessage` JSON appears in output when linter finds issues |
| TEST-03 | Bats test suite covers sensitive file guard hook (hard blocks and soft warnings) | `assert_failure 2` verifies exit 2 + JSON schema check for `permissionDecision: "deny"`; soft warns tested with `assert_success` + `assert_output --partial` |
| TEST-04 | Bats test suite covers session start hook | stdin fixture with empty/minimal event; assert `additionalContext` JSON in stdout |
| TEST-05 | Bats test suite covers project type detection library | Source `lib/detect.sh` inside test, create temp manifest files, call `detect_project_type`, assert return value |
| TEST-06 | Bats test suite covers sibling repo discovery library | Create temp parent dir with fake `.git/` subdirs, source `lib/siblings.sh`, assert discovered paths |
| TEST-07 | Bats tests verify non-blocking guarantee (PostToolUse hooks always exit 0) | `assert_success` (checks `$status -eq 0`) on format and lint hook invocations across all error scenarios |
| TEST-08 | Bats tests verify correct exit codes for PreToolUse blocking (exit 2) | `assert_failure 2` on guard hook with blocked file paths; JSON schema assertion on stdout |
</phase_requirements>

---

## Summary

Phase 13 builds the full bats test suite for AllClear's hook scripts and shared libraries. This is a write-only phase — no implementation code changes, only `.bats` test files in `tests/`. The suite must prove the two most critical contracts of the plugin: (1) PostToolUse hooks are unconditionally non-blocking (exit 0 in every scenario), and (2) the PreToolUse guard produces exit 2 with the exact `hookSpecificOutput.permissionDecision: "deny"` JSON schema when a sensitive file is targeted.

The primary testing challenge is simulating Claude Code's hook invocation environment: each script reads a JSON event blob from stdin, processes it, and writes JSON to stdout. Tests must inject that JSON via stdin redirection, mock external tool binaries via PATH manipulation, and then assert on `$status` and `$output`. bats-core provides all necessary primitives. bats-support and bats-assert provide the assertion layer.

The test layout is one `.bats` file per script under test plus one file each for `lib/detect.sh` and `lib/siblings.sh`. Tests must be hermetic — they cannot require Python, Rust, Node, or Go toolchains to be installed, because the hooks must work (by skipping) when formatters are absent. PATH-stub mocking handles this: a fake `ruff` stub is created in a temp directory and prepended to `$PATH` when testing "formatter present" cases, removed when testing "formatter absent" cases.

**Primary recommendation:** Use bats-core 1.13.0 as a git submodule at `tests/bats`, bats-support and bats-assert as git submodules at `tests/test_helper/bats-support` and `tests/test_helper/bats-assert`. Load helpers in each test file's `setup()` function. Run with `tests/bats/bin/bats tests/`.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| bats-core | 1.13.0 (2025-11-07) | Test runner; `run` helper, `@test` blocks, setup/teardown, temp dirs | Explicitly specified in project STACK.md and additional_context; official bash testing framework |
| bats-support | latest (current HEAD) | Formatted failure messages; `load` infrastructure | Provides `fail` with helpful diffs; required by bats-assert |
| bats-assert | latest (current HEAD) | `assert_output`, `assert_success`, `assert_failure`, `assert_line`, `refute_output` | Covers 100% of hook assertion needs; avoids raw `[ "$output" = "..." ]` fragility |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `jq` (system) | 1.6+ | Parse JSON output assertions inside tests | When verifying structured JSON stdout from guard hook or session-start hook |
| `mktemp` (POSIX) | system | Create temp directories for PATH stubs and fixture files | Every test that needs to mock a formatter or create a fake repo layout |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| git submodules for bats-core | `brew install bats-core` | Submodule is zero-setup on fresh clone — CI and contributors don't need to pre-install anything |
| PATH stub mocking | `function ruff() { ... }` function export | PATH stubs survive subshell boundaries without `export -f` dance; more reliable for testing scripts run as child processes |

### Installation

```bash
# From allclear repo root
git submodule add https://github.com/bats-core/bats-core tests/bats
git submodule add https://github.com/bats-core/bats-support tests/test_helper/bats-support
git submodule add https://github.com/bats-core/bats-assert tests/test_helper/bats-assert

# Run all tests
tests/bats/bin/bats tests/*.bats
```

---

## Architecture Patterns

### Recommended Test Structure

```
tests/
├── bats/                          # git submodule: bats-core 1.13.0
├── test_helper/
│   ├── bats-support/              # git submodule
│   └── bats-assert/               # git submodule
├── format.bats                    # TEST-01, TEST-07
├── lint.bats                      # TEST-02, TEST-07
├── file-guard.bats                # TEST-03, TEST-08
├── session-start.bats             # TEST-04
├── detect.bats                    # TEST-05
└── siblings.bats                  # TEST-06
```

### Pattern 1: Stdin JSON Injection

**What:** Hook scripts read event JSON from stdin. Tests inject JSON by piping a string through `bash -c '... | script.sh'` wrapped in `run`.

**When to use:** Every hook script test — format, lint, guard, session-start.

**Example:**
```bash
# Source: bats-core docs + Claude Code hook contract (ARCHITECTURE.md)
setup() {
  load 'test_helper/bats-support/load'
  load 'test_helper/bats-assert/load'
  SCRIPT="${BATS_TEST_DIRNAME}/../scripts/format.sh"
  export CLAUDE_PLUGIN_ROOT="${BATS_TEST_DIRNAME}/.."
}

@test "format hook - python file - exits 0 when ruff absent" {
  local json='{"tool_name":"Write","tool_input":{"file_path":"/tmp/test.py"}}'
  run bash -c "printf '%s' '${json}' | bash '${SCRIPT}'"
  assert_success
}
```

**Note:** Use `printf '%s' "$json"` not `echo` to avoid trailing-newline issues with strict JSON parsers.

### Pattern 2: PATH Stub Mocking

**What:** Create a temporary directory, write a fake executable there, prepend it to `$PATH` so the script under test finds the stub instead of the real tool.

**When to use:** Testing "formatter present" and "formatter absent" paths without requiring actual tools installed.

**Example:**
```bash
# Source: bats-core community pattern, verified against bats docs
setup() {
  load 'test_helper/bats-support/load'
  load 'test_helper/bats-assert/load'
  STUB_DIR="$(mktemp -d)"
  SCRIPT="${BATS_TEST_DIRNAME}/../scripts/format.sh"
  export CLAUDE_PLUGIN_ROOT="${BATS_TEST_DIRNAME}/.."
}

teardown() {
  rm -rf "${STUB_DIR}"
}

@test "format hook - python file - runs ruff when present" {
  # Create a stub that records it was called
  printf '#!/usr/bin/env bash\necho "ruff called" >&2\nexit 0\n' > "${STUB_DIR}/ruff"
  chmod +x "${STUB_DIR}/ruff"
  local json='{"tool_name":"Write","tool_input":{"file_path":"/tmp/test.py"}}'
  run bash -c "PATH='${STUB_DIR}:${PATH}' printf '%s' '${json}' | bash '${SCRIPT}'"
  assert_success
}

@test "format hook - python file - skips silently when ruff absent" {
  # PATH has no ruff — STUB_DIR is empty
  local json='{"tool_name":"Write","tool_input":{"file_path":"/tmp/test.py"}}'
  run bash -c "PATH='${STUB_DIR}' printf '%s' '${json}' | bash '${SCRIPT}'"
  assert_success
  assert_output ""    # Silent on skip (FMTH-07)
}
```

### Pattern 3: Exit Code 2 Assertion for Guard Hook

**What:** PreToolUse guard must exit 2 to block the tool call. `assert_failure 2` (bats-assert) verifies the exact exit code.

**When to use:** All hard-block tests in `file-guard.bats`.

**Example:**
```bash
# Source: bats-assert docs - assert_failure [expected_status]
@test "guard hook - blocks write to .env" {
  local json='{"tool_name":"Write","tool_input":{"file_path":"/project/.env"}}'
  run bash -c "printf '%s' '${json}' | bash '${SCRIPT}'"
  assert_failure 2
}

@test "guard hook - stdout contains permissionDecision deny for .env block" {
  local json='{"tool_name":"Write","tool_input":{"file_path":"/project/.env"}}'
  run bash -c "printf '%s' '${json}' | bash '${SCRIPT}'"
  # Verify the JSON schema is correct (PITFALLS.md Pitfall 9)
  assert_output --partial '"permissionDecision"'
  assert_output --partial '"deny"'
}
```

### Pattern 4: Library Testing via Source

**What:** Bash libraries (`lib/detect.sh`, `lib/siblings.sh`) are not executables — source them inside a bats test function, then call the exposed functions directly.

**When to use:** `detect.bats` and `siblings.bats`.

**Example:**
```bash
# Source: bats-core docs — sourcing .sh files directly in tests
setup() {
  load 'test_helper/bats-support/load'
  load 'test_helper/bats-assert/load'
  FIXTURES_DIR="$(mktemp -d)"
  export CLAUDE_PLUGIN_ROOT="${BATS_TEST_DIRNAME}/.."
}

teardown() {
  rm -rf "${FIXTURES_DIR}"
}

@test "detect.sh - detects Python from pyproject.toml" {
  touch "${FIXTURES_DIR}/pyproject.toml"
  # shellcheck source=lib/detect.sh
  source "${BATS_TEST_DIRNAME}/../lib/detect.sh"
  run detect_project_type "${FIXTURES_DIR}"
  assert_success
  assert_output --partial "python"
}

@test "detect.sh - detects mixed Python+Node" {
  touch "${FIXTURES_DIR}/pyproject.toml"
  touch "${FIXTURES_DIR}/package.json"
  source "${BATS_TEST_DIRNAME}/../lib/detect.sh"
  run detect_project_type "${FIXTURES_DIR}"
  assert_output --partial "python"
  assert_output --partial "node"
}
```

### Pattern 5: Sibling Repo Discovery via Temp Directory

**What:** Create a temporary parent directory, populate it with fake sibling repo directories (each containing a `.git/` directory), then call `discover_siblings` and assert the paths returned.

**When to use:** `siblings.bats`.

**Example:**
```bash
@test "siblings.sh - discovers sibling repos from parent dir" {
  local PARENT="${FIXTURES_DIR}/workspace"
  mkdir -p "${PARENT}/repo-a/.git"
  mkdir -p "${PARENT}/repo-b/.git"
  mkdir -p "${PARENT}/repo-c"        # not a git repo — should be skipped
  source "${BATS_TEST_DIRNAME}/../lib/siblings.sh"
  run discover_siblings "${PARENT}/repo-a"   # cwd is one of the siblings
  assert_output --partial "repo-b"
  refute_output --partial "repo-c"
}
```

### Pattern 6: Soft-Warn Tests (exit 0 + message)

**What:** Guard hook warnings (SQL migration, generated code, CHANGELOG) must exit 0 but surface a warning message. Test both the exit code and the presence of the warning text.

**When to use:** GRDH-05, GRDH-06, GRDH-07 test cases in `file-guard.bats`.

**Example:**
```bash
@test "guard hook - warns but allows write to migration file" {
  local json='{"tool_name":"Write","tool_input":{"file_path":"/project/migrations/001_init.sql"}}'
  run bash -c "printf '%s' '${json}' | bash '${SCRIPT}'"
  assert_success                           # exit 0 — not blocked
  assert_output --partial "AllClear"       # warning present
}
```

### Anti-Patterns to Avoid

- **Testing with real formatters installed:** Tests must be hermetic. A test that passes only when `ruff` is installed will fail in CI. Use PATH stubs always.
- **Piping with bare `|` inside `run`:** `run echo 'x' | script.sh` is parsed by bash before `run` sees it. Use `bash -c "echo 'x' | script.sh"` instead.
- **Asserting on stderr when testing stdout contract:** bats `$output` captures stdout only by default. Use `run bash -c "... 2>/dev/null"` to suppress stderr noise, or `run bash -c "... 2>&1"` to capture both when testing error message content.
- **Sourcing lib scripts without `export CLAUDE_PLUGIN_ROOT`:** detect.sh and siblings.sh reference `${CLAUDE_PLUGIN_ROOT}` for sub-sourcing. Set this in `setup()` before sourcing.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Assertion with helpful failure output | Custom `[ "$output" = "x" ] || fail "got: $output"` | `assert_output "x"` (bats-assert) | bats-assert prints expected vs. actual on failure automatically |
| Checking exit code 2 specifically | `[ "$status" -eq 2 ]` with no context | `assert_failure 2` | Named assertion gives readable failure message |
| Submodule-managed helper loading | Custom `source ./helpers.sh` path logic | Standard `load 'test_helper/bats-support/load'` | Works with git submodule layout; portable across environments |
| Parallel test running | Custom xargs loop | `bats --jobs N tests/*.bats` | bats-core 1.11+ supports native parallel execution |

---

## Common Pitfalls

### Pitfall 1: `run` Cannot Handle Bare Pipes

**What goes wrong:** `run echo '{"x":1}' | bash scripts/format.sh` — bash parses `|` before `run` and the hook never receives the stdin input. The test appears to pass (exit 0 because the pipe command succeeds) but the hook received empty stdin.

**Why it happens:** Standard bash pipe operator has higher precedence than the `run` function.

**How to avoid:** Always wrap piped invocations in `bash -c "..."`:
```bash
run bash -c "printf '%s' '${json}' | bash '${SCRIPT}'"
```

**Warning signs:** Hook-under-test exits 0 even when testing block cases; stdin is always empty regardless of what you pipe.

### Pitfall 2: PATH Stub Not Exported to Subshell

**What goes wrong:** PATH stub directory set in `setup()` without export is not visible inside `run bash -c "..."` because `run` creates a subshell.

**How to avoid:** Pass PATH inline on the command or use `export` in setup:
```bash
run bash -c "PATH='${STUB_DIR}:${PATH}' bash '${SCRIPT}'"
# OR: export PATH="${STUB_DIR}:${PATH}" in setup() (but restore in teardown)
```

**Warning signs:** Stub never appears to be called; tool is found on real PATH instead.

### Pitfall 3: assert_failure Without Specific Code Misses Exit 2 Contract

**What goes wrong:** `assert_failure` passes for exit 1, 127, or any non-zero. The guard hook may exit 1 (error) instead of 2 (deny) and the test passes incorrectly.

**How to avoid:** Always use `assert_failure 2` for PreToolUse blocking tests (TEST-08). This is the specific Claude Code exit code for tool denial.

**Warning signs:** Guard hook test passes but writes are not actually blocked in real usage; wrong exit code.

### Pitfall 4: Source Contamination Between Tests

**What goes wrong:** Sourcing `lib/detect.sh` in one test defines functions that persist into subsequent tests in the same bats file. If a later test sources a different version or doesn't source the library at all, it may use the previously-defined function.

**How to avoid:** Source the library in each `@test` function body (not just in `setup()`), or use `setup_file()` with a clearly documented contract. Using `unset -f function_name` in teardown is fragile — prefer per-test sourcing.

### Pitfall 5: CLAUDE_PLUGIN_ROOT Not Set in Test Environment

**What goes wrong:** Hook scripts and lib scripts use `${CLAUDE_PLUGIN_ROOT}` to find peer files. In the test environment, this variable is unset and `source "${CLAUDE_PLUGIN_ROOT}/lib/detect.sh"` expands to `source "/lib/detect.sh"` — a nonexistent system path.

**How to avoid:** Set `export CLAUDE_PLUGIN_ROOT="${BATS_TEST_DIRNAME}/.."` in every test file's `setup()` function. Verify the path exists before any test runs.

### Pitfall 6: JSON Quoting in Shell Heredocs

**What goes wrong:** `local json='{"file_path": "/path/with spaces/test.py"}'` — single quotes work until the path itself contains a single quote. Double quotes require escaping `$` in JSON values.

**How to avoid:** Use BATS temp files for complex JSON fixtures:
```bash
cat > "${BATS_TEST_TMPDIR}/event.json" << 'EOF'
{"tool_name":"Write","tool_input":{"file_path":"/tmp/my file.py"}}
EOF
run bash -c "cat '${BATS_TEST_TMPDIR}/event.json' | bash '${SCRIPT}'"
```

---

## Code Examples

### Complete format.bats Skeleton

```bash
# Source: bats-core docs + project conventions (ARCHITECTURE.md)
#!/usr/bin/env bats

setup() {
  load 'test_helper/bats-support/load'
  load 'test_helper/bats-assert/load'
  SCRIPT="${BATS_TEST_DIRNAME}/../scripts/format.sh"
  STUB_DIR="$(mktemp -d)"
  export CLAUDE_PLUGIN_ROOT="${BATS_TEST_DIRNAME}/.."
}

teardown() {
  rm -rf "${STUB_DIR}"
}

# --- Non-blocking guarantee (TEST-07) ---

@test "format hook - exits 0 when ruff absent (python)" {
  local json='{"tool_name":"Write","tool_input":{"file_path":"/tmp/test.py"}}'
  run bash -c "PATH='${STUB_DIR}' printf '%s' '${json}' | bash '${SCRIPT}'"
  assert_success
}

@test "format hook - exits 0 when ruff crashes (python)" {
  printf '#!/usr/bin/env bash\nexit 1\n' > "${STUB_DIR}/ruff"
  chmod +x "${STUB_DIR}/ruff"
  local json='{"tool_name":"Write","tool_input":{"file_path":"/tmp/test.py"}}'
  run bash -c "PATH='${STUB_DIR}:${PATH}' printf '%s' '${json}' | bash '${SCRIPT}'"
  assert_success
}

@test "format hook - silent on success (TEST-01, FMTH-07)" {
  printf '#!/usr/bin/env bash\nexit 0\n' > "${STUB_DIR}/ruff"
  chmod +x "${STUB_DIR}/ruff"
  local json='{"tool_name":"Write","tool_input":{"file_path":"/tmp/test.py"}}'
  run bash -c "PATH='${STUB_DIR}:${PATH}' printf '%s' '${json}' | bash '${SCRIPT}'"
  assert_success
  assert_output ""
}

@test "format hook - skips node_modules path (FMTH-09)" {
  local json='{"tool_name":"Write","tool_input":{"file_path":"/project/node_modules/lib/index.js"}}'
  run bash -c "printf '%s' '${json}' | bash '${SCRIPT}'"
  assert_success
  assert_output ""
}
```

### Complete file-guard.bats Skeleton (blocking tests)

```bash
# Source: bats-assert docs + PITFALLS.md Pitfall 9 (permissionDecision schema)
#!/usr/bin/env bats

setup() {
  load 'test_helper/bats-support/load'
  load 'test_helper/bats-assert/load'
  SCRIPT="${BATS_TEST_DIRNAME}/../scripts/file-guard.sh"
  export CLAUDE_PLUGIN_ROOT="${BATS_TEST_DIRNAME}/.."
}

# --- Hard block tests (TEST-03, TEST-08) ---

@test "guard hook - exits 2 for .env file" {
  local json='{"tool_name":"Write","tool_input":{"file_path":"/project/.env"}}'
  run bash -c "printf '%s' '${json}' | bash '${SCRIPT}'"
  assert_failure 2
}

@test "guard hook - exits 2 for package-lock.json" {
  local json='{"tool_name":"Write","tool_input":{"file_path":"/project/package-lock.json"}}'
  run bash -c "printf '%s' '${json}' | bash '${SCRIPT}'"
  assert_failure 2
}

@test "guard hook - stdout has permissionDecision deny for .env block" {
  local json='{"tool_name":"Write","tool_input":{"file_path":"/project/.env"}}'
  run bash -c "printf '%s' '${json}' | bash '${SCRIPT}'"
  assert_output --partial '"permissionDecision"'
  assert_output --partial '"deny"'
}

@test "guard hook - block message contains AllClear prefix (GRDH-08)" {
  # Stderr carries the human-readable message
  local json='{"tool_name":"Write","tool_input":{"file_path":"/project/.env"}}'
  run bash -c "printf '%s' '${json}' | bash '${SCRIPT}' 2>&1"
  assert_output --partial "AllClear"
}

# --- Soft warn tests (TEST-03 soft warns) ---

@test "guard hook - exits 0 for SQL migration (GRDH-05)" {
  local json='{"tool_name":"Write","tool_input":{"file_path":"/project/migrations/001_init.sql"}}'
  run bash -c "printf '%s' '${json}' | bash '${SCRIPT}'"
  assert_success
}

@test "guard hook - exits 0 for generated go file (GRDH-06)" {
  local json='{"tool_name":"Write","tool_input":{"file_path":"/project/api.pb.go"}}'
  run bash -c "printf '%s' '${json}' | bash '${SCRIPT}'"
  assert_success
}

@test "guard hook - exits 0 for safe file" {
  local json='{"tool_name":"Write","tool_input":{"file_path":"/project/src/main.py"}}'
  run bash -c "printf '%s' '${json}' | bash '${SCRIPT}'"
  assert_success
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Raw `[ "$status" -eq 0 ]` assertions | `assert_success` / `assert_failure N` via bats-assert | bats-assert v2 | Readable failure messages with expected/actual diff |
| `echo` to pass stdin | `printf '%s' '...'` + pipe in `bash -c` | bats 1.5+ gotchas doc | Avoids trailing-newline corruption of JSON |
| Global `PATH` mutation in setup | Per-test inline `PATH='stub:$PATH'` | Community pattern solidified ~2023 | Avoids test cross-contamination |
| `bats_pipe` for pipes | `bash -c "cmd1 | cmd2"` for hook invocation | bats 1.9+ | `bats_pipe` is for output piping; `bash -c` is cleaner for stdin injection |

**Deprecated/outdated:**
- `ztombol/bats-assert`: The original repo is stale; use `bats-core/bats-assert` (the official maintained fork) as the submodule target.

---

## Open Questions

1. **`siblings.sh` function name contract**
   - What we know: The library is planned but not yet written (Phase 2 is pending)
   - What's unclear: The exported function name (`discover_siblings`? `find_siblings`? `get_sibling_repos`?)
   - Recommendation: Plan tests with a placeholder function name; the planner should note this as a dependency on Phase 2's API surface. Tests should be written to match whatever name Phase 2 chooses — use a comment block in `siblings.bats` noting the function name must match `lib/siblings.sh`.

2. **`detect.sh` function name for mixed-language detection**
   - What we know: REQUIREMENTS.md mentions returning all types for mixed repos; ARCHITECTURE.md shows `detect_project_type`
   - What's unclear: Does it return a space-separated string? An array? Multiple lines? This affects `assert_output --partial` vs. array parsing in tests.
   - Recommendation: Plan tests with `assert_output --partial "python"` AND `assert_output --partial "node"` as separate assertions (works regardless of separator format).

3. **`permissionDecision` JSON schema location in stdout**
   - What we know: PITFALLS.md documents the schema as `hookSpecificOutput.permissionDecision: "deny"` (from official Claude Code hooks docs)
   - What's unclear: Whether the guard hook implementation uses `exit 2` only or `exit 2 + JSON stdout`
   - Recommendation: ARCHITECTURE.md Pattern 2 shows `exit 2` with message to stderr only. The full JSON schema from PITFALLS.md (`hookSpecificOutput.permissionDecision`) may be required for Claude Code to surface a proper denial reason. Plan tests for both: exit code 2 (required) and optional JSON stdout containing the schema.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | bats-core 1.13.0 |
| Config file | none — invoked directly as `tests/bats/bin/bats tests/*.bats` |
| Quick run command | `tests/bats/bin/bats tests/format.bats tests/file-guard.bats` |
| Full suite command | `tests/bats/bin/bats tests/` |

### Phase Requirements to Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TEST-01 | Format hook runs per-language formatters | unit | `tests/bats/bin/bats tests/format.bats` | Wave 0 |
| TEST-02 | Lint hook runs per-language linters, outputs to conversation | unit | `tests/bats/bin/bats tests/lint.bats` | Wave 0 |
| TEST-03 | Guard hook hard-blocks and soft-warns | unit | `tests/bats/bin/bats tests/file-guard.bats` | Wave 0 |
| TEST-04 | Session-start hook fires and outputs additionalContext | unit | `tests/bats/bin/bats tests/session-start.bats` | Wave 0 |
| TEST-05 | detect.sh correctly identifies project types | unit | `tests/bats/bin/bats tests/detect.bats` | Wave 0 |
| TEST-06 | siblings.sh discovers sibling repos from parent dir | unit | `tests/bats/bin/bats tests/siblings.bats` | Wave 0 |
| TEST-07 | PostToolUse hooks always exit 0 | contract | `tests/bats/bin/bats tests/format.bats tests/lint.bats` | Wave 0 |
| TEST-08 | PreToolUse guard exits 2 with correct JSON | contract | `tests/bats/bin/bats tests/file-guard.bats` | Wave 0 |

### Sampling Rate

- **Per task commit:** `tests/bats/bin/bats tests/format.bats` (target file only)
- **Per wave merge:** `tests/bats/bin/bats tests/`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `tests/bats/` — git submodule: `git submodule add https://github.com/bats-core/bats-core tests/bats`
- [ ] `tests/test_helper/bats-support/` — git submodule: `git submodule add https://github.com/bats-core/bats-support tests/test_helper/bats-support`
- [ ] `tests/test_helper/bats-assert/` — git submodule: `git submodule add https://github.com/bats-core/bats-assert tests/test_helper/bats-assert`
- [ ] `tests/format.bats` — covers TEST-01, TEST-07 (format hook per-language + non-blocking guarantee)
- [ ] `tests/lint.bats` — covers TEST-02, TEST-07 (lint hook per-language + non-blocking guarantee)
- [ ] `tests/file-guard.bats` — covers TEST-03, TEST-08 (guard hard-blocks, soft-warns, exit 2 + JSON schema)
- [ ] `tests/session-start.bats` — covers TEST-04 (session hook additionalContext output)
- [ ] `tests/detect.bats` — covers TEST-05 (project type detection per manifest type + mixed)
- [ ] `tests/siblings.bats` — covers TEST-06 (sibling discovery from parent dir + config override)

---

## Sources

### Primary (HIGH confidence)

- bats-core official docs (https://bats-core.readthedocs.io/en/stable/) — `run` helper, `$status`, `$output`, `$BATS_TEST_TMPDIR`, setup/teardown, stdin handling, pipe gotchas
- bats-assert GitHub (https://github.com/bats-core/bats-assert) — `assert_output`, `assert_success`, `assert_failure N`, `assert_line`, `refute_output` signatures
- `.planning/research/ARCHITECTURE.md` (local, HIGH) — Hook stdin/stdout JSON contracts, PreToolUse vs PostToolUse schemas, `CLAUDE_PLUGIN_ROOT` pattern
- `.planning/research/PITFALLS.md` (local, HIGH) — `permissionDecision: deny` schema (Pitfall 9), exit-code contracts, stdin/stdout discipline
- `.planning/research/STACK.md` (local, HIGH) — bats-core 1.13.0 version pinned, submodule installation pattern

### Secondary (MEDIUM confidence)

- bats-core gotchas page (https://bats-core.readthedocs.io/en/stable/gotchas.html) — Pipe precedence issue with `run`, confirmed `bash -c "cmd | cmd"` as the workaround
- HackerOne BATS guide (https://www.hackerone.com/blog/testing-bash-scripts-bats-practical-guide) — Function mocking via `function cmd() { ... }` pattern; PATH stub pattern

### Tertiary (LOW confidence — needs validation)

- `bats_pipe` usage for piped commands — documented in bats 1.9+ but `bash -c "pipe"` is more portable and widely used for hook stdin injection; use `bash -c` pattern instead

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — bats-core 1.13.0 explicitly in STACK.md; bats-assert/bats-support are the canonical companion libraries
- Architecture (test patterns): HIGH — stdin injection, PATH stubs, exit code assertions are standard bats community patterns, verified against official docs
- Pitfalls: HIGH — pipe precedence, PATH subshell, exit 2 specificity all sourced from official bats docs and project PITFALLS.md
- Open questions: MEDIUM — function name APIs for pending Phase 2 libraries unknown until those phases execute

**Research date:** 2026-03-15
**Valid until:** 2026-09-15 (bats-core is stable; no churn expected in 6 months)
