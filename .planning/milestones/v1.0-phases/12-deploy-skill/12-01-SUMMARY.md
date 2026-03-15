---
phase: 12-deploy-skill
plan: "01"
subsystem: infra
tags: [kubernetes, kubectl, kustomize, helm, deploy-verify, skill]

# Dependency graph
requires: []
provides:
  - "skills/deploy-verify/SKILL.md — /allclear deploy skill for comparing expected vs actual Kubernetes state"
affects: [13-testing]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "SKILL.md with kubectl shell injection for availability gate (command -v kubectl)"
    - "kubectl diff -k with explicit exit code handling (0=sync, 1=diffs found, >1=error)"
    - "6-path kustomize overlay auto-detection plus Helm fallback with helm-diff plugin detection"

key-files:
  created:
    - skills/deploy-verify/SKILL.md
  modified: []

key-decisions:
  - "Single SKILL.md file only — no supporting shell scripts needed; Claude executes Bash directly from skill steps"
  - "kubectl diff -k as primary mechanism covering DPLY-01, DPLY-03, DPLY-05 in one invocation"
  - "Graceful Helm fallback: helm diff upgrade if plugin available, else helm template | kubectl diff -f -"
  - "Exit code 1 from kubectl diff explicitly documented as informational (diffs found), not an error"

patterns-established:
  - "Pattern: SKILL.md kubectl gate — command -v kubectl shell injection with skip message and stop"
  - "Pattern: kubectl diff exit code semantics — capture DIFF_EXIT, handle 0/1/>1 explicitly"
  - "Pattern: Multi-path overlay detection — search 6 kustomize locations before Helm fallback"

requirements-completed: [DPLY-01, DPLY-02, DPLY-03, DPLY-04, DPLY-05]

# Metrics
duration: 2min
completed: 2026-03-15
---

# Phase 12 Plan 01: Deploy Verify Skill Summary

**kubectl diff -k deploy verification skill with 6-path kustomize overlay detection, Helm fallback, image tag comparison table, configmap diff reporting, and --diff flag for full unified output**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-15T10:08:06Z
- **Completed:** 2026-03-15T10:09:51Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments

- Created `skills/deploy-verify/SKILL.md` covering all five DPLY requirements
- Implemented kubectl availability gate with exact skip message (DPLY-04)
- Added RBAC check via `kubectl auth can-i get pods` before proceeding
- 6-path kustomize overlay auto-detection with Helm fallback (Chart.yaml / helm-diff plugin with template pipeline fallback)
- `kubectl diff -k` with correct exit code handling: 0=in sync, 1=diffs found (not an error), >1=kubectl error
- Image tag comparison table: expected from `kubectl kustomize | grep 'image:'` vs actual from `kubectl get pods -o jsonpath` (DPLY-02)
- Configmap diff reporting extracted from `kubectl diff` output (DPLY-03)
- `--diff` flag for full unified diff vs summary-only mode (DPLY-05)
- Validated all 11 structural checks pass including no `kubectl apply` instructions

## Task Commits

Each task was committed atomically:

1. **Task 1: Create deploy-verify SKILL.md** - `d090b89` (feat)
2. **Task 2: Validate structural completeness** - validation only, no file changes (all 11 checks passed)

**Plan metadata:** (docs commit — see below)

## Files Created/Modified

- `skills/deploy-verify/SKILL.md` - Complete /allclear deploy skill with kubectl gate, overlay detection, diff comparison, image tag extraction, configmap reporting, and --diff flag

## Decisions Made

- Single SKILL.md only — no supporting scripts needed; Claude executes Bash directly from skill steps (matches research recommendation)
- Used `kubectl diff -k` as the primary mechanism because it covers image tags, configmaps, and all managed fields in one server-side dry-run invocation
- Helm fallback uses helm-diff plugin if available, falls back to `helm template | kubectl diff -f -` with a note in output
- Exit code 1 from `kubectl diff` explicitly documented as informational to prevent Claude from treating diffs as errors

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None. All 11 structural validation checks passed on first write.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `skills/deploy-verify/SKILL.md` complete and ready for Phase 13 bats structural tests
- Phase 13 should add `tests/deploy-verify.bats` covering DPLY-01 through DPLY-05 structural checks (noted as Wave 0 gap in RESEARCH.md)

---
*Phase: 12-deploy-skill*
*Completed: 2026-03-15*

## Self-Check: PASSED

- FOUND: skills/deploy-verify/SKILL.md
- FOUND: .planning/phases/12-deploy-skill/12-01-SUMMARY.md
- FOUND: d090b89 commit (feat(12-01): create deploy-verify SKILL.md)
