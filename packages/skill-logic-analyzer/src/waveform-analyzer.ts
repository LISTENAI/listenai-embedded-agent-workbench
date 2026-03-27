import type {
  WaveformAnalysisResult,
  WaveformAnomaly,
  WaveformCapabilityNote,
  WaveformChannelObservation,
  WaveformEdgeKind,
  WaveformPulseWidthObservation,
  WaveformRhythmObservation
} from "./analysis-contracts.js";
import { getObservedEdgeKinds } from "./analysis-contracts.js";
import type {
  LogicCapture,
  LogicCaptureChannel,
  LogicCaptureTransition,
  LogicLevel
} from "./capture-contracts.js";
import type {
  AnalysisEdgePolicy,
  LogicAnalyzerAnalysisConfig
} from "./contracts.js";

interface ResolvedWindow {
  startSampleIndex: number;
  endSampleIndex: number;
  sampleCount: number;
  durationNs: number;
  clippedToCapture: boolean;
  requested: boolean;
  isFullCapture: boolean;
}

interface ChannelSegment {
  level: LogicLevel;
  startTimeNs: number;
  endTimeNs: number;
}

const RHYTHM_STEADY_SPREAD_RATIO = 0.05;
const PULSE_WIDTH_STEADY_SPREAD_RATIO = 0.1;

const getEdgeKind = (
  transition: Pick<LogicCaptureTransition, "fromLevel" | "toLevel">
): WaveformEdgeKind => (transition.fromLevel === 0 && transition.toLevel === 1 ? "rising" : "falling");

const isQualifyingEdge = (
  edgePolicy: AnalysisEdgePolicy,
  edgeKind: WaveformEdgeKind
): boolean => edgePolicy === "all" || edgePolicy === edgeKind;

const resolveWindow = (
  capture: LogicCapture,
  analysis: LogicAnalyzerAnalysisConfig
): ResolvedWindow => {
  const totalSamples = Math.max(capture.totalSamples, 0);
  const maxSampleIndex = Math.max(totalSamples - 1, 0);
  const requestedStart = analysis.window?.startSampleIndex ?? 0;
  const requestedEnd = analysis.window?.endSampleIndex ?? maxSampleIndex;
  const startSampleIndex = Math.min(Math.max(requestedStart, 0), maxSampleIndex);
  const endSampleIndex = Math.min(Math.max(requestedEnd, startSampleIndex), maxSampleIndex);
  const sampleCount = totalSamples === 0 ? 0 : endSampleIndex - startSampleIndex + 1;
  const durationNs = sampleCount * capture.samplePeriodNs;
  const clippedToCapture =
    totalSamples === 0
      ? false
      : requestedStart !== startSampleIndex || requestedEnd !== endSampleIndex;
  const requested = analysis.window !== undefined;
  const isFullCapture = totalSamples === 0 || (startSampleIndex === 0 && endSampleIndex === maxSampleIndex);

  return {
    startSampleIndex,
    endSampleIndex,
    sampleCount,
    durationNs,
    clippedToCapture,
    requested,
    isFullCapture
  };
};

const getLevelAtSample = (
  channel: LogicCaptureChannel,
  sampleIndex: number
): LogicLevel => {
  let level = channel.initialLevel;

  for (const transition of channel.transitions) {
    if (transition.sampleIndex > sampleIndex) {
      break;
    }

    level = transition.toLevel;
  }

  return level;
};

const getTransitionsInWindow = (
  channel: LogicCaptureChannel,
  window: ResolvedWindow
): LogicCaptureTransition[] =>
  channel.transitions.filter(
    (transition) =>
      transition.sampleIndex >= window.startSampleIndex &&
      transition.sampleIndex <= window.endSampleIndex
  );

