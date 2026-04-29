# Use `@listenai/eaw-skill-logic-analyzer` as an agent skill

This guide is for host maintainers or agent users who want an AI coding tool to load the packaged logic-analyzer guidance as an agent skill.

After reading it, you should be able to install the `logic-analyzer` skill descriptor from the ListenAI private npm registry, verify that the installed files came from package-owned assets, and know when to use the agent skill versus the TypeScript runtime APIs.

## Registry Setup

`@listenai` packages are expected to resolve from:

```text
https://registry-lpm.listenai.com
```

Configure that scope in your npm, pnpm, yarn, or CI environment before installing. Do not commit auth tokens to this repository.

```bash
npm config set @listenai:registry https://registry-lpm.listenai.com
pnpm config set @listenai:registry https://registry-lpm.listenai.com
yarn config set npmScopes.listenai.npmRegistryServer https://registry-lpm.listenai.com
```

## What the agent skill is

`@listenai/eaw-skill-logic-analyzer` publishes two surfaces:

- an agent skill descriptor named `logic-analyzer`, used by AI coding tools to load instructions and examples;
- TypeScript runtime exports, used by host code to run offline artifact analysis, optional protocol decode, or live DSLogic capture through resource-manager.

The agent skill does not replace the runtime package. It tells the agent how to call the package correctly: use package-root imports, keep the nested request shape, preserve phase-aware diagnostics, and release live sessions explicitly when the host is done.

## Source of truth

The package owns its host-facing assets. Do not maintain a separate handwritten copy in the repository root.

The package metadata exposes the canonical asset paths under `listenai.skillAssets`:

```json
{
  "skillDescriptor": "./SKILL.md",
  "readme": "./README.md"
}
```

Installers and host integrations should resolve those paths relative to the package root and reject paths that leave the package directory.

## Recommended install: one-shot registry execution

Use one-shot package execution when you want to install or refresh the skill without adding a permanent dependency.

Codex-style skill directory:

```bash
npm exec --package @listenai/eaw-skill-logic-analyzer -- \
  listenai-logic-analyzer-install-codex ~/.codex/skills

pnpm dlx --package @listenai/eaw-skill-logic-analyzer \
  listenai-logic-analyzer-install-codex ~/.codex/skills

yarn dlx @listenai/eaw-skill-logic-analyzer \
  listenai-logic-analyzer-install-codex ~/.codex/skills
```

Claude Code skill directory:

```bash
npm exec --package @listenai/eaw-skill-logic-analyzer -- \
  listenai-logic-analyzer-install-claude ~/.claude/skills

pnpm dlx --package @listenai/eaw-skill-logic-analyzer \
  listenai-logic-analyzer-install-claude ~/.claude/skills

yarn dlx @listenai/eaw-skill-logic-analyzer \
  listenai-logic-analyzer-install-claude ~/.claude/skills
```

The installer creates this layout under the target directory:

```text
logic-analyzer/
  SKILL.md
  README.md
```

The copied files should match the package-owned `SKILL.md` and `README.md` content for the package version you executed.

## Alternative install paths

For frequent personal use, install the package globally:

```bash
npm install -g @listenai/eaw-skill-logic-analyzer
listenai-logic-analyzer-install-codex ~/.codex/skills
```

For team projects that want a lockfile-pinned skill version, add the package as a dev dependency and wrap the installer in a project script:

```bash
npm install --save-dev @listenai/eaw-skill-logic-analyzer
npm exec listenai-logic-analyzer-install-codex ./.codex/skills
```

## GSD/pi-style agent directories

Some GSD/pi setups discover skills from `.agents/skills` in the current project or from the user's home-level agent skill directory. If the skill loader reports that `logic-analyzer/SKILL.md` is missing, install or mirror the package-owned assets into the directory that the loader is scanning.

A project-local layout should look like this:

```text
.agents/skills/logic-analyzer/
  SKILL.md
  README.md
```

Keep those files generated from the package assets instead of editing them by hand. If you customize guidance for a host, document the customization separately so future package updates can be merged cleanly.

## When to invoke the skill

Ask the agent to use `logic-analyzer` when the task is to:

- analyze a caller-supplied offline logic-capture artifact;
- run optional dsview protocol decode against an offline artifact;
- call the packaged generic logic-analyzer entrypoint from a host;
- perform live DSLogic capture through resource-manager;
- preserve structured failure phases and cleanup diagnostics while reporting results.

Do not use the skill as the live hardware authority. Resource-manager still owns inventory, allocation, leases, device readiness, live capture, and DSLogic `dsview-cli` runtime diagnostics.

## What the agent should do after loading it

The skill should steer the agent toward this runtime contract:

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

The important behavior is:

- import from `@listenai/eaw-skill-logic-analyzer`, not internal modules;
- pass one nested request object instead of flattening fields into a host-specific schema;
- branch on `result.ok` and `result.phase`;
- preserve nested diagnostics instead of replacing them with prose-only summaries;
- explicitly end successful live sessions when the device should return to `free`.

## Connected protocol-log capture and decode

Use connected protocol-log mode when the user asks for a live decoded UART, I2C, SPI, or similar log from an attached DSLogic device. Resource-manager owns allocation, ready-session validation, live capture, and connected decoder execution. The host should use `HttpResourceManager` from `@listenai/eaw-resource-client`, not a direct capture command, for this path.

The connected flow is:

