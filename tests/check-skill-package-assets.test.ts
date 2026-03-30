import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
// @ts-ignore - root workspace typecheck can miss vitest helper re-exports and .mjs module declarations here, but runtime resolves them correctly
import { afterEach, describe, expect, it } from "vitest";

// @ts-ignore - root workspace typecheck does not load a declaration for this .mjs helper in NodeNext mode
import { formatValidationSuccess, resolveDeclaredAsset, validateSkillPackageAssets } from "../scripts/check-skill-package-assets.mjs";

const tempDirs: string[] = [];
const legacySkillDir = ["skills", "logic-analyzer"].join("/");

const createTempRepo = () => {
  const tempDir = mkdtempSync(resolve(tmpdir(), "logic-analyzer-boundary-"));
  tempDirs.push(tempDir);

  mkdirSync(resolve(tempDir, "packages", "skill-logic-analyzer"), { recursive: true });

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
  it("passes against package-owned metadata without depending on root mirrors", () => {
    const repoRoot = createTempRepo();
    writeValidRepo(repoRoot);

    const result = validateSkillPackageAssets(repoRoot);
    const output = formatValidationSuccess(result);

    expect(result.assets).toEqual([
      {
        key: "skillDescriptor",
        declaredPath: "./SKILL.md",
        expectedRelativePath: "./SKILL.md",
        resolvedPath: resolve(repoRoot, "packages/skill-logic-analyzer/SKILL.md")
      },
      {
        key: "readme",
        declaredPath: "./README.md",
        expectedRelativePath: "./README.md",
        resolvedPath: resolve(repoRoot, "packages/skill-logic-analyzer/README.md")
      }
    ]);
    expect(output).toContain("OK skill package metadata resolves package-owned assets");
    expect(output).not.toContain("root compatibility docs");
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

  it("rejects malformed absolute metadata paths", () => {
    const repoRoot = createTempRepo();
    writeValidRepo(repoRoot);

    expect(() =>
      resolveDeclaredAsset(
        resolve(repoRoot, "packages", "skill-logic-analyzer"),
        {
          listenai: {
            skillAssets: {
              skillDescriptor: "/tmp/skill.md",
              readme: "./README.md"
            }
          }
        },
        "skillDescriptor"
      )
    ).toThrowError(
      'Metadata key "listenai.skillAssets.skillDescriptor" must stay package-relative. Expected "./SKILL.md", received absolute path "/tmp/skill.md".'
    );
  });

  it("rejects metadata that escapes the package root", () => {
    const repoRoot = createTempRepo();
    writeValidRepo(repoRoot);

    expect(() =>
      resolveDeclaredAsset(
        resolve(repoRoot, "packages", "skill-logic-analyzer"),
        {
          listenai: {
            skillAssets: {
              skillDescriptor: "../../outside/SKILL.md",
              readme: "./README.md"
            }
          }
        },
        "skillDescriptor"
      )
    ).toThrowError(/Metadata key "listenai\.skillAssets\.skillDescriptor" escapes the package root:/);
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
              readme: `./${legacySkillDir}/README.md`
            }
          }
        },
        "readme"
      )
    ).toThrowError(
      `Metadata key "listenai.skillAssets.readme" still points at root-owned assets. Expected "./README.md", received "./${legacySkillDir}/README.md".`
    );
  });

  it("fails when metadata resolves to a missing package-owned file", () => {
    const repoRoot = createTempRepo();
    writeValidRepo(repoRoot);
    rmSync(resolve(repoRoot, "packages/skill-logic-analyzer/README.md"));

    expect(() => validateSkillPackageAssets(repoRoot)).toThrowError(
      'Metadata key "listenai.skillAssets.readme" resolves to missing file "./README.md" (expected "./README.md").'
    );
  });
});
