import { describe, expect, expectTypeOf, it } from "vitest";

import {
  CAPTURE_CONTENT_KINDS,
  CAPTURE_LOAD_FAILURE_REASONS,
  SESSION_CAPTURE_COMPATIBILITY_CODES,
  type CaptureAdapter,
  type CaptureArtifactInput,
  type CaptureLoadResult,
  type CaptureLoadSuccess,
  type CaptureSessionCompatibilityIssue,
  type LogicAnalyzerSessionRecord,
  type NormalizedLogicCapture
} from "../index.js";

const session: LogicAnalyzerSessionRecord = {
  sessionId: "session-001",
  deviceId: "logic-1",
  ownerSkillId: "logic-analyzer",
  startedAt: "2026-03-26T00:01:00.000Z",
  device: {
    deviceId: "logic-1",
    label: "USB Logic Analyzer",
    capabilityType: "logic-analyzer",
    connectionState: "connected",
    allocationState: "allocated",
    ownerSkillId: "logic-analyzer",
    lastSeenAt: "2026-03-26T00:00:00.000Z",
    updatedAt: "2026-03-26T00:01:00.000Z"
  },
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
    timeReference: "first-transition"
  }
};

const sigrokCsvArtifact: CaptureArtifactInput = {
  contentKind: "text",
  sourceName: "pulseview-export.csv",
  formatHint: "sigrok-csv",
  mediaType: "text/csv",
  capturedAt: "2026-03-26T00:01:30.000Z",
  text: [
    "Time[s],D0,D1",
    "0.000000000,0,1",
    "0.000000042,1,1",
    "0.000000084,1,0"
  ].join("\n")
};

const normalizedCapture: NormalizedLogicCapture = {
  sampleRateHz: 24_000_000,
  totalSamples: 600_000,
  durationNs: 25_000_000,
  channels: [
    {
      channelId: "D0",
      label: "CLK",
      initialLevel: 0,
      transitions: [
        {
          sampleIndex: 1,
          timestampNs: 42,
          level: 1
        }
      ]
    },
    {
      channelId: "D1",
      label: "MOSI",
      initialLevel: 1,
      transitions: [
        {
          sampleIndex: 2,
          timestampNs: 84,
          level: 0
        }
      ]
    }
  ],
  metadata: {
    sourceName: "pulseview-export.csv",
    formatHint: "sigrok-csv",
    mediaType: "text/csv",
    capturedAt: "2026-03-26T00:01:30.000Z",
    adapterId: "sigrok-csv"
  }
};

