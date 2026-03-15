# Phase 11: Pulse Skill - Research

**Researched:** 2026-03-15
**Domain:** Claude Code SKILL.md authoring + kubectl service health checking + git tag version comparison
**Confidence:** HIGH — sourced from official Claude Code skills docs, architecture research, pitfalls research, and verified kubectl/git patterns

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| PULS-01 | `/allclear pulse` skill checks health of running services via kubectl or ingress | SKILL.md frontmatter pattern + kubectl get pods + port-forward to /health |
| PULS-02 | Skill parses /health endpoint responses (alive, ready, status, components) | curl + jq parsing of JSON health body; multiple endpoint formats documented |
| PULS-03 | Skill compares running version to latest git tag | kubectl jsonpath image tag extraction + git describe/tag sort patterns |
| PULS-04 | Skill gracefully skips if kubectl is not available with clear message | `command -v kubectl` guard pattern; established in PITFALLS.md |
| PULS-05 | Skill supports targeting specific environments (dev, staging, prod) | kubectl --namespace flag + --context flag; namespace = environment mapping |
</phase_requirements>

---

## Summary

Phase 11 delivers `skills/pulse/SKILL.md` — the prompt playbook that tells Claude how to perform live service health checking via kubectl. This is a pure SKILL.md deliverable (no hook scripts, no lib/ changes) that instructs Claude to run a sequence of Bash commands against the Kubernetes cluster and report a structured health summary.

The pulse skill has two major technical concerns: (1) kubectl availability is optional — the skill must detect its absence and skip gracefully with a useful message rather than failing; (2) health endpoint parsing is heterogeneous — applications expose `/health`, `/healthz`, `/actuator/health`, or custom paths, each with different JSON shapes. The skill must attempt known paths in priority order and handle non-JSON responses.

The version-comparison flow extracts the running image tag from the deployment spec via `kubectl get deployment -o jsonpath`, then compares it to `git describe --tags --abbrev=0` (or `git tag --sort=version:refname | tail -1`) on the local repo. This answers "is what is running the same as the latest tagged release?"

**Primary recommendation:** Write SKILL.md as a prompt-driven orchestration document. Claude runs Bash commands; the skill tells it which commands to run, in what order, what to parse, and how to format the output. No shell scripts in `scripts/` are needed for this skill — all logic is expressed as step-by-step instructions that Claude follows using its Bash tool.

---

## Standard Stack

### Core

| Library / Tool | Version | Purpose | Why Standard |
|----------------|---------|---------|--------------|
| `kubectl` | any | Query pods, services, deployments | The Kubernetes CLI; no alternatives for cluster introspection |
| `curl` | any | Hit /health endpoints from within pods or via port-forward | Universal HTTP client; available everywhere kubectl is |
| `jq` | any | Parse JSON health responses | Project-wide standard per PLGN-07; same pattern as all other scripts |
| `git` | any | Get latest tag for version comparison | Already required by cross-repo skills; local git operations only |

### Supporting

| Tool | Version | Purpose | When to Use |
|------|---------|---------|-------------|
| `kubectl port-forward` | any | Forward pod port to localhost for curl access | When service has no ingress or external IP |
| `kubectl exec` | any | Run curl inside a pod | Fallback when port-forward is impractical |
| `kubectl get deployment -o jsonpath` | any | Extract running image tag | Primary version extraction method |
| `kubectl get pods -o jsonpath` | any | List pods and their status | Liveness/readiness gate before health check |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `kubectl port-forward` then curl | `kubectl exec -- curl` | exec requires curl inside image; port-forward works without it. Use port-forward as primary, exec as fallback |
| `git describe --tags --abbrev=0` | `git tag --sort=version:refname \| tail -1` | `git describe` fails if no tags at all; the sort pattern is more robust for repos with irregular tagging. Both documented |
| jsonpath with kubectl | `kubectl get deploy -o json \| jq` | jq is more expressive; jsonpath is lighter. Use jsonpath for simple single-field extraction, jq for multi-field |

### Installation

No installation needed. `kubectl`, `curl`, `jq`, and `git` are expected to be present in the developer's environment. Skill must guard for absence of kubectl specifically (PULS-04).

---

## Architecture Patterns

