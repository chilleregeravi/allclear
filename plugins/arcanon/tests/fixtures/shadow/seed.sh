#!/usr/bin/env bash
# plugins/arcanon/tests/fixtures/shadow/seed.sh — Phase 119-01 (SHADOW-01).
#
# Thin wrapper around seed.js. Invoked from tests/shadow-scan.bats setup() to:
#   1. Create one real git repo under <project-root> (api) so manager.js's
#      getCurrentHead() git rev-parse HEAD has a real commit to report.
#      Required because the shadow-scan path (like rescan) calls upsertRepo →
#      buildScanContext → getCurrentHead transparently.
#   2. Optionally populate a fresh SQLite DB (live OR shadow) at <db-path>
#      with a baseline state: 1 repo, 2 services, 1 connection, 1 prior
#      scan_versions row. Used by Test 8's byte-identity assertion (the live
#      DB MUST be byte-identical before and after a shadow scan).
#   3. Echoes the resolved IDs as JSON on stdout for the test to capture.
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

# 1. Create one real git repo under the project root with a single committed
#    file so getCurrentHead() returns a real commit hash.
REPO_DIR="$PROJECT_ROOT/api"
mkdir -p "$REPO_DIR"
if [ ! -d "$REPO_DIR/.git" ]; then
  (
    cd "$REPO_DIR"
    git init -q -b main
    git config user.email "shadow-fixture@arcanon.local"
    git config user.name "Shadow Fixture"
    echo "// api seed" > README.md
    git add README.md
    git commit -q -m "init"
  )
fi

mkdir -p "$(dirname "$DB_PATH")"

exec node "$SCRIPT_DIR/seed.js" --project "$PROJECT_ROOT" --db "$DB_PATH"
