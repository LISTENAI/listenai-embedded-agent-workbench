# 将 `@listenai/eaw-skill-logic-analyzer` 作为 agent skill 使用

这份文档面向需要让 AI coding tool 加载打包后 logic-analyzer guidance 的 host 维护者或 agent 使用者。

读完以后，你应该能够从 ListenAI 私有 npm registry 安装 `logic-analyzer` skill descriptor，确认安装文件来自 package-owned assets，并判断什么时候应该使用 agent skill、什么时候应该直接调用 TypeScript runtime API。

## Registry 配置

`@listenai` packages 应从下面的私有 registry 解析：

```text
https://registry-lpm.listenai.com
```

安装前，请在 npm、pnpm、yarn 或 CI 环境中配置这个 scope。不要把 auth token 提交到仓库。

```bash
npm config set @listenai:registry https://registry-lpm.listenai.com
pnpm config set @listenai:registry https://registry-lpm.listenai.com
yarn config set npmScopes.listenai.npmRegistryServer https://registry-lpm.listenai.com
```

## agent skill 是什么

`@listenai/eaw-skill-logic-analyzer` 暴露两类能力：

- 名为 `logic-analyzer` 的 agent skill descriptor，供 AI coding tool 加载说明、约束和示例；
- TypeScript runtime exports，供 host 代码执行离线 artifact 分析、可选 protocol decode，或通过 resource-manager 做 live DSLogic capture。

agent skill 不会替代 runtime package。它的作用是告诉 agent 如何正确调用 package：只使用 package-root imports，保持嵌套 request shape，不丢失 phase-aware diagnostics，并在 host 使用完 live session 后显式释放设备。

## 权威来源

这个 package 自己拥有 host-facing assets。不要在仓库根目录维护一份手写副本。

package metadata 会在 `listenai.skillAssets` 下暴露权威 asset 路径：

```json
{
  "skillDescriptor": "./SKILL.md",
  "readme": "./README.md"
}
```

installer 和 host integration 应该把这些路径按 package root 解析，并拒绝任何会离开 package 目录的路径。

## 推荐安装方式：一次性从 registry 执行

当你只想安装或刷新 skill、不想增加永久依赖时，使用 one-shot package execution。

Codex 风格 skill 目录：

```bash
npm exec --package @listenai/eaw-skill-logic-analyzer -- \
  listenai-logic-analyzer-install-codex ~/.codex/skills

pnpm dlx --package @listenai/eaw-skill-logic-analyzer \
  listenai-logic-analyzer-install-codex ~/.codex/skills

yarn dlx @listenai/eaw-skill-logic-analyzer \
  listenai-logic-analyzer-install-codex ~/.codex/skills
```

Claude Code skill 目录：

```bash
npm exec --package @listenai/eaw-skill-logic-analyzer -- \
  listenai-logic-analyzer-install-claude ~/.claude/skills

pnpm dlx --package @listenai/eaw-skill-logic-analyzer \
  listenai-logic-analyzer-install-claude ~/.claude/skills

yarn dlx @listenai/eaw-skill-logic-analyzer \
  listenai-logic-analyzer-install-claude ~/.claude/skills
```

installer 会在目标目录下创建：

```text
logic-analyzer/
  SKILL.md
  README.md
```

复制出来的文件应该和你执行的 package 版本中的 `SKILL.md`、`README.md` 内容一致。

## 其他安装方式

如果你经常个人使用，可以全局安装：

```bash
npm install -g @listenai/eaw-skill-logic-analyzer
listenai-logic-analyzer-install-codex ~/.codex/skills
```

如果团队项目希望用 lockfile 固定 skill 版本，可以把 package 加为 dev dependency，并在项目脚本里包装 installer：

```bash
npm install --save-dev @listenai/eaw-skill-logic-analyzer
npm exec listenai-logic-analyzer-install-codex ./.codex/skills
```

## GSD/pi 风格 agent 目录

一些 GSD/pi 环境会从当前项目的 `.agents/skills` 或用户级 agent skill 目录发现 skills。如果 skill loader 报 `logic-analyzer/SKILL.md` 缺失，就需要把 package-owned assets 安装或镜像到 loader 实际扫描的目录。

项目本地布局应类似：

```text
.agents/skills/logic-analyzer/
  SKILL.md
  README.md
```

