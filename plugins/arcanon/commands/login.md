---
description: Store your Arcanon Hub API key so scans can sync to the cloud.
allowed-tools: Bash, AskUserQuestion
argument-hint: "[arc_... api key] [--org-id <uuid>]"
---

# Arcanon Login

Save an API key so other `/arcanon:*` commands can talk to the hub at
`https://api.arcanon.dev`. The plugin calls the hub's `whoami` endpoint to
learn which orgs the key is authorized for, then stores the credential triple
(api key, hub url, default org id) to `~/.arcanon/config.json` with mode `0600`.

## What to do

**1. Resolve the key and optional org id.**

Parse `$ARGUMENTS`:
- If `$ARGUMENTS` contains a word starting with `arc_`, treat it as the API key.
- If `$ARGUMENTS` contains `--org-id <uuid>`, capture the uuid.
- If no `arc_` key is present, use AskUserQuestion to prompt the user:

> "Paste your Arcanon Hub API key (starts with `arc_`).
> Don't have one yet? Sign in at https://app.arcanon.dev, then open
> Settings → API keys to create one. Heads-up: opening
> `/settings/api-keys` directly while signed out lands you on `/home`
> after login (THE-1016) — navigate to it manually for now."

Do **not** print the key back to the user at any point.

**2. Invoke the login script.**

```bash
source ${CLAUDE_PLUGIN_ROOT}/lib/help.sh
arcanon_print_help_if_requested "$ARGUMENTS" "${CLAUDE_PLUGIN_ROOT}/commands/login.md" && exit 0
bash ${CLAUDE_PLUGIN_ROOT}/scripts/hub.sh login --api-key "<KEY>" [--org-id "<UUID>"]
```

Capture the **exit code**:

- **Exit 0** → success. Relay stdout (which is `✓ …`) to the user.
- **Exit 2** → failure. Relay stderr verbatim and stop. Do not retry.
- **Exit 7** → grant prompt (multiple orgs). The Node CLI emitted two lines to stdout:
  1. The sentinel line: `__ARCANON_GRANT_PROMPT__`
  2. A JSON array of grant objects: `[{"org_id":"...","org_name":"acme","role":"admin"}, ...]`

  When exit 7 is received, handle the re-entry contract:
  1. Parse the JSON grants array from stdout (everything after the sentinel line).
  2. Format an AskUserQuestion prompt:
     > "This key is authorized for N orgs. Pick one:"
     with each option as `"<org_name> — <org_id>"` (one per line).
  3. Re-invoke:
     ```bash
     bash ${CLAUDE_PLUGIN_ROOT}/scripts/hub.sh login --api-key "<KEY>" --org-id "<CHOSEN_UUID>"
     ```
  4. Relay the second invocation's stdout to the user.

**3. Nudge toward the next step.**

If `arcanon.config.json` does not have `hub.auto-sync: true`, mention:

> "Want Arcanon to upload automatically after every `/arcanon:map` scan?
> Set `hub.auto-sync: true` in `arcanon.config.json`, or run
> `/arcanon:sync` manually."

## Help

**Usage:** `/arcanon:login [arc_... api key] [--org-id <uuid>]`

Save your Arcanon Hub API key to `~/.arcanon/config.json` (mode `0600`) so
other `/arcanon:*` commands can talk to the hub at `https://api.arcanon.dev`.

The plugin calls the hub's `whoami` endpoint to learn which orgs the key is
authorized for, then stores the full credential triple (api key, hub url,
default org id).

**Options:**
- `<api-key>` — positional `arc_...` API key. If omitted, prompts via AskUserQuestion.
- `--org-id <uuid>` — skip whoami grant resolution and pin this org id. If the key
  isn't authorized for it, login warns but stores the credential anyway (the server
  rejects at upload time with `key_not_authorized_for_org`).
- `--hub-url <url>` — override the hub endpoint (default: `https://api.arcanon.dev`).
- `--help`, `-h`, `help` — print this help and exit

**Examples:**
- `/arcanon:login arc_xxxxxxxxxxxx` — interactive: whoami picks the org or prompts among grants
- `/arcanon:login arc_xxxxxxxxxxxx --org-id 7f3e1234-…` — non-interactive with explicit org id

**Behavior:**

- **Success + grant match** — key is verified against the supplied `--org-id`; the
  credential triple is stored and login announces `✓ verified: signed in to org <slug> (<uuid>)`.
- **Success + grant mismatch** — `--org-id` supplied but not in the key's grants list;
  credential triple is stored anyway with a `⚠` warning listing available grants. The
  server will reject uploads with `key_not_authorized_for_org` until the org id is corrected.
- **0 grants** — the key has no org grants; nothing is stored; exit 2 with an admin-action message.
- **Hub unreachable + `--org-id`** — credential is stored with a `⚠` warning;
  use `/arcanon:login` again when online to verify grants.
- **Hub unreachable + no `--org-id`** — refused; exit 2. A credential without a verified
  org id is useless — supply `--org-id` if you know it.

**Grant-prompt re-entry contract (exit 7):**

When the key has multiple org grants and `--org-id` was not supplied, the Node CLI exits
with code 7 and emits to stdout:
```
__ARCANON_GRANT_PROMPT__
[{"org_id":"...","org_name":"acme","role":"admin"}, ...]
```
The markdown layer (this file) is responsible for parsing the grants, presenting
an AskUserQuestion selection, and re-invoking the CLI with the chosen `--org-id`.
This re-entry always lands in the "success + (match or mismatch)" branch and exits 0.
