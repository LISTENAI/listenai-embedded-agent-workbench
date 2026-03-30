# Logic Analyzer Skill Compatibility Mirror

This directory is a secondary compatibility surface for repository readers who land in `skills/logic-analyzer/` before finding the packaged skill. The canonical host-facing contract now lives in `@listenai/skill-logic-analyzer` and in the package-owned docs under `packages/skill-logic-analyzer/`.

## Canonical source of truth

Use these files as the authoritative host guidance:

- `packages/skill-logic-analyzer/SKILL.md`
- `packages/skill-logic-analyzer/README.md`
- `packages/skill-logic-analyzer/package.json` under `listenai.skillAssets`

If this mirror disagrees with the package-owned docs, the package wins and this mirror should be updated to match.

## Primary host import path

New host integrations should import from the package directly:

```ts
import {
  createGenericLogicAnalyzerSkill,
  createLogicAnalyzerSkill,
  runGenericLogicAnalyzer,
  type GenericLogicAnalyzerRequest,
  type GenericLogicAnalyzerResult
} from "@listenai/skill-logic-analyzer";
```

The repo-root compatibility barrel remains available only as a shim for monorepo-local callers. It is not the canonical install or copy-from path for future hosts.

## What this mirror preserves

This mirror exists to make the boundary explicit while older repo-local references continue to work:

- the skill name remains `logic-analyzer`
- the request still uses nested `session`, `artifact`, and `cleanup` sections
- successful runs still require an explicit `endSession(...)` call when the host is ready to release the device
- phase-aware failures still come from the package-root runtime surface

For the real examples, lifecycle details, Codex install destinations (`~/.codex/skills/logic-analyzer/` and `.codex/skills/logic-analyzer/` via `listenai-logic-analyzer-install-codex`), Claude install destinations (`~/.claude/skills/logic-analyzer/` and `.claude/skills/logic-analyzer/` via `listenai-logic-analyzer-install-claude`), and package-owned verification commands (`bash scripts/verify-m004-s04.sh` and `pnpm run verify:s04`), continue with `packages/skill-logic-analyzer/README.md`. This mirror should stay a pointer, not a second canonical walkthrough.
