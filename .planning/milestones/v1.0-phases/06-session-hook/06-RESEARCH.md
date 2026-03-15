# Phase 6: Session Hook - Research

**Researched:** 2026-03-15
**Domain:** Claude Code SessionStart + UserPromptSubmit hooks, deduplication, context injection
**Confidence:** HIGH — verified via official Claude Code docs + confirmed open upstream issues

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SSTH-01 | Session start hook fires on SessionStart with UserPromptSubmit fallback for brand-new sessions (upstream bug #10373) | Bug confirmed open as of 2026-03-15; UserPromptSubmit fallback is the required workaround. Both events must be registered in hooks.json. |
| SSTH-02 | Hook detects project type and displays available allclear commands | lib/detect.sh from Phase 2 provides `detect_project_type`; hook calls it against cwd. Command list is static per detected type(s). |
| SSTH-03 | Hook is lightweight — checks files only, no tool execution | Manifest file stat checks only; no subprocess forks to run linters/formatters. |
| SSTH-04 | Hook can be disabled via ALLCLEAR_DISABLE_SESSION_START environment variable | Standard `[[ -n "${ALLCLEAR_DISABLE_SESSION_START:-}" ]] && exit 0` guard at script top. |
| SSTH-05 | Hook deduplicates — if both SessionStart and UserPromptSubmit fire, context is injected only once | session_id tmpfile pattern: write `/tmp/allclear_session_${SESSION_ID}.initialized` on first execution; skip on subsequent calls within same session. |
</phase_requirements>

---

## Summary

Phase 6 implements `scripts/session-start.sh`, a lightweight bash script that fires on `SessionStart` and, as a fallback, on `UserPromptSubmit`. Both hooks are registered in `hooks/hooks.json`. When either fires, the script detects the project type from manifest files in cwd, constructs a short context message listing available allclear commands, and outputs it as `hookSpecificOutput.additionalContext` JSON on stdout.

The critical complexity in this phase is the upstream bug #10373 (still open as of 2026-03-15): `SessionStart` hooks do **not fire on brand-new sessions** — only on `/clear`, `/compact`, and `--resume`. The UserPromptSubmit fallback bridges this gap. Because both events may fire in quick succession (e.g., a session resumed by /clear followed immediately by a user prompt), deduplication is mandatory. The correct approach is a session-scoped tmpfile: on first execution within a session, write `/tmp/allclear_session_${SESSION_ID}.initialized` and emit context; on every subsequent call, detect the file, skip emission, and exit 0 silently.

There is a separate confirmed bug (#12151, open as of 2026-03-15) where plugin-registered `UserPromptSubmit` hook **output is silently discarded** even when the hook executes. This means the fallback may not inject context even when it fires. The mitigation strategy is to build both paths fully and correctly — if Anthropic fixes the output bug, the fallback works automatically — and document the limitation clearly. The hook must never block or error; all paths exit 0.

**Primary recommendation:** Register both `SessionStart` and `UserPromptSubmit` in `hooks/hooks.json`. Use session_id tmpfile deduplication inside `scripts/session-start.sh`. Accept plugin output bug as a known limitation and document it.

---

## Standard Stack

### Core

| Library / Tool | Version | Purpose | Why Standard |
|----------------|---------|---------|--------------|
| bash | 3.2+ (macOS ships 3.2) | Hook script language | All prior hooks in this plugin use bash; consistent with PLGN-07 jq pattern |
| jq | any | Parse stdin JSON (session_id, cwd, source) | Already required by PLGN-07 |
| lib/detect.sh | (project, Phase 2) | Detect project type from manifest files | Established shared library; do not duplicate logic |

### Supporting

| Library / Tool | Version | Purpose | When to Use |
|----------------|---------|---------|-------------|
| CLAUDE_ENV_FILE | (runtime env var) | Persist session_id to env for downstream Bash tool calls | Optional; write `export ALLCLEAR_SESSION_ID=...` here if cross-hook state sharing is needed later |
| /tmp | OS-provided | Session deduplication tmpfiles | Use `/tmp/allclear_session_${SESSION_ID}.initialized` as the flag |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| tmpfile flag in /tmp | CLAUDE_ENV_FILE + env var check | CLAUDE_ENV_FILE only bridges from hooks into Bash tool commands; it doesn't prevent re-execution of the hook script itself. Tmpfile is simpler and more reliable for deduplication. |
| tmpfile flag in /tmp | .claude/ directory flag | .claude/ may not exist in all project directories; /tmp is always writable |
| Both events in hooks.json | UserPromptSubmit only | SessionStart is the correct event when the bug is fixed; keeping both means the fix is transparent |

**Installation:** No new dependencies. bash and jq are required by Phase 2 already.

---

## Architecture Patterns

### Recommended Script Structure

```
scripts/
└── session-start.sh    # handles both SessionStart and UserPromptSubmit events
hooks/
└── hooks.json          # registers SessionStart + UserPromptSubmit → session-start.sh
```

### Pattern 1: Dual-Event Registration in hooks.json

**What:** Register the same script for both `SessionStart` and `UserPromptSubmit` in `hooks/hooks.json`. The script reads `hook_event_name` from stdin to know which event fired.

**When to use:** Any time a hook needs to work around the SessionStart new-session bug.

**Example:**
```json
{
  "description": "AllClear plugin hooks",
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/scripts/session-start.sh",
            "timeout": 10
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/scripts/session-start.sh",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

Note: The other hooks (format, lint, guard) are registered at the same level in hooks.json. Phase 6 adds the two new entries without replacing existing ones.

### Pattern 2: Session-Scoped Tmpfile Deduplication

**What:** On entry, extract `session_id` from stdin JSON. Check for `/tmp/allclear_session_${SESSION_ID}.initialized`. If it exists, exit 0 silently (already ran this session). If absent, create it and proceed with context emission.

**When to use:** Any hook registered on multiple events that should only fire once per session.

**Example:**
```bash
#!/usr/bin/env bash
# Source: official Claude Code hooks reference + session isolation pattern (jonroosevelt.com)
set -euo pipefail

# Early exit if disabled
[[ -n "${ALLCLEAR_DISABLE_SESSION_START:-}" ]] && exit 0

INPUT=$(cat)
SESSION_ID=$(printf '%s\n' "$INPUT" | jq -r '.session_id // empty')

# Deduplication: only inject once per session
if [[ -n "$SESSION_ID" ]]; then
  FLAG_FILE="/tmp/allclear_session_${SESSION_ID}.initialized"
  if [[ -f "$FLAG_FILE" ]]; then
    exit 0  # already ran for this session
  fi
  touch "$FLAG_FILE"
fi

CWD=$(printf '%s\n' "$INPUT" | jq -r '.cwd // empty')
[[ -z "$CWD" ]] && CWD="$PWD"

# Source shared detection library
# shellcheck source=lib/detect.sh
source "${CLAUDE_PLUGIN_ROOT}/lib/detect.sh"

PROJECT_TYPES=$(detect_project_type "$CWD")

# Build context message
CONTEXT="AllClear active."
if [[ -n "$PROJECT_TYPES" ]]; then
  CONTEXT="AllClear active. Detected: ${PROJECT_TYPES}."
fi
CONTEXT="${CONTEXT} Commands: /allclear (quality gate), /allclear impact (cross-repo), /allclear drift, /allclear pulse, /allclear deploy."

EVENT=$(printf '%s\n' "$INPUT" | jq -r '.hook_event_name // empty')

# Output format: hookSpecificOutput.additionalContext
# hookEventName must match the actual event that fired
printf '{"hookSpecificOutput":{"hookEventName":"%s","additionalContext":"%s"}}' \
  "$EVENT" \
  "$(printf '%s' "$CONTEXT" | jq -Rs .)"

exit 0
```

### Pattern 3: Lightweight Project Detection (Files Only)

**What:** SSTH-03 requires no tool execution. The session-start hook must only stat files (pyproject.toml, Cargo.toml, package.json, go.mod) — never run formatters, linters, or any subprocess. `lib/detect.sh` already follows this pattern; the session hook just calls into it.

**When to use:** Always. SessionStart and UserPromptSubmit hooks have strict timeout constraints. Claude Code enforces a 10-second timeout per hook; file stat is microseconds, subprocess execution is unpredictable.

### Anti-Patterns to Avoid

- **Running linters/formatters in session hook:** Violates SSTH-03. PostToolUse hooks handle that. Session hook is context injection only.
- **Emitting context on every UserPromptSubmit:** Without deduplication, every prompt injects the AllClear banner into context, wasting context window tokens and annoying the user.
- **Using `additional_context` (snake_case) instead of `hookSpecificOutput.additionalContext`:** The old snake_case top-level field was a cross-platform artifact (Cursor vs Claude Code). Claude Code uses `hookSpecificOutput.additionalContext` only. The superpowers plugin had a bug from using both simultaneously.
- **Hard-coding the hookEventName in the JSON output:** Both SessionStart and UserPromptSubmit call the same script. The `hookEventName` field in the output must match what fired, read dynamically from `hook_event_name` in stdin.
- **Blocking on failure:** The session hook must always exit 0. A detection failure (e.g., jq not found) should silently exit 0 rather than block the session.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Project type detection | Custom manifest inspection in session-start.sh | `lib/detect.sh` (Phase 2) | Centralised, tested, already used by format/lint hooks; duplication causes drift |
| Session ID scoping | Custom session tracking (PIDs, timestamps, home dir flags) | `session_id` from hook stdin JSON | Claude Code provides a stable per-session UUID; use it; PID-based approaches break on forked processes |
| JSON output construction | String concatenation | `jq -Rs .` for escaping string values | Manual escaping breaks on filenames or project names with quotes, backslashes, newlines |

**Key insight:** Session-scoping logic already exists in the Claude Code runtime (session_id field). The hook script should consume it, not reinvent it.

---

## Common Pitfalls

### Pitfall 1: UserPromptSubmit Plugin Output Silently Discarded

**What goes wrong:** `scripts/session-start.sh` executes when registered under `UserPromptSubmit` in a plugin's `hooks.json`, but the hook's stdout is not passed to Claude's context. Confirmed open bug #12151 as of 2026-03-15.

**Why it happens:** The plugin hook execution pipeline in Claude Code is missing the step that captures stdout from plugin-registered UserPromptSubmit hooks and injects it into agent context. Non-plugin (settings.json) UserPromptSubmit hooks do not have this problem.

**How to avoid:** Cannot fully avoid with the plugin mechanism. Mitigation: implement the hook correctly (so it works automatically when Anthropic fixes the bug), test SessionStart path with `/clear` workaround, document the limitation in README, and do not block on this bug to ship Phase 6.

**Warning signs:** Running `/clear` works (SessionStart fires and context appears), but context doesn't appear on first prompt of a fresh session.

### Pitfall 2: Both Events Fire, Context Injected Twice

**What goes wrong:** On a `/clear` command, both `SessionStart` (source=clear) and potentially a following `UserPromptSubmit` fire in the same session. Without deduplication, the AllClear banner appears twice, wasting context tokens.

**Why it happens:** The two events are independent — Claude Code does not deduplicate across event types. The runtime only deduplicates identical commands within a single event type.

**How to avoid:** tmpfile pattern with `session_id` as the key. First execution creates the flag; second execution finds the flag and exits 0 silently.

**Warning signs:** Session context shows "AllClear active." banner twice in the transcript.

### Pitfall 3: hookEventName Mismatch in Output JSON

**What goes wrong:** Output JSON hardcodes `"hookEventName": "SessionStart"` but the script was triggered by `UserPromptSubmit`. Claude Code silently ignores the output because the declared event name doesn't match the calling event.

**Why it happens:** Copying boilerplate without reading `hook_event_name` from stdin.

**How to avoid:** Always read `EVENT=$(printf '%s\n' "$INPUT" | jq -r '.hook_event_name // empty')` and use `$EVENT` in the output JSON.

**Warning signs:** No context injection visible even though the script executes and exits 0.

### Pitfall 4: Empty or Missing cwd in Stub Sessions

**What goes wrong:** On some resume paths, `cwd` in the hook stdin JSON may be empty or the process may have changed directories. File detection fails silently.

**Why it happens:** Edge case in Claude Code session resumption; not every source type guarantees cwd.

**How to avoid:** Fall back to `$PWD` when `cwd` from JSON is empty. Detection failure should produce an empty project types list, not an error. Always exit 0.

**Warning signs:** `detect_project_type` returns empty string even in a known project directory on resume.

### Pitfall 5: Stale tmpfiles Across Sessions

**What goes wrong:** `/tmp/allclear_session_${SESSION_ID}.initialized` flag files accumulate in /tmp over time. Not a functional bug, but messy on developer machines.

**Why it happens:** Hooks write flag files but never clean them up (no SessionEnd hook).

**How to avoid:** This is acceptable — /tmp is ephemeral (cleared on reboot/OS cleanup). Document it. Do not implement manual cleanup; there is no reliable SessionEnd event in Claude Code.

**Warning signs:** Large number of `allclear_session_*.initialized` files in /tmp after weeks of use. (Not harmful; purely cosmetic.)

---

## Code Examples

Verified patterns from official sources:

### SessionStart stdin JSON (official schema)
```json
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../.claude/projects/.../session.jsonl",
  "cwd": "/Users/dev/myproject",
  "permission_mode": "default",
  "hook_event_name": "SessionStart",
  "source": "startup",
  "model": "claude-sonnet-4-6"
}
```
Source: https://code.claude.com/docs/en/hooks

### UserPromptSubmit stdin JSON (official schema)
```json
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../.claude/projects/.../session.jsonl",
  "cwd": "/Users/dev/myproject",
  "permission_mode": "default",
  "hook_event_name": "UserPromptSubmit",
  "prompt": "User's submitted prompt text"
}
```
Source: https://code.claude.com/docs/en/hooks

### additionalContext Output (official schema)
```json
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "Context string injected into Claude's conversation"
  }
}
```
Source: https://code.claude.com/docs/en/hooks

### Deduplication Flag File Pattern
```bash
# Source: session isolation pattern from jonroosevelt.com, verified against official session_id docs
SESSION_ID=$(printf '%s\n' "$INPUT" | jq -r '.session_id // empty')
if [[ -n "$SESSION_ID" ]]; then
  FLAG_FILE="/tmp/allclear_session_${SESSION_ID}.initialized"
  if [[ -f "$FLAG_FILE" ]]; then exit 0; fi
  touch "$FLAG_FILE"
