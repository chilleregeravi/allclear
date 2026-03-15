# tests/helpers/mock_detect.bash
# Mock detect_project_type for session-start hook tests.
# Override the real lib/detect.sh function with a controlled return value.
# Usage: source this file after MOCK_PROJECT_TYPE is set.

detect_project_type() {
  echo "${MOCK_PROJECT_TYPE:-}"
}

# build_hook_input SESSION_ID [EVENT] [CWD]
# Constructs the JSON input fed to session-start.sh on stdin.
build_hook_input() {
  local session_id="${1:-test-session}"
  local event="${2:-SessionStart}"
  local cwd="${3:-/tmp/test-project}"
  printf '{"session_id":"%s","cwd":"%s","hook_event_name":"%s"}' "$session_id" "$cwd" "$event"
}

# cleanup_session_flags
# Removes dedup flag files created during tests.
cleanup_session_flags() {
  rm -f /tmp/allclear_session_test-session*.initialized
  rm -f /tmp/allclear_session_bats-*.initialized
}
