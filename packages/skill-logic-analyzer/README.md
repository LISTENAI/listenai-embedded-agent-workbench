# @listenai/skill-logic-analyzer

This package is the canonical home of the logic-analyzer host assets and runtime surface. Hosts should consume the package-root exports from `@listenai/skill-logic-analyzer` and resolve the shipped docs through this package's metadata contract instead of treating the monorepo root as the source of truth.

If you are browsing the repository, start with this package's `README.md` and `SKILL.md`. New host integrations should document and import the package-owned surface directly.

## Canonical package-owned asset contract

The package publishes a machine-stable lookup contract in `package.json` under `listenai.skillAssets`:

- `skillDescriptor` -> `./SKILL.md`
- `readme` -> `./README.md`

Consumers that need to copy or inspect host-facing assets should read those package-relative paths from `package.json`, then resolve them within the package root. Paths that leave the package root are invalid.

## Codex install and export

The package ships a Codex-oriented installer CLI through the published bin:

```bash
listenai-logic-analyzer-install-codex <codex-skills-directory>
```

Use the command with the Codex skills directory you want to populate:

- Personal install: `listenai-logic-analyzer-install-codex ~/.codex/skills`
- Project install: `listenai-logic-analyzer-install-codex ./.codex/skills`

The installer creates a package-owned `logic-analyzer/` skill directory under the target path and copies the canonical package assets into it:

```text
<codex-skills-directory>/logic-analyzer/
  SKILL.md
  README.md
```

For example, the personal destination becomes `~/.codex/skills/<skill-name>/`, and the project-local destination becomes `.codex/skills/<skill-name>/`; for this package, `<skill-name>` is `logic-analyzer`.

The installed files always come from this package's own `SKILL.md` and `README.md`, so package consumers should validate or customize the package-owned docs rather than a repo-root mirror.

## Claude Code install and export

Claude Code continues to use the package-owned installer CLI and the same package asset contract:

```bash
listenai-logic-analyzer-install-claude <claude-skills-directory>
```

- Personal install: `listenai-logic-analyzer-install-claude ~/.claude/skills`
- Project install: `listenai-logic-analyzer-install-claude ./.claude/skills`
- Installed layout: `<claude-skills-directory>/logic-analyzer/` containing `SKILL.md` and `README.md`

## Install and import

Prefer the published package surface:

```ts
import {
  createGenericLogicAnalyzerSkill,
  createLogicAnalyzerSkill,
  runGenericLogicAnalyzer,
  type GenericLogicAnalyzerRequest,
  type GenericLogicAnalyzerResult
} from "@listenai/skill-logic-analyzer";
```

Do not add a repo-root re-export or deep-import internal modules; use the package root as the main host-facing import path.

## Runtime surface

Use one of these exports from the package root:

- `createGenericLogicAnalyzerSkill(resourceManager, options?)`
- `runGenericLogicAnalyzer(resourceManager, request, options?)`
- `createLogicAnalyzerSkill(resourceManager, options?)`
- request/result types from the same package-root surface

Do not deep-import internal modules from host code.

## Request modes

Send one packaged request object in one of two modes.

Offline artifact mode keeps existing callers working and may omit `mode` or set `mode: "artifact"` explicitly:

```ts
import {
  runGenericLogicAnalyzer,
  type GenericLogicAnalyzerRequest,
  type GenericLogicAnalyzerResult
} from "@listenai/skill-logic-analyzer";

const request: GenericLogicAnalyzerRequest = {
  session: {
    deviceId: "logic-1",
    ownerSkillId: "logic-analyzer",
    requestedAt: "2026-03-26T00:01:00.000Z",
    sampling: {
      sampleRateHz: 1_000_000,
      captureDurationMs: 0.004,
      channels: [
        { channelId: "D0", label: "CLK" },
        { channelId: "D1", label: "DATA" }
      ]
    },
    analysis: {
      focusChannelIds: ["D0", "D1"],
      edgePolicy: "all",
      includePulseWidths: true,
      timeReference: "capture-start"
    }
  },
  artifact: {
    sourceName: "capture.csv",
    capturedAt: "2026-03-26T00:00:01.000Z",
    text: "Time [us],D0,D1\n0,0,1\n1,1,1\n2,1,0\n3,0,0"
  },
  cleanup: {
    endedAt: "2026-03-26T00:02:00.000Z"
  }
};

const result: GenericLogicAnalyzerResult = await runGenericLogicAnalyzer(
  resourceManager,
  request
);
```

Live mode starts a session, captures through the shared manager/client seam, and returns the nested `captureSession` payload on success:

```ts
const liveRequest: GenericLogicAnalyzerRequest = {
  mode: "live",
  session: {
    deviceId: "logic-1",
    ownerSkillId: "logic-analyzer",
    requestedAt: "2026-03-26T00:01:00.000Z",
    sampling: {
      sampleRateHz: 1_000_000,
      captureDurationMs: 0.004,
      channels: [
        { channelId: "D0", label: "CLK" },
        { channelId: "D1", label: "DATA" }
      ]
    },
    analysis: {
      focusChannelIds: ["D0", "D1"],
      edgePolicy: "all",
      includePulseWidths: true,
      timeReference: "capture-start"
    }
  },
  capture: {
    requestedAt: "2026-03-26T00:01:10.000Z",
    timeoutMs: 1500
  },
  cleanup: {
    endedAt: "2026-03-26T00:02:00.000Z"
  }
};

const liveResult = await runGenericLogicAnalyzer(resourceManager, liveRequest);
```

