---
description: Store your Arcanon Hub API key so scans can sync to the cloud.
allowed-tools: Bash, AskUserQuestion
argument-hint: "[arc_... api key]"
---

# Arcanon Login

Save an API key so other `/arcanon:*` commands can talk to the hub at
`https://api.arcanon.dev`. The key is written to `~/.arcanon/config.json`
with mode `0600`.

## What to do

**1. Resolve the key.**

If `$ARGUMENTS` is non-empty and starts with `arc_`, use it as the API key.
Otherwise use AskUserQuestion to prompt the user:

> "Paste your Arcanon Hub API key (starts with `arc_`).
> Don't have one yet? Sign in at https://app.arcanon.dev, then open
> Settings → API keys to create one. Heads-up: opening
> `/settings/api-keys` directly while signed out lands you on `/home`
> after login (THE-1016) — navigate to it manually for now."

**2. Persist it.**

Run:

```bash
source ${CLAUDE_PLUGIN_ROOT}/lib/help.sh
arcanon_print_help_if_requested "$ARGUMENTS" "${CLAUDE_PLUGIN_ROOT}/commands/login.md" && exit 0
bash ${CLAUDE_PLUGIN_ROOT}/scripts/hub.sh login --api-key "<KEY>"
```

Do **not** print the key back to the user. The script confirms success.

The hub exposes no way to validate an `arc_*` key without an actual
upload, so treat the `/arcanon:login` step as storage-only. The first
`/arcanon:upload` call will surface a bad key as 401 within seconds.

**3. Nudge toward the next step.**

If `arcanon.config.json` does not have `hub.auto-sync: true`, mention:

> "Want Arcanon to upload automatically after every `/arcanon:map` scan?
> Set `hub.auto-sync: true` in `arcanon.config.json`, or run
> `/arcanon:upload` manually."

## Help

**Usage:** `/arcanon:login [arc_... api key]`

Save your Arcanon Hub API key to `~/.arcanon/config.json` (mode `0600`) so
other `/arcanon:*` commands can talk to the hub at `https://api.arcanon.dev`.

**Options:**
- `<api-key>` — positional `arc_...` API key. If omitted, prompts via AskUserQuestion.
- `--help`, `-h`, `help` — print this help and exit

**Examples:**
- `/arcanon:login` — interactive prompt; paste the key when asked
- `/arcanon:login arc_xxxxxxxxxxxx` — non-interactive (replace with your real key)
