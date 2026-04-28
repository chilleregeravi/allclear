/**
 * worker/hub-sync/whoami.js — Arcanon Hub /auth/whoami client (THE-1030).
 *
 * Calls GET ${hubUrl}/api/v1/auth/whoami with Bearer token. Returns the
 * parsed `{user_id, key_id, scopes, grants}` payload on 200. Used by
 * /arcanon:login (AUTH-06, Phase 125) to discover the user's org grants
 * and by /arcanon:status (AUTH-07, Phase 125) to render the Identity block.
 *
 * Does NOT carry X-Org-Id — whoami is the bootstrap call that DISCOVERS the
 * org_id (chicken-and-egg). Requiring X-Org-Id here would block the very
 * call that exists to learn it.
 *
 * Error contract:
 *   - 200 -> returns parsed body verbatim
 *   - 401/403 -> throws AuthError (with key preview, never the full key)
 *   - 5xx -> throws HubError(retriable=true)
 *   - network/transport failure -> throws HubError(retriable=true)
 *   - 4xx (other) -> throws HubError(status=<code>, retriable=false)
 *
 * Hard external dependency: arcanon-hub THE-1030 deploy. All Phase 124
 * unit tests use a fakeFetch and pass independent of the hub deploy.
 */

import { AuthError } from "./auth.js";
import { HubError } from "./client.js";

export const WHOAMI_PATH = "/api/v1/auth/whoami";
export const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Build a redacted preview of an api key. Never echo the full key into
 * an error message (logs ship to disk and may end up in support bundles).
 *
 * @param {string} apiKey
 * @returns {string} `arc_xxxx…1234` style preview, or `arc_***` for short keys.
 */
function previewKey(apiKey) {
  if (!apiKey || apiKey.length < 12) return "arc_***";
  return `${apiKey.slice(0, 7)}…${apiKey.slice(-4)}`;
}

/**
 * Call GET /api/v1/auth/whoami and return the parsed response.
 *
 * @param {string} apiKey — must start with "arc_"; passed as Bearer token
 * @param {string} hubUrl — e.g. "https://api.arcanon.dev"
 * @param {{ timeoutMs?: number, fetchImpl?: typeof fetch, log?: Function }} [opts]
 * @returns {Promise<{
 *   user_id: string,
 *   key_id: string,
 *   scopes: string[],
 *   grants: Array<{ org_id: string, org_name: string }>
 * }>}
 * @throws {AuthError} on 401/403
 * @throws {HubError} on transport / network / 4xx (non-auth) / 5xx
 */
export async function getKeyInfo(apiKey, hubUrl, opts = {}) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const log = opts.log || (() => {});

  if (!fetchImpl) {
    throw new HubError("fetch() is not available — Node.js >= 18 required");
  }
  if (!apiKey) throw new AuthError("apiKey is required");
  if (!hubUrl) throw new HubError("hubUrl is required");

  const url = new URL(WHOAMI_PATH, hubUrl).toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
        "User-Agent": "arcanon-plugin-hub-sync",
        // Intentional omission: NO X-Org-Id header. whoami is the bootstrap.
      },
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    log("WARN", "whoami network error", { error: err.message });
    throw new HubError(`whoami network error: ${err.message}`, {
      retriable: true,
    });
  }
  clearTimeout(timer);

  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (response.status === 200) {
    return body;
  }
  if (response.status === 401 || response.status === 403) {
    throw new AuthError(
      `whoami rejected for key ${previewKey(apiKey)} (status ${response.status}` +
        `${body?.title ? `: ${body.title}` : ""})`,
    );
  }
  throw new HubError(
    `whoami returned ${response.status}` +
      `${body?.title ? `: ${body.title}` : ""}`,
    {
      status: response.status,
      retriable: response.status >= 500,
      body,
    },
  );
}