const buildSegments = (
  channel: LogicCaptureChannel,
  transitionsInWindow: readonly LogicCaptureTransition[],
  window: ResolvedWindow,
  samplePeriodNs: number
): ChannelSegment[] => {
  if (window.sampleCount === 0) {
    return [];
  }

  const segments: ChannelSegment[] = [];
  const windowStartTimeNs = window.startSampleIndex * samplePeriodNs;
  const windowEndTimeNs = (window.endSampleIndex + 1) * samplePeriodNs;
  let currentLevel = getLevelAtSample(channel, window.startSampleIndex);
  let currentStartTimeNs = windowStartTimeNs;

  for (const transition of transitionsInWindow) {
    segments.push({
      level: currentLevel,
      startTimeNs: currentStartTimeNs,
      endTimeNs: transition.timeNs
    });
    currentLevel = transition.toLevel;
    currentStartTimeNs = transition.timeNs;
  }

  segments.push({
    level: currentLevel,
    startTimeNs: currentStartTimeNs,
    endTimeNs: windowEndTimeNs
  });

  return segments.filter((segment) => segment.endTimeNs > segment.startTimeNs);
};

const summarizeDurations = (
  valuesNs: readonly number[]
): {
  minWidthNs: number;
  maxWidthNs: number;
  averageWidthNs: number;
} => {
  const minWidthNs = Math.min(...valuesNs);
  const maxWidthNs = Math.max(...valuesNs);
  const averageWidthNs = valuesNs.reduce((sum, value) => sum + value, 0) / valuesNs.length;

  return {
    minWidthNs,
    maxWidthNs,
    averageWidthNs
  };
};

const buildPulseWidthObservations = (
  segments: readonly ChannelSegment[]
): WaveformPulseWidthObservation[] => {
  const widthsByPolarity = new Map<"high" | "low", number[]>();

  for (const segment of segments) {
    const polarity: "high" | "low" = segment.level === 1 ? "high" : "low";
    const widths = widthsByPolarity.get(polarity) ?? [];
    widths.push(segment.endTimeNs - segment.startTimeNs);
    widthsByPolarity.set(polarity, widths);
  }

  return (["high", "low"] as const).flatMap((polarity) => {
    const widths = widthsByPolarity.get(polarity);
    if (!widths || widths.length === 0) {
      return [];
    }

    const summary = summarizeDurations(widths);
    return [
      {
        polarity,
        count: widths.length,
        ...summary
      }
    ];
  });
};

const buildRhythmObservation = (
  qualifyingTransitions: readonly LogicCaptureTransition[],
  referenceOffsetNs: number
): WaveformRhythmObservation | null => {
  if (qualifyingTransitions.length < 2) {
    return null;
  }

  const edgeKind = getEdgeKind(qualifyingTransitions[0]);
  const intervals = qualifyingTransitions.slice(1).map((transition, index) => {
    const previous = qualifyingTransitions[index];
    return transition.timeNs - previous.timeNs;
  });

  const minIntervalNs = Math.min(...intervals);
  const maxIntervalNs = Math.max(...intervals);
  const averageIntervalNs = intervals.reduce((sum, interval) => sum + interval, 0) / intervals.length;
  const spreadRatio = averageIntervalNs === 0 ? 0 : (maxIntervalNs - minIntervalNs) / averageIntervalNs;

  return {
    edgeKind,
    intervalCount: intervals.length,
    minIntervalNs,
    maxIntervalNs,
    averageIntervalNs,
    approximateFrequencyHz: averageIntervalNs > 0 ? 1_000_000_000 / averageIntervalNs : null,
    isSteady: spreadRatio <= RHYTHM_STEADY_SPREAD_RATIO
  };
};

const buildObservationSummary = (
  observation: Omit<WaveformChannelObservation, "summaryText">
): string => {
  const edgeKinds = observation.observedEdgeKinds.join("/") || "qualifying";
  const parts: string[] = [
    `${observation.qualifyingTransitionCount} ${edgeKinds} edge${
      observation.qualifyingTransitionCount === 1 ? "" : "s"
    } observed`
  ];

  if (observation.notes.some((note) => note.code === "edge-policy-filtered")) {
    const filteredCount = observation.totalTransitionCount - observation.qualifyingTransitionCount;
    parts.push(`after filtering out ${filteredCount} transition${filteredCount === 1 ? "" : "s"}`);
  }

  if (observation.rhythm) {
    const frequencyHz = observation.rhythm.approximateFrequencyHz;
    const roundedFrequency = frequencyHz === null ? null : Number(frequencyHz.toFixed(2));
    parts.push(
      `rhythm is ${observation.rhythm.isSteady ? "steady" : "irregular"}` +
        (roundedFrequency === null ? "" : ` at about ${roundedFrequency}Hz`)
    );
  } else if (
    observation.anomalies.some(
      (anomaly) =>
        anomaly.code === "insufficient-transitions" ||
        anomaly.code === "no-qualifying-edges"
    )
  ) {
    parts.push("insufficient data for rhythm");
  }

  if (observation.pulseWidths.length > 0) {
    const widthSummary = observation.pulseWidths
      .map((entry) => `${entry.polarity} widths avg ${Number(entry.averageWidthNs.toFixed(2))}ns`)
      .join(", ");
    parts.push(widthSummary);
  }

  return parts.join(", ") + ".";
};

