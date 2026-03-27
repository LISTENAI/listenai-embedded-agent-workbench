#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

pnpm --dir "$ROOT_DIR" run test:s06
bash "$ROOT_DIR/scripts/verify-s05.sh"
