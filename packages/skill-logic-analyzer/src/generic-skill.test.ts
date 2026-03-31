import { describe, expect, expectTypeOf, it } from "vitest";

import type {
  DeviceRecord,
  InventorySnapshot,
  SnapshotResourceManager
} from "@listenai/contracts";
import {
  GENERIC_LOGIC_ANALYZER_MODES,
  GENERIC_LOGIC_ANALYZER_PHASES,
  createGenericLogicAnalyzerSkill,
  runGenericLogicAnalyzer,
  type GenericLogicAnalyzerRequest,
  type GenericLogicAnalyzerResult,
  type LogicAnalyzerSessionRecord,
  type WaveformAnalysisResult
} from "./index.js";
import {
  FakeDeviceProvider,
  createDslogicLiveCaptureRunner,
  createResourceManager
} from "@listenai/resource-manager";

const connectedAt = "2026-03-26T00:00:00.000Z";
const allocatedAt = "2026-03-26T00:01:00.000Z";
const captureRequestedAt = "2026-03-26T00:01:10.000Z";
const cleanupAt = "2026-03-26T00:02:00.000Z";
const conflictingAt = "2026-03-26T00:03:00.000Z";

const fixtureCsvText = [
  "Time [us],D0,D1",
  "0,0,1",
  "1,1,1",
  "2,1,0",
  "3,0,0"
].join("\n");

const createClock = (...timestamps: string[]) => {
  let index = 0;

  return () =>
    timestamps[Math.min(index++, timestamps.length - 1)] ??
    timestamps[timestamps.length - 1] ??
    cleanupAt;
};

const createInventoryDevice = (
  overrides: Partial<DeviceRecord> = {}
): DeviceRecord => ({
  deviceId: "logic-1",
  label: "USB Logic Analyzer",
  capabilityType: "logic-analyzer",
  connectionState: "connected",
  allocationState: "free",
  ownerSkillId: null,
  lastSeenAt: connectedAt,
  updatedAt: connectedAt,
  readiness: "ready",
  diagnostics: [],
  providerKind: "dslogic",
  backendKind: "dsview",
  dslogic: {
    family: "dslogic",
    model: "dslogic-plus",
    modelDisplayName: "DSLogic Plus",
    variant: "classic",
    usbVendorId: "2a0e",
    usbProductId: "0001"
  },
  ...overrides
});

const createReadyInventorySnapshot = (
  overrides: Partial<InventorySnapshot> = {}
): InventorySnapshot => ({
  refreshedAt: connectedAt,
  inventoryScope: {
    providerKinds: ["dslogic"],
    backendKinds: ["dsview"]
  },
  devices: [createInventoryDevice()],
  backendReadiness: [
    {
      platform: "macos",
      backendKind: "dsview",
      readiness: "ready",
      executablePath: "/Applications/DSView.app/Contents/MacOS/DSView",
      version: "1.3.1",
      checkedAt: connectedAt,
      diagnostics: []
    }
  ],
  diagnostics: [],
  ...overrides
});

type GenericLogicAnalyzerOfflineRequest = Exclude<
  GenericLogicAnalyzerRequest,
  { mode: "live" }
>;