这些文件应由 package assets 生成，不要手动长期维护。如果某个 host 需要定制 guidance，把定制内容另行记录，方便未来 package 升级时合并。

## 什么时候调用这个 skill

当任务是下面这些类型时，让 agent 使用 `logic-analyzer`：

- 分析调用方提供的离线 logic-capture artifact；
- 对离线 artifact 执行可选 dsview protocol decode；
- 从 host 调用打包后的 generic logic-analyzer entrypoint；
- 通过 resource-manager 执行 live DSLogic capture；
- 汇报结果时保留结构化 failure phases 和 cleanup diagnostics。

不要把这个 skill 当成 live hardware authority。inventory、allocation、lease、device readiness、live capture 和 DSLogic `dsview-cli` runtime diagnostics 仍然由 resource-manager 负责。

## agent 加载 skill 后应该怎么做

这个 skill 应该把 agent 引向下面的 runtime contract：

```ts
import {
  createLogicAnalyzerSkill,
  inspectDsviewDecoder,
  runGenericLogicAnalyzer
} from "@listenai/eaw-skill-logic-analyzer";
import { HttpResourceManager } from "@listenai/eaw-resource-client";

const resourceManager = new HttpResourceManager("http://127.0.0.1:7600");
const result = await runGenericLogicAnalyzer(resourceManager, request, options);

if (result.ok) {
  const sessions = createLogicAnalyzerSkill(resourceManager);
  await sessions.endSession({
    sessionId: result.session.sessionId,
    deviceId: result.session.deviceId,
    ownerSkillId: result.session.ownerSkillId,
    endedAt: new Date().toISOString()
  });
} else {
  console.error(result.phase, result);
}
```

重要行为是：

- 从 `@listenai/eaw-skill-logic-analyzer` import，不要 import 内部模块；
- 传入一个嵌套 request object，不要把字段拍平成 host 私有 schema；
- 先看 `result.ok`，失败时再看 `result.phase`；
- 保留 nested diagnostics，不要改写成只有 prose 的错误摘要；
- live session 成功后，如果设备应该回到 `free`，显式 end session。

## Connected protocol-log capture and decode

当用户要求从已连接的 DSLogic 设备获取 live decoded UART、I2C、SPI 或类似 protocol log 时，使用 connected protocol-log mode。resource-manager 负责 allocation、ready-session validation、live capture 和 connected decoder execution。host 应使用 `@listenai/eaw-resource-client` 的 `HttpResourceManager`，而不是直接的 capture command。

connected flow 是：

1. 为设备启动或接收一个 typed resource-manager session。
2. 调用 `resourceManager.listDecoderCapabilities({ deviceId, requestedAt, timeoutMs })`；如果 resource-manager 不可用、response malformed，或缺少请求的 decoder（例如 `1:uart`），就 fail closed。
3. 调用 `resourceManager.captureDecode({ session, requestedAt, timeoutMs, captureTuning, decode })`，它对应 `POST /capture/decode`。
4. 先判断 `decodeResult.ok`。失败时保留 `diagnostics.phase`、`kind`、`message`、`session`、backend identity、artifact summary、decode summary、stream summaries 和 inventory diagnostics。
5. 只有在 typed `ok: true` 分支之后，才写出用户可见的 decoded `rows` 或 `annotations`。

connected protocol-log workflow 不应绕过 resource-manager 使用直接 capture command。direct package decode 仍然只适用于 offline artifact：只有调用方已经提供 existing artifact 后，才可以使用 `inspectDsviewDecoder`、`runDsviewDecoder` 和 `dsview-cli decode run`。

## agent 应保留的 request modes

### 离线 artifact mode

当调用方已经有 capture artifact 时，使用 artifact mode。request 提供 `session`、`artifact` 和 `cleanup`。可选的 `decode` section 会增加 protocol decode，但不会替代 waveform analysis。

### Live mode

当 host 应该分配 DSLogic 设备并通过 resource-manager capture 时，使用 live mode。request 提供 `session`、`capture` 和 `cleanup`。

只有在 resource-manager 已经运行，并且目标设备能通过 inventory 显示为 ready 或给出明确 diagnostics 时，才使用这个模式。

## Decoder discovery 与 decode

当请求 protocol decode 时，agent 不应该编造 decoder metadata。应使用 package-root discovery helpers：

