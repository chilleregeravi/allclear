---
description: Stage a correction to scan findings (insert into scan_overrides). Override is queued, not applied — the next /arcanon:map or /arcanon:rescan run consumes it via Phase 117's apply hook. Per invocation, exactly one override row is written.
argument-hint: "connection|service --action delete|update|rename|set-base-path [--connection <id> | --service <name>] [--source <svc>] [--target <svc>] [--new-name <name>] [--base-path <path>] [--json]"
allowed-tools: Bash
---

# Arcanon Correct — Stage Scan Overrides

Operator-driven corrections to the scan graph. Each invocation inserts one
row into `scan_overrides`. The override is **queued, not applied** — Phase
117's `applyPendingOverrides` hook consumes it on the next scan run, between
`persistFindings` and `endScan`.

Use `/arcanon:correct` when:

- `/arcanon:verify` flagged drift you want to silence persistently.
- A connection is misclassified (wrong source/target service).
- A service is misnamed or rooted at the wrong base path.
- You want to drop a phantom connection without re-running the full scanner.

## When NOT to use

- For one-off audits — use `/arcanon:verify` (read-only).
- To re-run the scanner — use `/arcanon:map` or `/arcanon:rescan`.
- The override fires on the **next** scan; this command does not mutate
  `connections` or `services` directly.

## Usage

| Invocation | What gets staged |
| --- | --- |
| `/arcanon:correct connection --action delete --connection <id>` | Drops the connection on next scan. |
| `/arcanon:correct connection --action update --connection <id> --source <svc> --target <svc>` | Repoints the connection's source/target service. |
| `/arcanon:correct service --action rename --service <name> --new-name <name>` | Renames the service on next scan. |
| `/arcanon:correct service --action set-base-path --service <name> --base-path <path>` | Updates `services.base_path` on next scan. |

Append `--json` to any invocation for `{ok, override_id, kind, target_id, action, payload}`.

### Target resolution

- Connections are resolved by **integer ID** (`--connection 5`). Find the ID
  via `/arcanon:list` or `/arcanon:diff <a> <b>`.
- Services are resolved by **name** (`--service auth-api`). If the name is
  ambiguous (multiple repos use it), the command exits 2 and lists every
  match by `(id, repo, root_path)` so you can disambiguate by id later. (A
  future plan will accept `--service-id <int>` directly.)

### Action × kind matrix

| kind \ action | delete | update | rename | set-base-path |
| --- | --- | --- | --- | --- |
| `connection` | ✓ | ✓ | — | — |
| `service` | — | — | ✓ | ✓ |

Mismatches (e.g. `connection --action rename`) exit 2 with a friendly error.

## Exit codes

- `0` — override staged, row inserted into `scan_overrides`.
- `2` — usage error: invalid kind, invalid action, action/kind mismatch,
  missing required flag, target not found, ambiguous service name.

Silent (no output, exit 0) when run from a directory without an
`impact-map.db` — same contract as `/arcanon:list`, `/arcanon:doctor`, and
`/arcanon:diff`.

## Step 1 — Detect worker / project

```bash
source ${CLAUDE_PLUGIN_ROOT}/lib/help.sh
arcanon_print_help_if_requested "$ARGUMENTS" "${CLAUDE_PLUGIN_ROOT}/commands/correct.md" && exit 0
source ${CLAUDE_PLUGIN_ROOT}/lib/worker-client.sh
if ! _arcanon_is_project_dir; then
  exit 0  # silent in non-Arcanon directories per the CORRECT-02 contract
fi
```

## Step 2 — Stage the override

```bash
bash ${CLAUDE_PLUGIN_ROOT}/scripts/hub.sh correct $ARGUMENTS
```

The handler validates the argument matrix, resolves the target, builds the
per-action payload, and inserts via Phase 117-01's `qe.upsertOverride`. The
human output line is:

> `correct: queued (override_id=<id>) — kind=<k>, target_id=<t>, action=<a>`
> `Apply on next /arcanon:map or /arcanon:rescan run.`

## Step 3 — Apply

This command does **not** apply the override. Two ways to consume it:

1. Run `/arcanon:map` — the scan pipeline calls `applyPendingOverrides`
   between `persistFindings` and `endScan`, applying every pending row and
   stamping `applied_in_scan_version_id`. (Phase 117-02.)
2. Run `/arcanon:rescan` once it ships in plan 118-02 — explicit re-scan
   trigger, same apply-hook code path.

Until then the override row sits with `applied_in_scan_version_id=NULL`. You
can inspect pending overrides directly via:

```bash
sqlite3 "$HOME/.arcanon/projects/<hash>/impact-map.db" \
  "SELECT override_id, kind, target_id, action, payload FROM scan_overrides WHERE applied_in_scan_version_id IS NULL"
```

## Help

**Usage:** `/arcanon:correct connection|service --action <action> [target-flags] [payload-flags] [--json]`

Stage a correction to the scan findings. Inserts one row into
`scan_overrides`. Apply happens on the next `/arcanon:map` or
`/arcanon:rescan` run.

**Options:**
- `--action <delete|update|rename|set-base-path>` — required; cross-validated against kind
- `--connection <id>` — connection target (positive integer)
- `--service <name>` — service target (resolved by name; exits 2 if ambiguous)
- `--source <svc>` / `--target <svc>` — for `connection --action update`
- `--new-name <name>` — for `service --action rename`
- `--base-path <path>` — for `service --action set-base-path`
- `--json` — emit `{ok, override_id, kind, target_id, action, payload}`
- `--help`, `-h`, `help` — print this help and exit

**Examples:**
- `/arcanon:correct connection --action delete --connection 5`
- `/arcanon:correct connection --action update --connection 5 --source auth-api --target user-svc`
- `/arcanon:correct service --action rename --service api --new-name auth-api`
- `/arcanon:correct service --action set-base-path --service api --base-path src/api`
- `/arcanon:correct connection --action delete --connection 5 --json`
