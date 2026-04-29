import {
  DSLOGIC_BACKEND_KIND,
  DSLOGIC_PROVIDER_KIND,
  type AllocationRequest,
  type AllocationResult,
  type DeviceRecord,
  type InventoryBackendKind,
  type InventoryDiagnostic,
  type InventoryProviderKind,
  type InventorySnapshot,
  type ReleaseRequest,
  type ReleaseResult
} from "./contracts.js";

export const LIVE_CAPTURE_FAILURE_PHASES = [
  "validate-session",
  "prepare-runtime",
  "capture",
  "collect-artifact"
] as const;
export type LiveCaptureFailurePhase =
  (typeof LIVE_CAPTURE_FAILURE_PHASES)[number];

export const LIVE_CAPTURE_FAILURE_KINDS = [
  "unsupported-runtime",
  "runtime-unavailable",
  "capture-failed",
  "timeout",
  "aborted",
  "malformed-output"
] as const;
export type LiveCaptureFailureKind =
  (typeof LIVE_CAPTURE_FAILURE_KINDS)[number];

export interface LiveCaptureChannelSelection {
  channelId: string;
  label?: string;
}

export interface LiveCaptureSamplingConfig {
  sampleRateHz: number;
  captureDurationMs: number;
  channels: readonly LiveCaptureChannelSelection[];
}

export interface LiveCaptureSession {
  sessionId: string;
  deviceId: string;
  ownerSkillId: string;
  startedAt: string;
  device: DeviceRecord;
  sampling: LiveCaptureSamplingConfig;
}

export interface LiveCaptureArtifactSampling {
  sampleRateHz?: number;
  totalSamples?: number;
  requestedSampleLimit?: number;
}

export interface LiveCaptureArtifact {
  sourceName?: string;
  formatHint?: string;
  mediaType?: string;
  capturedAt?: string;
  sampling?: LiveCaptureArtifactSampling;
  text?: string;
  bytes?: Uint8Array;
}

export interface LiveCaptureArtifactSummary {
  sourceName: string | null;
  formatHint: string | null;
  mediaType: string | null;
  capturedAt: string | null;
  byteLength: number | null;
  textLength: number | null;
  hasText: boolean;
}

export interface LiveCaptureStreamSummary {
  kind: "empty" | "text" | "bytes";
  byteLength: number;
  textLength: number | null;
  preview: string | null;
  truncated: boolean;
}

export interface DslogicBackendIdentity {
  providerKind: typeof DSLOGIC_PROVIDER_KIND;
  backendKind: typeof DSLOGIC_BACKEND_KIND;
}

export const DEVICE_OPTIONS_FAILURE_PHASES = [
  "validate-session",
  "prepare-runtime",
  "list-handles",
  "inspect-options",
  "parse-options"
] as const;
export type DeviceOptionsFailurePhase =
  (typeof DEVICE_OPTIONS_FAILURE_PHASES)[number];

export const DEVICE_OPTIONS_FAILURE_KINDS = [
  "device-not-found",
  "device-not-allocated",
  "owner-mismatch",
  "unsupported-runtime",
  "runtime-unavailable",
  "native-error",
  "timeout",
  "malformed-output"
] as const;
export type DeviceOptionsFailureKind =
  (typeof DEVICE_OPTIONS_FAILURE_KINDS)[number];

export interface DeviceOptionTokenCapability {
  token: string;
  label?: string;
  description?: string;
}

export interface DeviceOptionsCapabilities {
  operations: readonly DeviceOptionTokenCapability[];
  channels: readonly DeviceOptionTokenCapability[];
  stopConditions: readonly DeviceOptionTokenCapability[];
  filters: readonly DeviceOptionTokenCapability[];
  thresholds: readonly DeviceOptionTokenCapability[];
}

export interface DeviceOptionsStreamSummary {
  kind: "empty" | "text" | "bytes";
  byteLength: number;
  textLength: number | null;
  preview: string | null;
  truncated: boolean;
}

export interface DeviceOptionsFailureDiagnostics {
  phase: DeviceOptionsFailurePhase;
  providerKind: InventoryProviderKind | null;
  backendKind: InventoryBackendKind | null;
  backendVersion: string | null;
  timeoutMs: number | null;
  nativeCode: string | null;
  optionsOutput: DeviceOptionsStreamSummary | null;
  diagnosticOutput: DeviceOptionsStreamSummary | null;
  details: readonly string[];
  diagnostics: readonly InventoryDiagnostic[];
}

export interface DeviceOptionsRequest {
  session: LiveCaptureSession;
  requestedAt: string;
  timeoutMs?: number;
}

export interface DeviceOptionsSuccess {
  ok: true;
  providerKind: InventoryProviderKind;
  backendKind: InventoryBackendKind;
  session: LiveCaptureSession;
  requestedAt: string;
  capabilities: DeviceOptionsCapabilities;
}

