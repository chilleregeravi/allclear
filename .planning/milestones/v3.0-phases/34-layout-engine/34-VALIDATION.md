---
phase: 34
slug: layout-engine
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-03-18
---

# Phase 34 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node.js built-in test runner (`node --test`) |
| **Config file** | None — scripts specified as `node --test <file>` |
| **Quick run command** | `node --test worker/ui/modules/layout.test.js` |
| **Full suite command** | `node --test worker/ui/modules/layout.test.js worker/ui/modules/renderer.test.js worker/ui/modules/utils.test.js worker/ui/modules/interactions.test.js` |
| **Estimated runtime** | ~2 seconds |

---

## Sampling Rate

- **After every task commit:** Run `node --test worker/ui/modules/layout.test.js`
- **After every plan wave:** Run full suite command
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 2 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 34-01-01 | 01 | 1 | LAYOUT-01, LAYOUT-02, LAYOUT-03, LAYOUT-04, NODE-01 | unit | `node --test worker/ui/modules/layout.test.js` | ❌ W0 | ⬜ pending |
| 34-01-02 | 01 | 1 | LAYOUT-04 | integration | `grep -c "boundaries" worker/server/http.js` | ✅ | ⬜ pending |
| 34-01-03 | 01 | 1 | LAYOUT-01, LAYOUT-02 | unit+integration | `node --test worker/ui/modules/layout.test.js && node --test worker/ui/modules/interactions.test.js` | ❌ W0 | ⬜ pending |
| 34-02-01 | 02 | 2 | LAYOUT-05, NODE-02, NODE-03 | source inspection | `node --test worker/ui/modules/renderer.test.js` | ❌ W0 | ⬜ pending |
| 34-02-02 | 02 | 2 | NODE-05 | source inspection | `node --test worker/ui/modules/interactions.test.js` | ✅ (needs update) | ⬜ pending |
| 34-02-03 | 02 | 2 | NODE-01, NODE-02, NODE-03 | unit | `node --test worker/ui/modules/renderer.test.js && node --test worker/ui/modules/interactions.test.js` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `worker/ui/modules/layout.test.js` — stubs for LAYOUT-01, LAYOUT-02, LAYOUT-03, LAYOUT-04
- [ ] `worker/ui/modules/renderer.test.js` — stubs for LAYOUT-05, NODE-01, NODE-02, NODE-03
- [ ] Update `worker/ui/modules/interactions.test.js` — add NODE-05 tooltip count check

---

## Manual-Only Verifications

*All phase behaviors have automated verification.*

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 2s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
