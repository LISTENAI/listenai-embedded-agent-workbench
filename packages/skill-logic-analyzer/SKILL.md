---
name: logic-analyzer
description: Canonical host guidance for running the packaged logic-analyzer skill from @listenai/eaw-skill-logic-analyzer with the package-root request/result contract.
---

<objective>
Help the host invoke the canonical logic-analyzer package through <code>@listenai/eaw-skill-logic-analyzer</code>, keep the packaged request shape intact, and preserve phase-aware diagnostics plus explicit cleanup behavior.
</objective>

<canonical_source>
This file and this package's <code>README.md</code> are the authoritative host-facing assets for <code>logic-analyzer</code>.

If you are working inside the monorepo, treat the package-owned documentation and exports as the source of truth.
</canonical_source>

<when_to_use>
Use this skill when the task is to analyze either a caller-supplied offline logic-capture artifact or a live DSLogic capture with the packaged one-shot entrypoint, then return structured waveform facts plus phase-aware failures.
</when_to_use>

<required_surface>
Import packaged skill runtime from <code>@listenai/eaw-skill-logic-analyzer</code> only, and import the connected resource-manager HTTP client from <code>@listenai/eaw-resource-client</code> when the host must capture and decode a connected protocol log.

Preferred skill-package exports:
- <code>createGenericLogicAnalyzerSkill</code> when the host will reuse a configured skill instance.
- <code>runGenericLogicAnalyzer</code> when a one-shot waveform or offline artifact call is simpler.
- <code>createLogicAnalyzerSkill</code> when the host needs explicit start/end session control before resource-manager capture/decode.
- <code>listDsviewDecoders</code> and <code>inspectDsviewDecoder</code> when the host needs package-root offline decoder metadata discovery.
- <code>runDsviewDecoder</code> when the host wants to call the offline artifact-only decode seam directly.
- Related request/result types from the same package-root surface when the host needs stronger typing.

Preferred resource-client export:
- <code>HttpResourceManager</code> for connected <code>listDecoderCapabilities()</code> and <code>captureDecode()</code> calls against resource-manager's <code>/capture/decode</code> route.

Do not deep-import internal modules from host code. Do not bypass resource-manager for connected live capture+decode.
</required_surface>

<asset_lookup>
If a host or installer needs the shipped guidance files, read this package's <code>package.json</code> metadata under <code>listenai.skillAssets</code> and resolve the returned paths inside the package root.

Current canonical keys:
- <code>skillDescriptor</code> -> <code>./SKILL.md</code>
- <code>readme</code> -> <code>./README.md</code>
</asset_lookup>

<request_shape>
Send one object in one of two modes:
- <code>mode?: "artifact"</code>: existing offline callers provide <code>session</code>, <code>artifact</code>, and <code>cleanup</code>. They may also provide optional <code>decode</code> with <code>decoderId</code>, already-inspected <code>decoder</code> metadata, <code>channelMappings</code>, and optional <code>decoderOptions</code>.
- <code>mode: "live"</code>: live callers provide <code>session</code>, <code>capture</code>, and <code>cleanup</code>.

The nested sections stay the same:
- <code>session</code>: the start-session request payload.
- <code>artifact</code>: the offline capture artifact payload.
- <code>decode</code>: optional offline protocol decode request; fixture-backed for this slice and additive to waveform analysis.
- <code>capture</code>: live capture timing inputs, currently <code>requestedAt</code> and optional <code>timeoutMs</code>.
- <code>cleanup</code>: currently requires <code>endedAt</code> for post-allocation cleanup attempts.

Keep the nested contracts intact. Do not flatten session, artifact, decode, capture, or cleanup fields into a new host-specific schema.
</request_shape>

<connected_protocol_log_flow>
For connected UART, I2C, SPI, or other protocol-log prompts, resource-manager owns connected capture+decode. Use <code>HttpResourceManager</code> and this sequence:

1. Create or receive a resource-manager client that points at the already-running resource-manager server.
2. Start a session through the package-root session surface, or use an existing typed session only if it is already allocated to this skill and still ready.
3. Call <code>resourceManager.listDecoderCapabilities({ deviceId, requestedAt, timeoutMs })</code> before capture. Fail closed if resource-manager is unavailable, the response is malformed, the result is <code>ok: false</code>, or the requested decoder such as <code>1:uart</code> is absent.
4. Call <code>resourceManager.captureDecode({ session, requestedAt, timeoutMs, captureTuning, decode })</code>. This is the connected protocol-log path and maps to <code>/capture/decode</code>.
5. Branch on <code>ok</code>; when false, preserve <code>diagnostics.phase</code>, <code>kind</code>, <code>message</code>, <code>session</code>, <code>providerKind</code>, <code>backendKind</code>, <code>artifactSummary</code>, <code>decode</code>, and nested diagnostics instead of replacing them with prose.
6. Write host-visible decoded output only from the <code>ok: true</code> branch, and only from <code>decode.rows</code> or <code>decode.annotations</code> plus safe artifact/decode summaries.

Never tell Codex, Claude, or a human operator to run <code>dsview-cli capture</code> for a connected protocol-log workflow. Direct package decode remains offline artifact-only: <code>runDsviewDecoder</code> and <code>dsview-cli decode run</code> may be used only after a caller supplies an existing artifact.
</connected_protocol_log_flow>

<execution_flow>
For packaged waveform/offline artifact requests:
1. Validate the top-level packaged request.
2. Start a logic-analyzer session through the existing session seam.
3. Either load the supplied offline artifact or run live waveform capture through the shared manager/client seam.
4. Analyze the normalized capture through the waveform-analyzer seam.
5. If offline <code>decode</code> is present, validate it against inspected decoder metadata and run the injected <code>dsview-cli decode run</code> seam.
6. If a failure happens after allocation, surface the cleanup attempt and cleanup result instead of hiding it.

For connected protocol-log capture+decode requests, prefer the <code>connected_protocol_log_flow</code>: <code>HttpResourceManager.listDecoderCapabilities()</code> followed by <code>HttpResourceManager.captureDecode()</code>. Protocol decode is not a replacement for resource-manager authority. Resource-manager remains responsible for hardware allocation, ready-session validation, live capture, and connected decoder execution; the package-owned direct decode seam consumes caller-provided offline artifacts and adds protocol facts without replacing waveform analysis.
</execution_flow>

<result_handling>
Branch first on <code>ok</code> and then on <code>phase</code>.

Successful result:
- <code>ok: true</code>
- <code>phase: "completed"</code>
- Includes the allocated session, normalized capture metadata, waveform analysis output, and <code>captureSession</code> details for live runs.
- Includes <code>decode</code> only for offline requests that supplied optional protocol decode and completed <code>dsview-cli decode run</code> successfully; this payload is additive and does not replace <code>analysis</code>.

After a successful packaged run, keep using the package-root surface for cleanup: the device stays allocated until the host explicitly calls <code>endSession(...)</code> with the returned session details.

Failure result:
- <code>phase: "request-validation"</code> exposes top-level request issues before allocation.
- <code>phase: "start-session"</code> preserves the nested session-start failure payload.
- <code>phase: "live-capture"</code> preserves live request validation, runtime timeout/failure, or malformed live artifact details plus the visible cleanup outcome.
- <code>phase: "load-capture"</code> preserves the nested loader failure payload and the visible cleanup outcome.
- <code>phase: "decode-validation"</code> preserves decode validation issues, artifact summary, capture, waveform analysis, and the post-allocation cleanup outcome.
- <code>phase: "decode-run"</code> preserves decode reason/code/message/detail, command/args/stdout/stderr/exit code/signal/native code, artifact summary, temp cleanup, capture, waveform analysis, and the post-allocation cleanup outcome.

Connected <code>captureDecode()</code> failure result:
- <code>ok: false</code> with <code>reason: "capture-decode-failed"</code>.
- <code>diagnostics.phase</code> identifies whether failure happened during validation, capture, decode validation, or decode runtime.
- Preserve <code>kind</code>, <code>message</code>, <code>session</code>, <code>providerKind</code>, <code>backendKind</code>, <code>backendVersion</code>, <code>artifactSummary</code>, <code>decode</code>, stream summaries, and inventory diagnostics for agent inspection.

Treat nested payloads as authoritative diagnostics. Do not replace them with a new summarized reason string. If the HTTP transport returns malformed payloads, let the transport/parser error surface instead of fabricating a typed packaged runner failure.
</result_handling>

<host_support>
Use the package README's DSLogic support matrix as the operator-facing truth.

