#!/usr/bin/env bash
set -euo pipefail

REGISTRY_URL="${LISTENAI_NPM_REGISTRY_URL:-https://registry-lpm.listenai.com}"
MODE="${LISTENAI_PUBLISH_MODE:-dry-run}"
AUTH_MODE="${LISTENAI_NPM_AUTH_MODE:-password}"
RUN_READINESS="${LISTENAI_PUBLISH_SKIP_READINESS:-0}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
NPM_USERCONFIG="$TMP_DIR/npmrc"
trap 'rm -rf "$TMP_DIR"' EXIT

PACKAGES=(
  "@listenai/eaw-contracts:share/contracts"
  "@listenai/eaw-resource-client:share/resource-client"
  "@listenai/eaw-resource-manager:packages/resource-manager"
  "@listenai/eaw-skill-logic-analyzer:packages/skill-logic-analyzer"
)

usage() {
  cat <<'EOF'
Usage: scripts/publish-private-registry.sh [--dry-run|--publish]

Safely publishes ListenAI packages to the private npm registry.
Defaults to --dry-run and never writes registry credentials into the repo.

Environment:
  LISTENAI_NPM_REGISTRY_URL   Registry URL. Defaults to https://registry-lpm.listenai.com
  LPM_PASSWORD_BASE64         Private registry _password value for --publish.
  LPM_USERNAME                Private registry username for --publish.
  LPM_EMAIL                   Private registry email for --publish.
  LPM_ADMIN_TOKEN             Private registry auth token for token-mode --publish.
  LISTENAI_NPM_AUTH_MODE      Registry auth mode: password or token. Defaults to password.
  CONFIRM_PUBLISH             Must be exactly "publish" for --publish.
  LISTENAI_PUBLISH_SKIP_READINESS=1  Skip scripts/verify-m003-s04.sh for focused tests only.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      MODE="dry-run"
      shift
      ;;
    --publish)
      MODE="publish"
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "[publish] Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ "$MODE" != "dry-run" && "$MODE" != "publish" ]]; then
  echo "[publish] LISTENAI_PUBLISH_MODE must be dry-run or publish, got '$MODE'" >&2
  exit 2
fi
if [[ "$AUTH_MODE" != "password" && "$AUTH_MODE" != "token" ]]; then
  echo "[publish] LISTENAI_NPM_AUTH_MODE must be password or token, got '$AUTH_MODE'" >&2
  exit 2
fi

if [[ "$MODE" == "publish" ]]; then
  if [[ "${CONFIRM_PUBLISH:-}" != "publish" ]]; then
    echo "[publish] Refusing real publish: set CONFIRM_PUBLISH=publish to confirm." >&2
    exit 2
  fi

  if [[ "$AUTH_MODE" == "password" ]]; then
    if [[ -z "${LPM_PASSWORD_BASE64:-}" || -z "${LPM_USERNAME:-}" || -z "${LPM_EMAIL:-}" ]]; then
      echo "[publish] Refusing real publish: password auth requires LPM_PASSWORD_BASE64, LPM_USERNAME, and LPM_EMAIL." >&2
      exit 2
    fi
  elif [[ -z "${LPM_ADMIN_TOKEN:-}" ]]; then
    echo "[publish] Refusing real publish: token auth requires LPM_ADMIN_TOKEN." >&2
    exit 2
  fi
fi

cd "$ROOT_DIR"

echo "[publish] Registry: $REGISTRY_URL"
echo "[publish] Mode: $MODE"
echo "[publish] Auth mode: $AUTH_MODE"
echo "[publish] Package order: ${PACKAGES[*]}"

PACKAGE_VERSION="$(node --input-type=module - "${PACKAGES[@]}" <<'NODE'
import { readFileSync } from "node:fs";
import { join } from "node:path";

const packages = process.argv.slice(2).map((entry) => {
  const separator = entry.indexOf(":");
  return { name: entry.slice(0, separator), dir: entry.slice(separator + 1) };
});
const manifests = packages.map((pkg) => ({
  ...pkg,
  manifest: JSON.parse(readFileSync(join(pkg.dir, "package.json"), "utf8"))
}));
const versions = new Set(manifests.map((pkg) => pkg.manifest.version));
if (versions.size !== 1) {
  throw new Error(`Publish packages must share one version, got ${[...versions].join(", ")}`);
}
for (const pkg of manifests) {
  if (pkg.manifest.name !== pkg.name) {
    throw new Error(`${pkg.dir}/package.json name is ${pkg.manifest.name}, expected ${pkg.name}`);
  }
}
console.log(manifests[0].manifest.version);
NODE
)"
echo "[publish] Version: $PACKAGE_VERSION"