### Recommended File Structure

```
skills/
└── pulse/
    └── SKILL.md              # The only deliverable for this phase
```

No `scripts/`, `references/`, or `examples/` subdirectories are required for v1. All logic is expressed inline in SKILL.md as imperative step-by-step instructions that Claude executes using its Bash tool.

### Pattern 1: Skill as Orchestration Prompt (established project pattern)

**What:** SKILL.md tells Claude what Bash commands to run, in what order, and how to synthesize results. Claude's Bash tool executes each command. The skill is a playbook, not a script.

**When to use:** All five AllClear skills use this pattern. The pulse skill is purely procedural — there is no shared library logic to extract to `lib/`.

**Example frontmatter:**
```yaml
---
name: pulse
description: This skill should be used when the user asks to "check service health", "check if services are running", "run pulse", "check cluster health", "are my services healthy", or asks about the status of running Kubernetes services.
disable-model-invocation: true
allowed-tools: Bash
argument-hint: "[environment]"
---
```

The `disable-model-invocation: true` flag is correct here: this is an explicit action with side effects (cluster queries), not background knowledge. Users invoke it with `/allclear pulse` or `/allclear pulse staging`.

### Pattern 2: Graceful kubectl Skip (established from PITFALLS.md)

**What:** The very first step in the pulse skill checks whether kubectl is available. If not, emit a clear message and stop. Never fail with an error — always exit cleanly.

**When to use:** Required for PULS-04. This is the same pattern as DPLY-04 (deploy skill). Establish it consistently.

**Example instruction in SKILL.md:**
```markdown
## Step 1: Check kubectl availability

Run:
```bash
command -v kubectl > /dev/null 2>&1 || echo "KUBECTL_NOT_FOUND"
```

If output is `KUBECTL_NOT_FOUND`, report:
> kubectl not found in PATH. Install kubectl to use /allclear pulse.
> See: https://kubernetes.io/docs/tasks/tools/

Stop here. Do not continue.
```

### Pattern 3: Environment → Namespace Mapping

**What:** Kubernetes uses namespaces to separate environments. The `$ARGUMENTS` passed to the skill (e.g., `staging`, `prod`) maps directly to a namespace. If no argument is given, default to the current kubectl context's default namespace.

**When to use:** Required for PULS-05.

**Convention:**
```markdown
## Determine target namespace

If `$ARGUMENTS` is empty, run:
```bash
kubectl config view --minify -o jsonpath='{.contexts[0].context.namespace}' 2>/dev/null || echo "default"
```

Otherwise use `$ARGUMENTS` as the namespace name directly.
```

### Pattern 4: Health Endpoint Discovery and Parsing

**What:** Applications expose health endpoints at various paths. The skill should try known paths in priority order, parse the JSON response, and extract the key fields (status, components, version if present).

**Known endpoint paths (priority order):**
1. `/health` — most common custom convention
2. `/healthz` — Kubernetes-style (used by control plane components and some apps)
3. `/actuator/health` — Spring Boot Actuator (Java services)
4. `/ready` — less common readiness alias

**Standard JSON shapes to handle:**

Minimal (most custom services):
```json
{ "status": "ok" }
```

Spring Boot Actuator v2/v3:
```json
{
  "status": "UP",
  "components": {
    "db": { "status": "UP", "details": { "database": "PostgreSQL" } },
    "diskSpace": { "status": "UP" }
  }
}
```

Kubernetes-style livez/readyz (plain text response):
```
ok
```

The skill must handle: HTTP 200 with JSON, HTTP 200 with plain text "ok", HTTP 503 (unhealthy), connection refused (pod not ready), and non-JSON response bodies.

**jq extraction pattern (PLGN-07 compliant):**
```bash
STATUS=$(printf '%s\n' "$HEALTH_RESPONSE" | jq -r '.status // empty' 2>/dev/null)
```

### Pattern 5: Running Version vs Git Tag Comparison

**What:** Extract the image tag from the running deployment, then compare to the latest git tag in the local repo.

**kubectl extraction:**
```bash
# Get image tag for first container of deployment named $SERVICE in namespace $NS
IMAGE=$(kubectl get deployment "$SERVICE" -n "$NS" \
  -o jsonpath='{.spec.template.spec.containers[0].image}' 2>/dev/null)
# Image is "registry/name:tag" — extract tag
RUNNING_TAG="${IMAGE##*:}"
```

