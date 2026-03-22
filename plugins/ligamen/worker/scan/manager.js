/**
 * worker/scan-manager.js — Scan orchestration for Ligamen v2.0 agent scanning.
 *
 * Exports:
 *   getChangedFiles(repoPath, sinceCommit)       - Git diff wrapper
 *   buildScanContext(repoPath, repoId, qe, opts) - Determines scan mode
 *   scanRepos(repoPaths, options, queryEngine)   - Main scan entry point
 *   setAgentRunner(fn)                           - Inject agent invoker (test + MCP server use)
 *
 * Agent invocation uses an injected runner to decouple from Claude's Task tool.
 * Background subagents cannot access MCP tools (Claude Code issue #13254) — all
 * agent invocations run in the foreground via the MCP server's agentRunner.
 *
 * SREL-01 (THE-933): Incremental scan constraint injection
 *   When buildScanContext returns mode='incremental', a hard constraint block
 *   (INCREMENTAL_CONSTRAINT) listing only the changed files is appended to the
 *   prompt before it is passed to agentRunner. This ensures the agent focuses
 *   exclusively on the diff rather than re-scanning the full repo.
 *
 *   When the incremental diff is empty (modified.length === 0), agentRunner is
 *   NOT called and beginScan is NOT called. The result is pushed with
 *   mode="incremental-noop" and findings=null.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { parseAgentOutput } from "./findings.js";
import { registerEnricher, runEnrichmentPass } from "./enrichment.js";
import { createCodeownersEnricher } from "./codeowners.js";
import { extractAuthAndDb } from "./enrichment/auth-db-extractor.js";

// Register CODEOWNERS enricher once at module load (OWN-01).
// Module-level registration runs before the first scan.
registerEnricher("codeowners", createCodeownersEnricher());

// Register auth/DB extractor enricher (AUTHDB-01, AUTHDB-02).
registerEnricher("auth-db", extractAuthAndDb);

// ---------------------------------------------------------------------------
// Logger injection
// ---------------------------------------------------------------------------

/** @type {{ log: Function, info: Function, warn: Function, error: Function, debug: Function } | null} */
let _logger = null;

/**
 * Inject the structured logger. Call from worker/index.js or tests.
 * When not set, scan lifecycle events are silently dropped (safe for tests without logging setup).
 *
 * @param {{ log: Function, info: Function, warn: Function, error: Function, debug: Function } | null} logger
 */
export function setScanLogger(logger) {
  _logger = logger;
}

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Repo type detection
// ---------------------------------------------------------------------------

/**
 * Check if a repo has any service entry-point indicator.
 * Used to exempt docker-compose repos from infra classification (SBUG-02).
 * @param {string} repoPath
 * @returns {boolean}
 */
function _hasServiceEntryPoint(repoPath) {
  // Node.js: package.json with start or serve script
  try {
    const pkgPath = join(repoPath, "package.json");
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      if (pkg.scripts && (pkg.scripts.start || pkg.scripts.serve)) return true;
    }
  } catch { /* ignore */ }
  // Python
  if (existsSync(join(repoPath, "main.py")) || existsSync(join(repoPath, "app.py"))) return true;
  // Go
  if (existsSync(join(repoPath, "main.go"))) return true;
  try {
    if (existsSync(join(repoPath, "cmd"))) return true;
  } catch { /* ignore */ }
  // Java
  try {
    if (existsSync(join(repoPath, "src", "main", "java"))) return true;
  } catch { /* ignore */ }
  // Makefile with server/run targets
  try {
    const makefile = join(repoPath, "Makefile");
    if (existsSync(makefile)) {
      const content = readFileSync(makefile, "utf8");
      if (/^(run|serve|server|start):/m.test(content)) return true;
    }
  } catch { /* ignore */ }
  return false;
}

/**
 * Recursively search for Application.java or *Main.java in a directory (max depth 5).
 * @param {string} dir
 * @param {number} depth
 * @returns {boolean}
 */