```ts
const decoder = await inspectDsviewDecoder("1:i2c", {
  decodeRuntimePath: "/opt/dsview/lib/libdsview_decode_runtime.so",
  decoderDir: "/opt/dsview/decoders"
});
```

然后把 inspect 得到的 decoder metadata 放进可选 `decode` request，并注入 execFile-style command runner 来执行 `dsview-cli decode run`。

Decode failure 应该保持结构化：

- `decode-validation` 表示 CLI 执行前 request shape、decoder id、channel mapping、options、artifact payload 或 runner setup 不合法；
- `decode-run` 表示命令已经执行或尝试执行，但失败、超时、返回 CLI error payload，或输出格式不合法。

## Live capture 前置条件

live DSLogic capture 前，请先把 resource-manager 安装为用户级/全局工具，并启动受管理的 daemon：

```bash
npm install -g @listenai/eaw-resource-manager

resource-manager start --daemon --host 127.0.0.1 --port 7600
resource-manager status --json
resource-manager stop
```

这个 daemon 是机器/用户级硬件权威边界，不是项目依赖。默认状态和日志位于 `~/.listenai/resource-manager/`，`status --json` 是 agent 自动化应使用的状态面。

让 agent capture 前，先检查运行时状态：

```bash
curl http://127.0.0.1:7600/health
curl http://127.0.0.1:7600/inventory
curl http://127.0.0.1:7600/dashboard-snapshot
```

当前支持声明是刻意收窄的：macOS + `dsview-cli` + 经典 DSLogic Plus 路径是 live-proven。Linux 和 Windows 在后续 milestone 证明 live 前，仍然是 readiness-modeled。

## 贡献者源码工作流

只有在开发这个仓库时，才使用源码 workspace 命令：

```bash
pnpm install --frozen-lockfile
pnpm --filter @listenai/eaw-skill-logic-analyzer build
pnpm --filter @listenai/eaw-skill-logic-analyzer test
```

不要在 host-facing docs 中把源码命令作为默认用户路径。

## 验证 package 和文档

修改 skill package 或这份 guide 后，运行最终 M005 S04 acceptance check：

```bash
pnpm run verify:m005:s04
```

`verify:m005:s04` 覆盖 connected UART-log parser、integration、resource-manager route、package guidance 和 wording guards。S04 proof level: fixture/integration acceptance for connected resource-manager capture/decode; it does not claim real DSLogic hardware capture/decode until that hardware run is completed separately.

如果要检查更完整的 DSLogic 支持说明，运行：

```bash
pnpm run verify:m010:s05
```

## Troubleshooting

| 现象 | 可能原因 | 处理方式 |
| --- | --- | --- |
| 找不到 package | `@listenai` registry scope 未配置或未认证 | 配置 `@listenai` 使用 `https://registry-lpm.listenai.com`，并检查环境中的 auth |
| agent 说 `logic-analyzer` 不可用 | skill assets 没有安装到该 agent 扫描的目录 | 运行对应 installer，或把 package-owned assets 镜像到扫描目录 |
| agent deep-import package internals | host guidance 过期，或 skill 没有被加载 | 重新加载 `logic-analyzer` skill，并保持 imports 来自 `@listenai/eaw-skill-logic-analyzer` |
| live capture 在 allocation 或 readiness 阶段失败 | resource-manager 发现设备不可用、不支持或 degraded | 查看 `/inventory`，并保留返回的 diagnostics |
| decode 在命令执行前失败 | 可选 decode request 和 inspected decoder metadata 不匹配 | 查看 `decode-validation` issues，修正 decoder id、channel mappings、options、artifact payload 或 runner setup |
| decode 在命令执行后失败 | `dsview-cli decode run` 失败或返回 malformed output | 查看 `decode-run` command diagnostics、stdout/stderr preview、exit code、signal、native code 和 cleanup result |

## Reader checklist

把 skill 视为安装完成前，确认：

- agent skill 目录下存在 `logic-analyzer/SKILL.md` 和 `logic-analyzer/README.md`；
- 这些文件来自你想使用的 package 版本的 package-owned assets；
- agent 能按 `logic-analyzer` 名称加载 skill；
- host code 只从 `@listenai/eaw-skill-logic-analyzer` import；
- live workflow 通过 resource-manager allocation 和 capture；
- 成功的 live session 会在设备需要释放时显式 end。
