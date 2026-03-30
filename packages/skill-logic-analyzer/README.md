# @listenai/skill-logic-analyzer

This package is the canonical home of the logic-analyzer host assets and runtime surface. Hosts should consume the package-root exports from `@listenai/skill-logic-analyzer` and resolve the shipped docs through this package's metadata contract instead of treating the monorepo root as the source of truth.

If you are browsing the repository, treat `skills/logic-analyzer/` and the repo-root `src/index.ts` barrel as compatibility surfaces only. They exist so older repo-local entrypoints keep working, but new host integrations should start here.

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

For example, the personal destination becomes `~/.codex/skills/logic-analyzer/`, and the project-local destination becomes `.codex/skills/logic-analyzer/`.

Do not copy files from `skills/logic-analyzer/` when preparing Codex skill directories. That repo-root mirror is a secondary compatibility surface; the installer copies from this package's own `SKILL.md` and `README.md` files.

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

The repo-root compatibility barrel is only a shim for monorepo consumers. Do not use it as the main host-facing import path.

## Runtime surface

Use one of these exports from the package root:

- `createGenericLogicAnalyzerSkill(resourceManager, options?)`
- `runGenericLogicAnalyzer(resourceManager, request, options?)`
- `createLogicAnalyzerSkill(resourceManager, options?)`
- request/result types from the same package-root surface

Do not deep-import internal modules from host code.

## Request shape

Send a single packaged request object:

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

Keep the nested `session`, `artifact`, and `cleanup` contracts intact. Do not flatten them into a host-specific schema.

## Result handling

Branch first on `ok` and then on `phase`.

Successful result:

- `ok: true`
- `phase: "completed"`
- Includes the allocated session, normalized capture metadata, and waveform analysis output

Failure phases:

- `request-validation` - top-level packaged request is malformed; no allocation was attempted
- `start-session` - the session seam rejected the request or allocation failed
- `load-capture` - the capture-loader seam rejected the artifact or found it incompatible with the allocated session

Treat nested payloads as authoritative diagnostics. Do not replace them with new prose-only error summaries.

## Explicit cleanup after success

A successful packaged run does not automatically release the device. When the host is done consuming `result.analysis`, explicitly end the session through the package-root surface to return the device to `free`.

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

## Compatibility note for repo consumers

The monorepo root still exposes `src/index.ts` as a thin compatibility barrel that re-exports `@listenai/skill-logic-analyzer`. Keep that path available for older repo-local callers, but document and teach the package import path first so later installer work copies the package-owned contract rather than the repository layout.

## Verification

Use the layered gates when validating the shipped template boundary:

```bash
bash scripts/verify-m004-s04.sh
pnpm run verify:s04
```

The S04 gate reruns the lower S02 and S03 installer gates first, then executes the focused CLI assembly proof in `src/host-skill-install-cli.test.ts`. That top-layer proof keeps the documented usage text, success output, and host-specific failure diagnostics aligned with the shipped Claude and Codex entrypoints.

For package-focused development inside this workspace, the narrower checks still exist:

```bash
pnpm --filter @listenai/skill-logic-analyzer test -- --run src/package-asset-contract.test.ts src/generic-skill.test.ts src/host-skill-install-cli.test.ts
pnpm --filter @listenai/skill-logic-analyzer typecheck
```
