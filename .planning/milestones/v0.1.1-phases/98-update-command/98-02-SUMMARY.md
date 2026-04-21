# 98-02 — Confirmation + kill-only + reinstall

**Status:** COMPLETE (checkpoint approved without manual run-through)
**Plan:** 98-02
**Tasks:** 3/3 auto tasks landed; checkpoint:human-verify task accepted on code + test evidence alone.

## Commits
- `76cc814` — feat(98-02): implement --kill mode (SIGTERM→5s→SIGKILL, kill-only)
- `8b64c70` — feat(98-02): wire confirmation + reinstall into commands/update.md
- `dbf11da` — test(98-02): extend update.bats with scan-lock/kill/no-restart tests

## Requirements satisfied
- UPD-05: confirmation defaults No (`[y/N]` prompt, only `y`/`yes` proceeds)
- UPD-06: reinstall via `claude plugin update arcanon --scope user` (no `--yes` flag exists per 98-01 pre-flight)
- UPD-07: scan-lock check before kill via `$ARCANON_DATA_DIR/scan.lock` + worker HTTP `/api/status`
- UPD-08: kill-only semantics (SIGTERM → 5s wait → SIGKILL); bats test greps that `restart_worker_if_stale` and `worker_start_background` do NOT appear in `update.sh`

## Verification
- bats: 15/15 pass on extended update.bats
- Grep regression: `! grep -q 'restart_worker_if_stale' scripts/update.sh && ! grep -q 'worker_start_background' scripts/update.sh`
- Scan-lock guard tested via fixture lock file

## Checkpoint outcome
User approved checkpoint without executing the manual run-through in a live Claude Code session. Decision documented here for traceability. Risk accepted: any edge-case in interactive `claude plugin update` flow (when it prompts without `--yes`) is unverified against a real session and would surface on first real-user invocation.

## Follow-up work owned by 98-03
- Cache pruning (lsof-guarded)
- Post-update health poll (`/api/version` for 10s)
- Final "Restart Claude Code to activate v{newver}" message
