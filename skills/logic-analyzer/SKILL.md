---
name: logic-analyzer
description: Compatibility mirror for hosts that discover the repo-root skill directory before the canonical @listenai/skill-logic-analyzer package assets.
---

<objective>
Redirect readers to the canonical package-owned logic-analyzer assets in <code>packages/skill-logic-analyzer/</code> and make the secondary compatibility role of this repo-root mirror explicit.
</objective>

<status>
This file is a compatibility mirror, not the canonical editing surface.

Authoritative host guidance lives in:
- <code>packages/skill-logic-analyzer/SKILL.md</code>
- <code>packages/skill-logic-analyzer/README.md</code>
- the package metadata contract in <code>packages/skill-logic-analyzer/package.json</code> under <code>listenai.skillAssets</code>

If these files drift, update the package-owned assets first and then mirror any necessary wording here.
</status>

<canonical_import>
Hosts should import from <code>@listenai/skill-logic-analyzer</code>.

The repo-root <code>src/index.ts</code> barrel and this <code>skills/logic-analyzer/</code> directory remain available only so existing monorepo consumers are not broken while installers migrate to the package-owned boundary.
</canonical_import>

<reader_action>
For the real host contract, examples, request shape, cleanup lifecycle, and verification guidance, continue with <code>packages/skill-logic-analyzer/README.md</code> and <code>packages/skill-logic-analyzer/SKILL.md</code>.
</reader_action>
