# Phase 118 — Deferred Items

Out-of-scope discoveries logged during execution. Each item is tagged with the
discovering plan and a recommended next-phase target.

## From Plan 118-02 (`/arcanon:rescan`)

### 1. Production agent-runner wiring for `/api/rescan` (HIGH priority)

- **Found:** Task 2 (validating Plan's "if the worker is up, agentRunner is wired" assumption).
- **Reality:** Production `worker/index.js` never calls `setAgentRunner`. `scanRepos` throws `agentRunner not initialized` at `manager.js:605` for any caller from inside the worker process.
- **Current state:** `/api/rescan` returns 503 with a clear message in production. Bats tests use the `ARCANON_TEST_AGENT_RUNNER=1` env-var stub injected in this plan (Task 2). `/arcanon:rescan` is functional in tests; in production it surfaces the bootstrap gap as exit 1.
- **Why deferred:** The fix belongs to the agent-runtime architecture (do we ship a real agent CLI? do we route rescan through the host like `/arcanon:map` does?), not the rescan trigger surface that this plan owns. Scope-wise it's a Phase 119+ topic; mixing it into this plan would have doubled the surface.
- **Recommended next phase:** A dedicated agent-runtime plan in v0.1.5 (or a fast-follow in v0.1.4 if operators hit the 503 in real usage). Two design options to evaluate:
  - **Option A (worker-owned runner):** Read `ARCANON_AGENT_BINARY` env var, spawn the agent CLI (or fall back to `claude` from PATH) with the prompt on stdin, capture stdout. Same shape as the test stub, but real.
  - **Option B (host-orchestrated):** Make `/arcanon:rescan` a hybrid command — the slash-command body orchestrates the Claude agent locally (like `map.md` does today), then POSTs the findings to `/scan` for that one repo. Drops `POST /api/rescan` entirely.
- **Tracking:** add a Linear ticket "RESCAN-PROD-01: Production agent-runner wiring" linked to Phase 118-02 SUMMARY.
