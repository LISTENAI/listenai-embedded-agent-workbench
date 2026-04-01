import type {
  DeviceRecord,
  LiveCaptureArtifact,
  LiveCaptureArtifactSummary,
  LiveCaptureFailure,
  LiveCaptureFailureDiagnostics,
  LiveCaptureFailureKind,
  LiveCaptureFailurePhase,
  LiveCaptureRequest,
  LiveCaptureResult,
  LiveCaptureSession,
  LiveCaptureStreamSummary,
  LiveCaptureSuccess
} from "@listenai/contracts";
import type { LiveCaptureProvider } from "../device-provider.js";
import {
  DSLOGIC_BACKEND_KIND,
  DSLOGIC_PROVIDER_KIND
} from "./backend-probe.js";
import {
  createDslogicNativeLiveCaptureBackend,
  type DslogicNativeCaptureFailure,
  type DslogicNativeCaptureStreamValue,
  type DslogicNativeLiveCaptureBackend
} from "./native-runtime.js";

const PREVIEW_LIMIT = 160;
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_CHANNEL_COUNT = 16;

export type DslogicLiveCaptureRunner = DslogicNativeLiveCaptureBackend;

export type CaptureLiveDslogicOptions =
  | { nativeCapture: DslogicNativeLiveCaptureBackend }
  | { runner: DslogicLiveCaptureRunner };

const readText = (value: DslogicNativeCaptureStreamValue | undefined): string | null => {
  if (!value) {
    return null;
  }

  if (typeof value.text === "string") {
    return value.text;
  }

  if (value.bytes instanceof Uint8Array) {
    return new TextDecoder().decode(value.bytes);
  }

  return null;
};

const getByteLength = (value: DslogicNativeCaptureStreamValue | undefined): number => {
  if (!value) {
    return 0;
  }

  if (value.bytes instanceof Uint8Array) {
    return value.bytes.byteLength;
  }

  if (typeof value.text === "string") {
    return new TextEncoder().encode(value.text).byteLength;
  }

  return 0;
};

const summarizeCaptureStream = (
  value: DslogicNativeCaptureStreamValue | undefined
): LiveCaptureStreamSummary | null => {
  if (!value) {
    return null;
  }

  const text = readText(value);
  const byteLength = getByteLength(value);
  const textLength = text === null ? null : text.length;

  if (byteLength === 0 && textLength === null) {
    return {
      kind: "empty",
      byteLength: 0,
      textLength: null,
      preview: null,
      truncated: false
    };
  }

  const preview = text === null
    ? null
    : text.slice(0, PREVIEW_LIMIT);

  return {
    kind: typeof value.text === "string" ? "text" : "bytes",
    byteLength,
    textLength,
    preview,
    truncated: text !== null && text.length > PREVIEW_LIMIT
  };
};

const hasUsableArtifactPayload = (artifact: LiveCaptureArtifact): boolean => {
  const hasText = typeof artifact.text === "string" && artifact.text.length > 0;
  const hasBytes = artifact.bytes instanceof Uint8Array && artifact.bytes.byteLength > 0;
  return hasText || hasBytes;
};

const summarizeArtifact = (
  artifact: LiveCaptureArtifact
): LiveCaptureArtifactSummary => ({
  sourceName: artifact.sourceName ?? null,
  formatHint: artifact.formatHint ?? null,
  mediaType: artifact.mediaType ?? null,
  capturedAt: artifact.capturedAt ?? null,
  byteLength: artifact.bytes?.byteLength ?? null,
  textLength: typeof artifact.text === "string" ? artifact.text.length : null,
  hasText: typeof artifact.text === "string"
});

const buildFailure = (
  request: LiveCaptureRequest,
  kind: LiveCaptureFailureKind,
  phase: LiveCaptureFailurePhase,
  message: string,
  overrides: Partial<LiveCaptureFailureDiagnostics> & {
    artifactSummary?: LiveCaptureFailure["artifactSummary"];
  } = {}
): LiveCaptureFailure => ({
  ok: false,
  reason: "capture-failed",
  kind,
  message,
  session: request.session,
  requestedAt: request.requestedAt,
  artifactSummary: overrides.artifactSummary ?? null,
  diagnostics: {
    phase,
    providerKind: request.session.device.providerKind ?? null,
    backendKind: request.session.device.backendKind ?? null,
    backendVersion: overrides.backendVersion ?? null,
    timeoutMs: overrides.timeoutMs ?? request.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    nativeCode: overrides.nativeCode ?? null,
    captureOutput: overrides.captureOutput ?? null,
    diagnosticOutput: overrides.diagnosticOutput ?? null,
    details: overrides.details ?? [],
    diagnostics: overrides.diagnostics ?? request.session.device.diagnostics ?? []
  }
});

