#!/usr/bin/env bash
# drift-versions.sh — Cross-repo dependency version drift checker
# Part of the AllClear drift skill (Phase 10, DRFT-01, DRFT-05, DRFT-06)
# Usage: drift-versions.sh [--all] [--test-only]
#   --all        Show INFO-level findings (suppressed by default)
#   --test-only  Source-safe: define functions but do not execute main loop
#
# Environment:
#   DRIFT_TEST_SIBLINGS  Space-separated repo paths (overrides sibling discovery, for testing)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/drift-common.sh"

parse_drift_args "$@"

# ---------------------------------------------------------------------------
# extract_versions REPO_DIR
# Outputs "PACKAGE_NAME=VERSION" lines for all detected manifests in REPO_DIR.
# Supports: package.json, go.mod, Cargo.toml, pyproject.toml
# ---------------------------------------------------------------------------
extract_versions() {
  local repo_dir="$1"

  # ---- package.json (jq — always available per PLGN-07) -------------------
  if [[ -f "${repo_dir}/package.json" ]]; then
    jq -r '
      (.dependencies // {}) + (.devDependencies // {}) |
      to_entries[] |
      "\(.key)=\(.value)"
    ' "${repo_dir}/package.json" 2>/dev/null || true
  fi

  # ---- go.mod (awk — pure POSIX, handles both inline and block forms) ------
  if [[ -f "${repo_dir}/go.mod" ]]; then
    awk '
      /^require \(/ { in_block=1; next }
      /^\)/         { in_block=0; next }
      in_block && /^\t/ { print $1"="$2 }
      /^require [^(]/ { print $2"="$3 }
    ' "${repo_dir}/go.mod" 2>/dev/null || true
  fi

  # ---- Cargo.toml ----------------------------------------------------------
  if [[ -f "${repo_dir}/Cargo.toml" ]]; then
    if command -v yq &>/dev/null; then
      # yq TOML: extract dependencies, handle both string and inline-table forms
      yq -oy '(.dependencies // {}) | to_entries[] | .key + "=" + (.value | (.version // .))' \
        "${repo_dir}/Cargo.toml" 2>/dev/null | grep -v '^null$' | grep -v '=$' || true
    else
      # Fallback 1: simple "name = "1.2.3"" form
      grep -E '^\s*[a-zA-Z0-9_-]+ *= *"[0-9]' "${repo_dir}/Cargo.toml" 2>/dev/null |
        sed 's/[[:space:]]//g; s/="\([^"]*\)".*/=\1/' || true
      # Fallback 2: inline table "name = { version = "1.2.3", ... }" form
      grep -E '^\s*[a-zA-Z0-9_-]+ *= *\{' "${repo_dir}/Cargo.toml" 2>/dev/null | while IFS= read -r cargo_line; do
        local pkg_name ver_val
        pkg_name=$(echo "$cargo_line" | sed 's/[[:space:]]*=.*//' | tr -d '[:space:]')
        ver_val=$(echo "$cargo_line" | grep -oE 'version = "[^"]+"' | sed 's/version = "//; s/"//' || true)
        [[ -n "$pkg_name" && -n "$ver_val" ]] && echo "${pkg_name}=${ver_val}"
      done || true
    fi
  fi

  # ---- pyproject.toml ------------------------------------------------------
  if [[ -f "${repo_dir}/pyproject.toml" ]]; then
    if command -v yq &>/dev/null; then
      # Extract [project.dependencies] PEP 508 strings and normalize to NAME=VERSION
      yq -oy '.project.dependencies[]' "${repo_dir}/pyproject.toml" 2>/dev/null | while IFS= read -r dep_str; do
        # Strip surrounding quotes
        dep_str=$(echo "$dep_str" | tr -d '"')
        # name = everything before first specifier char
        local dep_name dep_ver
        dep_name=$(echo "$dep_str" | sed 's/[>=<!~^ ].*//')
        dep_ver=$(echo "$dep_str" | grep -oE '[>=<!~^][^,; ]+' | head -1 | sed 's/^==//' || true)
        [[ -n "$dep_name" ]] && echo "${dep_name}=${dep_ver:-unknown}"
      done 2>/dev/null || true
      # Also extract [tool.poetry.dependencies]
      yq -oy '.tool.poetry.dependencies | to_entries[] | .key + "=" + .value' \
        "${repo_dir}/pyproject.toml" 2>/dev/null | grep -v '^null$' | grep -v 'python=' || true
    else
      # Fallback: awk to find [project.dependencies] and parse PEP 508 strings
      awk '
        /\[project\.dependencies\]/ { in_section=1; next }
        /^\[/ && !/\[project\.dependencies\]/ { in_section=0 }
        in_section && /[a-zA-Z0-9]/ {
          line=$0
          # Remove surrounding quotes, leading spaces
          gsub(/^[[:space:]]*"/, "", line)
          gsub(/"[[:space:]]*$/, "", line)
          gsub(/^[[:space:]]*/, "", line)
          # Extract name (everything before first specifier or space)
          n=split(line, parts, /[>=<!~^ ]/)
          name=parts[1]
          # Extract version specifier
          ver=substr(line, length(name)+1)
          gsub(/^[[:space:]]*/, "", ver)
          gsub(/^==/, "", ver)
          gsub(/^=/, "", ver)
          if (name != "") print name "=" ver
        }
      ' "${repo_dir}/pyproject.toml" 2>/dev/null || true
    fi
  fi
}

# ---------------------------------------------------------------------------
# normalize_version VERSION
# Strips leading semver range specifiers (^, ~, >=, <=, >, <, ==) for comparison.
# ---------------------------------------------------------------------------
normalize_version() {
  echo "$1" | sed 's/^[^0-9a-zA-Z]*//' | sed 's/^[^0-9]*//'
}

# ---------------------------------------------------------------------------
# has_range_specifier VERSION
# Returns 0 (true) if version string starts with a range specifier char
# ---------------------------------------------------------------------------
has_range_specifier() {
  [[ "$1" =~ ^[\^~\>=\<] ]]
}

# ---------------------------------------------------------------------------
# Main comparison loop
# Skip when --test-only is passed (allows sourcing from tests to call extract_versions)
# ---------------------------------------------------------------------------
for _arg in "$@"; do
  if [[ "$_arg" == "--test-only" ]]; then
    # Export functions so subshells can use them, then stop here
    export -f extract_versions normalize_version has_range_specifier
    return 0 2>/dev/null || exit 0
  fi
done
unset _arg

# Allow test harness to inject siblings via environment variable
if [[ -n "${DRIFT_TEST_SIBLINGS:-}" ]]; then
  SIBLINGS="$DRIFT_TEST_SIBLINGS"
fi

if [[ -z "${SIBLINGS:-}" ]]; then
  echo "No sibling repos found. Run from a directory with sibling git repos." >&2
  exit 0
fi

declare -A pkg_versions  # pkg_versions["REPO_NAME:PKG"]="VERSION"
declare -A pkg_repos     # pkg_repos["PKG"]="repo1 repo2 ..."

for REPO in $SIBLINGS; do
  [[ -d "$REPO" ]] || continue
  repo_name=$(basename "$REPO")
  while IFS='=' read -r pkg ver; do
    [[ -z "${pkg:-}" || -z "${ver:-}" ]] && continue
    [[ "$pkg" =~ ^[[:space:]]*$ ]] && continue
    pkg_versions["${repo_name}:${pkg}"]="$ver"
    # Track repos for this package (avoid duplicates)
    current_repos="${pkg_repos[$pkg]:-}"
    if [[ "$current_repos" != *"$repo_name"* ]]; then
      pkg_repos["$pkg"]="${current_repos}${repo_name} "
    fi
  done < <(extract_versions "$REPO" 2>/dev/null || true)
done

found_drift=false

for pkg in $(echo "${!pkg_repos[@]}" | tr ' ' '\n' | sort); do
  repos="${pkg_repos[$pkg]:-}"
  repo_count=$(echo "$repos" | tr ' ' '\n' | grep -c '\S' || true)
  [[ "$repo_count" -lt 2 ]] && continue  # single-repo package — not drift

  versions_raw=""
  repos_detail=""
  has_range=false

  for repo in $repos; do
    v="${pkg_versions["${repo}:${pkg}"]:-}"
    [[ -z "$v" ]] && continue
    norm=$(normalize_version "$v")
    versions_raw="${versions_raw}${norm} "
    repos_detail="${repos_detail}${repo}=${v} "
    has_range_specifier "$v" && has_range=true || true
  done

  unique_count=$(echo "$versions_raw" | tr ' ' '\n' | sort -u | grep -c '\S' || true)

  if [[ "$unique_count" -gt 1 ]]; then
    found_drift=true
    if $has_range; then
      emit_finding "WARN" "$pkg" "$repos" "Different locking strategies: ${repos_detail%% }"
    else
      emit_finding "CRITICAL" "$pkg" "$repos" "Version mismatch: ${repos_detail%% }"
    fi
  elif [[ "$unique_count" -eq 1 ]]; then
    # Stripped versions match but check if raw strings differ (range specifier mismatch)
    raw_unique=$(echo "$repos_detail" | tr ' ' '\n' | grep -v '^$' | awk -F= '{print $NF}' | sort -u | grep -c '\S' || true)
    if [[ "$raw_unique" -gt 1 ]]; then
      found_drift=true
      emit_finding "WARN" "$pkg" "$repos" "Different range specifiers: ${repos_detail%% }"
    else
      emit_finding "INFO" "$pkg" "$repos" "All at same version (${versions_raw%% *})"
    fi
  fi
done

if ! $found_drift; then
  repo_count=$(echo "$SIBLINGS" | tr ' ' '\n' | grep -c '\S' || true)
  echo "No version drift detected across ${repo_count} repos."
fi