**Git latest tag:**
```bash
# Method 1: git describe (fails if no tags)
LATEST_TAG=$(git describe --tags --abbrev=0 2>/dev/null)
# Method 2: sort-based (more robust for non-annotated tags)
LATEST_TAG=$(git tag --sort=version:refname 2>/dev/null | tail -1)
```

**Comparison logic:**
```bash
if [ "$RUNNING_TAG" = "$LATEST_TAG" ]; then
  echo "UP TO DATE: $SERVICE running $RUNNING_TAG (matches latest tag)"
else
  echo "DRIFT: $SERVICE running $RUNNING_TAG, latest tag is $LATEST_TAG"
fi
```

**Edge cases the SKILL.md must address:**
- No git tags at all: `git tag` returns empty → report "no tags found, cannot compare"
- Image uses digest not tag (`:sha256@...`): report as-is, cannot compare to semver tag
- Deployment not found: `kubectl` returns error → skip service with note
- Multiple containers in a pod: use `containers[0]` as primary, note others exist

### Anti-Patterns to Avoid

- **Hard-failing on kubectl absence:** Never `exit 1` or produce an error trace when kubectl is not installed. Always a graceful informational message.
- **Port-forwarding to multiple services sequentially without cleanup:** `kubectl port-forward` runs in the background. The skill instructions must include cleanup: `kill $PF_PID` after each curl.
- **Assuming all services have the same health endpoint path:** Try paths in order, do not hardcode `/health` only.
- **Comparing version to git HEAD:** Compare to latest *tag*, not HEAD. HEAD may be ahead of the latest release tag.
- **Running kubectl without namespace flag:** Never assume default namespace. Always pass `-n $NAMESPACE`.
- **Blocking on missing jq:** The skill uses jq for JSON parsing per PLGN-07. If the JSON is not parseable (e.g., plain text "ok"), fall back to HTTP status code check.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Health check invocation | Custom HTTP client in skill | `curl -sf --max-time 5` | curl handles timeouts, redirects, TLS |
| Version tag sorting | Custom semver parser in bash | `git tag --sort=version:refname` | git's built-in sort handles semver natively |
| Namespace detection | Parse kubeconfig manually | `kubectl config view --minify` | kubectl owns kubeconfig parsing |
| JSON field extraction | Regex on health response | `jq -r '.status // empty'` | Project-wide jq standard (PLGN-07) |
| Pod port access | Write a proxy script | `kubectl port-forward` | kubectl does this correctly; cleanup is the only concern |

**Key insight:** The pulse skill is a prompt, not a script. Do not extract logic into `scripts/pulse.sh`. Claude executes the Bash commands directly. A shell script adds indirection without benefit for a skill that runs infrequently and interactively.

---

## Common Pitfalls

### Pitfall 1: kubectl Not Available — Fail Instead of Skip

**What goes wrong:** Skill tries to run `kubectl get pods` and produces a bash error. Claude reports "command not found" without context.

**Why it happens:** Forgetting the graceful skip requirement (PULS-04).

**How to avoid:** First instruction in SKILL.md: check `command -v kubectl`. If absent, print human-readable message and stop. This is documented in PITFALLS.md (Integration Gotchas table) and is a "Looks Done But Isn't" checklist item.

**Warning signs:** `/allclear pulse` on a machine without kubectl emits bash errors rather than a clean "kubectl not found" message.

---

### Pitfall 2: Port-Forward Process Leak

**What goes wrong:** `kubectl port-forward` is started in the background for a health check, the curl runs, but the PID is never killed. Accumulated background processes linger.

**Why it happens:** Skill instructions start `kubectl port-forward ... &` to get the PID but omit the `kill $PF_PID` cleanup step.

**How to avoid:** SKILL.md must include explicit cleanup after each port-forward curl:
```bash
kubectl port-forward pod/$POD_NAME 8080:8080 &
PF_PID=$!
sleep 1  # allow port-forward to establish
curl -sf http://localhost:8080/health
kill $PF_PID 2>/dev/null
```

