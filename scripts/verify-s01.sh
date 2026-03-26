#!/usr/bin/env bash
set -euo pipefail

npm test -- --run src/resource-manager/resource-manager.test.ts
npm run typecheck
