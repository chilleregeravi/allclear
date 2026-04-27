#!/usr/bin/env bash
# plugins/arcanon/tests/fixtures/correct/seed.sh — Phase 118-01 (CORRECT-02).
#
# Thin wrapper around seed.js. Invoked from tests/correct.bats setup() to
# populate a fresh SQLite DB at the path /arcanon:correct will compute for
# the bats project root (sha256[0:12] under
# $ARCANON_DATA_DIR/projects/<hash>/impact-map.db).
#
# Echoes the seeded row IDs as JSON on stdout for the test to capture.
#
# Usage: seed.sh <project-root> <db-path>

set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "usage: seed.sh <project-root> <db-path>" >&2
  exit 2
fi

PROJECT_ROOT="$1"
DB_PATH="$2"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

mkdir -p "$(dirname "$DB_PATH")"

exec node "$SCRIPT_DIR/seed.js" --project "$PROJECT_ROOT" --db "$DB_PATH"
