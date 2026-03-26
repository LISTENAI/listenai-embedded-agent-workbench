import { describe, expect, it } from "vitest";

import {
  FakeDeviceProvider,
  createGenericLogicAnalyzerSkill,
  createLogicAnalyzerSkill,
  createResourceManager
} from "../index.js";

const connectedAt = "2026-03-26T00:00:00.000Z";
const allocatedAt = "2026-03-26T00:01:00.000Z";
const releasedAt = "2026-03-26T00:02:00.000Z";

const baseDevice = {
  deviceId: "logic-1",
  label: "USB Logic Analyzer",
  capabilityType: "logic-analyzer",
  lastSeenAt: connectedAt
} as const;

const fixtureCsvText = [
  "Time [us],D0,D1",
  "0,0,1",
  "1,1,1",
  "2,1,0",
  "3,0,0"
].join("\n");

describe("logic analyzer package-root end-to-end workflow", () => {
  it("keeps inventory visible across refresh, packaged success, and explicit release", async () => {
    const provider = new FakeDeviceProvider([baseDevice]);
    const resourceManager = createResourceManager(provider, {
      now: () => connectedAt
    });
    const genericSkill = createGenericLogicAnalyzerSkill(resourceManager, {
      createSessionId: () => "session-001"
    });
    const sessionSkill = createLogicAnalyzerSkill(resourceManager);

    expect(resourceManager.listDevices()).toEqual([]);

    const refreshedInventory = await resourceManager.refreshInventory();

    expect(refreshedInventory).toEqual([
      {
        deviceId: "logic-1",
        label: "USB Logic Analyzer",
        capabilityType: "logic-analyzer",
        connectionState: "connected",
        allocationState: "free",
        ownerSkillId: null,
        lastSeenAt: connectedAt,
        updatedAt: connectedAt
      }
    ]);
    expect(resourceManager.listDevices()).toEqual(refreshedInventory);

    const result = await genericSkill.run({
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
        endedAt: releasedAt
      }
    });

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
        selectedBy: "probe",
        capture: {
          adapterId: "sigrok-csv",
          sampleRateHz: 1_000_000,
          samplePeriodNs: 1000,
          totalSamples: 4,
          durationNs: 4000,
          artifact: {
            sourceName: "capture.csv",
            hasText: true
          }
        }
      },
      analysis: {
        captureSource: {
          adapterId: "sigrok-csv",
          sourceName: "capture.csv",
          capturedAt: "2026-03-26T00:00:01.000Z"
        },
        analyzedChannelIds: ["D0", "D1"]
      }
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

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

    expect(resourceManager.listDevices()).toEqual([
      {
        deviceId: "logic-1",
        label: "USB Logic Analyzer",
        capabilityType: "logic-analyzer",
        connectionState: "connected",
        allocationState: "allocated",
        ownerSkillId: "logic-analyzer",
        lastSeenAt: connectedAt,
        updatedAt: allocatedAt
      }
    ]);

    const endResult = sessionSkill.endSession({
      sessionId: result.session.sessionId,
      deviceId: result.session.deviceId,
      ownerSkillId: result.session.ownerSkillId,
      endedAt: releasedAt
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
        updatedAt: releasedAt
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
        updatedAt: releasedAt
      }
    ]);
  });
});