function _findJavaEntryPoint(dir, depth = 0) {
  if (depth > 5) return false;
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && (entry.name === "Application.java" || entry.name.endsWith("Main.java"))) {
        return true;
      }
      if (entry.isDirectory() && depth < 5) {
        if (_findJavaEntryPoint(join(dir, entry.name), depth + 1)) return true;
      }
    }
  } catch { /* ignore */ }
  return false;
}

/**
 * Detect whether a repo is a service, library, or infra project.
 * Checks for presence of indicator files — first match wins.
 *
 * @param {string} repoPath
 * @returns {"service" | "library" | "infra"}
 */
export function detectRepoType(repoPath) {
  // Hard infra indicators — always infra, no exemption needed
  const hardInfraIndicators = [
    "kustomization.yaml", "Chart.yaml", "helmfile.yaml",
  ];
  for (const f of hardInfraIndicators) {
    if (existsSync(join(repoPath, f))) return "infra";
  }
  // Check for terraform files
  try {
    const files = readdirSync(repoPath);
    if (files.some((f) => f.endsWith(".tf"))) return "infra";
  } catch { /* ignore */ }
  // Check for overlays/ or terraform/ directories
  if (existsSync(join(repoPath, "overlays")) || existsSync(join(repoPath, "terraform"))) {
    return "infra";
  }

  // SBUG-02: docker-compose is infra ONLY when no service entry-point exists
  const hasDockerCompose = existsSync(join(repoPath, "docker-compose.yml"))
    || existsSync(join(repoPath, "docker-compose.yaml"));
  if (hasDockerCompose) {
    const hasServiceEntryPoint = _hasServiceEntryPoint(repoPath);
    if (!hasServiceEntryPoint) return "infra";
    // else: docker-compose is for local dev, continue to library/service detection
  }

  // Library indicators — no server entry point, has package exports
  // Check if package.json has a "main" or "exports" but no "start" script
  try {
    const pkgPath = join(repoPath, "package.json");
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      const hasStart = pkg.scripts && (pkg.scripts.start || pkg.scripts.serve);
      const hasExports = pkg.main || pkg.exports || pkg.types;
      if (!hasStart && hasExports) return "library";
    }
  } catch { /* ignore */ }

  // Python: if pyproject.toml has [project] but no [project.scripts] entry point
  try {
    const pyproj = join(repoPath, "pyproject.toml");
    if (existsSync(pyproj)) {
      const content = readFileSync(pyproj, "utf8");
      if (content.includes("[project]") && !content.includes("[project.scripts]")) {
        return "library";
      }
    }
  } catch { /* ignore */ }

  // Rust: if Cargo.toml has [lib] but no [[bin]]
  try {
    const cargo = join(repoPath, "Cargo.toml");
    if (existsSync(cargo)) {
      const content = readFileSync(cargo, "utf8");
      if (content.includes("[lib]") && !content.includes("[[bin]]")) {
        return "library";
      }
    }
  } catch { /* ignore */ }

  // Go: go.mod present, no main.go in root, no cmd/ directory → library
  try {
    if (existsSync(join(repoPath, "go.mod"))) {
      const hasMainGo = existsSync(join(repoPath, "main.go"));
      const hasCmdDir = existsSync(join(repoPath, "cmd"));
      if (!hasMainGo && !hasCmdDir) return "library";
    }
  } catch { /* ignore */ }

  // Java: pom.xml or build.gradle present, no Application.java or *Main.java in src/main/java → library
  try {
    const hasPom = existsSync(join(repoPath, "pom.xml"));
    const hasGradle = existsSync(join(repoPath, "build.gradle")) || existsSync(join(repoPath, "build.gradle.kts"));
    if (hasPom || hasGradle) {
      const javaMainDir = join(repoPath, "src", "main", "java");
      if (!existsSync(javaMainDir)) {
        return "library";
      }
      // Check for Application.java or *Main.java — search recursively in src/main/java tree
      const hasAppClass = _findJavaEntryPoint(javaMainDir);
      if (!hasAppClass) return "library";
    }
  } catch { /* ignore */ }

  // Poetry: pyproject.toml with [tool.poetry] but no [tool.poetry.scripts] → library
  try {
    const pyproj = join(repoPath, "pyproject.toml");
    if (existsSync(pyproj)) {
      const content = readFileSync(pyproj, "utf8");
      if (content.includes("[tool.poetry]") && !content.includes("[tool.poetry.scripts]")) {
        return "library";
      }
    }
  } catch { /* ignore */ }

  // Default: service
  return "service";
}

