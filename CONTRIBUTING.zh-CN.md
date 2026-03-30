# Contributing

English: [`CONTRIBUTING.md`](CONTRIBUTING.md)。默认入口仍为英文版；如需查看英文原文，请阅读该文件。

本文档说明 ListenAI monorepo 的贡献者启动流程、本地验证方式，以及仓库特定的诊断路径。它会刻意保持比根 README 更聚焦；根 README 仍然是默认的英文仓库导览入口。

## Prerequisites

- Node.js 22
- pnpm 10.33.0

请在仓库根目录安装依赖：

```bash
pnpm install --frozen-lockfile
```

一个全新的镜像 worktree 在安装完成前不会建立 workspace links，所以在尝试验证脚本之前先执行这一步。

## Workspace layout

这个仓库使用 pnpm workspace，并且有两个顶层边界：

- `packages/` 保存运行时应用与由 package 拥有的实现，其中包括 `@listenai/resource-manager` server/CLI 以及 `@listenai/skill-logic-analyzer` skill package。
- `share/` 保存整个 workspace 复用的共享 packages，其中包括 `@listenai/contracts` 和 `@listenai/resource-client`。

当你新增或移动代码时，请保持 package ownership 清晰，而不是再引入一个新的根级运行时 surface。

## Standard verification path

公开的基础验证路径需要在仓库根目录运行，并与 `.github/workflows/ci.yml` 中的 GitHub Actions workflow 保持一致：

```bash
pnpm run typecheck
pnpm run test
pnpm run build
```

如果你想用同样的命令顺序通过一个本地一致性 gate 来执行，请运行：

```bash
bash scripts/verify-s01.sh
```

验证改动时优先直接使用根级脚本，这样本地行为才会和 CI 保持一致。

## Manual runtime checks

若需要更深入的手动验证，打包后的 resource-manager CLI 位于 `packages/resource-manager/src/cli.ts`，并由 `@listenai/resource-manager` package 对外暴露。

你可以在仓库根目录这样启动它：

```bash
pnpm --filter @listenai/resource-manager exec tsx src/cli.ts --host 127.0.0.1 --port 7600
```

这样你就能获得一个真实的 HTTP surface 用于手动检查，而不必另外发明一个开发入口。

## Deeper diagnostics

基础贡献流程应当止步于 install、typecheck、test 和 build。如果标准路径通过后还需要更重的后续诊断，请明确运行现有的根级脚本：

```bash
pnpm run verify:s06
pnpm run verify:s07
```

请将这些命令视为更深入的调查路径，而不是默认的公开贡献清单。

## Contribution notes

- 让改动继续遵守 `packages/` 与 `share/` 的既有 pnpm workspace 边界。
- 当你修改跨 package 行为时，优先同时更新 package-owned tests 和根级验证脚本。
- 这里的贡献者文档应继续聚焦于启动与验证机制；更广泛的仓库导览已经由根 README 承担。
