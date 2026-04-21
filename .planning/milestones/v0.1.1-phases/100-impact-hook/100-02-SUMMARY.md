---
phase: 100-impact-hook
plan: "02"
subsystem: impact-hook
tags: [bash, hook, pre-tool-use, tier1, self-exclusion, debug-trace]
dependency_graph:
  requires:
    - plugins/arcanon/lib/db-path.sh (from 100-01)
    - plugins/arcanon/lib/data-dir.sh (from 100-01)
  provides:
    - plugins/arcanon/scripts/impact-hook.sh (Tier 1 skeleton)
    - TIER_2_ANCHOR insertion point for plan 100-03
  affects:
    - plans/100-03 (layers Tier 2 SQLite + consumer HTTP query on top of this skeleton)
    - hooks.json runtime order (file-guard.sh → impact-hook.sh)
tech_stack:
  added: []
  patterns:
    - PreToolUse soft-warn pattern (systemMessage + exit 0, never exit 2)
    - _ms_now() portable millisecond timer (validates date +%s%3N; python3 fallback for macOS BSD date)
    - Self-exclusion guard via CLAUDE_PLUGIN_ROOT prefix match
    - Error-swallowing exit discipline (every failure path exits 0)
    - TIER_2_ANCHOR comment for plan-level insertion points
key_files:
  created:
    - plugins/arcanon/scripts/impact-hook.sh
  modified:
    - plugins/arcanon/hooks/hooks.json
decisions:
  - "Emit systemMessage + exit 0 for Tier 1 hits (confirmed from pre-flight Finding 1)"
  - "_ms_now() validates date +%s%3N output as purely numeric before trusting it (macOS BSD date exits 0 with garbage like '17768000553N')"
  - "Self-exclusion uses ${CLAUDE_PLUGIN_ROOT%/}/ prefix match — trailing slash normalized to prevent false matches"
  - "source errors on lib/*.sh exit 0 silently — hook must never break Claude Code edit flow"
  - "TIER_2_ANCHOR comment placed between Tier 1 block and default silent exit — Plan 03 inserts without scanning"
metrics:
  duration: "~139s"
  completed: "2026-04-21"
  tasks_completed: 2
  files_created: 1
  files_modified: 1
---

# Phase 100 Plan 02: impact-hook.sh Skeleton Summary

One-liner: Pure-bash PreToolUse hook skeleton with Tier 1 schema-file classification, self-exclusion, JSONL debug trace, and hooks.json registration — wired and verified, Tier 2 SQLite deferred to Plan 03.

## What Was Built

### Task 1: plugins/arcanon/scripts/impact-hook.sh (163 lines)

New executable hook script following `file-guard.sh` shape exactly. Key sections:

| Section | Lines | Behavior |
|---------|-------|----------|
| `_ms_now()` helper | top | Portable ms timer; validates `date +%s%3N` output as numeric before use |
| `ARCANON_DISABLE_HOOK` guard | early | HOK-11 escape hatch — exits 0 silently before any stdin read |
| `--self-test` flag | early | Smoke check without stdin; prints `impact-hook.sh self-test: ok` to stderr |
| Source lib helpers | early | Sources `data-dir.sh` + `db-path.sh`; source errors exit 0 (HOK-09) |
| `_debug_trace()` | helper | ARCANON_IMPACT_DEBUG=1 appends JSONL to `$DATA_DIR/logs/impact-hook.jsonl` (HOK-10) |
| stdin parse | body | `jq -r '.tool_input.file_path // .tool_input.path // empty'`; mirrors file-guard.sh line 24 |
| Path normalization | body | `realpath -m` (GNU) with macOS fallback; mirrors file-guard.sh lines 34-42 |
| Self-exclusion | body | HOK-07: file under `${CLAUDE_PLUGIN_ROOT%/}/` → exit 0 silently |
| Tier 1 match | body | HOK-02: `case` on BASENAME — `*.proto`, `openapi.{yaml,yml,json}`, `swagger.{yaml,yml,json}` |
| TIER_2_ANCHOR | comment | Plan 03 insertion point — do not delete |
| Default | tail | `_debug_trace` + exit 0 silently |

### Task 2: plugins/arcanon/hooks/hooks.json

Added `impact-hook.sh` as the second hook entry in the `PreToolUse` `Write|Edit|MultiEdit` matcher, after `file-guard.sh`.

**Before:**
```json
"PreToolUse": [
  { "matcher": "Write|Edit|MultiEdit", "hooks": [
    { "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/scripts/file-guard.sh", "timeout": 10 }
  ]}
]
```

**After:**
```json
"PreToolUse": [
  { "matcher": "Write|Edit|MultiEdit", "hooks": [
    { "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/scripts/file-guard.sh", "timeout": 10 },
    { "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/scripts/impact-hook.sh", "timeout": 10 }
  ]}
]
```