printf '@listenai:registry=%s\n' "$REGISTRY_URL" > "$NPM_USERCONFIG"
REGISTRY_AUTH_HOST="${REGISTRY_URL#http://}"
REGISTRY_AUTH_HOST="${REGISTRY_AUTH_HOST#https://}"
REGISTRY_AUTH_HOST="${REGISTRY_AUTH_HOST%/}"
if [[ -n "${LPM_PASSWORD_BASE64:-}" ]]; then
  printf '//%s/:_password=%s\n' "$REGISTRY_AUTH_HOST" "$LPM_PASSWORD_BASE64" >> "$NPM_USERCONFIG"
  printf '//%s/:username=%s\n' "$REGISTRY_AUTH_HOST" "$LPM_USERNAME" >> "$NPM_USERCONFIG"
  printf '//%s/:email=%s\n' "$REGISTRY_AUTH_HOST" "$LPM_EMAIL" >> "$NPM_USERCONFIG"
  printf '//%s/:always-auth=true\n' "$REGISTRY_AUTH_HOST" >> "$NPM_USERCONFIG"
elif [[ -n "${LPM_ADMIN_TOKEN:-}" ]]; then
  printf '//%s/:_authToken=%s\n' "$REGISTRY_AUTH_HOST" "$LPM_ADMIN_TOKEN" >> "$NPM_USERCONFIG"
  printf '//%s/:always-auth=true\n' "$REGISTRY_AUTH_HOST" >> "$NPM_USERCONFIG"
fi

if [[ "$MODE" == "publish" ]]; then
  echo "[publish] Checking registry for existing $PACKAGE_VERSION packages"
  for entry in "${PACKAGES[@]}"; do
    package_name="${entry%%:*}"
    if npm view "${package_name}@${PACKAGE_VERSION}" version --registry "$REGISTRY_URL" --userconfig "$NPM_USERCONFIG" >/tmp/listenai-publish-view.out 2>&1; then
      echo "[publish] Refusing real publish: ${package_name}@${PACKAGE_VERSION} already exists in $REGISTRY_URL" >&2
      rm -f /tmp/listenai-publish-view.out
      exit 2
    fi
    if ! grep -Eqi "E404|404|not_found|could not be found" /tmp/listenai-publish-view.out; then
      echo "[publish] Could not confirm ${package_name}@${PACKAGE_VERSION} is absent from $REGISTRY_URL" >&2
      cat /tmp/listenai-publish-view.out >&2
      rm -f /tmp/listenai-publish-view.out
      exit 2
    fi
  done
  rm -f /tmp/listenai-publish-view.out
fi

if [[ "$RUN_READINESS" != "1" ]]; then
  echo "[publish] Running consumer publish-readiness verifier"
  bash scripts/verify-m003-s04.sh
else
  echo "[publish] Skipping readiness verifier because LISTENAI_PUBLISH_SKIP_READINESS=1"
fi

pack_package() {
  local package_name="$1"
  local package_dir="$2"
  local pack_dir="$TMP_DIR/packs/${package_name//@/}"
  mkdir -p "$pack_dir"
  echo "[publish] Packing $package_name" >&2
  pnpm --filter "$package_name" pack --pack-destination "$pack_dir" >/dev/null
  find "$pack_dir" -maxdepth 1 -type f -name '*.tgz' | sort | tail -n 1
}

publish_tarball() {
  local package_name="$1"
  local tarball="$2"
  if [[ -z "$tarball" || ! -f "$tarball" ]]; then
    echo "[publish] Missing tarball for $package_name" >&2
    exit 1
  fi

  if [[ "$MODE" == "dry-run" ]]; then
    echo "[publish] Dry-run publishing $package_name"
    npm publish "$tarball" --dry-run --registry "$REGISTRY_URL" --access restricted --userconfig "$NPM_USERCONFIG"
  else
    echo "[publish] Publishing $package_name"
    npm publish "$tarball" --registry "$REGISTRY_URL" --access restricted --userconfig "$NPM_USERCONFIG"
  fi
}

for entry in "${PACKAGES[@]}"; do
  package_name="${entry%%:*}"
  package_dir="${entry#*:}"
  tarball="$(pack_package "$package_name" "$package_dir")"
  publish_tarball "$package_name" "$tarball"
done

echo "[publish] Completed $MODE for ${#PACKAGES[@]} package(s)"
