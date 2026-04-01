# @listenai/resource-manager

<h4 align="right"><a href="README.md">English</a> | <strong>简体中文</strong></h4>

这个 package 拥有 workspace 中 resource-manager 的运行时边界。它导出内存版 manager、HTTP app/server helpers、lease management、DSLogic provider 集成，以及一个用于启动 HTTP server 的 CLI。现在，打包后的 dashboard 与 API 会把原生 `libsigrok` 运行时当作 backend truth surface，并明确呈现 `ready`、`degraded`、`missing`、`unsupported` 等状态。

如果你是想在这个仓库里使用 server，请先看这里，而不是从仓库根目录去猜它的行为。

## 这个 package 暴露了什么

请把 package root 当作权威导入面：

```ts
import {
  InMemoryResourceManager,
  LeaseManager,
  createApp,
  createServer,
  createDeviceProvider,
  type SnapshotResourceManager
} from "@listenai/resource-manager";
```

这个 package 还带有一个名为 `resource-manager` 的 CLI bin，指向 `src/cli.ts`。

## 前置条件

- Node.js 22
- pnpm 10.33.0
- 在全新的 workspace 中，先从仓库根目录执行 `pnpm install --frozen-lockfile`

## 从仓库内启动 server

如果你在仓库根目录中工作，最直接的开发命令是：

```bash
pnpm --filter @listenai/resource-manager exec tsx src/cli.ts --host 127.0.0.1 --port 7600
```

CLI 参数：

- `--host`、`-h`：绑定地址，默认是 `127.0.0.1`
- `--port`、`-p`：绑定端口，默认是 `7600`
- `--provider`：设备 provider，默认是 `dslogic`；做本地冒烟检查时可切到 `fake`

CLI 也会读取 `RESOURCE_MANAGER_PROVIDER`；如果环境变量和 CLI 参数同时存在，以 CLI 参数为准。

默认的 `dslogic` 启动路径假设宿主机已经具备原生 `libsigrok` 运行时。本文档重点说明 operator 应该从 `/inventory`、`/dashboard-snapshot` 与浏览器 dashboard 中观察到什么运行时状态，而不是提供平台相关的安装命令。

示例：

```bash
# 使用默认的 DSLogic provider 启动
pnpm --filter @listenai/resource-manager exec tsx src/cli.ts

# 强制使用 fake provider 做本地存活性和路由冒烟检查
pnpm --filter @listenai/resource-manager exec tsx src/cli.ts --provider fake --host 127.0.0.1 --port 7600

# 通过环境变量选择 provider，效果等价
RESOURCE_MANAGER_PROVIDER=fake pnpm --filter @listenai/resource-manager exec tsx src/cli.ts --port 7600
```

启动成功后，进程会打印 `Server listening on http://<host>:<port>`。

## Operator 路径

面向 operator 的已发布路径可以概括为：

1. 启动打包后的 `resource-manager` CLI。
2. 在同一台机器上打开 `http://127.0.0.1:7600/`；如果绑定地址是 `0.0.0.0`，也可以从同一局域网中的其他设备打开 `http://<machine-ip>:7600/`。
3. 把 dashboard 与 `/dashboard-snapshot` 当作设备占用、owner identity、lease timing，以及原生 `libsigrok` runtime readiness 的权威观察面。
4. 把 `pnpm run verify:m009:s04` 当作这个 dashboard/operator seam 的顶层验收命令。

该 gate 会先快速拦截 dashboard/doc 中残留的陈旧措辞，然后重新执行聚焦的 dashboard server suites（`src/server/dashboard-snapshot.test.ts` 与 `src/server/app.test.ts`）、已发布 dashboard 的 browser truth suite（`integration/resource-manager-dashboard.e2e.test.ts`），并再次检查 operator docs 是否覆盖 `libsigrok`、missing runtime 与 degraded state 指引。命令通过时，表示已发布的 dashboard entrypoint、API truth、live updates，以及面向 operator 的 runtime 可见性在 healthy / degraded / missing runtime 之间仍然保持一致。

## 健康检查与 inventory 检查

server 启动后，可以先用这些端点确认状态。

### 基础存活性检查

```bash
curl http://127.0.0.1:7600/health
```

预期返回形状：

```json
{"status":"ok","timestamp":"2026-03-31T05:00:00.000Z"}
```

### 完整 inventory snapshot

返回 authoritative snapshot，其中包含原生 runtime readiness 与 device diagnostics。针对 `libsigrok`，这里的 backend readiness 可能会显示 `ready`、`degraded`、`missing`、`unsupported`。

```bash
curl http://127.0.0.1:7600/inventory
```

### 刷新并返回完整 snapshot

```bash
curl -X POST http://127.0.0.1:7600/inventory/refresh
```

如果你希望内存中的 manager 在启动后立刻把 provider 当前看到的 inventory 拉进 authoritative snapshot，就先调用一次这个端点。

### 兼容模式设备列表

这里只返回设备行。

```bash
curl http://127.0.0.1:7600/devices
curl -X POST http://127.0.0.1:7600/refresh
```

刚启动后，`/devices` 反映的是 manager 当前的 authoritative snapshot；在第一次 refresh 之前，它默认是空的。如果你预期应该看到 provider 提供的设备，请先调用 `POST /refresh`。

当你需要 backend readiness 和 diagnostics 时，用 `/inventory` 与 `/inventory/refresh`。当调用方只理解兼容设备列表时，用 `/devices` 与 `/refresh`。

