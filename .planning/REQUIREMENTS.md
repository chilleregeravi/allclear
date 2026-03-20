# Requirements: Ligamen

**Defined:** 2026-03-20
**Core Value:** Every edit is automatically formatted and linted, every quality check runs with one command, and breaking changes across repos are caught before they ship.

## v4.1 Requirements

Requirements for v4.1 Command Cleanup. Each maps to roadmap phases.

### Removal

- [ ] **REM-01**: Remove `/ligamen:pulse` command and `scripts/pulse-check.sh`
- [ ] **REM-02**: Remove `/ligamen:deploy-verify` command
- [ ] **REM-03**: Remove pulse and deploy-verify from README, docs, and validated requirements

### MCP Drift

- [ ] **MCP-01**: Add `drift_versions` MCP tool — query dependency version mismatches across scanned repos
- [ ] **MCP-02**: Add `drift_types` MCP tool — query shared type/struct/interface mismatches across repos
- [ ] **MCP-03**: Add `drift_openapi` MCP tool — query OpenAPI spec breaking changes across repos

### Cleanup

- [ ] **CLN-01**: Remove any tests specific to pulse or deploy-verify
- [ ] **CLN-02**: Update remaining docs references

## Future Requirements

None deferred.

## Out of Scope

| Feature | Reason |
|---------|--------|
| Quality-gate via MCP | MCP server is for data queries; quality-gate runs shell commands (different execution model) |
| Drift shell command removal | Keep `/ligamen:drift` command alongside MCP tools — different use cases |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| REM-01 | — | Pending |
| REM-02 | — | Pending |
| REM-03 | — | Pending |
| MCP-01 | — | Pending |
| MCP-02 | — | Pending |
| MCP-03 | — | Pending |
| CLN-01 | — | Pending |
| CLN-02 | — | Pending |

**Coverage:**
- v4.1 requirements: 8 total
- Mapped to phases: 0
- Unmapped: 8 ⚠️

---
*Requirements defined: 2026-03-20*
*Last updated: 2026-03-20 after initial definition*
