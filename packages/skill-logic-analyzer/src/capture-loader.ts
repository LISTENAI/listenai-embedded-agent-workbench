import type {
  CaptureCompatibilityIssue,
  CaptureArtifactInput,
  LoadCaptureRequest,
  LoadCaptureResult,
  LogicCapture,
  LogicCaptureAdapter
} from "./capture-contracts.js";
import { summarizeCaptureArtifact } from "./capture-contracts.js";
import { sigrokCsvAdapter } from "./adapters/sigrok-csv-adapter.js";

export interface CaptureLoaderOptions {
  adapters?: readonly LogicCaptureAdapter[];
}

interface SelectedAdapter {
  adapter: LogicCaptureAdapter;
  selectedBy: "format-hint" | "probe";
}

const DEFAULT_ADAPTERS = [sigrokCsvAdapter] as const;
const SAMPLE_RATE_TOLERANCE_RATIO = 0.01;

const normalizeHint = (value: string): string => value.trim().toLowerCase();

const selectAdapter = (
  adapters: readonly LogicCaptureAdapter[],
  artifact: CaptureArtifactInput
): SelectedAdapter | null => {
  if (typeof artifact.formatHint === "string" && artifact.formatHint.trim().length > 0) {
    const normalizedHint = normalizeHint(artifact.formatHint);
    const hintedAdapter = adapters.find(
      (adapter) =>
        adapter.id === normalizedHint ||
        adapter.formatHints.some((hint) => normalizeHint(hint) === normalizedHint)
    );

    return hintedAdapter
      ? {
          adapter: hintedAdapter,
          selectedBy: "format-hint"
        }
      : null;
  }

  const probedAdapter = adapters.find((adapter) => adapter.canLoad(artifact));
  return probedAdapter
    ? {
        adapter: probedAdapter,
        selectedBy: "probe"
      }
    : null;
};

const buildCompatibilityIssues = (
  session: LoadCaptureRequest["session"],
  capture: LogicCapture
): CaptureCompatibilityIssue[] => {
  const issues: CaptureCompatibilityIssue[] = [];
  const captureChannelIds = new Set(capture.channels.map((channel) => channel.channelId));
  const requiredChannels = new Set([
    ...session.sampling.channels.map((channel) => channel.channelId),
    ...session.analysis.focusChannelIds
  ]);

  for (const channelId of requiredChannels) {
    if (captureChannelIds.has(channelId)) {
      continue;
    }

    issues.push({
      code: "missing-channel",
      channelId,
      expected: "present",
      actual: "missing",
      message: `Capture is missing requested channel ${channelId}.`
    });
  }

  const expectedSampleRateHz = session.sampling.sampleRateHz;
  const sampleRateDelta = Math.abs(capture.sampleRateHz - expectedSampleRateHz);
  if (sampleRateDelta > expectedSampleRateHz * SAMPLE_RATE_TOLERANCE_RATIO) {
    issues.push({
      code: "sample-rate-mismatch",
      expected: expectedSampleRateHz,
      actual: capture.sampleRateHz,
      message: `Capture sample rate ${capture.sampleRateHz}Hz does not match requested ${expectedSampleRateHz}Hz.`
    });
  }

  const actualDurationMs = (capture.durationNs / 1_000_000_000) * 1000;
  const expectedDurationMs = session.sampling.captureDurationMs;
  const durationToleranceMs = Math.max((capture.samplePeriodNs / 1_000_000_000) * 1000, 0.001);
  if (Math.abs(actualDurationMs - expectedDurationMs) > durationToleranceMs) {
    issues.push({
      code: "duration-mismatch",
      expected: expectedDurationMs,
      actual: actualDurationMs,
      message: `Capture duration ${actualDurationMs}ms does not match requested ${expectedDurationMs}ms.`
    });
  }

  return issues;
};

export const createCaptureLoader = (
  options: CaptureLoaderOptions = {}
): ((request: LoadCaptureRequest) => LoadCaptureResult) => {
  const adapters = options.adapters ?? DEFAULT_ADAPTERS;

  return ({ session, artifact }: LoadCaptureRequest): LoadCaptureResult => {
    const selection = selectAdapter(adapters, artifact);
    if (!selection) {
      return {
        ok: false,
        reason: "unsupported-adapter",
        adapterIds: adapters.map((adapter) => adapter.id),
        artifact: summarizeCaptureArtifact(artifact),
        message:
          typeof artifact.formatHint === "string" && artifact.formatHint.trim().length > 0
            ? `No capture adapter matches format hint ${artifact.formatHint}.`
            : "No capture adapter recognized the supplied artifact."
      };
    }

    const parsed = selection.adapter.load(artifact);
    if (!parsed.ok) {
      return {
        ok: false,
        reason: "unreadable-input",
        adapterId: parsed.adapterId,
        selectedBy: selection.selectedBy,
        artifact: parsed.artifact,
        message: parsed.message,
        details: parsed.details
      };
    }

    const issues = buildCompatibilityIssues(session, parsed.capture);
    if (issues.length > 0) {
      return {
        ok: false,
        reason: "incompatible-session",
        adapterId: selection.adapter.id,
        selectedBy: selection.selectedBy,
        artifact: parsed.capture.artifact,
        capture: parsed.capture,
        issues
      };
    }

    return {
      ok: true,
      adapterId: selection.adapter.id,
      selectedBy: selection.selectedBy,
      capture: parsed.capture
    };
  };
};

export const loadLogicCapture = (
  request: LoadCaptureRequest,
  options?: CaptureLoaderOptions
): LoadCaptureResult => createCaptureLoader(options)(request);

export const DEFAULT_CAPTURE_ADAPTERS: readonly LogicCaptureAdapter[] = DEFAULT_ADAPTERS;
