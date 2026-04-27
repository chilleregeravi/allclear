---
description: Reconcile local scans with Arcanon Hub — push the current repo's latest scan, then drain the offline queue. Supports upload-only, drain-only, single-repo, dry-run, and force modes.
allowed-tools: Bash
argument-hint: "[--offline | --drain | --dry-run | --force] [--repo <path>] [--limit N] [--prune-dead]"
---

# Arcanon Sync

Unified reconciliation command. Absorbs the old `/arcanon:upload` verb: the default (no flags) runs upload-then-drain, which is what most users want after finishing a scan.

## Help short-circuit

```bash
source ${CLAUDE_PLUGIN_ROOT}/lib/help.sh
arcanon_print_help_if_requested "$ARGUMENTS" "${CLAUDE_PLUGIN_ROOT}/commands/sync.md" && exit 0
```

## Flags

| Flag | Effect |
| --- | --- |
| `--offline` | Skip ALL hub interaction. Print "scan persisted locally — offline mode" and exit 0. Use when you intentionally don't want to talk to the hub (air-gapped network, no credentials configured, dev machine offline). Distinct from "hub unreachable" — the latter still attempts upload, queues on failure. |
| *(none)* | Upload the current repo's latest scan, then drain the offline queue. |
| `--drain` | Skip the upload step and only drain the queue (legacy `sync` behaviour). |
| `--repo <path>` | Scope the upload step to a specific repo path instead of `$PWD`. |
| `--dry-run` | Print what would be pushed/drained without making any hub calls. |
| `--force` | Skip the missing-credentials preflight — fail with a hub error instead of a friendly stop. Use only in CI where you know the env is set. |
| `--limit N` | Cap queue drain to N rows per call (default 50). Passed through to `hub.sh sync`. |
| `--prune-dead` | Delete `status='dead'` rows before draining. Passed through to `hub.sh sync`. |

## Orchestration

### Step 0 — Parse args

Identify whether `--drain` is present (skip upload), whether `--dry-run` is present (no hub calls), and whether `--offline` is present (skip ALL hub interaction). Extract `--repo <path>` into `REPO_PATH` (default `$PWD`). Remaining args (`--limit`, `--prune-dead`, `--project`, etc.) pass through to the underlying `hub.sh` call unchanged.

### Step 0.5 — `--offline` short-circuit (NEW)

If `--offline` is present:

- If `--drain` is also present: print `arcanon:sync: --offline and --drain are mutually exclusive (offline implies no hub calls; --drain only makes sense online)` to stderr and exit 2.
- If `--dry-run` is also present: print `would skip all hub interaction (offline mode)` to stdout and exit 0.
- Otherwise: print `scan persisted locally — offline mode (no upload or drain attempted).` to stdout and exit 0.

Do NOT invoke `bash ${CLAUDE_PLUGIN_ROOT}/scripts/hub.sh` in any form when `--offline` is set. The point of offline mode is "the hub may not exist, behave as if it doesn't."

### Step 1 — Preflight (skipped when `--force` or `--drain` is set)

Run `bash ${CLAUDE_PLUGIN_ROOT}/scripts/hub.sh status --json` and inspect:
- `credentials` field — if `"missing"`, walk the user through the login flow (see below) and stop. Do not proceed to upload.
- `queue.pending` count — for context only; still proceed whether non-zero.

If credentials are missing, print verbatim:

> Arcanon Hub uses an API key (starts with `arc_`) for uploads. To get one:
> 1. Sign in at https://app.arcanon.dev (or sign up).
> 2. Open Settings → API keys and create a key. *Note: deep-linking to `/settings/api-keys` while signed out lands on `/home` after login — known issue THE-1016, navigate manually.*
> 3. Run `/arcanon:login arc_…` to store the key locally.
>
> Then re-run `/arcanon:sync`.

Exit here. Do not invoke `hub.sh upload` without credentials unless `--force` was passed.

### Step 2 — Upload step (skipped when `--drain` is set)

If `--dry-run`, print `would upload: <REPO_PATH> (skipping — dry run)` and continue to Step 3.

Otherwise run:

```bash
bash ${CLAUDE_PLUGIN_ROOT}/scripts/hub.sh upload --repo "$REPO_PATH" $FORWARDED_ARGS
```

The CLI wraps the local findings in `ScanPayloadV1`, POSTs with exponential backoff, and prints either `✓ uploaded (scan_upload_id=…)` or `⚠ upload failed, enqueued for retry (#…)`. Relay stdout verbatim. On `✗ upload failed` (non-retriable), stop — do not drain a queue that has a fresh dead row the user should inspect.

### Step 3 — Drain step

If `--dry-run`, run `bash ${CLAUDE_PLUGIN_ROOT}/scripts/hub.sh queue` and summarise how many rows are due.

Otherwise run:

```bash
bash ${CLAUDE_PLUGIN_ROOT}/scripts/hub.sh sync $FORWARDED_ARGS
```

The CLI prints `drain: attempted=N succeeded=K failed=M dead=D (pending=P)`. Interpretation:
- `succeeded` rows are removed from the queue.
- `failed` rows reschedule with exponential backoff (30s → 6h).
- `dead` rows hit MAX_ATTEMPTS (5) or a non-retriable error (e.g. 422) and stay in the queue — run `/arcanon:status` to see them.

## Examples

| Intent | Command |
| --- | --- |
| "I just scanned — push + drain." | `/arcanon:sync` |
| "Queue drained — don't re-upload." | `/arcanon:sync --drain` |
| "Upload this other repo too." | `/arcanon:sync --repo ../api` |
| "What would happen if I ran sync?" | `/arcanon:sync --dry-run` |
| "Clear dead rows and drain." | `/arcanon:sync --drain --prune-dead` |
| "I'm offline (or no hub configured) — just ack." | `/arcanon:sync --offline` |

## Migration note — `/arcanon:upload` Deprecated

Prior to v0.1.1, manual pushes used `/arcanon:upload`. That command still exists in v0.1.1 as a Deprecated stub that forwards to `/arcanon:sync` with a stderr warning. It will be removed in v0.2.0 — update scripts and runbooks now.

## Help

**Usage:** `/arcanon:sync [--drain | --dry-run | --force] [--repo <path>] [--limit N] [--prune-dead]`

Reconcile local scans with Arcanon Hub. Default (no flags) uploads the current
repo's latest scan, then drains the offline retry queue.

**Options:**
- `--drain` — skip the upload step, only drain the queue (legacy `sync` behaviour)
- `--repo <path>` — scope the upload step to a specific repo path instead of `$PWD`
- `--dry-run` — print what would be pushed/drained without making any hub calls
- `--force` — skip the missing-credentials preflight; fail with hub error instead of friendly stop
- `--limit N` — cap queue drain to N rows per call (default 50)
- `--prune-dead` — delete `status='dead'` rows before draining
- `--help`, `-h`, `help` — print this help and exit

**Examples:**
- `/arcanon:sync` — "I just scanned — push + drain"
- `/arcanon:sync --drain` — "Queue drained — don't re-upload"
- `/arcanon:sync --repo ../api` — "Upload this other repo too"
- `/arcanon:sync --dry-run` — "What would happen if I ran sync?"
- `/arcanon:sync --drain --prune-dead` — "Clear dead rows and drain"
