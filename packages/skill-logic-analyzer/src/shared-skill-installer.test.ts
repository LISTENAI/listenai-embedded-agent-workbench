import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  EXPECTED_SKILL_ASSETS,
  PACKAGE_METADATA_KEY_PREFIX,
  SKILL_DIRECTORY_NAME,
  installSharedSkill,
  type SharedSkillInstallerErrorCode
} from "./shared-skill-installer.js";

class FixtureInstallerError extends Error {
  readonly name = "FixtureInstallerError";

  constructor(
    readonly code: SharedSkillInstallerErrorCode,
    message: string
  ) {
    super(message);
  }
}

const workspaceRoot = resolve(import.meta.dirname, "..", "..", "..");
const packageDir = resolve(workspaceRoot, "packages", "skill-logic-analyzer");

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
  expectedCode: SharedSkillInstallerErrorCode,
  expectedMessage: string | RegExp
) => {
  try {
    operation();
    throw new Error("Expected installer to fail.");
  } catch (error) {
    const installerError = error as FixtureInstallerError;

    expect(installerError.name).toBe("FixtureInstallerError");
    expect(installerError.code).toBe(expectedCode);
    expect(installerError.message).toMatch(expectedMessage);
  }
};

const installWithFixtureHost = (packageRoot: string, targetDirectory: string) =>
  installSharedSkill({
    packageRoot,
    targetDirectory,
    hostDisplayName: "Fixture",
    fail: (code, message) => {
      throw new FixtureInstallerError(code, message);
    }
  });

