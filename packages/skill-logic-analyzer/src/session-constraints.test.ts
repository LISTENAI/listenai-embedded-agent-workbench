import { describe, expect, expectTypeOf, it } from "vitest";

import type {
  DeviceRecord,
  InventoryDiagnostic,
  InventorySnapshot
} from "@listenai/contracts";
import {
  LOGIC_ANALYZER_CONSTRAINT_ISSUE_CODES,
  LOGIC_ANALYZER_START_FAILURE_REASONS,
  evaluateStartSessionConstraints,
  type LogicAnalyzerSessionConstraintEvaluation,
  type StartLogicAnalyzerSessionRequest,
  type StartLogicAnalyzerSessionResult
} from "./index.js";

const refreshedAt = "2026-03-28T00:00:00.000Z";

const createRequest = (
  channelCount: number,
  sampleRateHz: number
): StartLogicAnalyzerSessionRequest => ({
  deviceId: "logic-1",
  ownerSkillId: "logic-analyzer",
  requestedAt: refreshedAt,
  sampling: {
    sampleRateHz,
    captureDurationMs: 25,
    channels: Array.from({ length: channelCount }, (_, index) => ({
      channelId: `D${index}`,
      label: `CH${index}`
    }))
  },
  analysis: {
    focusChannelIds: ["D0"],
    edgePolicy: "rising",
    includePulseWidths: true,
    timeReference: "capture-start"
  }
});

const createDiagnostic = (
  overrides: Partial<InventoryDiagnostic> = {}
): InventoryDiagnostic => ({
  code: "backend-runtime-failed",
  severity: "warning",
  target: "backend",
  message: "Backend probe returned incomplete capability data.",
  backendKind: "dsview-cli",
  ...overrides
});