export interface DeviceOptionsFailure {
  ok: false;
  reason: "device-options-failed";
  kind: DeviceOptionsFailureKind;
  message: string;
  session: LiveCaptureSession;
  requestedAt: string;
  capabilities: null;
  diagnostics: DeviceOptionsFailureDiagnostics;
}

export type DeviceOptionsResult = DeviceOptionsSuccess | DeviceOptionsFailure;

export interface LiveCaptureTuning {
  operation?: string;
  channel?: string;
  stop?: string;
  filter?: string;
  threshold?: string;
}

export type DecoderOptionValue = string | number | boolean;

export const DECODER_CAPABILITY_FAILURE_PHASES = [
  "validate-device",
  "prepare-runtime",
  "list-decoders",
  "inspect-decoder",
  "parse-decoders"
] as const;
export type DecoderCapabilityFailurePhase =
  (typeof DECODER_CAPABILITY_FAILURE_PHASES)[number];

export const DECODER_CAPABILITY_FAILURE_KINDS = [
  "device-not-found",
  "unsupported-runtime",
  "runtime-unavailable",
  "native-error",
  "timeout",
  "malformed-output"
] as const;
export type DecoderCapabilityFailureKind =
  (typeof DECODER_CAPABILITY_FAILURE_KINDS)[number];

export const CAPTURE_DECODE_FAILURE_PHASES = [
  "validate-session",
  "prepare-runtime",
  "capture",
  "decode-validation",
  "decode-run",
  "collect-artifact"
] as const;
export type CaptureDecodeFailurePhase =
  (typeof CAPTURE_DECODE_FAILURE_PHASES)[number];

export const CAPTURE_DECODE_FAILURE_KINDS = [
  "device-not-found",
  "device-not-allocated",
  "owner-mismatch",
  "unsupported-runtime",
  "runtime-unavailable",
  "capture-failed",
  "decode-failed",
  "timeout",
  "malformed-output"
] as const;
export type CaptureDecodeFailureKind =
  (typeof CAPTURE_DECODE_FAILURE_KINDS)[number];

export interface DecoderChannelRoleCapability {
  id: string;
  label?: string;
  description?: string;
}

export interface DecoderOptionCapability {
  id: string;
  label?: string;
  description?: string;
  valueType?: "string" | "number" | "boolean";
  required?: boolean;
  values: readonly DecoderOptionValue[];
}

export interface DecoderCapability {
  decoderId: string;
  label?: string;
  description?: string;
  requiredChannels: readonly DecoderChannelRoleCapability[];
  optionalChannels: readonly DecoderChannelRoleCapability[];
  options: readonly DecoderOptionCapability[];
}

export interface DecoderRuntimeStreamSummary {
  kind: "empty" | "text" | "bytes";
  byteLength: number;
  textLength: number | null;
  preview: string | null;
  truncated: boolean;
}

export interface DecoderCapabilityFailureDiagnostics {
  phase: DecoderCapabilityFailurePhase;
  providerKind: InventoryProviderKind | null;
  backendKind: InventoryBackendKind | null;
  backendVersion: string | null;
  timeoutMs: number | null;
  nativeCode: string | null;
  decoderOutput: DecoderRuntimeStreamSummary | null;
  diagnosticOutput: DecoderRuntimeStreamSummary | null;
  details: readonly string[];
  diagnostics: readonly InventoryDiagnostic[];
}

export interface DecoderCapabilitiesRequest {
  deviceId: string;
  requestedAt: string;
  timeoutMs?: number;
}

export interface DecoderCapabilitiesSuccess {
  ok: true;
  providerKind: InventoryProviderKind;
  backendKind: InventoryBackendKind;
  backendVersion: string | null;
  deviceId: string;
  requestedAt: string;
  decoders: readonly DecoderCapability[];
}

export interface DecoderCapabilitiesFailure {
  ok: false;
  reason: "decoder-capabilities-failed";
  kind: DecoderCapabilityFailureKind;
  message: string;
  deviceId: string;
  requestedAt: string;
  decoders: null;
  diagnostics: DecoderCapabilityFailureDiagnostics;
}

export type DecoderCapabilitiesResult =
  | DecoderCapabilitiesSuccess
  | DecoderCapabilitiesFailure;

export interface CaptureDecodeConfig {
  decoderId: string;
  channelMappings: Readonly<Record<string, string>>;
  decoderOptions?: Readonly<Record<string, DecoderOptionValue>>;
}

export interface CaptureDecodeRequest {
  session: LiveCaptureSession;
  requestedAt: string;
  timeoutMs?: number;
  captureTuning?: LiveCaptureTuning;
  decode: CaptureDecodeConfig;
}

