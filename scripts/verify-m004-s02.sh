#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

WORKFLOW=".github/workflows/publish.yml"

require_pattern() {
  local pattern="$1"
  local file="$2"
  if ! rg -q -- "$pattern" "$file"; then
    echo "[m004-s02] Missing pattern '$pattern' in $file" >&2
    return 1
  fi
}

reject_pattern() {
  local pattern="$1"
  local file="$2"
  if rg -q -- "$pattern" "$file"; then
    echo "[m004-s02] Unexpected pattern '$pattern' in $file" >&2
    rg -n -- "$pattern" "$file" >&2
    return 1
  fi
}

if [[ -e .npmrc || -e .yarnrc.yml ]]; then
  echo "[m004-s02] Registry auth config must not be committed" >&2
  exit 1
fi

require_pattern '^on:$' "$WORKFLOW"
require_pattern '^  workflow_dispatch:$' "$WORKFLOW"
reject_pattern '^  push:' "$WORKFLOW"
reject_pattern '^  pull_request:' "$WORKFLOW"
require_pattern '^      dry_run:$' "$WORKFLOW"
require_pattern 'type: boolean' "$WORKFLOW"
require_pattern 'default: true' "$WORKFLOW"
require_pattern '^      confirm_publish:$' "$WORKFLOW"
require_pattern '^      auth_mode:$' "$WORKFLOW"
require_pattern 'type: choice' "$WORKFLOW"
require_pattern 'default: password' "$WORKFLOW"
require_pattern 'password' "$WORKFLOW"
require_pattern 'token' "$WORKFLOW"
require_pattern 'contents: read' "$WORKFLOW"
require_pattern 'concurrency:' "$WORKFLOW"
require_pattern 'listenai-private-npm-publish' "$WORKFLOW"
require_pattern 'https://registry-lpm\.listenai\.com' "$WORKFLOW"
require_pattern 'LPM_PASSWORD_BASE64: \$\{\{ secrets\.LPM_PASSWORD_BASE64 \}\}' "$WORKFLOW"
require_pattern 'LPM_USERNAME: \$\{\{ secrets\.LPM_USERNAME \}\}' "$WORKFLOW"
require_pattern 'LPM_EMAIL: \$\{\{ secrets\.LPM_EMAIL \}\}' "$WORKFLOW"
require_pattern 'LPM_ADMIN_TOKEN: \$\{\{ secrets\.LPM_ADMIN_TOKEN \}\}' "$WORKFLOW"
require_pattern 'LISTENAI_NPM_AUTH_MODE: \$\{\{ inputs\.auth_mode \}\}' "$WORKFLOW"
reject_pattern 'LPM_ZHUOBIN_TOKEN|LPM_NPM_USERNAME|LPM_NPM_EMAIL|NPM_TOKEN' "$WORKFLOW"
require_pattern 'CONFIRM_PUBLISH: \$\{\{ inputs\.confirm_publish \}\}' "$WORKFLOW"
require_pattern 'inputs\.dry_run' "$WORKFLOW"
require_pattern 'scripts/publish-private-registry\.sh --dry-run' "$WORKFLOW"
require_pattern 'scripts/publish-private-registry\.sh --publish' "$WORKFLOW"
require_pattern 'scripts/verify-m003-s01\.sh' "$WORKFLOW"
require_pattern 'scripts/verify-m003-s02\.sh' "$WORKFLOW"
require_pattern 'scripts/verify-m003-s03\.sh' "$WORKFLOW"
require_pattern 'scripts/verify-m004-s01\.sh' "$WORKFLOW"

bash scripts/verify-m004-s01.sh

echo "[m004-s02] Publish workflow guardrail verification passed"
