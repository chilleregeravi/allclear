# Phase 12: Deploy Skill - Research

**Researched:** 2026-03-15
**Domain:** Kubernetes deploy state verification skill (SKILL.md prompt + kubectl/kustomize/helm)
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| DPLY-01 | `/allclear deploy` skill compares expected state (kustomize/helm) to actual cluster state | `kubectl diff -k` is the primary mechanism; research confirms native kustomize + kubectl diff integration |
| DPLY-02 | Skill checks image tags match between code and deployed pods | `kubectl get pods -o jsonpath` + kustomize build yaml extraction; verified patterns documented below |
| DPLY-03 | Skill checks configmap values match between overlays and cluster | `kubectl diff -k` covers configmaps natively; `kubectl get configmap -o yaml` for targeted inspection |
| DPLY-04 | Skill gracefully skips if kubectl is not available with clear message | `command -v kubectl` guard pattern; identical to pulse skill (PULS-04) |
| DPLY-05 | Skill supports --diff flag to show specific differences | `kubectl diff -k` exit code 1 = has diffs; output is unified diff format |
</phase_requirements>

---

## Summary

The deploy skill is a SKILL.md prompt that instructs Claude to compare the expected Kubernetes state from kustomize overlays or helm charts against what is actually running in the cluster. The primary tool is `kubectl diff -k <overlay-path>`, which renders the kustomize overlay locally and performs a server-side dry-run diff against live cluster objects. This covers image tags, configmaps, replica counts, and all other managed fields in a single command.

The skill closely mirrors the pulse skill (Phase 11) in structure: it is a SKILL.md with YAML frontmatter, inline shell injection via `!`command`` for kubectl availability detection, and a step-by-step prompt guiding Claude to run the appropriate kubectl commands, parse their output, and report findings. The only new tooling is `kubectl diff` and optional `kubectl get configmap`.

When kubectl is not available, the skill must emit a single clean skip message and stop — this is identical to the PULS-04 pattern and should use `command -v kubectl` as the guard, outputting a human-readable explanation rather than an error.

**Primary recommendation:** Implement as a single SKILL.md in `skills/deploy-verify/` using `kubectl diff -k <overlay>` for the full state comparison (DPLY-01, DPLY-03, DPLY-05), `kubectl get pods -o jsonpath` for targeted image tag extraction (DPLY-02), and `command -v kubectl` for graceful skip (DPLY-04). No custom shell scripts are needed; Claude executes Bash directly from skill steps.

---

## Standard Stack

### Core

| Tool | Version | Purpose | Why Standard |
|------|---------|---------|--------------|
| `kubectl diff -k` | kubectl 1.14+ | Compare kustomize overlay to live cluster state | Native kubectl subcommand; covers all resource types including configmaps in one pass |
| `kustomize build` | bundled in kubectl or standalone | Render overlay to YAML for local inspection | Standard kustomize workflow; embedded in `kubectl diff -k` |
| `kubectl get pods -o jsonpath` | any kubectl | Extract running image tags per pod | Standard kubectl output format; no extra tools needed |
| `kubectl get configmap -o yaml` | any kubectl | Inspect live configmap values | Direct introspection when targeted comparison needed |
| `command -v kubectl` | bash builtin | Check kubectl presence | POSIX standard; same pattern as pulse skill |

### Supporting

| Tool | Version | Purpose | When to Use |
|------|---------|---------|-------------|
| `helm diff upgrade` | helm-diff plugin | Compare helm release to local chart+values | Use instead of `kubectl diff -k` when project uses Helm |
| `jq` | any | Parse JSON from `kubectl ... -o json` | More powerful than JSONPath for complex extractions; present in project |
| `KUBECTL_EXTERNAL_DIFF` env var | kubectl feature | Custom diff renderer (e.g., colordiff) | Optional; not required for skill |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `kubectl diff -k` | `kustomize build | kubectl apply --dry-run=client` | `kubectl diff` does server-side dry-run which catches admission controller rejections; preferred |
| `kubectl get pods -o jsonpath` | `kubectl get pods -o json | jq` | jq is more flexible but JSONPath is built-in; either works |
| helm-diff plugin | `helm template | kubectl diff` | helm-diff plugin is more ergonomic but not universally installed; template pipeline is always available |

**Installation:** No new package installation. kubectl must be in PATH (graceful skip if absent). kustomize is bundled in kubectl since v1.14. jq is already established in the project pattern (PLGN-07).

---

## Architecture Patterns

### Recommended Project Structure

```
skills/
└── deploy-verify/
    └── SKILL.md      # /allclear deploy — compare expected vs actual cluster state
```

No scripts/ subdirectory needed. Claude executes all Bash commands directly via the Bash tool from skill steps.

