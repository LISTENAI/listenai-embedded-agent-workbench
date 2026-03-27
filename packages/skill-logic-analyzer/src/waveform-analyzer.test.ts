import { describe, expect, expectTypeOf, it } from "vitest";

import {
  EDGE_KINDS_BY_POLICY,
  WAVEFORM_ANALYSIS_ANOMALY_CODES,
  WAVEFORM_ANALYSIS_NOTE_CODES,
  WAVEFORM_ANOMALY_SEVERITIES,
  WAVEFORM_EDGE_KINDS,
  WAVEFORM_PULSE_POLARITIES,
  analyzeWaveformCapture,
  getObservedEdgeKinds,
  type LogicCapture,
  type WaveformAnalysisResult,
  type WaveformCapabilityNote,
  type WaveformChannelObservation
} from "./index.js";

const baseCapture: LogicCapture = {
  adapterId: "sigrok-csv",
  sourceName: "clock.csv",
  capturedAt: "2026-03-26T00:00:01.000Z",
  sampleRateHz: 1_000_000,
  samplePeriodNs: 1000,
  totalSamples: 12,
  durationNs: 12_000,
  channels: [
    {
      channelId: "D0",
      label: "CLK",
      initialLevel: 0,
      transitions: [
        { sampleIndex: 1, timeNs: 1000, fromLevel: 0, toLevel: 1 },
        { sampleIndex: 3, timeNs: 3000, fromLevel: 1, toLevel: 0 },
        { sampleIndex: 5, timeNs: 5000, fromLevel: 0, toLevel: 1 },
        { sampleIndex: 7, timeNs: 7000, fromLevel: 1, toLevel: 0 },
        { sampleIndex: 9, timeNs: 9000, fromLevel: 0, toLevel: 1 }
      ]
    },
    {
      channelId: "D1",
      label: "DATA",
      initialLevel: 1,
      transitions: [
        { sampleIndex: 2, timeNs: 2000, fromLevel: 1, toLevel: 0 },
        { sampleIndex: 6, timeNs: 6000, fromLevel: 0, toLevel: 1 }
      ]
    }
  ],
  artifact: {
    sourceName: "clock.csv",
    formatHint: "sigrok-csv",
    mediaType: "text/csv",
    capturedAt: "2026-03-26T00:00:01.000Z",
    byteLength: 128,
    hasText: true
  }
};