export interface CaptureDecodeRawReport extends Record<string, unknown> {
  text: string;
  bytes: readonly number[];
}

export interface CaptureDecodeReport {
  decoderId: string;
  annotations: readonly Record<string, unknown>[];
  rows: readonly Record<string, unknown>[];
  raw: CaptureDecodeRawReport;
}

export interface CaptureDecodeFailureDiagnostics {
  phase: CaptureDecodeFailurePhase;
  providerKind: InventoryProviderKind | null;
  backendKind: InventoryBackendKind | null;
  backendVersion: string | null;
  timeoutMs: number | null;
  nativeCode: string | null;
  captureOutput: LiveCaptureStreamSummary | null;
  decoderOutput: DecoderRuntimeStreamSummary | null;
  diagnosticOutput: DecoderRuntimeStreamSummary | null;
  details: readonly string[];
  diagnostics: readonly InventoryDiagnostic[];
}

export interface CaptureDecodeSuccess {
  ok: true;
  providerKind: InventoryProviderKind;
  backendKind: InventoryBackendKind;
  session: LiveCaptureSession;
  requestedAt: string;
  artifactSummary: LiveCaptureArtifactSummary;
  auxiliaryArtifactSummaries?: readonly LiveCaptureArtifactSummary[];
  decode: CaptureDecodeReport;
}

export interface CaptureDecodeFailure {
  ok: false;
  reason: "capture-decode-failed";
  kind: CaptureDecodeFailureKind;
  message: string;
  session: LiveCaptureSession;
  requestedAt: string;
  artifactSummary: LiveCaptureArtifactSummary | null;
  decode: CaptureDecodeReport | null;
  diagnostics: CaptureDecodeFailureDiagnostics;
}

export type CaptureDecodeResult = CaptureDecodeSuccess | CaptureDecodeFailure;

export interface LiveCaptureFailureDiagnostics {
  phase: LiveCaptureFailurePhase;
  providerKind: InventoryProviderKind | null;
  backendKind: InventoryBackendKind | null;
  backendVersion: string | null;
  timeoutMs: number | null;
  nativeCode: string | null;
  captureOutput: LiveCaptureStreamSummary | null;
  diagnosticOutput: LiveCaptureStreamSummary | null;
  details: readonly string[];
  diagnostics: readonly InventoryDiagnostic[];
}

export interface LiveCaptureRequest {
  session: LiveCaptureSession;
  requestedAt: string;
  timeoutMs?: number;
  captureTuning?: LiveCaptureTuning;
}

export interface LiveCaptureSuccess {
  ok: true;
  providerKind: InventoryProviderKind;
  backendKind: InventoryBackendKind;
  session: LiveCaptureSession;
  requestedAt: string;
  artifact: LiveCaptureArtifact;
  artifactSummary: LiveCaptureArtifactSummary;
  auxiliaryArtifacts?: readonly LiveCaptureArtifact[];
  auxiliaryArtifactSummaries?: readonly LiveCaptureArtifactSummary[];
}

export interface LiveCaptureFailure {
  ok: false;
  reason: "capture-failed";
  kind: LiveCaptureFailureKind;
  message: string;
  session: LiveCaptureSession;
  requestedAt: string;
  artifactSummary: LiveCaptureArtifactSummary | null;
  diagnostics: LiveCaptureFailureDiagnostics;
}

export type LiveCaptureResult = LiveCaptureSuccess | LiveCaptureFailure;

export interface ResourceManager {
  refreshInventory(): Promise<readonly DeviceRecord[]>;
  listDevices(): Promise<readonly DeviceRecord[]>;
  allocateDevice(request: AllocationRequest): Promise<AllocationResult>;
  releaseDevice(request: ReleaseRequest): Promise<ReleaseResult>;
  inspectDeviceOptions(request: DeviceOptionsRequest): Promise<DeviceOptionsResult>;
  listDecoderCapabilities(
    request: DecoderCapabilitiesRequest
  ): Promise<DecoderCapabilitiesResult>;
  captureDecode(request: CaptureDecodeRequest): Promise<CaptureDecodeResult>;
  liveCapture(request: LiveCaptureRequest): Promise<LiveCaptureResult>;
}

export interface InventorySnapshotReporter {
  refreshInventorySnapshot(): Promise<InventorySnapshot>;
  getInventorySnapshot(): Promise<InventorySnapshot>;
}

export type SnapshotResourceManager = ResourceManager & InventorySnapshotReporter;

export const summarizeLiveCaptureArtifact = (
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

export const summarizeLiveCaptureArtifacts = (
  artifacts: readonly LiveCaptureArtifact[]
): readonly LiveCaptureArtifactSummary[] => artifacts.map((artifact) => summarizeLiveCaptureArtifact(artifact));
