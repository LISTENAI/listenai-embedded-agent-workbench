#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

npm --prefix "$ROOT_DIR" test -- --run src/logic-analyzer/end-to-end.test.ts
bash "$ROOT_DIR/scripts/verify-s05.sh"
