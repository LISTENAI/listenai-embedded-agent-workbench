# @listenai/eaw-skill-logic-analyzer

This package is the canonical home of the logic-analyzer host assets and runtime surface. Hosts should consume the package-root exports from `@listenai/eaw-skill-logic-analyzer` and resolve the shipped docs through this package's metadata contract instead of treating the monorepo root as the source of truth.

If you are browsing the repository, start with this package's `README.md` and `SKILL.md`. New host integrations should document and import the package-owned surface directly.

## Canonical package-owned asset contract

The package publishes a machine-stable lookup contract in `package.json` under `listenai.skillAssets`:

- `skillDescriptor` -> `./SKILL.md`
- `readme` -> `./README.md`

Consumers that need to copy or inspect host-facing assets should read those package-relative paths from `package.json`, then resolve them within the package root. Paths that leave the package root are invalid.

## Private registry setup

`@listenai` packages are expected to resolve from the ListenAI private registry:

```text
https://registry-lpm.listenai.com
```

Configure the `@listenai` scope in npm, pnpm, yarn, or CI before installing. Do not commit auth tokens to the repository.

## Codex install and export

The package ships a Codex-oriented installer CLI through the published bin. The recommended user path is one-shot execution from the registry:

```bash
npm exec --package @listenai/eaw-skill-logic-analyzer -- \
  listenai-logic-analyzer-install-codex ~/.codex/skills

pnpm dlx --package @listenai/eaw-skill-logic-analyzer \
  listenai-logic-analyzer-install-codex ~/.codex/skills

yarn dlx @listenai/eaw-skill-logic-analyzer \
  listenai-logic-analyzer-install-codex ~/.codex/skills
```

If the package is installed globally or as a project dependency, run the bin directly:

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

Claude Code uses the package-owned installer CLI and the same package asset contract. The recommended user path is one-shot execution from the registry:

```bash
npm exec --package @listenai/eaw-skill-logic-analyzer -- \
  listenai-logic-analyzer-install-claude ~/.claude/skills

pnpm dlx --package @listenai/eaw-skill-logic-analyzer \
  listenai-logic-analyzer-install-claude ~/.claude/skills

yarn dlx @listenai/eaw-skill-logic-analyzer \
  listenai-logic-analyzer-install-claude ~/.claude/skills
```

If the package is installed globally or as a project dependency, run the bin directly:

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
  inspectDsviewDecoder,
  runDsviewDecoder,
  runGenericLogicAnalyzer,
  type DsviewDecoderDetails,
  type DsviewDecoderRunResult,
  type GenericLogicAnalyzerRequest,
  type GenericLogicAnalyzerResult
} from "@listenai/eaw-skill-logic-analyzer";
```

Do not add a repo-root re-export or deep-import internal modules; use the package root as the main host-facing import path.

## Runtime surface

Use one of these exports from the package root:

- `createGenericLogicAnalyzerSkill(resourceManager, options?)`
- `runGenericLogicAnalyzer(resourceManager, request, options?)`
- `createLogicAnalyzerSkill(resourceManager, options?)`
- `listDsviewDecoders(options?)` and `inspectDsviewDecoder(decoderId, options?)`
- `runDsviewDecoder(request, options)`
- request/result types from the same package-root surface

Do not deep-import internal modules from host code.

## Connected protocol-log capture+decode through resource-manager

Use this path when the user asks for a connected protocol log, such as "capture and decode UART from the attached DSLogic device." Resource-manager owns the ready-device/session check, the live capture, and the decoder runtime. The host should use the package-facing HTTP client from `@listenai/eaw-resource-client`, not direct `dsview-cli capture`, for connected capture+decode.

The HTTP route behind this client call is `POST /capture/decode`. Hosts should keep the returned `phase`, `kind`, `message`, `session`, backend identity, artifact summary, and decode summary intact when surfacing failures.

Host bootstrap rules for connected protocol logs:

1. Probe the packaged daemon first, normally `http://127.0.0.1:7600/health`.
2. If it is not healthy, start only the packaged CLI: `eaw-resource-manager start --daemon --host 127.0.0.1 --port 7600 --json`.
3. If `eaw-resource-manager` is missing or startup fails, fail closed with that diagnostic and the global install command.
4. Never search parent directories for a source checkout. Do not run `../listenai_agent_skills`, `packages/resource-manager/dist/cli.js`, `src/cli.ts`, or `pnpm --filter @listenai/eaw-resource-manager` from an installed host project.

