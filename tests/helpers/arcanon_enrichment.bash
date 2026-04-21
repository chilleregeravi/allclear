# tests/helpers/arcanon_enrichment.bash
# Helper for session-start enrichment tests.
# Provides build_enrichment_fixture to seed a minimal impact-map.db at the
# correct DATA_DIR/projects/<hash>/impact-map.db path for a given CWD.
#
# Requirements: sqlite3 CLI (no Node / better-sqlite3 dependency).

# _compute_project_hash CWD
# Replicates worker/db/database.js:75–82 projectHashDir() byte-for-byte:
#   crypto.createHash("sha256").update(projectRoot).digest("hex").slice(0, 12)
# Uses printf '%s' (no trailing newline) to match Node's Buffer input exactly.
# Invariant: for cwd="/Users/test/fixture-a" both Node and shell produce 97c700e1dba2
_compute_project_hash() {
  local cwd="$1"
  local HASHER
  if command -v shasum >/dev/null 2>&1; then
    HASHER="shasum -a 256"
  elif command -v sha256sum >/dev/null 2>&1; then
    HASHER="sha256sum"
  else
    echo "ERROR: no shasum or sha256sum available" >&2
    return 1
  fi
  printf '%s' "$cwd" | $HASHER 2>/dev/null | awk '{print $1}' | cut -c1-12
}

# build_enrichment_fixture FIXTURE_CWD FIXTURE_DATA_DIR SCAN_AGE_HOURS SERVICES_COUNT LOAD_BEARING_COUNT
# Creates a minimal impact-map.db seeded with the given row counts.
#
# Arguments:
#   FIXTURE_CWD         — the CWD string whose sha256 hash determines the DB path
#   FIXTURE_DATA_DIR    — root data dir (mirrors ARCANON_DATA_DIR / ~/.arcanon)
#   SCAN_AGE_HOURS      — how many hours ago the scan completed (controls freshness)
#   SERVICES_COUNT      — number of services rows to insert
#   LOAD_BEARING_COUNT  — number of connection rows with DISTINCT non-null source_file
#                         (SERVICES_COUNT additional connections with source_file NULL
#                          are also inserted to prove the DISTINCT-non-null filter)
#
# Echoes the full DB path on stdout.
build_enrichment_fixture() {
  local fixture_cwd="$1"
  local fixture_data_dir="$2"
  local scan_age_hours="$3"
  local services_count="$4"
  local load_bearing_count="$5"

  local hash
  hash="$(_compute_project_hash "$fixture_cwd")" || return 1

  local db_dir="${fixture_data_dir}/projects/${hash}"
  mkdir -p "$db_dir"
  local db_path="${db_dir}/impact-map.db"

  # Remove existing DB so we start clean
  rm -f "$db_path"

  # Create schema matching migrations 001 + 005
  sqlite3 "$db_path" <<'SQL'
CREATE TABLE IF NOT EXISTS repos (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  path        TEXT    NOT NULL,
  name        TEXT    NOT NULL,
  type        TEXT    NOT NULL,
  last_commit TEXT,
  scanned_at  TEXT
);

CREATE TABLE IF NOT EXISTS services (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id          INTEGER NOT NULL REFERENCES repos(id),
  name             TEXT    NOT NULL,
  root_path        TEXT    NOT NULL,
  language         TEXT    NOT NULL,
  scan_version_id  INTEGER
);

CREATE TABLE IF NOT EXISTS connections (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  source_service_id INTEGER NOT NULL REFERENCES services(id),
  target_service_id INTEGER NOT NULL REFERENCES services(id),
  protocol          TEXT    NOT NULL,
  method            TEXT,
  path              TEXT,
  source_file       TEXT,
  target_file       TEXT,
  scan_version_id   INTEGER
);

CREATE TABLE IF NOT EXISTS scan_versions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id      INTEGER NOT NULL REFERENCES repos(id),
  started_at   TEXT    NOT NULL,
  completed_at TEXT
);
SQL

  # Insert one repo row
  sqlite3 "$db_path" "INSERT INTO repos (path, name, type) VALUES ('$fixture_cwd', 'test-repo', 'node');"

  # Insert SERVICES_COUNT service rows
  local i
  for (( i=1; i<=services_count; i++ )); do
    sqlite3 "$db_path" "INSERT INTO services (repo_id, name, root_path, language) VALUES (1, 'svc-${i}', '/src/svc-${i}', 'javascript');"
  done

  # Insert LOAD_BEARING_COUNT connections with DISTINCT non-null source_file
  for (( i=1; i<=load_bearing_count; i++ )); do
    sqlite3 "$db_path" "INSERT INTO connections (source_service_id, target_service_id, protocol, source_file) VALUES (1, 1, 'http', '/src/svc-${i}/index.js');"
  done

  # Insert SERVICES_COUNT connections with source_file NULL to test DISTINCT-non-null filter
  for (( i=1; i<=services_count; i++ )); do
    sqlite3 "$db_path" "INSERT INTO connections (source_service_id, target_service_id, protocol, source_file) VALUES (1, 1, 'http', NULL);"
  done

  # Insert scan_versions row with completed_at = now - SCAN_AGE_HOURS hours
  sqlite3 "$db_path" "INSERT INTO scan_versions (repo_id, started_at, completed_at) VALUES (1, datetime('now', '-${scan_age_hours} hours'), datetime('now', '-${scan_age_hours} hours'));"

  echo "$db_path"
}

# Self-test documented invariant (commented — not executed automatically):
# For cwd="/Users/test/fixture-a":
#   Node:  crypto.createHash("sha256").update("/Users/test/fixture-a").digest("hex").slice(0,12) => 97c700e1dba2
#   Shell: printf '%s' "/Users/test/fixture-a" | shasum -a 256 | awk '{print $1}' | cut -c1-12   => 97c700e1dba2
