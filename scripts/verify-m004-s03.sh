#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

bash "$ROOT_DIR/scripts/verify-m004-s01.sh"
pnpm --dir "$ROOT_DIR" --filter @listenai/skill-logic-analyzer exec vitest run src/codex-skill-installer.test.ts
pnpm --dir "$ROOT_DIR" --filter @listenai/skill-logic-analyzer typecheck