const buildGlobalSummary = (result: Omit<WaveformAnalysisResult, "summaryText">): string => {
  if (result.channels.length === 0) {
    return "No capture channels matched the requested analysis scope.";
  }

  const channelSummaries = result.channels.map((channel) => `${channel.channelId} ${channel.summaryText.toLowerCase()}`);
  const hasInsufficientData = result.channels.some((channel) =>
    channel.anomalies.some((anomaly) => anomaly.code === "insufficient-transitions")
  );
  const noProtocolDecoding = result.capabilityNotes.some(
    (note) => note.code === "baseline-only-no-protocol-decoding"
  );

  const suffixes: string[] = [];
  if (hasInsufficientData) {
    suffixes.push("some channels have insufficient data for rhythm");
  }
  if (noProtocolDecoding) {
    suffixes.push("no protocol decoding is attempted");
  }

  return [channelSummaries.join(" "), suffixes.join(", ")]
    .filter((segment) => segment.length > 0)
    .join("; ");
};

const createNote = (
  code: WaveformCapabilityNote["code"],
  message: string,
  details?: WaveformCapabilityNote["details"],
  channelId?: string
): WaveformCapabilityNote => ({
  code,
  message,
  ...(channelId ? { channelId } : {}),
  ...(details ? { details } : {})
});

const createAnomaly = (
  code: WaveformAnomaly["code"],
  severity: WaveformAnomaly["severity"],
  message: string,
  details?: WaveformAnomaly["details"],
  channelId?: string
): WaveformAnomaly => ({
  code,
  severity,
  message,
  ...(channelId ? { channelId } : {}),
  ...(details ? { details } : {})
});

