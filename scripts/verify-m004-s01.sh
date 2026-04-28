#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

reject_file() {
  local path="$1"
  if [[ -e "$path" ]]; then
    echo "[m004-s01] Unexpected committed registry config candidate: $path" >&2
    return 1
  fi
}

require_pattern() {
  local pattern="$1"
  local file="$2"
  if ! rg -q -- "$pattern" "$file"; then
    echo "[m004-s01] Missing pattern '$pattern' in $file" >&2
    return 1
  fi
}

reject_pattern() {
  local pattern="$1"
  local file="$2"
  if rg -q -- "$pattern" "$file"; then
    echo "[m004-s01] Unexpected pattern '$pattern' in $file" >&2
    rg -n -- "$pattern" "$file" >&2
    return 1
  fi
}

SCRIPT="scripts/publish-private-registry.sh"

reject_file .npmrc
reject_file .yarnrc.yml
require_pattern "https://registry-lpm\.listenai\.com" "$SCRIPT"
require_pattern "CONFIRM_PUBLISH=publish" "$SCRIPT"
require_pattern "LISTENAI_NPM_AUTH_MODE" "$SCRIPT"
require_pattern "must be password or token" "$SCRIPT"
require_pattern "LPM_PASSWORD_BASE64" "$SCRIPT"
require_pattern "LPM_USERNAME" "$SCRIPT"
require_pattern "LPM_EMAIL" "$SCRIPT"
require_pattern "LPM_ADMIN_TOKEN" "$SCRIPT"
require_pattern "_password" "$SCRIPT"
require_pattern "_authToken" "$SCRIPT"
require_pattern "always-auth" "$SCRIPT"
reject_pattern "LPM_ZHUOBIN_TOKEN|LPM_NPM_USERNAME|LPM_NPM_EMAIL|NPM_TOKEN" "$SCRIPT"
reject_pattern "zbzhao|zbzhao@listenai\.com" "$SCRIPT"
require_pattern "Checking registry for existing" "$SCRIPT"
require_pattern "npm view" "$SCRIPT"
require_pattern "already exists" "$SCRIPT"
require_pattern "Could not confirm" "$SCRIPT"
require_pattern "--dry-run" "$SCRIPT"
require_pattern "--userconfig" "$SCRIPT"
require_pattern "@listenai/eaw-contracts:share/contracts" "$SCRIPT"
require_pattern "@listenai/eaw-resource-client:share/resource-client" "$SCRIPT"
require_pattern "@listenai/eaw-resource-manager:packages/resource-manager" "$SCRIPT"
require_pattern "@listenai/eaw-skill-logic-analyzer:packages/skill-logic-analyzer" "$SCRIPT"

if LISTENAI_PUBLISH_SKIP_READINESS=1 bash "$SCRIPT" --publish >/tmp/m004-publish-no-confirm.out 2>&1; then
  echo "[m004-s01] --publish without confirmation unexpectedly succeeded" >&2
  exit 1
fi
if ! rg -q "CONFIRM_PUBLISH=publish" /tmp/m004-publish-no-confirm.out; then
  echo "[m004-s01] --publish without confirmation did not explain the confirmation guard" >&2
  cat /tmp/m004-publish-no-confirm.out >&2
  exit 1
fi
rm -f /tmp/m004-publish-no-confirm.out

if CONFIRM_PUBLISH=publish LISTENAI_PUBLISH_SKIP_READINESS=1 bash "$SCRIPT" --publish >/tmp/m004-publish-no-password.out 2>&1; then
  echo "[m004-s01] password-mode --publish without credentials unexpectedly succeeded" >&2
  exit 1
fi
if ! rg -q "password auth requires LPM_PASSWORD_BASE64, LPM_USERNAME, and LPM_EMAIL" /tmp/m004-publish-no-password.out; then
  echo "[m004-s01] password-mode --publish without credentials did not explain the credential guard" >&2
  cat /tmp/m004-publish-no-password.out >&2
  exit 1
fi
rm -f /tmp/m004-publish-no-password.out

if CONFIRM_PUBLISH=publish LISTENAI_NPM_AUTH_MODE=token LISTENAI_PUBLISH_SKIP_READINESS=1 bash "$SCRIPT" --publish >/tmp/m004-publish-no-token.out 2>&1; then
  echo "[m004-s01] token-mode --publish without token unexpectedly succeeded" >&2
  exit 1
fi
if ! rg -q "token auth requires LPM_ADMIN_TOKEN" /tmp/m004-publish-no-token.out; then
  echo "[m004-s01] token-mode --publish without token did not explain the token guard" >&2
  cat /tmp/m004-publish-no-token.out >&2
  exit 1
fi
rm -f /tmp/m004-publish-no-token.out

if CONFIRM_PUBLISH=publish LISTENAI_NPM_AUTH_MODE=bad LISTENAI_PUBLISH_SKIP_READINESS=1 bash "$SCRIPT" --publish >/tmp/m004-publish-bad-auth-mode.out 2>&1; then
  echo "[m004-s01] --publish with invalid auth mode unexpectedly succeeded" >&2
  exit 1
fi
if ! rg -q "LISTENAI_NPM_AUTH_MODE must be password or token" /tmp/m004-publish-bad-auth-mode.out; then
  echo "[m004-s01] invalid auth mode did not explain allowed modes" >&2
  cat /tmp/m004-publish-bad-auth-mode.out >&2
  exit 1
fi
rm -f /tmp/m004-publish-bad-auth-mode.out

LISTENAI_PUBLISH_SKIP_READINESS=1 bash "$SCRIPT" --dry-run >/tmp/m004-publish-dry-run.out
if ! rg -q "Completed dry-run for 4 package" /tmp/m004-publish-dry-run.out; then
  echo "[m004-s01] dry-run did not complete all four packages" >&2
  cat /tmp/m004-publish-dry-run.out >&2
  exit 1
fi
if ! rg -q "Dry-run publishing @listenai/eaw-contracts" /tmp/m004-publish-dry-run.out; then
  echo "[m004-s01] dry-run did not publish packages in expected observable form" >&2
  cat /tmp/m004-publish-dry-run.out >&2
  exit 1
fi
rm -f /tmp/m004-publish-dry-run.out

echo "[m004-s01] Publish script guardrail verification passed"
