# Contributing

中文文档：[`CONTRIBUTING.zh-CN.md`](CONTRIBUTING.zh-CN.md)。默认入口仍为英文版；如需查看中文对应内容，请阅读该文件。

This document covers contributor bootstrap, local verification, and repo-specific diagnostics for the ListenAI monorepo. It intentionally stays narrower than the root README, which remains the default English repository orientation and entrypoint.

## Prerequisites

- Node.js 22
- pnpm 10.33.0

Install dependencies from the repository root:

```bash
pnpm install --frozen-lockfile
```

A fresh mirrored worktree will not have workspace links until that install completes, so run it before trying the verification scripts.

## Workspace layout

This repository uses a pnpm workspace with two top-level boundaries:

- `packages/` contains runtime applications and package-owned implementations, including the `@listenai/resource-manager` server/CLI and the `@listenai/skill-logic-analyzer` skill package.
- `share/` contains reusable shared packages consumed across the workspace, including `@listenai/contracts` and `@listenai/resource-client`.

When you add or move code, keep package ownership explicit instead of introducing a new root-level runtime surface.

## Standard verification path

The public baseline verification path runs from the repository root and matches the GitHub Actions workflow in `.github/workflows/ci.yml`:

```bash
pnpm run typecheck
pnpm run test
pnpm run build
```

If you want the same command order wrapped in one local parity gate, run:

```bash
bash scripts/verify-s01.sh
```

Use the root scripts directly when validating changes so local behavior matches CI.

## Manual runtime checks

For deeper hands-on validation, the packaged resource-manager CLI lives at `packages/resource-manager/src/cli.ts` and is exposed by the `@listenai/resource-manager` package.

You can start it from the repo root with:

```bash
pnpm --filter @listenai/resource-manager exec tsx src/cli.ts --host 127.0.0.1 --port 7600
```

That gives you a real HTTP surface for manual checks without inventing a separate development entrypoint.

## Deeper diagnostics

The baseline contribution flow should stop at install, typecheck, test, and build. If you need heavier follow-up diagnostics after the standard path passes, use the existing root scripts explicitly:

```bash
pnpm run verify:s06
pnpm run verify:s07
```

Treat these as deeper investigation paths, not the default public contribution checklist.

## Contribution notes

- Keep changes aligned with the existing pnpm workspace boundaries in `packages/` and `share/`.
- Prefer updating package-owned tests and root verification scripts together when you change cross-package behavior.
- Keep contributor-facing docs focused on bootstrap and verification mechanics here; broader repository orientation already lives in the root README.
