import { describe, expect, expectTypeOf, it } from "vitest";

import {
  GENERIC_LOGIC_ANALYZER_PHASES,
  createGenericLogicAnalyzerSkill,
  runGenericLogicAnalyzer,
  type GenericLogicAnalyzerRequest,
  type GenericLogicAnalyzerResult,
  type LogicAnalyzerSessionRecord,
  type WaveformAnalysisResult
} from "./index.js";
import type { ResourceManager } from "@listenai/contracts";
import {
  FakeDeviceProvider,
  createResourceManager
} from "@listenai/resource-manager";

const connectedAt = "2026-03-26T00:00:00.000Z";
const allocatedAt = "2026-03-26T00:01:00.000Z";
const conflictingAt = "2026-03-26T00:01:30.000Z";
const cleanupAt = "2026-03-26T00:02:00.000Z";

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
    cleanupAt;
};

const fixtureCsvText = [
  "Time [us],D0,D1",
  "0,0,1",
  "1,1,1",
  "2,1,0",
  "3,0,0"
].join("\n");

const createRequest = (
  overrides: Partial<GenericLogicAnalyzerRequest> = {}
): GenericLogicAnalyzerRequest => ({
  session: {
    deviceId: "logic-1",
    ownerSkillId: "logic-analyzer",
    requestedAt: allocatedAt,
    sampling: {
      sampleRateHz: 1_000_000,
      captureDurationMs: 0.004,
      channels: [
        { channelId: "D0", label: "CLK" },
        { channelId: "D1", label: "DATA" }
      ]
    },
    analysis: {
      focusChannelIds: ["D0", "D1"],
      edgePolicy: "all",
      includePulseWidths: true,
      timeReference: "capture-start"
    }
  },
  artifact: {
    sourceName: "capture.csv",
    capturedAt: "2026-03-26T00:00:01.000Z",
    text: fixtureCsvText
  },
  cleanup: {
    endedAt: cleanupAt
  },
  ...overrides
});

const createDeviceRecord = (
  overrides: Partial<LogicAnalyzerSessionRecord["device"]> = {}
): LogicAnalyzerSessionRecord["device"] => ({
  deviceId: "logic-1",
  label: "USB Logic Analyzer",
  capabilityType: "logic-analyzer",
  connectionState: "connected",
  allocationState: "free",
  ownerSkillId: null,
  lastSeenAt: connectedAt,
  updatedAt: connectedAt,
  ...overrides
});