**Warning signs:** Multiple `kubectl port-forward` processes accumulate when pulse is run repeatedly.

---

### Pitfall 3: Health Endpoint Assumes JSON Response

**What goes wrong:** `jq` parse fails on plain-text responses ("ok", "healthy"). Skill reports service as DOWN when it is actually UP.

**Why it happens:** `/healthz` endpoints (Kubernetes-style) often return plain text `ok` with HTTP 200.

**How to avoid:** Check HTTP status code first (curl `-w "%{http_code}"`). If 200, treat as healthy regardless of JSON parse result. Only use jq output for enrichment (component details), not as the health gate.

**Warning signs:** Services that return plain-text health responses are reported as unhealthy even when curl exits 0.

---

### Pitfall 4: Comparing Running Tag to git HEAD

**What goes wrong:** Skill reports drift when there is none, or vice versa, because it compares the running image tag to git HEAD commit hash rather than the latest annotated tag.

**Why it happens:** Using `git rev-parse HEAD` or `git log -1 --format=%H` instead of `git describe --tags --abbrev=0`.

**How to avoid:** Always use `git tag --sort=version:refname | tail -1` or `git describe --tags --abbrev=0`. Document the fallback for repos with no tags.

---

### Pitfall 5: SKILL.md Not Using `disable-model-invocation: true`

**What goes wrong:** Claude auto-invokes the pulse skill during normal code editing sessions when conversation mentions "service" or "health," unexpectedly running kubectl commands.

**Why it happens:** Forgetting `disable-model-invocation: true` for action-type skills.

**How to avoid:** Pulse is a user-invoked action with cluster side effects. Set `disable-model-invocation: true` in frontmatter. Confirmed pattern from the official skills docs: "for workflows with side effects or that you want to control timing."

---

### Pitfall 6: Missing `-n $NAMESPACE` on Every kubectl Command

**What goes wrong:** kubectl defaults to the `default` namespace when `--namespace` is omitted. Services in `staging` or `prod` namespaces are invisible, making the skill appear to find nothing.

**Why it happens:** Forgetting to thread the namespace variable through every kubectl invocation.

**How to avoid:** Define `NS="$TARGET_NAMESPACE"` at the top of the skill's bash block and use `-n "$NS"` on every single kubectl call. Make this explicit in the SKILL.md instructions.

---

## Code Examples

Verified patterns from official sources and project standards:

### kubectl availability guard (PITFALLS.md pattern)
```bash
# Source: PITFALLS.md "Integration Gotchas" table
command -v kubectl > /dev/null 2>&1 || {
  echo "kubectl not found in PATH. Install kubectl to use /allclear pulse."
  echo "See: https://kubernetes.io/docs/tasks/tools/"
  # Stop here — graceful skip, not error
}
```

### Extract namespace from context or argument
```bash
# If $1 (environment argument) provided, use it; else detect from kubectl context
NS="${1:-}"
if [ -z "$NS" ]; then
  NS=$(kubectl config view --minify -o jsonpath='{.contexts[0].context.namespace}' 2>/dev/null)
  NS="${NS:-default}"
fi
```

### Get all deployments in namespace
```bash
kubectl get deployments -n "$NS" -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' 2>/dev/null
```

### Extract running image tag from deployment
```bash
# Source: https://kubernetes.io/docs/reference/kubectl/quick-reference/
IMAGE=$(kubectl get deployment "$DEPLOY_NAME" -n "$NS" \
  -o jsonpath='{.spec.template.spec.containers[0].image}' 2>/dev/null)
RUNNING_TAG="${IMAGE##*:}"   # strip everything up to and including last ':'
```

### Port-forward and curl health endpoint with cleanup
```bash
# Pick a running pod for the deployment
POD=$(kubectl get pods -n "$NS" -l "app=$DEPLOY_NAME" \
  -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)

# Start port-forward in background
kubectl port-forward -n "$NS" "pod/$POD" 18080:8080 > /dev/null 2>&1 &
PF_PID=$!
sleep 1

# Try health endpoints in priority order
for PATH_ATTEMPT in /health /healthz /actuator/health /ready; do
  HTTP_CODE=$(curl -s -o /tmp/allclear_health_body -w "%{http_code}" \
    --max-time 5 "http://localhost:18080${PATH_ATTEMPT}" 2>/dev/null)
  if [ "$HTTP_CODE" = "200" ]; then
    HEALTH_BODY=$(cat /tmp/allclear_health_body)
    break
  fi
done

# Cleanup
kill "$PF_PID" 2>/dev/null
```