const createDevice = (
  overrides: Partial<DeviceRecord> = {}
): DeviceRecord => ({
  deviceId: "logic-1",
  label: "DSLogic Plus",
  capabilityType: "logic-analyzer",
  connectionState: "connected",
  allocationState: "free",
  ownerSkillId: null,
  lastSeenAt: refreshedAt,
  updatedAt: refreshedAt,
  readiness: "ready",
  diagnostics: [],
  providerKind: "dslogic",
  backendKind: "dsview-cli",
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

const createSnapshot = (
  overrides: Partial<InventorySnapshot> = {}
): InventorySnapshot => ({
  refreshedAt,
  inventoryScope: {
    providerKinds: ["dslogic"],
    backendKinds: ["dsview-cli"]
  },
  devices: [createDevice()],
  backendReadiness: [
    {
      platform: "macos",
      backendKind: "dsview-cli",
      readiness: "ready",
      version: "1.3.1",
      checkedAt: refreshedAt,
      diagnostics: []
    }
  ],
  diagnostics: [],
  ...overrides
});

describe("session constraint contracts", () => {
  it("exposes typed constraint rejection reasons and evaluation reports", () => {
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

    expectTypeOf<LogicAnalyzerSessionConstraintEvaluation>().toMatchTypeOf<
      | {
          ok: true;
          report: {
            evaluatedDeviceReadiness: "missing" | "ready" | "degraded" | "unsupported";
            evaluatedBackendReadiness:
              | "missing"
              | "ready"
              | "degraded"
              | "unsupported";
          };
        }
      | {
          ok: false;
          reason: "constraint-rejected";
          report: { issues: ReadonlyArray<{ code: string; path: string }> };
        }
    >();

    expectTypeOf<Extract<LogicAnalyzerSessionConstraintEvaluation, { ok: true }>>().toMatchTypeOf<{
      report: {
        evaluatedDeviceReadiness: "missing" | "ready" | "degraded" | "unsupported";
        evaluatedBackendReadiness:
          | "missing"
          | "ready"
          | "degraded"
          | "unsupported";
      };
    }>();
    expectTypeOf<
      Extract<LogicAnalyzerSessionConstraintEvaluation, { ok: false; reason: "constraint-rejected" }>
    >().toMatchTypeOf<{
      report: { issues: ReadonlyArray<{ code: string; path: string }> };
    }>();

    expectTypeOf<StartLogicAnalyzerSessionResult>().toMatchTypeOf<
      | { ok: true; session: { sessionId: string } }
      | { ok: false; reason: "invalid-request"; issues: readonly unknown[] }
      | { ok: false; reason: "constraint-rejected"; report: { issues: readonly unknown[] } }
      | { ok: false; reason: "allocation-failed"; inventory: readonly unknown[] }
    >();
  });
});

describe("evaluateStartSessionConstraints", () => {
  it("accepts the 2-channel baseline on a ready DSLogic Plus snapshot", () => {
    const request = createRequest(2, 24_000_000);
    const snapshot = createSnapshot();
    const device = snapshot.devices[0];

    const result = evaluateStartSessionConstraints({ request, snapshot, device });

    expect(result).toEqual({
      ok: true,
      report: {
        request: {
          deviceId: "logic-1",
          requestedChannelIds: ["D0", "D1"],
          requestedChannelCount: 2,
          distinctChannelCount: 2,
          sampleRateHz: 24_000_000
        },
        device,
        evaluatedDeviceReadiness: "ready",
        deviceDiagnostics: [],
        backendReadiness: snapshot.backendReadiness,
        evaluatedBackendReadiness: "ready",
        snapshotDiagnostics: [],
        issues: []
      }
    });
  });

  it.each([
    { channelCount: 4, sampleRateHz: 400_000_000 },
    { channelCount: 8, sampleRateHz: 200_000_000 },
    { channelCount: 16, sampleRateHz: 100_000_000 }
  ])(
    "accepts DSLogic Plus requests at the tier ceiling for $channelCount channels",
    ({ channelCount, sampleRateHz }) => {
      const request = createRequest(channelCount, sampleRateHz);
      const snapshot = createSnapshot();

      const result = evaluateStartSessionConstraints({
        request,
        snapshot,
        device: snapshot.devices[0]
      });

      expect(result.ok).toBe(true);
    }
  );

  it.each([
    {
      channelCount: 4,
      sampleRateHz: 400_000_001,
      expectedCode: "sample-rate-exceeds-device-limit"
    },
    {
      channelCount: 8,
      sampleRateHz: 200_000_001,
      expectedCode: "sample-rate-exceeds-device-limit"
    },
    {
      channelCount: 16,
      sampleRateHz: 100_000_001,
      expectedCode: "sample-rate-exceeds-device-limit"
    },
    {
      channelCount: 17,
      sampleRateHz: 100_000_000,
      expectedCode: "channel-count-exceeds-device-limit"
    }
  ])(
    "rejects DSLogic Plus tier overages for $channelCount channels",
    ({ channelCount, sampleRateHz, expectedCode }) => {
      const request = createRequest(channelCount, sampleRateHz);
      const snapshot = createSnapshot();

      const result = evaluateStartSessionConstraints({
        request,
        snapshot,
        device: snapshot.devices[0]
      });

      expect(result).toMatchObject({
        ok: false,
        reason: "constraint-rejected"
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.report.issues).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ code: expectedCode })
          ])
        );
      }
    }
  );

  it("rejects duplicate and empty channel IDs as non-admissible", () => {
    const request: StartLogicAnalyzerSessionRequest = {
      ...createRequest(3, 24_000_000),
      sampling: {
        ...createRequest(3, 24_000_000).sampling,
        channels: [
          { channelId: "D0", label: "CLK" },
          { channelId: "", label: "EMPTY" },
          { channelId: "D0", label: "DUP" }
        ]
      }
    };
    const snapshot = createSnapshot();

    const result = evaluateStartSessionConstraints({
      request,
      snapshot,
      device: snapshot.devices[0]
    });

    expect(result).toMatchObject({
      ok: false,
      reason: "constraint-rejected"
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.report.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "empty-channel-selection" }),
          expect.objectContaining({ code: "duplicate-channel-selection" })
        ])
      );
      expect(result.report.request.distinctChannelCount).toBe(1);
    }
  });

  it.each([
    {
      name: "missing backend",
      snapshot: createSnapshot({
        backendReadiness: [
          {
            platform: "macos",
            backendKind: "dsview-cli",
            readiness: "missing",
            version: null,
            checkedAt: refreshedAt,
            diagnostics: [
              createDiagnostic({
                code: "backend-missing-runtime",
                severity: "error",
                message: "dsview-cli runtime is not available on macos."
              })
            ]
          }
        ],
        diagnostics: [
          createDiagnostic({
            code: "backend-missing-runtime",
            severity: "error",
            message: "dsview-cli runtime is not available on macos."
          })
        ]
      }),
      expectedBackendReadiness: "missing"
    },
    {
      name: "degraded backend",
      snapshot: createSnapshot({
        backendReadiness: [
          {
            platform: "macos",
            backendKind: "dsview-cli",
            readiness: "degraded",
            version: "1.3.1",
            checkedAt: refreshedAt,
            diagnostics: [
              createDiagnostic({
                code: "backend-runtime-timeout",
                message: "dsview-cli runtime probe timed out before readiness was confirmed on macos."
              })
            ]
          }
        ]
      }),
      expectedBackendReadiness: "degraded"
    }
  ])("rejects $name snapshots without discarding diagnostics", ({ snapshot, expectedBackendReadiness }) => {
    const result = evaluateStartSessionConstraints({
      request: createRequest(2, 24_000_000),
      snapshot,
      device: snapshot.devices[0]
    });

    expect(result).toMatchObject({
      ok: false,
      reason: "constraint-rejected",
      report: {
        evaluatedBackendReadiness: expectedBackendReadiness,
        backendReadiness: snapshot.backendReadiness,
        snapshotDiagnostics: snapshot.diagnostics
      }
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.report.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "backend-not-ready" })
        ])
      );
    }
  });

  it("rejects disconnected devices before allocation while preserving snapshot context", () => {
    const snapshot = createSnapshot({
      devices: [
        createDevice({
          connectionState: "disconnected"
        })
      ]
    });

    const result = evaluateStartSessionConstraints({
      request: createRequest(2, 24_000_000),
      snapshot,
      device: snapshot.devices[0]
    });

    expect(result).toMatchObject({
      ok: false,
      reason: "constraint-rejected",
      report: {
        device: expect.objectContaining({
          connectionState: "disconnected"
        }),
        evaluatedDeviceReadiness: "ready"
      }
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.report.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "device-not-ready",
            path: "device.connectionState"
          })
        ])
      );
    }
  });

  it("rejects unsupported device readiness and preserves the device diagnostic context", () => {
    const snapshot = createSnapshot({
      devices: [
        createDevice({
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

    const result = evaluateStartSessionConstraints({
      request: createRequest(2, 24_000_000),
      snapshot,
      device: snapshot.devices[0]
    });

    expect(result).toMatchObject({
      ok: false,
      reason: "constraint-rejected",
      report: {
        evaluatedDeviceReadiness: "unsupported",
        deviceDiagnostics: snapshot.devices[0]?.diagnostics
      }
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.report.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "unsupported-device" })
        ])
      );
    }
  });

  it("rejects devices with missing DSLogic identity or readiness metadata", () => {
    const snapshot = createSnapshot({
      devices: [
        createDevice({
          readiness: undefined,
          diagnostics: [
            createDiagnostic({
              code: "device-runtime-malformed-response",
              target: "device",
              message: "Device capability payload was incomplete.",
              deviceId: "logic-1"
            })
          ],
          dslogic: null
        })
      ]
    });

    const result = evaluateStartSessionConstraints({
      request: createRequest(2, 24_000_000),
      snapshot,
      device: snapshot.devices[0]
    });

    expect(result).toMatchObject({
      ok: false,
      reason: "constraint-rejected",
      report: {
        evaluatedDeviceReadiness: "missing",
        deviceDiagnostics: snapshot.devices[0]?.diagnostics
      }
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.report.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "device-not-ready" }),
          expect.objectContaining({ code: "missing-dslogic-identity" })
        ])
      );
    }
  });

  it("rejects a target device that only exists in backend diagnostics", () => {
    const snapshot = createSnapshot({
      devices: [],
      diagnostics: [
        createDiagnostic({
          code: "backend-runtime-failed",
          severity: "error",
          message: "Backend reported device logic-1 but could not hydrate its row.",
          deviceId: "logic-1"
        })
      ]
    });

    const result = evaluateStartSessionConstraints({
      request: createRequest(2, 24_000_000),
      snapshot,
      device: undefined
    });

    expect(result).toMatchObject({
      ok: false,
      reason: "constraint-rejected",
      report: {
        device: null,
        snapshotDiagnostics: snapshot.diagnostics
      }
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.report.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "device-not-found" })
        ])
      );
    }
  });
});
