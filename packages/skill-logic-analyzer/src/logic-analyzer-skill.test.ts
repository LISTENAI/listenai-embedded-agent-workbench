import { describe, expect, expectTypeOf, it } from "vitest";

import type {
  DeviceRecord,
  InventoryDiagnostic,
  InventorySnapshot,
  SnapshotResourceManager,
} from "@listenai/contracts";
import {
  ANALYSIS_EDGE_POLICIES,
  ANALYSIS_TIME_REFERENCES,
  LOGIC_ANALYZER_CAPTURE_FAILURE_REASONS,
  LOGIC_ANALYZER_CONSTRAINT_ISSUE_CODES,
  LOGIC_ANALYZER_END_FAILURE_REASONS,
  LOGIC_ANALYZER_START_FAILURE_REASONS,
  VALIDATION_ISSUE_CODES,
  createLogicAnalyzerSkill,
  type CaptureLogicAnalyzerSessionResult,
  type EndLogicAnalyzerSessionResult,
  type LogicAnalyzerSessionRecord,
  type LogicAnalyzerValidationIssue,
  type StartLogicAnalyzerSessionRequest,
  type StartLogicAnalyzerSessionResult,
  validateCaptureLogicAnalyzerSessionRequest,
  validateEndLogicAnalyzerSessionRequest,
  validateStartLogicAnalyzerSessionRequest,
} from "./index.js";
import {
  FakeDeviceProvider,
  createDslogicLiveCaptureRunner,
  createResourceManager,
} from "@listenai/resource-manager";

const connectedAt = "2026-03-26T00:00:00.000Z";
const allocateAt = "2026-03-26T00:01:00.000Z";
const captureRequestedAt = "2026-03-26T00:01:10.000Z";
const conflictAt = "2026-03-26T00:01:30.000Z";
const disconnectAt = "2026-03-26T00:02:00.000Z";
const releaseAt = "2026-03-26T00:03:00.000Z";

const liveCaptureCsvText = [
  "Time [us],D0,D1",
  "0,0,1",
  "0.0416666667,1,1",
  "0.0833333333,1,0",
  "0.125,0,0",
].join("\n");

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

