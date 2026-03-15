#!/usr/bin/env bats
# tests/file-guard.bats
# Bats test suite for scripts/file-guard.sh
# Covers all GRDH-01 through GRDH-08 requirements

SCRIPT="${BATS_TEST_DIRNAME}/../scripts/file-guard.sh"

make_input() {
  local tool="$1" path="$2"
  printf '{"tool_name": "%s", "tool_input": {"file_path": "%s"}}' "$tool" "$path"
}

# ---------------------------------------------------------------------------
# GRDH-03: Hard-block secret/credential files (exit 2)
# ---------------------------------------------------------------------------

@test "hard-blocks .env via Write tool (GRDH-03)" {
  run bash "$SCRIPT" <<< "$(make_input Write "/project/.env")"
  [ "$status" -eq 2 ]
}

@test "hard-blocks .env.production via Edit tool (GRDH-03)" {
  run bash "$SCRIPT" <<< "$(make_input Edit "/project/.env.production")"
  [ "$status" -eq 2 ]
}

@test "hard-blocks .env.local via MultiEdit tool (GRDH-01 MultiEdit coverage, GRDH-03)" {
  run bash "$SCRIPT" <<< "$(make_input MultiEdit "/project/.env.local")"
  [ "$status" -eq 2 ]
}

@test "hard-blocks .env in subdirectory (GRDH-03)" {
  run bash "$SCRIPT" <<< "$(make_input Write "/project/config/.env")"
  [ "$status" -eq 2 ]
}

@test "hard-blocks server.pem (GRDH-03)" {
  run bash "$SCRIPT" <<< "$(make_input Write "/project/certs/server.pem")"
  [ "$status" -eq 2 ]
}

@test "hard-blocks private.key (GRDH-03)" {
  run bash "$SCRIPT" <<< "$(make_input Write "/project/private.key")"
  [ "$status" -eq 2 ]
}

@test "hard-blocks aws_credentials.json (GRDH-03)" {
  run bash "$SCRIPT" <<< "$(make_input Write "/project/aws_credentials.json")"
  [ "$status" -eq 2 ]
}

@test "hard-blocks client_secret.yaml (GRDH-03)" {
  run bash "$SCRIPT" <<< "$(make_input Write "/project/client_secret.yaml")"
  [ "$status" -eq 2 ]
}

# ---------------------------------------------------------------------------
# GRDH-02: Hard-block lock files (exit 2)
# ---------------------------------------------------------------------------

@test "hard-blocks Cargo.lock (GRDH-02)" {
  run bash "$SCRIPT" <<< "$(make_input Write "/project/Cargo.lock")"
  [ "$status" -eq 2 ]
}

@test "hard-blocks package-lock.json (GRDH-02)" {
  run bash "$SCRIPT" <<< "$(make_input Write "/project/package-lock.json")"
  [ "$status" -eq 2 ]
}

@test "hard-blocks poetry.lock (GRDH-02)" {
  run bash "$SCRIPT" <<< "$(make_input Write "/project/poetry.lock")"
  [ "$status" -eq 2 ]
}

@test "hard-blocks bun.lock (GRDH-02)" {
  run bash "$SCRIPT" <<< "$(make_input Write "/project/bun.lock")"
  [ "$status" -eq 2 ]
}

@test "hard-blocks yarn.lock (GRDH-02)" {
  run bash "$SCRIPT" <<< "$(make_input Write "/project/yarn.lock")"
  [ "$status" -eq 2 ]
}

@test "hard-blocks any *.lock file (GRDH-02)" {
  run bash "$SCRIPT" <<< "$(make_input Write "/project/Pipfile.lock")"
  [ "$status" -eq 2 ]
}

# ---------------------------------------------------------------------------
# GRDH-04: Hard-block generated directories (exit 2)
# ---------------------------------------------------------------------------

@test "hard-blocks file in node_modules/ (GRDH-04)" {
  run bash "$SCRIPT" <<< "$(make_input Write "/project/node_modules/lodash/index.js")"
  [ "$status" -eq 2 ]
}

@test "hard-blocks file in .venv/ (GRDH-04)" {
  run bash "$SCRIPT" <<< "$(make_input Write "/project/.venv/lib/site.py")"
  [ "$status" -eq 2 ]
}