### Pattern 1: SKILL.md with kubectl availability gate

**What:** The skill opens with a shell injection that checks for kubectl and sets context. If kubectl is absent, the first step instructs Claude to print a skip message and stop. This is the same pattern as the pulse skill.

**When to use:** Any skill that depends on an optional external binary.

**Example:**
```markdown
---
name: deploy-verify
description: This skill should be used when the user asks to "check deploy", "verify deployment", "compare expected state", "/allclear deploy", or wants to know if the cluster matches the expected configuration.
version: 1.0.0
allowed-tools: Bash
---

# AllClear Deploy Verification

kubectl available: !`command -v kubectl >/dev/null 2>&1 && echo "yes" || echo "no"`

## Steps

1. **Check prerequisites.** If kubectl is "no" above, print exactly:
   `AllClear deploy: kubectl not available — skipping deploy verification`
   Then stop. Do not proceed.

2. **Detect overlay path.** Look for kustomize overlays in these locations (in order):
   - `k8s/overlays/<env>/`
   - `deploy/overlays/<env>/`
   - `kustomize/overlays/<env>/`
   - `overlays/<env>/`
   Where `<env>` defaults to the argument passed by the user, or "production" if none.
   If no kustomize overlay is found, check for a Helm chart (Chart.yaml) and use helm instead.

3. **Compare expected vs actual state.**
   - Kustomize: `kubectl diff -k <overlay-path>`
   - Helm: `helm diff upgrade <release-name> <chart-path> -f values.yaml`
   Exit code 0 = in sync. Exit code 1 = differences found.

4. **Extract image tags** for each Deployment and compare expected (from overlay YAML) vs actual (from cluster):
   ```bash
   # Expected from kustomize overlay
   kubectl kustomize <overlay-path> | grep 'image:' | awk '{print $2}' | sort -u
   # Actual from cluster
   kubectl get pods -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.spec.containers[0].image}{"\n"}{end}'
   ```

5. **Report results.** Show:
   - Overall status: IN SYNC or DRIFTED
   - Image tag comparison table: expected vs actual per service
   - Configmap diff summary if `kubectl diff` shows configmap changes
   - If `--diff` flag was passed, show full unified diff output from `kubectl diff -k`
```

### Pattern 2: Overlay path auto-detection

**What:** The skill checks common overlay directory conventions before asking the user for a path. This covers the most common kustomize project layouts.

**When to use:** Any skill that operates on project-local k8s manifests.

**Common overlay locations (in priority order):**
1. `k8s/overlays/<env>/`
2. `deploy/overlays/<env>/`
3. `kustomize/overlays/<env>/`
4. `overlays/<env>/`
5. `k8s/<env>/` (flat, no "overlays" subdirectory)
6. Project root `kustomization.yaml` (single-env projects)

**Helm detection:** Presence of `Chart.yaml` or `helm/` directory. Use `helm diff upgrade` if helm plugin is available, else fall back to `helm template <chart> | kubectl diff -f -`.

### Pattern 3: kubectl diff exit code semantics

**What:** `kubectl diff` uses exit code 0 = no diff (in sync), exit code 1 = diff found, exit code >1 = error. This must be handled explicitly in the skill prompt — Claude should not treat exit code 1 as a command failure.

**Critical note for skill prompt:** Instruct Claude to run kubectl diff and capture both the output AND the exit code separately:
```bash
kubectl diff -k ./overlays/production/; DIFF_EXIT=$?
# $DIFF_EXIT == 0: in sync
# $DIFF_EXIT == 1: differences found (not an error)
# $DIFF_EXIT > 1: kubectl error
```

### Anti-Patterns to Avoid

- **Treating exit code 1 as failure:** `kubectl diff` exits 1 when diffs exist — this is expected and informational, not an error. The skill prompt must explicitly instruct Claude to handle this correctly.
- **Running kubectl apply instead of kubectl diff:** The skill is read-only verification. Never instruct Claude to apply changes.
- **Blocking on missing kustomize overlay:** If no overlay is found, emit a clear message about what was searched and stop gracefully — do not error.
- **Assuming a namespace:** Always respect the namespace configured in the kustomize overlay or helm values. Do not default to "default" namespace silently.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Expected vs actual diff | Custom YAML comparison script | `kubectl diff -k` | Handles all resource types, admission webhooks, server-side validation |
| Image tag extraction from overlay | Custom YAML parser | `kubectl kustomize <path> \| grep 'image:'` | kustomize handles complex overlays, patches, and merges |
| Configmap value comparison | Key-by-key comparison script | `kubectl diff -k` output | diff covers configmaps as first-class resources |
| kubectl presence check | OS detection, PATH manipulation | `command -v kubectl` | Bash builtin, POSIX, fast, no side effects |

