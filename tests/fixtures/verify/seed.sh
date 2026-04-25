#!/usr/bin/env bash
# tests/fixtures/verify/seed.sh — Phase 112-02 (TRUST-07/08/09).
#
# Thin wrapper around tests/fixtures/verify/seed.js. Invoked from
# tests/verify.bats setup() to populate a fresh SQLite DB at the path the
# Arcanon worker computes for the bats project root (sha256[0:12] under
# $ARCANON_DATA_DIR/projects/<hash>/impact-map.db).
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
