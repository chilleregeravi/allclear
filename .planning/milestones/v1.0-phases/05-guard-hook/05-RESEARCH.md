# Phase 5: Guard Hook - Research

**Researched:** 2026-03-15
**Domain:** Claude Code PreToolUse hook — sensitive file blocking and soft-warn patterns in bash
**Confidence:** HIGH — sourced from official example plugins and live installed plugin inspection

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| GRDH-01 | Guard hook fires on PreToolUse for Edit and Write tool events | hooks.json PreToolUse + matcher "Edit\|Write\|MultiEdit" pattern confirmed in security-guidance plugin |
| GRDH-02 | Hook hard-blocks lock files (*.lock, Cargo.lock, poetry.lock, package-lock.json, bun.lock) using permissionDecision: "deny" schema | exit 2 + hookSpecificOutput deny schema confirmed; glob patterns for extension matching documented |
| GRDH-03 | Hook hard-blocks secret/credential files (.env, .env.*, *credentials*, *secret*, *.pem, *.key) with path normalization via realpath | realpath normalization required to prevent bypass; pattern matching approach documented |
| GRDH-04 | Hook hard-blocks writes to generated directories (node_modules/, .venv/, target/) | Directory prefix matching with normalized path; same blocking mechanism as file patterns |
| GRDH-05 | Hook warns but allows SQL migration files with immutability notice | Soft-warn pattern: systemMessage JSON to stdout, exit 0 — never exit 2 |
| GRDH-06 | Hook warns but allows generated code files (*.pb.go, *_generated.*, *.gen.*) | Same soft-warn pattern as GRDH-05 |
| GRDH-07 | Hook warns but allows CHANGELOG.md with auto-generation notice | Same soft-warn pattern as GRDH-05 |
| GRDH-08 | Hook provides clear explanation in block messages ("AllClear: blocked write to .env — sensitive file protected") | permissionDecisionReason field in hookSpecificOutput carries the message; systemMessage carries user-facing explanation |
</phase_requirements>

---

## Summary

Phase 5 builds `scripts/file-guard.sh` — the only blocking hook in the AllClear plugin. All other hooks are informational; this one actually prevents tool calls from executing. It fires on `PreToolUse` for `Edit`, `Write`, and `MultiEdit` tool events and makes a binary decision: hard-block (exit 2 + deny schema) or soft-warn (systemMessage JSON + exit 0) based on what file is being written.

The critical technical fact for this phase is the two-tier output model. Hard blocks require exit code 2; the blocking message goes to stderr (plain text or JSON). Soft warnings output a `systemMessage` JSON object to stdout and exit 0. Mixing these up is the single highest-risk implementation error — a wrong-channel output means the guard fires but the write proceeds silently.

Path normalization via `realpath` is mandatory before pattern matching. Without it, variations like `../.env`, `.ENV`, or `./dir/../.env` bypass the guard entirely. The `ALLCLEAR_DISABLE_GUARD` environment variable and `ALLCLEAR_EXTRA_BLOCKED` config extension points must also be wired in at this phase per CONF-02 and CONF-04.

**Primary recommendation:** Use exit 2 for hard blocks with message on stderr. Use `{"systemMessage": "..."}` on stdout + exit 0 for soft warns. Normalize all paths with `realpath` before any pattern matching. Never call `set -e` before path normalization (realpath can fail on non-existent paths).

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| bash | system (≥3.2) | Hook script runtime | Claude Code hooks must be shell-executable; bash is universal on macOS/Linux |
| jq | system | Parse stdin JSON from Claude Code | Project-wide standard per PLGN-07; same pattern as GSD hooks |
| realpath / readlink -f | system | Normalize paths before pattern matching | Prevents path traversal bypass (.env vs ../.env vs .ENV) |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| basename | system (coreutils) | Extract filename for extension matching | Pattern matching against filename only (lock files, *.pem) |
| dirname | system (coreutils) | Extract directory component | Directory prefix matching (node_modules/, .venv/) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| bash glob patterns | regex via `=~` | Both work; glob patterns (`[[ "$f" == *.env ]]`) are simpler for extension matching; regex needed for complex patterns like `*.env.*` |
| realpath | Python normpath | realpath is a single system call, no interpreter startup cost; use realpath |
| exit 2 + stderr message | hookSpecificOutput JSON on stdout | Both appear to work (see sources); official shell examples use stderr+exit2; Python hookify uses stdout JSON; stderr+exit2 is simpler for shell |

