import type {
  AnalysisEdgePolicy,
  AnalysisTimeReference
} from "./contracts.js";
import type { LogicLevel } from "./capture-contracts.js";

export const WAVEFORM_EDGE_KINDS = ["rising", "falling"] as const;
export type WaveformEdgeKind = (typeof WAVEFORM_EDGE_KINDS)[number];

export const WAVEFORM_PULSE_POLARITIES = ["high", "low"] as const;
export type WaveformPulsePolarity = (typeof WAVEFORM_PULSE_POLARITIES)[number];

export const WAVEFORM_ANOMALY_SEVERITIES = ["info", "warning", "error"] as const;
export type WaveformAnomalySeverity =
  (typeof WAVEFORM_ANOMALY_SEVERITIES)[number];

export const WAVEFORM_ANALYSIS_ANOMALY_CODES = [
  "no-qualifying-edges",
  "insufficient-transitions",
  "inconsistent-pulse-widths",
  "irregular-rhythm",
  "window-truncated-activity"
] as const;
export type WaveformAnalysisAnomalyCode =
  (typeof WAVEFORM_ANALYSIS_ANOMALY_CODES)[number];

export const WAVEFORM_ANALYSIS_NOTE_CODES = [
  "focus-channels-applied",
  "analysis-window-applied",
  "edge-policy-filtered",
  "pulse-widths-disabled",
  "insufficient-transition-data",
  "time-reference-shifted",
  "baseline-only-no-protocol-decoding"
] as const;
export type WaveformAnalysisNoteCode =
  (typeof WAVEFORM_ANALYSIS_NOTE_CODES)[number];

export const EDGE_KINDS_BY_POLICY = {
  all: ["rising", "falling"],
  rising: ["rising"],
  falling: ["falling"]
} as const satisfies Record<AnalysisEdgePolicy, readonly WaveformEdgeKind[]>;

export const getObservedEdgeKinds = (
  edgePolicy: AnalysisEdgePolicy
): readonly WaveformEdgeKind[] => EDGE_KINDS_BY_POLICY[edgePolicy];

export interface WaveformAnalysisWindowSummary {
  startSampleIndex: number;
  endSampleIndex: number;
  sampleCount: number;
  durationNs: number;
  clippedToCapture: boolean;
}

export interface WaveformTimingSummary {
  sampleRateHz: number;
  samplePeriodNs: number;
  totalSamples: number;
  captureDurationNs: number;
  timeReference: AnalysisTimeReference;
  referenceOffsetNs: number;
  analyzedWindow: WaveformAnalysisWindowSummary;
}

export interface WaveformPulseWidthObservation {
  polarity: WaveformPulsePolarity;
  count: number;
  minWidthNs: number;
  maxWidthNs: number;
  averageWidthNs: number;
}

export interface WaveformRhythmObservation {
  edgeKind: WaveformEdgeKind;
  intervalCount: number;
  minIntervalNs: number;
  maxIntervalNs: number;
  averageIntervalNs: number;
  approximateFrequencyHz: number | null;
  isSteady: boolean;
}

export interface WaveformAnalysisSignal {
  code: WaveformAnalysisAnomalyCode | WaveformAnalysisNoteCode;
  message: string;
  channelId?: string;
  details?: Readonly<Record<string, number | string | boolean | null>>;
}

export interface WaveformAnomaly extends WaveformAnalysisSignal {
  code: WaveformAnalysisAnomalyCode;
  severity: WaveformAnomalySeverity;
}

export interface WaveformCapabilityNote extends WaveformAnalysisSignal {
  code: WaveformAnalysisNoteCode;
}

export interface WaveformChannelObservation {
  channelId: string;
  label?: string;
  initialLevel: LogicLevel;
  finalLevel: LogicLevel;
  qualifyingEdgePolicy: AnalysisEdgePolicy;
  observedEdgeKinds: readonly WaveformEdgeKind[];
  totalTransitionCount: number;
  qualifyingTransitionCount: number;
  firstQualifyingTransitionTimeNs: number | null;
  lastQualifyingTransitionTimeNs: number | null;
  pulseWidths: readonly WaveformPulseWidthObservation[];
  rhythm: WaveformRhythmObservation | null;
  anomalies: readonly WaveformAnomaly[];
  notes: readonly WaveformCapabilityNote[];
  summaryText: string;
}

export interface WaveformAnalysisResult {
  captureSource: {
    adapterId: string;
    sourceName: string | null;
    capturedAt: string | null;
  };
  timing: WaveformTimingSummary;
  analyzedChannelIds: readonly string[];
  channels: readonly WaveformChannelObservation[];
  anomalies: readonly WaveformAnomaly[];
  capabilityNotes: readonly WaveformCapabilityNote[];
  summaryText: string;
}