fi
```

### CLAUDE_ENV_FILE Session Bridge (official pattern)
```bash
# Source: https://code.claude.com/docs/en/hooks — CLAUDE_ENV_FILE mechanism
# Write session_id into env for downstream Bash tool commands (optional)
if [[ -n "${CLAUDE_ENV_FILE:-}" ]]; then
  echo "export ALLCLEAR_SESSION_ID='${SESSION_ID}'" >> "$CLAUDE_ENV_FILE"
fi
```

### jq-safe Context String Escaping
```bash
# Source: established jq pattern from PLGN-07 convention
CONTEXT_JSON=$(printf '%s' "$CONTEXT" | jq -Rs .)
# CONTEXT_JSON is now a quoted, escaped JSON string value ready to embed
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `additional_context` (top-level snake_case key) | `hookSpecificOutput.additionalContext` (camelCase nested) | ~2025 Claude Code plugin system formalization | Old key still parsed on some paths but not reliable; use nested hookSpecificOutput |
| Hardcode `"hookEventName": "SessionStart"` | Read `hook_event_name` from stdin, use dynamically | Best practice since dual-event patterns emerged | Prevents silent discard when UserPromptSubmit triggers same script |
| Always inject on UserPromptSubmit | Inject once per session via session_id tmpfile | Community-discovered pattern 2025 | Prevents context window token waste from repeated banner injection |