const createOfflineRequest = (
  overrides: Partial<GenericLogicAnalyzerOfflineRequest> = {}
): GenericLogicAnalyzerOfflineRequest => ({
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

const createLiveRequest = (
  overrides: Partial<Extract<GenericLogicAnalyzerRequest, { mode: "live" }>> = {}
): Extract<GenericLogicAnalyzerRequest, { mode: "live" }> => ({
  mode: "live",
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
  capture: {
    requestedAt: captureRequestedAt,
    timeoutMs: 1500
  },
  cleanup: {
    endedAt: cleanupAt
  },
  ...overrides
});

describe("generic logic analyzer contract", () => {
  it("exports the additive offline/live package contract through the root barrel", () => {
    expect(GENERIC_LOGIC_ANALYZER_MODES).toEqual(["artifact", "live"]);
    expect(GENERIC_LOGIC_ANALYZER_PHASES).toEqual([
      "request-validation",
      "start-session",
      "live-capture",
      "load-capture",
      "completed"
    ]);

    expectTypeOf<GenericLogicAnalyzerRequest>().toMatchTypeOf<
      | {
          mode?: "artifact";
          session: { deviceId: string; sampling: { sampleRateHz: number } };
          artifact: { text?: string; bytes?: Uint8Array };
          cleanup: { endedAt: string };
        }
      | {
          mode: "live";
          session: { deviceId: string; sampling: { sampleRateHz: number } };
          capture: { requestedAt: string; timeoutMs?: number };
          cleanup: { endedAt: string };
        }
    >();

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
          startSession: {
            ok: false;
            reason: "invalid-request" | "constraint-rejected" | "allocation-failed";
          };
          cleanup: { attempted: false; reason: "not-started" };
        }
      | {
          ok: false;
          phase: "live-capture";
          session: LogicAnalyzerSessionRecord;
          captureSession: {
            ok: false;
            reason: "invalid-request" | "capture-runtime-failed" | "malformed-artifact";
          };
          cleanup: {
            attempted: true;
            request: { endedAt: string; deviceId: string; ownerSkillId: string };
            result: { ok: boolean };
          };
        }
      | {
          ok: false;
          phase: "load-capture";
          session: LogicAnalyzerSessionRecord;
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

  it("keeps offline callers working without changing their request shape", async () => {
    const provider = new FakeDeviceProvider(createReadyInventorySnapshot());
    const resourceManager = createResourceManager(provider, {
      now: createClock(connectedAt)
    });
    const skill = createGenericLogicAnalyzerSkill(resourceManager, {
      createSessionId: () => "session-001"
    });

    const result = await skill.run(createOfflineRequest());

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
      expect("captureSession" in result).toBe(false);
      expect(result.analysis.captureSource).toEqual({
        adapterId: "sigrok-csv",
        sourceName: "capture.csv",
        capturedAt: "2026-03-26T00:00:01.000Z"
      });
    }
  });

  it("rejects unknown request discriminants before allocation", async () => {
    const provider = new FakeDeviceProvider(createReadyInventorySnapshot());
    const resourceManager = createResourceManager(provider, {
      now: createClock(connectedAt)
    });

    const result = await runGenericLogicAnalyzer(resourceManager, {
      ...createOfflineRequest(),
      mode: "stream"
    });

    expect(result).toEqual({
      ok: false,
      phase: "request-validation",
      issues: [
        {
          path: "mode",
          code: "invalid-value",
          message: "mode must be one of artifact, live."
        }
      ],
      cleanup: {
        attempted: false,
        reason: "not-started"
      }
    });
    expect(await resourceManager.listDevices()).toEqual([]);
  });

  it("rejects live requests that omit the live capture config", async () => {
    const provider = new FakeDeviceProvider(createReadyInventorySnapshot());
    const resourceManager = createResourceManager(provider, {
      now: createClock(connectedAt)
    });

    const result = await runGenericLogicAnalyzer(resourceManager, {
      mode: "live",
      session: createLiveRequest().session,
      cleanup: { endedAt: cleanupAt }
    });

    expect(result).toEqual({
      ok: false,
      phase: "request-validation",
      issues: [
        {
          path: "capture",
          code: "required",
          message: "capture is required."
        }
      ],
      cleanup: {
        attempted: false,
        reason: "not-started"
      }
    });
    expect(await resourceManager.listDevices()).toEqual([]);
  });

  it("rejects offline requests that do not provide artifact text or bytes", async () => {
    const provider = new FakeDeviceProvider(createReadyInventorySnapshot());
    const resourceManager = createResourceManager(provider, {
      now: createClock(connectedAt)
    });

    const result = await runGenericLogicAnalyzer(
      resourceManager,
      createOfflineRequest({
        artifact: {
          sourceName: "capture.csv",
          capturedAt: "2026-03-26T00:00:01.000Z"
        }
      })
    );

    expect(result).toEqual({
      ok: false,
      phase: "request-validation",
      issues: [
        {
          path: "artifact",
          code: "required",
          message: "artifact must include non-empty text or bytes."
        }
      ],
      cleanup: {
        attempted: false,
        reason: "not-started"
      }
    });
    expect(await resourceManager.listDevices()).toEqual([]);
  });

  it("proves the same packaged known pattern through live capture and leaves cleanup explicit on success", async () => {
    const provider = new FakeDeviceProvider(createReadyInventorySnapshot());
    const resourceManager = createResourceManager(provider, {
      now: createClock(connectedAt),
      liveCaptureRunner: createDslogicLiveCaptureRunner(async () => ({
        ok: true,
        executablePath: "/Applications/DSView.app/Contents/MacOS/DSView",
        command: ["dsview", "--capture", "logic-1"],
        artifact: {
          sourceName: "logic-1-live.csv",
          formatHint: "sigrok-csv",
          capturedAt: captureRequestedAt,
          text: fixtureCsvText
        }
      }))
    });
    const skill = createGenericLogicAnalyzerSkill(resourceManager, {
      createSessionId: () => "session-001"
    });

    const result = await skill.run(createLiveRequest());

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
        selectedBy: "format-hint"
      },
      captureSession: {
        ok: true,
        requestedAt: captureRequestedAt,
        providerKind: "dslogic",
        backendKind: "dsview",
        artifactSummary: {
          sourceName: "logic-1-live.csv",
          formatHint: "sigrok-csv",
          hasText: true
        }
      }
    });
    expect(result.ok).toBe(true);
    if (result.ok && "captureSession" in result) {
      expect("cleanup" in result).toBe(false);
      expect(result.captureSession.capture.capture).toEqual({
        adapterId: "sigrok-csv",
        sourceName: "logic-1-live.csv",
        capturedAt: captureRequestedAt,
        sampleRateHz: 1_000_000,
        samplePeriodNs: 1000,
        totalSamples: 4,
        durationNs: 4000,
        artifact: {
          sourceName: "logic-1-live.csv",
          hasText: true,
          formatHint: "sigrok-csv",
          mediaType: null,
          capturedAt: captureRequestedAt,
          byteLength: null
        },
        channels: expect.any(Array)
      });
      expect(result.analysis.analyzedChannelIds).toEqual(["D0", "D1"]);
      expect(result.analysis.channels).toEqual([
        expect.objectContaining({
          channelId: "D0",
          observedEdgeKinds: ["rising", "falling"],
          qualifyingTransitionCount: 2,
          summaryText:
            "2 rising/falling edges observed, rhythm is steady at about 500000Hz, high widths avg 2000ns, low widths avg 1000ns."
        }),
        expect.objectContaining({
          channelId: "D1",
          observedEdgeKinds: ["falling"],
          qualifyingTransitionCount: 1,
          summaryText:
            "1 falling edge observed, insufficient data for rhythm, high widths avg 2000ns, low widths avg 2000ns."
        })
      ]);
      expect(result.analysis.capabilityNotes).toEqual([
        {
          code: "focus-channels-applied",
          message: "Analysis is limited to the requested focus channels.",
          details: {
            requestedChannelCount: 2,
            analyzedChannelCount: 2
          }
        },
        {
          code: "baseline-only-no-protocol-decoding",
          message: "Structured output only covers baseline waveform interpretation."
        }
      ]);
    }
    expect(await resourceManager.listDevices()).toEqual([
      expect.objectContaining({
        deviceId: "logic-1",
        allocationState: "allocated",
        ownerSkillId: "logic-analyzer"
      })
    ]);
  });

  it("preserves capture runtime failures as live-capture failures with timeout diagnostics and cleanup status", async () => {
    const provider = new FakeDeviceProvider(createReadyInventorySnapshot());
    const resourceManager = createResourceManager(provider, {
      now: createClock(connectedAt),
      liveCaptureRunner: createDslogicLiveCaptureRunner(async () => ({
        ok: false,
        kind: "timeout",
        phase: "await-runner",
        message: "DSView capture timed out.",
        executablePath: "/Applications/DSView.app/Contents/MacOS/DSView",
        command: ["dsview", "--capture", "logic-1"],
        timeoutMs: 1500,
        stderr: {
          text: "Capture did not complete within 1500ms."
        }
      }))
    });
    const skill = createGenericLogicAnalyzerSkill(resourceManager, {
      createSessionId: () => "session-001"
    });

    const result = await skill.run(createLiveRequest());

    expect(result).toMatchObject({
      ok: false,
      phase: "live-capture",
      session: {
        sessionId: "session-001",
        deviceId: "logic-1"
      },
      captureSession: {
        ok: false,
        reason: "capture-runtime-failed",
        requestedAt: captureRequestedAt,
        captureRuntime: {
          ok: false,
          kind: "timeout",
          diagnostics: {
            phase: "await-runner",
            timeoutMs: 1500
          }
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
  });

  it("preserves malformed live artifacts as a dedicated live-capture failure with cleanup status", async () => {
    const sessionDevice = createInventoryDevice({
      allocationState: "allocated",
      ownerSkillId: "logic-analyzer",
      updatedAt: allocatedAt
    });
    const session: LogicAnalyzerSessionRecord = {
      sessionId: "session-001",
      deviceId: "logic-1",
      ownerSkillId: "logic-analyzer",
      startedAt: allocatedAt,
      device: sessionDevice,
      sampling: createLiveRequest().session.sampling,
      analysis: createLiveRequest().session.analysis
    };
    const snapshot = createReadyInventorySnapshot({
      devices: [sessionDevice]
    });
    const resourceManager: SnapshotResourceManager = {
      async refreshInventory() {
        return snapshot.devices;
      },
      async refreshInventorySnapshot() {
        return snapshot;
      },
      async getInventorySnapshot() {
        return snapshot;
      },
      async listDevices() {
        return snapshot.devices;
      },
      async allocateDevice() {
        return { ok: true, device: sessionDevice };
      },
      async releaseDevice() {
        return {
          ok: true,
          device: createInventoryDevice({
            allocationState: "free",
            ownerSkillId: null,
            updatedAt: cleanupAt
          })
        };
      },
      async liveCapture() {
        return {
          ok: true,
          providerKind: "dslogic",
          backendKind: "dsview",
          session: {
            sessionId: session.sessionId,
            deviceId: session.deviceId,
            ownerSkillId: session.ownerSkillId,
            startedAt: session.startedAt,
            device: session.device,
            sampling: session.sampling
          },
          requestedAt: captureRequestedAt,
          artifact: {
            sourceName: "broken-live.csv",
            formatHint: "sigrok-csv"
          },
          artifactSummary: {
            sourceName: "broken-live.csv",
            formatHint: "sigrok-csv",
            mediaType: null,
            capturedAt: null,
            byteLength: null,
            textLength: null,
            hasText: false
          }
        };
      }
    };

    const result = await runGenericLogicAnalyzer(
      resourceManager,
      createLiveRequest(),
      {
        createSessionId: () => "session-001"
      }
    );

    expect(result).toEqual({
      ok: false,
      phase: "live-capture",
      session,
      captureSession: {
        ok: false,
        reason: "malformed-artifact",
        session,
        requestedAt: captureRequestedAt,
        providerKind: "dslogic",
        backendKind: "dsview",
        artifactSummary: {
          sourceName: "broken-live.csv",
          formatHint: "sigrok-csv",
          mediaType: null,
          capturedAt: null,
          byteLength: null,
          textLength: null,
          hasText: false
        },
        issues: [
          {
            path: "capture.artifact",
            code: "required",
            message: "Live capture response must include non-empty artifact text or bytes."
          }
        ]
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
          device: createInventoryDevice({
            allocationState: "free",
            ownerSkillId: null,
            updatedAt: cleanupAt
          })
        }
      }
    });
  });

  it("keeps loader incompatibility after live capture as a separate load-capture failure", async () => {
    const provider = new FakeDeviceProvider(createReadyInventorySnapshot());
    const resourceManager = createResourceManager(provider, {
      now: createClock(connectedAt),
      liveCaptureRunner: createDslogicLiveCaptureRunner(async () => ({
        ok: true,
        executablePath: "/Applications/DSView.app/Contents/MacOS/DSView",
        command: ["dsview", "--capture", "logic-1"],
        artifact: {
          sourceName: "logic-1-incompatible.csv",
          formatHint: "sigrok-csv",
          capturedAt: captureRequestedAt,
          text: [
            "Time [us],D0",
            "0,0",
            "0.0416666667,1",
            "0.0833333333,0"
          ].join("\n")
        }
      }))
    });
    const skill = createGenericLogicAnalyzerSkill(resourceManager, {
      createSessionId: () => "session-001"
    });

    const result = await skill.run(createLiveRequest());

    expect(result).toMatchObject({
      ok: false,
      phase: "load-capture",
      session: {
        sessionId: "session-001",
        deviceId: "logic-1"
      },
      captureSession: {
        ok: false,
        reason: "load-capture-failed",
        requestedAt: captureRequestedAt,
        providerKind: "dslogic",
        backendKind: "dsview",
        artifactSummary: {
          sourceName: "logic-1-incompatible.csv",
          hasText: true
        },
        loadCapture: {
          ok: false,
          reason: "incompatible-session",
          issues: expect.arrayContaining([
            expect.objectContaining({
              code: "missing-channel",
              channelId: "D1"
            })
          ])
        }
      },
      cleanup: {
        attempted: true,
        result: {
          ok: true,
          device: {
            allocationState: "free",
            ownerSkillId: null
          }
        }
      }
    });
  });

  it("preserves start-session allocation failures without attempting cleanup", async () => {
    const provider = new FakeDeviceProvider(createReadyInventorySnapshot());
    const resourceManager = createResourceManager(provider, {
      now: createClock(connectedAt, conflictingAt)
    });
    const skill = createGenericLogicAnalyzerSkill(resourceManager, {
      createSessionId: () => "session-001"
    });

    const firstResult = await skill.run(createOfflineRequest());
    const conflictingResult = await skill.run(
      createOfflineRequest({
        session: {
          ...createOfflineRequest().session,
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
});
