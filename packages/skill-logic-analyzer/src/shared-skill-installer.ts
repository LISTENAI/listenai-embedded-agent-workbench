import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, resolve, sep } from "node:path";

export const PACKAGE_METADATA_KEY_PREFIX = "listenai.skillAssets";
export const SKILL_DIRECTORY_NAME = "logic-analyzer";
export const EXPECTED_SKILL_ASSETS = {
  skillDescriptor: "./SKILL.md",
  readme: "./README.md"
} as const;

export type SharedSkillAssetKey = keyof typeof EXPECTED_SKILL_ASSETS;

export type SharedSkillInstallerErrorCode =
  | "copy-failed"
  | "destination-collision"
  | "invalid-package-metadata"
  | "invalid-target-directory"
  | "invalid-target-path"
  | "missing-package-asset";

type SkillPackageMetadata = {
  listenai?: {
    skillAssets?: Partial<Record<SharedSkillAssetKey, unknown>>;
  };
};

export type SharedResolvedSkillAsset = {
  key: SharedSkillAssetKey;
  declaredPath: string;
  expectedRelativePath: (typeof EXPECTED_SKILL_ASSETS)[SharedSkillAssetKey];
  sourcePath: string;
};

export type SharedSkillInstallResult = {
  targetDirectory: string;
  destinationDirectory: string;
  packageRoot: string;
  packageJsonPath: string;
  copiedFiles: Array<SharedResolvedSkillAsset & { destinationPath: string }>;
};

type SharedInstallerFail = (
  code: SharedSkillInstallerErrorCode,
  message: string
) => never;

export type SharedSkillInstallerOptions = {
  targetDirectory: string;
  packageRoot: string;
  fail: SharedInstallerFail;
  hostDisplayName: string;
};

const readPackageMetadata = (
  packageJsonPath: string,
  fail: SharedInstallerFail
): SkillPackageMetadata => {
  try {
    const packageJsonText = readFileSync(packageJsonPath, "utf8");
    return JSON.parse(packageJsonText) as SkillPackageMetadata;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fail(
      "invalid-package-metadata",
      `Unable to read or parse package metadata at "${packageJsonPath}": ${message}`
    );
  }
};

const resolveDeclaredAsset = (
  packageRoot: string,
  metadata: SkillPackageMetadata,
  key: SharedSkillAssetKey,
  fail: SharedInstallerFail
): SharedResolvedSkillAsset => {
  const metadataKey = `${PACKAGE_METADATA_KEY_PREFIX}.${key}`;
  const declaredPathValue = metadata.listenai?.skillAssets?.[key];
  const expectedRelativePath = EXPECTED_SKILL_ASSETS[key];

  if (declaredPathValue === undefined) {
    fail(
      "invalid-package-metadata",
      `Missing metadata key "${metadataKey}". Expected package-relative path "${expectedRelativePath}".`
    );
  }

  if (typeof declaredPathValue !== "string") {
    fail(
      "invalid-package-metadata",
      `Metadata key "${metadataKey}" must be a string. Expected package-relative path "${expectedRelativePath}", received ${typeof declaredPathValue}.`
    );
  }

  const declaredPath = declaredPathValue as string;

  if (declaredPath.trim().length === 0) {
    fail(
      "invalid-package-metadata",
      `Metadata key "${metadataKey}" cannot be empty. Expected package-relative path "${expectedRelativePath}".`
    );
  }

  if (isAbsolute(declaredPath)) {
    fail(
      "invalid-package-metadata",
      `Metadata key "${metadataKey}" must stay package-relative. Expected "${expectedRelativePath}", received absolute path "${declaredPath}".`
    );
  }

  if (declaredPath.includes("skills/logic-analyzer")) {
    fail(
      "invalid-package-metadata",
      `Metadata key "${metadataKey}" still points at root-owned assets. Expected "${expectedRelativePath}", received "${declaredPath}".`
    );
  }

  const sourcePath = resolve(packageRoot, declaredPath);
  const packageRootPrefix = `${packageRoot}${sep}`;

  if (sourcePath !== packageRoot && !sourcePath.startsWith(packageRootPrefix)) {
    fail(
      "invalid-package-metadata",
      `Metadata key "${metadataKey}" escapes the package root: "${declaredPath}" -> "${sourcePath}".`
    );
  }

  if (declaredPath !== expectedRelativePath) {
    fail(
      "invalid-package-metadata",
      `Metadata key "${metadataKey}" drifted to "${declaredPath}". Expected "${expectedRelativePath}".`
    );
  }

  if (!existsSync(sourcePath)) {
    fail(
      "missing-package-asset",
      `Metadata key "${metadataKey}" resolves to missing file "${sourcePath}".`
    );
  }

  if (!statSync(sourcePath).isFile()) {
    fail(
      "missing-package-asset",
      `Metadata key "${metadataKey}" must resolve to a file, received "${sourcePath}".`
    );
  }

  return {
    key,
    declaredPath,
    expectedRelativePath,
    sourcePath
  };
};

