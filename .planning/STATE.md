---
gsd_state_version: 1.0
milestone: v5.8.0
milestone_name: Library Drift & Language Parity
status: verifying
stopped_at: Completed 96-hub-payload-v1-1/96-02-PLAN.md
last_updated: "2026-04-19T17:16:42.918Z"
last_activity: 2026-04-19
progress:
  total_phases: 32
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-19)

**Core value:** Every edit is automatically formatted and linted, every quality check runs with one command, and breaking changes across repos are caught before they ship.
**Current focus:** Phase 96 — Hub Payload v1.1 + Feature Flag

## Current Position

Phase: 96 (Hub Payload v1.1 + Feature Flag) — EXECUTING
Plan: 2 of 2
Status: Phase complete — ready for verification
Last activity: 2026-04-19

Progress: [          ] 0%

## Performance Metrics

**Velocity:**

- Total plans completed: 156 (across v1.0–v5.7.0)
- Total milestones shipped: 18

## Accumulated Context

### Decisions

(Cleared — see PROJECT.md Key Decisions table for full history)

- [Phase 92-manifest-parsers]: MANAGED sentinel chosen over silent drop for unresolved Maven/NuGet versions — preserves row visibility in drift output
- [Phase 92-manifest-parsers]: Separate tmpfiles per Gradle DSL branch to avoid cross-contamination when build.gradle and build.gradle.kts co-exist
- [Phase 92-manifest-parsers]: detect_language uses csharp token; detect_project_type uses dotnet token — matches CLI naming convention
- [Phase 92-manifest-parsers]: compgen -G used for .csproj/.sln glob detection in detect_project_type (bash builtin, no subprocess)
- [Phase 92-manifest-parsers]: drift-types.sh: added --test-only guard (mirrors drift-versions.sh) to allow bats sourcing without triggering main loop under set -euo pipefail
- [Phase 92-manifest-parsers]: C# partial class limitation documented as code comment only — cross-file merging deferred per Pitfall 13, out of Phase 92 scope
- [Phase 92-manifest-parsers]: Fixtures contain only minimum files to trigger exactly one parser each — no cross-ecosystem contamination
- [Phase 92-manifest-parsers]: Rule 1 bug fix: Maven relativePath extraction RSTART+15 was off-by-one (tag is 14 chars) — fixed to RSTART+14 so ../pom.xml resolves correctly
- [Phase 93-dep-collector]: Migration 010: CREATE TABLE IF NOT EXISTS for idempotency, no hasCol() guards; 4-col UNIQUE includes manifest_file (NOT NULL) to handle mono-repo same-package-in-multiple-manifests; dep_kind column present in v5.8.0 schema despite only writing 'direct' (transient deferred to v5.9 per PITFALLS P6); ON DELETE CASCADE from services(id) means endScan() needs no new dep cleanup code
- [Phase 93-dep-collector]: ON CONFLICT DO UPDATE (not INSERT OR REPLACE) preserves row IDs across re-scans — chosen for DEP-08 row-id stability contract
- [Phase 93-dep-collector]: No deleteStaleDependencies() helper — ON DELETE CASCADE from services(id) handles dep cleanup automatically via endScan()
- [Phase 93-dep-collector]: runMigrations() in test seedDb() instead of partial migration chain — QueryEngine constructor requires all migrations for unconditional prepared statements
- [Phase 93-dep-collector]: Poetry regex: replaced \z (Perl/Ruby) with JS-compatible end-of-string match
- [Phase 93-dep-collector]: ecosystems_scanned pushed even for empty-dep manifests — found+parsed without error is a valid scanned state
- [Phase 95-shell-cleanup-dispatcher]: drift.sh uses bash subprocess (not source) to preserve DSP-03 direct-invocation regression contract
- [Phase 95-shell-cleanup-dispatcher]: Reserved slots licenses|security exit 2 (distinct from unknown=1) to differentiate reserved vs typo
- [Phase 95-shell-cleanup-dispatcher]: worker-start.sh calls should_restart_worker (not restart_worker_if_stale) to avoid recursive worker_start_background spawn
- [Phase 95]: Pre-compute awk sleep interval once outside loop to avoid bc subprocess per iteration
- [Phase 95]: Bash 4+ guard added to drift-types.sh; unset type_repos before first declare -A closes key-leak at loop entry
- [Phase 95]: Remove global exec 2>/dev/null in lint.sh so linter panics surface; drop dead npm bin branch (npm 9+ removed it)
- [Phase 94-auth-db-enrichment]: java-empty fixture needed for Test D isolation — SecurityConfig.java siblings in main fixture polluted no-signal test
- [Phase 94-auth-db-enrichment]: DB signals for Java rely on .java source files only — pom.xml/yml not scanned; postgresql signal embedded in UserEntity.java comments
- [Phase 94-auth-db-enrichment]: Test D fixture isolation via tmpdir copy (not live file deletion) avoids concurrent test fragility
- [Phase 94-auth-db-enrichment]: DB_SOURCE_SIGNALS.csharp captures EF Core minimal-API via UseNpgsql/UseSqlServer discriminators (Pitfall 11 GREEN path)
- [Phase 94-auth-db-enrichment]: C# partial class limitation documented in AUTH_SIGNALS.csharp comment, not implemented (Phase 92 TYPE-03 locked)
- [Phase 94-auth-db-enrichment]: config/database.yml adapter: probe runs unconditionally in envFiles loop — safe because .env files never contain adapter: keys
- [Phase 94-auth-db-enrichment]: http-basic mechanism label used for authenticate_or_request_with_http_basic (distinct from session, passes isCredential check at 10 chars)
- [Phase 96-hub-payload-v1-1]: schemaVersion derived inside buildFindingsBlock return value — keeps payload.js pure; buildScanPayload reads it from the findings block
- [Phase 96-hub-payload-v1-1]: anyServiceHasDeps gate: flag=true + all-empty deps falls back to v1.0 — existing hub deployments never receive unexpected keys
- [Phase 96-hub-payload-v1-1]: Back-fill service ids onto r.findings.services after persistFindings via single SELECT name+id — avoids threading ids through agent pipeline
- [Phase 96-hub-payload-v1-1]: 4 new tests added (not 8): 5 of the 8 plan-spec cases were already shipped by 96-01; duplicates would violate the no-modify-existing-tests rule

### Pending Todos

None.

### Blockers/Concerns

- Hub companion THE-1018 must land separately for end-to-end library drift. Plugin can ship payload v1.1 independently (hub accepts both v1.0 and v1.1 per ticket).

## Session Continuity

Last session: 2026-04-19T16:51:04.031Z
Stopped at: Completed 96-hub-payload-v1-1/96-02-PLAN.md
Resume file: None