// ---------------------------------------------------------------------------
// Agent runner injection
// ---------------------------------------------------------------------------

/** @type {((prompt: string, repoPath: string) => Promise<string>) | null} */
let agentRunner = null;

/**
 * Inject the agent invoker. Must be called before scanRepos is used in production.
 * Tests inject a mock; MCP server injects the real Claude Task invoker.
 *
 * @param {((prompt: string, repoPath: string) => Promise<string>) | null} fn
 */
export function setAgentRunner(fn) {
  agentRunner = fn;
}

// ---------------------------------------------------------------------------
// getChangedFiles
// ---------------------------------------------------------------------------

/**
 * Get changed files in a repo since a given commit.
 * Uses --name-status (not --name-only) to detect deletions and renames (pitfall 7).
 *
 * @param {string} repoPath - Absolute path to the git repository root
 * @param {string|null} sinceCommit - Base commit hash, or null for full listing
 * @returns {{ modified: string[], deleted: string[], renamed: Array<{from: string, to: string}> }
 *          | { error: string }}
 */
export function getChangedFiles(repoPath, sinceCommit) {
  try {
    let output;

    if (sinceCommit === null) {
      // Full scan — return all tracked files as "modified"
      output = execFileSync("git", ["-C", repoPath, "ls-files"], {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      });
      const files = output.trim().split("\n").filter(Boolean);
      return { modified: files, deleted: [], renamed: [] };
    }

    // Incremental — diff since the given commit
    output = execFileSync(
      "git", ["-C", repoPath, "diff", "--name-status", sinceCommit, "HEAD"],
      { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
    );

    const modified = [];
    const deleted = [];
    const renamed = [];

    for (const line of output.trim().split("\n").filter(Boolean)) {
      if (line.startsWith("D\t")) {
        deleted.push(line.slice(2));
      } else if (line.match(/^R\d*\t/)) {
        // Rename: "R100\told/path\tnew/path"
        const parts = line.split("\t");
        if (parts.length >= 3) {
          renamed.push({ from: parts[1], to: parts[2] });
        }
      } else {
        // M (modified), A (added), C (copied), T (type change), U (unmerged), X (unknown)
        const parts = line.split("\t");
        if (parts.length >= 2) {
          modified.push(parts[1]);
        }
      }
    }

    return { modified, deleted, renamed };
  } catch (_err) {
    return { error: "not a git repo" };
  }
}

// ---------------------------------------------------------------------------
// getCurrentHead
// ---------------------------------------------------------------------------

/**
 * Returns the current HEAD commit hash for a repo.
 * @param {string} repoPath
 * @returns {string}
 */
function getCurrentHead(repoPath) {
  return execFileSync("git", ["-C", repoPath, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
}

// ---------------------------------------------------------------------------
// buildScanContext
// ---------------------------------------------------------------------------

/**
 * Determine scan mode for a repo given its stored repo_state and current options.
 *
 * @param {string} repoPath - Absolute path to the repo
 * @param {number} repoId - DB row id from repos table
 * @param {{ getRepoState: (id: number) => ({ last_scanned_commit: string|null, last_scanned_at: string|null } | null) }} queryEngine
 * @param {{ full?: boolean }} [options]
 * @returns {{ mode: 'full'|'incremental'|'skip', files: null | { modified: string[], deleted: string[], renamed: Array<{from:string,to:string}> } }}
 */
export function buildScanContext(repoPath, repoId, queryEngine, options = {}) {
  // Explicit full-scan override
  if (options.full === true) {
    return { mode: "full", files: null };
  }

  // First scan — no repo_state entry → always full (SCAN-06)
  const repoState = queryEngine.getRepoState(repoId);
  if (repoState === null) {
    return { mode: "full", files: null };
  }

  // Compare stored commit with current HEAD
  const currentHead = getCurrentHead(repoPath);
  if (repoState.last_scanned_commit === currentHead) {
    return { mode: "skip", files: null };
  }

  // Incremental scan — diff since last scanned commit
  const files = getChangedFiles(repoPath, repoState.last_scanned_commit);
  return { mode: "incremental", files };
}

// ---------------------------------------------------------------------------
// buildIncrementalConstraint (SREL-01 / THE-933)
// ---------------------------------------------------------------------------

/**
 * Builds the INCREMENTAL_CONSTRAINT block appended to the agent prompt for
 * incremental scans. Exported as a named constant for testability.
 *
 * @param {string[]} changedFiles - List of modified file paths
 * @returns {string} Constraint text to append to the interpolated prompt
 */
export function buildIncrementalConstraint(changedFiles) {
  const fileList = changedFiles.map((f) => `  - ${f}`).join("\n");
  return [
    "",
    "---",
    "## INCREMENTAL SCAN — CHANGED FILES ONLY",
    "",
    "This is an incremental scan. You MUST only examine the following changed files.",
    "Do NOT read, analyze, or report connections from unchanged files.",
    "Scanning unchanged files wastes time and produces stale duplicate findings.",
    "",
    "Changed files:",
    fileList,
    "---",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// scanRepos
// ---------------------------------------------------------------------------

/**
 * @typedef {{
 *   repoPath: string,
 *   mode: 'full'|'incremental'|'incremental-noop'|'skip',
 *   findings: import('./findings-schema.js').Findings | null,
 *   error?: string
 * }} ScanResult
 */

/**
 * Scan one or more repos by dispatching agents sequentially in the foreground.
 * Background agents cannot access MCP tools (Claude Code issue #13254) — foreground only.
 *
 * Each non-skip, non-noop repo is wrapped in a scan version bracket:
 *   beginScan() is called before agent invocation.
 *   persistFindings() is called on success with the scan version ID.
 *   endScan() is called after persistFindings on the success path only.
 *   On parse failure, endScan is NOT called — prior scan data remains intact.
 *
 * SREL-01: Incremental scans inject a changed-files constraint into the prompt.
 *   When modified.length === 0, the scan is a no-op (no agent, no bracket).
 *
 * @param {string[]} repoPaths - Absolute paths to repos to scan
 * @param {{ full?: boolean }} [options]
 * @param {{
 *   upsertRepo: (repoData: object) => { id: number },
 *   getRepoState: (id: number) => object|null,
 *   beginScan: (repoId: number) => number,
 *   persistFindings: (repoId: number, findings: object, commit: string, scanVersionId: number) => void,
 *   endScan: (repoId: number, scanVersionId: number) => void,
 * }} queryEngine
 * @returns {Promise<ScanResult[]>}
 */
export async function scanRepos(repoPaths, options = {}, queryEngine) {
  if (agentRunner === null) {
    throw new Error("agentRunner not initialized — call setAgentRunner first");
  }

  // Scan-local log helper — no-ops silently when logger not injected
  function slog(level, msg, extra = {}) {
    if (_logger) _logger.log(level, msg, extra);
  }

  // Load shared prompt components once
  const commonRules = readFileSync(join(__dirname, "agent-prompt-common.md"), "utf8");
  const schemaJson = readFileSync(join(__dirname, "agent-schema.json"), "utf8");
  const promptService = readFileSync(join(__dirname, "agent-prompt-service.md"), "utf8");
  const promptLibrary = readFileSync(join(__dirname, "agent-prompt-library.md"), "utf8");
  const promptInfra = readFileSync(join(__dirname, "agent-prompt-infra.md"), "utf8");
  // Legacy prompt kept as fallback
  const promptDeep = readFileSync(join(__dirname, "agent-prompt-deep.md"), "utf8");

  /** @type {ScanResult[]} */
  const results = [];

  // Sequential — for...of (never Promise.all — foreground-only requirement)
  for (const repoPath of repoPaths) {
    // 1. Ensure repo row exists
    const repo = queryEngine.upsertRepo({
      path: repoPath,
      name: basename(repoPath),
      type: "single",
    });

    // 2. Determine scan mode
    const ctx = buildScanContext(repoPath, repo.id, queryEngine, options);

    // 3. Skip — no scan needed (no bracket for no-op scans)
    if (ctx.mode === "skip") {
      slog('DEBUG', 'scan skipped — no changes', { repoPath });
      results.push({ repoPath, mode: "skip", findings: null });
      continue;
    }

    // 3b. Incremental no-op — diff returned empty modified list (SREL-01 / THE-933)
    //     Check BEFORE beginScan — no bracket should be opened for a no-op.
    if (ctx.mode === "incremental" && ctx.files !== null && ctx.files.modified.length === 0) {
      slog('DEBUG', 'incremental-noop — no changed files', { repoPath });
      results.push({ repoPath, mode: "incremental-noop", findings: null });
      continue;
    }

    // 4. Open scan version bracket — records scan start in scan_versions table
    const scanVersionId = queryEngine.beginScan(repo.id);

    // 5. Detect repo type and select prompt
    const repoType = detectRepoType(repoPath);
    let promptTemplate;
    if (repoType === "infra") promptTemplate = promptInfra;
    else if (repoType === "library") promptTemplate = promptLibrary;
    else promptTemplate = promptService;

    slog('DEBUG', 'repo type detected', { repoPath, repoType });

    const interpolatedPrompt = promptTemplate
      .replaceAll("{{REPO_PATH}}", repoPath)
      .replaceAll("{{SERVICE_HINT}}", basename(repoPath))
      .replaceAll("{{COMMON_RULES}}", commonRules.replaceAll("{{REPO_PATH}}", repoPath))
      .replaceAll("{{SCHEMA_JSON}}", schemaJson);

    // 5b. Inject changed-files constraint for incremental scans (SREL-01 / THE-933)
    //     The constraint is a hard directive — "You MUST only examine" — not advisory.
    let finalPrompt = interpolatedPrompt;
    if (ctx.mode === "incremental" && ctx.files !== null) {
      finalPrompt = interpolatedPrompt + buildIncrementalConstraint(ctx.files.modified);
    }

    // 6. Invoke agent (foreground — agentRunner injected by MCP server or test)
    slog('INFO', 'scan started', { repoPath, mode: ctx.mode });
    const rawResponse = await agentRunner(finalPrompt, repoPath);

    // 7. Parse and validate agent output
    const result = parseAgentOutput(rawResponse);

    if (result.valid === false) {
      slog('WARN', 'scan failed — preserving prior data', { repoPath, error: result.error });
      // endScan is NOT called — prior scan data remains intact
      results.push({
        repoPath,
        mode: ctx.mode,
        findings: null,
        error: result.error,
      });
      continue;
    }

    // 7b. Log validation warnings (e.g., skipped services from SVAL-01)
    for (const w of result.warnings) {
      slog('WARN', 'findings validation warning', { repoPath, warning: w });
    }

    // 8. Persist findings and close scan bracket — success path only
    const currentHead = getCurrentHead(repoPath);
    queryEngine.persistFindings(repo.id, result.findings, currentHead, scanVersionId);
    queryEngine.endScan(repo.id, scanVersionId);

    // 9. Run enrichment pass per service — post-scan, after bracket closes
    // ENRICH-01: enrichment runs after core scan. Bracket is already closed above.
    // Enrichment MUST NOT call beginScan/endScan — never opens a new bracket.
    try {
      const services = queryEngine._db
        .prepare('SELECT id, root_path, language, boundary_entry FROM services WHERE repo_id = ?')
        .all(repo.id);
      for (const service of services) {
        await runEnrichmentPass(service, queryEngine._db, _logger, repoPath);
      }
    } catch (err) {
      slog('WARN', 'enrichment pass error', { repoPath, error: err.message });
    }

    slog('INFO', 'scan complete', { repoPath, mode: ctx.mode });
    results.push({ repoPath, mode: ctx.mode, findings: result.findings });
  }

  return results;
}