**Key insight:** `kubectl diff -k` is a single command that renders the full kustomize overlay, performs a server-side dry-run against the live cluster, and outputs a unified diff. It is the authoritative "expected vs actual" mechanism and covers DPLY-01, DPLY-03, and DPLY-05 in one invocation.

---

## Common Pitfalls

### Pitfall 1: kubectl diff exit code 1 treated as error

**What goes wrong:** Claude (or a bash script using `set -e`) treats exit code 1 from `kubectl diff` as a failure, stopping execution when diffs are found rather than reporting them.

**Why it happens:** Convention is exit 0 = success, non-zero = error. kubectl diff breaks this convention — exit 1 means "diffs found" (the informational success case for this skill).

**How to avoid:** The skill prompt must explicitly document this. Use `kubectl diff -k <path> || true` if running in a strict error context, then check output. Alternatively capture exit code: `kubectl diff -k <path>; EC=$?`

**Warning signs:** Skill reports "in sync" when the cluster is actually drifted; no output shown for deployments with known image mismatches.

### Pitfall 2: Overlay path not found, skill errors instead of skipping

**What goes wrong:** The skill tries a hardcoded path like `overlays/production/` and fails when the project uses a different convention.

**Why it happens:** No universal kustomize directory convention exists.

**How to avoid:** The skill prompt must search multiple common locations before giving up, and emit a clear "no kustomize overlay found" message listing what was searched.

**Warning signs:** `/allclear deploy` errors on projects with valid kustomize setups that use non-standard paths.

### Pitfall 3: Missing RBAC / cluster context

**What goes wrong:** kubectl is available but the current kubeconfig context lacks read access to the namespace being checked.

**Why it happens:** kubectl availability does not guarantee authorization.

**How to avoid:** The skill should run `kubectl auth can-i get pods` as a secondary check after confirming kubectl exists, and emit a clear permission error if this fails.

**Warning signs:** `Error from server (Forbidden)` in kubectl output; skill treats this as a diff rather than a permission issue.

### Pitfall 4: Helm diff plugin not installed

**What goes wrong:** Project uses Helm but `helm diff` plugin is not installed; skill fails.

**Why it happens:** helm-diff is a third-party plugin, not bundled with Helm.

**How to avoid:** Check `helm plugin list | grep diff`. If absent, fall back to `helm template <chart> -f <values> | kubectl diff -f -` and note the limitation in the output.

**Warning signs:** `Error: unknown command "diff" for "helm"`.

---

## Code Examples

Verified patterns from official sources:

### kubectl diff with kustomize overlay
```bash
# Source: https://kubernetes.io/docs/reference/kubectl/generated/kubectl_diff/
kubectl diff -k ./overlays/production/
# Exit 0 = in sync, exit 1 = diffs found, exit >1 = error
```

### Extract running image tags per pod
```bash
# Source: https://kubernetes.io/docs/tasks/access-application-cluster/list-all-running-container-images/
kubectl get pods -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.spec.containers[0].image}{"\n"}{end}'
```

### Extract expected image tags from kustomize overlay
```bash
# Source: https://kubectl.docs.kubernetes.io/references/kustomize/kustomization/images/
kubectl kustomize ./overlays/production/ | grep 'image:' | awk '{print $2}' | sort -u
```

### Graceful kubectl skip (bash)
```bash
# Standard bash pattern; same as pulse skill
if ! command -v kubectl >/dev/null 2>&1; then
  echo "AllClear deploy: kubectl not available — skipping deploy verification"
  exit 0
fi
```

### kubectl auth check before proceeding
```bash
# Source: https://kubernetes.io/docs/reference/kubectl/
if ! kubectl auth can-i get pods >/dev/null 2>&1; then
  echo "AllClear deploy: insufficient cluster permissions — check kubeconfig"
  exit 0
fi
```

### Extract configmap from cluster for inspection
```bash
# Source: https://kubernetes.io/docs/reference/kubectl/
kubectl get configmap <name> -n <namespace> -o yaml
```

