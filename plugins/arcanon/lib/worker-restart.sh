#!/usr/bin/env bash
# lib/worker-restart.sh — Shared worker-restart logic.
# Source this file; do not execute directly.
# Requires: worker-client.sh (for worker_start_background, worker_running, resolve_arcanon_data_dir) sourced first.
#
# Exposes:
#   should_restart_worker       — sets _should_restart, _restart_reason, _installed_version, _running_version
#   restart_worker_if_stale     — idempotent; sets _worker_restarted

[[ "${BASH_SOURCE[0]}" != "${0}" ]] || { echo "Source this file; do not execute directly." >&2; exit 1; }

_ARCANON_WORKER_RESTART_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ─────────────────────────────────────────────────────────────────────────────
# should_restart_worker
# Sets:
#   _should_restart       = true | false
#   _restart_reason       = no_pid_file | stale_pid | version_mismatch | ok
#   _installed_version    = (from PLUGIN_ROOT/package.json, may be empty)
#   _running_version      = (from http://127.0.0.1:PORT/api/version, may be empty)
#   _worker_pid           = (the running PID if any, else empty)
# Returns 0 always (errors are non-fatal).
# ─────────────────────────────────────────────────────────────────────────────
should_restart_worker() {
  _should_restart=false
  _restart_reason="ok"
  _installed_version=""
  _running_version=""
  _worker_pid=""

  local plugin_root="${CLAUDE_PLUGIN_ROOT:-${PLUGIN_ROOT:-$(cd "${_ARCANON_WORKER_RESTART_LIB_DIR}/.." && pwd)}}"
  local data_dir
  if command -v resolve_arcanon_data_dir >/dev/null 2>&1; then
    data_dir="$(resolve_arcanon_data_dir)"
  else
    # shellcheck source=./data-dir.sh
    source "${_ARCANON_WORKER_RESTART_LIB_DIR}/data-dir.sh"
    data_dir="$(resolve_arcanon_data_dir)"
  fi
  local pid_file="${data_dir}/worker.pid"
  local port_file="${data_dir}/worker.port"

  if [[ ! -f "$pid_file" ]]; then
    _should_restart=true
    _restart_reason="no_pid_file"
    return 0
  fi

  _worker_pid=$(cat "$pid_file" 2>/dev/null || true)
  if [[ -z "$_worker_pid" ]] || ! kill -0 "$_worker_pid" 2>/dev/null; then
    _should_restart=true
    _restart_reason="stale_pid"
    return 0
  fi

  # Worker is running — compare versions
  if [[ -f "${plugin_root}/package.json" ]] && command -v jq >/dev/null 2>&1; then
    _installed_version=$(jq -r '.version // empty' "${plugin_root}/package.json" 2>/dev/null || true)
  fi
  if [[ -f "$port_file" ]]; then
    local _port; _port=$(cat "$port_file" 2>/dev/null || true)
    if [[ -n "$_port" ]]; then
      _running_version=$(curl -s --max-time 1 "http://127.0.0.1:${_port}/api/version" 2>/dev/null \
        | jq -r '.version // empty' 2>/dev/null || true)
    fi
  fi

  if [[ -n "$_installed_version" && -n "$_running_version" \
        && "$_running_version" != "unknown" \
        && "$_installed_version" != "$_running_version" ]]; then
    _should_restart=true
    _restart_reason="version_mismatch"
  fi

  return 0
}

# ─────────────────────────────────────────────────────────────────────────────
# restart_worker_if_stale
# Idempotent. On _should_restart=true, stops the running worker (graceful
# → forceful) and calls worker_start_background. Sets _worker_restarted.
# Returns 0 always.
# ─────────────────────────────────────────────────────────────────────────────
restart_worker_if_stale() {
  _worker_restarted=false

  should_restart_worker

  if [[ "$_should_restart" != "true" ]]; then
    return 0
  fi

  local data_dir
  if command -v resolve_arcanon_data_dir >/dev/null 2>&1; then
    data_dir="$(resolve_arcanon_data_dir)"
  else
    # shellcheck source=./data-dir.sh
    source "${_ARCANON_WORKER_RESTART_LIB_DIR}/data-dir.sh"
    data_dir="$(resolve_arcanon_data_dir)"
  fi
  local pid_file="${data_dir}/worker.pid"
  local port_file="${data_dir}/worker.port"

  case "$_restart_reason" in
    version_mismatch)
      echo "version mismatch (installed=${_installed_version}, running=${_running_version}) — restarting" >&2
      kill "$_worker_pid" 2>/dev/null || true
      sleep 1
      kill -0 "$_worker_pid" 2>/dev/null && kill -9 "$_worker_pid" 2>/dev/null || true
      rm -f "$pid_file" "$port_file"
      ;;
    stale_pid)
      echo "removing stale PID file (PID ${_worker_pid} no longer exists)" >&2
      rm -f "$pid_file"
      ;;
    no_pid_file)
      : # nothing to clean up
      ;;
  esac

  if command -v worker_start_background >/dev/null 2>&1; then
    worker_start_background 2>/dev/null || true
  fi

  _worker_restarted=true
  return 0
}
