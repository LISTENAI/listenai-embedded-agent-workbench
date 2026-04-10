# ListenAI Agent Skills

<h4 align="right"><a href="README.md">English</a> | <strong>简体中文</strong></h4>

ListenAI Agent Skills 是一个 pnpm workspace，用来组合一个可运行的 `resource-manager` 服务和一组可复用的 skill packages。如果你来到这个仓库是为了使用它，而不是参与 monorepo 开发，那么请从这份 README 开始：安装依赖、启动 manager、查看运行时状态，然后通过打包后的 client 或 skill package 调用它。

## 这个仓库里能直接用什么

当前仓库对使用者暴露四个主要 package surface：

- `@listenai/resource-manager` - 启动 HTTP 服务、提供 dashboard、暴露 inventory 与 lease API，并承载 DSLogic 的 `dsview-cli` 运行时边界。
- `@listenai/resource-client` - 提供 `HttpResourceManager` client，供脚本、宿主程序或其他 package 通过 HTTP 调用 manager。
- `@listenai/skill-logic-analyzer` - 提供 logic-analyzer skill 的打包运行时表面，支持离线 artifact 分析和 live capture 工作流。
- `@listenai/contracts` - 提供 service、client 和 skill package 之间共用的请求/结果与 inventory contracts。

如果你只想记住一个起点，那就是 `@listenai/resource-manager`：先把服务跑起来，其他 package 再接到它上面。

## 快速开始

先在仓库根目录安装依赖：

```bash
pnpm install --frozen-lockfile
```

使用默认端口启动 resource manager：

```bash
pnpm --filter @listenai/resource-manager exec tsx src/cli.ts --host 127.0.0.1 --port 7600
```

如果你暂时没有 DSLogic 硬件、只想做路由和界面冒烟检查，可以使用 fake provider：

```bash
pnpm --filter @listenai/resource-manager exec tsx src/cli.ts --provider fake --host 127.0.0.1 --port 7600
```

服务起来以后，优先检查这些入口：

```bash
curl http://127.0.0.1:7600/health
curl http://127.0.0.1:7600/inventory
curl http://127.0.0.1:7600/dashboard-snapshot
```

如果你想看打包后的 dashboard，而不是直接看 JSON，就打开 `http://127.0.0.1:7600/`。

## 如何使用 `@listenai/resource-manager`

当你需要一个权威进程统一维护设备状态、分配、lease、backend readiness 和 dashboard 状态时，就使用这个 package。

常用路由：

- `GET /health` - 仅表示服务存活
- `GET /inventory` - 带 backend readiness 和 diagnostics 的完整 inventory snapshot
- `POST /inventory/refresh` - 刷新 provider 状态并返回完整 snapshot
- `GET /devices` - 仅返回兼容设备列表
- `POST /allocate` - 为某个 skill owner 分配设备
- `POST /heartbeat` - 延长现有 lease
- `POST /release` - 释放设备
- `POST /capture/live` - 通过共享 contracts 走 live capture 路径
- `GET /dashboard-snapshot` 与 `GET /dashboard-events` - 面向浏览器和 operator 的 truth surface

更完整的 operator 路径、API 示例和运行时语义，请看 package 自带文档：

- `packages/resource-manager/README.md`
- `packages/resource-manager/README.zh-CN.md`

## 如何使用 `@listenai/resource-client`

如果你的宿主程序或脚本应该通过 HTTP 调用一个已经运行的 manager，而不是直接引入 server 内部实现，就使用这个 client package。

示例：

```ts
import { HttpResourceManager } from "@listenai/resource-client";

const manager = new HttpResourceManager({
  baseUrl: "http://127.0.0.1:7600",
  ownerSkillId: "logic-analyzer"
});

const snapshot = await manager.getInventorySnapshot();
console.log(snapshot.backendReadiness);
```

这个 package 适合：

- 通过 HTTP 连接本地或远程 manager 的 host 集成
- 需要 inventory、allocation、lease 或 live-capture 调用的脚本
- 希望依赖公开服务边界、而不是 server 内部实现的 skill packages

## 如何使用 `@listenai/skill-logic-analyzer`

当你需要一个现成的 logic-analyzer 工作流时，用这个 package。它支持两种模式：

- 分析已经存在的 capture artifact
- 通过 manager/client seam 发起 live capture，并返回标准化分析结果

示例入口：

```ts
import { runGenericLogicAnalyzer } from "@listenai/skill-logic-analyzer";
import { HttpResourceManager } from "@listenai/resource-client";

const resourceManager = new HttpResourceManager({
  baseUrl: "http://127.0.0.1:7600",
  ownerSkillId: "logic-analyzer"
});

const result = await runGenericLogicAnalyzer(resourceManager, request);
```

几个关键运行时行为：

- artifact mode 走离线分析，直接消费你提供的 capture 文本
- live mode 会通过 manager 边界分配设备并执行捕获
- live 模式成功后不会自动 release 设备；调用方应在消费完结果后显式结束 session
- 如果 `HttpResourceManager` 收到 malformed HTTP payload，应该暴露为 parser/transport error，而不是伪造的 typed failure

关于 request shape、cleanup 约定、installer 命令和 host support 说明，请看 package 自带文档：

- `packages/skill-logic-analyzer/README.md`
- `packages/skill-logic-analyzer/SKILL.md`

## 应该从哪个 package 开始？

- 如果你需要一个可运行的服务和 dashboard，从 `@listenai/resource-manager` 开始。
- 如果你已经有一个运行中的 manager，只需要程序化访问能力，从 `@listenai/resource-client` 开始。
- 如果你想直接使用现成的 logic-analyzer 工作流，从 `@listenai/skill-logic-analyzer` 开始。
- 如果你在做自定义 TypeScript 集成，需要共享类型定义，就把 `@listenai/contracts` 和 client 或 skill package 一起使用。

## 使用者应运行哪些验证命令

如果你想从仓库根目录确认打包后的用户路径仍与当前 M010 支持说明一致，请运行：

```bash
bash scripts/verify-m010-s05.sh
pnpm run verify:m010:s05
```

这些命令分别证明：

- `bash scripts/verify-m010-s05.sh` - 分层支持说明 gate 会拒绝过期的 M006/M009 表述，并重新检查 M010 acceptance seam
- `pnpm run verify:m010:s05` - 仓库根目录暴露的同名校验入口仍正确连到这条 acceptance seam

当前 M010 支持约束是明确的：只有 macOS + `dsview-cli` 是 `live-proven` 的宿主路径，而且只有经典 DSLogic Plus 变体会在这条路径上被视为 `ready`。Linux 和 Windows 仍属于 `readiness-modeled` 的后续路径；这些平台当前应暴露的 truth surface 仍包括 `backend-missing-runtime`、`backend-runtime-timeout`、`backend-runtime-malformed-response`、`backend-unsupported-os`、`device-unsupported-variant` 和 `device-runtime-malformed-response` 这类诊断，而不是提前声称 capture 已经 ready。

## 如果你是来参与开发的

这份 README 故意面向使用者。关于 workspace 布局、CI 风格的仓库检查，以及贡献者工作流，请改看：

- `CONTRIBUTING.md`
- `CONTRIBUTING.zh-CN.md`
- `.github/workflows/ci.yml`
