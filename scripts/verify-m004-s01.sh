#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

node "$ROOT_DIR/scripts/check-skill-package-assets.mjs"
pnpm --dir "$ROOT_DIR" --filter @listenai/skill-logic-analyzer exec vitest run src/package-asset-contract.test.ts
pnpm --dir "$ROOT_DIR" --filter @listenai/skill-logic-analyzer typecheck
