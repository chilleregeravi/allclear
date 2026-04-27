#!/usr/bin/env bash
# plugins/arcanon/tests/fixtures/freshness/seed.sh — Phase 116-02 (FRESH-05).
#
# Thin wrapper around seed.js. Invoked from tests/freshness.bats setup() to:
#   1. Build a fresh git repo at <project-root>/repo-a/ with 4 commits.
#   2. Seed an SQLite DB with one repo + repo_state pointing at the init SHA
#      (so 3 commits are "new") + one scan_versions row with quality_score=0.87.
#
# The script echoes the captured INIT_SHA to stdout (last line) so the bats
# test can capture it via $(bash seed.sh ...).
#
# Lives inside plugins/arcanon/tests/fixtures/ so seed.js's `import 'better-sqlite3'`
# resolves naturally via plugins/arcanon/node_modules/. No cwd hack needed.
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
mkdir -p "$PROJECT_ROOT"

exec node "$SCRIPT_DIR/seed.js" --project "$PROJECT_ROOT" --db "$DB_PATH"
