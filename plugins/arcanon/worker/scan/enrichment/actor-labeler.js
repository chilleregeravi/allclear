/**
 * worker/scan/enrichment/actor-labeler.js — Phase 121 / INT-06.
 *
 * Per-repo actor labeling pass. Invoked from manager.js once per repo, after
 * the per-service enrichment loop and BEFORE the slog('INFO', 'enrichment
 * done', ...) line so that the actor labels become part of the same scan
 * version's view of the world.
 *
 * Self-healing: writes label = ? for EVERY actor connected to the given repo,
 * passing NULL when the catalog has no match. Removing an entry from the
 * catalog clears the corresponding actors.label on the next scan rather than
 * leaving a stale label in place.
 *
 * Failure-isolated: any error inside this pass is caught, logged at WARN, and
 * the scan continues. Mirrors the runEnrichmentPass posture in enrichment.js.
 *
 * SQL safety: actor IDs are looked up from the DB itself, not from user
 * input. The UPDATE statement uses parameterized binding for both label and
 * id, so there is no SQL-injection surface for catalog-supplied label
 * strings (they are bound parameters, never spliced into SQL).
 */

import { matchActor } from './externals-catalog.js';

/**
 * @typedef {import('./externals-catalog.js').NormalizedCatalog} NormalizedCatalog
 */

/**
 * Run the per-repo actor labeling pass.
 *
 * @param {number} repoId
 * @param {import('better-sqlite3').Database | { prepare: Function }} db
 * @param {{ warn?: Function, info?: Function } | null} logger
 * @param {NormalizedCatalog} catalog
 * @returns {Promise<{ matched: number, considered: number }>}
 */
export async function runActorLabeling(repoId, db, logger, catalog) {
  try {
    const rows = db
      .prepare(
        `SELECT DISTINCT a.id, a.name
         FROM actors a
         JOIN actor_connections ac ON ac.actor_id = a.id
         JOIN services s ON s.id = ac.service_id
         WHERE s.repo_id = ?`,
      )
      .all(repoId);

    if (rows.length === 0) return { matched: 0, considered: 0 };

    const stmt = db.prepare('UPDATE actors SET label = ? WHERE id = ?');
    let matched = 0;
    for (const row of rows) {
      const label = matchActor(row.name, catalog);
      stmt.run(label, row.id);
      if (label !== null) matched++;
    }
    return { matched, considered: rows.length };
  } catch (err) {
    logger?.warn?.(`actor-labeling failed for repo ${repoId}: ${err.message}`);
    return { matched: 0, considered: 0 };
  }
}
