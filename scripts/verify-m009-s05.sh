#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

run_layer() {
  local layer_id="$1"
  local description="$2"
  shift 2

  echo
  echo "==> [${layer_id}] ${description}"

  if "$@"; then
    echo "<== [${layer_id}] pass"
  else
    local exit_code=$?
    echo "<== [${layer_id}] fail (exit ${exit_code})" >&2
    echo "Layer ${layer_id} failed: ${description}" >&2
    return "${exit_code}"
  fi
}

run_layer \
  "stale-dsview-guard" \
  "Assembled macOS-first proof stays on the libsigrok seam without DSView-era wording" \
  pnpm --dir "$ROOT_DIR" exec bash -lc '
    set -euo pipefail
    if rg -n "DSView|backendKind: \"dsview\"|backend-missing-executable" \
      integration/logic-analyzer-http.e2e.test.ts \
      integration/resource-manager.e2e.test.ts; then
      echo "Found stale DSView-era verification expectations." >&2
      exit 1
    fi
  '

run_layer \
  "resource-manager-live-truth" \
  "The shipped resource-manager seam exposes macOS libsigrok inventory truth and lease behavior" \
  pnpm --dir "$ROOT_DIR" exec vitest run integration/resource-manager.e2e.test.ts --exclude ".gsd/worktrees/**"

run_layer \
  "logic-analyzer-live-truth" \
  "The shipped HTTP skill seam preserves libsigrok-backed live capture, malformed responses, and cleanup diagnostics" \
  pnpm --dir "$ROOT_DIR" exec vitest run integration/logic-analyzer-http.e2e.test.ts --exclude ".gsd/worktrees/**"

echo

echo "M009 S05 verification passed: the shipped macOS-first libsigrok verification path proves inventory, capture, and cleanup truth without DSView dependencies."