当 CLI 以 `--provider fake` 运行时，默认 inventory 是空的。这个模式适合做存活性和路由冒烟检查；但下面的分配示例需要满足以下两种条件之一：

- 使用默认 `dslogic` provider，并从 `/devices` 拿到真实的 `deviceId`
- 使用后文展示的程序化 seeded fake provider

## 租约与分配流程

server 会同时维护租约表和设备分配状态。

### 分配设备

```bash
curl -X POST http://127.0.0.1:7600/allocate \
  -H 'Content-Type: application/json' \
  -d '{
    "deviceId": "<device-id-from-/devices>",
    "ownerSkillId": "logic-analyzer",
    "requestedAt": "2026-03-31T05:01:00.000Z"
  }'
```

成功时返回 `200`，并带上接受后的设备信息、`leaseId` 与 `expiresAt`。

分配失败返回 `409`，包括但不限于：

- `device-not-found`
- `device-already-allocated`

### 给活动租约发送 heartbeat

```bash
curl -X POST http://127.0.0.1:7600/heartbeat \
  -H 'Content-Type: application/json' \
  -d '{"leaseId":"<lease-id-from-allocate>"}'
```

成功时返回 `200`，并刷新后的 `expiresAt`。未知租约返回 `404`，其中 `reason` 为 `"lease-not-found"`。

### 查看当前租约

```bash
curl http://127.0.0.1:7600/leases
```

### 释放设备

```bash
curl -X POST http://127.0.0.1:7600/release \
  -H 'Content-Type: application/json' \
  -d '{
    "deviceId": "<device-id-from-/devices>",
    "ownerSkillId": "logic-analyzer",
    "releasedAt": "2026-03-31T05:02:00.000Z"
  }'
```

成功时返回 `200`，并移除对应租约。释放不匹配时返回 `400`，例如 owner 不匹配。

## Live capture 路由

HTTP surface 还通过共享 contracts 暴露了 live capture：

```bash
curl -X POST http://127.0.0.1:7600/capture/live \
  -H 'Content-Type: application/json' \
  -d '{
    "session": {
      "sessionId": "session-1",
      "deviceId": "logic-1",
      "ownerSkillId": "logic-analyzer",
      "startedAt": "2026-03-31T05:01:00.000Z",
      "device": {
        "deviceId": "logic-1",
        "label": "Logic 1",
        "capabilityType": "logic-analyzer",
        "connectionState": "connected",
        "allocationState": "allocated",
        "ownerSkillId": "logic-analyzer",
        "lastSeenAt": "2026-03-31T05:00:00.000Z",
        "updatedAt": "2026-03-31T05:01:00.000Z",
        "readiness": "ready",
        "diagnostics": [],
        "providerKind": "dslogic",
        "backendKind": "libsigrok"
      },
      "sampling": {
        "sampleRateHz": 1000000,
        "captureDurationMs": 4,
        "channels": [{ "channelId": "D0", "label": "CLK" }]
      }
    },
    "requestedAt": "2026-03-31T05:01:10.000Z",
    "timeoutMs": 1500
  }'
```

对于真实的 capture payload，优先使用共享的 `@listenai/contracts` 类型或 `@listenai/resource-client` 的 HTTP client 来构造请求，而不是手写大段 JSON。

## 程序化启动

如果你需要把这个 HTTP surface 嵌入到其他进程里，可以直接组装 manager 和 server。下面这个例子会先 seed 一个 fake 设备，因此即使没有 DSLogic 硬件，也可以演示 allocate、heartbeat 和 release 流程：

```ts
import {
  InMemoryResourceManager,
  LeaseManager,
  createDeviceProvider,
  createServer
} from "@listenai/resource-manager";

const provider = createDeviceProvider({
  providerKind: "fake",
  fakeInventory: [
    {
      deviceId: "fake-audio-1",
      label: "Fake Audio 1",
      capabilityType: "audio",
      lastSeenAt: new Date().toISOString()
    }
  ]
});
const manager = new InMemoryResourceManager(provider);
await manager.refreshInventory();
const leaseManager = new LeaseManager();

const server = createServer({
  host: "127.0.0.1",
  port: 7600,
  manager,
  leaseManager
});

const startInfo = await server.start();
console.log(startInfo.url);

// later
server.stop();
```

`start()` 会返回 `{ host, port, url }`。`stop()` 会关闭 HTTP server，以及后台的 lease-expiry scan。

## 运行说明

- 默认 provider 是 `dslogic`；如果你只是想验证 HTTP surface，可用 `--provider fake`
- server 默认每 10 秒扫描一次过期租约，并自动释放对应设备
- 打包后的 CLI 会在收到 `SIGINT` 和 `SIGTERM` 时进行干净退出
- `GET /health` 只表示存活性；如果要看 `libsigrok` readiness 与 diagnostics，请查看 `/inventory`、`/dashboard-snapshot` 或浏览器 dashboard

## 验证

聚焦这个 package 自己的检查：

```bash
pnpm --filter @listenai/resource-manager test
pnpm --filter @listenai/resource-manager typecheck
```

当前面向 operator 的最终验收命令是 `pnpm run verify:m009:s04`；它会一起证明 operator wording guard、聚焦的 dashboard server truth、已发布 dashboard browser truth，以及 `libsigrok` 的 degraded / missing runtime 可见性。

同时覆盖这个 package 的仓库级验证路径：

```bash
pnpm run test
pnpm run verify:s06
pnpm run verify:s07
```
