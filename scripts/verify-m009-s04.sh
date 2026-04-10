#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

echo "[verify-m009-s04] legacy alias -> verify-m010-s04"
exec bash "$ROOT_DIR/scripts/verify-m010-s04.sh"
