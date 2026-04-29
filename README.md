# ListenAI Embedded Agent Workbench

<h4 align="right"><strong>English</strong> | <a href="README.zh-CN.md">简体中文</a></h4>

ListenAI Embedded Agent Workbench (EAW) publishes reusable agent-skill and hardware-resource packages for embedded development and debugging workflows. Users should normally consume the packages from the ListenAI private npm registry; this repository is the contributor workspace.

## Packages

The user-facing package surfaces are:

- `@listenai/eaw-contracts` - shared request/result, inventory, live-capture, and device-option contracts.
- `@listenai/eaw-resource-client` - `HttpResourceManager` for talking to a running resource-manager service over HTTP.
- `@listenai/eaw-resource-manager` - the local HTTP service, dashboard, DSLogic runtime boundary, inventory, leases, and live-capture API.
- `@listenai/eaw-skill-logic-analyzer` - the packaged logic-analyzer agent skill assets and TypeScript runtime entrypoints.

The root `listenai-embedded-agent-workbench` package is private and exists only to develop these EAW packages together.

## Registry Setup

`@listenai` packages are expected to resolve from the ListenAI private registry:

```text
https://registry-lpm.listenai.com
```

Configure the `@listenai` scope in your npm, pnpm, yarn, or CI environment before running the commands below. Do not commit registry auth tokens to this repository.

Examples:

```bash
npm config set @listenai:registry https://registry-lpm.listenai.com
pnpm config set @listenai:registry https://registry-lpm.listenai.com
yarn config set npmScopes.listenai.npmRegistryServer https://registry-lpm.listenai.com
```

Your organization or CI should provide authentication through environment-specific configuration.

## Quick Start: Install the Agent Skill

Install the `logic-analyzer` agent skill without adding a permanent dependency:

```bash
npm exec --package @listenai/eaw-skill-logic-analyzer -- \
  listenai-logic-analyzer-install-codex ~/.codex/skills

pnpm dlx --package @listenai/eaw-skill-logic-analyzer \
  listenai-logic-analyzer-install-codex ~/.codex/skills

yarn dlx @listenai/eaw-skill-logic-analyzer \
  listenai-logic-analyzer-install-codex ~/.codex/skills
```

For Claude Code skill directories, use the Claude installer binary instead:

```bash
npm exec --package @listenai/eaw-skill-logic-analyzer -- \
  listenai-logic-analyzer-install-claude ~/.claude/skills
```

For teams that want lockfile-pinned skill installation, add `@listenai/eaw-skill-logic-analyzer` as a project dev dependency and wrap the installer in a project script.

## Quick Start: Run Resource Manager

Live DSLogic capture uses `@listenai/eaw-resource-manager` as the hardware authority. Install it once as a user-level/global tool, then control the singleton daemon directly:

```bash
npm install -g @listenai/eaw-resource-manager

resource-manager start --daemon --host 127.0.0.1 --port 7600
resource-manager status --json
resource-manager stop
```

The daemon is designed as a user-home global singleton shared across projects and terminal sessions. By default it stores state and logs under `~/.listenai/resource-manager/`; use `RESOURCE_MANAGER_STATE_DIR`, `RESOURCE_MANAGER_LOG_FILE`, `--state-dir`, or `--log-file` only when you intentionally need an isolated runtime.

Check the running service:

```bash
curl http://127.0.0.1:7600/health
curl http://127.0.0.1:7600/inventory
curl http://127.0.0.1:7600/dashboard-snapshot
```

Open `http://127.0.0.1:7600/` when you want the packaged dashboard rather than raw JSON.

## Use the Runtime Packages

Use package-root imports only. Do not deep-import package internals.

```ts
import { HttpResourceManager } from "@listenai/eaw-resource-client";
import { runGenericLogicAnalyzer } from "@listenai/eaw-skill-logic-analyzer";

const resourceManager = new HttpResourceManager("http://127.0.0.1:7600");
const result = await runGenericLogicAnalyzer(resourceManager, request);

if (!result.ok) {
  console.error(result.phase, result);
}
```

`@listenai/eaw-skill-logic-analyzer` supports two request modes:

- artifact mode analyzes caller-supplied capture artifacts and can add optional offline protocol decode;
- live mode allocates and captures through resource-manager, then returns normalized waveform analysis.

Successful live sessions are not automatically released. When the host is done consuming the result, explicitly end the session through the package-root skill surface.

## Docs

User-facing guides live in `docs/`:

- `docs/logic-analyzer-agent-skill.md` - install and use `@listenai/eaw-skill-logic-analyzer` as an agent skill for Codex, Claude Code, or GSD/pi-style skill directories.
- `docs/logic-analyzer-agent-skill.zh-CN.md` - Simplified Chinese version.

Package-owned docs remain authoritative for package-local behavior and installer assets:

- `packages/skill-logic-analyzer/README.md`
- `packages/skill-logic-analyzer/SKILL.md`
- `packages/resource-manager/README.md`

## Contributor Workflow From Source

Use source workspace commands only when developing this repository.

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm test
```

To run resource-manager from source while contributing:

```bash
pnpm --filter @listenai/eaw-resource-manager exec tsx src/cli.ts --host 127.0.0.1 --port 7600
```

To build and test the logic-analyzer package from source:

```bash
pnpm --filter @listenai/eaw-skill-logic-analyzer typecheck
pnpm --filter @listenai/eaw-skill-logic-analyzer build
pnpm --filter @listenai/eaw-skill-logic-analyzer test
```

## Verification for Maintainers

Before changing package publishing behavior, run the focused checks from the repository root:

```bash
bash scripts/verify-m003-s01.sh
pnpm run verify:m005:s04
pnpm run verify:m010:s05
```

`verify:m005:s04` is the final M005 acceptance command for the connected UART-log path. S04 proof level: fixture/integration acceptance for connected resource-manager capture/decode; it does not claim real DSLogic hardware capture/decode until that hardware run is completed separately.

`verify:m010:s05` checks the existing DSLogic support story: macOS via `dsview-cli` is the only `live-proven` host path, and only the classic DSLogic Plus variant is treated as ready on that path. Linux and Windows remain `readiness-modeled` future paths with truthful diagnostics.

For contribution guidelines, see:

- `CONTRIBUTING.md`
- `CONTRIBUTING.zh-CN.md`
- `.github/workflows/ci.yml`
