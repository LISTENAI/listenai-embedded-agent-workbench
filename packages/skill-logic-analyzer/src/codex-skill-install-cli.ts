#!/usr/bin/env node
import {
  formatCodexSkillInstallFailure,
  formatCodexSkillInstallSuccess,
  installCodexSkill
} from "./codex-skill-installer.js";

const targetDirectory = process.argv[2];

if (process.argv.length !== 3 || typeof targetDirectory !== "string") {
  console.error(
    "[logic-analyzer/codex-install] FAIL invalid-target-path: Usage: listenai-logic-analyzer-install-codex <codex-skills-directory>"
  );
  process.exitCode = 1;
} else {
  try {
    const result = installCodexSkill({ targetDirectory });
    console.log(formatCodexSkillInstallSuccess(result));
  } catch (error) {
    console.error(formatCodexSkillInstallFailure(error));
    process.exitCode = 1;
  }
}
