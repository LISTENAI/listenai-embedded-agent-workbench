#!/usr/bin/env node
import {
  formatClaudeSkillInstallFailure,
  formatClaudeSkillInstallSuccess,
  installClaudeSkill
} from "./claude-skill-installer.js";

const targetDirectory = process.argv[2];

if (process.argv.length !== 3 || typeof targetDirectory !== "string") {
  console.error(
    "[logic-analyzer/claude-install] FAIL invalid-target-path: Usage: listenai-logic-analyzer-install-claude <claude-skills-directory>"
  );
  process.exitCode = 1;
} else {
  try {
    const result = installClaudeSkill({ targetDirectory });
    console.log(formatClaudeSkillInstallSuccess(result));
  } catch (error) {
    console.error(formatClaudeSkillInstallFailure(error));
    process.exitCode = 1;
  }
}
