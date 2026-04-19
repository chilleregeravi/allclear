/**
 * dep-collector.js — Library dependency enrichment module (v5.8.0 / THE-1019)
 *
 * Reads manifests for 7 ecosystems and returns normalized DependencyRow shapes
 * for the manager's Phase B loop to persist via queryEngine.upsertDependency.
 *
 * Contract:
 *   - MUST NOT call beginScan/endScan — runs AFTER the bracket closes
 *   - MUST NOT access the database — it is a pure parser/shaper
 *   - Production deps only (DEP-07) — devDependencies are NEVER emitted
 *   - Emits logger.log('WARN', ...) via injected logger for unsupported manifests
 *     and parser errors — partial coverage > total failure
 *   - Returns ecosystems_scanned array so coverage gaps are visible in logs (DEP-06)
 *
 * Supported: npm, pypi, go, cargo, maven, nuget, rubygems.
 * Unsupported (v5.8.0): swift, composer, mix, sbt, pub — logged as WARN.
 *
 * ESM. Node >=20. No external dependencies — only node:fs, node:path.
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Top-level export
// ---------------------------------------------------------------------------

/**
 * Collect production dependencies from a service root directory.
 *
 * @param {object} ctx
 * @param {string} ctx.repoPath  - absolute path to the repo root (used for manifest_file relative paths)
 * @param {string} ctx.rootPath  - absolute path to the service root where manifests live
 * @param {object|null} [ctx.logger] - object with log(level, msg, extra) method; optional chained
 * @returns {Promise<{ rows: Array<object>, ecosystems_scanned: string[] }>}
 */
export async function collectDependencies({ repoPath, rootPath, logger = null }) {
  const warn = (msg, extra) => { logger?.log?.('WARN', msg, extra); };

  const rows = [];
  const ecosystems_scanned = [];

  /**
   * Wrap each parser: on success push to rows + mark ecosystem scanned.
   * On throw emit WARN and omit ecosystem from scanned (partial coverage preferred).
   * Returns null (absent) → ecosystem not scanned.
   */
  const tryParser = (ecosystem, parserFn) => {
    try {
      const produced = parserFn();
      if (produced === null) return; // manifest absent — ecosystem not scanned
      rows.push(...produced);
      ecosystems_scanned.push(ecosystem);
    } catch (err) {
      warn('dep-scan: parser error', { ecosystem, error: err.message });
      // ecosystem intentionally NOT added to ecosystems_scanned
    }
  };

  tryParser('npm',      () => parseNpm(rootPath));
  tryParser('pypi',     () => parsePypi(rootPath));
  tryParser('go',       () => parseGo(rootPath));
  tryParser('cargo',    () => parseCargo(rootPath));
  tryParser('maven',    () => parseMaven(rootPath));
  tryParser('nuget',    () => parseNuget(rootPath));
  tryParser('rubygems', () => parseRubygems(rootPath));

  // Shallow scan for unrecognized manifests — warn so gaps are visible (DEP-06)
  scanUnsupportedTopLevel(rootPath, warn);

  return { rows, ecosystems_scanned };
}

// ---------------------------------------------------------------------------
// npm
// ---------------------------------------------------------------------------

