/**
 * worker/hub-sync/payload.js — Transform internal findings → ScanPayloadV1.
 *
 * The Arcanon Hub server (arcanon-hub/packages/api-server) accepts scans in
 * the `ScanPayloadV1` envelope. This module adapts the plugin's internal
 * findings shape (produced by worker/scan/findings.js) to that envelope.
 *
 * Hub contract reference:
 *   POST https://api.arcanon.dev/api/v1/scans/upload
 *   - version: "1.0" (exact literal)
 *   - metadata.tool ∈ {claude-code, copilot, cursor, cli, unknown} — we send "claude-code"
 *   - metadata.repo_name, metadata.commit_sha are required
 *   - metadata.project_slug is required for org-scoped API keys
 *   - findings.services is required and must have ≥ 1 entry
 *   - All connection.source fields must reference a known service name
 *
 * Required fields missing → throw PayloadError (caller should surface to user).
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { extractEvidenceLocation } from "./evidence-location.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Server-side enum. Keep in sync with arcanon-hub scan_payload.py KNOWN_TOOLS. */
export const KNOWN_TOOLS = Object.freeze([
  "claude-code",
  "copilot",
  "cursor",
  "cli",
  "unknown",
]);

/**
 * Server-side enum for hub.evidence_mode (Phase 120-01 INT-01).
 *
 * - "full"      → connection.evidence emitted as a string when present
 *                 (current behavior, byte-identical to v1.0/v1.1).
 * - "hash-only" → connection.evidence replaced by {hash, start_line, end_line}
 *                 object. Bumps payload.version to "1.2".
 * - "none"      → connection.evidence omitted entirely. Bumps payload.version
 *                 to "1.2".
 *
 * Default at every entry point is "full" — preserves byte-identical output
 * for every existing caller and every legacy hub receiver.
 */
export const ALLOWED_EVIDENCE_MODES = Object.freeze(["full", "hash-only", "none"]);

/** Raised when a payload cannot be built from the findings. */
export class PayloadError extends Error {
  constructor(message, { field } = {}) {
    super(message);
    this.name = "PayloadError";
    this.field = field;
  }
}

