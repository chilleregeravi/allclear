#!/usr/bin/env bash
# lib/siblings.sh — Sibling repo discovery library
# Source this file; do not execute directly.
# No set -e here — sourcing context owns error handling.

[[ "${BASH_SOURCE[0]}" != "${0}" ]] || { echo "Source this file; do not execute directly." >&2; exit 1; }

# discover_siblings [PROJECT_DIR]
# Scans the parent directory of PROJECT_DIR for sibling git repos.
# Returns: newline-separated absolute paths (max 10), current project excluded.
# PROJECT_DIR defaults to CWD if not provided.
# Uses $(cd ... && pwd) instead of realpath — POSIX-safe, works on macOS without Homebrew.
discover_siblings() {
  local project_dir="${1:-$(pwd)}"
  # Resolve to absolute path without relying on realpath (Open Question 2 — not guaranteed on macOS)
  project_dir="$(cd "$project_dir" && pwd)"
  local parent_dir
  parent_dir="$(dirname "$project_dir")"
  local count=0
  local max_siblings=10

  for dir in "$parent_dir"/*/; do
    [[ -d "$dir/.git" ]] || continue
    local abs_dir
    abs_dir="$(cd "$dir" && pwd)"
    # Exclude current project
    [[ "$abs_dir" == "$project_dir" ]] && continue
    echo "$abs_dir"
    # (( count++ )) || true — prevents set -e in caller from treating increment-from-0 as failure
    (( count++ )) || true
    [[ $count -ge $max_siblings ]] && break
  done
}
