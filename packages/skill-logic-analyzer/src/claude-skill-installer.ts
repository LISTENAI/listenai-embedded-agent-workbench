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

const INSTALLER_LOG_PREFIX = "[logic-analyzer/claude-install]";

export type ClaudeSkillAssetKey = SharedSkillAssetKey;

export type ClaudeSkillInstallerErrorCode = SharedSkillInstallerErrorCode;

export class ClaudeSkillInstallerError extends Error {
  readonly name = "ClaudeSkillInstallerError";

  constructor(
    readonly code: ClaudeSkillInstallerErrorCode,
    message: string
  ) {
    super(message);
  }
}

export type ResolvedClaudeSkillAsset = SharedResolvedSkillAsset;

export type ClaudeSkillInstallResult = SharedSkillInstallResult;

export type InstallClaudeSkillOptions = {
  targetDirectory: string;
  packageRoot?: string;
};

const defaultPackageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const fail = (code: ClaudeSkillInstallerErrorCode, message: string): never => {
  throw new ClaudeSkillInstallerError(code, message);
};

export const installClaudeSkill = (
  options: InstallClaudeSkillOptions
): ClaudeSkillInstallResult =>
  installSharedSkill({
    targetDirectory: options.targetDirectory,
    packageRoot: options.packageRoot ?? defaultPackageRoot,
    hostDisplayName: "Claude",
    fail
  });

export const formatClaudeSkillInstallSuccess = (
  result: ClaudeSkillInstallResult
): string =>
  [
    `${INSTALLER_LOG_PREFIX} OK installed Claude skill into "${result.destinationDirectory}".`,
    `${INSTALLER_LOG_PREFIX} package root: ${result.packageRoot}`,
    `${INSTALLER_LOG_PREFIX} package metadata: ${result.packageJsonPath}`,
    `${INSTALLER_LOG_PREFIX} target Claude skills directory: ${result.targetDirectory}`,
    ...result.copiedFiles.map(
      (asset) =>
        `${INSTALLER_LOG_PREFIX} copied ${asset.key}: ${asset.sourcePath} -> ${asset.destinationPath}`
    )
  ].join("\n");

export const formatClaudeSkillInstallFailure = (error: unknown): string => {
  if (error instanceof ClaudeSkillInstallerError) {
    return `${INSTALLER_LOG_PREFIX} FAIL ${error.code}: ${error.message}`;
  }

  const message = error instanceof Error ? error.message : String(error);
  return `${INSTALLER_LOG_PREFIX} FAIL unexpected-error: ${message}`;
};

export const CLAUDE_SKILL_INSTALLER_CONTRACT = {
  skillName: SKILL_DIRECTORY_NAME,
  packageMetadataKeyPrefix: PACKAGE_METADATA_KEY_PREFIX,
  expectedAssets: EXPECTED_SKILL_ASSETS,
  logPrefix: INSTALLER_LOG_PREFIX
} as const;
