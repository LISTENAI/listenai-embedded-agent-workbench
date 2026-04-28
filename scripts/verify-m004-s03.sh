#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

DOC="docs/private-registry-publish.md"
INDEX="docs/README.md"
PUBLISH_SCRIPT="scripts/publish-private-registry.sh"
WORKFLOW=".github/workflows/publish.yml"

require_pattern() {
  local pattern="$1"
  local file="$2"
  if ! rg -q -- "$pattern" "$file"; then
    echo "[m004-s03] Missing pattern '$pattern' in $file" >&2
    return 1
  fi
}

reject_file() {
  local path="$1"
  if [[ -e "$path" ]]; then
    echo "[m004-s03] Unexpected committed registry config candidate: $path" >&2
    return 1
  fi
}

reject_file .npmrc
reject_file .yarnrc.yml

require_pattern "Private Registry Publish Automation" "$DOC"
require_pattern "https://registry-lpm\.listenai\.com" "$DOC"
require_pattern "scripts/publish-private-registry\.sh --dry-run" "$DOC"
require_pattern "CONFIRM_PUBLISH=publish" "$DOC"
require_pattern "LPM_ZHUOBIN_TOKEN" "$DOC"
require_pattern "LPM_NPM_USERNAME" "$DOC"
require_pattern "LPM_NPM_EMAIL" "$DOC"
require_pattern "package@version" "$DOC"
require_pattern "absent from the target registry" "$DOC"
require_pattern "NPM_TOKEN" "$DOC"
require_pattern "workflow_dispatch|Publish Private Packages|dry_run|confirm_publish" "$DOC"
require_pattern "verify-m004-s01\.sh" "$DOC"
require_pattern "verify-m004-s02\.sh" "$DOC"
require_pattern "verify-m004-s03\.sh" "$DOC"
require_pattern "does not add automatic version bumping|automatic version bumping" "$DOC"
require_pattern "Private registry publish automation" "$INDEX"

require_pattern "https://registry-lpm\.listenai\.com" "$PUBLISH_SCRIPT"
require_pattern "CONFIRM_PUBLISH=publish" "$PUBLISH_SCRIPT"
require_pattern "LPM_ZHUOBIN_TOKEN" "$PUBLISH_SCRIPT"
require_pattern "_password" "$PUBLISH_SCRIPT"
require_pattern "Checking registry for existing" "$PUBLISH_SCRIPT"
require_pattern "npm view" "$PUBLISH_SCRIPT"
require_pattern "NPM_TOKEN" "$PUBLISH_SCRIPT"
require_pattern "scripts/publish-private-registry\.sh --dry-run" "$WORKFLOW"
require_pattern "scripts/publish-private-registry\.sh --publish" "$WORKFLOW"
require_pattern "LPM_ZHUOBIN_TOKEN" "$WORKFLOW"
require_pattern "confirm_publish" "$WORKFLOW"
require_pattern "dry_run" "$WORKFLOW"

bash scripts/verify-m004-s01.sh
bash scripts/verify-m004-s02.sh

echo "[m004-s03] Release docs alignment verification passed"