describe("capture ingest contract", () => {
  it("exposes a host-neutral artifact shape and typed load result union", async () => {
    expect(CAPTURE_CONTENT_KINDS).toEqual(["text", "bytes"]);
    expect(CAPTURE_LOAD_FAILURE_REASONS).toEqual([
      "unsupported-adapter",
      "unreadable-input",
      "incompatible-session-capture"
    ]);
    expect(SESSION_CAPTURE_COMPATIBILITY_CODES).toEqual([
      "missing-session-channel",
      "missing-capture-channel",
      "sample-rate-mismatch",
      "capture-duration-exceeds-session"
    ]);

    expectTypeOf<CaptureArtifactInput>().toMatchTypeOf<
      | {
          contentKind: "text";
          text: string;
          sourceName?: string;
          formatHint?: string;
        }
      | {
          contentKind: "bytes";
          bytes: Uint8Array;
          mediaType?: string;
        }
    >();

    expectTypeOf<NormalizedLogicCapture>().toMatchTypeOf<{
      sampleRateHz: number;
      totalSamples: number;
      durationNs: number;
      channels: readonly {
        channelId: string;
        initialLevel: 0 | 1;
        transitions: readonly {
          sampleIndex: number;
          timestampNs: number;
          level: 0 | 1;
        }[];
      }[];
      metadata: {
        adapterId: string;
      };
    }>();

    expectTypeOf<CaptureLoadResult>().toMatchTypeOf<
      | { ok: true; adapterId: string; capture: NormalizedLogicCapture }
      | {
          ok: false;
          reason: "unsupported-adapter";
          attemptedAdapterIds: readonly string[];
        }
      | {
          ok: false;
          reason: "unreadable-input";
          adapterId: string | null;
          detail: string;
        }
      | {
          ok: false;
          reason: "incompatible-session-capture";
          issues: readonly CaptureSessionCompatibilityIssue[];
        }
    >();

    const adapter: CaptureAdapter = {
      adapterId: "sigrok-csv",
      displayName: "sigrok CSV export",
      matches(input) {
        return input.formatHint === "sigrok-csv"
          ? { confidence: "exact", reason: "format hint matches sigrok CSV" }
          : null;
      },
      async load(input, context) {
        expect(input).toEqual(sigrokCsvArtifact);
        expect(context.session).toEqual(session);

        return {
          ok: true,
          adapterId: "sigrok-csv",
          artifact: {
            sourceName: input.sourceName,
            formatHint: input.formatHint,
            mediaType: input.mediaType,
            capturedAt: input.capturedAt
          },
          capture: normalizedCapture
        } satisfies CaptureLoadSuccess;
      }
    };

    expect(adapter.matches(sigrokCsvArtifact)).toEqual({
      confidence: "exact",
      reason: "format hint matches sigrok CSV"
    });
    await expect(
      adapter.load(sigrokCsvArtifact, {
        session
      })
    ).resolves.toEqual({
      ok: true,
      adapterId: "sigrok-csv",
      artifact: {
        sourceName: "pulseview-export.csv",
        formatHint: "sigrok-csv",
        mediaType: "text/csv",
        capturedAt: "2026-03-26T00:01:30.000Z"
      },
      capture: normalizedCapture
    });
  });

  it("keeps unsupported inputs inspectable without collapsing into parser failures", () => {
    const result: CaptureLoadResult = {
      ok: false,
      reason: "unsupported-adapter",
      artifact: {
        sourceName: "mystery.bin",
        formatHint: "vendor-blob",
        mediaType: "application/octet-stream"
      },
      attemptedAdapterIds: ["sigrok-csv"],
      message: "No registered adapter accepted formatHint vendor-blob."
    };

    expect(result).toEqual({
      ok: false,
      reason: "unsupported-adapter",
      artifact: {
        sourceName: "mystery.bin",
        formatHint: "vendor-blob",
        mediaType: "application/octet-stream"
      },
      attemptedAdapterIds: ["sigrok-csv"],
      message: "No registered adapter accepted formatHint vendor-blob."
    });
  });

  it("surfaces unreadable sigrok-compatible content with adapter and artifact detail", () => {
    const result: CaptureLoadResult = {
      ok: false,
      reason: "unreadable-input",
      adapterId: "sigrok-csv",
      artifact: {
        sourceName: "pulseview-export.csv",
        formatHint: "sigrok-csv",
        mediaType: "text/csv"
      },
      detail: "Expected CSV header columns Time[s],D0,D1 but found Time[s],A0,A1.",
      message: "sigrok CSV artifact could not be normalized."
    };

    expect(result).toEqual({
      ok: false,
      reason: "unreadable-input",
      adapterId: "sigrok-csv",
      artifact: {
        sourceName: "pulseview-export.csv",
        formatHint: "sigrok-csv",
        mediaType: "text/csv"
      },
      detail: "Expected CSV header columns Time[s],D0,D1 but found Time[s],A0,A1.",
      message: "sigrok CSV artifact could not be normalized."
    });
  });

  it("reports session and capture compatibility mismatches against the session contract", () => {
    const result: CaptureLoadResult = {
      ok: false,
      reason: "incompatible-session-capture",
      adapterId: "sigrok-csv",
      artifact: {
        sourceName: "pulseview-export.csv",
        formatHint: "sigrok-csv",
        mediaType: "text/csv"
      },
      issues: [
        {
          code: "missing-session-channel",
          message: "Capture does not include requested session channel D1.",
          sessionChannelId: "D1"
        },
        {
          code: "sample-rate-mismatch",
          message: "Capture sample rate does not match the session sampling request.",
          expected: session.sampling.sampleRateHz,
          actual: 12_000_000
        },
        {
          code: "capture-duration-exceeds-session",
          message: "Capture duration exceeds the requested session window.",
          expected: session.sampling.captureDurationMs,
          actual: 30
        }
      ],
      message: "Capture metadata is incompatible with the active logic analyzer session."
    };

    expect(result.ok).toBe(false);
    if (!result.ok && result.reason === "incompatible-session-capture") {
      expect(result.issues).toEqual([
        {
          code: "missing-session-channel",
          message: "Capture does not include requested session channel D1.",
          sessionChannelId: "D1"
        },
        {
          code: "sample-rate-mismatch",
          message: "Capture sample rate does not match the session sampling request.",
          expected: 24_000_000,
          actual: 12_000_000
        },
        {
          code: "capture-duration-exceeds-session",
          message: "Capture duration exceeds the requested session window.",
          expected: 25,
          actual: 30
        }
      ]);
    }
  });
});
