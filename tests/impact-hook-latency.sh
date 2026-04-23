#!/usr/bin/env bash
# tests/impact-hook-latency.sh — 100-iteration p99 latency benchmark for impact-hook.sh
#
# Exits 0 if p99 < THRESHOLD_MS, 1 otherwise.
# Prints: "impact-hook latency: iterations=100 p99=<N>ms threshold=50ms"
#
# Required env vars (must be pre-populated by caller):
#   ARCANON_DATA_DIR  — data dir containing the fake impact-map.db
#   PROJECT_ROOT      — the project root whose hash matches the DB
#
# Optional env vars:
#   THRESHOLD_MS      — p99 threshold in ms (default: 50)
#   ITERATIONS        — number of iterations (default: 100)
#
# Typical caller (bats):
#   setup_fake_db
#   export THRESHOLD_MS=50 ITERATIONS=100
#   run bash "${BATS_TEST_DIRNAME}/impact-hook-latency.sh"
#   assert_success

set -uo pipefail

THRESHOLD_MS="${THRESHOLD_MS:-50}"
ITERATIONS="${ITERATIONS:-100}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="${REPO_ROOT}/plugins/arcanon/scripts/impact-hook.sh"

# Validate required env vars
[[ -n "${ARCANON_DATA_DIR:-}" ]] || { echo "ARCANON_DATA_DIR not set" >&2; exit 1; }
[[ -n "${PROJECT_ROOT:-}" ]] || { echo "PROJECT_ROOT not set" >&2; exit 1; }

# Use a file inside the auth service so every iteration exercises the Tier 2 + SQLite path
FILE="${PROJECT_ROOT}/services/auth/index.js"
INPUT=$(printf '{"tool_name":"Write","tool_input":{"file_path":"%s"}}' "$FILE")

# Portable millisecond timer — validates date +%s%3N (broken on macOS BSD date)
_ms_now() {
  local _v
  _v=$(date +%s%3N 2>/dev/null)
  if [[ "$_v" =~ ^[0-9]+$ ]]; then
    printf '%s' "$_v"
  else
    python3 -c 'import time;print(int(time.time()*1000))' 2>/dev/null || echo 0
  fi
}

declare -a TIMES
for i in $(seq 1 "$ITERATIONS"); do
  t0=$(_ms_now)
  printf '%s' "$INPUT" | bash "$SCRIPT" >/dev/null 2>&1
  t1=$(_ms_now)
  TIMES+=( $(( t1 - t0 )) )
done

# Sort ascending
SORTED=($(printf '%s\n' "${TIMES[@]}" | sort -n))

# p99 index: floor(0.99 * N) gives 99th iteration (1-indexed) = index 98 (0-indexed) for N=100
# General formula: index = floor(ITERATIONS * 99 / 100) - 1
P99_INDEX=$(( (ITERATIONS * 99 / 100) - 1 ))
[[ "$P99_INDEX" -lt 0 ]] && P99_INDEX=0
P99="${SORTED[$P99_INDEX]}"

echo "impact-hook latency: iterations=${ITERATIONS} p99=${P99}ms threshold=${THRESHOLD_MS}ms"

if (( P99 > THRESHOLD_MS )); then
  echo "FAIL: p99 ${P99}ms exceeds threshold ${THRESHOLD_MS}ms" >&2
  exit 1
fi

exit 0
