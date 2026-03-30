#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LEGACY_SKILL_DIR = ["skills", "logic-analyzer"].join("/");
const EXPECTED_ASSETS = {
  skillDescriptor: "./SKILL.md",
  readme: "./README.md"
};

function readJson(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse ${relative(DEFAULT_REPO_ROOT, filePath)}: ${message}`);
  }
}

function assertInsideDirectory(baseDir, candidatePath, label) {
  const basePrefix = `${baseDir}${sep}`;

  if (candidatePath === baseDir || candidatePath.startsWith(basePrefix)) {
    return;
  }

  throw new Error(`${label} escapes the package root: "${candidatePath}".`);
}

export function resolveDeclaredAsset(packageDir, metadata, key) {
  const metadataKey = `listenai.skillAssets.${key}`;
  const declaredPath = metadata?.listenai?.skillAssets?.[key];
  const expectedRelativePath = EXPECTED_ASSETS[key];

  if (declaredPath === undefined) {
    throw new Error(`Missing metadata key "${metadataKey}". Expected package-relative path "${expectedRelativePath}".`);
  }

  if (typeof declaredPath !== "string") {
    throw new Error(`Metadata key "${metadataKey}" must be a string. Expected package-relative path "${expectedRelativePath}", received ${typeof declaredPath}.`);
  }

  if (declaredPath.trim().length === 0) {
    throw new Error(`Metadata key "${metadataKey}" cannot be empty. Expected package-relative path "${expectedRelativePath}".`);
  }

  if (isAbsolute(declaredPath)) {
    throw new Error(`Metadata key "${metadataKey}" must stay package-relative. Expected "${expectedRelativePath}", received absolute path "${declaredPath}".`);
  }

  const resolvedPath = resolve(packageDir, declaredPath);
  assertInsideDirectory(packageDir, resolvedPath, `Metadata key "${metadataKey}"`);

  if (declaredPath.includes(LEGACY_SKILL_DIR)) {
    throw new Error(`Metadata key "${metadataKey}" still points at root-owned assets. Expected "${expectedRelativePath}", received "${declaredPath}".`);
  }

  if (!existsSync(resolvedPath)) {
    throw new Error(`Metadata key "${metadataKey}" resolves to missing file "${declaredPath}" (expected "${expectedRelativePath}").`);
  }

  return {
    key,
    declaredPath,
    expectedRelativePath,
    resolvedPath
  };
}

export function validateSkillPackageAssets(repoRoot = DEFAULT_REPO_ROOT) {
  const packageDir = resolve(repoRoot, "packages", "skill-logic-analyzer");
  const packageJsonPath = resolve(packageDir, "package.json");

  if (!existsSync(packageJsonPath)) {
    throw new Error(`Missing package metadata file "${relative(repoRoot, packageJsonPath)}".`);
  }

  const packageJson = readJson(packageJsonPath);
  const assets = Object.keys(EXPECTED_ASSETS).map((key) =>
    resolveDeclaredAsset(packageDir, packageJson, key)
  );

  return {
    repoRoot,
    packageDir,
    packageJsonPath,
    assets
  };
}

export function formatValidationSuccess(result) {
  return [
    "[check-skill-package-assets] OK skill package metadata resolves package-owned assets:",
    ...result.assets.map(
      (asset) =>
        `- ${asset.key}: ${asset.declaredPath} -> ${relative(result.repoRoot, asset.resolvedPath)}`
    )
  ].join("\n");
}

function runCli() {
  try {
    const result = validateSkillPackageAssets();
    console.log(formatValidationSuccess(result));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[check-skill-package-assets] FAIL ${message}`);
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
const thisFilePath = fileURLToPath(import.meta.url);

if (invokedPath === thisFilePath) {
  runCli();
}
