#!/usr/bin/env bash
set -euo pipefail

pnpm --filter @listenai/resource-manager exec vitest run src/dslogic/backend-probe.test.ts src/dslogic/dslogic-device-provider.test.ts src/resource-manager.test.ts

if rg -n "DSView|dsview|executablePath" \
  packages/resource-manager/src/dslogic/backend-probe.ts \
  packages/resource-manager/src/dslogic/native-runtime.ts \
  packages/resource-manager/src/testing/fake-dslogic-probe.ts \
  packages/resource-manager/src/dslogic/dslogic-device-provider.ts \
  packages/resource-manager/src/dslogic/dslogic-device-provider.test.ts; then
  echo "Found stale executable-era inventory references." >&2
  exit 1
fi