function readPluginVersion() {
  try {
    const pkgPath = path.resolve(__dirname, "..", "..", "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    return pkg.version || "unknown";
  } catch {
    return "unknown";
  }
}

function gitSafe(args, cwd) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Derive git metadata for a repo path.
 * Returns best-effort values — every field is nullable.
 *
 * @param {string} repoPath absolute path to a git repo
 * @returns {{ repo_url: string|null, branch: string|null, commit_sha: string|null }}
 */
export function deriveGitMetadata(repoPath) {
  return {
    repo_url: gitSafe(["remote", "get-url", "origin"], repoPath),
    branch: gitSafe(["rev-parse", "--abbrev-ref", "HEAD"], repoPath),
    commit_sha: gitSafe(["rev-parse", "HEAD"], repoPath),
  };
}

/**
 * Project a connection's evidence field per `evidenceMode` (INT-01).
 *
 * Returns a spread-ready object so the call site stays readable. The HUB-05
 * byte-identical contract is preserved by short-circuiting on falsy
 * `c.evidence` — any mode emits the same `{}` (no key) when there's no
 * snippet to project.
 *
 * @param {object} c — connection row (may carry .evidence and .source_file)
 * @param {"full"|"hash-only"|"none"} evidenceMode
 * @param {string|null|undefined} projectRoot — used for line derivation in
 *        hash-only mode; ignored otherwise
 * @returns {object} — `{}` or `{evidence: ...}`
 */
function projectEvidence(c, evidenceMode, projectRoot) {
  // Common short-circuit — preserves HUB-05 byte-identical contract: when
  // there's no evidence, no mode emits the field.
  if (!c.evidence) return {};
  if (evidenceMode === "none") return {};
  if (evidenceMode === "hash-only") {
    const loc = extractEvidenceLocation(
      c.evidence,
      c.source_file || null,
      projectRoot || null,
    );
    return {
      evidence: {
        hash: loc.hash,
        start_line: loc.start_line,
        end_line: loc.end_line,
      },
    };
  }
  // "full" — preserve byte-identical legacy behavior.
  return { evidence: c.evidence };
}

/**
 * Build the `findings` section of ScanPayloadV1 from a plugin scan result.
 *
 * Reconciles `connection.source` to `service.name` — connections that reference
 * services not in the `services` array are dropped with a warning. The hub's
 * Pydantic validator 422s on orphan connections, so we filter proactively.
 *
 * Schema version derivation (state machine):
 *   - evidenceMode="full" + libraryDepsEnabled=false                  → "1.0"
 *   - evidenceMode="full" + libraryDepsEnabled=true, no deps          → "1.0" (HUB-04 fallback)
 *   - evidenceMode="full" + libraryDepsEnabled=true + populated deps  → "1.1"
 *   - evidenceMode="hash-only" (regardless of libraryDeps state)      → "1.2"
 *   - evidenceMode="none"      (regardless of libraryDeps state)      → "1.2"
 *
 * When `opts.libraryDepsEnabled` is true AND at least one service carries a
 * non-empty `dependencies` array, per-service `dependencies` are emitted.
 * Otherwise the dependencies key is suppressed (HUB-05 byte-identical
 * contract).
 *
 * @param {{ services: Array, connections?: Array, schemas?: Array }} findings
 * @param {{
 *   libraryDepsEnabled?: boolean,
 *   evidenceMode?: "full"|"hash-only"|"none",
 *   projectRoot?: string
 * }} [opts]
 * @returns {{ services: Array, connections: Array, schemas: Array, actors: Array, schemaVersion: "1.0"|"1.1"|"1.2", warnings: string[] }}
 */
export function buildFindingsBlock(findings, opts = {}) {
  const services = Array.isArray(findings?.services) ? findings.services : [];
  const connections = Array.isArray(findings?.connections) ? findings.connections : [];
  const schemas = Array.isArray(findings?.schemas) ? findings.schemas : [];

  const serviceNames = new Set(services.map((s) => s.name).filter(Boolean));
  const warnings = [];

  const validConnections = connections.filter((c) => {
    if (!c.source || !serviceNames.has(c.source)) {
      warnings.push(`dropped connection with unknown source "${c.source}" → "${c.target}"`);
      return false;
    }
    return true;
  });

  // Library deps (HUB-01, HUB-02, HUB-03):
  // Emit per-service `dependencies` key + bump schemaVersion to 1.1 ONLY when
  // the feature flag is on AND at least one service has a non-empty deps array.
  // Flag off → v1.0 regardless of data. Flag on + all empty → v1.0 fallback.
  const libraryDepsEnabled = opts.libraryDepsEnabled === true;
  const anyServiceHasDeps =
    libraryDepsEnabled &&
    services.some((s) => Array.isArray(s.dependencies) && s.dependencies.length > 0);
  const schemaVersion = anyServiceHasDeps ? "1.1" : "1.0";

  // Evidence mode (INT-01) — defaults to "full" so every legacy caller stays
  // byte-identical. Unknown values warn-and-fall-back; never throws (a typo
  // in arcanon.config.json must not break uploads).
  const rawMode = opts.evidenceMode;
  let evidenceMode = "full";
  if (rawMode != null && rawMode !== "full") {
    if (ALLOWED_EVIDENCE_MODES.includes(rawMode)) {
      evidenceMode = rawMode;
    } else {
      console.warn(
        `hub-sync/payload: unknown evidence_mode '${rawMode}', falling back to 'full'`,
      );
    }
  }
  const finalSchemaVersion =
    evidenceMode === "hash-only" || evidenceMode === "none" ? "1.2" : schemaVersion;

  return {
    services: services.map((s) => ({
      name: s.name,
      root_path: s.root_path || ".",
      language: s.language || "unknown",
      type: s.type || "service",
      ...(s.boundary_entry ? { boundary_entry: s.boundary_entry } : {}),
      ...(s.confidence ? { confidence: s.confidence } : {}),
      exposes: Array.isArray(s.exposes) ? s.exposes : [],
      // Per-service dependencies are only emitted when the envelope is v1.1.
      // At v1.0 (flag off OR every service empty) the key is omitted entirely
      // — this is the HUB-05 byte-identical guarantee for existing callers.
      ...(anyServiceHasDeps
        ? { dependencies: Array.isArray(s.dependencies) ? s.dependencies : [] }
        : {}),
    })),
    connections: validConnections.map((c) => ({
      source: c.source,
      target: c.target,
      protocol: c.protocol || "unknown",
      ...(c.method ? { method: c.method } : {}),
      ...(c.path ? { path: c.path } : {}),
      ...(c.crossing ? { crossing: c.crossing } : {}),
      ...(c.confidence ? { confidence: c.confidence } : {}),
      ...projectEvidence(c, evidenceMode, opts.projectRoot),
    })),
    schemas,
    actors: Array.isArray(findings?.actors) ? findings.actors : [],
    schemaVersion: finalSchemaVersion,
    warnings,
  };
}

/**
 * Build a ScanPayloadV1 envelope ready to POST to /api/v1/scans/upload.
 *
 * @param {object} opts
 * @param {{ services, connections?, schemas? }} opts.findings — plugin findings
 * @param {string} opts.repoPath — absolute path to the repo being reported
 * @param {string} [opts.repoName] — overrides `basename(repoPath)`
 * @param {string} [opts.commitSha] — overrides derived git commit_sha
 * @param {string} [opts.branch] — overrides derived branch
 * @param {string} [opts.projectSlug] — required for org-scoped keys
 * @param {string} [opts.tool="claude-code"] — must be in KNOWN_TOOLS
 * @param {string} [opts.scanMode="full"] — "full" or "incremental"
 * @param {Date|string} [opts.startedAt] — ISO 8601 timestamp, defaults to now
 * @param {Date|string} [opts.completedAt] — ISO 8601 timestamp, defaults to now
 * @param {number} [opts.filesScanned]
 * @param {boolean} [opts.libraryDepsEnabled=false] — HUB-03 feature flag; when true AND services carry non-empty `dependencies`, emits v1.1 payload
 * @param {"full"|"hash-only"|"none"} [opts.evidenceMode] — INT-01 hub.evidence_mode flag; defaults to "full" (byte-identical to legacy). "hash-only" / "none" bump payload.version to "1.2".
 * @param {string} [opts.projectRoot] — INT-01: absolute root used for evidence line-derivation in hash-only mode. Falls back to `repoPath` when omitted.
 * @returns {{payload: object, warnings: string[]}}
 * @throws {PayloadError} if required fields cannot be derived
 */
export function buildScanPayload(opts) {
  const {
    findings,
    repoPath,
    repoName,
    commitSha,
    branch,
    projectSlug,
    tool = "claude-code",
    scanMode = "full",
    startedAt,
    completedAt,
    filesScanned,
    libraryDepsEnabled = false,  // HUB-03 feature flag passthrough
    evidenceMode,                // INT-01 — handled in buildFindingsBlock (defaults to "full")
    projectRoot,                 // INT-01 — falls back to repoPath for hash-only line derivation
  } = opts || {};

  if (!findings || typeof findings !== "object") {
    throw new PayloadError("findings is required", { field: "findings" });
  }
  if (!repoPath) {
    throw new PayloadError("repoPath is required", { field: "repoPath" });
  }
  if (!KNOWN_TOOLS.includes(tool)) {
    throw new PayloadError(`tool "${tool}" is not in KNOWN_TOOLS`, { field: "tool" });
  }

  const gitMeta = deriveGitMetadata(repoPath);
  const finalCommit = commitSha || gitMeta.commit_sha;
  if (!finalCommit) {
    throw new PayloadError(
      "commit_sha could not be derived (not a git repo and no commitSha passed)",
      { field: "commit_sha" },
    );
  }

  const finalRepoName = repoName || path.basename(path.resolve(repoPath));
  if (!finalRepoName) {
    throw new PayloadError("repo_name could not be derived", { field: "repo_name" });
  }

  const findingsBlock = buildFindingsBlock(findings, {
    libraryDepsEnabled,
    evidenceMode,
    projectRoot: projectRoot || repoPath, // INT-01 — line derivation needs an absolute root
  });
  if (findingsBlock.services.length === 0) {
    throw new PayloadError("findings.services must contain at least one entry", {
      field: "findings.services",
    });
  }

  const toIso = (v) => (v instanceof Date ? v.toISOString() : v || new Date().toISOString());

  const payload = {
    version: findingsBlock.schemaVersion,   // "1.0" or "1.1" — derived by buildFindingsBlock
    metadata: {
      tool,
      tool_version: readPluginVersion(),
      scan_mode: scanMode,
      ...(gitMeta.repo_url ? { repo_url: gitMeta.repo_url } : {}),
      repo_name: finalRepoName,
      ...(branch || gitMeta.branch ? { branch: branch || gitMeta.branch } : {}),
      commit_sha: finalCommit,
      started_at: toIso(startedAt),
      completed_at: toIso(completedAt),
      ...(typeof filesScanned === "number" ? { files_scanned: filesScanned } : {}),
      ...(projectSlug ? { project_slug: projectSlug } : {}),
    },
    findings: {
      services: findingsBlock.services,
      connections: findingsBlock.connections,
      schemas: findingsBlock.schemas,
      actors: findingsBlock.actors,
    },
  };

  return { payload, warnings: findingsBlock.warnings };
}

/** Hard server-side limit. Payloads above this size will 413. */
export const MAX_PAYLOAD_BYTES = 10 * 1024 * 1024;

/**
 * JSON-stringify a payload and reject if it exceeds the hub's 10 MB limit.
 * Returns the serialized body and byte length.
 *
 * @param {object} payload
 * @returns {{ body: string, bytes: number }}
 */
export function serializePayload(payload) {
  const body = JSON.stringify(payload);
  const bytes = Buffer.byteLength(body, "utf8");
  if (bytes > MAX_PAYLOAD_BYTES) {
    throw new PayloadError(
      `payload is ${bytes} bytes, exceeds hub limit of ${MAX_PAYLOAD_BYTES} bytes`,
      { field: "payload_size" },
    );
  }
  return { body, bytes };
}
