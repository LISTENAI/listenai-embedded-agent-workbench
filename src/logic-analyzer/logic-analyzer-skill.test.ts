import { describe, expect, expectTypeOf, it } from "vitest";

import {
  ANALYSIS_EDGE_POLICIES,
  ANALYSIS_TIME_REFERENCES,
  FakeDeviceProvider,
  LOGIC_ANALYZER_END_FAILURE_REASONS,
  LOGIC_ANALYZER_START_FAILURE_REASONS,
  VALIDATION_ISSUE_CODES,
  createLogicAnalyzerSkill,
  createResourceManager,
  type EndLogicAnalyzerSessionResult,
  type LogicAnalyzerSessionRecord,
  type LogicAnalyzerValidationIssue,
  type StartLogicAnalyzerSessionRequest,
  type StartLogicAnalyzerSessionResult,
  validateEndLogicAnalyzerSessionRequest,
  validateStartLogicAnalyzerSessionRequest
} from "../index.js";

const connectedAt = "2026-03-26T00:00:00.000Z";
const allocateAt = "2026-03-26T00:01:00.000Z";
const conflictAt = "2026-03-26T00:01:30.000Z";
const disconnectAt = "2026-03-26T00:02:00.000Z";
const releaseAt = "2026-03-26T00:03:00.000Z";

const baseDevice = {
  deviceId: "logic-1",
  label: "USB Logic Analyzer",
  capabilityType: "logic-analyzer",
  lastSeenAt: connectedAt
} as const;

const createClock = (...timestamps: string[]) => {
  let index = 0;

  return () =>
    timestamps[Math.min(index++, timestamps.length - 1)] ??
    timestamps[timestamps.length - 1] ??
    releaseAt;
};

const createValidRequest = (
  overrides: Partial<StartLogicAnalyzerSessionRequest> = {}
): StartLogicAnalyzerSessionRequest => ({
  deviceId: "logic-1",
  ownerSkillId: "logic-analyzer",
  requestedAt: allocateAt,
  sampling: {
    sampleRateHz: 24_000_000,
    captureDurationMs: 25,
    channels: [
      { channelId: "D0", label: "CLK" },
      { channelId: "D1", label: "MOSI" }
    ]
  },
  analysis: {
    focusChannelIds: ["D0", "D1"],
    edgePolicy: "rising",
    includePulseWidths: true,
    timeReference: "first-transition",
    window: {
      startSampleIndex: 0,
      endSampleIndex: 2000
    }
  },
  ...overrides
});

