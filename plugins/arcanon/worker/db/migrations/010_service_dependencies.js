/**
 * Migration 010 — service_dependencies table with full schema for v5.8.0 Library Drift.
 *
 * DEP-01: service_dependencies table with dep_kind discriminant
 * DEP-02: 4-column UNIQUE(service_id, ecosystem, package_name, manifest_file) — handles same
 *         package in multiple manifests (e.g., root pom.xml + child build.gradle)
 * DEP-03: indexes on package_name (cross-repo drift) and scan_version_id (stale cleanup)
 * DEP-04: dep_kind IN ('direct','transient') — v5.8.0 writes 'direct' only; 'transient' is a
 *         reserved future value per research decision (transient scanning deferred to v5.9)
 *
 * ON DELETE CASCADE from services(id) means endScan() stale-service cleanup automatically
 * removes dep rows — no new cleanup statement in query-engine.endScan() is needed.
 *
 * CREATE TABLE IF NOT EXISTS and CREATE INDEX IF NOT EXISTS are both natively idempotent —
 * no hasCol() guards required for this migration.
 */

export const version = 10;

/**
 * @param {import('better-sqlite3').Database} db
 */
export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS service_dependencies (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      service_id        INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
      scan_version_id   INTEGER REFERENCES scan_versions(id),
      ecosystem         TEXT    NOT NULL,
      package_name      TEXT    NOT NULL,
      version_spec      TEXT,
      resolved_version  TEXT,
      manifest_file     TEXT    NOT NULL,
      dep_kind          TEXT    NOT NULL DEFAULT 'direct' CHECK(dep_kind IN ('direct','transient')),
      UNIQUE(service_id, ecosystem, package_name, manifest_file)
    );

    CREATE INDEX IF NOT EXISTS idx_service_dependencies_package_name
      ON service_dependencies(package_name);

    CREATE INDEX IF NOT EXISTS idx_service_dependencies_scan_version
      ON service_dependencies(scan_version_id);
  `);
}