const buildChannelObservation = (
  channel: LogicCaptureChannel,
  analysis: LogicAnalyzerAnalysisConfig,
  window: ResolvedWindow,
  referenceOffsetNs: number,
  samplePeriodNs: number
): WaveformChannelObservation => {
  const transitionsInWindow = getTransitionsInWindow(channel, window);
  const qualifyingTransitions = transitionsInWindow.filter((transition) =>
    isQualifyingEdge(analysis.edgePolicy, getEdgeKind(transition))
  );
  const filteredTransitions = transitionsInWindow.filter(
    (transition) => !isQualifyingEdge(analysis.edgePolicy, getEdgeKind(transition))
  );
  const observedEdgeKinds = getObservedEdgeKinds(analysis.edgePolicy).filter((edgeKind) =>
    qualifyingTransitions.some((transition) => getEdgeKind(transition) === edgeKind)
  );
  const notes: WaveformCapabilityNote[] = [];
  const anomalies: WaveformAnomaly[] = [];

  if (filteredTransitions.length > 0) {
    notes.push(
      createNote(
        "edge-policy-filtered",
        `${filteredTransitions.length} transition${filteredTransitions.length === 1 ? " was" : "s were"} excluded by the ${analysis.edgePolicy}-only policy.`,
        {
          filteredTransitionCount: filteredTransitions.length,
          edgePolicy: analysis.edgePolicy
        },
        channel.channelId
      )
    );
  }

  if (qualifyingTransitions.length === 0) {
    anomalies.push(
      createAnomaly(
        "no-qualifying-edges",
        "warning",
        `No ${analysis.edgePolicy === "all" ? "qualifying" : analysis.edgePolicy} edges were observed in the analyzed window.`,
        {
          totalTransitionCount: transitionsInWindow.length,
          qualifyingTransitionCount: 0
        },
        channel.channelId
      )
    );
    notes.push(
      createNote(
        "insufficient-transition-data",
        "Need qualifying transitions before edge rhythm or frequency can be inferred.",
        {
          qualifyingTransitionCount: 0
        },
        channel.channelId
      )
    );
  } else if (qualifyingTransitions.length < 2) {
    anomalies.push(
      createAnomaly(
        "insufficient-transitions",
        "warning",
        "Need at least two qualifying edges to estimate rhythm.",
        {
          qualifyingTransitionCount: qualifyingTransitions.length
        },
        channel.channelId
      )
    );
    notes.push(
      createNote(
        "insufficient-transition-data",
        "Need at least two qualifying transitions for rhythm analysis.",
        {
          qualifyingTransitionCount: qualifyingTransitions.length
        },
        channel.channelId
      )
    );
  }

  const segments = buildSegments(channel, transitionsInWindow, window, samplePeriodNs);
  const pulseWidths = analysis.includePulseWidths ? buildPulseWidthObservations(segments) : [];
  if (analysis.includePulseWidths) {
    for (const observation of pulseWidths) {
      if (observation.count < 2) {
        continue;
      }

      const spreadRatio =
        observation.averageWidthNs === 0
          ? 0
          : (observation.maxWidthNs - observation.minWidthNs) / observation.averageWidthNs;
      if (spreadRatio > PULSE_WIDTH_STEADY_SPREAD_RATIO) {
        anomalies.push(
          createAnomaly(
            "inconsistent-pulse-widths",
            "warning",
            `${observation.polarity} pulse widths vary noticeably within the analyzed window.`,
            {
              polarity: observation.polarity,
              minWidthNs: observation.minWidthNs,
              maxWidthNs: observation.maxWidthNs,
              averageWidthNs: Number(observation.averageWidthNs.toFixed(2))
            },
            channel.channelId
          )
        );
      }
    }
  }

  const rhythm = buildRhythmObservation(qualifyingTransitions, referenceOffsetNs);
  if (rhythm && !rhythm.isSteady) {
    anomalies.push(
      createAnomaly(
        "irregular-rhythm",
        "warning",
        `${rhythm.edgeKind} edge spacing is irregular in the analyzed window.`,
        {
          minIntervalNs: rhythm.minIntervalNs,
          maxIntervalNs: rhythm.maxIntervalNs,
          averageIntervalNs: Number(rhythm.averageIntervalNs.toFixed(2))
        },
        channel.channelId
      )
    );
  }

  const observationWithoutSummary: Omit<WaveformChannelObservation, "summaryText"> = {
    channelId: channel.channelId,
    ...(channel.label ? { label: channel.label } : {}),
    initialLevel: getLevelAtSample(channel, window.startSampleIndex),
    finalLevel:
      transitionsInWindow.length > 0
        ? transitionsInWindow[transitionsInWindow.length - 1].toLevel
        : getLevelAtSample(channel, window.startSampleIndex),
    qualifyingEdgePolicy: analysis.edgePolicy,
    observedEdgeKinds,
    totalTransitionCount: transitionsInWindow.length,
    qualifyingTransitionCount: qualifyingTransitions.length,
    firstQualifyingTransitionTimeNs:
      qualifyingTransitions[0] ? qualifyingTransitions[0].timeNs - referenceOffsetNs : null,
    lastQualifyingTransitionTimeNs:
      qualifyingTransitions[qualifyingTransitions.length - 1]
        ? qualifyingTransitions[qualifyingTransitions.length - 1].timeNs - referenceOffsetNs
        : null,
    pulseWidths,
    rhythm,
    anomalies,
    notes
  };

  return {
    ...observationWithoutSummary,
    summaryText: buildObservationSummary(observationWithoutSummary)
  };
};