@test "hard-blocks file in target/ (GRDH-04)" {
  run bash "$SCRIPT" <<< "$(make_input Write "/project/target/debug/main")"
  [ "$status" -eq 2 ]
}

# ---------------------------------------------------------------------------
# GRDH-08: Block message format ("AllClear: blocked write to X -- Y" on stderr)
# ---------------------------------------------------------------------------

@test "block message contains 'AllClear: blocked write to' on stderr (GRDH-08)" {
  run bash "$SCRIPT" <<< "$(make_input Write "/project/.env")"
  [ "$status" -eq 2 ]
  [[ "$output" == *"AllClear: blocked write to"* ]] || [[ "${lines[@]}" == *"AllClear: blocked write to"* ]]
}

@test "block message mentions blocked filename (GRDH-08)" {
  run bash "$SCRIPT" <<< "$(make_input Write "/project/aws_credentials.json")"
  [ "$status" -eq 2 ]
  [[ "$output" == *"aws_credentials.json"* ]] || [[ "${lines[@]}" == *"aws_credentials.json"* ]]
}

@test "stdout is empty on hard block — block message goes to stderr only (Pitfall 5)" {
  # Run without capturing stderr (bats $output captures stdout by default when using run)
  # We need to check stdout is empty and status is 2
  run bash "$SCRIPT" <<< "$(make_input Write "/project/.env")"
  [ "$status" -eq 2 ]
  # $output in bats captures both stdout and stderr by default with 'run'
  # We need to explicitly check stdout only
  stdout=$(bash "$SCRIPT" <<< "$(make_input Write "/project/.env")" 2>/dev/null; true)
  [ -z "$stdout" ]
}

# ---------------------------------------------------------------------------
# GRDH-05: Soft-warn migration files (exit 0 + systemMessage JSON)
# ---------------------------------------------------------------------------

@test "soft-warns on SQL migration file — exits 0 (GRDH-05)" {
  run bash "$SCRIPT" <<< "$(make_input Edit "/project/migrations/0001_initial.sql")"
  [ "$status" -eq 0 ]
}

@test "soft-warns on SQL migration file — stdout contains systemMessage (GRDH-05)" {
  out=$(bash "$SCRIPT" <<< "$(make_input Edit "/project/migrations/0001_initial.sql")")
  [[ "$out" == *"systemMessage"* ]]
}

@test "soft-warns on Python migration file — exits 0 (GRDH-05)" {
  run bash "$SCRIPT" <<< "$(make_input Edit "/project/migrations/0002_add_users.py")"
  [ "$status" -eq 0 ]
}

@test "soft-warns on Python migration file — stdout contains systemMessage (GRDH-05)" {
  out=$(bash "$SCRIPT" <<< "$(make_input Edit "/project/migrations/0002_add_users.py")")
  [[ "$out" == *"systemMessage"* ]]
}

# ---------------------------------------------------------------------------
# GRDH-06: Soft-warn generated code files (exit 0 + systemMessage JSON)
# ---------------------------------------------------------------------------

@test "soft-warns on *.pb.go file — exits 0 (GRDH-06)" {
  run bash "$SCRIPT" <<< "$(make_input Edit "/project/api/user.pb.go")"
  [ "$status" -eq 0 ]
}

@test "soft-warns on *.pb.go file — stdout contains systemMessage (GRDH-06)" {
  out=$(bash "$SCRIPT" <<< "$(make_input Edit "/project/api/user.pb.go")")
  [[ "$out" == *"systemMessage"* ]]
}

@test "soft-warns on *_generated.* file — exits 0 (GRDH-06)" {
  run bash "$SCRIPT" <<< "$(make_input Edit "/project/models/user_generated.ts")"
  [ "$status" -eq 0 ]
}

@test "soft-warns on *_generated.* file — stdout contains systemMessage (GRDH-06)" {
  out=$(bash "$SCRIPT" <<< "$(make_input Edit "/project/models/user_generated.ts")")
  [[ "$out" == *"systemMessage"* ]]
}

