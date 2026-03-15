#!/usr/bin/env bash
# Mock format hook — tests CONF-02 disable pattern
if [[ -n "${ALLCLEAR_DISABLE_FORMAT:-}" ]]; then
  exit 0
fi
echo "format-ran"
