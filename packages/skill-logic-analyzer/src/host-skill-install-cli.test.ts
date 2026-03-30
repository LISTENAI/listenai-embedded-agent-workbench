import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

type HostCliCase = {
  name: "Claude" | "Codex";
  logPrefix: string;
  targetDirectoryLabel: string;
  usage: string;
  cliPath: string;
};

type CliRunResult = {
  status: number | null;
  stdout: string;
  stderr: string;
};

const workspaceRoot = resolve(import.meta.dirname, "..", "..", "..");
const packageDir = resolve(workspaceRoot, "packages", "skill-logic-analyzer");

const hostCases: readonly HostCliCase[] = [
  {
    name: "Claude",
    logPrefix: "[logic-analyzer/claude-install]",
    targetDirectoryLabel: "target Claude skills directory",
    usage:
      "Usage: listenai-logic-analyzer-install-claude <claude-skills-directory>",
    cliPath: resolve(packageDir, "src", "claude-skill-install-cli.ts")
  },
  {
    name: "Codex",
    logPrefix: "[logic-analyzer/codex-install]",
    targetDirectoryLabel: "target Codex skills directory",
    usage:
      "Usage: listenai-logic-analyzer-install-codex <codex-skills-directory>",
    cliPath: resolve(packageDir, "src", "codex-skill-install-cli.ts")
  }
] as const;

const createTempDir = (prefix: string) => mkdtempSync(resolve(tmpdir(), `${prefix}-`));

const withTempDir = <T>(prefix: string, callback: (tempDir: string) => T): T => {
  const tempDir = createTempDir(prefix);

  try {
    return callback(tempDir);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
};

const runCli = (hostCase: HostCliCase, args: string[]): CliRunResult => {
  const result = spawnSync(process.execPath, ["--import", "tsx", hostCase.cliPath, ...args], {
    cwd: workspaceRoot,
    encoding: "utf8",
    timeout: 5_000
  });

  if (result.error) {
    throw result.error;
  }

  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr
  };
};

describe("host skill install CLIs", () => {
  it.each(hostCases)(
    "prints the documented usage string for malformed argv on $name",
    (hostCase) => {
      const missingArgument = runCli(hostCase, []);

      expect(missingArgument.status).toBe(1);
      expect(missingArgument.stdout).toBe("");
      expect(missingArgument.stderr).toContain(
        `${hostCase.logPrefix} FAIL invalid-target-path: ${hostCase.usage}`
      );

      const emptyArgument = runCli(hostCase, [""]);

      expect(emptyArgument.status).toBe(1);
      expect(emptyArgument.stdout).toBe("");
      expect(emptyArgument.stderr).toContain(
        `${hostCase.logPrefix} FAIL invalid-target-path: ${hostCase.name} skills directory argument must be a non-empty path string.`
      );
      expect(emptyArgument.stderr).not.toContain(hostCases.find((candidate) => candidate !== hostCase)?.usage ?? "");
    }
  );

  it.each(hostCases)(
    "prints the documented success diagnostics for $name installs",
    (hostCase) => {
      withTempDir(`host-cli-success-${hostCase.name.toLowerCase()}`, (tempDir) => {
        const targetDirectory = resolve(
          tempDir,
          hostCase.name === "Claude" ? ".claude" : ".codex",
          "skills"
        );

        const result = runCli(hostCase, [targetDirectory]);
        const destinationDirectory = resolve(targetDirectory, "logic-analyzer");

        expect(result.status).toBe(0);
        expect(result.stderr).toBe("");
        expect(result.stdout).toContain(
          `${hostCase.logPrefix} OK installed ${hostCase.name} skill into "${destinationDirectory}".`
        );
        expect(result.stdout).toContain(
          `${hostCase.logPrefix} ${hostCase.targetDirectoryLabel}: ${targetDirectory}`
        );
        expect(result.stdout).toContain(
          `${hostCase.logPrefix} copied skillDescriptor: ${resolve(packageDir, "SKILL.md")} -> ${resolve(destinationDirectory, "SKILL.md")}`
        );
        expect(result.stdout).toContain(
          `${hostCase.logPrefix} copied readme: ${resolve(packageDir, "README.md")} -> ${resolve(destinationDirectory, "README.md")}`
        );
        expect(readFileSync(resolve(destinationDirectory, "SKILL.md"), "utf8")).toBe(
          readFileSync(resolve(packageDir, "SKILL.md"), "utf8")
        );
        expect(readFileSync(resolve(destinationDirectory, "README.md"), "utf8")).toBe(
          readFileSync(resolve(packageDir, "README.md"), "utf8")
        );
      });
    }
  );

  it.each(hostCases)(
    "prints host-specific failure diagnostics for invalid targets and collisions on $name",
    (hostCase) => {
      withTempDir(`host-cli-failure-${hostCase.name.toLowerCase()}`, (tempDir) => {
        const invalidTargetPath = resolve(tempDir, "not-a-directory");
        writeFileSync(invalidTargetPath, "collision\n");

        const invalidTargetResult = runCli(hostCase, [invalidTargetPath]);

        expect(invalidTargetResult.status).toBe(1);
        expect(invalidTargetResult.stdout).toBe("");
        expect(invalidTargetResult.stderr).toContain(
          `${hostCase.logPrefix} FAIL invalid-target-directory: ${hostCase.name} skills directory must be a directory: "${invalidTargetPath}".`
        );

        const targetDirectory = resolve(
          tempDir,
          hostCase.name === "Claude" ? ".claude" : ".codex",
          "skills"
        );
        mkdirSync(targetDirectory, { recursive: true });
        writeFileSync(resolve(targetDirectory, "logic-analyzer"), "already here\n");

        const collisionResult = runCli(hostCase, [targetDirectory]);

        expect(collisionResult.status).toBe(1);
        expect(collisionResult.stdout).toBe("");
        expect(collisionResult.stderr).toContain(
          `${hostCase.logPrefix} FAIL destination-collision: Destination collision at "${resolve(targetDirectory, "logic-analyzer")}".`
        );
      });
    }
  );
});
