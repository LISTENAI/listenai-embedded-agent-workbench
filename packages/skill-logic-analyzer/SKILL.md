---
name: logic-analyzer
description: Canonical host guidance for running the packaged logic-analyzer skill from @listenai/skill-logic-analyzer with the package-root request/result contract.
---

<objective>
Help the host invoke the canonical logic-analyzer package through <code>@listenai/skill-logic-analyzer</code>, keep the packaged request shape intact, and preserve phase-aware diagnostics plus explicit cleanup behavior.
</objective>

<canonical_source>
This file and this package's <code>README.md</code> are the authoritative host-facing assets for <code>logic-analyzer</code>.

If you encounter mirrored docs under <code>skills/logic-analyzer/</code> or the repo-root compatibility barrel in <code>src/index.ts</code>, treat them as secondary compatibility surfaces only. Update the package-owned files first.
</canonical_source>

<when_to_use>
Use this skill when the task is to analyze an offline logic-capture artifact with the packaged one-shot entrypoint and return structured waveform facts plus phase-aware failures.
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
Send one object with three nested sections:
- <code>session</code>: the start-session request payload.
- <code>artifact</code>: the offline capture artifact payload.
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

After a successful packaged run, keep using the package-root surface for cleanup: the device stays allocated until the host explicitly calls <code>endSession(...)</code> with the returned session details.

Failure result:
- <code>phase: "request-validation"</code> exposes top-level request issues before allocation.
- <code>phase: "start-session"</code> preserves the nested session-start failure payload.
- <code>phase: "load-capture"</code> preserves the nested loader failure payload and the visible cleanup outcome.

Treat nested payloads as authoritative diagnostics. Do not replace them with a new summarized reason string.
</result_handling>

<host_instructions>
- Read this package's <code>README.md</code> for host-neutral examples, Codex and Claude install destinations, adaptation notes, and the layered verification commands.
- For Codex installation, use the package-owned CLI <code>listenai-logic-analyzer-install-codex &lt;codex-skills-directory&gt;</code> and target either <code>~/.codex/skills</code> or <code>.codex/skills</code>; the installed skill lives at <code>logic-analyzer/</code> under that directory and contains this package-owned <code>SKILL.md</code> plus <code>README.md</code>.
- For Claude Code installation, use the package-owned CLI <code>listenai-logic-analyzer-install-claude &lt;claude-skills-directory&gt;</code> and target either <code>~/.claude/skills</code> or <code>.claude/skills</code>; the installed skill lives at <code>logic-analyzer/</code> under that directory and contains this package-owned <code>SKILL.md</code> plus <code>README.md</code>.
- When verifying the assembled template contract, prefer <code>bash scripts/verify-m004-s04.sh</code> or <code>pnpm run verify:s04</code>; those commands rerun the lower installer gates first, then assert the documented CLI usage, success, and failure output.
- Keep user-visible reporting aligned with the returned structured payloads.
- Preserve cleanup diagnostics when reporting post-allocation failures.
- After a successful packaged run, explicitly call <code>endSession(...)</code> through the package-root surface when the host wants to return the device to <code>free</code>.
</host_instructions>

<success_criteria>
The host uses the package-root exports from <code>@listenai/skill-logic-analyzer</code>, passes the nested packaged request shape unchanged, returns either the completed waveform result or the phase-aware failure object with cleanup visibility intact, and explicitly ends successful sessions when the device should be released.
</success_criteria>