const createDiagnostic = (
  overrides: Partial<InventoryDiagnostic> = {}
): InventoryDiagnostic => ({
  code: "backend-probe-failed",
  severity: "warning",
  target: "backend",
  message: "Backend probe returned incomplete capability data.",
  backendKind: "libsigrok",
  ...overrides
});

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
  backendKind: "libsigrok",
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
    backendKinds: ["libsigrok"]
  },
  devices: [createInventoryDevice()],
  backendReadiness: [
    {
      platform: "macos",
      backendKind: "libsigrok",
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
      "constraint-rejected",
      "allocation-failed"
    ]);
    expect(LOGIC_ANALYZER_CONSTRAINT_ISSUE_CODES).toEqual([
      "device-not-found",
      "backend-not-ready",
      "device-not-ready",
      "unsupported-device",
      "missing-dslogic-identity",
      "empty-channel-selection",
      "duplicate-channel-selection",
      "channel-count-exceeds-device-limit",
      "sample-rate-exceeds-device-limit"
    ]);
    expect(LOGIC_ANALYZER_END_FAILURE_REASONS).toEqual([
      "invalid-request",
      "release-failed"
    ]);
    expect(LOGIC_ANALYZER_CAPTURE_FAILURE_REASONS).toEqual([
      "invalid-request",
      "capture-runtime-failed",
      "malformed-artifact",
      "load-capture-failed"
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

    expectTypeOf<Extract<StartLogicAnalyzerSessionResult, { ok: true }>>().toMatchTypeOf<{
      session: LogicAnalyzerSessionRecord;
    }>();
    expectTypeOf<
      Extract<StartLogicAnalyzerSessionResult, { ok: false; reason: "invalid-request" }>
    >().toMatchTypeOf<{
      issues: readonly LogicAnalyzerValidationIssue[];
    }>();
    expectTypeOf<
      Extract<StartLogicAnalyzerSessionResult, { ok: false; reason: "constraint-rejected" }>
    >().toMatchTypeOf<{
      report: { issues: ReadonlyArray<{ code: string; path: string }> };
    }>();
    expectTypeOf<
      Extract<StartLogicAnalyzerSessionResult, { ok: false; reason: "allocation-failed" }>
    >().toMatchTypeOf<{
      inventory: readonly unknown[];
    }>();

    expectTypeOf<EndLogicAnalyzerSessionResult>().toMatchTypeOf<
      | { ok: true; device: { deviceId: string } }
      | { ok: false; reason: "invalid-request"; issues: readonly LogicAnalyzerValidationIssue[] }
      | { ok: false; reason: "release-failed"; release: { deviceId: string } }
    >();

    expectTypeOf<CaptureLogicAnalyzerSessionResult>().toMatchTypeOf<
      | {
          ok: true;
          session: LogicAnalyzerSessionRecord;
          providerKind: string;
          backendKind: string;
          artifactSummary: { sourceName: string | null; hasText: boolean };
          capture: { ok: true; adapterId: string };
        }
      | {
          ok: false;
          reason: "invalid-request";
          issues: readonly LogicAnalyzerValidationIssue[];
        }
      | {
          ok: false;
          reason: "capture-runtime-failed";
          captureRuntime: { ok: false; kind: string; diagnostics: { phase: string } };
        }
      | {
          ok: false;
          reason: "malformed-artifact";
          issues: readonly LogicAnalyzerValidationIssue[];
        }
      | {
          ok: false;
          reason: "load-capture-failed";
          loadCapture: {
            ok: false;
            reason: "unsupported-adapter" | "unreadable-input" | "incompatible-session";
          };
        }
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

  it("returns explicit validation issues for malformed capture-session requests", () => {
    const result = validateCaptureLogicAnalyzerSessionRequest({
      requestedAt: null,
      timeoutMs: 0,
      session: {
        sessionId: "",
        deviceId: null,
        ownerSkillId: "",
        startedAt: 42,
        device: null,
        sampling: {
          sampleRateHz: 0,
          captureDurationMs: -1,
          channels: [],
        },
        analysis: {
          focusChannelIds: [],
          edgePolicy: "all",
          includePulseWidths: true,
          timeReference: "capture-start",
        },
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: "requestedAt", code: "required" }),
          expect.objectContaining({ path: "timeoutMs", code: "too-small" }),
          expect.objectContaining({ path: "session.sessionId", code: "required" }),
          expect.objectContaining({ path: "session.deviceId", code: "required" }),
          expect.objectContaining({ path: "session.ownerSkillId", code: "required" }),
          expect.objectContaining({ path: "session.startedAt", code: "invalid-type" }),
          expect.objectContaining({ path: "session.device", code: "required" }),
          expect.objectContaining({ path: "sampling.sampleRateHz", code: "too-small" }),
          expect.objectContaining({ path: "sampling.captureDurationMs", code: "too-small" }),
          expect.objectContaining({ path: "sampling.channels", code: "too-small" }),
        ]),
      );
    }
  });
});

