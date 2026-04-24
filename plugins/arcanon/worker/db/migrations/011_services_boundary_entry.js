/**
 * Migration 011 — Add services.boundary_entry column.
 *
 * Issue #18 (Bug 2): hub.js and export.js query services.boundary_entry but
 * migrations 001-010 never created it. The scan schema and agent prompts
 * accept a per-service boundary_entry value (typically an entrypoint path like
 * `src/main.py`) and persistFindings writes it to `exposed_endpoints.boundary_entry`
 * per-endpoint, but the services table was missing its own column.
 *
 * Tests worked around this with runtime ALTER TABLE in
 * manager.dep-collector.test.js and manager.test.js. This migration removes the
 * need for those workarounds and fixes the runtime error on /arcanon:upload and
 * /arcanon:export.
 *
 * The column is idempotent via PRAGMA table_info check — safe to re-run.
 */

export const version = 11;

/**
 * @param {import('better-sqlite3').Database} db
 */
export function up(db) {
  const hasCol = (table, col) =>
    db.prepare("PRAGMA table_info(" + table + ")").all().some((c) => c.name === col);

  if (!hasCol("services", "boundary_entry")) {
    db.exec("ALTER TABLE services ADD COLUMN boundary_entry TEXT;");
  }
}
