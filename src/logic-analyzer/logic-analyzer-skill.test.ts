import { describe, expect, expectTypeOf, it } from "vitest";

import {
  ANALYSIS_EDGE_POLICIES,
  ANALYSIS_TIME_REFERENCES,
  LOGIC_ANALYZER_END_FAILURE_REASONS,
  LOGIC_ANALYZER_START_FAILURE_REASONS,
  VALIDATION_ISSUE_CODES,
  type EndLogicAnalyzerSessionResult,
  type LogicAnalyzerSessionRecord,
  type LogicAnalyzerValidationIssue,
  type StartLogicAnalyzerSessionRequest,
  type StartLogicAnalyzerSessionResult,
  validateEndLogicAnalyzerSessionRequest,
  validateStartLogicAnalyzerSessionRequest
} from "../index.js";

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
    const result = validateStartLogicAnalyzerSessionRequest({
      deviceId: "logic-1",
      ownerSkillId: "logic-analyzer",
      requestedAt: "2026-03-26T00:00:00.000Z",
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
      }
    });

    expect(result).toEqual({
      ok: true,
      value: {
        deviceId: "logic-1",
        ownerSkillId: "logic-analyzer",
        requestedAt: "2026-03-26T00:00:00.000Z",
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
        }
      }
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
