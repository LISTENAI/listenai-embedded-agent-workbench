#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
WORKTREE_ROOT=$(cd -- "$SCRIPT_DIR/.." && pwd)

cd "$WORKTREE_ROOT"

echo "[verify-m009-s03] stale capture-language guard"
if rg -n '\b(executablePath|command|stdout|stderr|exitCode|signal|await-runner)\b' \
  packages/resource-manager/src/dslogic/live-capture.ts \
  packages/resource-manager/src/dslogic/native-runtime.ts; then
  echo "[verify-m009-s03] stale live-capture runner language detected"
  exit 1
fi

echo "[verify-m009-s03] focused DSLogic native seam"
pnpm --filter @listenai/resource-manager exec vitest run ./src/dslogic/live-capture.test.ts

echo "[verify-m009-s03] assembled resource-manager and HTTP proof"
pnpm exec vitest run integration/resource-manager.e2e.test.ts integration/logic-analyzer-http.e2e.test.ts --exclude ".gsd/worktrees/**"

echo "[verify-m009-s03] packaged skill proof"
pnpm --filter @listenai/skill-logic-analyzer exec vitest run src/logic-analyzer-skill.test.ts src/generic-skill.test.ts
