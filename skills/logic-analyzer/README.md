# Logic Analyzer Skill

This directory packages the repo-owned logic-analyzer entrypoint for mainstream agent hosts. The stable contract lives at the package root via `src/index.ts`; hosts should adapt to that exported surface instead of deep-importing internal modules.

## Package-root API

Use one of these exports from the package root:

- `createGenericLogicAnalyzerSkill(resourceManager, options?)`
- `runGenericLogicAnalyzer(resourceManager, request, options?)`
- `type GenericLogicAnalyzerRequest`
- `type GenericLogicAnalyzerResult`

Runtime composition is intentionally thin:

1. start a session through the existing logic-analyzer session seam
2. load the offline artifact through the existing capture-loader seam
3. analyze the normalized capture through the waveform analyzer
4. expose cleanup status if failure happens after allocation

That means the nested lower-layer payloads remain the source of truth for diagnostics.

## Request shape

Send a single packaged request object:

```ts
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
```

Notes:

- `session` is the existing start-session payload; keep its fields unchanged.
- `artifact` is the existing offline capture input; pass text or bytes plus lightweight metadata.
- `cleanup.endedAt` is used only if cleanup must run after allocation succeeds.

## Host adaptation patterns

### One-shot call

```ts
import {
  createResourceManager,
  runGenericLogicAnalyzer,
  type GenericLogicAnalyzerResult
} from "listenai-agent-skills";

const result: GenericLogicAnalyzerResult = await runGenericLogicAnalyzer(
  resourceManager,
  request
);
```

### Reusable skill instance

```ts
import { createGenericLogicAnalyzerSkill } from "listenai-agent-skills";

const skill = createGenericLogicAnalyzerSkill(resourceManager, {
  createSessionId: () => crypto.randomUUID()
});

const result = await skill.run(request);
```

If your host has its own dependency-injection or tool wrapper layer, adapt around these package-root exports rather than reimplementing session start, capture loading, or waveform analysis yourself.

## Success shape

A successful result stays explicit about what was allocated and what was analyzed:

```ts
if (result.ok) {
  result.phase;   // "completed"
  result.session; // allocation-backed session record
  result.capture; // normalized capture metadata + adapter selection
  result.analysis; // structured waveform analysis result
}
```

Use `result.analysis` as the machine-consumable output. The `session` and `capture` fields provide the context a host may need for logging, follow-up actions, or cleanup confirmation.

## Explicit cleanup after success

A successful packaged run does not automatically release the device. The returned `result.session` remains allocated so the host can inspect or chain follow-up work. When the host is done consuming `result.analysis`, explicitly end the session through the package-root surface to return the device to `free`.

```ts
import {
  createLogicAnalyzerSkill,
  runGenericLogicAnalyzer
} from "listenai-agent-skills";

const result = await runGenericLogicAnalyzer(resourceManager, request);

if (result.ok) {
  const sessionSkill = createLogicAnalyzerSkill(resourceManager);

  sessionSkill.endSession({
    sessionId: result.session.sessionId,
    deviceId: result.session.deviceId,
    ownerSkillId: result.session.ownerSkillId,
    endedAt: new Date().toISOString()
  });
}
```

This is the verified package-root lifecycle from the end-to-end proof: inventory moves from `free` to `allocated` during the successful run, then back to `free` only after the explicit `endSession(...)` call.

## Failure phases

The packaged surface uses phase-aware failures so hosts can tell which seam failed without guessing:

- `request-validation` - top-level packaged request is malformed; no allocation was attempted.
- `start-session` - the session seam rejected the request or allocation failed.
- `load-capture` - the capture-loader seam rejected the artifact or found it incompatible with the allocated session.

When `phase === "load-capture"`, the result also includes `cleanup` so the host can see whether the post-allocation release succeeded or failed.

Do not replace the nested `startSession`, `loadCapture`, or `cleanup.result` payloads with new prose-only error summaries. Those nested objects already carry the authoritative diagnostics, including validation issues, device snapshots, adapter IDs, artifact summaries, compatibility facts, and cleanup outcomes.

## Verification

Use the slice gate to prove the packaged boundary, the explicit success-path cleanup rule, and the inherited regressions:

```bash
bash scripts/verify-s06.sh
```

That command re-runs:

- `src/logic-analyzer/end-to-end.test.ts`
- `src/logic-analyzer/generic-skill.test.ts`
- `src/logic-analyzer/logic-analyzer-skill.test.ts`
- `src/logic-analyzer/capture-loader.test.ts`
- `src/logic-analyzer/waveform-analyzer.test.ts`
- `npm run typecheck`

## Files to inspect

- `src/index.ts` for the stable package-root export surface
- `src/logic-analyzer/generic-skill.test.ts` for the packaged boundary proof
- `skills/logic-analyzer/SKILL.md` for Claude-style host guidance