### Parse health response (jq, PLGN-07 pattern)
```bash
# Source: PLGN-07 — use printf '%s\n' ... | jq -r '... // empty'
STATUS=$(printf '%s\n' "$HEALTH_BODY" | jq -r '.status // empty' 2>/dev/null)
# Normalize: Spring Boot uses "UP"/"DOWN", custom services may use "ok"/"error"
case "${STATUS,,}" in   # lowercase
  up|ok|healthy|pass) HEALTH="HEALTHY" ;;
  down|error|fail*)   HEALTH="UNHEALTHY" ;;
  "")                 HEALTH=$([ "$HTTP_CODE" = "200" ] && echo "HEALTHY" || echo "UNHEALTHY") ;;
  *)                  HEALTH="UNKNOWN ($STATUS)" ;;
esac
```

### Get latest git tag
```bash
# Method 1: git describe (preferred if tags are annotated)
LATEST_TAG=$(git describe --tags --abbrev=0 2>/dev/null)
# Method 2: sort-based fallback (works for lightweight tags, handles semver sort)
if [ -z "$LATEST_TAG" ]; then
  LATEST_TAG=$(git tag --sort=version:refname 2>/dev/null | tail -1)
fi
LATEST_TAG="${LATEST_TAG:-no-tags}"
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `/healthz` only (Kubernetes convention) | `/health` for apps, `/healthz` for infra components | ~2019 | Application health at `/health`, cluster components at `/healthz` |
| `kubectl exec -- curl` to hit health endpoint | `kubectl port-forward` + local curl | Current | port-forward does not require curl in the container image |
| `git describe --tags` only | `git tag --sort=version:refname \| tail -1` as fallback | Current | Handles repos without annotated tags |
| Spring Boot `/health` | Spring Boot `/actuator/health` | Spring Boot 2.x+ | Actuator prefix added; `/health` still works via compatibility layer in most setups |

**Deprecated/outdated:**
- `/healthz` as the application health endpoint: now primarily for Kubernetes control plane components. Applications should use `/health` or `/actuator/health`.
- `kubectl get pods --field-selector=status.phase=Running`: overly broad; use `-l app=$name` label selectors for per-service queries.

---

## Open Questions

1. **Service discovery: how to enumerate services to check**
   - What we know: kubectl can list all deployments in a namespace; `kubectl get deployments -n $NS`
   - What's unclear: Should the skill check ALL deployments in the namespace, or only named ones? With 20+ microservices in `prod`, listing all could be very slow.
   - Recommendation: Default to listing all deployments; add note that `$ARGUMENTS` can be `[environment] [service-name]` to target a specific service.

2. **Port discovery: which container port to forward**
   - What we know: Container port is declared in the pod spec at `.spec.containers[0].ports[0].containerPort`
   - What's unclear: Services with multiple ports (e.g., HTTP 8080 + gRPC 9090) — which to use for health check?
   - Recommendation: Skill instructions should prefer port 8080, fall back to `containerPort` from pod spec, and note that non-standard ports may require explicit configuration.

3. **kubectl context vs --context flag for multi-cluster**
   - What we know: `$ARGUMENTS` maps environment to namespace. But `dev`/`staging`/`prod` may be in separate clusters with separate kubectl contexts.
   - What's unclear: Does the user's kubectl context already point to the right cluster, or should the skill support `--context prod-cluster`?
   - Recommendation: For v1, assume the current kubectl context is correct. Document that `kubectl config use-context prod-cluster` must be run first for multi-cluster setups. Revisit in v2.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Bats-core (used across all AllClear hook tests) |
| Config file | `tests/pulse.bats` — Wave 0 gap |
| Quick run command | `bats tests/pulse.bats` |
| Full suite command | `bats tests/` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PULS-01 | SKILL.md exists with correct frontmatter | smoke | `test -f skills/pulse/SKILL.md && grep -q 'name: pulse' skills/pulse/SKILL.md` | Wave 0 gap |
| PULS-02 | Health response parser handles UP/DOWN/ok/plain-text | unit | `bats tests/pulse.bats` (mock curl responses) | Wave 0 gap |
| PULS-03 | Version comparison logic handles tag match and drift | unit | `bats tests/pulse.bats` (mock kubectl + git) | Wave 0 gap |
| PULS-04 | Graceful skip when kubectl absent | unit | `bats tests/pulse.bats` (PATH without kubectl) | Wave 0 gap |
| PULS-05 | Namespace argument respected in kubectl calls | unit | `bats tests/pulse.bats` (verify -n $NS in command) | Wave 0 gap |

**Note:** PULS-01 is tested by verifying the SKILL.md file and its frontmatter exist with correct content. PULS-02 through PULS-05 are tested by extracting the bash logic embedded in SKILL.md into a thin `scripts/pulse-check.sh` helper that bats can mock and test. The skill itself is a prompt; tests verify the underlying command patterns it instructs Claude to run.

### Sampling Rate
- **Per task commit:** `test -f skills/pulse/SKILL.md && grep -q 'name: pulse' skills/pulse/SKILL.md`
- **Per wave merge:** `bats tests/pulse.bats` (if tests exist)
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/pulse.bats` — covers PULS-02 through PULS-05 with mocked kubectl/curl/git
- [ ] `scripts/pulse-check.sh` — optional helper that encapsulates bash patterns for testability

