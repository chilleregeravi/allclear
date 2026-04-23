#!/usr/bin/env bash
# tests/fixtures/impact-hook/setup-fake-db.sh
# Creates a deterministic fake impact-map.db with:
#   - repo at $PROJECT_ROOT
#   - services: auth (root_path=$PROJECT_ROOT/services/auth), web (root_path=$PROJECT_ROOT/services/web)
#   - connection: web -> auth (so auth has 1 consumer: web)
# Does NOT create auth-legacy service (deliberately — used by false-positive test).
#
# Usage:
#   export ARCANON_DATA_DIR=<temp>
#   export PROJECT_ROOT=<temp>/project
#   source setup-fake-db.sh
#   setup_fake_db
#
# Returns: db path on stdout (0) or error message on stderr (1)

[[ "${BASH_SOURCE[0]}" != "${0}" ]] || { echo "Source this file; do not execute directly." >&2; exit 1; }

setup_fake_db() {
  [[ -z "${ARCANON_DATA_DIR:-}" ]] && { echo "ARCANON_DATA_DIR not set" >&2; return 1; }
  [[ -z "${PROJECT_ROOT:-}" ]] && { echo "PROJECT_ROOT not set" >&2; return 1; }

  # Resolve repo root. Priority order:
  #   1. BATS_TEST_DIRNAME (set by bats; points at tests/)  — subtract one level
  #   2. BASH_SOURCE[0]   (set when sourced by path; empty in `bash -c '...'`)
  #   3. PWD fallback (last resort — caller must be in repo root)
  local repo_root plugin_root
  if [[ -n "${BATS_TEST_DIRNAME:-}" ]]; then
    repo_root="$(cd "${BATS_TEST_DIRNAME}/.." && pwd)"
  elif [[ -n "${BASH_SOURCE[0]:-}" ]]; then
    local _src_dir
    _src_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    repo_root="$(cd "${_src_dir}/../../.." && pwd)"
  else
    repo_root="$(pwd)"
  fi
  plugin_root="${repo_root}/plugins/arcanon"

  # Source the real db-path.sh to use the same hash algorithm
  # shellcheck source=../../../plugins/arcanon/lib/db-path.sh
  source "${plugin_root}/lib/db-path.sh" 2>/dev/null || {
    echo "setup_fake_db: failed to source db-path.sh from ${plugin_root}/lib/db-path.sh" >&2
    return 1
  }

  # Resolve DB hash using the real resolve_project_db_hash function
  local db_hash
  db_hash=$(resolve_project_db_hash "$PROJECT_ROOT") || {
    echo "setup_fake_db: failed to compute db hash" >&2
    return 1
  }

  # Create project filesystem (real dirs so _find_project_root can locate .git)
  mkdir -p "$PROJECT_ROOT/.git"
  mkdir -p "$PROJECT_ROOT/services/auth"
  mkdir -p "$PROJECT_ROOT/services/auth-legacy"
  mkdir -p "$PROJECT_ROOT/services/web"

  # Create DB directory and schema
  local db_dir="${ARCANON_DATA_DIR}/projects/${db_hash}"
  mkdir -p "$db_dir"
  local db_path="${db_dir}/impact-map.db"
  rm -f "$db_path"

  sqlite3 "$db_path" <<SQL
CREATE TABLE repos(id INTEGER PRIMARY KEY, path TEXT, name TEXT, type TEXT);
INSERT INTO repos VALUES(1,'${PROJECT_ROOT}','fake-project','single');

CREATE TABLE services(id INTEGER PRIMARY KEY, repo_id INTEGER, name TEXT, root_path TEXT, language TEXT);
INSERT INTO services VALUES(1,1,'auth','services/auth','node');
INSERT INTO services VALUES(2,1,'web','services/web','node');

CREATE TABLE connections(
  id INTEGER PRIMARY KEY,
  source_service_id INTEGER,
  target_service_id INTEGER,
  protocol TEXT,
  method TEXT,
  path TEXT,
  source_file TEXT,
  target_file TEXT
);
-- web -> auth (web calls auth; auth has web as consumer)
INSERT INTO connections(source_service_id,target_service_id,protocol) VALUES(2,1,'http');
SQL

  echo "$db_path"
}

teardown_fake_db() {
  # Remove project root subtree (contained under TMP_ROOT so this is safe)
  [[ -n "${PROJECT_ROOT:-}" ]] && rm -rf "$PROJECT_ROOT"
  # Remove data dir only if it's under /tmp (safety check)
  if [[ -n "${ARCANON_DATA_DIR:-}" && "$ARCANON_DATA_DIR" == /tmp/* ]]; then
    rm -rf "$ARCANON_DATA_DIR"
  fi
  return 0
}