1. Start or receive a typed resource-manager session for the device.
2. Call `resourceManager.listDecoderCapabilities({ deviceId, requestedAt, timeoutMs })` and fail closed if resource-manager is unavailable, the response is malformed, or the requested decoder such as `1:uart` is missing.
3. Call `resourceManager.captureDecode({ session, requestedAt, timeoutMs, captureTuning, decode })`, which maps to `POST /capture/decode`.
4. Branch on `decodeResult.ok`. On failure, preserve `diagnostics.phase`, `kind`, `message`, `session`, backend identity, artifact summary, decode summary, stream summaries, and inventory diagnostics.
5. Write user-visible decoded `rows` or `annotations` only after the typed `ok: true` branch.

Never tell an agent or operator to run `dsview-cli capture` for a connected protocol-log workflow. Direct package decode remains offline artifact-only: `inspectDsviewDecoder`, `runDsviewDecoder`, and `dsview-cli decode run` may be used only after the caller supplies an existing artifact.

## Request modes the agent should preserve

### Offline artifact mode

Use artifact mode when the caller already has a capture artifact. The request provides `session`, `artifact`, and `cleanup`. The optional `decode` section adds protocol decode without replacing waveform analysis.

### Live mode

Use live mode when the host should allocate a DSLogic device and capture through resource-manager. The request provides `session`, `capture`, and `cleanup`.

Use this mode only after resource-manager is running and the relevant device is visible as ready or diagnostically explainable through inventory.

## Decoder discovery and decode

When protocol decode is requested, the agent should not invent decoder metadata. It should use package-root discovery helpers:

```ts
const decoder = await inspectDsviewDecoder("1:i2c", {
  decodeRuntimePath: "/opt/dsview/lib/libdsview_decode_runtime.so",
  decoderDir: "/opt/dsview/decoders"
});
```

Then it should pass the inspected decoder metadata into the optional `decode` request and inject an execFile-style command runner for `dsview-cli decode run`.

Decode failures are expected to be structured:

- `decode-validation` means the request shape, decoder id, channel mapping, options, artifact payload, or runner setup is invalid before CLI execution;
- `decode-run` means the command executed or attempted to execute and failed, timed out, returned a CLI error payload, or produced malformed output.

## Live capture prerequisites

For live DSLogic capture, install resource-manager once as a global user-level tool and start the managed daemon before asking an agent to capture:

```bash
npm install -g @listenai/eaw-resource-manager

resource-manager start --daemon --host 127.0.0.1 --port 7600
resource-manager status --json
resource-manager stop
```

The daemon is the machine/user-level hardware authority, not a project dependency. Its default state and log files live under `~/.listenai/resource-manager/`, and `status --json` is the supported automation surface for agents.

Check runtime state before asking the agent to capture:

```bash
curl http://127.0.0.1:7600/health
curl http://127.0.0.1:7600/inventory
curl http://127.0.0.1:7600/dashboard-snapshot
```

The current support claim is intentionally narrow: macOS with `dsview-cli` and the classic DSLogic Plus path is the live-proven path. Linux and Windows remain readiness-modeled unless a later milestone proves them live.

## Contributor workflow from source

Use source workspace commands only when developing this repository:

```bash
pnpm install --frozen-lockfile
pnpm --filter @listenai/eaw-skill-logic-analyzer build
pnpm --filter @listenai/eaw-skill-logic-analyzer test
```

Do not make source commands the default user path in host-facing docs.

## Verify the package and docs

After changing the skill package or this guide, run the final M005 S04 acceptance check:

```bash
pnpm run verify:m005:s04
```

`verify:m005:s04` includes the connected UART-log parser, integration, resource-manager route, package guidance, and wording guards. S04 proof level: fixture/integration acceptance for connected resource-manager capture/decode; it does not claim real DSLogic hardware capture/decode until that hardware run is completed separately.

For the broader DSLogic support story, run:

```bash
pnpm run verify:m010:s05
```

## Troubleshooting

| Symptom | Likely cause | What to do |
| --- | --- | --- |
| The package cannot be found | The `@listenai` registry scope is not configured or authenticated | Configure `@listenai` to use `https://registry-lpm.listenai.com` and check auth in your environment |
| The agent says `logic-analyzer` is unavailable | The skill assets were not installed into the directory scanned by that agent | Run the relevant installer or mirror the package-owned assets into the scanned skill directory |
| The agent deep-imports package internals | The host guidance is stale or the skill was not loaded | Reload the `logic-analyzer` skill and keep imports on `@listenai/eaw-skill-logic-analyzer` |
| Live capture fails at allocation or readiness | resource-manager owns hardware state and found the device unavailable, unsupported, or degraded | Inspect `/inventory` and preserve the returned diagnostics |
| Decode fails before command execution | The optional decode request does not match inspected decoder metadata | Check `decode-validation` issues and fix decoder id, channel mappings, options, artifact payload, or runner setup |
| Decode fails after command execution | `dsview-cli decode run` failed or returned malformed output | Check `decode-run` command diagnostics, stdout/stderr previews, exit code, signal, native code, and cleanup result |

## Reader checklist

Before treating the skill as installed, confirm:

- `logic-analyzer/SKILL.md` and `logic-analyzer/README.md` exist in the agent's skill directory;
- the files came from the package-owned assets for the version you intend to use;
- the agent can load the `logic-analyzer` skill by name;
- host code imports from `@listenai/eaw-skill-logic-analyzer` only;
- live workflows use resource-manager for allocation and capture;
- successful live sessions are explicitly ended when the device should be released.
