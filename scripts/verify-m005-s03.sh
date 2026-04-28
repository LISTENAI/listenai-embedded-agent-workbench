#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
WORKTREE_ROOT=$(cd -- "$SCRIPT_DIR/.." && pwd)

cd "$WORKTREE_ROOT"

run_layer() {
  local label="$1"
  shift

  echo "[verify-m005-s03] ${label}"
  "$@"
}

run_layer \
  "resource-client capture/decode HTTP parser guards" \
  pnpm --filter @listenai/eaw-resource-client exec vitest run src/http-resource-manager.test.ts

run_layer \
  "connected UART capture-decode integration proof" \
  pnpm exec vitest run integration/logic-analyzer-http.e2e.test.ts

run_layer \
  "installed skill package asset contract and installer guards" \
  pnpm --filter @listenai/eaw-skill-logic-analyzer exec vitest run \
    src/package-asset-contract.test.ts \
    src/codex-skill-installer.test.ts \
    src/shared-skill-installer.test.ts \
    src/host-skill-install-cli.test.ts

run_layer \
  "skill package typecheck" \
  pnpm --filter @listenai/eaw-skill-logic-analyzer run typecheck

run_layer "installed/public guidance grep guard" python3 - <<'PY'
from pathlib import Path
import re

assets = [
    Path("packages/skill-logic-analyzer/README.md"),
    Path("packages/skill-logic-analyzer/SKILL.md"),
]
required_markers = [
    "HttpResourceManager",
    "listDecoderCapabilities",
    "captureDecode",
    "/capture/decode",
    "1:uart",
]
forbidden_patterns = [
    re.compile(r"\b(?:run|invoke|execute|call|use|shell out to)\s+`?dsview-cli\s+capture\b", re.I),
    re.compile(r"\bdsview-cli\s+capture\b[^.\n]*(?:live|connected|UART|protocol-log|protocol log)", re.I),
    re.compile(r"(?:live|connected|UART|protocol-log|protocol log)[^.\n]*\bdsview-cli\s+capture\b", re.I),
]
negated_pattern = re.compile(
    r"(?:do not|don't|never|not|instead of|rather than)[^.\n]*\bdsview-cli\s+capture\b|"
    r"\bdsview-cli\s+capture\b[^.\n]*(?:instead of|rather than)",
    re.I,
)
combined = "\n".join(path.read_text() for path in assets)
missing = [marker for marker in required_markers if marker not in combined]
if missing:
    raise SystemExit(f"missing required connected capture-decode markers: {', '.join(missing)}")

for path in assets:
    for sentence in re.split(r"(?<=[.!?])\s+|\n+", path.read_text()):
        if not sentence.strip() or negated_pattern.search(sentence):
            continue
        for pattern in forbidden_patterns:
            match = pattern.search(sentence)
            if match:
                raise SystemExit(
                    f"{path}: forbidden direct live dsview-cli capture guidance: {match.group(0)}"
                )

print("[verify-m005-s03] guidance markers and direct-live-capture guards passed")
PY

echo "[verify-m005-s03] Codex-safe capture-decode guidance acceptance seam passed"