const resolveTargetDirectories = (
  targetDirectory: string,
  hostDisplayName: string,
  fail: SharedInstallerFail
) => {
  if (typeof targetDirectory !== "string" || targetDirectory.trim().length === 0) {
    fail(
      "invalid-target-path",
      `${hostDisplayName} skills directory argument must be a non-empty path string.`
    );
  }

  const resolvedTargetDirectory = resolve(targetDirectory);

  if (existsSync(resolvedTargetDirectory) && !statSync(resolvedTargetDirectory).isDirectory()) {
    fail(
      "invalid-target-directory",
      `${hostDisplayName} skills directory must be a directory: "${resolvedTargetDirectory}".`
    );
  }

  try {
    mkdirSync(resolvedTargetDirectory, { recursive: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fail(
      "invalid-target-directory",
      `Unable to prepare ${hostDisplayName} skills directory "${resolvedTargetDirectory}": ${message}`
    );
  }

  const destinationDirectory = resolve(resolvedTargetDirectory, SKILL_DIRECTORY_NAME);

  if (existsSync(destinationDirectory)) {
    fail(
      "destination-collision",
      `Destination collision at "${destinationDirectory}". Remove the existing entry before installing.`
    );
  }

  return {
    targetDirectory: resolvedTargetDirectory,
    destinationDirectory
  };
};

export const installSharedSkill = (
  options: SharedSkillInstallerOptions
): SharedSkillInstallResult => {
  const packageRoot = resolve(options.packageRoot);
  const packageJsonPath = resolve(packageRoot, "package.json");
  const { fail, hostDisplayName } = options;
  const { targetDirectory, destinationDirectory } = resolveTargetDirectories(
    options.targetDirectory,
    hostDisplayName,
    fail
  );
  const metadata = readPackageMetadata(packageJsonPath, fail);
  const resolvedAssets = (Object.keys(EXPECTED_SKILL_ASSETS) as SharedSkillAssetKey[]).map(
    (key) => resolveDeclaredAsset(packageRoot, metadata, key, fail)
  );

  try {
    mkdirSync(destinationDirectory, { recursive: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fail(
      "destination-collision",
      `Unable to create destination directory "${destinationDirectory}": ${message}`
    );
  }

  try {
    const copiedFiles = resolvedAssets.map((asset) => {
      const fileName = asset.expectedRelativePath.replace(/^\.\//, "");
      const destinationPath = resolve(destinationDirectory, fileName);

      copyFileSync(asset.sourcePath, destinationPath);

      return {
        ...asset,
        destinationPath
      };
    });

    return {
      targetDirectory,
      destinationDirectory,
      packageRoot,
      packageJsonPath,
      copiedFiles
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fail(
      "copy-failed",
      `Failed to copy package-owned ${hostDisplayName} assets into "${destinationDirectory}": ${message}`
    );
  }
};
