---
description: Upload the latest local scan for the current repo to Arcanon Hub.
allowed-tools: Bash
argument-hint: "[--project <slug>] [--repo <path>]"
---

# Arcanon Upload

Push the latest findings from the local SQLite DB to
`POST /api/v1/scans/upload`. Runs manually — useful when
`hub.auto-upload` is disabled or you want to retry after a failed auto sync.

## Preflight

Make sure:
1. **A scan exists.** If no `~/.arcanon/projects/*/impact-map.db` row covers
   the current repo, tell the user to run `/arcanon:map` first.
2. **Credentials exist.** Run
   `bash ${CLAUDE_PLUGIN_ROOT}/scripts/hub.sh status --json` and check the
   `credentials` field. If it's `"missing"`, walk the user through it:

   > "Arcanon Hub uses an API key (starts with `arc_`) for uploads. To get
   > one:
   > 1. Sign in at https://app.arcanon.dev (or sign up if you haven't yet).
   > 2. Open Settings → API keys and create a key. *Note: deep-linking to
   >    `/settings/api-keys` while signed out lands you on `/home` after
   >    login — known issue THE-1016, navigate manually for now.*
   > 3. Run `/arcanon:login arc_…` to store the key locally."

   Don't proceed to the upload step until credentials are present.

## Run

```bash
bash ${CLAUDE_PLUGIN_ROOT}/scripts/hub.sh upload $ARGUMENTS
```

The CLI handles everything — it reads the latest findings for the current
repo, wraps them in `ScanPayloadV1`, POSTs with exponential backoff, and
either confirms `scan_upload_id` or enqueues on retriable failure.

## Report

Relay the script's stdout verbatim. On failure, check the printed error:

- "no local scan found" → `/arcanon:map` first.
- "hub returned 422" → findings reconciliation bug — suggest filing an issue with the warning list.
- "hub returned 429" → rate limit — surface the Retry-After hint.
- "network error" → the payload is safely queued; `/arcanon:sync` will retry later.
