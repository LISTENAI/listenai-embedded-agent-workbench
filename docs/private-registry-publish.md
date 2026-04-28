# Private Registry Publish Automation

This repository publishes four private `@listenai/*` packages to the ListenAI npm registry:

1. `@listenai/contracts`
2. `@listenai/resource-client`
3. `@listenai/resource-manager`
4. `@listenai/skill-logic-analyzer`

Registry URL:

```text
https://registry-lpm.listenai.com
```

Do not commit `.npmrc`, `.yarnrc.yml`, registry tokens, or generated auth config. Local and CI publish paths use a temporary npm userconfig.

## Local Dry Run

Dry-run is the default and performs no registry writes:

```bash
bash scripts/publish-private-registry.sh --dry-run
```

Expected high-level output:

```text
[publish] Running consumer publish-readiness verifier
[m003-s04] Consumer publish-readiness verification passed
[publish] Completed dry-run for 4 package(s)
```

The script first runs `scripts/verify-m003-s04.sh`, then packs the four packages in dependency order, then runs `npm publish --dry-run` against each packed tarball.

## Local Real Publish

A real publish is intentionally awkward. It requires a registry credential and a confirmation word. In GitHub Actions, prefer the organization-level `LPM_ZHUOBIN_TOKEN` secret used by other ListenAI packages. Locally, use the same variable when you have access:

```bash
LPM_ZHUOBIN_TOKEN=... \
CONFIRM_PUBLISH=publish \
bash scripts/publish-private-registry.sh --publish
```

The script writes private-registry auth in the same shape as the existing ListenAI workflow convention:

```text
//registry-lpm.listenai.com/:_password
//registry-lpm.listenai.com/:username
//registry-lpm.listenai.com/:email
//registry-lpm.listenai.com/:always-auth
```

`LPM_NPM_USERNAME` defaults to `zbzhao`, and `LPM_NPM_EMAIL` defaults to `zbzhao@listenai.com`. `NPM_TOKEN` is still supported as an optional fallback auth token and for npmjs.org auth when provided.

Safety gates:

- `--publish` fails unless `CONFIRM_PUBLISH=publish`.
- `--publish` fails unless `LPM_ZHUOBIN_TOKEN` or `NPM_TOKEN` is set.
- The script checks every `package@version` is absent from the target registry before any real publish attempt.
- Registry config is written only to a temporary npm userconfig.
- The M003 consumer publish-readiness verifier runs before any package publish attempt.
- Packages publish in dependency order: contracts, resource-client, resource-manager, skill-logic-analyzer.

Real npm publish is not transactional. If a registry or network failure occurs mid-sequence, inspect the private registry manually before retrying.

## GitHub Actions Workflow

Manual workflow:

```text
.github/workflows/publish.yml
```

Inputs:

- `dry_run`: boolean, defaults to `true`.
- `confirm_publish`: string, must be `publish` for a real publish.

Required secret for real publish:

```text
LPM_ZHUOBIN_TOKEN
```

Optional fallback/additional secret:

```text
NPM_TOKEN
```

Recommended workflow usage:

1. Dispatch `Publish Private Packages` with `dry_run=true`.
2. Confirm the run completes verification and dry-run publish for all four packages.
3. Dispatch again with `dry_run=false` and `confirm_publish=publish` only when you intend to write to the private registry.

The workflow uses `permissions: contents: read` and passes `LPM_ZHUOBIN_TOKEN`, `NPM_TOKEN`, and `CONFIRM_PUBLISH` only as environment variables to `scripts/publish-private-registry.sh`.

## Verification

Run the release automation guardrail checks locally:

```bash
bash scripts/verify-m004-s01.sh
bash scripts/verify-m004-s02.sh
bash scripts/verify-m004-s03.sh
```

`verify-m004-s03.sh` checks that docs, workflow, and scripts stay aligned. It also reruns the S01 and S02 guardrail verifiers.

## Non-goals

This milestone does not add automatic version bumping, changelog generation, GitHub release creation, git tagging, branch protection changes, or automatic publishing on push. Those should be added only after the release policy is settled.
