import type { LogicAnalyzerSessionRecord } from "./contracts.js";

export const CAPTURE_CONTENT_KINDS = ["text", "bytes"] as const;
export type CaptureContentKind = (typeof CAPTURE_CONTENT_KINDS)[number];

export const CAPTURE_LOAD_FAILURE_REASONS = [
  "unsupported-adapter",
  "unreadable-input",
  "incompatible-session-capture"
] as const;
export type CaptureLoadFailureReason =
  (typeof CAPTURE_LOAD_FAILURE_REASONS)[number];

export const SESSION_CAPTURE_COMPATIBILITY_CODES = [
  "missing-session-channel",
  "missing-capture-channel",
  "sample-rate-mismatch",
  "capture-duration-exceeds-session"
] as const;
export type SessionCaptureCompatibilityCode =
  (typeof SESSION_CAPTURE_COMPATIBILITY_CODES)[number];

export interface CaptureArtifactMetadata {
  sourceName?: string;
  formatHint?: string;
  mediaType?: string;
  capturedAt?: string;
}

export interface TextCaptureArtifactInput extends CaptureArtifactMetadata {
  contentKind: "text";
  text: string;
}

export interface BinaryCaptureArtifactInput extends CaptureArtifactMetadata {
  contentKind: "bytes";
  bytes: Uint8Array;
}

export type CaptureArtifactInput =
  | TextCaptureArtifactInput
  | BinaryCaptureArtifactInput;

export interface NormalizedCaptureTransition {
  sampleIndex: number;
  timestampNs: number;
  level: 0 | 1;
}

export interface NormalizedCaptureChannel {
  channelId: string;
  label?: string;
  initialLevel: 0 | 1;
  transitions: readonly NormalizedCaptureTransition[];
}

export interface NormalizedLogicCapture {
  sampleRateHz: number;
  totalSamples: number;
  durationNs: number;
  channels: readonly NormalizedCaptureChannel[];
  metadata: CaptureArtifactMetadata & {
    adapterId: string;
  };
}

export interface CaptureSessionCompatibilityIssue {
  code: SessionCaptureCompatibilityCode;
  message: string;
  sessionChannelId?: string;
  captureChannelId?: string;
  expected?: number | string;
  actual?: number | string;
}

export interface CaptureLoadContext {
  session: LogicAnalyzerSessionRecord;
}

export interface CaptureAdapterMatch {
  confidence: "exact" | "heuristic";
  reason: string;
}

export interface CaptureAdapter {
  readonly adapterId: string;
  readonly displayName: string;
  matches(input: CaptureArtifactInput): CaptureAdapterMatch | null;
  load(
    input: CaptureArtifactInput,
    context: CaptureLoadContext
  ): Promise<CaptureAdapterLoadResult>;
}

export interface CaptureLoadSuccess {
  ok: true;
  adapterId: string;
  artifact: CaptureArtifactMetadata;
  capture: NormalizedLogicCapture;
}

export interface CaptureLoadUnsupportedAdapterFailure {
  ok: false;
  reason: "unsupported-adapter";
  artifact: CaptureArtifactMetadata;
  attemptedAdapterIds: readonly string[];
  message: string;
}

export interface CaptureLoadUnreadableInputFailure {
  ok: false;
  reason: "unreadable-input";
  adapterId: string | null;
  artifact: CaptureArtifactMetadata;
  detail: string;
  message: string;
}

export interface CaptureLoadCompatibilityFailure {
  ok: false;
  reason: "incompatible-session-capture";
  adapterId: string;
  artifact: CaptureArtifactMetadata;
  issues: readonly CaptureSessionCompatibilityIssue[];
  message: string;
}

export type CaptureLoadFailure =
  | CaptureLoadUnsupportedAdapterFailure
  | CaptureLoadUnreadableInputFailure
  | CaptureLoadCompatibilityFailure;

export type CaptureLoadResult = CaptureLoadSuccess | CaptureLoadFailure;

export type CaptureAdapterLoadResult =
  | CaptureLoadSuccess
  | CaptureLoadUnreadableInputFailure
  | CaptureLoadCompatibilityFailure;
