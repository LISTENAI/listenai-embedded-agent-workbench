import { describe, expect, expectTypeOf, it } from "vitest";

import {
  LIVE_CAPTURE_FAILURE_KINDS,
  LIVE_CAPTURE_FAILURE_PHASES,
  captureDslogicLive,
  createDslogicLiveCaptureProvider,
  createDslogicLiveCaptureRunner,
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
    backendKind: "dsview",
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
      "spawn-runner",
      "await-runner",
      "collect-artifact"
    ]);
    expect(LIVE_CAPTURE_FAILURE_KINDS).toEqual([
      "unsupported-runtime",
      "spawn-failed",
      "runner-exited",
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
        timeoutMs: number | null;
        exitCode: number | null;
      };
    }>();

    expectTypeOf<LiveCaptureResult>().toEqualTypeOf<
      LiveCaptureSuccess | LiveCaptureFailure
    >();
  });

  it("creates a provider-dispatched DSLogic live capture adapter", async () => {
    const request = createLiveCaptureRequest(createSession(2));
    let capturedRequest: LiveCaptureRequest | undefined;
    const liveCapture = createDslogicLiveCaptureProvider(
      createDslogicLiveCaptureRunner(async (incomingRequest) => {
        capturedRequest = incomingRequest;
        return {
          ok: true,
          artifact: {
            sourceName: "logic-1.csv",
            formatHint: "sigrok-csv",
            mediaType: "text/csv",
            text: "Time [us],D0,D1\n0,0,1\n"
          }
        };
      })
    );

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
      backendKind: "dsview"
    });
  });

  it("returns a CaptureArtifactInput-compatible success result for a minimal 2-channel request", async () => {
    const artifactText = "Time [us],D0,D1\n0,0,1\n1,1,1\n";
    const request = createLiveCaptureRequest(createSession(2), {
      requestedAt: "2026-03-30T10:00:05.000Z",
      timeoutMs: 2_000
    });
    const runner = createDslogicLiveCaptureRunner(async () => ({
      ok: true,
      executablePath: "/Applications/DSView.app/Contents/MacOS/DSView",
      command: ["dsview", "--capture", "logic-1"],
      stdout: { text: "capture ready" },
      artifact: {
        sourceName: "logic-1.csv",
        formatHint: "sigrok-csv",
        mediaType: "text/csv",
        capturedAt: "2026-03-30T10:00:06.000Z",
        text: artifactText
      }
    }));

    const result = await captureDslogicLive(request, { runner });

    expect(result).toEqual({
      ok: true,
      providerKind: "dslogic",
      backendKind: "dsview",
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
    const runner = createDslogicLiveCaptureRunner(async () => ({
      ok: true,
      artifact: {
        sourceName: "logic-1.sr",
        formatHint: "sigrok-session",
        mediaType: "application/x-sigrok-session",
        bytes: artifactBytes
      }
    }));

    const result = await captureDslogicLive(request, { runner });

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
    const request = createLiveCaptureRequest({
      ...createSession(2),
      device: {
        ...createSession(2).device,
        backendKind: undefined,
        dslogic: null
      }
    });
    const runner = createDslogicLiveCaptureRunner(async () => {
      throw new Error("runner should not be called for invalid session context");
    });

    const result = await captureDslogicLive(request, { runner });

    expect(result).toMatchObject({
      ok: false,
      reason: "capture-failed",
      kind: "unsupported-runtime",
      diagnostics: {
        phase: "validate-session",
        backendKind: null,
        providerKind: "dslogic"
      }
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.details).toEqual([
        "Expected backendKind dsview.",
        "Accepted live capture sessions must include DSLogic identity details."
      ]);
    }
  });

  it("returns spawn-failed when the runner cannot be started", async () => {
    const request = createLiveCaptureRequest(createSession(2));
    const runner = createDslogicLiveCaptureRunner(async () => ({
      ok: false,
      kind: "spawn-failed",
      phase: "spawn-runner",
      message: "Failed to spawn DSView backend process.",
      executablePath: "/usr/local/bin/dsview",
      command: ["dsview", "--capture", "logic-1"],
      details: ["ENOENT"]
    }));

    const result = await captureDslogicLive(request, { runner });

    expect(result).toEqual({
      ok: false,
      reason: "capture-failed",
      kind: "spawn-failed",
      message: "Failed to spawn DSView backend process.",
      session: request.session,
      requestedAt: request.session.startedAt,
      artifactSummary: null,
      diagnostics: {
        phase: "spawn-runner",
        providerKind: "dslogic",
        backendKind: "dsview",
        executablePath: "/usr/local/bin/dsview",
        command: ["dsview", "--capture", "logic-1"],
        timeoutMs: 15000,
        exitCode: null,
        signal: null,
        stdout: null,
        stderr: null,
        details: ["ENOENT"],
        diagnostics: []
      }
    });
  });

  it("returns a dedicated timeout failure with bounded runner diagnostics", async () => {
    const request = createLiveCaptureRequest(createSession(2), {
      timeoutMs: 3_000
    });
    const runnerStdout = "capturing\nwaiting for trigger\n" + "x".repeat(300);
    const runner = createDslogicLiveCaptureRunner(async () => ({
      ok: false,
      kind: "timeout",
      phase: "await-runner",
      message: "DSView capture timed out.",
      executablePath: "/usr/local/bin/dsview",
      command: ["dsview", "--capture", "logic-1"],
      timeoutMs: 3_000,
      stdout: { text: runnerStdout },
      stderr: { text: "still waiting" }
    }));

    const result = await captureDslogicLive(request, { runner });

    expect(result).toMatchObject({
      ok: false,
      reason: "capture-failed",
      kind: "timeout",
      diagnostics: {
        phase: "await-runner",
        timeoutMs: 3_000,
        stdout: {
          kind: "text",
          preview: runnerStdout.slice(0, 160),
          truncated: true
        },
        stderr: {
          kind: "text",
          preview: "still waiting",
          truncated: false
        }
      }
    });
  });

  it("returns runner-exited when the backend exits non-zero", async () => {
    const request = createLiveCaptureRequest(createSession(2));
    const runner = createDslogicLiveCaptureRunner(async () => ({
      ok: false,
      kind: "runner-exited",
      phase: "await-runner",
      message: "DSView exited with a non-zero status.",
      exitCode: 23,
      signal: null,
      stderr: { text: "device busy" }
    }));

    const result = await captureDslogicLive(request, { runner });

    expect(result).toMatchObject({
      ok: false,
      reason: "capture-failed",
      kind: "runner-exited",
      diagnostics: {
        phase: "await-runner",
        exitCode: 23,
        stderr: {
          kind: "text",
          preview: "device busy"
        }
      }
    });
  });

  it("returns malformed-output when the backend claims success but omits artifact data", async () => {
    const request = createLiveCaptureRequest(createSession(2));
    const runner = createDslogicLiveCaptureRunner(async () => ({
      ok: true,
      command: ["dsview", "--capture", "logic-1"],
      stdout: { text: "capture complete" },
      artifact: {
        sourceName: "logic-1.csv",
        formatHint: "sigrok-csv",
        text: ""
      }
    }));

    const result = await captureDslogicLive(request, { runner });

    expect(result).toEqual({
      ok: false,
      reason: "capture-failed",
      kind: "malformed-output",
      message: "Runner reported success but did not return a usable artifact payload.",
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
        backendKind: "dsview",
        executablePath: null,
        command: ["dsview", "--capture", "logic-1"],
        timeoutMs: 15000,
        exitCode: null,
        signal: null,
        stdout: {
          kind: "text",
          byteLength: 16,
          textLength: 16,
          preview: "capture complete",
          truncated: false
        },
        stderr: null,
        details: [
          "Expected artifact.text or artifact.bytes to contain non-empty capture data."
        ],
        diagnostics: []
      }
    });
  });
});
