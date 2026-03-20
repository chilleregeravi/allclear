---
phase: 39-identity
plan: 01
subsystem: identity
tags: [rename, npm, plugin-manifest, config]
dependency_graph:
  requires: []
  provides: [ligamen-npm-identity, ligamen-plugin-manifest, ligamen-config-defaults]
  affects: [package.json, .claude-plugin/plugin.json, .claude-plugin/marketplace.json, Makefile, lib/config.sh, ligamen.config.json.example]
tech_stack:
  added: []
  patterns: [exact-string-replacement, git-mv-via-delete-create]
key_files:
  created:
    - ligamen.config.json.example
  modified:
    - package.json
    - .claude-plugin/plugin.json
    - .claude-plugin/marketplace.json
    - Makefile
    - lib/config.sh
  deleted:
    - allclear.config.json.example
decisions:
  - "Renamed all six identity artifacts in a single atomic commit per plan instructions"
  - "Used git rm for allclear.config.json.example to capture rename in git history"
  - "Removed stale plugins/allclear symlink as specified in Task 1 of 39-02"
metrics:
  duration: "< 5 minutes"
  completed: "2026-03-19"
  tasks_completed: 4
  files_changed: 7
---

# Phase 39 Plan 01+02: Identity Rename (allclear → ligamen) Summary

Renamed the plugin identity from "allclear" to "ligamen" across all six primary identity artifacts: npm package manifest, Claude Code plugin manifests, build automation, and config defaults.

## Changes Made

### 39-01: npm Package and Plugin Manifests

**package.json**
- `"name": "@allclear/cli"` → `"name": "@ligamen/cli"`
- `"description": "AllClear — ..."` → `"description": "Ligamen — ..."`
- `"url": "https://github.com/AetherHQ/allclear"` → `"url": "https://github.com/AetherHQ/ligamen"`
- `"allclear-init": "./bin/allclear-init.js"` → `"ligamen-init": "./bin/ligamen-init.js"`

**.claude-plugin/plugin.json**
- `"name": "allclear"` → `"name": "ligamen"`
- `"AllClear Contributors"` → `"Ligamen Contributors"`
- Repository URL updated to AetherHQ/ligamen

**.claude-plugin/marketplace.json**
- Top-level `"name": "allclear"` → `"name": "ligamen"`
- Plugin entry `"name": "allclear"` → `"name": "ligamen"`
- `"source": "./plugins/allclear"` → `"source": "./plugins/ligamen"`

### 39-02: Makefile and Config

**Makefile**
- `PLUGIN_NAME := allclear` → `PLUGIN_NAME := ligamen`
- All install/uninstall targets automatically cascade via the variable

**allclear.config.json.example → ligamen.config.json.example**
- File renamed; content unchanged: `{ "linked-repos": ["../api", "../ui", "../sdk"] }`

**lib/config.sh**
- Guard variable: `_ALLCLEAR_CONFIG_LOADED` → `_LIGAMEN_CONFIG_LOADED`
- Config file env var: `ALLCLEAR_CONFIG_FILE` → `LIGAMEN_CONFIG_FILE`
- Default filename: `allclear.config.json` → `ligamen.config.json`
- Linked repos array: `ALLCLEAR_CONFIG_LINKED_REPOS` → `LIGAMEN_CONFIG_LINKED_REPOS`
- Warning message and comments updated throughout

## Verification

All checks passed:
- `package.json`: name=@ligamen/cli, bin key=ligamen-init, repo=AetherHQ/ligamen, description says Ligamen, zero allclear strings
- `plugin.json`: name=ligamen, author=Ligamen Contributors, repo=AetherHQ/ligamen, zero allclear strings
- `marketplace.json`: top name=ligamen, plugin entry name=ligamen, source=./plugins/ligamen, zero allclear strings
- `Makefile`: PLUGIN_NAME := ligamen, zero allclear strings
- `ligamen.config.json.example`: exists with correct content
- `allclear.config.json.example`: deleted
- `lib/config.sh`: sources cleanly, LIGAMEN_CONFIG_FILE defaults to ligamen.config.json, zero allclear strings

## Deviations from Plan

None — plans executed exactly as written.

## Commit

7e58c18: feat(39): rename plugin identity to ligamen

## Self-Check: PASSED

- ligamen.config.json.example: FOUND
- allclear.config.json.example: REMOVED (confirmed)
- package.json contains @ligamen/cli: CONFIRMED
- plugin.json contains ligamen: CONFIRMED
- marketplace.json source ./plugins/ligamen: CONFIRMED
- Makefile PLUGIN_NAME := ligamen: CONFIRMED
- lib/config.sh LIGAMEN_CONFIG_FILE: CONFIRMED
- Commit 7e58c18: FOUND
