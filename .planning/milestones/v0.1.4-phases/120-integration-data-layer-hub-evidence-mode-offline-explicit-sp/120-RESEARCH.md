# Phase 120 Research — Integration Data Layer

**Phase:** 120 — Integration Data Layer (`hub.evidence_mode`, offline, explicit specs, externals shipping)
**Wave:** 5 · **Risk:** Medium · **Owned REQs:** INT-01..05 (5)
**Researched:** 2026-04-26

---

## §1 Hub payload — current shape (`worker/hub-sync/payload.js`)

### State machine for `payload.version` (today)

`buildFindingsBlock()` derives `schemaVersion` purely from two inputs:

```
libraryDepsEnabled == false                       → "1.0"
libraryDepsEnabled == true && all services empty   → "1.0" (HUB-04 fallback)
libraryDepsEnabled == true && any service has deps → "1.1"
```

`buildScanPayload()` then sets `payload.version = findingsBlock.schemaVersion`.
Default `libraryDepsEnabled` is `false` — so `arcanon.config.json` without
`hub.beta_features.library_deps` always emits v1.0.

### `evidence` field shape today

In `payload.js:148`:

```js
...(c.evidence ? { evidence: c.evidence } : {}),
```

So `evidence` on a connection in the payload is always a **plain string** (or
omitted entirely if falsy). No structured form exists.

### Critical caveat — `loadLatestFindings()` does NOT currently SELECT evidence

In `worker/cli/hub.js:307-315`:

```sql
SELECT s.name AS source, c.target_name AS target, c.protocol, c.method, c.path,
       c.crossing
  FROM connections c
  JOIN services s ON s.id = c.source_service_id
  WHERE s.repo_id = ?
```

The CLI loader does **not** currently project `c.evidence` or `c.confidence`
columns — so today's hub uploads never include the `evidence` field at all,
even though the payload code is wired to forward it. **Phase 120 plan 01 must
extend this SELECT** to include `c.evidence`, `c.confidence`, and
`c.source_file` so that the new `evidence_mode` config flag has anything to act
on. (This is in scope as part of "the upload payload's `evidence` field" per
INT-01 — without this fix the flag is a no-op.)

### Available connection columns for hash-only mode

Migration audit (`worker/db/migrations/*.js`):

- `001` — base: `protocol, method, path, source_file, target_file`
- `005` — adds `scan_version_id`
- `008` — adds `crossing`
- `009` — adds `confidence`, `evidence`
- `013` — adds `path_template`

**There is no `line_start` / `line_end` column on connections.** Phase 109's
RESEARCH §D-03 confirmed: "the agent never reports a line number." The verify
endpoint (`worker/server/http.js:33-133` `computeVerdict()`) **computes**
`line_start` / `line_end` at runtime by reading the source file and locating
the literal evidence substring (`content.indexOf(evidence)` then counting
newlines).

### Implication for hash-only mode design

INT-01 spec calls for `{hash, start_line, end_line}`. Since lines are not
persisted, we have two viable paths:

- **(A) Reuse `computeVerdict()` line-derivation logic** at payload-build time:
  re-read `source_file` from disk, locate evidence by `indexOf`, compute
  `start_line`/`end_line`. Hash is `sha256(evidence)`. Files that no longer
  exist or no longer contain the evidence emit `start_line: null, end_line:
  null` (still has hash — hub can correlate by hash even without lines).
- **(B) Hash-only without lines**: emit `{hash}` only, no line numbers.

**Decision: (A).** Reusing `computeVerdict()`'s already-tested line algorithm
keeps the contract close to spec, lets the hub correlate snippets across
re-scans without trusting the plugin's source text, and stays bounded
(file reads happen once per connection during upload, not per request). When
the file is gone or the snippet has moved, fields gracefully become `null`.

**Implication: extract a pure helper** `extractEvidenceLocation(evidence,
sourceFile, projectRoot)` from `computeVerdict()` (lines 90-104) and import it
from both `worker/server/http.js` and `worker/hub-sync/payload.js`. This avoids
duplicating substring + newline-count logic across the two call sites and
keeps a single source of truth for line semantics.

---

## §2 Config flag — `hub.evidence_mode`

### Existing pattern (`hub.beta_features.library_deps`)

In `worker/cli/hub.js:325`:

```js
const libraryDepsEnabled = Boolean(cfg?.hub?.beta_features?.library_deps);
```

Optional-chaining + `Boolean()` cast. Same `cfg = readProjectConfig()` reader.
The same pattern applies to `hub.evidence_mode`:

```js
const evidenceMode = cfg?.hub?.evidence_mode || "full";
```

### Default + valid values

- `"full"` (default — current behavior, byte-identical to v1.1 / v1.0)
- `"hash-only"` (replaces evidence string with `{hash, start_line, end_line}`)
- `"none"` (omits `evidence` field entirely — equivalent to current behavior
  when `c.evidence` is falsy)

