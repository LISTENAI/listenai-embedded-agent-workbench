# ListenAI Agent Skills

中文文档：`README.zh-CN.md`。默认入口仍为英文版；如需查看英文原文，请阅读 [README.md](README.md)。

ListenAI Agent Skills 是一个 pnpm workspace，用于承载可复用的嵌入式调试代理能力。这个仓库打包了一个 resource-manager HTTP 服务、定义其请求与记录的共享 contracts、该 manager 的 HTTP client，以及一个可直接在仓库内验证的 logic-analyzer skill package。

当前仓库的重点是提升公开 GitHub 仓库的可读性，而不是新增运行时行为。根 README 的目标，是帮助第一次访问仓库的读者理解当前已有内容、各 workspace 的组织方式，以及哪些命令可以证明这个 monorepo 在本地仍然可以正常工作。

## 这个仓库适合谁阅读

- 想在深入阅读源码前先评估当前 monorepo 形态的工程师。
- 想在开始修改前先掌握真实本地验证路径的贡献者。
- 需要寻找当前 logic-analyzer 入口点，以及它所依赖的 resource-manager packages 的 agent-host 集成方。

## Workspace 地图

这个仓库使用 pnpm workspaces，并且有两个顶层所有权边界：

- `packages/resource-manager` - `@listenai/resource-manager` package，会重新导出共享 contracts，以及内存版 manager、device-provider seam、HTTP app/server helpers、lease management 和便于测试的 fake provider。打包后的 CLI 运行时入口位于 `packages/resource-manager/src/cli.ts`。
- `packages/skill-logic-analyzer` - `@listenai/skill-logic-analyzer` package，导出 canonical 的 logic-analyzer host boundary、package 自带的 `SKILL.md` 与 `README.md`、request/result contracts、capture loading helpers，以及 waveform-analysis surface。
- `share/contracts` - `@listenai/contracts` package，保存整个 workspace 共用的 resource-manager contracts。
- `share/resource-client` - `@listenai/resource-client` package，重新导出共享 contracts，以及用于调用 resource-manager HTTP API 的 `HttpResourceManager` client。

根目录下的 `src/index.ts` 是一个轻量兼容层，用于重新导出由各 workspace 拥有的公共 API。它会继续服务现有的仓库内调用方，但真正应当复制到外部 host 中的权威入口仍然位于 `packages/` 和 `share/` 下。

## 本地启动与标准验证

在仓库根目录执行安装，并运行与 CI 相同的基础检查：

```bash
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm run test
pnpm run build
```

这些命令与 `.github/workflows/ci.yml` 中的自动化基线保持一致，也是当前 monorepo 默认的证明路径。

## 更深入的验证路径

如果基础检查已经通过，而你需要更高置信度的后续诊断，请运行：

```bash
pnpm run verify:s06
pnpm run verify:s07
```

请将这些脚本视为更深入的诊断路径，而不是每次变更都要执行的默认流程。贡献者预期与仓库特定的验证细节位于 `CONTRIBUTING.zh-CN.md`；如需查看英文原文，请阅读 `CONTRIBUTING.md`。

对于更高级的手动运行时检查，打包后的 resource-manager CLI 入口位于 `packages/resource-manager/src/cli.ts`；若需要从仓库根目录启动它，请参考 `CONTRIBUTING.zh-CN.md` 中的仓库级命令；如需查看英文原文，请阅读 `CONTRIBUTING.md`。

## 接下来可以看哪里

- `CONTRIBUTING.zh-CN.md` - 贡献者启动流程、验证预期，以及仓库特定的诊断说明。
- `.github/workflows/ci.yml` - GitHub Actions 中用于 install、typecheck、test 和 build 的基线工作流。
- `packages/skill-logic-analyzer/README.md` - logic-analyzer package 面向 host 的权威说明。
- `packages/skill-logic-analyzer/SKILL.md` - 随 Claude Code 与 Codex 安装一起分发的 packaged skill descriptor。
- `src/index.ts` - 面向仓库内调用方保留的根级兼容 barrel。

## 当前仓库的重点

当前 milestone 的目标，是让现有 workspace 作为源码仓库更容易被理解和验证。如果你是第一次浏览这个仓库，请先从上面列出的 workspace-owned packages 开始，再使用根目录的验证命令确认文档描述与本地现实一致。