**Installation:** No additional packages — bash, jq, and coreutils are present on all target systems.

---

## Architecture Patterns

### Recommended Script Structure
```
scripts/
└── file-guard.sh    # PreToolUse handler; reads stdin JSON, classifies file, blocks or warns
```

The guard hook has no dependency on `lib/detect.sh` (no language detection needed) but does read `allclear.config.json` for `ALLCLEAR_EXTRA_BLOCKED` override if present.

### Pattern 1: Hard Block via exit 2 (the authoritative pattern)

**What:** For files that must never be written — credentials, lock files, generated dirs — the hook outputs a human-readable message to stderr and exits 2. Claude Code interprets exit 2 as a denied tool call.

**When to use:** GRDH-02, GRDH-03, GRDH-04 — all hard-block requirements.

**Confirmed by:** Official `plugin-dev` example `validate-write.sh` and the live `security-guidance` plugin.

```bash
# Source: ~/.claude/plugins/marketplaces/claude-plugins-official/plugins/plugin-dev/
#         skills/hook-development/examples/validate-write.sh
# Source: ~/.claude/plugins/marketplaces/claude-plugins-official/plugins/security-guidance/
#         hooks/security_reminder_hook.py (same pattern, Python)

block_file() {
  local file="$1"
  local reason="$2"
  echo "AllClear: blocked write to $(basename "$file") — ${reason}" >&2
  exit 2
}
```

**Important:** The message goes to **stderr** (`>&2`). Stdout must remain clean (or contain only valid JSON). Exit 2 is what triggers the deny; the message is informational to Claude.

### Pattern 2: Soft Warn via systemMessage (allow but notify)

**What:** For files that are unusual to edit but not forbidden — migration files, generated code, CHANGELOG — the hook outputs a `systemMessage` JSON to stdout and exits 0. The write proceeds; Claude sees the warning in context.

**When to use:** GRDH-05, GRDH-06, GRDH-07 — all warn-but-allow requirements.

```bash
# Pattern from ARCHITECTURE.md and confirmed by hookify rule_engine.py
warn_file() {
  local file="$1"
  local reason="$2"
  # Write JSON to stdout — Claude receives this as a system message
  printf '{"systemMessage": "AllClear: warning — %s is %s. %s"}\n' \
    "$(basename "$file")" "$reason" "Proceed carefully."
  exit 0  # Allow the write — this is NOT a block
}
```

**Critical distinction:** `exit 0` here. Any other exit code would trigger blocking behavior.

### Pattern 3: Path Normalization Before Any Match

**What:** Always resolve the absolute path before pattern matching. This prevents bypass via path traversal, symlinks, and case-insensitive filesystems.

**When to use:** Before every pattern check in the guard hook.

```bash
#!/usr/bin/env bash
# Source: PITFALLS.md security section + validate-write.sh pattern

INPUT=$(cat)
RAW_FILE=$(printf '%s\n' "$INPUT" | jq -r '.tool_input.file_path // .tool_input.path // empty')

# Exit cleanly if no file path (non-file tools like Bash)
if [[ -z "$RAW_FILE" ]]; then
  exit 0
fi

# Normalize path — use realpath if available, fall back to readlink -f
if command -v realpath &>/dev/null; then
  FILE=$(realpath -m "$RAW_FILE" 2>/dev/null || printf '%s' "$RAW_FILE")
else
  FILE=$(readlink -f "$RAW_FILE" 2>/dev/null || printf '%s' "$RAW_FILE")
fi

BASENAME=$(basename "$FILE")
```

Note: `realpath -m` (or `--no-canonicalize`) works even if the file does not yet exist. Without `-m`, realpath fails on new files being written for the first time, which would cause the guard to exit with an error.

### Pattern 4: Disable via Environment Variable (CONF-02)

**What:** Honor `ALLCLEAR_DISABLE_GUARD=1` to allow the guard to be bypassed entirely. This must be the first check after reading stdin.

