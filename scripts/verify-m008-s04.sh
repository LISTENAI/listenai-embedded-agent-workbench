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
  "S01-canonical-contracts" \
  "Canonical identity and aggregated snapshot contracts stay aligned across type surfaces, server projection, and skill consumers" \
  pnpm --dir "$ROOT_DIR" exec bash -lc '
    set -euo pipefail
    pnpm -r run typecheck
    pnpm --filter @listenai/resource-manager exec vitest run src/server/dashboard-snapshot.test.ts src/server/app.test.ts
    pnpm --filter @listenai/skill-logic-analyzer exec vitest run src/session-constraints.test.ts src/logic-analyzer-skill.test.ts src/generic-skill.test.ts
  '

run_layer \
  "S02-manager-dashboard" \
  "Multi-provider manager truth stays aligned across server state, HTTP compatibility, dashboard browser flow, and client typing" \
  pnpm --dir "$ROOT_DIR" exec bash -lc '
    set -euo pipefail
    pnpm --filter @listenai/resource-manager exec vitest run src/resource-manager.test.ts src/server/app.test.ts src/server/lease-integration.test.ts
    pnpm exec vitest run integration/resource-manager-dashboard.e2e.test.ts
    pnpm --filter @listenai/resource-manager run typecheck
    pnpm --filter @listenai/resource-client run typecheck
  '

run_layer \
  "S03-live-capture-runtime" \
  "Provider-dispatched live capture, lease behavior, and the shipped skill HTTP flow still agree through the runtime boundary" \
  pnpm --dir "$ROOT_DIR" exec bash -lc '
    set -euo pipefail
    pnpm --filter @listenai/resource-manager exec vitest run ./src/dslogic/live-capture.test.ts src/resource-manager.test.ts src/dslogic/dslogic-device-provider.test.ts src/server/app.test.ts src/server/lease-integration.test.ts
    pnpm --filter @listenai/resource-manager run typecheck
    pnpm --filter @listenai/skill-logic-analyzer exec vitest run src/logic-analyzer-skill.test.ts
    pnpm exec vitest run integration/logic-analyzer-http.e2e.test.ts
  '

echo

echo "M008 S04 verification seam passed: canonical contracts, multi-provider dashboard truth, and provider-dispatched live capture all hold from the user-facing worktree path."
