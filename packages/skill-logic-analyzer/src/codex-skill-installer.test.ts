import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  CODEX_SKILL_INSTALLER_CONTRACT,
  CodexSkillInstallerError,
  formatCodexSkillInstallFailure,
  formatCodexSkillInstallSuccess,
  installCodexSkill
} from "./codex-skill-installer.js";
import * as packageRootExports from "./index.js";

const workspaceRoot = resolve(import.meta.dirname, "..", "..", "..");
const packageDir = resolve(workspaceRoot, "packages", "skill-logic-analyzer");
const legacySkillDir = ["skills", "logic-analyzer"].join("/");

const createTempDir = (prefix: string) => mkdtempSync(resolve(tmpdir(), `${prefix}-`));

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
  expectedCode: CodexSkillInstallerError["code"],
  expectedMessage: string | RegExp
) => {
  try {
    operation();
    throw new Error("Expected installer to fail.");
  } catch (error) {
    expect(error).toBeInstanceOf(CodexSkillInstallerError);

    const installerError = error as CodexSkillInstallerError;

    expect(installerError.code).toBe(expectedCode);
    expect(installerError.message).toMatch(expectedMessage);
    expect(formatCodexSkillInstallFailure(installerError)).toBe(
      `[logic-analyzer/codex-install] FAIL ${expectedCode}: ${installerError.message}`
    );
  }
};

describe("codex skill installer", () => {
  it("re-exports the installer surface from the package root barrel", () => {
    expect(typeof packageRootExports.installCodexSkill).toBe("function");
    expect(typeof packageRootExports.formatCodexSkillInstallSuccess).toBe("function");
    expect(packageRootExports.CODEX_SKILL_INSTALLER_CONTRACT.skillName).toBe(
      "logic-analyzer"
    );
  });

  it("keeps the Codex-specific contract and success output while copying package-owned assets", () => {
    withTempDir("codex-skill-install", (tempDir) => {
      const targetDirectory = resolve(tempDir, ".codex", "skills");
      const result = installCodexSkill({
        packageRoot: packageDir,
        targetDirectory
      });

      expect(result.destinationDirectory).toBe(
        resolve(tempDir, ".codex", "skills", "logic-analyzer")
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

      expect(installedSkill).toBe(packageSkill);
      expect(installedReadme).toBe(packageReadme);
      expect(installedSkill).toContain("authoritative host-facing assets");
      expect(installedReadme).toContain("canonical home of the logic-analyzer host assets");

      const output = formatCodexSkillInstallSuccess(result);
      expect(output).toContain(
        `[logic-analyzer/codex-install] OK installed Codex skill into "${result.destinationDirectory}".`
      );
      expect(output).toContain(
        `[logic-analyzer/codex-install] target Codex skills directory: ${result.targetDirectory}`
      );
      expect(output).toContain(resolve(packageDir, "SKILL.md"));
      expect(output).toContain(resolve(packageDir, "README.md"));
      expect(CODEX_SKILL_INSTALLER_CONTRACT).toEqual({
        skillName: "logic-analyzer",
        packageMetadataKeyPrefix: "listenai.skillAssets",
        expectedAssets: {
          skillDescriptor: "./SKILL.md",
          readme: "./README.md"
        },
        logPrefix: "[logic-analyzer/codex-install]"
      });
    });
  });

  it("installs alongside sibling Codex skills without touching them", () => {
    withTempDir("codex-skill-siblings", (tempDir) => {
      const targetDirectory = resolve(tempDir, ".codex", "skills");
      const siblingDirectory = resolve(targetDirectory, "other-skill");

      mkdirSync(siblingDirectory, { recursive: true });
      writeFileSync(resolve(siblingDirectory, "SKILL.md"), "other skill\n");

      const result = installCodexSkill({
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

  it("keeps Codex-specific target validation wording", () => {
    expectInstallerFailure(
      () => installCodexSkill({ packageRoot: packageDir, targetDirectory: "   " }),
      "invalid-target-path",
      /^Codex skills directory argument must be a non-empty path string\.$/
    );

    withTempDir("codex-skill-target-file", (tempDir) => {
      const targetPath = resolve(tempDir, "skills-file");
      writeFileSync(targetPath, "not a directory\n");

      expectInstallerFailure(
        () => installCodexSkill({ packageRoot: packageDir, targetDirectory: targetPath }),
        "invalid-target-directory",
        new RegExp(`^Codex skills directory must be a directory: \"${targetPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\"\\.$`)
      );
    });
  });

  it("keeps Codex-specific destination collision diagnostics", () => {
    withTempDir("codex-skill-collision", (tempDir) => {
      const targetDirectory = resolve(tempDir, ".codex", "skills");
      mkdirSync(targetDirectory, { recursive: true });
      writeFileSync(resolve(targetDirectory, "logic-analyzer"), "collision\n");

      expectInstallerFailure(
        () => installCodexSkill({ packageRoot: packageDir, targetDirectory }),
        "destination-collision",
        /Destination collision at .*logic-analyzer/
      );
    });
  });

  it("surfaces shared metadata failures through Codex-specific error contracts", () => {
    withTempDir("codex-skill-metadata-missing", (tempDir) => {
      const fakePackageRoot = resolve(tempDir, "package");
      mkdirSync(fakePackageRoot, { recursive: true });
      writePackageJson(fakePackageRoot, {
        readme: "./README.md"
      });
      writeFileSync(resolve(fakePackageRoot, "README.md"), "package readme\n");

      expectInstallerFailure(
        () =>
          installCodexSkill({
            packageRoot: fakePackageRoot,
            targetDirectory: resolve(tempDir, "target-a")
          }),
        "invalid-package-metadata",
        /Missing metadata key "listenai\.skillAssets\.skillDescriptor"/
      );
    });

    withTempDir("codex-skill-root-mirror", (tempDir) => {
      const fakePackageRoot = resolve(tempDir, "package");
      mkdirSync(resolve(fakePackageRoot, ...legacySkillDir.split("/")), {
        recursive: true
      });
      writePackageJson(fakePackageRoot, {
        skillDescriptor: "./SKILL.md",
        readme: `./${legacySkillDir}/README.md`
      });
      writeFileSync(resolve(fakePackageRoot, "SKILL.md"), "package skill\n");
      writeFileSync(
        resolve(fakePackageRoot, ...legacySkillDir.split("/"), "README.md"),
        "root mirror fallback\n"
      );

      expectInstallerFailure(
        () =>
          installCodexSkill({
            packageRoot: fakePackageRoot,
            targetDirectory: resolve(tempDir, "target-b")
          }),
        "invalid-package-metadata",
        /still points at root-owned assets/
      );
    });

    withTempDir("codex-skill-asset-missing", (tempDir) => {
      const fakePackageRoot = resolve(tempDir, "package");
      mkdirSync(fakePackageRoot, { recursive: true });
      writePackageJson(fakePackageRoot, {
        skillDescriptor: "./SKILL.md",
        readme: "./README.md"
      });
      writeFileSync(resolve(fakePackageRoot, "README.md"), "package readme\n");

      expectInstallerFailure(
        () =>
          installCodexSkill({
            packageRoot: fakePackageRoot,
            targetDirectory: resolve(tempDir, "target-c")
          }),
        "missing-package-asset",
        /SKILL\.md/
      );
    });
  });
});