*(If no test infrastructure exists yet: `bats --version` to verify bats-core installation; install with `brew install bats-core` or `npm install -g bats`)*

---

## Sources

### Primary (HIGH confidence)
- Official Claude Code Skills docs (https://code.claude.com/docs/en/skills) — frontmatter fields, `disable-model-invocation`, `allowed-tools`, `$ARGUMENTS` substitution, skill invocation control
- `.planning/research/ARCHITECTURE.md` — Pattern 3 (Skills as Orchestration Prompts), Pattern 4 (Shared Library), project structure, plugin root path convention
- `.planning/research/PITFALLS.md` — kubectl graceful skip pattern (Integration Gotchas table), "Looks Done But Isn't" checklist item for kubectl skip
- `.planning/PROJECT.md` — SKILL.md format constraint, no external service deps, framework-agnostic requirement
- Official plugin-dev SKILL.md at `~/.claude/plugins/marketplaces/claude-plugins-official/plugins/plugin-dev/skills/skill-development/SKILL.md` — writing style (imperative form, third-person description), progressive disclosure, 1,500-2,000 word target
- Kubernetes official docs (https://kubernetes.io/docs/reference/kubectl/quick-reference/) — kubectl get deployment jsonpath, port-forward usage, namespace flag

### Secondary (MEDIUM confidence)
- https://kubernetes.io/docs/reference/using-api/health-checks/ — livez/readyz endpoint formats, HTTP status code semantics
- https://docs.spring.io/spring-boot/api/rest/actuator/health.html — Spring Boot Actuator health response format (components, status UP/DOWN)
- Baeldung: https://www.baeldung.com/ops/kubernetes-get-current-image — kubectl get deploy -o jsonpath image extraction examples
- Web search results on kubectl port-forward + curl patterns (2026)

### Tertiary (LOW confidence)
- Web search results on git tag --sort=version:refname pattern — multiple sources agree, not formally verified against official git docs but behavior is well-established

---

## Metadata

**Confidence breakdown:**
- Standard stack (kubectl/curl/jq/git): HIGH — all are project-established tools with no alternatives
- SKILL.md format and frontmatter: HIGH — verified against official docs and live plugin examples
- Architecture (skill as orchestration prompt): HIGH — established pattern in ARCHITECTURE.md
- kubectl command patterns: HIGH — verified against official Kubernetes docs
- Health endpoint path discovery: MEDIUM — multiple conventions exist; priority order is an editorial choice
- Version comparison logic: MEDIUM — git tag patterns verified; edge cases (no tags, digest-based images) flagged

**Research date:** 2026-03-15
**Valid until:** 2026-04-15 (stable domain — kubectl and SKILL.md format are not fast-moving)
