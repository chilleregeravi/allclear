/**
 * Migration 018 — Add actors.label TEXT NULL column (Phase 121 / INT-06).
 *
 * The label column stores the friendly display name assigned by the actor
 * labeling pass (worker/scan/enrichment/actor-labeler.js) when an actor.name
 * matches an entry in data/known-externals.yaml or — eventually — the user's
 * arcanon.config.json external_labels (Plan 121-02).
 *
 * Idempotency: SQLite has no `ALTER TABLE ADD COLUMN IF NOT EXISTS`, so we
 * inspect PRAGMA table_info(actors) before issuing the ALTER. This mirrors
 * the pattern used by migration 008 for connections.crossing.
 *
 * Reversibility: SQLite does not support `DROP COLUMN` cleanly pre-3.35.
 * The column is harmless when ignored (TEXT NULL, no constraints, no
 * triggers), so "rollback" is "stop reading from it". No data destruction.
 *
 * Note: db.exec below is better-sqlite3's bulk-DDL execution method (not the
 * Node process-spawning API of similar name). It runs SQL directly against
 * the database — no shell, no process spawning, no user input.
 */

export const version = 18;

/**
 * @param {import('better-sqlite3').Database} db
 */
export function up(db) {
  const cols = db.prepare('PRAGMA table_info(actors)').all();
  const hasLabel = cols.some((c) => c.name === 'label');
  if (!hasLabel) {
    db.exec('ALTER TABLE actors ADD COLUMN label TEXT;');
  }
}
