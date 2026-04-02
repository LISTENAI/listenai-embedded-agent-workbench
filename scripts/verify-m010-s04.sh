#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
WORKTREE_ROOT=$(cd -- "$SCRIPT_DIR/.." && pwd)

cd "$WORKTREE_ROOT"

echo "[verify-m010-s04] compose S03 proof"
bash scripts/verify-m010-s03.sh

echo "[verify-m010-s04] packaged CLI and dashboard truth"
pnpm exec vitest run \
  integration/resource-manager-cli.e2e.test.ts \
  integration/resource-manager-dashboard.e2e.test.ts \
  --exclude ".gsd/worktrees/**"

echo "[verify-m010-s04] packaged HTTP and skill proof"
pnpm exec vitest run integration/logic-analyzer-http.e2e.test.ts --exclude ".gsd/worktrees/**"

echo "[verify-m010-s04] resource-manager typecheck"
pnpm --filter @listenai/resource-manager typecheck