function parseNpm(rootPath) {
  const manifestPath = join(rootPath, 'package.json');
  if (!existsSync(manifestPath)) return null; // ecosystem absent

  const pkg = JSON.parse(readFileSync(manifestPath, 'utf8'));
  // PRODUCTION ONLY (DEP-07) — devDependencies, peerDependencies, optionalDependencies excluded
  const deps = pkg.dependencies || {};

  // Build resolved_version lookup from package-lock.json when present (npm v7+ format)
  const lockPath = join(rootPath, 'package-lock.json');
  const resolved = new Map();
  if (existsSync(lockPath)) {
    try {
      const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
      const packages = lock.packages || {};
      for (const [key, meta] of Object.entries(packages)) {
        if (!key.startsWith('node_modules/')) continue;
        const name = key.slice('node_modules/'.length);
        if (meta?.version) resolved.set(name, meta.version);
      }
    } catch {
      // Corrupt lockfile — skip resolution, version_spec values still emitted
    }
  }

  const rows = [];
  for (const [name, spec] of Object.entries(deps)) {
    rows.push({
      ecosystem: 'npm',
      package_name: name,
      version_spec: String(spec),
      resolved_version: resolved.get(name) ?? null,
      manifest_file: 'package.json',
      dep_kind: 'direct',
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// pypi
// ---------------------------------------------------------------------------

function parsePypi(rootPath) {
  const pyprojectPath = join(rootPath, 'pyproject.toml');
  const requirementsPath = join(rootPath, 'requirements.txt');
  const hasPyproj = existsSync(pyprojectPath);
  const hasReqs = existsSync(requirementsPath);
  if (!hasPyproj && !hasReqs) return null;

  const rows = [];

  if (hasPyproj) {
    const src = readFileSync(pyprojectPath, 'utf8');

    // PEP 621: [project] ... dependencies = [ ... ]
    // Match the array content between brackets after the `dependencies =` key
    const pep621Match = src.match(/^\[project\][\s\S]*?^dependencies\s*=\s*\[([\s\S]*?)\]/m);
    if (pep621Match) {
      for (const line of pep621Match[1].split('\n')) {
        const t = line.trim().replace(/,$/, '').replace(/^["']|["']$/g, '');
        if (!t || t.startsWith('#')) continue;
        const ns = splitPep508(t);
        if (ns) {
          rows.push({
            ecosystem: 'pypi',
            package_name: ns.name,
            version_spec: ns.spec,
            resolved_version: null,
            manifest_file: 'pyproject.toml',
            dep_kind: 'direct',
          });
        }
      }
    }

    // Poetry: [tool.poetry.dependencies]
    // Match from the section header to the next section header or end of string
    const poetryMatch = src.match(/\[tool\.poetry\.dependencies\]([\s\S]*?)(?=^\[|$(?![\s\S]))/m);
    if (poetryMatch) {
      for (const line of poetryMatch[1].split('\n')) {
        const t = line.trim();
        if (!t || t.startsWith('#') || t.startsWith('[')) continue;
        // Simple string form: name = "^1.2.3"
        const m = t.match(/^([A-Za-z0-9_\-.]+)\s*=\s*["'](.+?)["']/);
        if (m && m[1] !== 'python') {
          rows.push({
            ecosystem: 'pypi',
            package_name: m[1],
            version_spec: m[2],
            resolved_version: null,
            manifest_file: 'pyproject.toml',
            dep_kind: 'direct',
          });
        }
      }
    }
  }

  if (hasReqs) {
    const src = readFileSync(requirementsPath, 'utf8');
    for (const line of src.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#') || t.startsWith('-')) continue; // skip flags (-r, -i, etc.)
      const ns = splitPep508(t);
      if (ns) {
        rows.push({
          ecosystem: 'pypi',
          package_name: ns.name,
          version_spec: ns.spec,
          resolved_version: null,
          manifest_file: 'requirements.txt',
          dep_kind: 'direct',
        });
      }
    }
  }

  return rows;
}

/**
 * Split a PEP 508 dependency specifier into name + version spec.
 * Handles environment markers (stripped) and extras (stripped from name).
 * Examples:
 *   "requests>=2.31,<3.0"       → { name: 'requests', spec: '>=2.31,<3.0' }
 *   "django ; python_version>='3.9'"  → { name: 'django', spec: null }
 *   "requests[security]>=2.0"   → { name: 'requests', spec: '>=2.0' }
 */
function splitPep508(s) {
  const cleaned = s.split(';')[0].trim(); // strip environment markers
  const m = cleaned.match(/^([A-Za-z0-9_\-.\[\]]+)\s*(.*)$/);
  if (!m) return null;
  const name = m[1].replace(/\[.*\]$/, ''); // strip extras like requests[security]
  const spec = m[2].trim() || null;
  return { name, spec };
}

// ---------------------------------------------------------------------------
// go
// ---------------------------------------------------------------------------

function parseGo(rootPath) {
  const gomodPath = join(rootPath, 'go.mod');
  if (!existsSync(gomodPath)) return null;

  const src = readFileSync(gomodPath, 'utf8');
  const rows = [];
  let inBlock = false;

  for (const rawLine of src.split('\n')) {
    // Strip inline comments
    const line = rawLine.replace(/\/\/.*$/, '').trim();
    if (line === 'require (') { inBlock = true; continue; }
    if (inBlock && line === ')') { inBlock = false; continue; }
    if (inBlock) {
      const m = line.match(/^(\S+)\s+(\S+)/);
      if (m) {
        rows.push({
          ecosystem: 'go',
          package_name: m[1],
          version_spec: m[2],
          resolved_version: m[2], // go.mod pins are already resolved
          manifest_file: 'go.mod',
          dep_kind: 'direct',
        });
      }
    } else if (line.startsWith('require ')) {
      // Single-line: require github.com/foo/bar v1.2.3
      const m = line.match(/^require\s+(\S+)\s+(\S+)/);
      if (m) {
        rows.push({
          ecosystem: 'go',
          package_name: m[1],
          version_spec: m[2],
          resolved_version: m[2],
          manifest_file: 'go.mod',
          dep_kind: 'direct',
        });
      }
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// cargo
// ---------------------------------------------------------------------------

function parseCargo(rootPath) {
  const cargoPath = join(rootPath, 'Cargo.toml');
  if (!existsSync(cargoPath)) return null;

  const src = readFileSync(cargoPath, 'utf8');
  const rows = [];
  let inDeps = false;

  for (const rawLine of src.split('\n')) {
    const line = rawLine.trim();
    if (line === '[dependencies]') { inDeps = true; continue; }
    // Any new section header (not [dependencies]) resets the flag
    if (line.startsWith('[') && line !== '[dependencies]') { inDeps = false; continue; }
    if (!inDeps || !line || line.startsWith('#')) continue;

    // Simple form: tokio = "1.33.0"
    let m = line.match(/^([A-Za-z0-9_\-]+)\s*=\s*"([^"]+)"/);
    if (m) {
      rows.push({
        ecosystem: 'cargo',
        package_name: m[1],
        version_spec: m[2],
        resolved_version: null,
        manifest_file: 'Cargo.toml',
        dep_kind: 'direct',
      });
      continue;
    }

    // Inline-table form: serde = { version = "1.0.190", features = ["derive"] }
    m = line.match(/^([A-Za-z0-9_\-]+)\s*=\s*\{.*?version\s*=\s*"([^"]+)"/);
    if (m) {
      rows.push({
        ecosystem: 'cargo',
        package_name: m[1],
        version_spec: m[2],
        resolved_version: null,
        manifest_file: 'Cargo.toml',
        dep_kind: 'direct',
      });
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// maven
// ---------------------------------------------------------------------------

function parseMaven(rootPath) {
  const pomPath = join(rootPath, 'pom.xml');
  if (!existsSync(pomPath)) return null;

  const src = readFileSync(pomPath, 'utf8');
  const rows = [];

  // Build properties map from <properties> blocks
  const props = new Map();
  for (const m of src.matchAll(/<properties>([\s\S]*?)<\/properties>/g)) {
    for (const p of m[1].matchAll(/<([A-Za-z0-9_.\-]+)>([^<]+)<\/\1>/g)) {
      props.set(p[1], p[2].trim());
    }
  }

  // Resolve ${property} references; unresolvable references kept as-is
  const resolveProps = (v) => {
    if (!v) return v;
    return v.replace(/\$\{([^}]+)\}/g, (_, k) => props.get(k) ?? `\${${k}}`);
  };

  // Build managed-version map from <dependencyManagement>
  const managedMap = new Map();
  const dmMatch = src.match(/<dependencyManagement>([\s\S]*?)<\/dependencyManagement>/);
  if (dmMatch) {
    for (const dep of dmMatch[1].matchAll(/<dependency>([\s\S]*?)<\/dependency>/g)) {
      const g = dep[1].match(/<groupId>([^<]+)<\/groupId>/)?.[1]?.trim();
      const a = dep[1].match(/<artifactId>([^<]+)<\/artifactId>/)?.[1]?.trim();
      const v = dep[1].match(/<version>([^<]+)<\/version>/)?.[1]?.trim();
      if (g && a && v) managedMap.set(`${g}:${a}`, resolveProps(v));
    }
  }

  // Parse direct <dependencies> (strip <dependencyManagement> block first to avoid double-counting)
  const strippedSrc = src.replace(/<dependencyManagement>[\s\S]*?<\/dependencyManagement>/g, '');
  for (const dep of strippedSrc.matchAll(/<dependency>([\s\S]*?)<\/dependency>/g)) {
    const g = dep[1].match(/<groupId>([^<]+)<\/groupId>/)?.[1]?.trim();
    const a = dep[1].match(/<artifactId>([^<]+)<\/artifactId>/)?.[1]?.trim();
    const vRaw = dep[1].match(/<version>([^<]+)<\/version>/)?.[1]?.trim();
    const scope = dep[1].match(/<scope>([^<]+)<\/scope>/)?.[1]?.trim();

    // DEP-07: exclude test-scoped deps
    if (scope === 'test') continue;
    if (!g || !a) continue;

    const key = `${g}:${a}`;
    const v = vRaw ? resolveProps(vRaw) : (managedMap.get(key) ?? 'MANAGED');

    rows.push({
      ecosystem: 'maven',
      package_name: key,
      version_spec: v,
      resolved_version: null,
      manifest_file: 'pom.xml',
      dep_kind: 'direct',
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// nuget
// ---------------------------------------------------------------------------

function parseNuget(rootPath) {
  // Shallow glob for .csproj files at rootPath (no subdirectory traversal)
  const csprojs = readdirSync(rootPath).filter(f => f.endsWith('.csproj'));
  if (csprojs.length === 0) return null;

  // Build CPM managed-version map from Directory.Packages.props if present
  const cpmPath = join(rootPath, 'Directory.Packages.props');
  const managedMap = new Map();
  if (existsSync(cpmPath)) {
    const src = readFileSync(cpmPath, 'utf8');
    for (const m of src.matchAll(/<PackageVersion\s+Include="([^"]+)"\s+Version="([^"]+)"/g)) {
      managedMap.set(m[1], m[2]);
    }
  }

  const rows = [];
  for (const file of csprojs) {
    const src = readFileSync(join(rootPath, file), 'utf8');
    for (const m of src.matchAll(/<PackageReference\s+Include="([^"]+)"(?:\s+Version="([^"]+)")?/g)) {
      const name = m[1];
      const version = m[2] ?? managedMap.get(name) ?? 'MANAGED';
      rows.push({
        ecosystem: 'nuget',
        package_name: name,
        version_spec: version,
        resolved_version: null,
        manifest_file: file,
        dep_kind: 'direct',
      });
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// rubygems
// ---------------------------------------------------------------------------

function parseRubygems(rootPath) {
  const lockPath = join(rootPath, 'Gemfile.lock');
  if (!existsSync(lockPath)) return null;

  const src = readFileSync(lockPath, 'utf8');
  const rows = [];
  const lines = src.split('\n');
  let currentSection = null;
  let inSpecs = false;

  for (const line of lines) {
    // Section headers are non-indented keywords
    if (/^(GEM|GIT|PATH|PLATFORMS|DEPENDENCIES|BUNDLED WITH|RUBY VERSION)\b/.test(line)) {
      currentSection = line.trim().split(/\s+/)[0];
      inSpecs = false;
      continue;
    }

    // Only parse GEM, GIT, PATH sections
    if (!['GEM', 'GIT', 'PATH'].includes(currentSection)) continue;

    // Enter specs block on "    specs:" line
    if (/^\s+specs:\s*$/.test(line)) { inSpecs = true; continue; }
    if (!inSpecs) continue;

    // Direct gem lines are indented with exactly 4 spaces.
    // Sub-dependency lines are indented with 6+ spaces — excluded.
    const m = line.match(/^    ([A-Za-z0-9_\-.]+) \(([^)]+)\)$/);
    if (m) {
      rows.push({
        ecosystem: 'rubygems',
        package_name: m[1],
        version_spec: m[2],
        resolved_version: m[2], // Gemfile.lock pins are resolved
        manifest_file: 'Gemfile.lock',
        dep_kind: 'direct',
      });
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Unsupported-manifest detection (shallow — top-level only per v5.8.0 scope)
// ---------------------------------------------------------------------------

const UNSUPPORTED_MANIFESTS = [
  { file: 'Package.swift',  reason: 'Swift Package Manager — v5.9 candidate' },
  { file: 'composer.json',  reason: 'PHP Composer — v5.9 candidate' },
  { file: 'mix.exs',        reason: 'Elixir Mix — v5.9 candidate' },
  { file: 'build.sbt',      reason: 'Scala SBT — v5.9 candidate' },
  { file: 'pubspec.yaml',   reason: 'Dart Pub — not on roadmap' },
];

function scanUnsupportedTopLevel(rootPath, warn) {
  for (const { file, reason } of UNSUPPORTED_MANIFESTS) {
    if (existsSync(join(rootPath, file))) {
      warn('dep-scan: unsupported manifest skipped', { file, reason });
    }
  }
}
