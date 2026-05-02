/**
 * worker/lib/hub-config.js — Shared helpers for reading hub-related config.
 *
 * Hosts logic that was previously duplicated across worker/cli/hub.js and
 * worker/scan/manager.js. Importing the shared helper guarantees a single
 * point of truth for legacy-key fallbacks and one-shot deprecation warnings.
 */

// Module-level guard ensures the deprecation warning fires at most once
// per worker process across ALL callers (cli/hub.js + scan/manager.js).
let _autoUploadDeprecationWarned = false;

/**
 * Read hub.auto-sync with a legacy fallback to hub.auto-upload.
 * Writes a one-time stderr deprecation warning when the legacy key is the
 * sole activator. Remove this helper in v0.2.0 when the fallback is dropped.
 *
 * @param {Record<string, unknown>|undefined} hubBlock The `cfg.hub` object.
 * @returns {boolean} Effective auto-sync flag value.
 */
export function readHubAutoSync(hubBlock) {
  const newKey = hubBlock?.["auto-sync"];
  const legacyKey = hubBlock?.["auto-upload"];
  // Explicit undefined check so that auto-sync:false beats auto-upload:true.
  if (typeof newKey !== "undefined") return Boolean(newKey);
  if (typeof legacyKey !== "undefined") {
    if (!_autoUploadDeprecationWarned) {
      process.stderr.write(
        "arcanon: config key 'hub.auto-upload' is deprecated — rename to 'hub.auto-sync' (legacy key will be dropped in v0.2.0)\n",
      );
      _autoUploadDeprecationWarned = true;
    }
    return Boolean(legacyKey);
  }
  return false;
}

/**
 * Test-only: reset the deprecation-warning flag so suites can exercise the
 * one-shot guard repeatedly. Production callers must NEVER use this.
 */
export function _resetAutoUploadDeprecationWarnedForTests() {
  _autoUploadDeprecationWarned = false;
}
