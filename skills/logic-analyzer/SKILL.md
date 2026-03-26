---
name: logic-analyzer
description: Guides Claude-style hosts to run the packaged logic-analyzer skill through the package-root exports when they need one-shot session, capture loading, waveform analysis, and explicit failure reporting.
---

<objective>
Help the host invoke the repo-owned logic-analyzer capability through the stable package-root exports from <code>src/index.ts</code> instead of deep imports or runtime-specific wrappers.
</objective>

<when_to_use>
Use this skill when the task is to analyze an offline logic-capture artifact with the packaged one-shot entrypoint and return structured waveform facts plus phase-aware failures.
</when_to_use>

<required_surface>
Import from the package root only.

Preferred exports:
- <code>createGenericLogicAnalyzerSkill</code> when the host will reuse a configured skill instance.
- <code>runGenericLogicAnalyzer</code> when a one-shot call is simpler.
- Related request/result types from the same package-root surface when the host needs stronger typing.

Do not deep-import <code>src/logic-analyzer/*</code> modules from host code.
</required_surface>

<request_shape>
Send one object with three nested sections:
- <code>session</code>: the existing start-session request payload.
- <code>artifact</code>: the existing offline capture artifact payload.
- <code>cleanup</code>: currently requires <code>endedAt</code> for post-allocation cleanup attempts.

Keep the nested contracts intact. Do not flatten session, artifact, or cleanup fields into a new host-specific schema.
</request_shape>

<execution_flow>
1. Validate the top-level packaged request.
2. Start a logic-analyzer session through the existing session seam.
3. Load the capture artifact through the existing capture-loader seam.
4. Analyze the normalized capture through the waveform-analyzer seam.
5. If a failure happens after allocation, surface the cleanup attempt and cleanup result instead of hiding it.
</execution_flow>

<result_handling>
Branch first on <code>ok</code> and then on <code>phase</code>.

Successful result:
- <code>ok: true</code>
- <code>phase: "completed"</code>
- Includes the allocated session, normalized capture metadata, and waveform analysis output.

After a successful packaged run, keep using the package-root surface for cleanup: the device stays allocated until the host explicitly calls <code>endSession(...)</code> with the returned session details. This preserves the verified lifecycle from the end-to-end proof: <code>free -&gt; allocated -&gt; free</code> only after the explicit release step.

Failure result:
- <code>phase: "request-validation"</code> exposes top-level request issues before allocation.
- <code>phase: "start-session"</code> preserves the nested session-start failure payload.
- <code>phase: "load-capture"</code> preserves the nested loader failure payload and the visible cleanup outcome.

Treat nested payloads as authoritative diagnostics. Do not replace them with a new summarized reason string.
</result_handling>

<host_instructions>
- Read <code>skills/logic-analyzer/README.md</code> for host-neutral examples and adaptation notes.
- Keep user-visible reporting aligned with the returned structured payloads.
- Preserve cleanup diagnostics when reporting post-allocation failures.
- After a successful packaged run, explicitly call <code>endSession(...)</code> through the package-root surface when the host wants to return the device to <code>free</code>.
- If the host needs verification, run <code>bash scripts/verify-s06.sh</code> from the repo.
</host_instructions>

<success_criteria>
The host uses the package-root exports, passes the nested packaged request shape unchanged, returns either the completed waveform result or the phase-aware failure object with cleanup visibility intact, and explicitly ends successful sessions when the device should be released.
</success_criteria>
