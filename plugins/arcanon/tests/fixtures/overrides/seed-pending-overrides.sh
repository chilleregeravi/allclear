#!/usr/bin/env bash
# plugins/arcanon/tests/fixtures/overrides/seed-pending-overrides.sh
# Phase 117-02 (CORRECT-03).
#
# Thin wrapper around seed-pending-overrides.js. Invoked from
# tests/scan-overrides-apply.bats setup() to populate a fresh SQLite DB at
# the path the bats test specifies.
#
# Mirrors the verify/list/freshness fixture pattern (bash wrapper -> node seed)
# rather than raw sqlite3 CLI: the migrations are JS modules, so re-running
# them via Node guarantees the schema is byte-identical to what the worker
# applies in production. Plain sqlite3 + raw DDL would fork the schema
# definition and silently drift.
#
# Lives inside plugins/arcanon/tests/fixtures/overrides/ so seed.js's
# better-sqlite3 import resolves naturally via plugins/arcanon/node_modules/.
#
# Usage: seed-pending-overrides.sh <project-root> <db-path>

set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "usage: seed-pending-overrides.sh <project-root> <db-path>" >&2
  exit 2
fi

PROJECT_ROOT="$1"
DB_PATH="$2"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

mkdir -p "$(dirname "$DB_PATH")"

exec node "$SCRIPT_DIR/seed-pending-overrides.js" \
  --project "$PROJECT_ROOT" \
  --db "$DB_PATH"
