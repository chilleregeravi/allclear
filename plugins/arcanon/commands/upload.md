---
description: "[DEPRECATED] Forwards to /arcanon:sync. Removed in v0.2.0 — update your scripts to /arcanon:sync now."
allowed-tools: Bash
argument-hint: "[--project <slug>] [--repo <path>]"
---

# Arcanon Upload — DEPRECATED

> **This command is deprecated as of v0.1.1 and will be removed in v0.2.0.**
> `/arcanon:upload` has been absorbed by `/arcanon:sync`. The new default (`/arcanon:sync` with no flags) performs upload-then-drain. See `/arcanon:sync` for the full flag list (`--drain`, `--repo`, `--dry-run`, `--force`).

## Behaviour in v0.1.1

This stub:
1. Emits a deprecation warning to **stderr** so it is visible to humans reading the terminal but does not contaminate scripted stdout parsers.
2. Forwards all arguments to `/arcanon:sync` so `$ARGUMENTS` like `--repo ../api` or `--project my-slug` still work.
3. Exits with status 0 on the stub layer — the underlying `/arcanon:sync` exit status is what callers see.

## Run

```bash
# DEPRECATED: remove in v0.2.0
printf 'arcanon: /arcanon:upload is deprecated — use /arcanon:sync (v0.2.0 removes this stub)\n' >&2
bash ${CLAUDE_PLUGIN_ROOT}/scripts/hub.sh upload $ARGUMENTS
```

> **Note for Claude executing this command:** After running the bash block above, tell the user plainly that `/arcanon:upload` is going away in v0.2.0 and they should switch their muscle memory / runbooks / CI scripts to `/arcanon:sync`. Do not hide the deprecation in verbose output — surface it in the first sentence of your reply.

## Report

Relay the script's stdout verbatim. The stderr deprecation warning is intended to be visible alongside normal output in interactive terminals and captured in CI logs without breaking exit-status checks.