```ts
import { HttpResourceManager } from "@listenai/eaw-resource-client";
import { createLogicAnalyzerSkill } from "@listenai/eaw-skill-logic-analyzer";

const resourceManager = new HttpResourceManager("http://127.0.0.1:7600");
const sessionSkill = createLogicAnalyzerSkill(resourceManager, {
  createSessionId: () => `logic-analyzer-${Date.now()}`
});

const requestedAt = new Date().toISOString();
const requestedDecoderId = "1:uart";
const startResult = await sessionSkill.startSession({
  deviceId: "logic-1",
  ownerSkillId: "logic-analyzer",
  requestedAt,
  sampling: {
    sampleRateHz: 1_000_000,
    captureDurationMs: 10,
    channels: [{ channelId: "D0", label: "UART RX" }]
  },
  analysis: {
    focusChannelIds: ["D0"],
    edgePolicy: "all",
    includePulseWidths: true,
    timeReference: "capture-start"
  }
});

if (!startResult.ok) {
  throw new Error(`No ready resource-manager session: ${startResult.reason}`);
}

const capabilitiesResult = await resourceManager.listDecoderCapabilities({
  deviceId: startResult.session.deviceId,
  requestedAt,
  timeoutMs: 1500
});

if (!capabilitiesResult.ok) {
  throw new Error(
    `Decoder capabilities failed during ${capabilitiesResult.diagnostics.phase}: ${capabilitiesResult.message}`
  );
}

const uartCapability = capabilitiesResult.decoders.find(
  (decoder) => decoder.decoderId === requestedDecoderId
);

if (!uartCapability) {
  throw new Error(
    `Decoder ${requestedDecoderId} is unavailable; available decoders: ${capabilitiesResult.decoders
      .map((decoder) => decoder.decoderId)
      .join(", ")}`
  );
}

const decodeResult = await resourceManager.captureDecode({
  session: startResult.session,
  requestedAt,
  timeoutMs: 30_000,
  captureTuning: {
    operation: "stream",
    channel: "use-16-channels-max-20mhz",
    filter: "none",
    threshold: "1.0"
  },
  decode: {
    decoderId: requestedDecoderId,
    channelMappings: { rxtx: "D0" },
    decoderOptions: { baudrate: 921600, num_stop_bits: 1.0 }
  }
});

if (!decodeResult.ok) {
  const phase = decodeResult.diagnostics.phase;

  throw new Error(
    `captureDecode failed during ${phase} (${decodeResult.kind}): ${decodeResult.message}`
  );
}

const hostOutput = {
  decoderId: decodeResult.decode.decoderId,
  text: decodeResult.decode.raw.text,
  bytes: decodeResult.decode.raw.bytes,
  rows: decodeResult.decode.rows,
  annotations: decodeResult.decode.annotations,
  artifact: decodeResult.artifactSummary,
  auxiliaryArtifacts: decodeResult.auxiliaryArtifactSummaries ?? []
};
```

Fail closed when resource-manager is unavailable, the device/session is not ready, the requested decoder capability is missing, or `captureDecode()` returns `ok: false`. Malformed HTTP payloads should remain transport/parser errors from `HttpResourceManager` rather than being rewritten into a successful host output. Only write user-visible decoded output after the typed `ok: true` branch; prefer `decode.raw.text` / `decode.raw.bytes`, and use rows or annotations only as secondary structured context.

## Offline artifact decode through the skill package

Use this path when the user supplies an existing capture artifact, fixture, or saved DSView/VCD file. Offline artifact mode keeps existing callers working and may omit `mode` or set `mode: "artifact"` explicitly:

```ts
import {
  runGenericLogicAnalyzer,
  type DsviewDecodeCommandRunner,
  type DsviewDecoderDetails,
  type GenericLogicAnalyzerRequest,
  type GenericLogicAnalyzerResult
} from "@listenai/eaw-skill-logic-analyzer";

declare const inspectedI2cDecoder: DsviewDecoderDetails;
declare const dsviewDecodeCommandRunner: DsviewDecodeCommandRunner;

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
  decode: {
    decoderId: "1:i2c",
    decoder: inspectedI2cDecoder,
    channelMappings: {
      scl: "D0",
      sda: "D1"
    },
    decoderOptions: {
      address_format: "'unshifted'"
    }
  },
  cleanup: {
    endedAt: "2026-03-26T00:02:00.000Z"
  }
};

const result: GenericLogicAnalyzerResult = await runGenericLogicAnalyzer(
  resourceManager,
  request,
  {
    decodeRunnerOptions: {
      executeCommand: dsviewDecodeCommandRunner,
      decodeRuntimePath: "/opt/dsview/lib/libdsview_decode_runtime.so",
      decoderDir: "/opt/dsview/decoders"
    }
  }
);
```

The `decode` section is optional and is currently an offline, fixture-backed contract: callers provide a raw or text artifact plus already-inspected decoder metadata, then inject the `dsview-cli` command runner used by the skill-owned decode seam. Omit `decode` to keep the baseline waveform-only behavior.

Do not use protocol decode as a replacement for waveform analysis. Decode output is additive: successful offline decode results still include the normalized capture and waveform `analysis`, then add a `decode` report with annotations, rows, command diagnostics, artifact summary, and temp cleanup status. Resource-manager remains the live capture authority; protocol decode does not allocate hardware or supersede the live `captureSession` path.

Live waveform mode starts a session, captures a waveform through the shared manager/client seam, and returns the nested `captureSession` payload on success. Use `HttpResourceManager.captureDecode()` instead when the user requested connected protocol-log capture+decode:

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