Keep the nested `session`, `artifact` or `capture`, and `cleanup` contracts intact. Do not flatten them into a host-specific schema.

## Result handling

Branch first on `ok` and then on `phase`.

Successful result:

- `ok: true`
- `phase: "completed"`
- Includes the allocated session, normalized capture metadata, waveform analysis output, and `captureSession` details for live runs

Failure phases:

- `request-validation` - top-level packaged request is malformed; no allocation was attempted
- `start-session` - the session seam rejected the request or allocation failed
- `live-capture` - live capture request validation, runtime failure, or malformed live artifact after allocation
- `load-capture` - the capture-loader seam rejected the offline artifact or the live artifact loaded from `captureSession`

Treat nested payloads as authoritative diagnostics. Do not replace them with new prose-only error summaries. Malformed HTTP transport payloads from `HttpResourceManager` should still surface as thrown transport/parser errors instead of being rewritten into fake typed runner failures.

## Explicit cleanup after success

A successful packaged run does not automatically release the device. When the host is done consuming `result.analysis`, explicitly end the session through the package-root surface to return the device to `free`.

This matters most for live runs: the packaged one-shot entrypoint leaves the lease allocated on success so hosts can inspect the returned session and choose when cleanup happens.

```ts
import {
  createLogicAnalyzerSkill,
  runGenericLogicAnalyzer
} from "@listenai/skill-logic-analyzer";

const result = await runGenericLogicAnalyzer(resourceManager, request);

if (result.ok) {
  const sessionSkill = createLogicAnalyzerSkill(resourceManager);

  await sessionSkill.endSession({
    sessionId: result.session.sessionId,
    deviceId: result.session.deviceId,
    ownerSkillId: result.session.ownerSkillId,
    endedAt: new Date().toISOString()
  });
}
```

## DSLogic host support matrix

The packaged live DSLogic path is live-proven in M010 only on the macOS host path where `sigrok-cli` is present, the native `libsigrok` runtime resolves behind it, and the classic DSLogic probe succeeds. Linux and Windows remain readiness-modeled future paths: they reuse the same shared readiness vocabulary and diagnostics, but this package does not claim them as equally live-proven capture hosts yet.

| Host platform | Backend expectation | Shared readiness labels | Proof status | What operators should inspect |
| --- | --- | --- | --- | --- |
| macOS | `sigrok-cli` is available and the native `libsigrok` runtime resolves cleanly for the classic DSLogic probe | backend `ready`, classic DSLogic device `ready` | `live-proven` | Run `bash scripts/verify-m010-s05.sh` or `pnpm run verify:m010:s05`, then inspect `backendReadiness[]`, device `readiness`, and returned diagnostics before broadening the support claim. |
| Linux | The native runtime may still surface truthful readiness, but the packaged M010 operator path is not yet live-proven there | backend can remain `missing`, `degraded`, or `unsupported`; devices stay non-allocatable until the host path is proven | `readiness-modeled` | Treat `backend-missing-runtime`, `backend-runtime-timeout`, `backend-runtime-malformed-response`, `backend-unsupported-os`, `device-unsupported-variant`, and `device-runtime-malformed-response` as the current operator truth instead of assuming capture readiness. |
| Windows | The native runtime may still surface truthful readiness, but the packaged M010 operator path is not yet live-proven there | backend can remain `missing`, `degraded`, or `unsupported`; devices stay non-allocatable until the host path is proven | `readiness-modeled` | Treat `backend-missing-runtime`, `backend-runtime-timeout`, `backend-runtime-malformed-response`, `backend-unsupported-os`, `device-unsupported-variant`, and `device-runtime-malformed-response` as the current operator truth instead of assuming capture readiness. |

Keep the typed vocabulary from `@listenai/contracts` intact: device readiness is `ready`, `degraded`, or `unsupported`; backend readiness is `ready`, `degraded`, `missing`, or `unsupported`. Hosts should preserve those values in logs, browser surfaces, and operator docs instead of rewriting them into softer install-success language.

## Verification

Use the M010 S05 gate when validating the packaged runtime boundary and the cross-platform DSLogic support story:

```bash
bash scripts/verify-m010-s05.sh
pnpm run verify:m010:s05
```

That acceptance seam is the intended operator-facing check for the packaged macOS `sigrok-cli` live proof plus the DSLogic support-matrix assertions. The package-specific focused checks that back the current S05 contract are:

```bash
pnpm --filter @listenai/skill-logic-analyzer exec vitest run src/generic-skill.test.ts
pnpm --filter @listenai/resource-manager exec vitest run src/dslogic/dslogic-device-provider.test.ts
rg -n "live-proven|readiness-modeled|sigrok-cli|macOS|Linux|Windows|verify:m010:s05" packages/skill-logic-analyzer/README.md packages/skill-logic-analyzer/SKILL.md
```
