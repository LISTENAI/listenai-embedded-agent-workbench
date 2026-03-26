import type {
  EndLogicAnalyzerSessionResult,
  LogicAnalyzerSessionRecord,
  StartLogicAnalyzerSessionResult
} from "./contracts.js";
import {
  validateEndLogicAnalyzerSessionRequest,
  validateStartLogicAnalyzerSessionRequest
} from "./contracts.js";
import type { ResourceManager } from "../resource-manager/resource-manager.js";

export interface LogicAnalyzerSkill {
  startSession(request: unknown): Promise<StartLogicAnalyzerSessionResult>;
  endSession(request: unknown): EndLogicAnalyzerSessionResult;
}

export interface LogicAnalyzerSkillOptions {
  createSessionId?: () => string;
}

const buildSessionRecord = (
  sessionId: string,
  device: LogicAnalyzerSessionRecord["device"],
  requestedAt: string,
  ownerSkillId: string,
  sampling: LogicAnalyzerSessionRecord["sampling"],
  analysis: LogicAnalyzerSessionRecord["analysis"]
): LogicAnalyzerSessionRecord => ({
  sessionId,
  deviceId: device.deviceId,
  ownerSkillId,
  startedAt: requestedAt,
  device,
  sampling,
  analysis
});

export const createLogicAnalyzerSkill = (
  resourceManager: ResourceManager,
  options: LogicAnalyzerSkillOptions = {}
): LogicAnalyzerSkill => {
  let generatedSessionCount = 0;
  const createSessionId =
    options.createSessionId ??
    (() => {
      generatedSessionCount += 1;
      return `logic-analyzer-session-${generatedSessionCount}`;
    });

  return {
    async startSession(request: unknown): Promise<StartLogicAnalyzerSessionResult> {
      const validation = validateStartLogicAnalyzerSessionRequest(request);
      if (!validation.ok) {
        return {
          ok: false,
          reason: "invalid-request",
          issues: validation.issues
        };
      }

      const inventory = await resourceManager.refreshInventory();
      const allocation = resourceManager.allocateDevice({
        deviceId: validation.value.deviceId,
        ownerSkillId: validation.value.ownerSkillId,
        requestedAt: validation.value.requestedAt
      });

      if (!allocation.ok) {
        return {
          ok: false,
          reason: "allocation-failed",
          allocation,
          inventory
        };
      }

      return {
        ok: true,
        session: buildSessionRecord(
          createSessionId(),
          allocation.device,
          validation.value.requestedAt,
          validation.value.ownerSkillId,
          validation.value.sampling,
          validation.value.analysis
        )
      };
    },

    endSession(request: unknown): EndLogicAnalyzerSessionResult {
      const validation = validateEndLogicAnalyzerSessionRequest(request);
      if (!validation.ok) {
        return {
          ok: false,
          reason: "invalid-request",
          issues: validation.issues
        };
      }

      const release = resourceManager.releaseDevice({
        deviceId: validation.value.deviceId,
        ownerSkillId: validation.value.ownerSkillId,
        releasedAt: validation.value.endedAt
      });

      if (!release.ok) {
        return {
          ok: false,
          reason: "release-failed",
          release
        };
      }

      return {
        ok: true,
        device: release.device
      };
    }
  };
};