Validation: warn-and-fall-back-to-`"full"` on unknown value (don't fail uploads
because of a typo). Also need to validate at payload-build time that the
caller passed a known string.

### State machine — `payload.version` after Phase 120

Using the new flag and preserving back-compat:

```
evidence_mode == "full"  AND libraryDepsEnabled == false                           → "1.0"
evidence_mode == "full"  AND libraryDepsEnabled == true && all services empty      → "1.0" (existing HUB-04 fallback)
evidence_mode == "full"  AND libraryDepsEnabled == true && any service has deps    → "1.1" (existing HUB-03 path)
evidence_mode == "hash-only" (regardless of libraryDeps state)                     → "1.2"
evidence_mode == "none"  (regardless of libraryDeps state)                         → "1.2"
```

**Rationale (pre-flight requirement):** v1.0/v1.1 hub receivers expect
`evidence` to be a string when present. The instant we change the shape (or
omit it intentionally as a contract, not just because data is missing), we
must bump the version so old receivers can hard-fail rather than misinterpret.
`"full"` mode keeps `1.0`/`1.1` to preserve back-compat for receivers that
have not yet adopted v1.2.

### Byte-identical guarantee — load-bearing test

INT-01 + pre-flight: a `"full"` (default) payload at v1.1 (with library deps
enabled and populated) emitted **before** Phase 120 must be byte-identical to
a v1.1 payload emitted **after** Phase 120 — only the version string is
allowed to differ if the version itself bumps. Since `"full"` mode keeps the
existing version derivation, even the version field must not change.

Test must `JSON.stringify(payloadBefore) === JSON.stringify(payloadAfter)` for
identical inputs to prove zero drift.

---

## §3 `/arcanon:sync --offline` semantics

### Current sync flow (`commands/sync.md`, `worker/cli/hub.js cmdSync` /
`cmdUpload`)

Today's flow:

1. Step 1 preflight — `hub.sh status --json` checks credentials. Missing →
   walks user through login flow, exits.
2. Step 2 upload — `hub.sh upload --repo "$REPO_PATH" $FORWARDED_ARGS`. On
   network failure, `cmdUpload` enqueues to retry queue (exit 0 with `⚠`
   warning). On non-retriable HTTP error, exits 1.
3. Step 3 drain — `hub.sh sync $FORWARDED_ARGS` drains queue.

### What `--offline` should do (INT-02 spec)

> Exits 0 with "scan persisted locally, no upload" message. No-op if hub is
> intentionally disabled OR unreachable. Differentiates "offline" (intentional)
> from "hub unreachable" (transient — still no-op but with a different exit
> message).

**Two distinct cases:**

| Case | User intent | Today's behavior | New behavior with `--offline` |
| --- | --- | --- | --- |
| User passes `--offline` | "Don't even try to reach hub. I know I'm offline." | Same as no flag (preflight, then upload attempt). | Skip preflight, skip upload, skip drain. Exit 0 with `scan persisted locally — offline mode (no upload attempted).` |
| `--offline` not passed, hub unreachable | "I tried to upload but network is down." | `cmdUpload` enqueues for retry, exits 0 with `⚠ upload failed, enqueued for retry`. | **Unchanged** (already correct). |

The differentiation is *the user said `--offline`* vs. *we discovered the
hub was unreachable*. Both end with "scan stays local," but the user-facing
message and exit semantics differ.

### Wiring location

`commands/sync.md` Step 0 already parses flags. Add `--offline` to the parse
table. When set:

