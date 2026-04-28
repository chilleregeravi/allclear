/**
 * worker/lib/path-mask.js — Phase 123 PII-01 egress masking primitive.
 *
 * Replaces `$HOME` prefixes with `~` so absolute paths never leak from worker
 * egress seams (MCP responses, HTTP responses, log lines, exports). The DB
 * still stores absolute paths because git operations need them — masking is
 * at egress only.
 *
 * Cross-milestone decision (STATE.md): "Mask `$HOME` at egress seams, not in
 * DB." This module IS the egress primitive every Wave-2 seam consumes.
 *
 * Risk mitigations baked in:
 *
 *   S1 (PREDECESSOR-SURFACE.md): "verify `maskHome` is idempotent on
 *   already-relative paths emitted by the agent (`agent-prompt-service.md:104`
 *   shows root_path as `src/`). The agent contract is documented to emit
 *   relative paths; PII-06 hardens this."
 *   → maskHome on a string with no `$HOME` prefix is a no-op. Already-masked
 *     paths (`~/foo`, `~`) are returned unchanged.
 *
 *   M1 (PREDECESSOR-SURFACE.md): "`extra.stack` is a string; `maskHomeDeep`
 *   must mask string values, not just keyed paths."
 *   → maskHomeDeep masks ALL string values it walks past, NOT just values
 *     keyed under `PATHY_KEYS`. Stack frames inside `extra.stack` get masked
 *     because they're unkeyed strings inside the recursive walk.
 *     Acceptable trade-off: a non-path string mentioning `/Users/me` (e.g. an
 *     error message body) gets masked too — goal is zero `/Users/` strings on
 *     egress, not perfect semantic preservation of arbitrary text.
 *
 *   T-123-08: `${HOME}other` (no slash separator) MUST NOT be masked, otherwise
 *   `/home/alice` → `~lice` would corrupt unrelated paths.
 *   → maskHome only matches HOME prefix when followed by `/` (or exact match).
 *
 *   T-123-09: maskHomeDeep MUST NOT mutate caller's input.
 *   → Always returns a new object/array; original is untouched.
 *
 *   T-123-07: cyclic input MUST NOT infinite-loop.
 *   → WeakSet cycle guard; cyclic refs return the `[Circular]` sentinel.
 *
 * Exports:
 *   - `maskHome(p)`        — string-level prefix replacement.
 *   - `maskHomeDeep(obj)`  — deep walk; masks every string value reached.
 *   - `PATHY_KEYS`         — informational allowlist of path-y key names.
 */

import os from "node:os";

// Resolve once at module load. If neither env nor os.homedir() returns a
// value, both functions become no-ops (return input unchanged) — masking is
// a defense-in-depth layer, never the only one.
const HOME = process.env.HOME ?? os.homedir() ?? "";

/**
 * PATHY_KEYS — informational allowlist of keys whose values are typically
 * filesystem paths in worker egress payloads. NOT used as a filter by
 * maskHomeDeep (per M1 mitigation we mask all string values), but exposed so
 * tests / future callers can opt into a stricter key-only filter if desired.
 *
 * @type {Set<string>}
 */
export const PATHY_KEYS = new Set([
  "path",
  "repo_path",
  "source_file",
  "target_file",
  "root_path",
]);

/**
 * maskHome — replace a leading `$HOME` prefix with `~`.
 *
 * Rules:
 *   - Non-string input → return unchanged (null, undefined, numbers, bools,
 *     objects, arrays). Lets callers pipe values through without type-guards.
 *   - HOME unset → return unchanged (no-op safety).
 *   - `p === HOME` → `'~'` (exact-match rule from PII-01).
 *   - `p.startsWith(HOME + "/")` → `'~' + p.slice(HOME.length)`.
 *   - `p === "~"` or `p.startsWith("~/")` → return unchanged (idempotent — S1).
 *   - `${HOME}other` (no slash separator) → return unchanged (no false
 *     positive corruption — T-123-08).
 *   - Otherwise → return unchanged.
 *
 * Idempotent: maskHome(maskHome(x)) === maskHome(x) for all inputs.
 *
 * @param {*} p
 * @returns {*} masked string, or input unchanged
 */
export function maskHome(p) {
  if (typeof p !== "string") return p;
  if (HOME === "") return p;
  // Already-masked: idempotent S1 mitigation.
  if (p === "~" || p.startsWith("~/")) return p;
  // Exact HOME match.
  if (p === HOME) return "~";
  // HOME prefix followed by `/` — the only safe slice point. `${HOME}other`
  // (no slash) deliberately falls through unchanged (T-123-08).
  if (p.startsWith(HOME + "/")) return "~" + p.slice(HOME.length);
  return p;
}

/**
 * maskHomeDeep — recursively walk an object/array and mask every string value.
 *
 * Per M1 mitigation we do NOT filter by key name — every string value at any
 * depth is run through `maskHome`. This is what makes stack-frame masking work
 * (stack frames live in `extra.stack` — `stack` is itself a key, but the
 * individual frame strings inside the value are unkeyed text we still need
 * to mask).
 *
 * Returns a NEW object/array; original input is never mutated (T-123-09).
 *
 * Cycle safety: a WeakSet tracks visited objects; revisiting a cyclic ref
 * returns the literal string `"[Circular]"` (T-123-07).
 *
 * @param {*} obj
 * @param {WeakSet} [_seen] internal — do not pass from callers
 * @returns {*} masked clone (or primitive pass-through)
 */
export function maskHomeDeep(obj, _seen = new WeakSet()) {
  // Strings → maskHome
  if (typeof obj === "string") return maskHome(obj);
  // Other primitives → unchanged
  if (obj === null || typeof obj !== "object") return obj;
  // Cycle guard
  if (_seen.has(obj)) return "[Circular]";
  _seen.add(obj);

  if (Array.isArray(obj)) {
    return obj.map((v) => maskHomeDeep(v, _seen));
  }

  // Plain object walk. We do not preserve non-enumerable properties or
  // prototype chain — egress payloads are POJOs (parsed JSON, DB row literals).
  const out = {};
  for (const key of Object.keys(obj)) {
    out[key] = maskHomeDeep(obj[key], _seen);
  }
  return out;
}
