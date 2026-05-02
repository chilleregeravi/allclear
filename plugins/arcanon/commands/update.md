---
description: Check for a newer Arcanon release and apply it cleanly.
allowed-tools: Bash
argument-hint: "[--check-only]"
---

# Arcanon Update

Check the installed plugin version against the latest on the Arcanon marketplace,
show a short changelog preview if there is one, and orchestrate a clean self-update.

**Current implementation status:** only the `--check` step is wired. Confirmation, kill, prune, and verify will arrive in subsequent patch releases.

## Pre-flight (one-time, during implementation)

Before writing any code, verify:

```bash
source ${CLAUDE_PLUGIN_ROOT}/lib/help.sh
arcanon_print_help_if_requested "$ARGUMENTS" "${CLAUDE_PLUGIN_ROOT}/commands/update.md" && exit 0
claude plugin update --help 2>&1 | grep -i -- '--yes'
```

- If `--yes` / `-y` exists: plan 98-02 can auto-confirm the reinstall step.
- If not: plan 98-02 instructs the user to approve the interactive prompt.

Record the result in the 98-01 SUMMARY so plan 98-02 knows which branch to wire.

## Step 1 — Check current vs. remote version

Run:

```bash
CHECK=$(bash "${CLAUDE_PLUGIN_ROOT}/scripts/update.sh" --check)
```

The script emits JSON with keys `status`, `installed`, `remote`, `update_available`, `changelog_preview`.

Possible `status` values and what to say to the user:

| status | Message |
|--------|---------|
| `equal` | `Arcanon v{installed} is the latest release.` — then stop. |
| `ahead` | `You're running v{installed}, which is ahead of the published v{remote}. Nothing to update.` — then stop. |
| `offline` | `Could not reach update server. Your current version is v{installed}.` — then stop. |
| `unknown` | `Could not determine a valid version comparison (installed={installed}, remote={remote}). No update applied.` — then stop. |
| `newer` | Render the changelog preview (Step 2) and tell the user plans 98-02/98-03 will add the apply flow. |

Extract fields with `jq`:

```bash
STATUS=$(printf '%s' "$CHECK" | jq -r '.status')
INSTALLED=$(printf '%s' "$CHECK" | jq -r '.installed')
REMOTE=$(printf '%s' "$CHECK" | jq -r '.remote')
PREVIEW=$(printf '%s' "$CHECK" | jq -r '.changelog_preview')
```

## Step 2 — Render changelog preview (only when `status=newer`)

Show exactly what's in `PREVIEW`. Do not summarize. If `PREVIEW` is empty (CHANGELOG had no bullets under the first section), fall back to:

> `Remote has v{remote}. No changelog preview available — see the project CHANGELOG for details.`

Otherwise:

> `Arcanon v{remote} is available. Changes:`
> `{PREVIEW verbatim, one bullet per line}`

## Step 3 — Ask for confirmation (default No)

Only reached when `status=newer`. Show the installed/remote/changelog summary, then ask:

> `Update Arcanon from v{INSTALLED} to v{REMOTE}? [y/N]`

Default is No. Only proceed if the user types `y` or `yes` (case-insensitive). Any other input — including empty — aborts with:

> `Update cancelled. No changes made.`

Wait for the user's literal response. Do NOT auto-proceed.

## Step 4 — Check for active scan and kill the worker

Run:

```bash
KILL_OUT=$(bash "${CLAUDE_PLUGIN_ROOT}/scripts/update.sh" --kill)
KILL_STATUS=$(printf '%s' "$KILL_OUT" | jq -r '.status')
```

Branch on `KILL_STATUS`:

| status | Action |
|--------|--------|
| `killed` | Proceed to Step 5. |
| `scan_in_progress` | Tell the user: `A scan is currently running. Finish or cancel it, then run /arcanon:update again.` Then stop — do NOT continue. |

Never proceed to reinstall while a scan is running.

## Step 5 — Run the plugin reinstall

**Note:** Pre-flight validation (recorded in 98-01 SUMMARY) confirmed that `claude plugin update` does NOT support `--yes` / `-y` / `--non-interactive`. The reinstall will run interactively — the user may be prompted to confirm by the `claude` CLI itself.

```bash
claude plugin update arcanon --scope user
```

Tell the user:

> `Installing Arcanon v{REMOTE}… (this may take a moment)`

If the reinstall command exits non-zero, relay its stderr verbatim and stop — do NOT continue to Step 6/7.

## Step 6 — Prune stale cache directories

Run:

```bash
PRUNE_OUT=$(bash "${CLAUDE_PLUGIN_ROOT}/scripts/update.sh" --prune-cache)
```

Parse the result and tell the user briefly:

```bash
PRUNED=$(printf '%s' "$PRUNE_OUT" | jq -r '.pruned | length')
LOCKED=$(printf '%s' "$PRUNE_OUT" | jq -r '.locked | length')
```

- If `PRUNED > 0`: `Pruned {PRUNED} old cache version(s).`
- If `LOCKED > 0`: `Skipped {LOCKED} cache dir(s) with active file handles — you can re-run /arcanon:update later to clean them up.`
- If both are 0: say nothing, proceed silently.

Never fail the update because of prune issues — this step is housekeeping, not correctness-critical.

## Step 7 — Verify new worker + final message

Run:

```bash
VERIFY_OUT=$(bash "${CLAUDE_PLUGIN_ROOT}/scripts/update.sh" --verify)
VERIFY_STATUS=$(printf '%s' "$VERIFY_OUT" | jq -r '.status')
TARGET_VER=$(printf '%s' "$VERIFY_OUT" | jq -r '.target')
```

Branch on `VERIFY_STATUS`:

| status | Message |
|--------|---------|
| `verified` | Success path (see below). |
| `verify_failed` with reason=no_response | `New worker did not respond within 10s. Plugin is installed (v{TARGET_VER}) — Restart Claude Code to activate it.` |
| `verify_failed` with reason=version_mismatch | `Verification reports v{RUNNING_VER} but expected v{TARGET_VER}. Plugin files updated — Restart Claude Code to pick up v{TARGET_VER}.` |

Extract `RUNNING_VER` when needed:

```bash
RUNNING_VER=$(printf '%s' "$VERIFY_OUT" | jq -r '.running // "unknown"')
```

**Success path — the final message :**

```
Arcanon v{TARGET_VER} installed and verified.

Restart Claude Code to activate v{TARGET_VER}
```

The restart sentence must appear verbatim (with the `{TARGET_VER}` placeholder replaced). Session restart is required because new commands/hooks in the updated plugin only load at Claude Code startup — this is a hard constraint from the plugin runtime.

## Help

**Usage:** `/arcanon:update [--check-only]`

Check the installed plugin version against the latest on the Arcanon
marketplace, show a short changelog preview, and orchestrate a clean self-update.

**Options:**
- *(no flags)* — check + (when newer) prompt to update; full apply flow
- `--check-only` — print the version comparison and exit without prompting
- `--help`, `-h`, `help` — print this help and exit

**Examples:**
- `/arcanon:update` — check for a newer release and apply it interactively
- `/arcanon:update --check-only` — version comparison only, no apply