describe("logic analyzer session contract", () => {
  it("exposes explicit structured session request and result shapes", () => {
    expect(VALIDATION_ISSUE_CODES).toEqual([
      "required",
      "invalid-type",
      "invalid-value",
      "too-small"
    ]);
    expect(LOGIC_ANALYZER_START_FAILURE_REASONS).toEqual([
      "invalid-request",
      "allocation-failed"
    ]);
    expect(LOGIC_ANALYZER_END_FAILURE_REASONS).toEqual([
      "invalid-request",
      "release-failed"
    ]);
    expect(ANALYSIS_EDGE_POLICIES).toEqual(["all", "rising", "falling"]);
    expect(ANALYSIS_TIME_REFERENCES).toEqual([
      "capture-start",
      "first-transition"
    ]);

    expectTypeOf<StartLogicAnalyzerSessionRequest>().toMatchTypeOf<{
      deviceId: string;
      ownerSkillId: string;
      requestedAt: string;
      sampling: {
        sampleRateHz: number;
        captureDurationMs: number;
        channels: readonly { channelId: string; label?: string }[];
      };
      analysis: {
        focusChannelIds: readonly string[];
        edgePolicy: "all" | "rising" | "falling";
        includePulseWidths: boolean;
        timeReference: "capture-start" | "first-transition";
      };
    }>();

    expectTypeOf<LogicAnalyzerSessionRecord>().toMatchTypeOf<{
      sessionId: string;
      deviceId: string;
      ownerSkillId: string;
      startedAt: string;
      sampling: { sampleRateHz: number; captureDurationMs: number };
      analysis: { focusChannelIds: readonly string[] };
      device: { deviceId: string; allocationState: string };
    }>();

    expectTypeOf<StartLogicAnalyzerSessionResult>().toMatchTypeOf<
      | { ok: true; session: LogicAnalyzerSessionRecord }
      | { ok: false; reason: "invalid-request"; issues: readonly LogicAnalyzerValidationIssue[] }
      | { ok: false; reason: "allocation-failed"; inventory: readonly unknown[] }
    >();

    expectTypeOf<EndLogicAnalyzerSessionResult>().toMatchTypeOf<
      | { ok: true; device: { deviceId: string } }
      | { ok: false; reason: "invalid-request"; issues: readonly LogicAnalyzerValidationIssue[] }
      | { ok: false; reason: "release-failed"; release: { deviceId: string } }
    >();
  });

  it("returns explicit validation issues for malformed start-session requests", () => {
    const result = validateStartLogicAnalyzerSessionRequest({
      deviceId: "",
      ownerSkillId: 42,
      requestedAt: null,
      sampling: {
        sampleRateHz: 0,
        captureDurationMs: -5,
        channels: [{ channelId: "" }, { label: 10 }]
      },
      analysis: {
        focusChannelIds: ["clk", 7],
        edgePolicy: "diagonal",
        includePulseWidths: "yes",
        timeReference: "middle",
        window: {
          startSampleIndex: 10,
          endSampleIndex: 3
        }
      }
    });

    expect(result).toMatchObject({
      ok: false
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: "deviceId", code: "required" }),
          expect.objectContaining({
            path: "ownerSkillId",
            code: "invalid-type"
          }),
          expect.objectContaining({ path: "requestedAt", code: "required" }),
          expect.objectContaining({
            path: "sampling.sampleRateHz",
            code: "too-small"
          }),
          expect.objectContaining({
            path: "sampling.captureDurationMs",
            code: "too-small"
          }),
          expect.objectContaining({
            path: "sampling.channels[0].channelId",
            code: "required"
          }),
          expect.objectContaining({
            path: "sampling.channels[1].channelId",
            code: "required"
          }),
          expect.objectContaining({
            path: "sampling.channels[1].label",
            code: "invalid-type"
          }),
          expect.objectContaining({
            path: "analysis.focusChannelIds[1]",
            code: "invalid-type"
          }),
          expect.objectContaining({
            path: "analysis.edgePolicy",
            code: "invalid-value"
          }),
          expect.objectContaining({
            path: "analysis.includePulseWidths",
            code: "invalid-type"
          }),
          expect.objectContaining({
            path: "analysis.timeReference",
            code: "invalid-value"
          }),
          expect.objectContaining({
            path: "analysis.window",
            code: "invalid-value"
          })
        ])
      );
    }
  });

  it("accepts a well-formed start-session request without adapter-specific parsing", () => {
    const result = validateStartLogicAnalyzerSessionRequest(createValidRequest());

    expect(result).toEqual({
      ok: true,
      value: createValidRequest()
    });
  });

  it("returns explicit validation issues for malformed end-session requests", () => {
    const result = validateEndLogicAnalyzerSessionRequest({
      sessionId: "",
      deviceId: null,
      ownerSkillId: "",
      endedAt: 123
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: "sessionId", code: "required" }),
          expect.objectContaining({ path: "deviceId", code: "required" }),
          expect.objectContaining({ path: "ownerSkillId", code: "required" }),
          expect.objectContaining({ path: "endedAt", code: "invalid-type" })
        ])
      );
    }
  });
});

