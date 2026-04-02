---
name: logic-analyzer
description: Canonical host guidance for running the packaged logic-analyzer skill from @listenai/skill-logic-analyzer with the package-root request/result contract.
---

<objective>
Help the host invoke the canonical logic-analyzer package through <code>@listenai/skill-logic-analyzer</code>, keep the packaged request shape intact, and preserve phase-aware diagnostics plus explicit cleanup behavior.
</objective>

<canonical_source>
This file and this package's <code>README.md</code> are the authoritative host-facing assets for <code>logic-analyzer</code>.

If you are working inside the monorepo, treat the package-owned documentation and exports as the source of truth.
</canonical_source>

<when_to_use>
Use this skill when the task is to analyze either a caller-supplied offline logic-capture artifact or a live DSLogic capture with the packaged one-shot entrypoint, then return structured waveform facts plus phase-aware failures.
</when_to_use>

<required_surface>
Import from <code>@listenai/skill-logic-analyzer</code> only.

Preferred exports:
- <code>createGenericLogicAnalyzerSkill</code> when the host will reuse a configured skill instance.
- <code>runGenericLogicAnalyzer</code> when a one-shot call is simpler.
- Related request/result types from the same package-root surface when the host needs stronger typing.

Do not deep-import internal modules from host code.
</required_surface>

<asset_lookup>
If a host or installer needs the shipped guidance files, read this package's <code>package.json</code> metadata under <code>listenai.skillAssets</code> and resolve the returned paths inside the package root.

Current canonical keys:
- <code>skillDescriptor</code> -> <code>./SKILL.md</code>
- <code>readme</code> -> <code>./README.md</code>
</asset_lookup>

<request_shape>
Send one object in one of two modes:
- <code>mode?: "artifact"</code>: existing offline callers provide <code>session</code>, <code>artifact</code>, and <code>cleanup</code>.
- <code>mode: "live"</code>: live callers provide <code>session</code>, <code>capture</code>, and <code>cleanup</code>.

The nested sections stay the same:
- <code>session</code>: the start-session request payload.
- <code>artifact</code>: the offline capture artifact payload.
- <code>capture</code>: live capture timing inputs, currently <code>requestedAt</code> and optional <code>timeoutMs</code>.
- <code>cleanup</code>: currently requires <code>endedAt</code> for post-allocation cleanup attempts.

Keep the nested contracts intact. Do not flatten session, artifact, capture, or cleanup fields into a new host-specific schema.
</request_shape>

<execution_flow>
1. Validate the top-level packaged request.
2. Start a logic-analyzer session through the existing session seam.
3. Either load the supplied offline artifact or run live capture through the shared manager/client seam.
4. Analyze the normalized capture through the waveform-analyzer seam.
5. If a failure happens after allocation, surface the cleanup attempt and cleanup result instead of hiding it.
</execution_flow>

<result_handling>
Branch first on <code>ok</code> and then on <code>phase</code>.

Successful result:
- <code>ok: true</code>
- <code>phase: "completed"</code>
- Includes the allocated session, normalized capture metadata, waveform analysis output, and <code>captureSession</code> details for live runs.

After a successful packaged run, keep using the package-root surface for cleanup: the device stays allocated until the host explicitly calls <code>endSession(...)</code> with the returned session details.

Failure result:
- <code>phase: "request-validation"</code> exposes top-level request issues before allocation.
- <code>phase: "start-session"</code> preserves the nested session-start failure payload.
- <code>phase: "live-capture"</code> preserves live request validation, runtime timeout/failure, or malformed live artifact details plus the visible cleanup outcome.
- <code>phase: "load-capture"</code> preserves the nested loader failure payload and the visible cleanup outcome.

Treat nested payloads as authoritative diagnostics. Do not replace them with a new summarized reason string. If the HTTP transport returns malformed payloads, let the transport/parser error surface instead of fabricating a typed packaged runner failure.
</result_handling>

<host_support>
Use the package README's DSLogic support matrix as the operator-facing truth.

Support summary:
- macOS + `sigrok-cli`: `live-proven` in M010 when backend readiness is `ready`, the classic DSLogic device is `ready`, and the packaged acceptance seam still passes.
- Linux: `readiness-modeled`; treat `backend-missing-runtime`, `backend-runtime-timeout`, `backend-runtime-malformed-response`, `backend-unsupported-os`, `device-unsupported-variant`, and `device-runtime-malformed-response` as truthful operator diagnostics instead of implied live support.
- Windows: `readiness-modeled`; treat `backend-missing-runtime`, `backend-runtime-timeout`, `backend-runtime-malformed-response`, `backend-unsupported-os`, `device-unsupported-variant`, and `device-runtime-malformed-response` as truthful operator diagnostics instead of implied live support.

Keep the shared contract vocabulary intact:
- device readiness: <code>ready</code>, <code>degraded</code>, <code>unsupported</code>
- backend readiness: <code>ready</code>, <code>degraded</code>, <code>missing</code>, <code>unsupported</code>
</host_support>

<host_instructions>
- Read this package's <code>README.md</code> for host-neutral examples, Codex and Claude install destinations, adaptation notes, and the current verification commands.
- For Codex installation, use the package-owned CLI <code>listenai-logic-analyzer-install-codex &lt;codex-skills-directory&gt;</code> and target either <code>~/.codex/skills</code> or <code>.codex/skills</code>; the installed skill lives at <code>logic-analyzer/</code> under that directory and contains this package-owned <code>SKILL.md</code> plus <code>README.md</code>.
- For Claude Code installation, use the package-owned CLI <code>listenai-logic-analyzer-install-claude &lt;claude-skills-directory&gt;</code> and target either <code>~/.claude/skills</code> or <code>.claude/skills</code>; the installed skill lives at <code>logic-analyzer/</code> under that directory and contains this package-owned <code>SKILL.md</code> plus <code>README.md</code>.
- Keep repo-local callers on the package-owned import path so docs and runtime entrypoints stay canonical.
- When verifying the packaged live/offline contract and the host support story, prefer <code>bash scripts/verify-m010-s05.sh</code> or <code>pnpm run verify:m010:s05</code>; the focused S05 checks are the package generic-skill test, the DSLogic provider regression test, and the README/SKILL support-matrix grep.
- Keep user-visible reporting aligned with the returned structured payloads.
- Preserve cleanup diagnostics when reporting post-allocation failures.
- After a successful packaged run, explicitly call <code>endSession(...)</code> through the package-root surface when the host wants to return the device to <code>free</code>.
</host_instructions>

<success_criteria>
The host uses the package-root exports from <code>@listenai/skill-logic-analyzer</code>, passes the nested packaged request shape unchanged, returns either the completed waveform result or the phase-aware failure object with cleanup visibility intact, and explicitly ends successful sessions when the device should be released.
</success_criteria>