Keep the nested `session`, `artifact`, optional `decode`, `capture`, and `cleanup` contracts intact. Do not flatten them into a host-specific schema.

## Result handling

Branch first on `ok` and then on `phase`.

Successful result:

- `ok: true`
- `phase: "completed"`
- Includes the allocated session, normalized capture metadata, waveform analysis output, and `captureSession` details for live runs
- Includes `decode` only when an offline request supplied the optional decode section and `dsview-cli decode run` succeeded

Failure phases:

- `request-validation` - top-level packaged request is malformed; no allocation was attempted
- `start-session` - the session seam rejected the request or allocation failed
- `live-capture` - live capture request validation, runtime failure, or malformed live artifact after allocation
- `load-capture` - the capture-loader seam rejected the offline artifact or the live artifact loaded from `captureSession`
- `decode-validation` - inspected decoder metadata rejected the requested decoder id, channel mappings, options, artifact payload, or missing decode runner
- `decode-run` - `dsview-cli decode run` failed, timed out, returned a CLI error payload, or produced malformed decode output

Treat nested payloads as authoritative diagnostics. Do not replace them with new prose-only error summaries. For decode failures, branch on `result.phase` and inspect `result.decode.reason`, `code`, `message`, `detail`, `issues`, `artifact`, `command`, and `cleanup`; `command` includes command, args, stdout/stderr, exit code, signal, and native code when the CLI was invoked. Malformed HTTP transport payloads from `HttpResourceManager` should still surface as thrown transport/parser errors instead of being rewritten into fake typed runner failures.

## Explicit cleanup after success

A successful packaged run does not automatically release the device. When the host is done consuming `result.analysis`, explicitly end the session through the package-root surface to return the device to `free`.

This matters most for live runs: the packaged one-shot entrypoint leaves the lease allocated on success so hosts can inspect the returned session and choose when cleanup happens.

```ts
import {
  createLogicAnalyzerSkill,
  runGenericLogicAnalyzer
} from "@listenai/eaw-skill-logic-analyzer";

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

The packaged live DSLogic path is live-proven in M010 only on the macOS host path where `dsview-cli` is present and the classic DSLogic Plus probe resolves as ready. Linux and Windows remain readiness-modeled future paths: they reuse the same shared readiness vocabulary and diagnostics, but this package does not claim them as equally live-proven capture hosts yet.

| Host platform | Backend expectation | Shared readiness labels | Proof status | What operators should inspect |
| --- | --- | --- | --- | --- |
| macOS | `dsview-cli` is available and the classic DSLogic Plus probe resolves cleanly as the supported device path | backend `ready`, classic DSLogic Plus `ready` | `live-proven` | In the source repository, run the M010 S05 gate before broadening the support claim; in installed host projects, inspect `backendReadiness[]`, device `readiness`, and returned diagnostics. |
| Linux | `dsview-cli` readiness may still surface truthful diagnostics, but the packaged M010 operator path is not yet live-proven there | backend can remain `missing`, `degraded`, or `unsupported`; devices stay non-allocatable until the host path is proven | `readiness-modeled` | Treat `backend-missing-runtime`, `backend-runtime-timeout`, `backend-runtime-malformed-response`, `backend-unsupported-os`, `device-unsupported-variant`, and `device-runtime-malformed-response` as the current operator truth instead of assuming capture readiness. |
| Windows | `dsview-cli` readiness may still surface truthful diagnostics, but the packaged M010 operator path is not yet live-proven there | backend can remain `missing`, `degraded`, or `unsupported`; devices stay non-allocatable until the host path is proven | `readiness-modeled` | Treat `backend-missing-runtime`, `backend-runtime-timeout`, `backend-runtime-malformed-response`, `backend-unsupported-os`, `device-unsupported-variant`, and `device-runtime-malformed-response` as the current operator truth instead of assuming capture readiness. |

Keep the typed vocabulary from `@listenai/eaw-contracts` intact: device readiness is `ready`, `degraded`, or `unsupported`; backend readiness is `ready`, `degraded`, `missing`, or `unsupported`. Hosts should preserve those values in logs, browser surfaces, and operator docs instead of rewriting them into softer install-success language.

## Maintainer verification

The commands in this section are maintainer-only checks for an intentional checkout of the source repository. Installed host projects must not search for a sibling monorepo or run these commands as a fallback; connected host work should use the packaged `eaw-resource-manager` daemon described above.

For source-repository verification, maintainers should run the repository's M005 S04 and M010 S05 gates from the monorepo root after intentionally checking it out. These checks are not host instructions and are intentionally omitted from the installed skill guidance to prevent agents from discovering and executing sibling source trees.

S04 proof level: fixture/integration acceptance for connected resource-manager capture/decode; it does not claim real DSLogic hardware capture/decode until that hardware run is completed separately. The M010 S05 acceptance seam is the intended operator-facing check for the packaged macOS `dsview-cli` live proof plus the DSLogic support-matrix assertions.