const validateSession = (
  request: LiveCaptureRequest
): LiveCaptureFailure | null => {
  const { session } = request;
  const details: string[] = [];

  if (session.device.deviceId !== session.deviceId) {
    details.push("session.device.deviceId must match session.deviceId.");
  }

  if (session.device.providerKind !== DSLOGIC_PROVIDER_KIND) {
    details.push(`Expected providerKind ${DSLOGIC_PROVIDER_KIND}.`);
  }

  if (session.device.backendKind !== DSLOGIC_BACKEND_KIND) {
    details.push(`Expected backendKind ${DSLOGIC_BACKEND_KIND}.`);
  }

  if (!session.device.dslogic || session.device.dslogic.family !== "dslogic") {
    details.push("Accepted live capture sessions must include DSLogic identity details.");
  } else if (session.device.dslogic.model !== "dslogic-plus") {
    details.push(`Unsupported DSLogic model ${session.device.dslogic.model}.`);
  }

  if (session.sampling.channels.length === 0) {
    details.push("Accepted live capture sessions must select at least one channel.");
  }

  if (session.sampling.channels.length > MAX_CHANNEL_COUNT) {
    details.push(`DSLogic Plus supports at most ${MAX_CHANNEL_COUNT} channels.`);
  }

  if (details.length === 0) {
    return null;
  }

  return buildFailure(
    request,
    "unsupported-runtime",
    "validate-session",
    "Live capture request is not compatible with the DSLogic native runtime seam.",
    {
      details
    }
  );
};

const toSuccess = (
  request: LiveCaptureRequest,
  artifact: LiveCaptureArtifact
): LiveCaptureSuccess => ({
  ok: true,
  providerKind: DSLOGIC_PROVIDER_KIND,
  backendKind: DSLOGIC_BACKEND_KIND,
  session: request.session,
  requestedAt: request.requestedAt,
  artifact,
  artifactSummary: summarizeArtifact(artifact)
});

const toFailureFromNative = (
  request: LiveCaptureRequest,
  failure: DslogicNativeCaptureFailure
): LiveCaptureFailure =>
  buildFailure(request, failure.kind, failure.phase, failure.message, {
    backendVersion: failure.backendVersion ?? null,
    timeoutMs: failure.timeoutMs ?? request.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    nativeCode: failure.nativeCode ?? null,
    captureOutput: summarizeCaptureStream(failure.captureOutput),
    diagnosticOutput: summarizeCaptureStream(failure.diagnosticOutput),
    details: failure.details ?? []
  });

const resolveNativeCapture = (
  options: CaptureLiveDslogicOptions
): DslogicNativeLiveCaptureBackend =>
  "nativeCapture" in options ? options.nativeCapture : options.runner;

export const captureDslogicLive = async (
  request: LiveCaptureRequest,
  options: CaptureLiveDslogicOptions
): Promise<LiveCaptureResult> => {
  const validationFailure = validateSession(request);
  if (validationFailure) {
    return validationFailure;
  }

  const nativeCapture = resolveNativeCapture(options);
  const nativeResult = await nativeCapture.capture(request);
  if (!nativeResult.ok) {
    return toFailureFromNative(request, nativeResult);
  }

  if (!hasUsableArtifactPayload(nativeResult.artifact)) {
    return buildFailure(
      request,
      "malformed-output",
      "collect-artifact",
      "Native capture reported success but did not return a usable artifact payload.",
      {
        backendVersion: nativeResult.backendVersion ?? null,
        diagnosticOutput: summarizeCaptureStream(nativeResult.diagnosticOutput),
        artifactSummary: summarizeArtifact(nativeResult.artifact),
        details: [
          "Expected artifact.text or artifact.bytes to contain non-empty capture data."
        ]
      }
    );
  }

  return toSuccess(request, nativeResult.artifact);
};

export const supportsDslogicLiveCapture = (
  device: Pick<DeviceRecord, "providerKind" | "backendKind">
): boolean =>
  device.providerKind === DSLOGIC_PROVIDER_KIND &&
  device.backendKind === DSLOGIC_BACKEND_KIND;

export const createDslogicLiveCaptureProvider = (
  nativeCapture: DslogicNativeLiveCaptureBackend
): LiveCaptureProvider => ({
  supportsDevice: supportsDslogicLiveCapture,
  liveCapture: (request) => captureDslogicLive(request, { nativeCapture })
});

export const createDslogicLiveCaptureRunner = (
  capture: DslogicNativeLiveCaptureBackend["capture"]
): DslogicLiveCaptureRunner => createDslogicNativeLiveCaptureBackend(capture);

export const createDslogicNativeLiveCapture = (
  capture: DslogicNativeLiveCaptureBackend["capture"]
): DslogicNativeLiveCaptureBackend => createDslogicNativeLiveCaptureBackend(capture);

export const createLiveCaptureRequest = (
  session: LiveCaptureSession,
  overrides: Partial<Omit<LiveCaptureRequest, "session">> = {}
): LiveCaptureRequest => ({
  session,
  requestedAt: overrides.requestedAt ?? session.startedAt,
  timeoutMs: overrides.timeoutMs
});