### Helm fallback when helm-diff plugin absent
```bash
# Render locally, diff against cluster
helm template <release-name> <chart-path> -f values.yaml | kubectl diff -f -
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `kubectl apply --dry-run=client` | `kubectl diff` (server-side dry-run) | kubectl 1.18+ | Server-side catches admission webhook rejections that client-side misses |
| `kustomize build | kubectl apply --dry-run` | `kubectl diff -k <path>` (native) | kubectl 1.14+ | Single command; no pipe needed |
| Manual image tag comparison | `kubectl diff -k` covers image fields | Always available | Images are first-class fields in kubectl diff output |

**Deprecated/outdated:**
- `kubectl apply --dry-run` (client-side): Replaced by `kubectl diff` for comparison purposes; client dry-run does not validate against live state.

---

## Open Questions

1. **Helm chart path discovery**
   - What we know: No universal convention for helm chart location in a repo
   - What's unclear: Whether the skill should auto-detect helm (Chart.yaml presence) or require `--helm` flag from user
   - Recommendation: Auto-detect Chart.yaml; treat as Helm project and try `helm diff` (with helm-diff plugin) then fall back to `helm template | kubectl diff -f -`

2. **Multi-environment targeting**
   - What we know: Kustomize overlays are environment-specific; pulse skill uses `--env` flag
   - What's unclear: Whether deploy skill should default to "production" or require explicit env argument
   - Recommendation: Default to searching for a "production" or "prod" overlay; if multiple overlays exist, list them and ask user to specify

3. **Namespace awareness**
   - What we know: kubectl diff respects namespaces defined in kustomization.yaml
   - What's unclear: Whether to pass `--namespace` explicitly or rely on overlay-defined namespace
   - Recommendation: Rely on overlay-defined namespace; if none set, use current kubeconfig context namespace

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Bats (bash automated testing system) |
| Config file | none — see Phase 13 |
| Quick run command | `bats tests/deploy-verify.bats` |
| Full suite command | `bats tests/` |

### Phase Requirements to Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DPLY-01 | SKILL.md file exists at correct path with valid frontmatter | smoke | `test -f skills/deploy-verify/SKILL.md` | Wave 0 |
| DPLY-02 | SKILL.md references image tag extraction commands | unit (content check) | `grep -q 'jsonpath' skills/deploy-verify/SKILL.md` | Wave 0 |
| DPLY-03 | SKILL.md references configmap comparison | unit (content check) | `grep -q 'configmap' skills/deploy-verify/SKILL.md` | Wave 0 |
| DPLY-04 | SKILL.md includes kubectl availability check | unit (content check) | `grep -q 'command -v kubectl' skills/deploy-verify/SKILL.md` | Wave 0 |
| DPLY-05 | SKILL.md references --diff flag handling | unit (content check) | `grep -q '\-\-diff' skills/deploy-verify/SKILL.md` | Wave 0 |

Note: Full behavioral testing of the skill (Claude actually running kubectl) is manual-only and belongs in Phase 13 integration notes. The above automated checks verify structural correctness of the SKILL.md.

### Sampling Rate

- **Per task commit:** `test -f skills/deploy-verify/SKILL.md && echo PASS`
- **Per wave merge:** `bats tests/` (when Phase 13 tests exist)
- **Phase gate:** SKILL.md present, frontmatter valid, kubectl check present before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `tests/deploy-verify.bats` — covers DPLY-01 through DPLY-05 structural checks (Phase 13)
- [ ] Phase 13 must add integration smoke test for skill file presence

*(No bats infrastructure needed for Phase 12 itself — SKILL.md is a static file; structural checks can use standard shell assertions)*

---

## Sources

### Primary (HIGH confidence)

- [kubectl diff official reference](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_diff/) — exit code semantics, `-k` flag, `KUBECTL_EXTERNAL_DIFF`
- [Kustomize images reference](https://kubectl.docs.kubernetes.io/references/kustomize/kustomization/images/) — image tag management in kustomization.yaml
- [List all running container images](https://kubernetes.io/docs/tasks/access-application-cluster/list-all-running-container-images/) — JSONPath extraction patterns
- `.planning/research/ARCHITECTURE.md` — SKILL.md format, `${CLAUDE_SKILL_DIR}`, plugin conventions
- Official example-plugin SKILL.md — frontmatter fields: name, description, version

### Secondary (MEDIUM confidence)

- [kubectl diff preview changes guide](https://oneuptime.com/blog/post/2026-01-25-kubectl-diff-preview-changes/view) — workflow examples verified against official kubectl docs
- [helm-diff plugin GitHub](https://github.com/databus23/helm-diff) — `helm diff upgrade` command syntax
- [Kustomize image management tutorial](https://oneuptime.com/blog/post/2026-02-09-kustomize-images-tag-management/view) — kustomize build + grep pipeline

### Tertiary (LOW confidence)

- Multiple WebSearch results on kustomize overlay path conventions — no single authoritative source; conventions vary by team

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — kubectl diff and JSONPath are documented official kubectl features
- Architecture: HIGH — SKILL.md pattern established in ARCHITECTURE.md; deploy skill follows pulse skill pattern exactly
- Pitfalls: HIGH — exit code 1 semantics are documented in kubectl diff official reference; others derived from standard Kubernetes operational patterns

**Research date:** 2026-03-15
**Valid until:** 2026-04-15 (kubectl stable, low churn)
