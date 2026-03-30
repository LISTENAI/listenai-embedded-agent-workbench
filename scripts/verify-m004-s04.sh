#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

bash "$ROOT_DIR/scripts/verify-m004-s02.sh"
bash "$ROOT_DIR/scripts/verify-m004-s03.sh"
pnpm --dir "$ROOT_DIR" --filter @listenai/skill-logic-analyzer exec vitest run src/host-skill-install-cli.test.ts