describe("logic analyzer skill", () => {
  it("starts an allocation-backed session for a valid request", async () => {
    const provider = new FakeDeviceProvider(createReadyInventorySnapshot());
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
          updatedAt: allocateAt,
          readiness: "ready",
          diagnostics: [],
          providerKind: "dslogic",
          backendKind: "libsigrok",
          dslogic: {
            family: "dslogic",
            model: "dslogic-plus",
            modelDisplayName: "DSLogic Plus",
            variant: "classic",
            usbVendorId: "2a0e",
            usbProductId: "0001"
          }
        },
        sampling: createValidRequest().sampling,
        analysis: createValidRequest().analysis
      }
    });
    expect(await resourceManager.listDevices()).toEqual([
      expect.objectContaining({
        deviceId: "logic-1",
        allocationState: "allocated",
        ownerSkillId: "logic-analyzer",
        readiness: "ready",
        backendKind: "libsigrok"
      })
    ]);
  });

  it("returns typed validation failures without refreshing or allocating inventory", async () => {
    const provider = new FakeDeviceProvider(createReadyInventorySnapshot());
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
    expect(await resourceManager.listDevices()).toEqual([]);
  });

  it("rejects backend-missing snapshots before allocation and preserves diagnostics", async () => {
    const snapshot = createReadyInventorySnapshot({
      backendReadiness: [
        {
          platform: "macos",
          backendKind: "libsigrok",
          readiness: "missing",
          executablePath: null,
          version: null,
          checkedAt: connectedAt,
          diagnostics: [
            createDiagnostic({
              code: "backend-missing-executable",
              severity: "error",
              message: "DSView was not found on PATH."
            })
          ]
        }
      ],
      diagnostics: [
        createDiagnostic({
          code: "backend-missing-executable",
          severity: "error",
          message: "DSView was not found on PATH."
        })
      ]
    });
    const provider = new FakeDeviceProvider(snapshot);
    const resourceManager = createResourceManager(provider, {
      now: createClock(connectedAt)
    });
    const skill = createLogicAnalyzerSkill(resourceManager);

    const result = await skill.startSession(createValidRequest());

    expect(result).toMatchObject({
      ok: false,
      reason: "constraint-rejected",
      report: {
        evaluatedBackendReadiness: "missing",
        backendReadiness: snapshot.backendReadiness,
        snapshotDiagnostics: snapshot.diagnostics
      }
    });
    expect(result.ok).toBe(false);
    if (!result.ok && result.reason === "constraint-rejected") {
      expect(result.report.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "backend-not-ready" })
        ])
      );
    }
    expect(await resourceManager.listDevices()).toEqual([
      expect.objectContaining({
        deviceId: "logic-1",
        allocationState: "free",
        ownerSkillId: null
      })
    ]);
  });

  it("rejects unsupported device snapshots before allocation and preserves device diagnostics", async () => {
    const snapshot = createReadyInventorySnapshot({
      devices: [
        createInventoryDevice({
          readiness: "unsupported",
          diagnostics: [
            createDiagnostic({
              code: "device-unsupported-variant",
              severity: "error",
              target: "device",
              message: "Variant V421/Pango is not supported.",
              deviceId: "logic-1"
            })
          ],
          dslogic: {
            family: "dslogic",
            model: "dslogic-plus",
            modelDisplayName: "DSLogic Plus",
            variant: "v421-pango",
            usbVendorId: "2a0e",
            usbProductId: "0030"
          }
        })
      ]
    });
    const provider = new FakeDeviceProvider(snapshot);
    const resourceManager = createResourceManager(provider, {
      now: createClock(connectedAt)
    });
    const skill = createLogicAnalyzerSkill(resourceManager);

    const result = await skill.startSession(createValidRequest());

    expect(result).toMatchObject({
      ok: false,
      reason: "constraint-rejected",
      report: {
        evaluatedDeviceReadiness: "unsupported",
        deviceDiagnostics: snapshot.devices[0]?.diagnostics,
        device: expect.objectContaining({
          deviceId: "logic-1",
          allocationState: "free"
        })
      }
    });
    expect(result.ok).toBe(false);
    if (!result.ok && result.reason === "constraint-rejected") {
      expect(result.report.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "unsupported-device" })
        ])
      );
    }
    expect(await resourceManager.listDevices()).toEqual([
      expect.objectContaining({
        deviceId: "logic-1",
        allocationState: "free",
        ownerSkillId: null
      })
    ]);
  });

  it("returns allocation failures with the evaluated snapshot when a conflict happens after admissibility passes", async () => {
    const provider = new FakeDeviceProvider(createReadyInventorySnapshot());
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
        expect.objectContaining({
          deviceId: "logic-1",
          connectionState: "connected",
          allocationState: "allocated",
          ownerSkillId: "logic-analyzer",
          lastSeenAt: connectedAt,
          updatedAt: conflictAt,
          readiness: "ready",
          backendKind: "libsigrok"
        })
      ]);
      expect(secondStart.allocation.device).toEqual(
        expect.objectContaining({
          deviceId: "logic-1",
          allocationState: "allocated",
          ownerSkillId: "logic-analyzer",
          updatedAt: conflictAt
        })
      );
    }
  });

  it("surfaces missing devices as constraint rejections with an empty snapshot", async () => {
    const provider = new FakeDeviceProvider(
      createReadyInventorySnapshot({
        devices: []
      })
    );
    const resourceManager = createResourceManager(provider, {
      now: createClock(connectedAt)
    });
    const skill = createLogicAnalyzerSkill(resourceManager);

    const result = await skill.startSession(createValidRequest());

    expect(result).toMatchObject({
      ok: false,
      reason: "constraint-rejected",
      report: {
        device: null,
        evaluatedBackendReadiness: "ready",
        issues: expect.arrayContaining([
          expect.objectContaining({ code: "device-not-found" })
        ])
      }
    });
    expect(await resourceManager.listDevices()).toEqual([]);
  });

  it("rejects disconnected snapshot rows before allocation and leaves the existing allocation untouched", async () => {
    const provider = new FakeDeviceProvider(createReadyInventorySnapshot());
    const resourceManager = createResourceManager(provider, {
      now: createClock(connectedAt, disconnectAt)
    });
    const skill = createLogicAnalyzerSkill(resourceManager, {
      createSessionId: () => "session-001"
    });

    const firstStart = await skill.startSession(createValidRequest());
    provider.setInventorySnapshot(
      createReadyInventorySnapshot({
        refreshedAt: disconnectAt,
        devices: [
          createInventoryDevice({
            connectionState: "disconnected",
            updatedAt: disconnectAt
          })
        ]
      })
    );

    const secondStart = await skill.startSession(
      createValidRequest({
        ownerSkillId: "other-skill",
        requestedAt: disconnectAt
      })
    );

    expect(firstStart.ok).toBe(true);
    expect(secondStart).toMatchObject({
      ok: false,
      reason: "constraint-rejected",
      report: {
        evaluatedDeviceReadiness: "ready",
        device: expect.objectContaining({
          deviceId: "logic-1",
          connectionState: "disconnected",
          allocationState: "allocated",
          ownerSkillId: "logic-analyzer"
        })
      }
    });
    expect(secondStart.ok).toBe(false);
    if (!secondStart.ok && secondStart.reason === "constraint-rejected") {
      expect(secondStart.report.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "device-not-ready",
            path: "device.connectionState"
          })
        ])
      );
    }
    expect(await resourceManager.listDevices()).toEqual([
      expect.objectContaining({
        deviceId: "logic-1",
        connectionState: "disconnected",
        allocationState: "allocated",
        ownerSkillId: "logic-analyzer",
        updatedAt: disconnectAt
      })
    ]);
  });

  it("normalizes a successful live capture through loadLogicCapture without releasing the accepted session", async () => {
    const provider = new FakeDeviceProvider(createReadyInventorySnapshot());
    const resourceManager = createResourceManager(provider, {
      now: createClock(connectedAt),
      liveCaptureRunner: createDslogicLiveCaptureRunner(async () => ({
        ok: true,
        executablePath: "/Applications/DSView.app/Contents/MacOS/DSView",
        command: ["libsigrok", "--capture", "logic-1"],
        artifact: {
          sourceName: "logic-1-live.csv",
          formatHint: "sigrok-csv",
          capturedAt: captureRequestedAt,
          text: liveCaptureCsvText,
        },
      })),
    });
    const skill = createLogicAnalyzerSkill(resourceManager, {
      createSessionId: () => "session-001",
    });
    const liveSessionRequest = createValidRequest({
      sampling: {
        ...createValidRequest().sampling,
        captureDurationMs: 0.000125,
      },
    });

    const startResult = await skill.startSession(liveSessionRequest);
    expect(startResult.ok).toBe(true);
    if (!startResult.ok) {
      return;
    }

    const captureResult = await skill.captureSession({
      session: startResult.session,
      requestedAt: captureRequestedAt,
      timeoutMs: 1500,
    });

    expect(captureResult).toMatchObject({
      ok: true,
      session: {
        sessionId: "session-001",
        deviceId: "logic-1",
        ownerSkillId: "logic-analyzer",
      },
      providerKind: "dslogic",
      backendKind: "libsigrok",
      artifactSummary: {
        sourceName: "logic-1-live.csv",
        formatHint: "sigrok-csv",
        hasText: true,
      },
      capture: {
        ok: true,
        adapterId: "sigrok-csv",
        selectedBy: "format-hint",
        capture: {
          totalSamples: 4,
          artifact: {
            sourceName: "logic-1-live.csv",
            hasText: true,
          },
        },
      },
    });
    expect(captureResult.ok).toBe(true);
    if (captureResult.ok) {
      expect(captureResult.capture.capture.sampleRateHz).toBeCloseTo(24_000_000, 0);
    }
    expect(await resourceManager.listDevices()).toEqual([
      expect.objectContaining({
        deviceId: "logic-1",
        allocationState: "allocated",
        ownerSkillId: "logic-analyzer",
      }),
    ]);
  });

  it("returns typed runtime capture failures without collapsing them into loader errors", async () => {
    const provider = new FakeDeviceProvider(createReadyInventorySnapshot());
    const resourceManager = createResourceManager(provider, {
      now: createClock(connectedAt),
      liveCaptureRunner: createDslogicLiveCaptureRunner(async () => ({
        ok: false,
        kind: "timeout",
        phase: "await-runner",
        message: "DSView capture timed out.",
        executablePath: "/Applications/DSView.app/Contents/MacOS/DSView",
        command: ["libsigrok", "--capture", "logic-1"],
        timeoutMs: 1500,
        stderr: {
          text: "Capture did not complete within 1500ms.",
        },
      })),
    });
    const skill = createLogicAnalyzerSkill(resourceManager, {
      createSessionId: () => "session-001",
    });

    const startResult = await skill.startSession(createValidRequest());
    expect(startResult.ok).toBe(true);
    if (!startResult.ok) {
      return;
    }

    const captureResult = await skill.captureSession({
      session: startResult.session,
      requestedAt: captureRequestedAt,
      timeoutMs: 1500,
    });

    expect(captureResult).toMatchObject({
      ok: false,
      reason: "capture-runtime-failed",
      session: {
        sessionId: "session-001",
        deviceId: "logic-1",
      },
      captureRuntime: {
        ok: false,
        kind: "timeout",
        requestedAt: captureRequestedAt,
        diagnostics: {
          phase: "await-runner",
          timeoutMs: 1500,
        },
      },
    });
    expect(await resourceManager.listDevices()).toEqual([
      expect.objectContaining({
        deviceId: "logic-1",
        allocationState: "allocated",
        ownerSkillId: "logic-analyzer",
      }),
    ]);
  });

  it("keeps post-runtime loader incompatibility distinct from runtime capture failures", async () => {
    const provider = new FakeDeviceProvider(createReadyInventorySnapshot());
    const resourceManager = createResourceManager(provider, {
      now: createClock(connectedAt),
      liveCaptureRunner: createDslogicLiveCaptureRunner(async () => ({
        ok: true,
        executablePath: "/Applications/DSView.app/Contents/MacOS/DSView",
        command: ["libsigrok", "--capture", "logic-1"],
        artifact: {
          sourceName: "logic-1-incompatible.csv",
          formatHint: "sigrok-csv",
          capturedAt: captureRequestedAt,
          text: [
            "Time [us],D0",
            "0,0",
            "0.0416666667,1",
            "0.0833333333,0",
          ].join("\n"),
        },
      })),
    });
    const skill = createLogicAnalyzerSkill(resourceManager, {
      createSessionId: () => "session-001",
    });

    const startResult = await skill.startSession(createValidRequest());
    expect(startResult.ok).toBe(true);
    if (!startResult.ok) {
      return;
    }

    const captureResult = await skill.captureSession({
      session: startResult.session,
      requestedAt: captureRequestedAt,
    });

    expect(captureResult).toMatchObject({
      ok: false,
      reason: "load-capture-failed",
      session: {
        sessionId: "session-001",
        deviceId: "logic-1",
      },
      providerKind: "dslogic",
      backendKind: "libsigrok",
      artifactSummary: {
        sourceName: "logic-1-incompatible.csv",
        hasText: true,
      },
      loadCapture: {
        ok: false,
        reason: "incompatible-session",
        issues: expect.arrayContaining([
          expect.objectContaining({
            code: "missing-channel",
            channelId: "D1",
          }),
        ]),
      },
    });
  });

  it("fails malformed live capture success payloads before loadLogicCapture runs", async () => {
    const sessionDevice = createInventoryDevice({
      allocationState: "allocated",
      ownerSkillId: "logic-analyzer",
      updatedAt: allocateAt,
    });
    const session: LogicAnalyzerSessionRecord = {
      sessionId: "session-001",
      deviceId: "logic-1",
      ownerSkillId: "logic-analyzer",
      startedAt: allocateAt,
      device: sessionDevice,
      sampling: createValidRequest().sampling,
      analysis: createValidRequest().analysis,
    };
    const snapshot = createReadyInventorySnapshot({
      devices: [session.device],
    });
    const resourceManager: SnapshotResourceManager = {
      async refreshInventory() {
        return snapshot.devices;
      },
      async listDevices() {
        return snapshot.devices;
      },
      async refreshInventorySnapshot() {
        return snapshot;
      },
      async getInventorySnapshot() {
        return snapshot;
      },
      async allocateDevice() {
        return { ok: true, device: session.device };
      },
      async releaseDevice() {
        return { ok: true, device: session.device };
      },
      async liveCapture() {
        return {
          ok: true,
          providerKind: "dslogic",
          backendKind: "libsigrok",
          session: {
            sessionId: session.sessionId,
            deviceId: session.deviceId,
            ownerSkillId: session.ownerSkillId,
            startedAt: session.startedAt,
            device: session.device,
            sampling: session.sampling,
          },
          requestedAt: captureRequestedAt,
          artifact: {
            sourceName: "broken-live.csv",
            formatHint: "sigrok-csv",
          },
          artifactSummary: {
            sourceName: "broken-live.csv",
            formatHint: "sigrok-csv",
            mediaType: null,
            capturedAt: null,
            byteLength: null,
            textLength: null,
            hasText: false,
          },
        };
      },
    };
    const skill = createLogicAnalyzerSkill(resourceManager);

    const captureResult = await skill.captureSession({
      session,
      requestedAt: captureRequestedAt,
    });

    expect(captureResult).toEqual({
      ok: false,
      reason: "malformed-artifact",
      session,
      requestedAt: captureRequestedAt,
      providerKind: "dslogic",
      backendKind: "libsigrok",
      artifactSummary: {
        sourceName: "broken-live.csv",
        formatHint: "sigrok-csv",
        mediaType: null,
        capturedAt: null,
        byteLength: null,
        textLength: null,
        hasText: false,
      },
      issues: [
        {
          path: "capture.artifact",
          code: "required",
          message: "Live capture response must include non-empty artifact text or bytes.",
        },
      ],
    });
  });

  it("releases an active session through the owner-matched resource-manager contract", async () => {
    const provider = new FakeDeviceProvider(createReadyInventorySnapshot());
    const resourceManager = createResourceManager(provider, {
      now: createClock(connectedAt)
    });
    const skill = createLogicAnalyzerSkill(resourceManager, {
      createSessionId: () => "session-001"
    });

    const startResult = await skill.startSession(createValidRequest());
    expect(startResult.ok).toBe(true);

    const endResult = await skill.endSession({
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
        updatedAt: releaseAt,
        readiness: "ready",
        diagnostics: [],
        providerKind: "dslogic",
        backendKind: "libsigrok",
        dslogic: {
          family: "dslogic",
          model: "dslogic-plus",
          modelDisplayName: "DSLogic Plus",
          variant: "classic",
          usbVendorId: "2a0e",
          usbProductId: "0001"
        }
      }
    });
    expect(await resourceManager.listDevices()).toEqual([
      expect.objectContaining({
        deviceId: "logic-1",
        allocationState: "free",
        ownerSkillId: null,
        updatedAt: releaseAt
      })
    ]);
  });

  it("preserves release ownership mismatches through typed end-session failures", async () => {
    const provider = new FakeDeviceProvider(createReadyInventorySnapshot());
    const resourceManager = createResourceManager(provider, {
      now: createClock(connectedAt)
    });
    const skill = createLogicAnalyzerSkill(resourceManager, {
      createSessionId: () => "session-001"
    });

    const startResult = await skill.startSession(createValidRequest());
    expect(startResult.ok).toBe(true);

    const endResult = await skill.endSession({
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
      expect(endResult.release.device).toEqual(
        expect.objectContaining({
          deviceId: "logic-1",
          connectionState: "connected",
          allocationState: "allocated",
          ownerSkillId: "logic-analyzer",
          lastSeenAt: connectedAt,
          updatedAt: allocateAt,
          readiness: "ready",
          backendKind: "libsigrok"
        })
      );
    }
  });

  it("releases disconnected devices without hiding the disconnection semantics", async () => {
    const provider = new FakeDeviceProvider(createReadyInventorySnapshot());
    const resourceManager = createResourceManager(provider, {
      now: createClock(connectedAt, disconnectAt)
    });
    const skill = createLogicAnalyzerSkill(resourceManager, {
      createSessionId: () => "session-001"
    });

    const startResult = await skill.startSession(createValidRequest());
    expect(startResult.ok).toBe(true);

    provider.setInventorySnapshot(
      createReadyInventorySnapshot({
        refreshedAt: disconnectAt,
        devices: [
          createInventoryDevice({
            connectionState: "disconnected",
            updatedAt: disconnectAt
          })
        ]
      })
    );
    await resourceManager.refreshInventory();

    const endResult = await skill.endSession({
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
        updatedAt: releaseAt,
        readiness: "ready",
        diagnostics: [],
        providerKind: "dslogic",
        backendKind: "libsigrok",
        dslogic: {
          family: "dslogic",
          model: "dslogic-plus",
          modelDisplayName: "DSLogic Plus",
          variant: "classic",
          usbVendorId: "2a0e",
          usbProductId: "0001"
        }
      }
    });
    expect(await resourceManager.listDevices()).toEqual([]);
  });
});
