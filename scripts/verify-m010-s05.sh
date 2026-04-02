#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
WORKTREE_ROOT=$(cd -- "$SCRIPT_DIR/.." && pwd)

cd "$WORKTREE_ROOT"

run_layer() {
  local label="$1"
  local timeout_seconds="$2"
  shift 2

  echo "[verify-m010-s05] ${label}"
  python3 - "$WORKTREE_ROOT" "$timeout_seconds" "$label" "$@" <<'PY'
import subprocess
import sys

worktree_root = sys.argv[1]
timeout_seconds = int(sys.argv[2])
label = sys.argv[3]
command = sys.argv[4:]

try:
    completed = subprocess.run(command, cwd=worktree_root, timeout=timeout_seconds, check=False)
except subprocess.TimeoutExpired:
    print(
        f"[verify-m010-s05] {label} timed out after {timeout_seconds}s",
        file=sys.stderr,
    )
    sys.exit(124)

sys.exit(completed.returncode)
PY
}

require_pattern() {
  local label="$1"
  local pattern="$2"
  shift 2

  if ! rg -n --fixed-strings "$pattern" "$@" >/dev/null; then
    echo "[verify-m010-s05] ${label}: missing '$pattern'" >&2
    exit 1
  fi
}

reject_pattern() {
  local label="$1"
  local pattern="$2"
  shift 2

  if rg -n --fixed-strings "$pattern" "$@"; then
    echo "[verify-m010-s05] ${label}: stale wording '$pattern' detected" >&2
    exit 1
  fi
}

DOC_FILES=(
  README.md
  packages/resource-manager/README.md
  packages/resource-manager/README.zh-CN.md
  packages/skill-logic-analyzer/README.md
  packages/skill-logic-analyzer/SKILL.md
)

PROJECT_FILES=(
  .gsd/PROJECT.md
  .gsd/KNOWLEDGE.md
)

echo "[verify-m010-s05] stale support-story and alias guard"
reject_pattern "command guard" "verify:m006" "${DOC_FILES[@]}"
reject_pattern "command guard" "verify:m009" "${DOC_FILES[@]}"
reject_pattern "script guard" "verify-m006" "${DOC_FILES[@]}"
reject_pattern "script guard" "verify-m009" "${DOC_FILES[@]}"
require_pattern "root alias" '"verify:m010:s05": "bash scripts/verify-m010-s05.sh"' package.json
require_pattern "support seam" "bash scripts/verify-m010-s05.sh" "${DOC_FILES[@]}" "${PROJECT_FILES[@]}"
require_pattern "support seam" "pnpm run verify:m010:s05" "${DOC_FILES[@]}" "${PROJECT_FILES[@]}"
require_pattern "macos support claim" "macOS" "${DOC_FILES[@]}" "${PROJECT_FILES[@]}"
require_pattern "macos support claim" "sigrok-cli" "${DOC_FILES[@]}" "${PROJECT_FILES[@]}"
require_pattern "macos support claim" "live-proven" "${DOC_FILES[@]}" "${PROJECT_FILES[@]}"
require_pattern "linux support claim" "Linux" "${DOC_FILES[@]}" "${PROJECT_FILES[@]}"
require_pattern "windows support claim" "Windows" "${DOC_FILES[@]}" "${PROJECT_FILES[@]}"
require_pattern "modeled support claim" "readiness-modeled" "${DOC_FILES[@]}" "${PROJECT_FILES[@]}"
require_pattern "diagnostic guard" "backend-missing-runtime" "${DOC_FILES[@]}" "${PROJECT_FILES[@]}"
require_pattern "diagnostic guard" "backend-runtime-timeout" "${DOC_FILES[@]}" "${PROJECT_FILES[@]}"
require_pattern "diagnostic guard" "backend-runtime-malformed-response" "${DOC_FILES[@]}" "${PROJECT_FILES[@]}"
require_pattern "diagnostic guard" "backend-unsupported-os" "${DOC_FILES[@]}" "${PROJECT_FILES[@]}"
require_pattern "diagnostic guard" "device-unsupported-variant" "${DOC_FILES[@]}" "${PROJECT_FILES[@]}"
require_pattern "diagnostic guard" "device-runtime-malformed-response" "${DOC_FILES[@]}" "${PROJECT_FILES[@]}"

run_layer "compose S04 proof" 240 bash scripts/verify-m010-s04.sh
run_layer "resource-manager native runtime proof" 120 pnpm --filter @listenai/resource-manager exec vitest run ./src/dslogic/native-runtime.test.ts
run_layer "resource-manager provider readiness proof" 120 pnpm --filter @listenai/resource-manager exec vitest run ./src/dslogic/dslogic-device-provider.test.ts
run_layer "packaged generic skill proof" 120 pnpm --filter @listenai/skill-logic-analyzer exec vitest run src/generic-skill.test.ts
run_layer "packaged logic-analyzer skill proof" 120 pnpm --filter @listenai/skill-logic-analyzer exec vitest run src/logic-analyzer-skill.test.ts

echo "[verify-m010-s05] support story acceptance seam passed"
