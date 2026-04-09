import { describe, expect, expectTypeOf, it } from "vitest";

import {
  CAPTURE_COMPATIBILITY_ISSUE_CODES,
  CAPTURE_LOAD_FAILURE_REASONS,
  DEFAULT_CAPTURE_ADAPTERS,
  analyzeWaveformCapture,
  createCaptureLoader,
  loadLogicCapture,
  type CaptureArtifactInput,
  type LoadCaptureResult,
  type LogicAnalyzerSessionRecord,
  type LogicCapture
} from "./index.js";

const fixtureCsvText = [
  "Time [us],D0,D1",
  "0,0,1",
  "1,1,1",
  "2,1,0",
  "3,0,0"
].join("\n");

const fixtureVcdText = [
  "$date",
  "  2026-03-26T00:00:01.000Z",
  "$end",
  "$version DSView $end",
  "$timescale 1 ns $end",
  "$scope module logic $end",
  "$var wire 1 ! D0 $end",
  "$var wire 1 \" D1 $end",
  "$upscope $end",
  "$enddefinitions $end",
  "#0",
  "$dumpvars",
  "0!",
  "1\"",
  "$end",
  "#1000",
  "1!",
  "#2000",
  "0\"",
  "#3000",
  "0!"
].join("\n");

const baseSession: LogicAnalyzerSessionRecord = {
  sessionId: "session-001",
  deviceId: "logic-1",
  ownerSkillId: "logic-analyzer",
  startedAt: "2026-03-26T00:00:00.000Z",
  device: {
    deviceId: "logic-1",
    label: "USB Logic Analyzer",
    capabilityType: "logic-analyzer",
    connectionState: "connected",
    allocationState: "allocated",
    ownerSkillId: "logic-analyzer",
    lastSeenAt: "2026-03-26T00:00:00.000Z",
    updatedAt: "2026-03-26T00:00:00.000Z"
  },
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
};

const validCsvArtifact: CaptureArtifactInput = {
  sourceName: "capture.csv",
  capturedAt: "2026-03-26T00:00:01.000Z",
  text: fixtureCsvText
};

