import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  EXPECTED_SKILL_ASSETS,
  PACKAGE_METADATA_KEY_PREFIX,
  SKILL_DIRECTORY_NAME,
  installSharedSkill,
  type SharedResolvedSkillAsset,
  type SharedSkillAssetKey,
  type SharedSkillInstallResult,
  type SharedSkillInstallerErrorCode
} from "./shared-skill-installer.js";

const INSTALLER_LOG_PREFIX = "[logic-analyzer/codex-install]";

export type CodexSkillAssetKey = SharedSkillAssetKey;

export type CodexSkillInstallerErrorCode = SharedSkillInstallerErrorCode;

export class CodexSkillInstallerError extends Error {
  readonly name = "CodexSkillInstallerError";

  constructor(
    readonly code: CodexSkillInstallerErrorCode,
    message: string
  ) {
    super(message);
  }
}

export type ResolvedCodexSkillAsset = SharedResolvedSkillAsset;

export type CodexSkillInstallResult = SharedSkillInstallResult;

export type InstallCodexSkillOptions = {
  targetDirectory: string;
  packageRoot?: string;
};

const defaultPackageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const fail = (code: CodexSkillInstallerErrorCode, message: string): never => {
  throw new CodexSkillInstallerError(code, message);
};

export const installCodexSkill = (
  options: InstallCodexSkillOptions
): CodexSkillInstallResult =>
  installSharedSkill({
    targetDirectory: options.targetDirectory,
    packageRoot: options.packageRoot ?? defaultPackageRoot,
    hostDisplayName: "Codex",
    fail
  });

export const formatCodexSkillInstallSuccess = (
  result: CodexSkillInstallResult
): string =>
  [
    `${INSTALLER_LOG_PREFIX} OK installed Codex skill into "${result.destinationDirectory}".`,
    `${INSTALLER_LOG_PREFIX} package root: ${result.packageRoot}`,
    `${INSTALLER_LOG_PREFIX} package metadata: ${result.packageJsonPath}`,
    `${INSTALLER_LOG_PREFIX} target Codex skills directory: ${result.targetDirectory}`,
    ...result.copiedFiles.map(
      (asset) =>
        `${INSTALLER_LOG_PREFIX} copied ${asset.key}: ${asset.sourcePath} -> ${asset.destinationPath}`
    )
  ].join("\n");

export const formatCodexSkillInstallFailure = (error: unknown): string => {
  if (error instanceof CodexSkillInstallerError) {
    return `${INSTALLER_LOG_PREFIX} FAIL ${error.code}: ${error.message}`;
  }

  const message = error instanceof Error ? error.message : String(error);
  return `${INSTALLER_LOG_PREFIX} FAIL unexpected-error: ${message}`;
};

export const CODEX_SKILL_INSTALLER_CONTRACT = {
  skillName: SKILL_DIRECTORY_NAME,
  packageMetadataKeyPrefix: PACKAGE_METADATA_KEY_PREFIX,
  expectedAssets: EXPECTED_SKILL_ASSETS,
  logPrefix: INSTALLER_LOG_PREFIX
} as const;