describe("waveform analysis contract", () => {
  it("exposes explicit structured result, anomaly, note, and analyzer surfaces from the root barrel", () => {
    expect(WAVEFORM_EDGE_KINDS).toEqual(["rising", "falling"]);
    expect(WAVEFORM_PULSE_POLARITIES).toEqual(["high", "low"]);
    expect(WAVEFORM_ANOMALY_SEVERITIES).toEqual(["info", "warning", "error"]);
    expect(WAVEFORM_ANALYSIS_ANOMALY_CODES).toEqual([
      "no-qualifying-edges",
      "insufficient-transitions",
      "inconsistent-pulse-widths",
      "irregular-rhythm",
      "window-truncated-activity"
    ]);
    expect(WAVEFORM_ANALYSIS_NOTE_CODES).toEqual([
      "focus-channels-applied",
      "analysis-window-applied",
      "edge-policy-filtered",
      "pulse-widths-disabled",
      "insufficient-transition-data",
      "time-reference-shifted",
      "baseline-only-no-protocol-decoding"
    ]);
    expect(typeof analyzeWaveformCapture).toBe("function");

    expectTypeOf<WaveformCapabilityNote>().toMatchTypeOf<{
      code:
        | "focus-channels-applied"
        | "analysis-window-applied"
        | "edge-policy-filtered"
        | "pulse-widths-disabled"
        | "insufficient-transition-data"
        | "time-reference-shifted"
        | "baseline-only-no-protocol-decoding";
      message: string;
      channelId?: string;
      details?: Readonly<Record<string, number | string | boolean | null>>;
    }>();

    expectTypeOf<WaveformChannelObservation>().toMatchTypeOf<{
      channelId: string;
      initialLevel: 0 | 1;
      finalLevel: 0 | 1;
      qualifyingEdgePolicy: "all" | "rising" | "falling";
      observedEdgeKinds: readonly ("rising" | "falling")[];
      totalTransitionCount: number;
      qualifyingTransitionCount: number;
      pulseWidths: readonly {
        polarity: "high" | "low";
        count: number;
        minWidthNs: number;
        maxWidthNs: number;
        averageWidthNs: number;
      }[];
      rhythm: {
        edgeKind: "rising" | "falling";
        intervalCount: number;
        approximateFrequencyHz: number | null;
        isSteady: boolean;
      } | null;
      anomalies: readonly {
        code:
          | "no-qualifying-edges"
          | "insufficient-transitions"
          | "inconsistent-pulse-widths"
          | "irregular-rhythm"
          | "window-truncated-activity";
        severity: "info" | "warning" | "error";
        message: string;
      }[];
      notes: readonly WaveformCapabilityNote[];
      summaryText: string;
    }>();

    expectTypeOf<WaveformAnalysisResult>().toMatchTypeOf<{
      captureSource: {
        adapterId: string;
        sourceName: string | null;
        capturedAt: string | null;
      };
      timing: {
        sampleRateHz: number;
        samplePeriodNs: number;
        totalSamples: number;
        captureDurationNs: number;
        timeReference: "capture-start" | "first-transition";
        referenceOffsetNs: number;
        analyzedWindow: {
          startSampleIndex: number;
          endSampleIndex: number;
          sampleCount: number;
          durationNs: number;
          clippedToCapture: boolean;
        };
      };
      analyzedChannelIds: readonly string[];
      channels: readonly WaveformChannelObservation[];
      anomalies: readonly {
        code:
          | "no-qualifying-edges"
          | "insufficient-transitions"
          | "inconsistent-pulse-widths"
          | "irregular-rhythm"
          | "window-truncated-activity";
        severity: "info" | "warning" | "error";
        message: string;
      }[];
      capabilityNotes: readonly WaveformCapabilityNote[];
      summaryText: string;
    }>();
  });

  it("pins edge-policy qualification behavior and derives steady pulse/rhythm observations from a clipped window", () => {
    expect(EDGE_KINDS_BY_POLICY).toEqual({
      all: ["rising", "falling"],
      rising: ["rising"],
      falling: ["falling"]
    });
    expect(getObservedEdgeKinds("all")).toEqual(["rising", "falling"]);
    expect(getObservedEdgeKinds("rising")).toEqual(["rising"]);
    expect(getObservedEdgeKinds("falling")).toEqual(["falling"]);

    const result = analyzeWaveformCapture(baseCapture, {
      focusChannelIds: ["D0"],
      edgePolicy: "all",
      includePulseWidths: true,
      timeReference: "capture-start",
      window: {
        startSampleIndex: 2,
        endSampleIndex: 8
      }
    });

    expect(result.captureSource).toEqual({
      adapterId: "sigrok-csv",
      sourceName: "clock.csv",
      capturedAt: "2026-03-26T00:00:01.000Z"
    });
    expect(result.timing).toEqual({
      sampleRateHz: 1_000_000,
      samplePeriodNs: 1000,
      totalSamples: 12,
      captureDurationNs: 12_000,
      timeReference: "capture-start",
      referenceOffsetNs: 0,
      analyzedWindow: {
        startSampleIndex: 2,
        endSampleIndex: 8,
        sampleCount: 7,
        durationNs: 7000,
        clippedToCapture: false
      }
    });
    expect(result.analyzedChannelIds).toEqual(["D0"]);
    expect(result.capabilityNotes.map((entry) => entry.code)).toEqual([
      "focus-channels-applied",
      "analysis-window-applied",
      "baseline-only-no-protocol-decoding"
    ]);
    expect(result.anomalies).toEqual([
      {
        code: "window-truncated-activity",
        severity: "info",
        message: "Analysis only covers the requested sample window.",
        details: {
          startSampleIndex: 2,
          endSampleIndex: 8,
          clippedToCapture: false
        }
      },
      {
        code: "inconsistent-pulse-widths",
        severity: "warning",
        channelId: "D0",
        message: "high pulse widths vary noticeably within the analyzed window.",
        details: {
          polarity: "high",
          minWidthNs: 1000,
          maxWidthNs: 2000,
          averageWidthNs: 1500
        }
      }
    ]);
    expect(result.channels).toHaveLength(1);
    expect(result.channels[0]).toEqual({
      channelId: "D0",
      label: "CLK",
      initialLevel: 1,
      finalLevel: 0,
      qualifyingEdgePolicy: "all",
      observedEdgeKinds: ["rising", "falling"],
      totalTransitionCount: 3,
      qualifyingTransitionCount: 3,
      firstQualifyingTransitionTimeNs: 3000,
      lastQualifyingTransitionTimeNs: 7000,
      pulseWidths: [
        {
          polarity: "high",
          count: 2,
          minWidthNs: 1000,
          maxWidthNs: 2000,
          averageWidthNs: 1500
        },
        {
          polarity: "low",
          count: 2,
          minWidthNs: 2000,
          maxWidthNs: 2000,
          averageWidthNs: 2000
        }
      ],
      rhythm: {
        edgeKind: "falling",
        intervalCount: 2,
        minIntervalNs: 2000,
        maxIntervalNs: 2000,
        averageIntervalNs: 2000,
        approximateFrequencyHz: 500000,
        isSteady: true
      },
      anomalies: [
        {
          code: "inconsistent-pulse-widths",
          severity: "warning",
          channelId: "D0",
          message: "high pulse widths vary noticeably within the analyzed window.",
          details: {
            polarity: "high",
            minWidthNs: 1000,
            maxWidthNs: 2000,
            averageWidthNs: 1500
          }
        }
      ],
      notes: [],
      summaryText:
        "3 rising/falling edges observed, rhythm is steady at about 500000Hz, high widths avg 1500ns, low widths avg 2000ns."
    });
    expect(result.summaryText).toContain("D0 3 rising/falling edges observed");
    expect(result.summaryText).toContain("no protocol decoding is attempted");
  });

  it("keeps filtered edges, time-reference shifts, and insufficient rhythm evidence explicit", () => {
    const result = analyzeWaveformCapture(baseCapture, {
      focusChannelIds: ["D0"],
      edgePolicy: "rising",
      includePulseWidths: false,
      timeReference: "first-transition",
      window: {
        startSampleIndex: 2,
        endSampleIndex: 8
      }
    });

    expect(result.timing.referenceOffsetNs).toBe(3000);
    expect(result.capabilityNotes.map((entry) => entry.code)).toEqual([
      "focus-channels-applied",
      "analysis-window-applied",
      "pulse-widths-disabled",
      "time-reference-shifted",
      "baseline-only-no-protocol-decoding"
    ]);
    expect(result.channels[0]).toEqual({
      channelId: "D0",
      label: "CLK",
      initialLevel: 1,
      finalLevel: 0,
      qualifyingEdgePolicy: "rising",
      observedEdgeKinds: ["rising"],
      totalTransitionCount: 3,
      qualifyingTransitionCount: 1,
      firstQualifyingTransitionTimeNs: 2000,
      lastQualifyingTransitionTimeNs: 2000,
      pulseWidths: [],
      rhythm: null,
      anomalies: [
        {
          code: "insufficient-transitions",
          severity: "warning",
          channelId: "D0",
          message: "Need at least two qualifying edges to estimate rhythm.",
          details: {
            qualifyingTransitionCount: 1
          }
        }
      ],
      notes: [
        {
          code: "edge-policy-filtered",
          channelId: "D0",
          message: "2 transitions were excluded by the rising-only policy.",
          details: {
            filteredTransitionCount: 2,
            edgePolicy: "rising"
          }
        },
        {
          code: "insufficient-transition-data",
          channelId: "D0",
          message: "Need at least two qualifying transitions for rhythm analysis.",
          details: {
            qualifyingTransitionCount: 1
          }
        }
      ],
      summaryText:
        "1 rising edge observed, after filtering out 2 transitions, insufficient data for rhythm."
    });
    expect(result.summaryText).toContain("some channels have insufficient data for rhythm");
  });

  it("surfaces missing qualifying edges and clipped windows instead of silently omitting them", () => {
    const result = analyzeWaveformCapture(baseCapture, {
      focusChannelIds: ["D1"],
      edgePolicy: "rising",
      includePulseWidths: true,
      timeReference: "first-transition",
      window: {
        startSampleIndex: -3,
        endSampleIndex: 2
      }
    });

    expect(result.timing).toEqual({
      sampleRateHz: 1_000_000,
      samplePeriodNs: 1000,
      totalSamples: 12,
      captureDurationNs: 12_000,
      timeReference: "first-transition",
      referenceOffsetNs: 2000,
      analyzedWindow: {
        startSampleIndex: 0,
        endSampleIndex: 2,
        sampleCount: 3,
        durationNs: 3000,
        clippedToCapture: true
      }
    });
    expect(result.capabilityNotes.map((entry) => entry.code)).toEqual([
      "focus-channels-applied",
      "analysis-window-applied",
      "time-reference-shifted",
      "baseline-only-no-protocol-decoding"
    ]);
    expect(result.anomalies.map((entry) => entry.code)).toEqual([
      "window-truncated-activity",
      "no-qualifying-edges"
    ]);
    expect(result.channels[0]).toEqual({
      channelId: "D1",
      label: "DATA",
      initialLevel: 1,
      finalLevel: 0,
      qualifyingEdgePolicy: "rising",
      observedEdgeKinds: [],
      totalTransitionCount: 1,
      qualifyingTransitionCount: 0,
      firstQualifyingTransitionTimeNs: null,
      lastQualifyingTransitionTimeNs: null,
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
          minWidthNs: 1000,
          maxWidthNs: 1000,
          averageWidthNs: 1000
        }
      ],
      rhythm: null,
      anomalies: [
        {
          code: "no-qualifying-edges",
          severity: "warning",
          channelId: "D1",
          message: "No rising edges were observed in the analyzed window.",
          details: {
            totalTransitionCount: 1,
            qualifyingTransitionCount: 0
          }
        }
      ],
      notes: [
        {
          code: "edge-policy-filtered",
          channelId: "D1",
          message: "1 transition was excluded by the rising-only policy.",
          details: {
            filteredTransitionCount: 1,
            edgePolicy: "rising"
          }
        },
        {
          code: "insufficient-transition-data",
          channelId: "D1",
          message: "Need qualifying transitions before edge rhythm or frequency can be inferred.",
          details: {
            qualifyingTransitionCount: 0
          }
        }
      ],
      summaryText:
        "0 qualifying edges observed, after filtering out 1 transition, insufficient data for rhythm, high widths avg 2000ns, low widths avg 1000ns."
    });
  });
});

