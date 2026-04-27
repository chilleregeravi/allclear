---
description: Open the Arcanon graph UI in your default browser. Top-level alias for /arcanon:map view.
argument-hint: ""
allowed-tools: Bash
---

# Arcanon View — Graph UI Launcher

Open the service dependency graph in your browser. Auto-starts the worker if it
is not running. Top-level alias for the long-standing `/arcanon:map view`
keystroke — both routes work, both reach the same UI.

## When to use

- You just want to look at the graph. No re-scan, no analysis — just open the
  browser to the worker's UI.
- After `/arcanon:map` finishes scanning and you want to inspect the result
  visually.

## Usage

| Invocation       | Behaviour                                                         |
| ---------------- | ----------------------------------------------------------------- |
| `/arcanon:view`  | Auto-start the worker if needed, then open `http://localhost:${PORT}` in the default browser. Print "Graph UI opened" and stop. Exit 0. |

The existing `/arcanon:map view` keystroke continues to work and reaches the
same UI — this command is a shorter top-level alias for discovery.

## Step 1 — Open the UI

```bash
source ${CLAUDE_PLUGIN_ROOT}/lib/help.sh
arcanon_print_help_if_requested "$ARGUMENTS" "${CLAUDE_PLUGIN_ROOT}/commands/view.md" && exit 0
source ${CLAUDE_PLUGIN_ROOT}/lib/worker-client.sh
worker_running || bash ${CLAUDE_PLUGIN_ROOT}/scripts/worker-start.sh
PORT=$(cat ~/.arcanon/worker.port)
# Cross-platform open
if command -v xdg-open &>/dev/null; then xdg-open "http://localhost:${PORT}"
elif command -v open &>/dev/null; then open "http://localhost:${PORT}"
else echo "Open http://localhost:${PORT} in your browser"; fi
```

Print "Graph UI opened" and stop. Do not proceed to scanning.

## Read-only guarantee

`/arcanon:view` performs **zero writes** to the impact-map database. The only
side effect is starting the worker process (HTTP read-server) if it is not
already running, and opening a browser tab. Safe to run repeatedly.

It does **not**:

- Trigger a scan
- Modify any `services` / `connections` / `scan_versions` row
- Add new HTTP routes or new auth surface

## See also

- `/arcanon:map` — re-scan repos and rebuild the graph
- `/arcanon:list` — concise project overview (no UI)

## Help

**Usage:** `/arcanon:view`

Open the Arcanon graph UI in your default browser. Top-level alias for
`/arcanon:map view`. Auto-starts the worker if it is not running.

**Options:**
- `--help`, `-h`, `help` — print this help and exit

**Examples:**
- `/arcanon:view` — open the graph UI; auto-starts the worker if needed
