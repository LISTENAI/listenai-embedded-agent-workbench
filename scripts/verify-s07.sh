#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

pnpm --dir "$ROOT_DIR" run test:s07
pnpm --dir "$ROOT_DIR" run build
pnpm --dir "$ROOT_DIR" run verify:s06
