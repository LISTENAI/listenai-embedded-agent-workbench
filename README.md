# ListenAI Agent Skills

<h4 align="right"><strong>English</strong> | <a href="README.zh-CN.md">简体中文</a></h4>

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

Use the package-owned entrypoints under `packages/` and `share/` as the authoritative surfaces to copy into external hosts. The repository root no longer carries its own runtime compatibility barrel.

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
pnpm run verify:m008:s04
```

`verify:m008:s04` is the current top-level assembled seam for the multi-provider runtime baseline. It reruns the focused S01/S02/S03 proof groups so canonical identity, aggregated `inventoryScope` metadata, dashboard truth, and provider-dispatched live capture stay aligned from the repository root.

Treat these as deeper diagnostics rather than the default path for every change. Contributor expectations and repo-specific verification details live in `CONTRIBUTING.md`; Chinese readers can use `CONTRIBUTING.zh-CN.md`.

For advanced manual runtime checks, the packaged resource-manager CLI entrypoint is `packages/resource-manager/src/cli.ts`; use `CONTRIBUTING.md` for the repo-root command that starts it without inventing a separate dev entrypoint.

## Where to look next

- `CONTRIBUTING.md` - contributor bootstrap, verification expectations, and repo-specific diagnostics.
- `.github/workflows/ci.yml` - the GitHub Actions baseline for install, typecheck, test, and build.
- `packages/skill-logic-analyzer/README.md` - canonical host-facing guidance for the logic-analyzer package.
- `packages/skill-logic-analyzer/SKILL.md` - the packaged skill descriptor shipped to Claude Code and Codex installs.
- `integration/` - repo-level integration, end-to-end, and script-contract proofs for assembled package boundaries.

## Repository focus right now

M008 establishes the current multi-provider control-plane baseline: the packaged resource-manager, dashboard, and skill-driven HTTP workflow now preserve provider-scoped canonical identity across mixed providers without falling back to a fake single-provider story. If you are browsing the repo for the first time, start with the workspace-owned packages above, then use the root verification commands to confirm the documented story matches local reality.

M009 is the follow-on milestone for replacing the DSLogic compatibility adapter with a native DSLogic runtime boundary. Until that lands, treat the current provider-dispatched seam plus `pnpm run verify:m008:s04` as the authoritative closeout path.