- Skip Step 1 (preflight — no point checking credentials we won't use).
- Skip Step 2 (upload).
- Skip Step 3 (drain — drain talks to hub).
- Print `scan persisted locally — offline mode (no upload or drain attempted).`
- Exit 0.

`hub.sh upload` flag forwarding: `--offline` does not need to reach `hub.sh`
because the slash command short-circuits before invoking it. Cleaner than
adding a no-op handler on the CLI side. (Note: this conflicts slightly with
the principle of "all logic in CLI for testability"; we accept it because
"do nothing" is the simplest possible test surface.)

---

## §4 `/arcanon:drift openapi --spec`

### Current flow (`scripts/drift-openapi.sh`)

`scripts/drift-openapi.sh:113-123` discovers specs by iterating `LINKED_REPOS`
and calling `find_openapi_spec()` (well-known paths + recursive find). Then
pairs them up and runs `compare_openapi()`.

### What `--spec` should add (INT-04)

> `/arcanon:drift openapi --spec <path>` — explicit spec path, bypasses
> `discoverOpenApiSpecs()` discovery. Repeatable: `--spec repoA/spec.yaml
> --spec repoB/spec.yaml` compares the two.

Two modes:

| Invocation | Behavior |
| --- | --- |
| `/arcanon:drift openapi` | Existing — auto-discover specs in linked repos. |
| `/arcanon:drift openapi --spec A.yaml --spec B.yaml` | Skip discovery; compare exactly the two passed paths. |
| `/arcanon:drift openapi --spec A.yaml` | Error — need at least 2 specs to diff. Exit 2 with friendly message. |
| `/arcanon:drift openapi --spec A.yaml --spec B.yaml --spec C.yaml` | Pairwise compare all 3 (same `<=5 → all pairs`, `>5 → hub-and-spoke` rule already in the script). |

### Wiring

`drift-common.sh` `parse_drift_args()` is a likely host for the new flag (it
already handles `--all`). Need to:

1. Add `--spec` parsing — accumulates into a bash array `EXPLICIT_SPECS=()`.
2. In `drift-openapi.sh`, after `parse_drift_args`, if `${#EXPLICIT_SPECS[@]}
   -gt 0`, replace the discovery block with a loop over the explicit paths
   (validating each `-f`).
3. Repo names for `compare_openapi` — when explicit, use `basename "$path"`
   without the `.yaml` extension as the friendly name.
4. Validation: `--spec` files that don't exist → exit 2 with
   `arcanon:drift openapi: spec not found: <path>`.

### Slash command surface

`commands/drift.md` Step 4 currently passes `$ARCANON_ARGS` through to
`scripts/drift-openapi.sh`. Already supports flag passthrough — no change
needed in the markdown beyond updating the `argument-hint` and adding an
example or two to the docs section. (HELP-01 in Phase 116 will own the
`## Help` section addition; we just need to pass the flag through for now.)

---

## §5 `known-externals.yaml` — catalog file

### File location

Per ROADMAP and INT-05: `plugins/arcanon/data/known-externals.yaml`. The
`data/` directory is new.

### Schema (proposal)

```yaml
# YAML schema:
#   externals:
#     - name: <human-friendly catalog id (kebab-case)>
#       label: <display name shown in UI/list>
#       category: <api | webhook | observability | storage | auth | infra>
#       hosts: [<glob-style host patterns>]
#       ports: [<integers>]               # optional, for non-HTTP services
#       evidence_url: <docs URL>           # optional, for trust signal
externals:
  - name: stripe
    label: Stripe API
    category: api
    hosts: ["api.stripe.com"]
    evidence_url: https://stripe.com/docs/api
  - name: auth0
    label: Auth0
    category: auth
    hosts: ["*.auth0.com"]
```

**Why this shape:**

- `hosts` is an array of glob patterns (NOT regex) — `*.foo.com` style.
  Phase 121 will implement matching using a small glob-to-regex helper. Glob
  syntax is forgiving for non-engineer catalog editors and survives a stricter
  matcher swap later.
- `category` is an enum, not free text — keeps the shape disciplined; UI can
  group by category. We pick: `api | webhook | observability | storage | auth
  | infra`.
- `ports` is optional — only for cases like OpenTelemetry Collector where the
  match signal is "anything talking to port 4317/4318."
- `evidence_url` is optional metadata for the UI (links the catalog entry to
  its docs); never used for matching.
- Top-level key is `externals:` (a list) so the file can grow other top-level
  keys later (e.g., `version: 1`, `deprecated:`) without breaking parsers.
  Consumer in Phase 121 reads `parsed.externals || []`.

### 20-entry catalog (curation)

| # | name | label | category | host pattern(s) |
| --- | --- | --- | --- | --- |
| 1 | stripe | Stripe API | api | api.stripe.com |
| 2 | auth0 | Auth0 | auth | *.auth0.com |
| 3 | okta | Okta | auth | *.okta.com, *.oktapreview.com |
| 4 | dex | Dex Identity Provider | auth | (port-based: 5556, 5557) |
| 5 | otel-collector | OpenTelemetry Collector | observability | (ports 4317, 4318) |
| 6 | s3 | AWS S3 | storage | *.s3.amazonaws.com, s3.*.amazonaws.com |
| 7 | azure-blob | Azure Blob Storage | storage | *.blob.core.windows.net |
| 8 | gcs | Google Cloud Storage | storage | storage.googleapis.com, *.storage.googleapis.com |
| 9 | github | GitHub API | api | api.github.com |
| 10 | slack-webhooks | Slack Webhooks | webhook | hooks.slack.com |
| 11 | pagerduty | PagerDuty | api | api.pagerduty.com, events.pagerduty.com |
| 12 | sentry | Sentry | observability | sentry.io, *.ingest.sentry.io |
| 13 | datadog | Datadog | observability | *.datadoghq.com, *.datadoghq.eu |
| 14 | twilio | Twilio | api | api.twilio.com |
| 15 | sendgrid | SendGrid | api | api.sendgrid.com |
| 16 | mailgun | Mailgun | api | api.mailgun.net, api.eu.mailgun.net |
| 17 | cloudflare | Cloudflare | infra | api.cloudflare.com |
| 18 | segment | Segment | observability | api.segment.io, cdn.segment.com |
| 19 | mixpanel | Mixpanel | observability | api.mixpanel.com |
| 20 | aws-lambda | AWS Lambda | infra | lambda.*.amazonaws.com |

(Heroku and Discord deferred — Heroku platform-host detection is noisier than
the rest; Discord is consumer-grade and rarely shows up in API integrations.)

### Phase 120 scope is **ship the file only**

Per ROADMAP and pre-flight constraint: "`known-externals.yaml` is data, not
code — Phase 121 consumes it. Don't add Node code to ingest the catalog in
Phase 120." So Phase 120 plan 03 is purely:

- Create `plugins/arcanon/data/known-externals.yaml` with header comment,
  schema documentation comment, and 20 entries.
- Add a single bats test that asserts the file exists, parses as valid YAML
  via `yq`, and the parsed `.externals | length` is at least 20.
- No Node code, no loader, no scan-pipeline changes.

---

## §6 Test surfacing

Per hard constraint: "All bats test files go to repo-root `tests/`. Fixtures
under `plugins/arcanon/tests/fixtures/integration/`."

Planned test files:

- `tests/hub-evidence-mode.bats` — config flag parsing + state machine
  end-to-end via spawning `bash hub.sh upload --dry-run` (or equivalent that
  doesn't actually call the network — likely uses an offline-fixture stub).
- `worker/hub-sync/payload.test.js` — extend with v1.2 hash-only matrix +
  byte-identical regression for `"full"` mode at v1.1.
- `tests/sync-offline.bats` — `--offline` short-circuit paths.
- `tests/drift-openapi-explicit-spec.bats` — `--spec A.yaml --spec B.yaml`
  happy path with two real OpenAPI fixtures under
  `plugins/arcanon/tests/fixtures/integration/openapi-a.yaml`,
  `openapi-b.yaml`.
- `tests/known-externals-yaml.bats` — file exists, valid YAML, ≥20 entries.

Node tests stay near the source they exercise (existing convention from
v0.1.3); bats stay at repo root per the hard constraint.

---

## §7 Cross-phase coordination notes

- Phase 121 consumes `known-externals.yaml` and adds the loader + matcher.
  Phase 120 just ships the YAML — Phase 121 will validate the schema choice
  here (glob-pattern hosts, port-only entries for OTel/Dex) when it builds
  the matcher. We pick a forgiving format on purpose so 121 has room.
- Phase 116 owns the `## Help` section addition. Phase 120 should NOT touch
  the `## Help` section of `commands/sync.md` or `commands/drift.md`. The
  `argument-hint` field at the top of the markdown frontmatter IS in scope
  for Phase 120 (it's not in `## Help` — it's in the YAML frontmatter the
  Claude Code host parses).
- Hub team coordination: e-mail / Slack the hub maintainers BEFORE plan 01
  ships, confirming that v1.0/v1.1 receivers tolerate **unknown top-level
  fields** in `payload` (we don't add any in 120, but it's the next likely
  evolution). If they don't tolerate unknown fields, we need a header-level
  `Arcanon-Plugin-Schema-Version: 1.2` content negotiation strategy. This is
  a plan-phase coordination task per ROADMAP pre-flight, not a blocker.

---

## §8 Open questions answered

1. **Q: Does `loadLatestFindings` send evidence today?**
   A: No — the SQL doesn't SELECT `c.evidence`. Plan 01 must extend the SELECT.
   Without this, the `evidence_mode` flag is structurally a no-op.

2. **Q: Where do `start_line`/`end_line` come from?**
   A: Computed at payload-build time from the cited `source_file` and the
   evidence string, reusing the algorithm from
   `computeVerdict()` lines 90-104. When the file is gone or the snippet
   moved, both fields are `null`. Hash is still computed.

3. **Q: Default value?**
   A: `"full"` — preserves byte-identical behavior for every existing user
   and every legacy hub receiver. Active opt-in is required to switch.

4. **Q: Is there a hidden cost to re-reading source files at upload time?**
   A: For a 100-connection scan, this is 100 file reads (most cached by the
   OS). Acceptable. We don't pre-cache because the scan-time and upload-time
   working sets are independent and we don't want to blow scan-time memory on
   "maybe we'll upload later" caches.

5. **Q: Are the `--offline` and existing "hub unreachable" paths
   distinguishable from CI scripts?**
   A: Yes — `--offline` exits 0 with one message, "hub unreachable" exits 0
   with the existing `⚠ upload failed, enqueued for retry` message. CI scripts
   that want to know "did we actually upload?" should grep for `✓ uploaded`
   in stdout — which is unchanged from today.
