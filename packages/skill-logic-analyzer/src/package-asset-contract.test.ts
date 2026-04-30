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
const rootReadmePath = resolve(repoRoot, "README.md");
const expectedAssetKeys: readonly SkillAssetKey[] = ["skillDescriptor", "readme"];
const legacySkillDir = ["skills", "logic-analyzer"].join("/");

const requiredConnectedCaptureDecodeMarkers = [
  "HttpResourceManager",
  "listDecoderCapabilities",
  "captureDecode",
  "/capture/decode",
  "1:uart"
] as const;

const forbiddenDirectLiveCapturePatterns = [
  /\b(?:run|invoke|execute|call|use|shell out to)\s+`?dsview-cli\s+capture\b/i,
  /\bdsview-cli\s+capture\b[^.\n]*(?:live|connected|UART|protocol-log|protocol log)/i,
  /(?:live|connected|UART|protocol-log|protocol log)[^.\n]*\bdsview-cli\s+capture\b/i
] as const;

const negatedDirectCaptureGuidancePattern =
  /(?:do not|don't|never|not|instead of|rather than)[^.\n]*\bdsview-cli\s+capture\b|\bdsview-cli\s+capture\b[^.\n]*(?:instead of|rather than)/i;

const assertNoDirectLiveCaptureGuidance = (assetName: string, content: string) => {
  const sentences = content.split(/(?<=[.!?])\s+|\n+/u).filter(Boolean);

  for (const sentence of sentences) {
    if (negatedDirectCaptureGuidancePattern.test(sentence)) {
      continue;
    }

    for (const pattern of forbiddenDirectLiveCapturePatterns) {
      const match = sentence.match(pattern);

      if (match) {
        throw new Error(
          `${assetName} contains forbidden direct live dsview-cli capture guidance: "${match[0]}".`
        );
      }
    }
  }
};

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

  if (value.includes(legacySkillDir)) {
    throw new Error(
      `Package metadata key "listenai.skillAssets.${key}" still points at root-owned skill content: "${value}".`
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

  it("keeps the package docs and root README aligned on the canonical package surface", () => {
    const packageReadme = readFileSync(packageReadmePath, "utf8");
    const packageSkill = readFileSync(packageSkillPath, "utf8");
    const rootReadme = readFileSync(rootReadmePath, "utf8");

    expect(packageReadme).toContain("canonical home of the logic-analyzer host assets");
    expect(packageReadme).toContain('from "@listenai/eaw-skill-logic-analyzer"');
    expect(packageReadme).toContain("document and import the package-owned surface directly");
    expect(packageReadme).toContain("Decode output is additive");
    expect(packageReadme).toContain("Resource-manager remains the live capture authority");
    expect(packageReadme).not.toContain(`./${legacySkillDir}/README.md`);

    expect(packageSkill).toContain("authoritative host-facing assets");
    expect(packageSkill).toContain("@listenai/eaw-skill-logic-analyzer");
    expect(packageSkill).toContain("treat the package-owned documentation and exports as the source of truth");
    expect(packageSkill).toContain("optional offline protocol decode");
    expect(packageSkill).toContain("Resource-manager remains responsible for hardware allocation");
    expect(packageSkill).not.toContain(`${legacySkillDir}/`);

    expect(rootReadme).toContain("packages/skill-logic-analyzer/README.md");
    expect(rootReadme).toContain("ListenAI Embedded Agent Workbench");
    expect(rootReadme).toContain("CONTRIBUTING.md");
    expect(rootReadme).not.toContain(`./${legacySkillDir}/README.md`);
  });

  it("documents connected protocol-log capture-decode through resource-manager", () => {
    const packageReadme = readFileSync(packageReadmePath, "utf8");
    const packageSkill = readFileSync(packageSkillPath, "utf8");
    const combinedAssets = `${packageReadme}
${packageSkill}`;

    for (const marker of requiredConnectedCaptureDecodeMarkers) {
      expect(combinedAssets, `Missing connected capture-decode marker ${marker}.`).toContain(marker);
    }

    expect(packageReadme).toContain('from "@listenai/eaw-resource-client"');
    expect(packageReadme).toContain("resourceManager.listDecoderCapabilities");
    expect(packageReadme).toContain("resourceManager.captureDecode");
    expect(packageReadme).toContain("decodeResult.diagnostics.phase");
    expect(packageReadme).toContain("decodeResult.decode.rows");
    expect(packageReadme).toContain("decodeResult.decode.annotations");
    expect(packageSkill).toContain("resource-manager owns connected capture+decode");
    expect(packageSkill).toContain("fail closed");
    expect(packageReadme).toContain("Never search parent directories for a source checkout");
    expect(packageReadme).toContain("eaw-resource-manager start --daemon");
    expect(packageReadme).toContain("decode.raw.text");
    expect(packageSkill).toContain("never discover or execute a sibling source checkout");
    expect(packageSkill).toContain("eaw-resource-manager start --daemon");
    expect(packageSkill).toContain("decode.raw.text");
    expect(packageSkill).toContain("offline artifact-only");
  });

  it("rejects direct live dsview-cli capture instructions while allowing offline decode wording", () => {
    const packageReadme = readFileSync(packageReadmePath, "utf8");
    const packageSkill = readFileSync(packageSkillPath, "utf8");

    expect(packageReadme).not.toContain("../listenai_agent_skills/packages/resource-manager");
    expect(packageSkill).not.toContain("../listenai_agent_skills/packages/resource-manager");

    expect(() => assertNoDirectLiveCaptureGuidance("README.md", packageReadme)).not.toThrow();
    expect(() => assertNoDirectLiveCaptureGuidance("SKILL.md", packageSkill)).not.toThrow();
    expect(packageReadme).toContain("dsview-cli decode run");
    expect(packageSkill).toContain("dsview-cli decode run");

    expect(() =>
      assertNoDirectLiveCaptureGuidance(
        "fixture",
        "For a connected UART protocol log, run dsview-cli capture and then decode it."
      )
    ).toThrowError(/forbidden direct live dsview-cli capture guidance/);
    expect(() =>
      assertNoDirectLiveCaptureGuidance(
        "fixture",
        "The runtime diagnostic string 'dsview-cli capture timed out' is allowed when it reports a historical failure."
      )
    ).not.toThrow();
    expect(() =>
      assertNoDirectLiveCaptureGuidance(
        "fixture",
        "For an offline artifact, dsview-cli decode run may decode a saved VCD fixture."
      )
    ).not.toThrow();
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
            skillDescriptor: `../../${legacySkillDir}/SKILL.md`
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
            readme: `./${legacySkillDir}/README.md`
          }
        }
      })
    ).toThrowError(
      `Package metadata key "listenai.skillAssets.readme" still points at root-owned skill content: "./${legacySkillDir}/README.md".`
    );
  });

  it("keeps the package barrel as the canonical runtime surface", () => {
    expect(typeof packageRoot.createGenericLogicAnalyzerSkill).toBe("function");
    expect(typeof packageRoot.runGenericLogicAnalyzer).toBe("function");
    expect(typeof packageRoot.createLogicAnalyzerSkill).toBe("function");
    expect(typeof packageRoot.listDsviewDecoders).toBe("function");
    expect(typeof packageRoot.inspectDsviewDecoder).toBe("function");
    expect(typeof packageRoot.runDsviewDecoder).toBe("function");
    expect(packageRoot.DSVIEW_DECODER_RUN_PHASES).toEqual([
      "decode-validation",
      "decode-run"
    ]);
    expect(packageRoot.GENERIC_LOGIC_ANALYZER_PHASES).toEqual([
      "request-validation",
      "start-session",
      "live-capture",
      "load-capture",
      "decode-validation",
      "decode-run",
      "completed"
    ]);
  });
});
