# ListenAI Agent Skills

<h4 align="right"><strong>English</strong> | <a href="README.zh-CN.md">简体中文</a></h4>

ListenAI Agent Skills is a pnpm workspace for using a packaged `resource-manager` service together with reusable skill packages. If you are here to run the system rather than contribute to the monorepo, start with the flow in this README: install dependencies, start the manager, inspect the runtime state, then call it through the packaged client or skill package.

## What you can use from this repository

This repository currently exposes four user-facing package surfaces:

- `@listenai/resource-manager` - starts the HTTP service, serves the dashboard, exposes inventory and lease APIs, and owns the DSLogic `libsigrok` runtime boundary.
- `@listenai/resource-client` - provides the `HttpResourceManager` client for talking to that HTTP service from scripts, hosts, or other packages.
- `@listenai/skill-logic-analyzer` - provides the packaged logic-analyzer skill surface for artifact analysis and live capture workflows.
- `@listenai/contracts` - provides the shared request/result and inventory contracts used across the service, client, and skill package.

If you only need one starting point, it is `@listenai/resource-manager`: once that service is running, the other packages plug into it.

## Quick start

Install dependencies from the repository root:

```bash
pnpm install --frozen-lockfile
```

Start the resource manager on the default port:

```bash
pnpm --filter @listenai/resource-manager exec tsx src/cli.ts --host 127.0.0.1 --port 7600
```

For a route-only smoke test without DSLogic hardware, start it with the fake provider:

```bash
pnpm --filter @listenai/resource-manager exec tsx src/cli.ts --provider fake --host 127.0.0.1 --port 7600
```

Once it is running, these are the first endpoints to check:

```bash
curl http://127.0.0.1:7600/health
curl http://127.0.0.1:7600/inventory
curl http://127.0.0.1:7600/dashboard-snapshot
```

Open `http://127.0.0.1:7600/` in a browser when you want the packaged dashboard rather than raw JSON.

## Using `@listenai/resource-manager`

Use the packaged service when you need one authoritative process to track devices, allocations, leases, backend readiness, and dashboard state.

Common routes:

- `GET /health` - liveness only
- `GET /inventory` - full inventory snapshot with backend readiness and diagnostics
- `POST /inventory/refresh` - refresh provider state and return the full snapshot
- `GET /devices` - compatibility device list only
- `POST /allocate` - allocate a device for a skill owner
- `POST /heartbeat` - extend an active lease
- `POST /release` - release a device
- `POST /capture/live` - run the live capture path through the shared contracts
- `GET /dashboard-snapshot` and `GET /dashboard-events` - browser/operator truth surfaces

Use the package README for the full operator path, API examples, and runtime semantics:

- `packages/resource-manager/README.md`
- `packages/resource-manager/README.zh-CN.md`

## Using `@listenai/resource-client`

Use the HTTP client when your host or script should talk to a running manager instead of importing server internals.

Example:

```ts
import { HttpResourceManager } from "@listenai/resource-client";

const manager = new HttpResourceManager({
  baseUrl: "http://127.0.0.1:7600",
  ownerSkillId: "logic-analyzer"
});

const snapshot = await manager.getInventorySnapshot();
console.log(snapshot.backendReadiness);
```

This is the right package for:

- host integrations that connect to a remote or local manager over HTTP
- scripts that need inventory, allocation, lease, or live-capture calls
- skill packages that should depend on the public service boundary instead of server internals

## Using `@listenai/skill-logic-analyzer`

Use the logic-analyzer package when you want one packaged workflow that either:

- analyzes an existing capture artifact, or
- requests a live capture through the manager/client seam and returns normalized analysis output

Example package entrypoint:

```ts
import { runGenericLogicAnalyzer } from "@listenai/skill-logic-analyzer";
import { HttpResourceManager } from "@listenai/resource-client";

const resourceManager = new HttpResourceManager({
  baseUrl: "http://127.0.0.1:7600",
  ownerSkillId: "logic-analyzer"
});

const result = await runGenericLogicAnalyzer(resourceManager, request);
```

Important runtime behavior:

- artifact mode keeps the workflow offline and analyzes provided capture text
- live mode allocates a device and captures through the manager boundary
- a successful live run does not auto-release the device; callers should end the session explicitly when done
- malformed HTTP payloads should surface as parser/transport errors rather than synthetic typed failures

Use the package-owned docs for request shapes, cleanup expectations, installer commands, and host support notes:

- `packages/skill-logic-analyzer/README.md`
- `packages/skill-logic-analyzer/SKILL.md`

## Which package should you start with?

- If you need a running service and dashboard, start with `@listenai/resource-manager`.
- If you already have a running manager and need programmatic access, start with `@listenai/resource-client`.
- If you want a ready-made logic-analyzer workflow, start with `@listenai/skill-logic-analyzer`.
- If you need shared TypeScript contracts for custom integrations, use `@listenai/contracts` alongside the client or skill package.

## Verification for users

If you want to confirm the packaged user path still matches the M010 support story from the repository root, run:

```bash
bash scripts/verify-m010-s05.sh
pnpm run verify:m010:s05
```

What this proves:

- `bash scripts/verify-m010-s05.sh` - the layered support-story gate rejects stale M006/M009 wording and rechecks the M010 acceptance seam
- `pnpm run verify:m010:s05` - the repo-facing alias for that same acceptance seam stays wired from the authoritative repo root

The M010 support contract is explicit: macOS via `sigrok-cli` is `live-proven`, while Linux and Windows remain `readiness-modeled` future paths whose truthful diagnostics still include `backend-missing-runtime`, `backend-runtime-timeout`, `backend-runtime-malformed-response`, `backend-unsupported-os`, `device-unsupported-variant`, and `device-runtime-malformed-response`.

## If you are contributing instead

This README is intentionally user-facing. For workspace layout, CI-style repo checks, and contributor workflow details, use:

- `CONTRIBUTING.md`
- `CONTRIBUTING.zh-CN.md`
- `.github/workflows/ci.yml`