**Deprecated/outdated:**
- `additional_context` (snake_case top-level): Use `hookSpecificOutput.additionalContext` only in Claude Code plugin context.
- Assuming SessionStart fires on brand-new sessions: Does not. Bug #10373 open as of 2026-03-15.

---

## Open Questions

1. **UserPromptSubmit plugin output bug (#12151)**
   - What we know: Plugin-registered UserPromptSubmit hooks execute but output is not passed to agent context; non-plugin settings.json hooks work correctly.
   - What's unclear: Whether Anthropic will fix this before AllClear v1 ships. Last activity on #12151 does not indicate imminent fix.
   - Recommendation: Implement both paths fully and correctly. Document the limitation in README. Test SessionStart path via `/clear` workaround. Accept that new-session fallback may be non-functional until upstream fix.

2. **SessionStart `source: startup` matcher reliability**
   - What we know: `source: startup` is documented as the matcher for new sessions. Bug #10373 means the hook fires but output is not processed.
   - What's unclear: Whether using a matcher `"startup"` in hooks.json prevents the hook from being registered for clear/compact sources. If only `startup` is matched, clear/compact resumptions won't benefit from it.
   - Recommendation: Register SessionStart without a source matcher (fires for all sources: startup, clear, compact, resume) so the fix is transparent when Anthropic patches the runtime. Alternatively, register with matcher for all four sources explicitly.

3. **lib/detect.sh availability at Phase 6 execution**
   - What we know: The phases are fully parallel. Phase 6 (session hook) depends on lib/detect.sh from Phase 2 (shared libraries).
   - What's unclear: Whether Phase 2 will be complete before Phase 6 is tested end-to-end.
   - Recommendation: Phase 6 plan must document the Phase 2 dependency. During development, stub detect.sh if Phase 2 is not yet merged.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | bats-core (TEST-04 requires bats coverage of session start hook) |
| Config file | tests/session-start.bats — does not exist yet (Wave 0 gap) |
| Quick run command | `bats tests/session-start.bats` |
| Full suite command | `bats tests/` |

### Phase Requirements to Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SSTH-01 | Script exits 0 when invoked with SessionStart stdin JSON | unit | `bats tests/session-start.bats -f "exits 0 on SessionStart"` | Wave 0 |
| SSTH-01 | Script exits 0 when invoked with UserPromptSubmit stdin JSON | unit | `bats tests/session-start.bats -f "exits 0 on UserPromptSubmit"` | Wave 0 |
| SSTH-01 | Script outputs additionalContext JSON on first call | unit | `bats tests/session-start.bats -f "emits additionalContext"` | Wave 0 |
| SSTH-02 | Output contains detected project type | unit | `bats tests/session-start.bats -f "includes project type"` | Wave 0 |
| SSTH-02 | Output contains allclear command list | unit | `bats tests/session-start.bats -f "includes command list"` | Wave 0 |
| SSTH-03 | Script does not invoke any external tool commands (only file stat) | unit | `bats tests/session-start.bats -f "lightweight file only"` | Wave 0 |
| SSTH-04 | Script exits 0 silently when ALLCLEAR_DISABLE_SESSION_START is set | unit | `bats tests/session-start.bats -f "disable env var"` | Wave 0 |
| SSTH-05 | Second call with same session_id emits no output | unit | `bats tests/session-start.bats -f "deduplicates same session"` | Wave 0 |
| SSTH-05 | Different session_id emits context again | unit | `bats tests/session-start.bats -f "new session gets context"` | Wave 0 |

### Sampling Rate

- **Per task commit:** `bats tests/session-start.bats`
- **Per wave merge:** `bats tests/`
- **Phase gate:** Full bats suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `tests/session-start.bats` — covers all SSTH-* requirements; needs mock `lib/detect.sh` stub or Phase 2 complete
- [ ] `tests/helpers/mock_detect.bash` — bats helper that stubs `detect_project_type` returning a fixed string for deterministic tests
- [ ] bats-core install: `brew install bats-core` (macOS) or `npm install -g bats` — if not already present from other test phases

---

## Sources

### Primary (HIGH confidence)
- https://code.claude.com/docs/en/hooks — SessionStart and UserPromptSubmit schemas, hookSpecificOutput.additionalContext format, hooks.json plugin configuration, CLAUDE_ENV_FILE mechanism
- https://github.com/anthropics/claude-code/issues/10373 — SessionStart new-session bug: confirmed open 2026-03-15, root cause documented, no fix shipped
- https://github.com/anthropics/claude-code/issues/12151 — UserPromptSubmit plugin output discarded bug: confirmed open 2026-03-15

### Secondary (MEDIUM confidence)
- https://jonroosevelt.com/blog/claude-code-session-isolation-hooks — session_id tmpfile deduplication pattern; verified pattern consistent with official session_id field documentation
- https://github.com/obra/superpowers/issues/648 — additionalContext vs additional_context field naming; confirmed fix via CLAUDE_PLUGIN_ROOT detection; resolved

### Tertiary (LOW confidence)
- https://claudefa.st/blog/tools/hooks/session-lifecycle-hooks — SessionStart hook patterns and CLAUDE_ENV_FILE usage; third-party, consistent with official docs
- https://github.com/anthropics/claude-code/issues/9602 — duplicate message bug (SessionStart/UserPromptSubmit) in older version; marked as regression, not directly applicable but confirms dual-event fragility

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — bash/jq pattern confirmed by all prior phases; lib/detect.sh is the established shared library
- Architecture (hooks.json dual registration): HIGH — verified against official hooks reference and live hookify plugin example
- Deduplication pattern: MEDIUM — session_id tmpfile approach is community-derived but aligns with official session_id documentation; no official blessed deduplication recipe
- Pitfalls (upstream bugs): HIGH — directly verified against official GitHub issues #10373 and #12151, both confirmed open

**Research date:** 2026-03-15
**Valid until:** 2026-04-15 for stable patterns; monitor #10373 and #12151 weekly — either bug fix changes implementation requirements
