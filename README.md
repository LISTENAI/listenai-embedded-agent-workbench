# ListenAI Agent Skills

English is the default entrypoint for this repository. Chinese readers can use [README.zh-CN.md](README.zh-CN.md).

ListenAI Agent Skills is a pnpm workspace for reusable embedded-debugging agent capabilities. The repository packages a resource-manager HTTP service, the shared contracts that define its requests and records, an HTTP client for that manager, and a logic-analyzer skill package that can be exercised from the repo itself.

This repository is currently focused on public GitHub readiness rather than adding new runtime behavior. The goal of the root README is to help a first-time visitor understand what exists today, how the workspaces are organized, and which commands prove the monorepo still works locally.

## Who this repository is for

- Engineers evaluating the current monorepo shape before reading source files.
- Contributors who want the real local verification path before making changes.
- Agent-host integrators looking for the current logic-analyzer package entrypoint and the resource-manager packages it depends on.

## Workspace map

The repository uses pnpm workspaces with two top-level ownership boundaries:

- `packages/resource-manager` - the `@listenai/resource-manager` package, which re-exports the shared contracts together with the in-memory manager, device-provider seam, HTTP app/server helpers, lease management, and test-friendly fake provider. The packaged CLI runtime entrypoint lives at `packages/resource-manager/src/cli.ts`.
- `packages/skill-logic-analyzer` - the `@listenai/skill-logic-analyzer` package, which exports the canonical logic-analyzer host boundary, package-owned `SKILL.md` and `README.md`, request/result contracts, capture loading helpers, and waveform-analysis surface.
- `share/contracts` - the `@listenai/contracts` package, which holds the shared resource-manager contracts consumed across the workspace.
- `share/resource-client` - the `@listenai/resource-client` package, which re-exports the shared contracts plus the `HttpResourceManager` client for calling the resource-manager HTTP API.

The root `src/index.ts` is a thin compatibility layer that re-exports workspace-owned public APIs. It remains available for existing repo-local consumers, but package-owned entrypoints under `packages/` and `share/` are the authoritative surfaces to copy into external hosts.

## Local bootstrap and standard verification

From the repository root, install dependencies and run the same baseline checks used in CI:

```bash
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm run test
pnpm run build
```

These commands match the automated baseline in `.github/workflows/ci.yml` and are the default proof path for the current monorepo.

## Deeper verification paths

If the baseline passes and you need higher-confidence follow-up diagnostics, run:

```bash
pnpm run verify:s06
pnpm run verify:s07
```

Treat these as deeper diagnostics rather than the default path for every change. Contributor expectations and repo-specific verification details live in `CONTRIBUTING.md`; Chinese readers can use `CONTRIBUTING.zh-CN.md`.

For advanced manual runtime checks, the packaged resource-manager CLI entrypoint is `packages/resource-manager/src/cli.ts`; use `CONTRIBUTING.md` for the repo-root command that starts it without inventing a separate dev entrypoint.

## Where to look next

- `CONTRIBUTING.md` - contributor bootstrap, verification expectations, and repo-specific diagnostics.
- `.github/workflows/ci.yml` - the GitHub Actions baseline for install, typecheck, test, and build.
- `packages/skill-logic-analyzer/README.md` - canonical host-facing guidance for the logic-analyzer package.
- `skills/logic-analyzer/README.md` - compatibility mirror that points back to the package-owned docs.

## Repository focus right now

The current milestone is about making the existing workspace understandable and verifiable as a source repository. If you are browsing the repo for the first time, start with the workspace-owned packages above, then use the root verification commands to confirm the documented story matches local reality.
