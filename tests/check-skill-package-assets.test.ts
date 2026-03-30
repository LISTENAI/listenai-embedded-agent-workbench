import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  assertRootMirrorPointsToPackage,
  formatValidationSuccess,
  resolveDeclaredAsset,
  validateSkillPackageAssets
} from "../scripts/check-skill-package-assets.mjs";

const tempDirs = [] as string[];

const createTempRepo = () => {
  const tempDir = mkdtempSync(resolve(tmpdir(), "logic-analyzer-boundary-"));
  tempDirs.push(tempDir);

  mkdirSync(resolve(tempDir, "packages", "skill-logic-analyzer"), { recursive: true });
  mkdirSync(resolve(tempDir, "skills", "logic-analyzer"), { recursive: true });

  return tempDir;
};

const writeRepoFile = (repoRoot: string, relativePath: string, content: string) => {
  const filePath = resolve(repoRoot, relativePath);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content);
};

const writeValidRepo = (repoRoot: string) => {
  writeRepoFile(
    repoRoot,
    "packages/skill-logic-analyzer/package.json",
    JSON.stringify(
      {
        listenai: {
          skillAssets: {
            skillDescriptor: "./SKILL.md",
            readme: "./README.md"
          }
        }
      },
      null,
      2
    )
  );
  writeRepoFile(repoRoot, "packages/skill-logic-analyzer/SKILL.md", "package skill doc\n");
  writeRepoFile(repoRoot, "packages/skill-logic-analyzer/README.md", "package readme\n");
  writeRepoFile(
    repoRoot,
    "skills/logic-analyzer/SKILL.md",
    [
      "compatibility mirror",
      "not the canonical editing surface",
      "packages/skill-logic-analyzer/SKILL.md",
      "packages/skill-logic-analyzer/README.md",
      "listenai.skillAssets",
      "@listenai/skill-logic-analyzer"
    ].join("\n")
  );
  writeRepoFile(
    repoRoot,
    "skills/logic-analyzer/README.md",
    [
      "secondary compatibility surface",
      "canonical host-facing contract now lives in `@listenai/skill-logic-analyzer`",
      "packages/skill-logic-analyzer/SKILL.md",
      "packages/skill-logic-analyzer/README.md",
      "not the canonical install or copy-from path"
    ].join("\n")
  );
};

afterEach(() => {
  while (tempDirs.length > 0) {
    const tempDir = tempDirs.pop();
    if (tempDir) {
      rmSync(tempDir, { force: true, recursive: true });
    }
  }
});

describe("check-skill-package-assets helper", () => {
  it("passes against the real repository boundary and prints concise success output", () => {
    const result = validateSkillPackageAssets();
    const output = formatValidationSuccess(result);

    expect(output).toContain("OK skill package metadata resolves package-owned assets");
    expect(output).toContain("skills/logic-analyzer/SKILL.md");
    expect(output).toContain("skills/logic-analyzer/README.md");
  });

  it("fails explicitly when a metadata key is missing", () => {
    const repoRoot = createTempRepo();
    writeValidRepo(repoRoot);

    writeRepoFile(
      repoRoot,
      "packages/skill-logic-analyzer/package.json",
      JSON.stringify(
        {
          listenai: {
            skillAssets: {
              readme: "./README.md"
            }
          }
        },
        null,
        2
      )
    );

    expect(() => validateSkillPackageAssets(repoRoot)).toThrowError(
      'Missing metadata key "listenai.skillAssets.skillDescriptor". Expected package-relative path "./SKILL.md".'
    );
  });

  it("rejects metadata that falls back to root-owned assets", () => {
    const repoRoot = createTempRepo();
    writeValidRepo(repoRoot);

    expect(() =>
      resolveDeclaredAsset(
        resolve(repoRoot, "packages", "skill-logic-analyzer"),
        {
          listenai: {
            skillAssets: {
              skillDescriptor: "./SKILL.md",
              readme: "./skills/logic-analyzer/README.md"
            }
          }
        },
        "readme"
      )
    ).toThrowError(
      'Metadata key "listenai.skillAssets.readme" still points at root-owned assets. Expected "./README.md", received "./skills/logic-analyzer/README.md".'
    );
  });

  it("fails when a root compatibility doc stops reading as secondary", () => {
    const repoRoot = createTempRepo();
    writeValidRepo(repoRoot);
    writeRepoFile(repoRoot, "skills/logic-analyzer/README.md", "canonical docs live here\n");

    expect(() =>
      assertRootMirrorPointsToPackage(repoRoot, {
        relativePath: "skills/logic-analyzer/README.md",
        requiredPhrases: [
          "secondary compatibility surface",
          "canonical host-facing contract now lives in `@listenai/skill-logic-analyzer`"
        ]
      })
    ).toThrowError(
      'Root compatibility file "skills/logic-analyzer/README.md" still looks canonical. Missing required pointer text: "secondary compatibility surface", "canonical host-facing contract now lives in `@listenai/skill-logic-analyzer`".'
    );
  });
});
