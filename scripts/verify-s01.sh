#!/usr/bin/env bash
set -euo pipefail

pnpm run typecheck
pnpm run test
pnpm run build
