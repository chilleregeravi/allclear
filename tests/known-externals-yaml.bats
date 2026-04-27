#!/usr/bin/env bats
# tests/known-externals-yaml.bats — INT-05
# Schema-and-shape validation for plugins/arcanon/data/known-externals.yaml.
# Phase 120 ships ONLY the data file; Phase 121 owns the consumer/loader.

load 'test_helper/bats-support/load'
load 'test_helper/bats-assert/load'

PLUGIN_ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/../plugins/arcanon" && pwd)"
CATALOG="${PLUGIN_ROOT}/data/known-externals.yaml"
VALID_CATEGORIES="api webhook observability storage auth infra"

setup() {
  command -v yq >/dev/null 2>&1 || skip "yq not installed — required for catalog tests"
}

@test "INT-05: known-externals.yaml file exists at the documented path" {
  [ -f "$CATALOG" ]
}

@test "INT-05: known-externals.yaml is valid YAML and has an externals top-level key" {
  run yq '.externals' "$CATALOG"
  [ "$status" -eq 0 ]
  [[ "$output" != "null" ]]
}

@test "INT-05: known-externals.yaml has at least 20 entries" {
  run yq '.externals | length' "$CATALOG"
  [ "$status" -eq 0 ]
  [ "$output" -ge 20 ]
}

@test "INT-05: every entry has name + label + category" {
  count=$(yq '.externals | length' "$CATALOG")
  for i in $(seq 0 $((count - 1))); do
    name=$(yq ".externals[$i].name" "$CATALOG")
    label=$(yq ".externals[$i].label" "$CATALOG")
    category=$(yq ".externals[$i].category" "$CATALOG")
    [[ "$name" != "null" && -n "$name" ]] || { echo "entry $i missing name"; return 1; }
    [[ "$label" != "null" && -n "$label" ]] || { echo "entry $i missing label"; return 1; }
    [[ "$category" != "null" && -n "$category" ]] || { echo "entry $i missing category"; return 1; }
  done
}

@test "INT-05: every entry's category is in the documented enum" {
  count=$(yq '.externals | length' "$CATALOG")
  for i in $(seq 0 $((count - 1))); do
    category=$(yq ".externals[$i].category" "$CATALOG")
    if ! [[ " $VALID_CATEGORIES " =~ " $category " ]]; then
      echo "entry $i has invalid category: $category (must be one of: $VALID_CATEGORIES)"
      return 1
    fi
  done
}

@test "INT-05: every entry has at least one match signal (hosts or ports)" {
  count=$(yq '.externals | length' "$CATALOG")
  for i in $(seq 0 $((count - 1))); do
    hosts_len=$(yq ".externals[$i].hosts | length // 0" "$CATALOG")
    ports_len=$(yq ".externals[$i].ports | length // 0" "$CATALOG")
    if [[ "$hosts_len" -eq 0 && "$ports_len" -eq 0 ]]; then
      name=$(yq ".externals[$i].name" "$CATALOG")
      echo "entry $i ($name) has no hosts and no ports — at least one is required"
      return 1
    fi
  done
}

@test "INT-05: all names are kebab-case" {
  count=$(yq '.externals | length' "$CATALOG")
  for i in $(seq 0 $((count - 1))); do
    name=$(yq ".externals[$i].name" "$CATALOG")
    if ! [[ "$name" =~ ^[a-z][a-z0-9-]*$ ]]; then
      echo "entry $i name '$name' is not kebab-case (lowercase, alphanumeric + hyphens only)"
      return 1
    fi
  done
}

@test "INT-05: all names are unique" {
  dupes=$(yq '.externals[].name' "$CATALOG" | sort | uniq -d)
  [ -z "$dupes" ] || { echo "duplicate names: $dupes"; return 1; }
}

@test "INT-05: file has the documented header comment block" {
  run grep -F '# known-externals.yaml — catalog' "$CATALOG"
  [ "$status" -eq 0 ]
  run grep -F '# Schema (Phase 120 — INT-05;' "$CATALOG"
  [ "$status" -eq 0 ]
}