describe("capture loader contract", () => {
  it("exposes explicit offline capture result and compatibility types", () => {
    expect(CAPTURE_LOAD_FAILURE_REASONS).toEqual([
      "unsupported-adapter",
      "unreadable-input",
      "incompatible-session"
    ]);
    expect(CAPTURE_COMPATIBILITY_ISSUE_CODES).toEqual([
      "missing-channel",
      "sample-rate-mismatch",
      "duration-mismatch"
    ]);

    expectTypeOf<LogicCapture>().toMatchTypeOf<{
      adapterId: string;
      sampleRateHz: number;
      samplePeriodNs: number;
      totalSamples: number;
      durationNs: number;
      channels: readonly {
        channelId: string;
        initialLevel: 0 | 1;
        transitions: readonly {
          sampleIndex: number;
          timeNs: number;
          fromLevel: 0 | 1;
          toLevel: 0 | 1;
        }[];
      }[];
    }>();

    expectTypeOf<LoadCaptureResult>().toMatchTypeOf<
      | { ok: true; adapterId: string; selectedBy: "format-hint" | "probe"; capture: LogicCapture }
      | { ok: false; reason: "unsupported-adapter"; adapterIds: readonly string[] }
      | { ok: false; reason: "unreadable-input"; adapterId: string; details: readonly string[] }
      | { ok: false; reason: "incompatible-session"; adapterId: string; issues: readonly unknown[] }
    >();

    expect(DEFAULT_CAPTURE_ADAPTERS.map((adapter) => adapter.id)).toEqual([
      "sigrok-csv",
      "dsview-vcd"
    ]);
  });

  it("normalizes a sigrok-compatible CSV artifact through probe-based adapter selection", () => {
    const result = loadLogicCapture({
      session: baseSession,
      artifact: validCsvArtifact
    });

    expect(result).toMatchObject({
      ok: true,
      adapterId: "sigrok-csv",
      selectedBy: "probe"
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.capture).toEqual({
        adapterId: "sigrok-csv",
        sourceName: "capture.csv",
        capturedAt: "2026-03-26T00:00:01.000Z",
        sampleRateHz: 1_000_000,
        samplePeriodNs: 1000,
        totalSamples: 4,
        durationNs: 4000,
        channels: [
          {
            channelId: "D0",
            initialLevel: 0,
            transitions: [
              { sampleIndex: 1, timeNs: 1000, fromLevel: 0, toLevel: 1 },
              { sampleIndex: 3, timeNs: 3000, fromLevel: 1, toLevel: 0 }
            ]
          },
          {
            channelId: "D1",
            initialLevel: 1,
            transitions: [
              { sampleIndex: 2, timeNs: 2000, fromLevel: 1, toLevel: 0 }
            ]
          }
        ],
        artifact: {
          sourceName: "capture.csv",
          formatHint: null,
          mediaType: null,
          capturedAt: "2026-03-26T00:00:01.000Z",
          byteLength: null,
          hasText: true
        }
      });
    }
  });

  it("normalizes a DSView VCD artifact through format-hint selection", () => {
    const result = loadLogicCapture({
      session: baseSession,
      artifact: {
        sourceName: "logic-1-live.vcd",
        formatHint: "dsview-vcd",
        mediaType: "text/x-vcd",
        capturedAt: "2026-03-26T00:00:01.000Z",
        text: fixtureVcdText
      }
    });

    expect(result).toMatchObject({
      ok: true,
      adapterId: "dsview-vcd",
      selectedBy: "format-hint"
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.capture).toEqual({
        adapterId: "dsview-vcd",
        sourceName: "logic-1-live.vcd",
        capturedAt: "2026-03-26T00:00:01.000Z",
        sampleRateHz: 1_000_000,
        samplePeriodNs: 1000,
        totalSamples: 4,
        durationNs: 4000,
        channels: [
          {
            channelId: "D0",
            initialLevel: 0,
            transitions: [
              { sampleIndex: 1, timeNs: 1000, fromLevel: 0, toLevel: 1 },
              { sampleIndex: 3, timeNs: 3000, fromLevel: 1, toLevel: 0 }
            ]
          },
          {
            channelId: "D1",
            initialLevel: 1,
            transitions: [
              { sampleIndex: 2, timeNs: 2000, fromLevel: 1, toLevel: 0 }
            ]
          }
        ],
        artifact: {
          sourceName: "logic-1-live.vcd",
          formatHint: "dsview-vcd",
          mediaType: "text/x-vcd",
          capturedAt: "2026-03-26T00:00:01.000Z",
          byteLength: null,
          hasText: true
        }
      });
    }
  });

  it("returns a typed unsupported-adapter failure when no adapter matches the requested format hint", () => {
    const result = loadLogicCapture({
      session: baseSession,
      artifact: {
        sourceName: "capture.saleae",
        formatHint: "saleae-json",
        text: "{}"
      }
    });

    expect(result).toEqual({
      ok: false,
      reason: "unsupported-adapter",
      adapterIds: ["sigrok-csv", "dsview-vcd"],
      artifact: {
        sourceName: "capture.saleae",
        formatHint: "saleae-json",
        mediaType: null,
        capturedAt: null,
        byteLength: null,
        hasText: true
      },
      message: "No capture adapter matches format hint saleae-json."
    });
  });

  it("returns a typed unreadable-input failure for malformed sigrok-compatible CSV content", () => {
    const loader = createCaptureLoader();

    const result = loader({
      session: baseSession,
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
    });

    expect(result).toMatchObject({
      ok: false,
      reason: "unreadable-input",
      adapterId: "sigrok-csv",
      selectedBy: "format-hint"
    });
    expect(result.ok).toBe(false);
    if (!result.ok && result.reason === "unreadable-input") {
      expect(result.message).toBe("CSV sample timing must use a stable period.");
      expect(result.details).toEqual([
        "Rows 2 and 3 differ by 2000ns instead of 1000ns."
      ]);
    }
  });

  it("hands a loaded sigrok-compatible capture into the waveform analyzer through the root barrel", () => {
    const result = loadLogicCapture({
      session: baseSession,
      artifact: {
        ...validCsvArtifact,
        formatHint: "sigrok-csv"
      }
    });

    expect(result).toMatchObject({
      ok: true,
      adapterId: "sigrok-csv",
      selectedBy: "format-hint"
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const analysis = analyzeWaveformCapture(result.capture, baseSession.analysis);

      expect(analysis.captureSource).toEqual({
        adapterId: "sigrok-csv",
        sourceName: "capture.csv",
        capturedAt: "2026-03-26T00:00:01.000Z"
      });
      expect(analysis.timing).toEqual({
        sampleRateHz: 1_000_000,
        samplePeriodNs: 1000,
        totalSamples: 4,
        captureDurationNs: 4000,
        timeReference: "capture-start",
        referenceOffsetNs: 0,
        analyzedWindow: {
          startSampleIndex: 0,
          endSampleIndex: 3,
          sampleCount: 4,
          durationNs: 4000,
          clippedToCapture: false
        }
      });
      expect(analysis.analyzedChannelIds).toEqual(["D0", "D1"]);
      expect(analysis.channels).toEqual([
        {
          channelId: "D0",
          initialLevel: 0,
          finalLevel: 0,
          qualifyingEdgePolicy: "all",
          observedEdgeKinds: ["rising", "falling"],
          totalTransitionCount: 2,
          qualifyingTransitionCount: 2,
          firstQualifyingTransitionTimeNs: 1000,
          lastQualifyingTransitionTimeNs: 3000,
          pulseWidths: [
            {
              polarity: "high",
              count: 1,
              minWidthNs: 2000,
              maxWidthNs: 2000,
              averageWidthNs: 2000
            },
            {
              polarity: "low",
              count: 2,
              minWidthNs: 1000,
              maxWidthNs: 1000,
              averageWidthNs: 1000
            }
          ],
          rhythm: {
            edgeKind: "rising",
            intervalCount: 1,
            minIntervalNs: 2000,
            maxIntervalNs: 2000,
            averageIntervalNs: 2000,
            approximateFrequencyHz: 500000,
            isSteady: true
          },
          anomalies: [],
          notes: [],
          summaryText:
            "2 rising/falling edges observed, rhythm is steady at about 500000Hz, high widths avg 2000ns, low widths avg 1000ns."
        },
        {
          channelId: "D1",
          initialLevel: 1,
          finalLevel: 0,
          qualifyingEdgePolicy: "all",
          observedEdgeKinds: ["falling"],
          totalTransitionCount: 1,
          qualifyingTransitionCount: 1,
          firstQualifyingTransitionTimeNs: 2000,
          lastQualifyingTransitionTimeNs: 2000,
          pulseWidths: [
            {
              polarity: "high",
              count: 1,
              minWidthNs: 2000,
              maxWidthNs: 2000,
              averageWidthNs: 2000
            },
            {
              polarity: "low",
              count: 1,
              minWidthNs: 2000,
              maxWidthNs: 2000,
              averageWidthNs: 2000
            }
          ],
          rhythm: null,
          anomalies: [
            {
              code: "insufficient-transitions",
              severity: "warning",
              channelId: "D1",
              message: "Need at least two qualifying edges to estimate rhythm.",
              details: {
                qualifyingTransitionCount: 1
              }
            }
          ],
          notes: [
            {
              code: "insufficient-transition-data",
              channelId: "D1",
              message: "Need at least two qualifying transitions for rhythm analysis.",
              details: {
                qualifyingTransitionCount: 1
              }
            }
          ],
          summaryText:
            "1 falling edge observed, insufficient data for rhythm, high widths avg 2000ns, low widths avg 2000ns."
        }
      ]);
      expect(analysis.capabilityNotes).toEqual([
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
      expect(analysis.anomalies).toEqual([
        {
          code: "insufficient-transitions",
          severity: "warning",
          channelId: "D1",
          message: "Need at least two qualifying edges to estimate rhythm.",
          details: {
            qualifyingTransitionCount: 1
          }
        }
      ]);
      expect(analysis.summaryText).toBe(
        "D0 2 rising/falling edges observed, rhythm is steady at about 500000hz, high widths avg 2000ns, low widths avg 1000ns. D1 1 falling edge observed, insufficient data for rhythm, high widths avg 2000ns, low widths avg 2000ns.; some channels have insufficient data for rhythm, no protocol decoding is attempted"
      );
    }
  });

  it("returns explicit session/capture compatibility issues when capture facts contradict the session", () => {
    const result = loadLogicCapture({
      session: {
        ...baseSession,
        sampling: {
          sampleRateHz: 2_000_000,
          captureDurationMs: 0.004,
          channels: [
            { channelId: "D0", label: "CLK" },
            { channelId: "D2", label: "CS" }
          ]
        },
        analysis: {
          ...baseSession.analysis,
          focusChannelIds: ["D0", "D2"]
        }
      },
      artifact: validCsvArtifact
    });

    expect(result).toMatchObject({
      ok: false,
      reason: "incompatible-session",
      adapterId: "sigrok-csv",
      selectedBy: "probe"
    });
    expect(result.ok).toBe(false);
    if (!result.ok && result.reason === "incompatible-session") {
      expect(result.issues).toEqual(
        expect.arrayContaining([
          {
            code: "missing-channel",
            channelId: "D2",
            expected: "present",
            actual: "missing",
            message: "Capture is missing requested channel D2."
          },
          {
            code: "sample-rate-mismatch",
            expected: 2_000_000,
            actual: 1_000_000,
            message: "Capture sample rate 1000000Hz does not match requested 2000000Hz."
          }
        ])
      );
      expect(result.capture.channels.map((channel) => channel.channelId)).toEqual([
        "D0",
        "D1"
      ]);
    }
  });
});
