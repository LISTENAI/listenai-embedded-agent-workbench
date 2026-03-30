import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  CLAUDE_SKILL_INSTALLER_CONTRACT,
  ClaudeSkillInstallerError,
  formatClaudeSkillInstallFailure,
  formatClaudeSkillInstallSuccess,
  installClaudeSkill
} from "./claude-skill-installer.js";
import * as packageRootExports from "./index.js";

const workspaceRoot = resolve(import.meta.dirname, "..", "..", "..");
const packageDir = resolve(workspaceRoot, "packages", "skill-logic-analyzer");
const rootMirrorDir = resolve(workspaceRoot, "skills", "logic-analyzer");

const createTempDir = (prefix: string) =>
  mkdtempSync(resolve(tmpdir(), `${prefix}-`));

const withTempDir = <T>(prefix: string, callback: (tempDir: string) => T): T => {
  const tempDir = createTempDir(prefix);

  try {
    return callback(tempDir);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
};

const writePackageJson = (
  fakePackageRoot: string,
  skillAssets: Record<string, unknown>
) => {
  writeFileSync(
    resolve(fakePackageRoot, "package.json"),
    JSON.stringify(
      {
        name: "@listenai/skill-logic-analyzer",
        type: "module",
        listenai: {
          skillAssets
        }
      },
      null,
      2
    )
  );
};

const expectInstallerFailure = (
  operation: () => unknown,
  expectedCode: ClaudeSkillInstallerError["code"],
  expectedMessage: string | RegExp
) => {
  try {
    operation();
    throw new Error("Expected installer to fail.");
  } catch (error) {
    expect(error).toBeInstanceOf(ClaudeSkillInstallerError);

    const installerError = error as ClaudeSkillInstallerError;

    expect(installerError.code).toBe(expectedCode);
    expect(installerError.message).toMatch(expectedMessage);
    expect(formatClaudeSkillInstallFailure(installerError)).toBe(
      `[logic-analyzer/claude-install] FAIL ${expectedCode}: ${installerError.message}`
    );
  }
};

describe("claude skill installer", () => {
  it("re-exports the installer surface from the package root barrel", () => {
    expect(typeof packageRootExports.installClaudeSkill).toBe("function");
    expect(typeof packageRootExports.formatClaudeSkillInstallSuccess).toBe("function");
    expect(packageRootExports.CLAUDE_SKILL_INSTALLER_CONTRACT.skillName).toBe(
      "logic-analyzer"
    );
  });

  it("keeps the Claude-specific contract and success output while copying package-owned assets", () => {
    withTempDir("claude-skill-install", (tempDir) => {
      const targetDirectory = resolve(tempDir, ".claude", "skills");
      const result = installClaudeSkill({
        packageRoot: packageDir,
        targetDirectory
      });

      expect(result.destinationDirectory).toBe(
        resolve(tempDir, ".claude", "skills", "logic-analyzer")
      );
      expect(result.copiedFiles.map((asset) => asset.key)).toEqual([
        "skillDescriptor",
        "readme"
      ]);

      const installedSkill = readFileSync(
        resolve(result.destinationDirectory, "SKILL.md"),
        "utf8"
      );
      const installedReadme = readFileSync(
        resolve(result.destinationDirectory, "README.md"),
        "utf8"
      );
      const packageSkill = readFileSync(resolve(packageDir, "SKILL.md"), "utf8");
      const packageReadme = readFileSync(resolve(packageDir, "README.md"), "utf8");
      const rootMirrorSkill = readFileSync(resolve(rootMirrorDir, "SKILL.md"), "utf8");
      const rootMirrorReadme = readFileSync(resolve(rootMirrorDir, "README.md"), "utf8");

      expect(installedSkill).toBe(packageSkill);
      expect(installedReadme).toBe(packageReadme);
      expect(installedSkill).not.toBe(rootMirrorSkill);
      expect(installedReadme).not.toBe(rootMirrorReadme);

      const output = formatClaudeSkillInstallSuccess(result);
      expect(output).toContain(
        `[logic-analyzer/claude-install] OK installed Claude skill into "${result.destinationDirectory}".`
      );
      expect(output).toContain(
        `[logic-analyzer/claude-install] target Claude skills directory: ${result.targetDirectory}`
      );
      expect(output).toContain(resolve(packageDir, "SKILL.md"));
      expect(output).toContain(resolve(packageDir, "README.md"));
      expect(CLAUDE_SKILL_INSTALLER_CONTRACT).toEqual({
        skillName: "logic-analyzer",
        packageMetadataKeyPrefix: "listenai.skillAssets",
        expectedAssets: {
          skillDescriptor: "./SKILL.md",
          readme: "./README.md"
        },
        logPrefix: "[logic-analyzer/claude-install]"
      });
    });
  });

  it("installs alongside sibling Claude skills without touching them", () => {
    withTempDir("claude-skill-siblings", (tempDir) => {
      const targetDirectory = resolve(tempDir, ".claude", "skills");
      const siblingDirectory = resolve(targetDirectory, "other-skill");

      mkdirSync(siblingDirectory, { recursive: true });
      writeFileSync(resolve(siblingDirectory, "SKILL.md"), "other skill\n");

      const result = installClaudeSkill({
        packageRoot: packageDir,
        targetDirectory
      });

      expect(readFileSync(resolve(siblingDirectory, "SKILL.md"), "utf8")).toBe(
        "other skill\n"
      );
      expect(readFileSync(resolve(result.destinationDirectory, "README.md"), "utf8")).toBe(
        readFileSync(resolve(packageDir, "README.md"), "utf8")
      );
    });
  });

  it("keeps Claude-specific target validation wording", () => {
    expectInstallerFailure(
      () => installClaudeSkill({ packageRoot: packageDir, targetDirectory: "   " }),
      "invalid-target-path",
      /^Claude skills directory argument must be a non-empty path string\.$/
    );

    withTempDir("claude-skill-target-file", (tempDir) => {
      const targetPath = resolve(tempDir, "skills-file");
      writeFileSync(targetPath, "not a directory\n");

      expectInstallerFailure(
        () => installClaudeSkill({ packageRoot: packageDir, targetDirectory: targetPath }),
        "invalid-target-directory",
        new RegExp(`^Claude skills directory must be a directory: \"${targetPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\"\\.$`)
      );
    });
  });

  it("keeps Claude-specific destination collision diagnostics", () => {
    withTempDir("claude-skill-collision", (tempDir) => {
      const targetDirectory = resolve(tempDir, ".claude", "skills");
      mkdirSync(targetDirectory, { recursive: true });
      writeFileSync(resolve(targetDirectory, "logic-analyzer"), "collision\n");

      expectInstallerFailure(
        () => installClaudeSkill({ packageRoot: packageDir, targetDirectory }),
        "destination-collision",
        /Destination collision at .*logic-analyzer/
      );
    });
  });

  it("surfaces shared metadata failures through Claude-specific error contracts", () => {
    withTempDir("claude-skill-metadata-missing", (tempDir) => {
      const fakePackageRoot = resolve(tempDir, "package");
      mkdirSync(fakePackageRoot, { recursive: true });
      writePackageJson(fakePackageRoot, {
        readme: "./README.md"
      });
      writeFileSync(resolve(fakePackageRoot, "README.md"), "package readme\n");

      expectInstallerFailure(
        () =>
          installClaudeSkill({
            packageRoot: fakePackageRoot,
            targetDirectory: resolve(tempDir, "target-a")
          }),
        "invalid-package-metadata",
        /Missing metadata key "listenai\.skillAssets\.skillDescriptor"/
      );
    });

    withTempDir("claude-skill-root-mirror", (tempDir) => {
      const fakePackageRoot = resolve(tempDir, "package");
      mkdirSync(resolve(fakePackageRoot, "skills", "logic-analyzer"), {
        recursive: true
      });
      writePackageJson(fakePackageRoot, {
        skillDescriptor: "./SKILL.md",
        readme: "./skills/logic-analyzer/README.md"
      });
      writeFileSync(resolve(fakePackageRoot, "SKILL.md"), "package skill\n");
      writeFileSync(
        resolve(fakePackageRoot, "skills", "logic-analyzer", "README.md"),
        "root mirror fallback\n"
      );

      expectInstallerFailure(
        () =>
          installClaudeSkill({
            packageRoot: fakePackageRoot,
            targetDirectory: resolve(tempDir, "target-b")
          }),
        "invalid-package-metadata",
        /still points at root-owned assets/
      );
    });

    withTempDir("claude-skill-asset-missing", (tempDir) => {
      const fakePackageRoot = resolve(tempDir, "package");
      mkdirSync(fakePackageRoot, { recursive: true });
      writePackageJson(fakePackageRoot, {
        skillDescriptor: "./SKILL.md",
        readme: "./README.md"
      });
      writeFileSync(resolve(fakePackageRoot, "README.md"), "package readme\n");

      expectInstallerFailure(
        () =>
          installClaudeSkill({
            packageRoot: fakePackageRoot,
            targetDirectory: resolve(tempDir, "target-c")
          }),
        "missing-package-asset",
        /SKILL\.md/
      );
    });
  });
});
