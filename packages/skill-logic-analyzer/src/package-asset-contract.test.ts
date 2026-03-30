import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import * as packageRoot from "./index.js";

type SkillAssetKey = "skillDescriptor" | "readme";

type SkillPackageMetadata = {
  listenai?: {
    skillAssets?: Partial<Record<SkillAssetKey, unknown>>;
  };
};

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(packageDir, "..", "..");
const packageJsonPath = resolve(packageDir, "package.json");
const packageJson = JSON.parse(
  readFileSync(packageJsonPath, "utf8")
) as SkillPackageMetadata;

const packageReadmePath = resolve(packageDir, "README.md");
const packageSkillPath = resolve(packageDir, "SKILL.md");
const rootMirrorReadmePath = resolve(repoRoot, "skills", "logic-analyzer", "README.md");
const rootMirrorSkillPath = resolve(repoRoot, "skills", "logic-analyzer", "SKILL.md");
const rootReadmePath = resolve(repoRoot, "README.md");
const repoCompatibilityPackageName = ["listenai", "agent", "skills"].join("-");
const expectedAssetKeys: readonly SkillAssetKey[] = ["skillDescriptor", "readme"];

const assertPackageRelativeAssetPath = (
  key: SkillAssetKey,
  metadata: SkillPackageMetadata
) => {
  const value = metadata.listenai?.skillAssets?.[key];

  if (value === undefined) {
    throw new Error(`Missing package metadata key "listenai.skillAssets.${key}".`);
  }

  if (typeof value !== "string") {
    throw new Error(
      `Package metadata key "listenai.skillAssets.${key}" must be a string, received ${typeof value}.`
    );
  }

  if (value.trim().length === 0) {
    throw new Error(`Package metadata key "listenai.skillAssets.${key}" cannot be empty.`);
  }

  if (isAbsolute(value)) {
    throw new Error(
      `Package metadata key "listenai.skillAssets.${key}" must be package-relative, received absolute path "${value}".`
    );
  }

  const resolvedPath = resolve(packageDir, value);
  const packageRootPrefix = `${packageDir}${sep}`;

  if (resolvedPath !== packageDir && !resolvedPath.startsWith(packageRootPrefix)) {
    throw new Error(
      `Package metadata key "listenai.skillAssets.${key}" escapes the package root: "${value}" -> "${resolvedPath}".`
    );
  }

  if (value.includes("skills/logic-analyzer")) {
    throw new Error(
      `Package metadata key "listenai.skillAssets.${key}" still points at root-owned skills/logic-analyzer content: "${value}".`
    );
  }

  return {
    relativePath: value,
    resolvedPath
  };
};

describe("skill package asset contract", () => {
  it("publishes canonical host assets through package-owned metadata", () => {
    expect(expectedAssetKeys).toEqual(["skillDescriptor", "readme"]);

    const resolvedAssets = expectedAssetKeys.map((key) => ({
      key,
      ...assertPackageRelativeAssetPath(key, packageJson)
    }));

    expect(resolvedAssets).toEqual([
      {
        key: "skillDescriptor",
        relativePath: "./SKILL.md",
        resolvedPath: resolve(packageDir, "./SKILL.md")
      },
      {
        key: "readme",
        relativePath: "./README.md",
        resolvedPath: resolve(packageDir, "./README.md")
      }
    ]);

    for (const asset of resolvedAssets) {
      expect(existsSync(asset.resolvedPath), `Missing package asset file ${asset.relativePath}.`).toBe(true);
    }
  });

  it("keeps the package docs as the authoritative host-facing guidance", () => {
    const packageReadme = readFileSync(packageReadmePath, "utf8");
    const packageSkill = readFileSync(packageSkillPath, "utf8");
    const rootMirrorReadme = readFileSync(rootMirrorReadmePath, "utf8");
    const rootMirrorSkill = readFileSync(rootMirrorSkillPath, "utf8");
    const rootReadme = readFileSync(rootReadmePath, "utf8");

    expect(packageReadme).toContain("canonical home of the logic-analyzer host assets");
    expect(packageReadme).toContain('from "@listenai/skill-logic-analyzer"');
    expect(packageReadme).not.toContain(repoCompatibilityPackageName);

    expect(packageSkill).toContain("authoritative host-facing assets");
    expect(packageSkill).toContain("@listenai/skill-logic-analyzer");

    expect(rootMirrorReadme).toContain("secondary compatibility surface");
    expect(rootMirrorReadme).toContain("@listenai/skill-logic-analyzer");
    expect(rootMirrorReadme).not.toContain(repoCompatibilityPackageName);

    expect(rootMirrorSkill).toContain("compatibility mirror");
    expect(rootMirrorSkill).toContain("packages/skill-logic-analyzer/SKILL.md");

    expect(rootReadme).toContain("packages/skill-logic-analyzer/README.md");
    expect(rootReadme).toContain("thin compatibility layer");
  });

  it("fails loudly when a metadata key is missing", () => {
    expect(() =>
      assertPackageRelativeAssetPath("skillDescriptor", {
        listenai: {
          skillAssets: {
            readme: "./README.md"
          }
        }
      })
    ).toThrowError(
      'Missing package metadata key "listenai.skillAssets.skillDescriptor".'
    );
  });

  it("fails loudly when a metadata value is malformed", () => {
    expect(() =>
      assertPackageRelativeAssetPath("skillDescriptor", {
        listenai: {
          skillAssets: {
            skillDescriptor: 42
          }
        }
      })
    ).toThrowError(
      'Package metadata key "listenai.skillAssets.skillDescriptor" must be a string, received number.'
    );
  });

  it("rejects package metadata that escapes the package root", () => {
    expect(() =>
      assertPackageRelativeAssetPath("skillDescriptor", {
        listenai: {
          skillAssets: {
            skillDescriptor: "../../skills/logic-analyzer/SKILL.md"
          }
        }
      })
    ).toThrowError(
      /Package metadata key "listenai\.skillAssets\.skillDescriptor" escapes the package root:/
    );
  });

  it("rejects stale metadata that still points at root-owned skill content", () => {
    expect(() =>
      assertPackageRelativeAssetPath("readme", {
        listenai: {
          skillAssets: {
            readme: "./skills/logic-analyzer/README.md"
          }
        }
      })
    ).toThrowError(
      'Package metadata key "listenai.skillAssets.readme" still points at root-owned skills/logic-analyzer content: "./skills/logic-analyzer/README.md".'
    );
  });

  it("keeps the package barrel as the canonical runtime surface", () => {
    expect(typeof packageRoot.createGenericLogicAnalyzerSkill).toBe("function");
    expect(typeof packageRoot.runGenericLogicAnalyzer).toBe("function");
    expect(typeof packageRoot.createLogicAnalyzerSkill).toBe("function");
    expect(packageRoot.GENERIC_LOGIC_ANALYZER_PHASES).toEqual([
      "request-validation",
      "start-session",
      "load-capture",
      "completed"
    ]);
  });
});
