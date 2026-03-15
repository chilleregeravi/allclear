---
description: Build or refresh the service dependency map by scanning linked repos. Use when the user runs /allclear:map to build the impact map for the first time or re-scan after changes. Also handles --view to open the graph UI and --full to force a complete re-scan.
allowed-tools: Bash, Read, Write, AskUserQuestion
argument-hint: "[--view] [--full]"
---

# AllClear Map — Service Dependency Builder

Orchestrates the complete dependency map pipeline: discover repos → confirm → scan → confirm findings → persist → open graph UI.

## Usage

- `/allclear:map` — discover repos, scan, confirm findings, persist to SQLite, open graph UI
- `/allclear:map --view` — open the graph UI without scanning (requires existing map data)
- `/allclear:map --full` — force a full re-scan of all repos (ignores git diff incremental check)

---

## Step 0: Handle --view Flag

Parse the user's invocation arguments. Detect the `--view` flag.

If `--view` is present:

1. Source the worker client library:
   ```bash
   source ${CLAUDE_PLUGIN_ROOT}/lib/worker-client.sh
   ```

2. Ensure the worker is running. If `worker_running` returns false:
   ```bash
   bash ${CLAUDE_PLUGIN_ROOT}/scripts/worker-start.sh
   wait_for_worker
   ```
   If the worker fails to start, print the error output and exit.

3. Check if map data exists:
   ```bash
   GRAPH=$(worker_call GET /graph)
   ```
   Parse the JSON response. If `services` array is non-empty, map data exists.

4. If map data exists: open the browser and exit.
   ```bash
   PORT=$(cat ~/.allclear/worker.port)
   open http://localhost:${PORT}
   ```
   Print: "Graph UI opened at http://localhost:PORT"

5. If no map data: print the following and exit.
   > No map data yet. Run `/allclear:map` to build the dependency map first.

---

## Step 1: Ensure Worker Is Running

Source the worker client library:
```bash
source ${CLAUDE_PLUGIN_ROOT}/lib/worker-client.sh
```

Check if the worker is running:
```bash
worker_running
```

If the worker is NOT running:
1. Start it:
   ```bash
   bash ${CLAUDE_PLUGIN_ROOT}/scripts/worker-start.sh
   ```
2. Wait for it to be ready:
   ```bash
   wait_for_worker
   ```
3. If `wait_for_worker` fails or times out, print the error and exit. Do not continue.

---

## Step 2: Discover Repos

Build a combined, deduplicated list of repos from two sources:

**Source A — allclear.config.json (project config):**
```bash
CONFIG_REPOS=""
if [ -f allclear.config.json ]; then
  CONFIG_REPOS=$(node -e "
    const c = JSON.parse(require('fs').readFileSync('allclear.config.json', 'utf8'));
    const repos = c['linked-repos'] || [];
    console.log(repos.join('\n'));
  " 2>/dev/null)
fi
```

**Source B — auto-discovery (parent directory + memory):**
```bash
source ${CLAUDE_PLUGIN_ROOT}/lib/linked-repos.sh
DISCOVERED_REPOS=$(list_linked_repos 2>/dev/null)
```

Combine and deduplicate both lists. For each repo in the combined list, track whether it came from `allclear.config.json` or was newly discovered (present in Source B but not Source A). Mark newly discovered repos with "(newly discovered)" in the display.

---

## Step 3: Present Repo List and Confirm

Present the combined repo list to the user. Example format:

```
Repos found for scanning:
  - /Users/you/projects/api  (configured)
  - /Users/you/projects/auth  (configured)
  - /Users/you/projects/sdk  (newly discovered)

Confirm these repos for scanning? (yes / edit / no)
```

Use `AskUserQuestion` to ask: "Confirm these repos for scanning? (yes / edit / no)"

- If the user says **"edit"**: ask "Which repos to add or remove? (enter the updated list, one path per line)". Update the list and re-present it. Repeat until confirmed.
- If the user says **"no"**: print "Map build cancelled." and exit.
- If the user says **"yes"**: proceed.

Once confirmed, write the confirmed list to `allclear.config.json`:
```bash
node -e "
  const fs = require('fs');
  const repos = process.argv.slice(1);
  let config = {};
  if (fs.existsSync('allclear.config.json')) {
    config = JSON.parse(fs.readFileSync('allclear.config.json', 'utf8'));
  }
  config['linked-repos'] = repos;
  fs.writeFileSync('allclear.config.json', JSON.stringify(config, null, 2) + '\n');
" -- [confirmed repo paths]
```

---

## Step 4: Determine Scan Mode

Parse the user's invocation arguments. Detect the `--full` flag.

If `--full` flag is present: **mode = full**.

