#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
WORKTREE_ROOT=$(cd -- "$SCRIPT_DIR/.." && pwd)

cd "$WORKTREE_ROOT"

run_layer() {
  local label="$1"
  local timeout_seconds="$2"
  shift 2

  echo "[verify-m005-s04] ${label}"
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
        f"[verify-m005-s04] {label} timed out after {timeout_seconds}s",
        file=sys.stderr,
    )
    sys.exit(124)

if completed.returncode != 0:
    print(
        f"[verify-m005-s04] {label} failed with exit {completed.returncode}",
        file=sys.stderr,
    )

sys.exit(completed.returncode)
PY
}

require_pattern() {
  local label="$1"
  local pattern="$2"
  shift 2

  if ! rg -n --fixed-strings "$pattern" "$@" >/dev/null; then
    echo "[verify-m005-s04] ${label}: missing '$pattern'" >&2
    exit 1
  fi
}

require_pattern \
  "root package alias" \
  '"verify:m005:s04": "bash scripts/verify-m005-s04.sh"' \
  package.json

echo "[verify-m005-s04] S04 documentation proof-gap guard"
python3 - <<'PY'
from pathlib import Path

DOC_PROOF_FILES = [
    Path("README.md"),
    Path("packages/skill-logic-analyzer/README.md"),
    Path("packages/skill-logic-analyzer/SKILL.md"),
    Path("docs/logic-analyzer-agent-skill.md"),
    Path("docs/logic-analyzer-agent-skill.zh-CN.md"),
]

REQUIRED_MARKERS = [
    "verify:m005:s04",
    "fixture/integration acceptance",
    "does not claim real DSLogic hardware capture/decode",
]

missing_by_file = {}
for path in DOC_PROOF_FILES:
    content = path.read_text()
    missing = [marker for marker in REQUIRED_MARKERS if marker not in content]
    if missing:
        missing_by_file[str(path)] = missing

if missing_by_file:
    details = "; ".join(
        f"{file}: {', '.join(markers)}" for file, markers in missing_by_file.items()
    )
    file_set = ", ".join(str(path) for path in DOC_PROOF_FILES)
    raise SystemExit(
        f"[verify-m005-s04] documentation proof-gap guard missing markers ({details}) in file set: {file_set}"
    )

print("[verify-m005-s04] documentation proof-gap guard passed")
PY

run_layer \
  "contracts build" \
  120 \
  pnpm --filter @listenai/eaw-contracts run build

run_layer \
  "resource-client build" \
  120 \
  pnpm --filter @listenai/eaw-resource-client run build

run_layer \
  "resource-manager build" \
  120 \
  pnpm --filter @listenai/eaw-resource-manager run build

run_layer \
  "M005 S03 parser, integration, and guidance proof" \
  300 \
  pnpm run verify:m005:s03

run_layer \
  "resource-manager service and server route proof" \
  180 \
  pnpm --filter @listenai/eaw-resource-manager exec vitest run \
    src/resource-manager.test.ts \
    src/server/app.test.ts

run_layer \
  "contracts typecheck" \
  120 \
  pnpm --filter @listenai/eaw-contracts run typecheck

run_layer \
  "resource-client typecheck" \
  120 \
  pnpm --filter @listenai/eaw-resource-client run typecheck

run_layer \
  "resource-manager typecheck" \
  120 \
  pnpm --filter @listenai/eaw-resource-manager run typecheck

echo "[verify-m005-s04] final M005 acceptance seam passed"