@test "soft-warns on *.gen.* file — exits 0 (GRDH-06)" {
  run bash "$SCRIPT" <<< "$(make_input Edit "/project/lib/config.gen.go")"
  [ "$status" -eq 0 ]
}

@test "soft-warns on *.gen.* file — stdout contains systemMessage (GRDH-06)" {
  out=$(bash "$SCRIPT" <<< "$(make_input Edit "/project/lib/config.gen.go")")
  [[ "$out" == *"systemMessage"* ]]
}

# ---------------------------------------------------------------------------
# GRDH-07: Soft-warn CHANGELOG (exit 0 + systemMessage JSON)
# ---------------------------------------------------------------------------

@test "soft-warns on CHANGELOG.md — exits 0 (GRDH-07)" {
  run bash "$SCRIPT" <<< "$(make_input Edit "/project/CHANGELOG.md")"
  [ "$status" -eq 0 ]
}

@test "soft-warns on CHANGELOG.md — stdout contains systemMessage (GRDH-07)" {
  out=$(bash "$SCRIPT" <<< "$(make_input Edit "/project/CHANGELOG.md")")
  [[ "$out" == *"systemMessage"* ]]
}

# ---------------------------------------------------------------------------
# Allow: Normal source files (exit 0, empty stdout)
# ---------------------------------------------------------------------------

@test "allows normal Go source file — exits 0 with no output" {
  run bash "$SCRIPT" <<< "$(make_input Edit "/project/src/main.go")"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "allows normal Rust source file — exits 0 with no output" {
  run bash "$SCRIPT" <<< "$(make_input Write "/project/src/lib.rs")"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "allows README.md — exits 0 with no output" {
  run bash "$SCRIPT" <<< "$(make_input Edit "/project/README.md")"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "allows input with no file_path field — exits 0 (Bash tool)" {
  run bash "$SCRIPT" <<< '{"tool_name": "Bash", "tool_input": {"command": "ls"}}'
  [ "$status" -eq 0 ]
}

# ---------------------------------------------------------------------------
# Config: ALLCLEAR_DISABLE_GUARD bypass
# ---------------------------------------------------------------------------

@test "ALLCLEAR_DISABLE_GUARD=1 bypasses guard and allows .env (CONF-02)" {
  ALLCLEAR_DISABLE_GUARD=1 run bash "$SCRIPT" <<< "$(make_input Write "/project/.env")"
  [ "$status" -eq 0 ]
}

@test "ALLCLEAR_DISABLE_GUARD=1 bypasses guard and allows Cargo.lock (CONF-02)" {
  ALLCLEAR_DISABLE_GUARD=1 run bash "$SCRIPT" <<< "$(make_input Write "/project/Cargo.lock")"
  [ "$status" -eq 0 ]
}

# ---------------------------------------------------------------------------
# Config: ALLCLEAR_EXTRA_BLOCKED custom patterns (CONF-04)
# ---------------------------------------------------------------------------

@test "ALLCLEAR_EXTRA_BLOCKED adds custom block pattern for *.sql (CONF-04)" {
  # Without EXTRA_BLOCKED, a plain .sql file (not in migrations/) would be allowed
  # With EXTRA_BLOCKED="*.sql", it should be blocked
  ALLCLEAR_EXTRA_BLOCKED="*.sql" run bash "$SCRIPT" <<< "$(make_input Write "/project/data/export.sql")"
  [ "$status" -eq 2 ]
}

@test "ALLCLEAR_EXTRA_BLOCKED colon-separated patterns work (CONF-04)" {
  ALLCLEAR_EXTRA_BLOCKED="*.sql:*.csv" run bash "$SCRIPT" <<< "$(make_input Write "/project/data/users.csv")"
  [ "$status" -eq 2 ]
}

# ---------------------------------------------------------------------------
# Path normalization (Pitfall 3)
# ---------------------------------------------------------------------------

@test "path traversal ../../.env is still blocked (Pitfall 3)" {
  run bash "$SCRIPT" <<< "$(make_input Write "../../.env")"
  [ "$status" -eq 2 ]
}

@test "path with ../ components resolving to .env is blocked (Pitfall 3)" {
  run bash "$SCRIPT" <<< "$(make_input Write "/project/config/../.env")"
  [ "$status" -eq 2 ]
}