describe("generic logic analyzer contract", () => {
  it("exports the packaged request and result boundary through the root barrel", () => {
    expect(GENERIC_LOGIC_ANALYZER_PHASES).toEqual([
      "request-validation",
      "start-session",
      "load-capture",
      "completed"
    ]);

    expectTypeOf<GenericLogicAnalyzerRequest>().toMatchTypeOf<{
      session: { deviceId: string; sampling: { sampleRateHz: number } };
      artifact: { sourceName?: string; text?: string; bytes?: Uint8Array };
      cleanup: { endedAt: string };
    }>();

    expectTypeOf<GenericLogicAnalyzerResult>().toMatchTypeOf<
      | {
          ok: false;
          phase: "request-validation";
          issues: readonly { path: string; code: string }[];
          cleanup: { attempted: false; reason: "not-started" };
        }
      | {
          ok: false;
          phase: "start-session";
          startSession: { ok: false; reason: "invalid-request" | "allocation-failed" };
          cleanup: { attempted: false; reason: "not-started" };
        }
      | {
          ok: false;
          phase: "load-capture";
          session: LogicAnalyzerSessionRecord;
          loadCapture: {
            ok: false;
            reason:
              | "unsupported-adapter"
              | "unreadable-input"
              | "incompatible-session";
          };
          cleanup: {
            attempted: true;
            request: { endedAt: string; deviceId: string; ownerSkillId: string };
            result: { ok: boolean };
          };
        }
      | {
          ok: true;
          phase: "completed";
          session: LogicAnalyzerSessionRecord;
          capture: { ok: true; adapterId: string };
          analysis: WaveformAnalysisResult;
        }
    >();
  });

  it("returns a completed packaged result with session, capture, and waveform analysis", async () => {
    const provider = new FakeDeviceProvider([baseDevice]);
    const resourceManager = createResourceManager(provider, {
      now: createClock(connectedAt)
    });
    const skill = createGenericLogicAnalyzerSkill(resourceManager, {
      createSessionId: () => "session-001"
    });

    const result = await skill.run(createRequest());

    expect(result).toMatchObject({
      ok: true,
      phase: "completed",
      session: {
        sessionId: "session-001",
        deviceId: "logic-1",
        ownerSkillId: "logic-analyzer"
      },
      capture: {
        ok: true,
        adapterId: "sigrok-csv",
        selectedBy: "probe"
      }
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.analysis.captureSource).toEqual({
        adapterId: "sigrok-csv",
        sourceName: "capture.csv",
        capturedAt: "2026-03-26T00:00:01.000Z"
      });
      expect(result.analysis.analyzedChannelIds).toEqual(["D0", "D1"]);
    }
  });

  it("fails malformed packaged requests before allocation and exposes top-level issues", async () => {
    const provider = new FakeDeviceProvider([baseDevice]);
    const resourceManager = createResourceManager(provider, {
      now: createClock(connectedAt)
    });

    const result = await runGenericLogicAnalyzer(resourceManager, {
      session: createRequest().session,
      cleanup: { endedAt: cleanupAt }
    });

    expect(result).toEqual({
      ok: false,
      phase: "request-validation",
      issues: [
        {
          path: "artifact",
          code: "required",
          message: "artifact is required."
        }
      ],
      cleanup: {
        attempted: false,
        reason: "not-started"
      }
    });
    expect(await resourceManager.listDevices()).toEqual([]);
  });

  it("preserves nested start-session allocation failures without attempting cleanup", async () => {
    const provider = new FakeDeviceProvider([baseDevice]);
    const resourceManager = createResourceManager(provider, {
      now: createClock(connectedAt, conflictingAt)
    });
    const skill = createGenericLogicAnalyzerSkill(resourceManager, {
      createSessionId: () => "session-001"
    });

    const firstResult = await skill.run(createRequest());
    const conflictingResult = await skill.run(
      createRequest({
        session: {
          ...createRequest().session,
          ownerSkillId: "other-skill",
          requestedAt: conflictingAt
        }
      })
    );

    expect(firstResult.ok).toBe(true);
    expect(conflictingResult).toMatchObject({
      ok: false,
      phase: "start-session",
      startSession: {
        ok: false,
        reason: "allocation-failed",
        allocation: {
          ok: false,
          reason: "device-already-allocated",
          deviceId: "logic-1",
          ownerSkillId: "other-skill"
        }
      },
      cleanup: {
        attempted: false,
        reason: "not-started"
      }
    });
  });

  it("reports unsupported adapters with loader diagnostics and a visible cleanup outcome", async () => {
    const provider = new FakeDeviceProvider([baseDevice]);
    const resourceManager = createResourceManager(provider, {
      now: createClock(connectedAt)
    });

    const result = await runGenericLogicAnalyzer(
      resourceManager,
      createRequest({
        artifact: {
          sourceName: "capture.saleae",
          formatHint: "saleae-json",
          text: "{}"
        }
      }),
      {
        createSessionId: () => "session-001"
      }
    );

    expect(result).toMatchObject({
      ok: false,
      phase: "load-capture",
      session: {
        sessionId: "session-001",
        deviceId: "logic-1"
      },
      loadCapture: {
        ok: false,
        reason: "unsupported-adapter",
        adapterIds: ["sigrok-csv"],
        artifact: {
          sourceName: "capture.saleae",
          formatHint: "saleae-json",
          hasText: true
        }
      },
      cleanup: {
        attempted: true,
        request: {
          sessionId: "session-001",
          deviceId: "logic-1",
          ownerSkillId: "logic-analyzer",
          endedAt: cleanupAt
        },
        result: {
          ok: true,
          device: {
            deviceId: "logic-1",
            allocationState: "free",
            ownerSkillId: null
          }
        }
      }
    });
    expect(await resourceManager.listDevices()).toEqual([
      expect.objectContaining({
        deviceId: "logic-1",
        allocationState: "free",
        ownerSkillId: null
      })
    ]);
  });

  it("reports unreadable capture input with adapter diagnostics and cleanup status", async () => {
    const provider = new FakeDeviceProvider([baseDevice]);
    const resourceManager = createResourceManager(provider, {
      now: createClock(connectedAt)
    });

    const result = await runGenericLogicAnalyzer(
      resourceManager,
      createRequest({
        artifact: {
          sourceName: "broken.csv",
          formatHint: "sigrok-csv",
          text: [
            "Time [us],D0,D1",
            "0,0,1",
            "1,1,1",
            "3,1,0"
          ].join("\n")
        }
      }),
      {
        createSessionId: () => "session-001"
      }
    );

    expect(result).toMatchObject({
      ok: false,
      phase: "load-capture",
      loadCapture: {
        ok: false,
        reason: "unreadable-input",
        adapterId: "sigrok-csv",
        selectedBy: "format-hint",
        message: "CSV sample timing must use a stable period.",
        details: ["Rows 2 and 3 differ by 2000ns instead of 1000ns."]
      },
      cleanup: {
        attempted: true,
        result: {
          ok: true,
          device: {
            allocationState: "free"
          }
        }
      }
    });
  });

  it("reports incompatible sessions with capture facts and cleanup status", async () => {
    const provider = new FakeDeviceProvider([baseDevice]);
    const resourceManager = createResourceManager(provider, {
      now: createClock(connectedAt)
    });

    const result = await runGenericLogicAnalyzer(
      resourceManager,
      createRequest({
        session: {
          ...createRequest().session,
          sampling: {
            sampleRateHz: 2_000_000,
            captureDurationMs: 0.004,
            channels: [
              { channelId: "D0", label: "CLK" },
              { channelId: "D2", label: "CS" }
            ]
          },
          analysis: {
            ...createRequest().session.analysis,
            focusChannelIds: ["D0", "D2"]
          }
        }
      }),
      {
        createSessionId: () => "session-001"
      }
    );

    expect(result).toMatchObject({
      ok: false,
      phase: "load-capture",
      loadCapture: {
        ok: false,
        reason: "incompatible-session",
        adapterId: "sigrok-csv",
        issues: expect.arrayContaining([
          expect.objectContaining({
            code: "missing-channel",
            channelId: "D2"
          }),
          expect.objectContaining({
            code: "sample-rate-mismatch",
            expected: 2_000_000,
            actual: 1_000_000
          })
        ])
      },
      cleanup: {
        attempted: true,
        result: {
          ok: true,
          device: {
            allocationState: "free"
          }
        }
      }
    });
  });

  it("surfaces release-failed cleanup results alongside the loader failure", async () => {
    const allocatedDevice = createDeviceRecord({
      allocationState: "allocated",
      ownerSkillId: "logic-analyzer",
      updatedAt: allocatedAt
    });
    const resourceManager: ResourceManager = {
      async refreshInventory() {
        return [createDeviceRecord()];
      },
      async listDevices() {
        return [allocatedDevice];
      },
      async allocateDevice() {
        return {
          ok: true,
          device: allocatedDevice
        };
      },
      async releaseDevice(request) {
        expect(request).toEqual({
          deviceId: "logic-1",
          ownerSkillId: "logic-analyzer",
          releasedAt: cleanupAt
        });

        return {
          ok: false,
          reason: "owner-mismatch",
          deviceId: request.deviceId,
          ownerSkillId: request.ownerSkillId,
          message: `Device ${request.deviceId} is already allocated elsewhere.`,
          device: allocatedDevice
        };
      }
    };

    const result = await runGenericLogicAnalyzer(
      resourceManager,
      createRequest({
        artifact: {
          sourceName: "capture.saleae",
          formatHint: "saleae-json",
          text: "{}"
        }
      }),
      {
        createSessionId: () => "session-001"
      }
    );

    expect(result).toMatchObject({
      ok: false,
      phase: "load-capture",
      loadCapture: {
        ok: false,
        reason: "unsupported-adapter",
        adapterIds: ["sigrok-csv"]
      },
      cleanup: {
        attempted: true,
        request: {
          sessionId: "session-001",
          deviceId: "logic-1",
          ownerSkillId: "logic-analyzer",
          endedAt: cleanupAt
        },
        result: {
          ok: false,
          reason: "release-failed",
          release: {
            ok: false,
            reason: "owner-mismatch",
            deviceId: "logic-1",
            ownerSkillId: "logic-analyzer",
            device: {
              allocationState: "allocated",
              ownerSkillId: "logic-analyzer"
            }
          }
        }
      }
    });
    expect(await resourceManager.listDevices()).toEqual([allocatedDevice]);
  });
});