```bash
if [[ "${ALLCLEAR_DISABLE_GUARD:-0}" == "1" ]]; then
  exit 0
fi
```

### Pattern 5: hooks.json PreToolUse registration

**What:** Register the guard in `hooks/hooks.json` under `PreToolUse` with a matcher covering all write tools.

**Confirmed by:** security-guidance `hooks.json` which uses `"matcher": "Edit|Write|MultiEdit"`.

```json
{
  "description": "AllClear plugin hooks",
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|Write|MultiEdit",
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/scripts/file-guard.sh",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

### Anti-Patterns to Avoid

- **Putting hookSpecificOutput on stdout for blocking:** The official shell examples put the block message on stderr (plain text) and use exit 2. The JSON `hookSpecificOutput` on stdout approach (hookify Python) also works, but mixing approaches in the same script is confusing. Pick one — prefer stderr+exit2 for shell scripts.
- **Using `set -e` before realpath:** If realpath fails (file doesn't exist yet on first write), `set -e` causes the script to exit 1, which Claude Code may interpret as an error rather than a clean allow. Either use `set -e` only after path normalization, or trap errors around the realpath call.
- **Matching on raw basename without normalization:** `[[ "$RAW_FILE" == *.env ]]` matches `.env` but not `../../.env` or `.env.local` glob. Normalize first, then match on BASENAME.
- **Blocking on directory match without checking the path is actually under that dir:** `[[ "$FILE" == *node_modules* ]]` will falsely match a file named `node_modules_backup.json`. Use a proper prefix: `[[ "$FILE" == */node_modules/* ]] || [[ "$FILE" == */node_modules" ]]`.
- **Outputting formatter errors to stdout:** Any non-empty, non-JSON stdout output from a hook causes Claude Code to log a parse warning. Keep all human-readable output on stderr.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JSON parsing from stdin | Custom bash string manipulation | `jq -r '.tool_input.file_path // empty'` | Shell string parsing of JSON is fragile; jq handles escaping, null, nested keys |
| Path normalization | String manipulation on `$FILE` | `realpath -m` | Shell string ops miss symlinks, `..` components, double slashes |
| Pattern lists | Hardcoded `if/elif` chains | Bash arrays + `for` loops with glob matching | Arrays are maintainable and testable; if/elif chains are hard to extend |
| Config reading | Custom parser | `jq -r '.extraBlocked // [] | .[]' allclear.config.json 2>/dev/null` | One-liner; handles missing file gracefully with `2>/dev/null` |

**Key insight:** The most dangerous hand-roll in this domain is path matching without normalization. Every security bypass in file-guard hooks historically traces back to comparing raw user-supplied paths against deny patterns.

---

## Common Pitfalls

### Pitfall 1: Wrong Exit Code Channel for Blocks

**What goes wrong:** Hook uses exit 1 (error) instead of exit 2 (deny). Claude Code treats exit 1 as a hook execution error and may surface a confusing error message, or silently allow the write depending on the runtime version.

**Why it happens:** Standard bash convention is `exit 1` on failure. The PreToolUse semantics are different — exit 2 specifically means "deny this tool call."

**How to avoid:** Every code path that blocks must use `exit 2`. Add a bats test: `run ./file-guard.sh <<< "$SENSITIVE_JSON"; [ "$status" -eq 2 ]`.

**Warning signs:** Guard appears to fire (debug logs show it running) but the file write proceeds anyway.

### Pitfall 2: realpath Fails on New Files

**What goes wrong:** When Claude creates a new file (not yet on disk), `realpath` returns an error exit code. If the script uses `set -e`, the whole hook exits non-zero, potentially blocking all new file creation.

**Why it happens:** `realpath` without flags requires the file to exist to resolve symlinks. New files don't exist yet.

**How to avoid:** Use `realpath -m` (GNU coreutils) or `realpath --no-canonicalize` which resolves without requiring existence. On macOS where `-m` may not be available, fall back to `readlink -f` or manual expansion: `cd "$(dirname "$f")" && pwd)/$(basename "$f")`.

**Warning signs:** Claude fails to create any new file in the project; hook always exits non-zero.

### Pitfall 3: Blocking Bypass via Path Variations

**What goes wrong:** Guard blocks `.env` but not `.env.production`, `.Env`, `../.env`, or `subdir/.env`.

**Why it happens:** Pattern matching on raw path or basename without normalization. Glob `*.env` doesn't match `.env.production`.

**How to avoid:**
- Normalize with realpath first
- Use specific patterns: `[[ "$BASENAME" == .env ]] || [[ "$BASENAME" == .env.* ]]`
- Test every variant in bats: `.env`, `.env.production`, `.env.local`, `subdir/.env`

**Warning signs:** Guard blocks `.env` in the project root but allows writing `config/.env`.

### Pitfall 4: Soft Warn Uses exit 2

**What goes wrong:** Developer treats all sensitive-adjacent files the same and uses exit 2 for warnings. Migration files, CHANGELOG, and generated code get hard-blocked, causing Claude to be unable to do legitimate work.

**Why it happens:** Copy-paste from the hard-block code path; failing to distinguish GRDH-02/03/04 (hard block) from GRDH-05/06/07 (soft warn).

**How to avoid:** Two completely separate code paths. Hard-block path: stderr message + `exit 2`. Soft-warn path: stdout `systemMessage` JSON + `exit 0`. Bats test: warn path must assert `status -eq 0`.

**Warning signs:** Claude cannot update CHANGELOG or modify migration files; "blocked by AllClear" messages appear for legitimate operations.

### Pitfall 5: stdout Contamination Breaks Claude's JSON Parsing

**What goes wrong:** Debug `echo` statements or formatter output goes to stdout, producing non-JSON content. Claude Code attempts to parse stdout as JSON and logs a parse error, potentially misclassifying the hook result.

**Why it happens:** Default bash output is stdout. Developers add `echo "Checking $FILE..."` for debugging without redirecting.

**How to avoid:** All debug/status output must use `>&2`. Stdout is reserved for: empty (allow), or `{"systemMessage": "..."}` JSON (soft warn). Add a bats test asserting stdout is empty or valid JSON for every code path.

**Warning signs:** Hook fires correctly but produces `JSON parse error` in Claude Code debug output.

### Pitfall 6: Missing MultiEdit Tool Coverage

**What goes wrong:** Guard only handles `file_path` from `Edit` and `Write` tools but `MultiEdit` uses the same `file_path` field. Guard silently allows bulk edits to sensitive files via MultiEdit.

**Why it happens:** Developers test with Edit and Write but forget MultiEdit exists.

**How to avoid:** Include `MultiEdit` in the hooks.json matcher and in bats tests. The `file_path` field is consistent across all three tools.

**Warning signs:** Single-edit to `.env` is blocked but a multi-file edit that includes `.env` proceeds.

---

## Code Examples

Verified patterns from official sources:

### Complete Guard Hook Structure
```bash
#!/usr/bin/env bash
# scripts/file-guard.sh
# PreToolUse hook — blocks writes to sensitive files, warns on risky ones
# Exit 2 = hard block (deny); exit 0 = allow (with optional stdout systemMessage for warnings)
# All debug/status output goes to stderr; stdout is JSON-only or empty.

# --- Disable guard entirely ---
if [[ "${ALLCLEAR_DISABLE_GUARD:-0}" == "1" ]]; then
  exit 0
fi

# --- Read stdin exactly once ---
INPUT=$(cat)
RAW_FILE=$(printf '%s\n' "$INPUT" | jq -r '.tool_input.file_path // .tool_input.path // empty' 2>/dev/null)

# Not a file operation — allow
if [[ -z "$RAW_FILE" ]]; then
  exit 0
fi

# --- Normalize path (works on files that don't exist yet) ---
if command -v realpath &>/dev/null; then
  FILE=$(realpath -m "$RAW_FILE" 2>/dev/null || printf '%s' "$RAW_FILE")
else
  # macOS fallback
  FILE=$(cd "$(dirname "$RAW_FILE")" 2>/dev/null && printf '%s/%s' "$(pwd)" "$(basename "$RAW_FILE")" || printf '%s' "$RAW_FILE")
fi
BASENAME=$(basename "$FILE")

# --- Hard block: secret/credential files ---
# Source: validate-write.sh pattern + GRDH-03
HARD_BLOCK=0
BLOCK_REASON=""

if [[ "$BASENAME" == .env ]] || [[ "$BASENAME" == .env.* ]]; then
  BLOCK_REASON="sensitive .env file protected"
  HARD_BLOCK=1
elif [[ "$BASENAME" == *.pem ]] || [[ "$BASENAME" == *.key ]]; then
  BLOCK_REASON="private key or certificate protected"
  HARD_BLOCK=1
elif [[ "$BASENAME" == *credentials* ]] || [[ "$BASENAME" == *secret* ]]; then
  BLOCK_REASON="credentials/secret file protected"
  HARD_BLOCK=1
fi

# --- Hard block: lock files (GRDH-02) ---
if [[ $HARD_BLOCK -eq 0 ]]; then
  case "$BASENAME" in
    *.lock|package-lock.json|bun.lock)
      BLOCK_REASON="lock file — managed by package manager, not Claude"
      HARD_BLOCK=1
      ;;
  esac
fi

# --- Hard block: generated directories (GRDH-04) ---
if [[ $HARD_BLOCK -eq 0 ]]; then
  if [[ "$FILE" == */node_modules/* ]] || [[ "$FILE" == */node_modules" ]] || \
     [[ "$FILE" == */.venv/* ]] || [[ "$FILE" == */target/* ]]; then
    BLOCK_REASON="generated/vendor directory — do not edit directly"
    HARD_BLOCK=1
  fi
fi

if [[ $HARD_BLOCK -eq 1 ]]; then
  # Message to stderr; exit 2 triggers deny
  # Source: plugin-dev/skills/hook-development/examples/validate-write.sh
  printf 'AllClear: blocked write to %s — %s\n' "$BASENAME" "$BLOCK_REASON" >&2
  exit 2
fi

# --- Soft warn: migration files (GRDH-05) ---
if [[ "$FILE" == */migrations/*.sql ]] || [[ "$FILE" == */migrations/*.py ]]; then
  printf '{"systemMessage": "AllClear: %s is a migration file — migrations should be immutable once applied. Editing may cause schema drift."}\n' "$BASENAME"
  exit 0  # Allow the write — soft warn only
fi

# --- Soft warn: generated code (GRDH-06) ---
if [[ "$BASENAME" == *.pb.go ]] || [[ "$BASENAME" == *_generated.* ]] || [[ "$BASENAME" == *.gen.* ]]; then
  printf '{"systemMessage": "AllClear: %s appears to be generated code — edits may be overwritten on next build. Edit the source template instead."}\n' "$BASENAME"
  exit 0
fi

# --- Soft warn: CHANGELOG (GRDH-07) ---
if [[ "$BASENAME" == CHANGELOG.md ]] || [[ "$BASENAME" == CHANGELOG ]]; then
  printf '{"systemMessage": "AllClear: CHANGELOG.md is often auto-generated. Verify this project manages it manually before editing."}\n' "$BASENAME"
  exit 0
fi

# --- Default: allow ---
exit 0
```

### hooks.json Registration
```json
{
  "description": "AllClear plugin hooks",
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|Write|MultiEdit",
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/scripts/file-guard.sh",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

### Bats Test Skeleton (TEST-03, TEST-08)
```bash
#!/usr/bin/env bats
# tests/file-guard.bats

SCRIPT="${BATS_TEST_DIRNAME}/../scripts/file-guard.sh"

make_input() {
  local tool="$1" path="$2"
  printf '{"tool_name": "%s", "tool_input": {"file_path": "%s"}}' "$tool" "$path"
}

@test "hard-blocks .env file" {
  run bash "$SCRIPT" <<< "$(make_input Write "/project/.env")"
  [ "$status" -eq 2 ]
}

@test "hard-blocks .env.production" {
  run bash "$SCRIPT" <<< "$(make_input Edit "/project/.env.production")"
  [ "$status" -eq 2 ]
}

@test "hard-blocks Cargo.lock" {
  run bash "$SCRIPT" <<< "$(make_input Write "/project/Cargo.lock")"
  [ "$status" -eq 2 ]
}

@test "hard-blocks package-lock.json" {
  run bash "$SCRIPT" <<< "$(make_input Write "/project/package-lock.json")"
  [ "$status" -eq 2 ]
}

@test "hard-blocks file in node_modules" {
  run bash "$SCRIPT" <<< "$(make_input Write "/project/node_modules/lodash/index.js")"
  [ "$status" -eq 2 ]
}

@test "soft-warns on migration file — exits 0" {
  run bash "$SCRIPT" <<< "$(make_input Edit "/project/migrations/0001_initial.sql")"
  [ "$status" -eq 0 ]
  [[ "$output" == *"systemMessage"* ]]
}

@test "soft-warns on generated code — exits 0" {
  run bash "$SCRIPT" <<< "$(make_input Edit "/project/api/user_generated.go")"
  [ "$status" -eq 0 ]
}

@test "allows normal source file — exits 0 with no output" {
  run bash "$SCRIPT" <<< "$(make_input Edit "/project/src/main.go")"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "disabled by ALLCLEAR_DISABLE_GUARD — allows .env" {
  ALLCLEAR_DISABLE_GUARD=1 run bash "$SCRIPT" <<< "$(make_input Write "/project/.env")"
  [ "$status" -eq 0 ]
}

@test "stdout is empty or valid JSON on hard block — never plain text" {
  # Verify stdout is empty (plain text goes to stderr)
  run bash "$SCRIPT" <<< "$(make_input Write "/project/.env")"
  [ "$status" -eq 2 ]
  [ -z "$output" ]  # stdout must be empty; message went to stderr
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| PreToolUse deny via `{"decision": "block"}` on stdout | exit 2 + stderr message (shell) OR `{"hookSpecificOutput": {"permissionDecision": "deny"}}` on stdout (Python) | Claude Code hooks v1 | Both approaches work; shell scripts use exit 2 + stderr; Python scripts use hookSpecificOutput JSON on stdout |
| Blocking on any non-zero exit | exit 2 specifically = deny; exit 1 = hook error | Current | exit 1 triggers hook error, not clean deny; always use exit 2 for intentional blocks |
| Path pattern matching on raw user input | Normalize via realpath -m before matching | Security best practice | Prevents bypass via path traversal variants |

**Deprecated/outdated:**
- `{"decision": "block"}` at the top level — this is PostToolUse/Stop syntax, not PreToolUse. Using it in PreToolUse has no effect (confirmed by PITFALLS.md Pitfall 9 and hookify rule_engine.py which uses `hookSpecificOutput` for PreToolUse).

---

## Open Questions

1. **Does exit 2 alone block without any JSON output?**
   - What we know: Official `security-guidance` plugin uses plain text to stderr + exit 2 (no JSON at all). Official `validate-write.sh` example uses `hookSpecificOutput` JSON on stderr + exit 2. Both use exit 2.
   - What's unclear: Whether the `hookSpecificOutput` JSON is required for Claude to show the block reason, or whether the stderr text message is sufficient.
   - Recommendation: Include both — stderr message for the block explanation, AND `hookSpecificOutput` JSON on stderr (not stdout) for completeness. This matches the `validate-write.sh` example precisely.

2. **macOS realpath -m availability**
   - What we know: `realpath -m` is GNU coreutils; macOS ships with BSD realpath which does NOT support `-m`.
   - What's unclear: Whether macOS `realpath` without `-m` will fail on new files.
   - Recommendation: Use the fallback pattern `$(cd "$(dirname "$f")" && pwd)/$(basename "$f")` for macOS compatibility, or guard with `realpath -m 2>/dev/null || python3 -c "import os,sys; print(os.path.abspath(sys.argv[1]))" "$RAW_FILE"`.

3. **ALLCLEAR_EXTRA_BLOCKED integration (CONF-04)**
   - What we know: CONF-04 requires the guard to load additional block patterns from `allclear.config.json`.
   - What's unclear: Whether Phase 5 implements this or defers to Phase 8 (Config Layer).
   - Recommendation: Wire the hook to read `ALLCLEAR_EXTRA_BLOCKED` as a simple env var for now (Phase 5); Phase 8 adds the config.json parsing to populate it.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | bats-core (bash automated testing system) |
| Config file | none — see Wave 0 |
| Quick run command | `bats tests/file-guard.bats` |
| Full suite command | `bats tests/` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| GRDH-01 | Hook fires on Edit/Write/MultiEdit PreToolUse | integration | `bats tests/file-guard.bats` | Wave 0 |
| GRDH-02 | Hard-blocks lock files | unit | `bats tests/file-guard.bats -f "hard-blocks.*lock"` | Wave 0 |
| GRDH-03 | Hard-blocks .env and credential files | unit | `bats tests/file-guard.bats -f "hard-blocks .env"` | Wave 0 |
| GRDH-04 | Hard-blocks generated dirs (node_modules, .venv, target) | unit | `bats tests/file-guard.bats -f "hard-blocks.*node_modules"` | Wave 0 |
| GRDH-05 | Soft-warns on migration files, exits 0 | unit | `bats tests/file-guard.bats -f "soft-warns on migration"` | Wave 0 |
| GRDH-06 | Soft-warns on generated code, exits 0 | unit | `bats tests/file-guard.bats -f "soft-warns on generated"` | Wave 0 |
| GRDH-07 | Soft-warns on CHANGELOG, exits 0 | unit | `bats tests/file-guard.bats -f "CHANGELOG"` | Wave 0 |
| GRDH-08 | Block message contains explanation | unit | `bats tests/file-guard.bats -f "block message"` | Wave 0 |
| TEST-08 | Correct exit code 2 for PreToolUse blocking | unit | `bats tests/file-guard.bats -f "exit 2"` | Wave 0 |

### Sampling Rate
- **Per task commit:** `bats tests/file-guard.bats`
- **Per wave merge:** `bats tests/`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/file-guard.bats` — covers all GRDH-01 through GRDH-08 and TEST-08
- [ ] `tests/` directory — must exist at plugin root
- [ ] Framework install: `brew install bats-core` (macOS) or `apt-get install bats` (Linux) — verify with `bats --version`

---

## Sources

### Primary (HIGH confidence)
- `~/.claude/plugins/marketplaces/claude-plugins-official/plugins/plugin-dev/skills/hook-development/examples/validate-write.sh` — Official shell PreToolUse blocking example; confirms exit 2 + hookSpecificOutput JSON on stderr
- `~/.claude/plugins/marketplaces/claude-plugins-official/plugins/security-guidance/hooks/security_reminder_hook.py` — Live PreToolUse blocking plugin; confirms exit 2 + plain stderr message
- `~/.claude/plugins/marketplaces/claude-plugins-official/plugins/hookify/core/rule_engine.py` — Confirms `hookSpecificOutput.permissionDecision: "deny"` JSON schema for PreToolUse blocks
- `~/.claude/plugins/marketplaces/claude-plugins-official/plugins/security-guidance/hooks/hooks.json` — Confirms `"matcher": "Edit|Write|MultiEdit"` is the correct hooks.json matcher for file write guards
- `~/.claude/plugins/marketplaces/claude-plugins-official/plugins/plugin-dev/skills/hook-development/scripts/validate-hook-schema.sh` — Confirms valid event names including PreToolUse; confirms timeout field; confirms command type
- `.planning/research/ARCHITECTURE.md` — AllClear architectural patterns; PreToolUse file-guard data flow
- `.planning/research/PITFALLS.md` — Critical: Pitfall 9 documents PreToolUse vs PostToolUse schema confusion; Security section documents path normalization requirement

### Secondary (MEDIUM confidence)
- `.planning/REQUIREMENTS.md` — GRDH-01 through GRDH-08 requirement text; TEST-03, TEST-08 bats requirements
- `.planning/STATE.md` — Decision: guard is blocking (exit 2 for PreToolUse deny); CONF-02 and CONF-04 env var toggle requirements

### Tertiary (LOW confidence)
- None — all critical claims verified with official source inspection.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — bash/jq/realpath are confirmed tools; no library selection ambiguity
- Architecture: HIGH — confirmed from live plugin inspection (security-guidance, hookify, validate-write.sh)
- Pitfalls: HIGH — sourced from official examples and project-specific PITFALLS.md with real patterns

**Research date:** 2026-03-15
**Valid until:** 2026-06-15 (stable Claude Code hook protocol; unlikely to change)
