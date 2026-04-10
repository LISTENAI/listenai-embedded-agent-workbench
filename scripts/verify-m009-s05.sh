#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

echo "[verify-m009-s05] legacy alias -> verify-m010-s05"
exec bash "$ROOT_DIR/scripts/verify-m010-s05.sh"