Support summary:
- macOS + `dsview-cli`: `live-proven` in M010 when backend readiness is `ready`, the classic DSLogic Plus path is `ready`, and the packaged acceptance seam still passes.
- Linux: `readiness-modeled`; treat `backend-missing-runtime`, `backend-runtime-timeout`, `backend-runtime-malformed-response`, `backend-unsupported-os`, `device-unsupported-variant`, and `device-runtime-malformed-response` as truthful `dsview-cli` operator diagnostics instead of implied live support.
- Windows: `readiness-modeled`; treat `backend-missing-runtime`, `backend-runtime-timeout`, `backend-runtime-malformed-response`, `backend-unsupported-os`, `device-unsupported-variant`, and `device-runtime-malformed-response` as truthful `dsview-cli` operator diagnostics instead of implied live support.

Keep the shared contract vocabulary intact:
- device readiness: <code>ready</code>, <code>degraded</code>, <code>unsupported</code>
- backend readiness: <code>ready</code>, <code>degraded</code>, <code>missing</code>, <code>unsupported</code>
</host_support>

<host_instructions>
- Read this package's <code>README.md</code> for host-neutral examples, Codex and Claude install destinations, adaptation notes, and the current verification commands.
- For Codex installation, prefer registry one-shot execution: <code>npm exec --package @listenai/eaw-skill-logic-analyzer -- listenai-logic-analyzer-install-codex &lt;codex-skills-directory&gt;</code>, <code>pnpm dlx --package @listenai/eaw-skill-logic-analyzer listenai-logic-analyzer-install-codex &lt;codex-skills-directory&gt;</code>, or <code>yarn dlx @listenai/eaw-skill-logic-analyzer listenai-logic-analyzer-install-codex &lt;codex-skills-directory&gt;</code>. Target either <code>~/.codex/skills</code> or <code>.codex/skills</code>; the installed skill lives at <code>logic-analyzer/</code> under that directory and contains this package-owned <code>SKILL.md</code> plus <code>README.md</code>.
- For Claude Code installation, prefer registry one-shot execution: <code>npm exec --package @listenai/eaw-skill-logic-analyzer -- listenai-logic-analyzer-install-claude &lt;claude-skills-directory&gt;</code>, <code>pnpm dlx --package @listenai/eaw-skill-logic-analyzer listenai-logic-analyzer-install-claude &lt;claude-skills-directory&gt;</code>, or <code>yarn dlx @listenai/eaw-skill-logic-analyzer listenai-logic-analyzer-install-claude &lt;claude-skills-directory&gt;</code>. Target either <code>~/.claude/skills</code> or <code>.claude/skills</code>; the installed skill lives at <code>logic-analyzer/</code> under that directory and contains this package-owned <code>SKILL.md</code> plus <code>README.md</code>.
- Keep repo-local callers on the package-owned import path so docs and runtime entrypoints stay canonical.
- For connected protocol-log prompts, use <code>HttpResourceManager</code>, require <code>listDecoderCapabilities()</code> to expose the requested decoder such as <code>1:uart</code>, then call <code>captureDecode()</code>; fail closed when resource-manager, capability lookup, session allocation, or the typed capture/decode result is unavailable.
- Keep optional package-owned protocol decode offline and additive for this contract: hosts pass inspected decoder metadata and an injected command runner, then continue returning waveform analysis alongside any decode report.
- Keep resource-manager as the live capture authority; do not route live allocation, probe readiness, connected capture, or connected decode through direct <code>dsview-cli capture</code> guidance.
- When verifying the packaged live/offline contract and the host support story, prefer <code>bash scripts/verify-m010-s05.sh</code> or <code>pnpm run verify:m010:s05</code>; the focused S05 checks are the package generic-skill test, the DSLogic provider regression test, and the README/SKILL support-matrix grep.
- Keep user-visible reporting aligned with the returned structured payloads.
- Preserve cleanup diagnostics when reporting post-allocation failures.
- After a successful packaged run, explicitly call <code>endSession(...)</code> through the package-root surface when the host wants to return the device to <code>free</code>.
</host_instructions>

<success_criteria>
The host uses the package-root exports from <code>@listenai/eaw-skill-logic-analyzer</code> for packaged waveform/offline artifact work, uses <code>HttpResourceManager.listDecoderCapabilities()</code> and <code>HttpResourceManager.captureDecode()</code> for connected protocol-log capture+decode, passes nested contracts unchanged, returns either successful decoded rows/annotations or the phase-aware failure object with cleanup and backend visibility intact, and explicitly ends successful sessions when the device should be released.
</success_criteria>
