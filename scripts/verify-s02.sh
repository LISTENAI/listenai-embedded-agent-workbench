#!/usr/bin/env bash
set -euo pipefail

npm test -- --run src/logic-analyzer/logic-analyzer-skill.test.ts
npm run typecheck
