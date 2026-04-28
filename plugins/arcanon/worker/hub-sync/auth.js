/**
 * worker/hub-sync/auth.js — Resolve Arcanon Hub credentials.
 *
 * Credential precedence (first hit wins):
 *   1. opts.apiKey (explicit argument — used by /arcanon:login test flows)
 *   2. process.env.ARCANON_API_KEY
 *   3. ~/.arcanon/config.json  { "api_key": "arc_..." }
 *
 * Hub URL precedence:
 *   1. opts.hubUrl
 *   2. process.env.ARCANON_HUB_URL
 *   3. ~/.arcanon/config.json  { "hub_url": "..." }
 *   4. Default: https://api.arcanon.dev
 *
 * Org ID precedence (AUTH-03 / THE-1029):
 *   1. opts.orgId (per-repo override threaded by manager.js from arcanon.config.json hub.org_id)
 *   2. process.env.ARCANON_ORG_ID
 *   3. ~/.arcanon/config.json  { "default_org_id": "<uuid>" }
 *   Missing org_id throws AuthError; the message names all three sources and
 *   recommends `/arcanon:login --org-id <uuid>` as remediation.
 *
 * The plugin's `userConfig.api_token` (declared in .claude-plugin/plugin.json)
 * is read by Claude Code from its own secrets store; at runtime it's injected
 * as ARCANON_API_TOKEN. We accept both ARCANON_API_KEY and ARCANON_API_TOKEN
 * as env var names for forgiving operator UX.
 *
 * C2 decision (option-a): hasCredentials() stays org_id-tolerant. It only
 * reports on api_key presence; the missing-org_id throw is deferred to
 * upload time so the actionable AuthError lands in scan-end logs verbatim.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export const DEFAULT_HUB_URL = "https://api.arcanon.dev";
export const API_KEY_PREFIX = "arc_";

export class AuthError extends Error {
  constructor(message) {
    super(message);
    this.name = "AuthError";
  }
}

function readJsonSafe(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function readHomeConfig() {
  const home = os.homedir();
  const current = path.join(home, ".arcanon", "config.json");
  return readJsonSafe(current) || {};
}

/**
 * Internal: resolve only the api_key + hub_url + source. Used by both
 * `resolveCredentials` and `hasCredentials` so the latter never trips
 * on missing org_id (C2 option-a).
 *
 * @param {{ apiKey?: string, hubUrl?: string }} [opts]
 * @param {object} [homeCfg] — pre-read ~/.arcanon/config.json (avoid double-reading)
 * @returns {{ apiKey: string, hubUrl: string, source: string }}
 */
function _resolveApiKey(opts = {}, homeCfg = null) {
  const cfg = homeCfg || readHomeConfig();

  let apiKey = null;
  let source = null;

  if (opts.apiKey) {
    apiKey = opts.apiKey;
    source = "explicit";
  } else if (process.env.ARCANON_API_KEY) {
    apiKey = process.env.ARCANON_API_KEY;
    source = "env";
  } else if (process.env.ARCANON_API_TOKEN) {
    apiKey = process.env.ARCANON_API_TOKEN;
    source = "env";
  } else if (cfg.api_key) {
    apiKey = cfg.api_key;
    source = "home-config";
  }

  if (!apiKey) {
    throw new AuthError(
      "No Arcanon Hub API key found.\n" +
        "  1. Create a key: https://app.arcanon.dev/settings/api-keys\n" +
        "     (if you're not signed in you'll be redirected to login first;\n" +
        "      navigate to Settings → API keys after sign-in. Tracked: THE-1016.)\n" +
        "  2. Run /arcanon:login arc_…  OR  set ARCANON_API_KEY in your environment.\n" +
        "     /arcanon:status will then report 'credentials: present'.",
    );
  }
  if (!apiKey.startsWith(API_KEY_PREFIX)) {
    throw new AuthError(
      `API key must start with "${API_KEY_PREFIX}" (hub rejects JWT tokens on /api/v1/scans/upload).`,
    );
  }

  const hubUrl =
    opts.hubUrl ||
    process.env.ARCANON_HUB_URL ||
    cfg.hub_url ||
    DEFAULT_HUB_URL;

  return { apiKey, hubUrl, source };
}

/**
 * Internal: resolve only the org_id via opts -> ARCANON_ORG_ID -> default_org_id.
 * Throws AuthError when no source resolves (the message names all 3 sources and
 * recommends `/arcanon:login --org-id <uuid>`).
 *
 * @param {{ orgId?: string }} [opts]
 * @param {object} [homeCfg]
 * @returns {string}
 */
