#!/usr/bin/env bash
# plugins/arcanon/tests/fixtures/diff/seed.sh — Phase 115-02 (NAV-04).
#
# Thin wrapper around seed.js. Invoked from tests/diff.bats setup() to
# populate a fresh SQLite DB at the path the Arcanon worker computes for the
# bats project root (sha256[0:12] under $ARCANON_DATA_DIR/projects/<hash>/impact-map.db).
#
# Mirrors plugins/arcanon/tests/fixtures/list/seed.sh but with extra `mode`
# argument so a single seeder script can produce all of:
#
#   default — 2 scans for happy-path integer / modified-row tests
#   same    — 1 scan for the same-scan short-circuit test
#   iso     — 3 scans with explicit `completed_at` timestamps
#   head    — 4 scans for HEAD / HEAD~N / out-of-range tests
#   branch  — 2 scans whose repo_state.last_scanned_commit matches branch SHAs
#             from a real tmp git repo (`$4=GIT_REPO_PATH`)
#
# Usage: seed.sh <project-root> <db-path> [mode] [git-repo-path]

set -euo pipefail

if [ "$#" -lt 2 ] || [ "$#" -gt 4 ]; then
  echo "usage: seed.sh <project-root> <db-path> [mode] [git-repo-path]" >&2
  exit 2
fi

PROJECT_ROOT="$1"
DB_PATH="$2"
MODE="${3:-default}"
GIT_REPO_PATH="${4:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

mkdir -p "$(dirname "$DB_PATH")"

if [ -n "$GIT_REPO_PATH" ]; then
  exec node "$SCRIPT_DIR/seed.js" --project "$PROJECT_ROOT" --db "$DB_PATH" --mode "$MODE" --git-repo "$GIT_REPO_PATH"
else
  exec node "$SCRIPT_DIR/seed.js" --project "$PROJECT_ROOT" --db "$DB_PATH" --mode "$MODE"
fi