describe("logic analyzer skill", () => {
  it("starts an allocation-backed session for a valid request", async () => {
    const provider = new FakeDeviceProvider([baseDevice]);
    const resourceManager = createResourceManager(provider, {
      now: createClock(connectedAt)
    });
    const skill = createLogicAnalyzerSkill(resourceManager, {
      createSessionId: () => "session-001"
    });

    const result = await skill.startSession(createValidRequest());

    expect(result).toEqual({
      ok: true,
      session: {
        sessionId: "session-001",
        deviceId: "logic-1",
        ownerSkillId: "logic-analyzer",
        startedAt: allocateAt,
        device: {
          deviceId: "logic-1",
          label: "USB Logic Analyzer",
          capabilityType: "logic-analyzer",
          connectionState: "connected",
          allocationState: "allocated",
          ownerSkillId: "logic-analyzer",
          lastSeenAt: connectedAt,
          updatedAt: allocateAt
        },
        sampling: createValidRequest().sampling,
        analysis: createValidRequest().analysis
      }
    });
    expect(resourceManager.listDevices()).toEqual([
      {
        deviceId: "logic-1",
        label: "USB Logic Analyzer",
        capabilityType: "logic-analyzer",
        connectionState: "connected",
        allocationState: "allocated",
        ownerSkillId: "logic-analyzer",
        lastSeenAt: connectedAt,
        updatedAt: allocateAt
      }
    ]);
  });

  it("returns typed validation failures without refreshing or allocating inventory", async () => {
    const provider = new FakeDeviceProvider([baseDevice]);
    const resourceManager = createResourceManager(provider, {
      now: createClock(connectedAt)
    });
    const skill = createLogicAnalyzerSkill(resourceManager);

    const result = await skill.startSession({
      deviceId: "",
      ownerSkillId: "logic-analyzer",
      requestedAt: allocateAt,
      sampling: {
        sampleRateHz: 0,
        captureDurationMs: 25,
        channels: []
      },
      analysis: {
        focusChannelIds: [],
        edgePolicy: "rising",
        includePulseWidths: true,
        timeReference: "capture-start"
      }
    });

    expect(result).toMatchObject({
      ok: false,
      reason: "invalid-request"
    });
    expect(result.ok).toBe(false);
    if (!result.ok && result.reason === "invalid-request") {
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: "deviceId", code: "required" }),
          expect.objectContaining({
            path: "sampling.sampleRateHz",
            code: "too-small"
          }),
          expect.objectContaining({
            path: "sampling.channels",
            code: "too-small"
          })
        ])
      );
    }
    expect(resourceManager.listDevices()).toEqual([]);
  });

  it("returns allocation failures with the current inventory snapshot on conflict", async () => {
    const provider = new FakeDeviceProvider([baseDevice]);
    const resourceManager = createResourceManager(provider, {
      now: createClock(connectedAt, conflictAt)
    });
    const skill = createLogicAnalyzerSkill(resourceManager, {
      createSessionId: () => "session-001"
    });

    const firstStart = await skill.startSession(createValidRequest());
    const secondStart = await skill.startSession(
      createValidRequest({
        ownerSkillId: "other-skill",
        requestedAt: conflictAt
      })
    );

    expect(firstStart.ok).toBe(true);
    expect(secondStart).toMatchObject({
      ok: false,
      reason: "allocation-failed",
      allocation: {
        ok: false,
        reason: "device-already-allocated",
        deviceId: "logic-1",
        ownerSkillId: "other-skill"
      }
    });
    expect(secondStart.ok).toBe(false);
    if (!secondStart.ok && secondStart.reason === "allocation-failed") {
      expect(secondStart.inventory).toEqual([
        {
          deviceId: "logic-1",
          label: "USB Logic Analyzer",
          capabilityType: "logic-analyzer",
          connectionState: "connected",
          allocationState: "allocated",
          ownerSkillId: "logic-analyzer",
          lastSeenAt: connectedAt,
          updatedAt: conflictAt
        }
      ]);
      expect(secondStart.allocation.device).toEqual({
        deviceId: "logic-1",
        label: "USB Logic Analyzer",
        capabilityType: "logic-analyzer",
        connectionState: "connected",
        allocationState: "allocated",
        ownerSkillId: "logic-analyzer",
        lastSeenAt: connectedAt,
        updatedAt: conflictAt
      });
    }
  });

  it("surfaces missing-device allocation failures with an empty inventory snapshot", async () => {
    const provider = new FakeDeviceProvider([]);
    const resourceManager = createResourceManager(provider, {
      now: createClock(connectedAt)
    });
    const skill = createLogicAnalyzerSkill(resourceManager);

    const result = await skill.startSession(createValidRequest());

    expect(result).toMatchObject({
      ok: false,
      reason: "allocation-failed",
      allocation: {
        ok: false,
        reason: "device-not-found",
        deviceId: "logic-1",
        ownerSkillId: "logic-analyzer",
        device: null
      },
      inventory: []
    });
  });

  it("surfaces disconnected-device allocation failures with the disconnected snapshot intact", async () => {
    const provider = new FakeDeviceProvider([baseDevice]);
    const resourceManager = createResourceManager(provider, {
      now: createClock(connectedAt, disconnectAt)
    });
    const skill = createLogicAnalyzerSkill(resourceManager, {
      createSessionId: () => "session-001"
    });

    const firstStart = await skill.startSession(createValidRequest());
    provider.setConnectedDevices([]);
    const secondStart = await skill.startSession(
      createValidRequest({
        ownerSkillId: "other-skill",
        requestedAt: disconnectAt
      })
    );

    expect(firstStart.ok).toBe(true);
    expect(secondStart).toMatchObject({
      ok: false,
      reason: "allocation-failed",
      allocation: {
        ok: false,
        reason: "device-disconnected",
        deviceId: "logic-1",
        ownerSkillId: "other-skill"
      }
    });
    expect(secondStart.ok).toBe(false);
    if (!secondStart.ok && secondStart.reason === "allocation-failed") {
      expect(secondStart.inventory).toEqual([
        {
          deviceId: "logic-1",
          label: "USB Logic Analyzer",
          capabilityType: "logic-analyzer",
          connectionState: "disconnected",
          allocationState: "allocated",
          ownerSkillId: "logic-analyzer",
          lastSeenAt: connectedAt,
          updatedAt: disconnectAt
        }
      ]);
      expect(secondStart.allocation.device).toEqual({
        deviceId: "logic-1",
        label: "USB Logic Analyzer",
        capabilityType: "logic-analyzer",
        connectionState: "disconnected",
        allocationState: "allocated",
        ownerSkillId: "logic-analyzer",
        lastSeenAt: connectedAt,
        updatedAt: disconnectAt
      });
    }
  });

  it("releases an active session through the owner-matched resource-manager contract", async () => {
    const provider = new FakeDeviceProvider([baseDevice]);
    const resourceManager = createResourceManager(provider, {
      now: createClock(connectedAt)
    });
    const skill = createLogicAnalyzerSkill(resourceManager, {
      createSessionId: () => "session-001"
    });

    const startResult = await skill.startSession(createValidRequest());
    expect(startResult.ok).toBe(true);

    const endResult = skill.endSession({
      sessionId: "session-001",
      deviceId: "logic-1",
      ownerSkillId: "logic-analyzer",
      endedAt: releaseAt
    });

    expect(endResult).toEqual({
      ok: true,
      device: {
        deviceId: "logic-1",
        label: "USB Logic Analyzer",
        capabilityType: "logic-analyzer",
        connectionState: "connected",
        allocationState: "free",
        ownerSkillId: null,
        lastSeenAt: connectedAt,
        updatedAt: releaseAt
      }
    });
    expect(resourceManager.listDevices()).toEqual([
      {
        deviceId: "logic-1",
        label: "USB Logic Analyzer",
        capabilityType: "logic-analyzer",
        connectionState: "connected",
        allocationState: "free",
        ownerSkillId: null,
        lastSeenAt: connectedAt,
        updatedAt: releaseAt
      }
    ]);
  });

  it("preserves release ownership mismatches through typed end-session failures", async () => {
    const provider = new FakeDeviceProvider([baseDevice]);
    const resourceManager = createResourceManager(provider, {
      now: createClock(connectedAt)
    });
    const skill = createLogicAnalyzerSkill(resourceManager, {
      createSessionId: () => "session-001"
    });

    const startResult = await skill.startSession(createValidRequest());
    expect(startResult.ok).toBe(true);

    const endResult = skill.endSession({
      sessionId: "session-001",
      deviceId: "logic-1",
      ownerSkillId: "other-skill",
      endedAt: releaseAt
    });

    expect(endResult).toMatchObject({
      ok: false,
      reason: "release-failed",
      release: {
        ok: false,
        reason: "owner-mismatch",
        deviceId: "logic-1",
        ownerSkillId: "other-skill"
      }
    });
    expect(endResult.ok).toBe(false);
    if (!endResult.ok && endResult.reason === "release-failed") {
      expect(endResult.release.device).toEqual({
        deviceId: "logic-1",
        label: "USB Logic Analyzer",
        capabilityType: "logic-analyzer",
        connectionState: "connected",
        allocationState: "allocated",
        ownerSkillId: "logic-analyzer",
        lastSeenAt: connectedAt,
        updatedAt: allocateAt
      });
    }
  });

  it("releases disconnected devices without hiding the disconnection semantics", async () => {
    const provider = new FakeDeviceProvider([baseDevice]);
    const resourceManager = createResourceManager(provider, {
      now: createClock(connectedAt, disconnectAt)
    });
    const skill = createLogicAnalyzerSkill(resourceManager, {
      createSessionId: () => "session-001"
    });

    const startResult = await skill.startSession(createValidRequest());
    expect(startResult.ok).toBe(true);

    provider.setConnectedDevices([]);
    await resourceManager.refreshInventory();

    const endResult = skill.endSession({
      sessionId: "session-001",
      deviceId: "logic-1",
      ownerSkillId: "logic-analyzer",
      endedAt: releaseAt
    });

    expect(endResult).toEqual({
      ok: true,
      device: {
        deviceId: "logic-1",
        label: "USB Logic Analyzer",
        capabilityType: "logic-analyzer",
        connectionState: "disconnected",
        allocationState: "free",
        ownerSkillId: null,
        lastSeenAt: connectedAt,
        updatedAt: releaseAt
      }
    });
    expect(resourceManager.listDevices()).toEqual([]);
  });
});
