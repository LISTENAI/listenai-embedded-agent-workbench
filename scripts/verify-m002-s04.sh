#!/usr/bin/env bash
set -euo pipefail

echo "[verify-m002-s04] contracts typecheck"
pnpm --filter @listenai/contracts typecheck

echo "[verify-m002-s04] resource-manager DSLogic/resource/server tests"
pnpm --filter @listenai/resource-manager exec vitest run \
  src/resource-manager.test.ts \
  src/server/app.test.ts \
  src/dslogic/native-runtime.test.ts \
  src/dslogic/live-capture.test.ts

echo "[verify-m002-s04] resource-client HTTP parser tests"
pnpm --filter @listenai/resource-client exec vitest run src/http-resource-manager.test.ts

echo "[verify-m002-s04] skill logic analyzer tests"
pnpm --filter @listenai/skill-logic-analyzer exec vitest run \
  src/session-constraints.test.ts \
  src/logic-analyzer-skill.test.ts \
  src/generic-skill.test.ts

echo "[verify-m002-s04] HTTP integration tests"
pnpm exec vitest run integration/logic-analyzer-http.e2e.test.ts