function _resolveOrgId(opts = {}, homeCfg = null) {
  const cfg = homeCfg || readHomeConfig();
  if (opts.orgId) return opts.orgId;
  if (process.env.ARCANON_ORG_ID) return process.env.ARCANON_ORG_ID;
  if (cfg.default_org_id) return cfg.default_org_id;
  throw new AuthError(
    "Missing org_id (sources tried: opts.orgId, ARCANON_ORG_ID env, ~/.arcanon/config.json#default_org_id).\n" +
      "  Run /arcanon:login --org-id <uuid> to set the machine default.\n" +
      "  Or set ARCANON_ORG_ID in your environment.\n" +
      "  Or add hub.org_id to this repo's arcanon.config.json for a per-repo override.",
  );
}

/**
 * Resolve credentials. Returns { apiKey, hubUrl, orgId, source } on success.
 * `source` is one of "explicit" | "env" | "home-config" — describes the
 * api_key origin only (NOT the org_id origin; do not extend to a tuple,
 * existing destructures at hub.js:179, 777, 1282 depend on this shape).
 *
 * Throws AuthError when no apiKey can be found, or when no orgId can be
 * resolved (per AUTH-03 / THE-1029 — every upload requires an X-Org-Id).
 *
 * Pass `{ orgIdRequired: false }` to disable the org-id requirement for
 * callers that only need apiKey + hubUrl (e.g. doctor check 8 round-trips
 * `GET /api/version` without `X-Org-Id`). On opt-out, `orgId` is the
 * best-effort resolution (opts → env → home-config) or `null` if none.
 *
 * @param {{ apiKey?: string, hubUrl?: string, orgId?: string, orgIdRequired?: boolean }} [opts]
 * @returns {{ apiKey: string, hubUrl: string, orgId: string|null, source: string }}
 */
export function resolveCredentials(opts = {}) {
  const homeCfg = readHomeConfig();
  const { apiKey, hubUrl, source } = _resolveApiKey(opts, homeCfg);
  let orgId;
  if (opts.orgIdRequired === false) {
    orgId =
      opts.orgId || process.env.ARCANON_ORG_ID || homeCfg.default_org_id || null;
  } else {
    orgId = _resolveOrgId(opts, homeCfg);
  }
  return { apiKey, hubUrl, orgId, source };
}

/**
 * Persist the api_key to ~/.arcanon/config.json with 0600 perms.
 * Creates the directory if missing.
 *
 * @param {string} apiKey — must start with arc_
 * @param {{ hubUrl?: string }} [opts]
 * @returns {string} path to the config file written
 */
/**
 * Non-throwing credential presence check.
 * True iff an api_key resolves right now — does NOT require org_id (C2 option-a).
 *
 * Used by the scan manager's auto-upload gate so that users who ran
 * /arcanon:login but never set ARCANON_API_KEY still get auto-uploads.
 * Missing org_id is surfaced as an AuthError at upload time (resolveCredentials
 * throws), which lands in the scan-end WARN log via the existing
 * `slog('WARN', 'hub upload failed', ...)` site at manager.js — so the
 * actionable remediation message reaches the user instead of silent gating.
 *
 * @returns {boolean}
 */
export function hasCredentials() {
  try {
    _resolveApiKey();
    return true;
  } catch {
    return false;
  }
}

/**
 * Persist credentials to ~/.arcanon/config.json (mode 0600, dir 0700).
 *
 * Existing fields are preserved via spread-merge — rotating only `api_key`
 * keeps `hub_url`, `default_org_id`, and any unknown future keys intact
 * (C3 regression guard pinned by Test S2).
 *
 * @param {string} apiKey — must start with "arc_"
 * @param {{ hubUrl?: string, defaultOrgId?: string }} [opts]
 *   - opts.hubUrl: persisted as `hub_url`
 *   - opts.defaultOrgId: persisted as `default_org_id` (AUTH-04 / THE-1029)
 * @returns {string} absolute path to the config file written
 */
export function storeCredentials(apiKey, opts = {}) {
  if (!apiKey || !apiKey.startsWith(API_KEY_PREFIX)) {
    throw new AuthError(`api_key must start with "${API_KEY_PREFIX}"`);
  }
  const dir = path.join(os.homedir(), ".arcanon");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  // Belt-and-suspenders: mkdirSync `mode` is masked by umask on macOS, so
  // re-chmod after creation to guarantee 0700 on POSIX.
  try {
    fs.chmodSync(dir, 0o700);
  } catch {
    // Non-POSIX FS (e.g. Windows) — ignore.
  }
  const file = path.join(dir, "config.json");
  const existing = readJsonSafe(file) || {};
  const next = { ...existing, api_key: apiKey };
  if (opts.hubUrl) next.hub_url = opts.hubUrl;
  // AUTH-04: persist default_org_id alongside api_key + hub_url. Additive only —
  // when omitted, the spread-merge above preserves any pre-existing value.
  if (opts.defaultOrgId) next.default_org_id = opts.defaultOrgId;
  fs.writeFileSync(file, JSON.stringify(next, null, 2) + "\n", { mode: 0o600 });
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // Non-POSIX FS (e.g. Windows) — ignore.
  }
  return file;
}
