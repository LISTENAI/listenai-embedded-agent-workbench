import type { LogicAnalyzerSessionRecord } from "./contracts.js";

export const CAPTURE_LOAD_FAILURE_REASONS = [
  "unsupported-adapter",
  "unreadable-input",
  "incompatible-session"
] as const;
export type CaptureLoadFailureReason =
  (typeof CAPTURE_LOAD_FAILURE_REASONS)[number];

export const CAPTURE_COMPATIBILITY_ISSUE_CODES = [
  "missing-channel",
  "sample-rate-mismatch",
  "duration-mismatch"
] as const;
export type CaptureCompatibilityIssueCode =
  (typeof CAPTURE_COMPATIBILITY_ISSUE_CODES)[number];

export type LogicLevel = 0 | 1;

export interface CaptureArtifactInput {
  sourceName?: string;
  formatHint?: string;
  mediaType?: string;
  capturedAt?: string;
  text?: string;
  bytes?: Uint8Array;
}

export interface CaptureArtifactSummary {
  sourceName: string | null;
  formatHint: string | null;
  mediaType: string | null;
  capturedAt: string | null;
  byteLength: number | null;
  hasText: boolean;
}

export interface LogicCaptureTransition {
  sampleIndex: number;
  timeNs: number;
  fromLevel: LogicLevel;
  toLevel: LogicLevel;
}

export interface LogicCaptureChannel {
  channelId: string;
  label?: string;
  initialLevel: LogicLevel;
  transitions: readonly LogicCaptureTransition[];
}

export interface LogicCapture {
  adapterId: string;
  sourceName: string | null;
  capturedAt: string | null;
  sampleRateHz: number;
  samplePeriodNs: number;
  totalSamples: number;
  durationNs: number;
  channels: readonly LogicCaptureChannel[];
  artifact: CaptureArtifactSummary;
}

export interface CaptureCompatibilityIssue {
  code: CaptureCompatibilityIssueCode;
  message: string;
  channelId?: string;
  expected?: number | string;
  actual?: number | string;
}

export interface LoadCaptureSuccess {
  ok: true;
  adapterId: string;
  selectedBy: "format-hint" | "probe";
  capture: LogicCapture;
}

export interface UnsupportedCaptureAdapterFailure {
  ok: false;
  reason: "unsupported-adapter";
  adapterIds: readonly string[];
  artifact: CaptureArtifactSummary;
  message: string;
}

export interface UnreadableCaptureInputFailure {
  ok: false;
  reason: "unreadable-input";
  adapterId: string;
  selectedBy: "format-hint" | "probe";
  artifact: CaptureArtifactSummary;
  message: string;
  details: readonly string[];
}

export interface IncompatibleSessionCaptureFailure {
  ok: false;
  reason: "incompatible-session";
  adapterId: string;
  selectedBy: "format-hint" | "probe";
  artifact: CaptureArtifactSummary;
  capture: LogicCapture;
  issues: readonly CaptureCompatibilityIssue[];
}

export type LoadCaptureResult =
  | LoadCaptureSuccess
  | UnsupportedCaptureAdapterFailure
  | UnreadableCaptureInputFailure
  | IncompatibleSessionCaptureFailure;

export interface CaptureAdapterParseSuccess {
  ok: true;
  capture: LogicCapture;
}

export interface CaptureAdapterParseFailure {
  ok: false;
  reason: "unreadable-input";
  adapterId: string;
  artifact: CaptureArtifactSummary;
  message: string;
  details: readonly string[];
}

export type CaptureAdapterLoadResult =
  | CaptureAdapterParseSuccess
  | CaptureAdapterParseFailure;

export interface LogicCaptureAdapter {
  id: string;
  formatHints: readonly string[];
  canLoad(input: CaptureArtifactInput): boolean;
  load(input: CaptureArtifactInput): CaptureAdapterLoadResult;
}

export interface LoadCaptureRequest {
  session: LogicAnalyzerSessionRecord;
  artifact: CaptureArtifactInput;
}

export const summarizeCaptureArtifact = (
  artifact: CaptureArtifactInput
): CaptureArtifactSummary => ({
  sourceName: artifact.sourceName ?? null,
  formatHint: artifact.formatHint ?? null,
  mediaType: artifact.mediaType ?? null,
  capturedAt: artifact.capturedAt ?? null,
  byteLength: artifact.bytes?.byteLength ?? null,
  hasText: typeof artifact.text === "string"
});

export const readArtifactText = (
  artifact: CaptureArtifactInput
): string | null => {
  if (typeof artifact.text === "string") {
    return artifact.text;
  }

  if (artifact.bytes instanceof Uint8Array) {
    return new TextDecoder().decode(artifact.bytes);
  }

  return null;
};