Otherwise, check the current graph state to determine if this is a first scan:
```bash
GRAPH=$(worker_call GET /graph)
```

Parse the JSON response. Look for any repo in `repo_state` that has a non-null `last_scanned_commit`. If no repo has been previously scanned, **mode = full (first scan)**. Otherwise, **mode = incremental**.

Print the determined mode: "Scan mode: full" or "Scan mode: incremental (scanning changes since last commit)"

---

## Step 5: Trigger Scan

Build the JSON payload and call the scan endpoint:
```bash
SCAN_PAYLOAD=$(node -e "
  const repos = process.argv.slice(1).filter(Boolean);
  const full = process.argv[1] === '--full';
  // extract actual repo list
  const repoList = JSON.parse(process.argv[2]);
  const isFull = process.argv[3] === 'true';
  console.log(JSON.stringify({ repos: repoList, full: isFull }));
" -- '[CONFIRMED_REPOS_JSON]' FULL_MODE_BOOL)

FINDINGS=$(worker_call POST /scan "${SCAN_PAYLOAD}")
```

Construct the payload inline:
```bash
FINDINGS=$(worker_call POST /scan "{\"repos\": [CONFIRMED_REPOS_JSON], \"full\": FULL_MODE_BOOL}")
```

Print: "Scanning N repos... (this may take a few minutes)"

Parse the JSON response. The findings object has this shape:
```json
{
  "high": [...],
  "low": [...]
}
```

If the scan call returns a non-zero exit code or an error JSON, print the error and exit.

---

## Step 6: Present Findings and Confirm

**High-confidence findings:**

Count services and connections in the `high` array. Present a grouped summary to the user:

```
High-confidence findings:
  Found N services, M connections across K repos.

  Services discovered:
    - service-name (repo: /path/to/repo, language: node)
    ...

  Connections:
    - service-a → service-b  [REST GET /api/users]
    ...
```

Use `AskUserQuestion` to ask: "Confirm and save these findings? (yes / edit / no)"

**Low-confidence findings:**

For each finding in the `low` array (show at most 10), present the finding's `clarification_question` field and ask the user to answer it. Incorporate answers into the findings before proceeding.

Example:
```
Low-confidence finding (1/N):
  "Is payment-service calling auth-service at POST /token? (found in payment-service/src/auth-client.js)"
  (yes / no / unsure)
```

After all low-confidence questions are answered, either include or exclude those findings based on the user's answers.

- If the user says **"edit"** to the high-confidence confirmation: ask what to change. Re-present the modified findings. Repeat.
- If the user says **"no"** to everything: print "Scan cancelled. No data written." and exit.

Merge all confirmed findings (high + answered low-confidence) into a single `confirmedFindings` object.

---

## Step 7: Snapshot Existing Map (If Re-scan)

Check if there is an existing map version:
```bash
VERSIONS=$(worker_call GET /versions)
```

Parse the JSON. If the versions array is non-empty (existing map data exists):

Use `AskUserQuestion` to ask: "Keep a history snapshot before overwriting the current map? (yes / no)"

If yes:
```bash
worker_call POST /scan/snapshot '{}'
```
Print: "Snapshot saved."

Note whether this was a first-time build (versions list was empty before Step 7) — you will need this in Step 9.

---

## Step 8: Persist Confirmed Findings

Call the confirm endpoint with the merged confirmed findings:
```bash
worker_call POST /scan/confirm "${CONFIRMED_FINDINGS_JSON}"
```

Print: "Dependency map saved."

If this call fails, print the error and exit without proceeding.

---

## Step 9: Handle First-Time Build

If the versions list from Step 7 was **empty** (this was the first successful map build):

1. Update `allclear.config.json` to add the `impact-map` section:
   ```bash
   node -e "
     const fs = require('fs');
     const config = JSON.parse(fs.readFileSync('allclear.config.json', 'utf8'));
     config['impact-map'] = { history: true };
     fs.writeFileSync('allclear.config.json', JSON.stringify(config, null, 2) + '\n');
   "
   ```

2. Print MCP registration instructions:
   ```
   Map built successfully.

   To enable impact checking in all your Claude Code agents, add the AllClear MCP server
   to your project's .mcp.json:

   {
     "mcpServers": {
       "allclear-impact": {
         "type": "stdio",
         "command": "node",
         "args": ["${CLAUDE_PLUGIN_ROOT}/worker/mcp-server.js"]
       }
     }
   }

   Then restart Claude Code. Agents will automatically check impact before modifying services.
   ```

---

## Step 10: Open Graph UI

Open the graph UI in the browser:
```bash
PORT=$(cat ~/.allclear/worker.port)
open http://localhost:${PORT}
```

Print: "Graph UI opened at http://localhost:PORT"