const getReferenceOffsetNs = (
  analysis: LogicAnalyzerAnalysisConfig,
  channels: readonly LogicCaptureChannel[],
  window: ResolvedWindow
): { referenceOffsetNs: number; notes: WaveformCapabilityNote[] } => {
  if (analysis.timeReference === "capture-start") {
    return {
      referenceOffsetNs: 0,
      notes: []
    };
  }

  const firstTransition = channels
    .flatMap((channel) => getTransitionsInWindow(channel, window))
    .sort((left, right) => left.timeNs - right.timeNs)[0];

  if (!firstTransition) {
    return {
      referenceOffsetNs: 0,
      notes: [
        createNote(
          "insufficient-transition-data",
          "Time reference stayed at capture start because the analyzed window contains no transitions.",
          {
            timeReference: analysis.timeReference
          }
        )
      ]
    };
  }

  return {
    referenceOffsetNs: firstTransition.timeNs,
    notes:
      firstTransition.timeNs > 0
        ? [
            createNote(
              "time-reference-shifted",
              `Reported times are shifted so the first transition in the analyzed window starts at 0ns.`,
              {
                referenceOffsetNs: firstTransition.timeNs
              }
            )
          ]
        : []
  };
};

export const analyzeWaveformCapture = (
  capture: LogicCapture,
  analysis: LogicAnalyzerAnalysisConfig
): WaveformAnalysisResult => {
  const window = resolveWindow(capture, analysis);
  const focusIds = new Set(analysis.focusChannelIds);
  const channelsToAnalyze =
    focusIds.size === 0
      ? [...capture.channels]
      : capture.channels.filter((channel) => focusIds.has(channel.channelId));

  const capabilityNotes: WaveformCapabilityNote[] = [];
  const anomalies: WaveformAnomaly[] = [];

  if (focusIds.size > 0) {
    capabilityNotes.push(
      createNote("focus-channels-applied", "Analysis is limited to the requested focus channels.", {
        requestedChannelCount: analysis.focusChannelIds.length,
        analyzedChannelCount: channelsToAnalyze.length
      })
    );
  }

  if (window.requested && !window.isFullCapture) {
    capabilityNotes.push(
      createNote(
        "analysis-window-applied",
        `Observations are limited to samples ${window.startSampleIndex} through ${window.endSampleIndex}.`,
        {
          startSampleIndex: window.startSampleIndex,
          endSampleIndex: window.endSampleIndex,
          clippedToCapture: window.clippedToCapture
        }
      )
    );
    anomalies.push(
      createAnomaly(
        "window-truncated-activity",
        "info",
        "Analysis only covers the requested sample window.",
        {
          startSampleIndex: window.startSampleIndex,
          endSampleIndex: window.endSampleIndex,
          clippedToCapture: window.clippedToCapture
        }
      )
    );
  }

  if (!analysis.includePulseWidths) {
    capabilityNotes.push(
      createNote(
        "pulse-widths-disabled",
        "Pulse width statistics were skipped by analysis configuration.",
        {
          includePulseWidths: false
        }
      )
    );
  }

  const reference = getReferenceOffsetNs(analysis, channelsToAnalyze, window);
  capabilityNotes.push(...reference.notes);

  capabilityNotes.push(
    createNote(
      "baseline-only-no-protocol-decoding",
      "Structured output only covers baseline waveform interpretation."
    )
  );

  const channelObservations = channelsToAnalyze.map((channel) =>
    buildChannelObservation(
      channel,
      analysis,
      window,
      reference.referenceOffsetNs,
      capture.samplePeriodNs
    )
  );

  for (const channel of channelObservations) {
    anomalies.push(...channel.anomalies);
  }

  const resultWithoutSummary: Omit<WaveformAnalysisResult, "summaryText"> = {
    captureSource: {
      adapterId: capture.adapterId,
      sourceName: capture.sourceName,
      capturedAt: capture.capturedAt
    },
    timing: {
      sampleRateHz: capture.sampleRateHz,
      samplePeriodNs: capture.samplePeriodNs,
      totalSamples: capture.totalSamples,
      captureDurationNs: capture.durationNs,
      timeReference: analysis.timeReference,
      referenceOffsetNs: reference.referenceOffsetNs,
      analyzedWindow: {
        startSampleIndex: window.startSampleIndex,
        endSampleIndex: window.endSampleIndex,
        sampleCount: window.sampleCount,
        durationNs: window.durationNs,
        clippedToCapture: window.clippedToCapture
      }
    },
    analyzedChannelIds: channelObservations.map((channel) => channel.channelId),
    channels: channelObservations,
    anomalies,
    capabilityNotes
  };

  return {
    ...resultWithoutSummary,
    summaryText: buildGlobalSummary(resultWithoutSummary)
  };
};
