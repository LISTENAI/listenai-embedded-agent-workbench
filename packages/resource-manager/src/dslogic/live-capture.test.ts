import { describe, expect, expectTypeOf, it } from "vitest";

import {
  LIVE_CAPTURE_FAILURE_KINDS,
  LIVE_CAPTURE_FAILURE_PHASES,
  captureDslogicLive,
  createDslogicLiveCaptureProvider,
  createDslogicNativeLiveCapture,
  createLiveCaptureRequest,
  type LiveCaptureFailure,
  type LiveCaptureRequest,
  type LiveCaptureResult,
  type LiveCaptureSession,
  type LiveCaptureSuccess
} from "../index.js";

const makeChannels = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    channelId: `D${index}`,
    label: `Channel ${index}`
  }));

const createSession = (channelCount = 2): LiveCaptureSession => ({
  sessionId: `session-${channelCount}`,
  deviceId: "logic-1",
  ownerSkillId: "logic-analyzer",
  startedAt: "2026-03-30T10:00:00.000Z",
  device: {
    deviceId: "logic-1",
    label: "DSLogic Plus",
    capabilityType: "logic-analyzer",
    connectionState: "connected",
    allocationState: "allocated",
    ownerSkillId: "logic-analyzer",
    lastSeenAt: "2026-03-30T10:00:00.000Z",
    updatedAt: "2026-03-30T10:00:00.000Z",
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
  sampling: {
    sampleRateHz: 1_000_000,
    captureDurationMs: 10,
    channels: makeChannels(channelCount)
  }
});

describe("DSLogic live capture seam", () => {
  it("exposes typed live capture contracts through the root barrel", () => {
    expect(LIVE_CAPTURE_FAILURE_PHASES).toEqual([
      "validate-session",
      "prepare-runtime",
      "capture",
      "collect-artifact"
    ]);
    expect(LIVE_CAPTURE_FAILURE_KINDS).toEqual([
      "unsupported-runtime",
      "runtime-unavailable",
      "capture-failed",
      "timeout",
      "aborted",
      "malformed-output"
    ]);

    expectTypeOf<LiveCaptureRequest>().toMatchTypeOf<{
      session: LiveCaptureSession;
      requestedAt: string;
      timeoutMs?: number;
    }>();

    expectTypeOf<LiveCaptureSuccess>().toMatchTypeOf<{
      ok: true;
      providerKind: string;
      backendKind: string;
      session: LiveCaptureSession;
      requestedAt: string;
      artifact: {
        text?: string;
        bytes?: Uint8Array;
      };
      artifactSummary: {
        sourceName: string | null;
        byteLength: number | null;
        textLength: number | null;
        hasText: boolean;
      };
    }>();

    expectTypeOf<LiveCaptureFailure>().toMatchTypeOf<{
      ok: false;
      reason: "capture-failed";
      kind: (typeof LIVE_CAPTURE_FAILURE_KINDS)[number];
      diagnostics: {
        phase: (typeof LIVE_CAPTURE_FAILURE_PHASES)[number];
        backendVersion: string | null;
        timeoutMs: number | null;
        nativeCode: string | null;
      };
    }>();

    expectTypeOf<LiveCaptureResult>().toEqualTypeOf<
      LiveCaptureSuccess | LiveCaptureFailure
    >();
  });

  it("creates a provider-dispatched DSLogic native live capture adapter", async () => {
    const request = createLiveCaptureRequest(createSession(2));
    let capturedRequest: LiveCaptureRequest | undefined;
    const nativeCapture = createDslogicNativeLiveCapture(async (incomingRequest) => {
      capturedRequest = incomingRequest;
      return {
        ok: true,
        backendVersion: "libsigrok 0.5.2",
        artifact: {
          sourceName: "logic-1.csv",
          formatHint: "sigrok-csv",
          mediaType: "text/csv",
          text: "Time [us],D0,D1\n0,0,1\n"
        }
      };
    });
    const liveCapture = createDslogicLiveCaptureProvider(nativeCapture);

    expect(liveCapture.supportsDevice(request.session.device)).toBe(true);
    expect(
      liveCapture.supportsDevice({
        ...request.session.device,
        backendKind: "fake"
      })
    ).toBe(false);

    const result = await liveCapture.liveCapture(request);

    expect(capturedRequest).toEqual(request);
    expect(result).toMatchObject({
      ok: true,
      providerKind: "dslogic",
      backendKind: "libsigrok"
    });
  });

  it("returns a CaptureArtifactInput-compatible success result for a minimal 2-channel request", async () => {
    const artifactText = "Time [us],D0,D1\n0,0,1\n1,1,1\n";
    const request = createLiveCaptureRequest(createSession(2), {
      requestedAt: "2026-03-30T10:00:05.000Z",
      timeoutMs: 2_000
    });
    const nativeCapture = createDslogicNativeLiveCapture(async () => ({
      ok: true,
      backendVersion: "libsigrok 0.5.2",
      diagnosticOutput: { text: "capture ready" },
      artifact: {
        sourceName: "logic-1.csv",
        formatHint: "sigrok-csv",
        mediaType: "text/csv",
        capturedAt: "2026-03-30T10:00:06.000Z",
        text: artifactText
      }
    }));

    const result = await captureDslogicLive(request, { nativeCapture });

    expect(result).toEqual({
      ok: true,
      providerKind: "dslogic",
      backendKind: "libsigrok",
      session: request.session,
      requestedAt: "2026-03-30T10:00:05.000Z",
      artifact: {
        sourceName: "logic-1.csv",
        formatHint: "sigrok-csv",
        mediaType: "text/csv",
        capturedAt: "2026-03-30T10:00:06.000Z",
        text: artifactText
      },
      artifactSummary: {
        sourceName: "logic-1.csv",
        formatHint: "sigrok-csv",
        mediaType: "text/csv",
        capturedAt: "2026-03-30T10:00:06.000Z",
        byteLength: null,
        textLength: artifactText.length,
        hasText: true
      }
    });
  });

  it("accepts the max supported DSLogic Plus channel selection and summarizes byte payloads without duplication", async () => {
    const session = createSession(16);
    const request = createLiveCaptureRequest(session);
    const artifactBytes = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
    const nativeCapture = createDslogicNativeLiveCapture(async () => ({
      ok: true,
      artifact: {
        sourceName: "logic-1.sr",
        formatHint: "sigrok-session",
        mediaType: "application/x-sigrok-session",
        bytes: artifactBytes
      }
    }));

    const result = await captureDslogicLive(request, { nativeCapture });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.artifact.bytes).toBe(artifactBytes);
      expect(result.artifactSummary).toEqual({
        sourceName: "logic-1.sr",
        formatHint: "sigrok-session",
        mediaType: "application/x-sigrok-session",
        capturedAt: null,
        byteLength: 4,
        textLength: null,
        hasText: false
      });
    }
  });

  it("returns unsupported-runtime when accepted-session runtime facts are missing", async () => {
    const session = createSession(2);
    const request = createLiveCaptureRequest({
      ...session,
      device: {
        ...session.device,
        backendKind: undefined,
        dslogic: null
      }
    });
    const nativeCapture = createDslogicNativeLiveCapture(async () => {
      throw new Error("capture backend should not be called for invalid session context");
    });

    const result = await captureDslogicLive(request, { nativeCapture });

    expect(result).toMatchObject({
      ok: false,
      reason: "capture-failed",
      kind: "unsupported-runtime",
      diagnostics: {
        phase: "validate-session",
        backendKind: null,
        providerKind: "dslogic",
        backendVersion: null,
        nativeCode: null,
        captureOutput: null,
        diagnosticOutput: null
      }
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.details).toEqual([
        "Expected backendKind libsigrok.",
        "Accepted live capture sessions must include DSLogic identity details."
      ]);
      expect("executablePath" in result.diagnostics).toBe(false);
      expect("command" in result.diagnostics).toBe(false);
    }
  });

  it("returns runtime-unavailable when the native backend cannot be prepared", async () => {
    const request = createLiveCaptureRequest(createSession(2));
    const nativeCapture = createDslogicNativeLiveCapture(async () => ({
      ok: false,
      kind: "runtime-unavailable",
      phase: "prepare-runtime",
      message: "libsigrok runtime is not available on macos.",
      backendVersion: null,
      nativeCode: "backend-missing-runtime",
      details: ["libsigrok library path could not be resolved."]
    }));

    const result = await captureDslogicLive(request, { nativeCapture });

    expect(result).toEqual({
      ok: false,
      reason: "capture-failed",
      kind: "runtime-unavailable",
      message: "libsigrok runtime is not available on macos.",
      session: request.session,
      requestedAt: request.session.startedAt,
      artifactSummary: null,
      diagnostics: {
        phase: "prepare-runtime",
        providerKind: "dslogic",
        backendKind: "libsigrok",
        backendVersion: null,
        timeoutMs: 15000,
        nativeCode: "backend-missing-runtime",
        captureOutput: null,
        diagnosticOutput: null,
        details: ["libsigrok library path could not be resolved."],
        diagnostics: []
      }
    });
  });

  it("returns a dedicated timeout failure with bounded native capture diagnostics", async () => {
    const request = createLiveCaptureRequest(createSession(2), {
      timeoutMs: 3_000
    });
    const captureOutput = "capturing\nwaiting for trigger\n" + "x".repeat(300);
    const nativeCapture = createDslogicNativeLiveCapture(async () => ({
      ok: false,
      kind: "timeout",
      phase: "capture",
      message: "libsigrok capture timed out.",
      backendVersion: "libsigrok 0.5.2",
      timeoutMs: 3_000,
      captureOutput: { text: captureOutput },
      diagnosticOutput: { text: "still waiting" }
    }));

    const result = await captureDslogicLive(request, { nativeCapture });

    expect(result).toMatchObject({
      ok: false,
      reason: "capture-failed",
      kind: "timeout",
      diagnostics: {
        phase: "capture",
        backendVersion: "libsigrok 0.5.2",
        timeoutMs: 3_000,
        captureOutput: {
          kind: "text",
          preview: captureOutput.slice(0, 160),
          truncated: true
        },
        diagnosticOutput: {
          kind: "text",
          preview: "still waiting",
          truncated: false
        }
      }
    });
  });

  it("returns capture-failed when the native backend exits with a concrete error code", async () => {
    const request = createLiveCaptureRequest(createSession(2));
    const nativeCapture = createDslogicNativeLiveCapture(async () => ({
      ok: false,
      kind: "capture-failed",
      phase: "capture",
      message: "libsigrok failed to arm the device.",
      backendVersion: "libsigrok 0.5.2",
      nativeCode: "SR_ERR_BUSY",
      diagnosticOutput: { text: "device busy" }
    }));

    const result = await captureDslogicLive(request, { nativeCapture });

    expect(result).toMatchObject({
      ok: false,
      reason: "capture-failed",
      kind: "capture-failed",
      diagnostics: {
        phase: "capture",
        backendVersion: "libsigrok 0.5.2",
        nativeCode: "SR_ERR_BUSY",
        diagnosticOutput: {
          kind: "text",
          preview: "device busy"
        }
      }
    });
  });

  it("returns malformed-output when the native backend claims success but omits artifact data", async () => {
    const request = createLiveCaptureRequest(createSession(2));
    const nativeCapture = createDslogicNativeLiveCapture(async () => ({
      ok: true,
      backendVersion: "libsigrok 0.5.2",
      diagnosticOutput: { text: "capture complete" },
      artifact: {
        sourceName: "logic-1.csv",
        formatHint: "sigrok-csv",
        text: ""
      }
    }));

    const result = await captureDslogicLive(request, { nativeCapture });

    expect(result).toEqual({
      ok: false,
      reason: "capture-failed",
      kind: "malformed-output",
      message: "Native capture reported success but did not return a usable artifact payload.",
      session: request.session,
      requestedAt: request.session.startedAt,
      artifactSummary: {
        sourceName: "logic-1.csv",
        formatHint: "sigrok-csv",
        mediaType: null,
        capturedAt: null,
        byteLength: null,
        textLength: 0,
        hasText: true
      },
      diagnostics: {
        phase: "collect-artifact",
        providerKind: "dslogic",
        backendKind: "libsigrok",
        backendVersion: "libsigrok 0.5.2",
        timeoutMs: 15000,
        nativeCode: null,
        captureOutput: null,
        diagnosticOutput: {
          kind: "text",
          byteLength: 16,
          textLength: 16,
          preview: "capture complete",
          truncated: false
        },
        details: [
          "Expected artifact.text or artifact.bytes to contain non-empty capture data."
        ],
        diagnostics: []
      }
    });
  });
});