describe("shared skill installer", () => {
  it("centralizes the canonical package asset contract", () => {
    expect(PACKAGE_METADATA_KEY_PREFIX).toBe("listenai.skillAssets");
    expect(SKILL_DIRECTORY_NAME).toBe("logic-analyzer");
    expect(EXPECTED_SKILL_ASSETS).toEqual({
      skillDescriptor: "./SKILL.md",
      readme: "./README.md"
    });
  });

  it("copies only the declared package-owned assets into the destination directory", () => {
    withTempDir("shared-skill-install", (tempDir) => {
      const targetDirectory = resolve(tempDir, ".fixture", "skills");
      const siblingDirectory = resolve(targetDirectory, "sibling-skill");

      mkdirSync(siblingDirectory, { recursive: true });
      writeFileSync(resolve(siblingDirectory, "SKILL.md"), "sibling skill\n");

      const result = installWithFixtureHost(packageDir, targetDirectory);

      expect(result.destinationDirectory).toBe(
        resolve(targetDirectory, "logic-analyzer")
      );
      expect(result.copiedFiles.map((asset) => asset.key)).toEqual([
        "skillDescriptor",
        "readme"
      ]);
      expect(result.copiedFiles.map((asset) => asset.destinationPath)).toEqual([
        resolve(result.destinationDirectory, "SKILL.md"),
        resolve(result.destinationDirectory, "README.md")
      ]);
      expect(readFileSync(resolve(result.destinationDirectory, "SKILL.md"), "utf8")).toBe(
        readFileSync(resolve(packageDir, "SKILL.md"), "utf8")
      );
      expect(readFileSync(resolve(result.destinationDirectory, "README.md"), "utf8")).toBe(
        readFileSync(resolve(packageDir, "README.md"), "utf8")
      );
      expect(readFileSync(resolve(siblingDirectory, "SKILL.md"), "utf8")).toBe(
        "sibling skill\n"
      );
    });
  });

  it("rejects empty metadata values with the canonical metadata key in the message", () => {
    withTempDir("shared-skill-empty-metadata", (tempDir) => {
      const fakePackageRoot = resolve(tempDir, "package");
      mkdirSync(fakePackageRoot, { recursive: true });
      writePackageJson(fakePackageRoot, {
        skillDescriptor: "   ",
        readme: "./README.md"
      });
      writeFileSync(resolve(fakePackageRoot, "README.md"), "package readme\n");

      expectInstallerFailure(
        () => installWithFixtureHost(fakePackageRoot, resolve(tempDir, "target")),
        "invalid-package-metadata",
        /listenai\.skillAssets\.skillDescriptor.*cannot be empty/
      );
    });
  });

  it("rejects absolute metadata paths", () => {
    withTempDir("shared-skill-absolute-metadata", (tempDir) => {
      const fakePackageRoot = resolve(tempDir, "package");
      mkdirSync(fakePackageRoot, { recursive: true });
      writePackageJson(fakePackageRoot, {
        skillDescriptor: "/tmp/SKILL.md",
        readme: "./README.md"
      });
      writeFileSync(resolve(fakePackageRoot, "README.md"), "package readme\n");

      expectInstallerFailure(
        () => installWithFixtureHost(fakePackageRoot, resolve(tempDir, "target")),
        "invalid-package-metadata",
        /must stay package-relative/
      );
    });
  });

  it("rejects metadata paths that escape the package root", () => {
    withTempDir("shared-skill-escape-metadata", (tempDir) => {
      const fakePackageRoot = resolve(tempDir, "package");
      mkdirSync(fakePackageRoot, { recursive: true });
      writePackageJson(fakePackageRoot, {
        skillDescriptor: "../../outside/SKILL.md",
        readme: "./README.md"
      });
      writeFileSync(resolve(fakePackageRoot, "README.md"), "package readme\n");

      expectInstallerFailure(
        () => installWithFixtureHost(fakePackageRoot, resolve(tempDir, "target")),
        "invalid-package-metadata",
        /escapes the package root/
      );
    });
  });

  it("rejects stale root-mirror metadata and drifted asset paths", () => {
    withTempDir("shared-skill-drift-metadata", (tempDir) => {
      const rootMirrorPackageRoot = resolve(tempDir, "root-mirror-package");
      mkdirSync(resolve(rootMirrorPackageRoot, "skills", "logic-analyzer"), {
        recursive: true
      });
      writePackageJson(rootMirrorPackageRoot, {
        skillDescriptor: "./SKILL.md",
        readme: "./skills/logic-analyzer/README.md"
      });
      writeFileSync(resolve(rootMirrorPackageRoot, "SKILL.md"), "package skill\n");
      writeFileSync(
        resolve(rootMirrorPackageRoot, "skills", "logic-analyzer", "README.md"),
        "root mirror fallback\n"
      );

      expectInstallerFailure(
        () => installWithFixtureHost(rootMirrorPackageRoot, resolve(tempDir, "target-a")),
        "invalid-package-metadata",
        /still points at root-owned assets/
      );

      const driftedPackageRoot = resolve(tempDir, "drifted-package");
      mkdirSync(driftedPackageRoot, { recursive: true });
      writePackageJson(driftedPackageRoot, {
        skillDescriptor: "./docs/SKILL.md",
        readme: "./README.md"
      });
      mkdirSync(resolve(driftedPackageRoot, "docs"), { recursive: true });
      writeFileSync(resolve(driftedPackageRoot, "docs", "SKILL.md"), "drifted skill\n");
      writeFileSync(resolve(driftedPackageRoot, "README.md"), "package readme\n");

      expectInstallerFailure(
        () => installWithFixtureHost(driftedPackageRoot, resolve(tempDir, "target-b")),
        "invalid-package-metadata",
        /drifted to ".\/docs\/SKILL\.md"/
      );
    });
  });

  it("rejects destination collisions and non-file assets", () => {
    withTempDir("shared-skill-collision", (tempDir) => {
      const targetDirectory = resolve(tempDir, "target");
      mkdirSync(resolve(targetDirectory, "logic-analyzer"), { recursive: true });

      expectInstallerFailure(
        () => installWithFixtureHost(packageDir, targetDirectory),
        "destination-collision",
        /Destination collision/
      );
    });

    withTempDir("shared-skill-non-file-asset", (tempDir) => {
      const fakePackageRoot = resolve(tempDir, "package");
      mkdirSync(resolve(fakePackageRoot, "README.md"), { recursive: true });
      writePackageJson(fakePackageRoot, {
        skillDescriptor: "./SKILL.md",
        readme: "./README.md"
      });
      writeFileSync(resolve(fakePackageRoot, "SKILL.md"), "package skill\n");

      expectInstallerFailure(
        () => installWithFixtureHost(fakePackageRoot, resolve(tempDir, "target")),
        "missing-package-asset",
        /must resolve to a file/
      );
    });
  });
});