Order is load-bearing: `file-guard.sh` can hard-block (exit 2), which short-circuits the hook chain so `impact-hook.sh` never sees blocked edits.

## Smoke-Test Evidence

### Case 1: Tier 1 fire (*.proto)
```
$ echo '{"tool_name":"Write","tool_input":{"file_path":"/tmp/api.proto"}}' \
    | bash plugins/arcanon/scripts/impact-hook.sh
{"systemMessage": "Arcanon: schema file api.proto edited — cross-repo consumers may be impacted. Run /arcanon:impact for details."}
exit: 0
```

### Case 2: Self-exclusion (CLAUDE_PLUGIN_ROOT=/tmp/plug, file inside root)
```
$ CLAUDE_PLUGIN_ROOT=/tmp/plug bash -c \
    'echo "{...file_path: /tmp/plug/a.proto...}" | bash impact-hook.sh'
[no stdout]
exit: 0
```

### Case 3: ARCANON_DISABLE_HOOK=1
```
$ ARCANON_DISABLE_HOOK=1 bash -c \
    'echo "{...file_path: /tmp/api.proto...}" | bash impact-hook.sh'
[no stdout]
exit: 0
```

### Case 4: --self-test
```
$ bash plugins/arcanon/scripts/impact-hook.sh --self-test
impact-hook.sh self-test: ok  [stderr]
exit: 0
```

### Case 5: ARCANON_IMPACT_DEBUG=1 trace
```
$ ARCANON_DATA_DIR=/tmp/arcanon-test ARCANON_IMPACT_DEBUG=1 bash -c \
    'echo "{...api.proto...}" | bash impact-hook.sh'
# /tmp/arcanon-test/logs/impact-hook.jsonl appended:
{"ts":"2026-04-21T19:34:38Z","file":"/tmp/api.proto","classified":true,"service":null,"consumer_count":null,"latency_ms":73}
```

### Case 6: All 7 Tier 1 patterns fire
api.proto, openapi.yaml, openapi.yml, openapi.json, swagger.yaml, swagger.yml, swagger.json — all emitted systemMessage.

### Case 7: Bad JSON / internal error — always exit 0
```
$ echo "bad json{{" | bash impact-hook.sh
exit: 0
```

## TIER_2_ANCHOR Confirmation

```
$ grep "TIER_2_ANCHOR" plugins/arcanon/scripts/impact-hook.sh
# <TIER_2_ANCHOR — do not delete; Plan 03 inserts Tier 2 + consumer query here>
```

Present at correct location: after Tier 1 block, before default silent exit.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed macOS BSD date +%s%3N returning garbage string**
- **Found during:** Task 1 smoke testing (debug trace test)
- **Issue:** macOS BSD `date +%s%3N` exits 0 but returns `17768000553N` (the `%3N` is unrecognized and appended literally). The `|| python3 fallback` never triggered because exit code was 0. The `$(( _t1_ms - _t0_ms ))` arithmetic then failed with "value too great for base", preventing JSONL trace from being written.
- **Fix:** Introduced `_ms_now()` helper that validates the `date` output with `[[ "$_v" =~ ^[0-9]+$ ]]` before trusting it; falls back to `python3 -c 'import time;print(int(time.time()*1000))'` when the check fails.
- **Files modified:** `plugins/arcanon/scripts/impact-hook.sh`
- **Commit:** 7a05243 (included in same Task 1 commit — discovered during same smoke test pass)

## Known Stubs

The Tier 1 `systemMessage` is intentionally a skeleton: it emits a generic "cross-repo consumers may be impacted" message without real consumer data. Plan 03 replaces this block with actual SQLite Tier 2 matching + `/impact` HTTP consumer query. Documented in the `TIER_2_ANCHOR` comment and the systemMessage text itself ("Run /arcanon:impact for details").

This stub is intentional per the plan's objective ("Prove the hook fires on the hottest path...isolates the 'does the hook wire up correctly?' question from the 'does consumer enrichment work?' question").

## Threat Surface

No new network endpoints or auth paths introduced. STRIDE mitigations T-100-04 through T-100-08 are implemented:
- T-100-04 (stdin tampering): `jq -r '... // empty' 2>/dev/null` — malformed JSON → empty string → silent exit 0.
- T-100-05 (injection via FILE): FILE is only used in `case` glob match and `printf '%s'`; never interpolated into shell-exec context.
- T-100-06 (DoS via debug write): `mkdir -p ... || return 0` + `>> ... || true` — log failure never fails the hook.
- T-100-07/T-100-08: accepted per threat register.

## Self-Check: PASSED
