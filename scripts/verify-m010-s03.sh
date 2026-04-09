#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
WORKTREE_ROOT=$(cd -- "$SCRIPT_DIR/.." && pwd)

cd "$WORKTREE_ROOT"

echo "[verify-m010-s03] stale DSLogic live-capture language guard"
if rg -n '\bawait-runner\b' \
  packages/resource-manager/src/dslogic/live-capture.ts \
  packages/resource-manager/src/dslogic/native-runtime.ts; then
  echo "[verify-m010-s03] stale live-capture runner language detected"
  exit 1
fi

echo "[verify-m010-s03] focused DSLogic runtime and provider seam"
pnpm --filter @listenai/resource-manager exec vitest run \
  ./src/dslogic/native-runtime.test.ts \
  ./src/dslogic/dslogic-device-provider.test.ts \
  ./src/dslogic/live-capture.test.ts

echo "[verify-m010-s03] default provider and HTTP composition"
pnpm --filter @listenai/resource-manager exec vitest run \
  ./src/resource-manager.test.ts \
  ./src/server/app.test.ts

echo "[verify-m010-s03] assembled resource-manager HTTP proof"
pnpm exec vitest run integration/resource-manager.e2e.test.ts --exclude ".gsd/worktrees/**"

echo "[verify-m010-s03] downstream HTTP and packaged skill proof"
pnpm exec vitest run integration/logic-analyzer-http.e2e.test.ts --exclude ".gsd/worktrees/**"
pnpm --filter @listenai/skill-logic-analyzer exec vitest run \
  src/logic-analyzer-skill.test.ts \
  src/generic-skill.test.ts

echo "[verify-m010-s03] resource-manager typecheck"
pnpm --filter @listenai/resource-manager typecheck
