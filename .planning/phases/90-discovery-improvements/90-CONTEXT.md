# Phase 90: Discovery Improvements - Context

**Gathered:** 2026-03-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Improve discovery agent with mono-repo detection heuristic and client file identification. Two requirements: DISC-01 (mono-repo), DISC-02 (client_files).

Linear issue: THE-951

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion.

Key constraints from THE-951:

- DISC-01: Add instruction to agent-prompt-discovery.md: "Check for multiple manifest files in subdirectories (`*/package.json`, `*/pyproject.toml`, `*/Cargo.toml`, `*/go.mod`). If found, this is a mono-repo — list each subdirectory with its own manifest as a separate `service_hints` entry."

- DISC-02: Add `client_files` to discovery output JSON schema — files matching patterns like `*client*.py`, `*api*.ts`, `*http*.rs`, or files importing `fetch`/`requests`/`reqwest`/`httpx`. This helps Phase 2 (deep scan) find outbound HTTP call sites more efficiently.

</decisions>

<code_context>
## Existing Code Insights

### Target File
- `plugins/ligamen/worker/scan/agent-prompt-discovery.md` — the only file being modified

### Current Schema
```json
{
  "repo_name": "string",
  "languages": [],
  "frameworks": [],
  "service_hints": [],
  "route_files": [],
  "proto_files": [],
  "openapi_files": [],
  "event_config_files": [],
  "has_dockerfile": true,
  "has_docker_compose": true,
  "mono_repo": false,
  "notes": "string"
}
```

Missing: `client_files` field.
Mono-repo: mentioned at line 55 but no detection heuristic.

</code_context>

<specifics>
No specific requirements.
</specifics>

<deferred>
None.
</deferred>
