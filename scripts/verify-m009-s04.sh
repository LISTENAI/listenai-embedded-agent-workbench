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
  "operator-stale-wording-guard" \
  "Operator-facing dashboard, tests, and docs stay free of stale DSView wording" \
  pnpm --dir "$ROOT_DIR" exec bash -lc '
    set -euo pipefail
    if rg -n "DSView|dsview" \
      packages/resource-manager/src/server/dashboard-page.ts \
      packages/resource-manager/src/server/dashboard-snapshot.test.ts \
      packages/resource-manager/src/server/app.test.ts \
      integration/resource-manager-dashboard.e2e.test.ts \
      packages/resource-manager/README.md \
      packages/resource-manager/README.zh-CN.md \
      packages/skill-logic-analyzer/README.md; then
      echo "Found stale DSView operator wording." >&2
      exit 1
    fi
  '

run_layer \
  "dashboard-server-truth" \
  "Focused dashboard snapshot and app tests keep libsigrok runtime truth aligned" \
  pnpm --dir "$ROOT_DIR" exec bash -lc '
    set -euo pipefail
    pnpm --filter @listenai/resource-manager exec vitest run src/server/dashboard-snapshot.test.ts src/server/app.test.ts
  '

run_layer \
  "dashboard-browser-truth" \
  "The shipped dashboard browser flow still renders healthy, degraded, and missing-runtime libsigrok states" \
  pnpm --dir "$ROOT_DIR" exec bash -lc '
    set -euo pipefail
    pnpm exec vitest run integration/resource-manager-dashboard.e2e.test.ts --exclude ".gsd/worktrees/**"
  '

run_layer \
  "operator-doc-truth" \
  "Operator docs still explain libsigrok readiness, degraded state, and missing-runtime guidance" \
  pnpm --dir "$ROOT_DIR" exec bash -lc '
    set -euo pipefail
    rg -n "libsigrok|missing runtime|degraded" \
      packages/resource-manager/README.md \
      packages/resource-manager/README.zh-CN.md \
      packages/skill-logic-analyzer/README.md
  '

echo

echo "M009 S04 verification passed: operator-facing dashboard, browser proof, and docs stay aligned to libsigrok runtime truth without stale DSView wording."
