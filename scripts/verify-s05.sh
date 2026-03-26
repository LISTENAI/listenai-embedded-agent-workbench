#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

npm --prefix "$ROOT_DIR" test -- --run src/logic-analyzer/generic-skill.test.ts
npm --prefix "$ROOT_DIR" test -- --run src/logic-analyzer/logic-analyzer-skill.test.ts
npm --prefix "$ROOT_DIR" test -- --run src/logic-analyzer/capture-loader.test.ts
npm --prefix "$ROOT_DIR" test -- --run src/logic-analyzer/waveform-analyzer.test.ts
npm --prefix "$ROOT_DIR" run typecheck
