import type {
  CaptureAdapterLoadResult,
  CaptureArtifactInput,
  LogicCapture,
  LogicCaptureAdapter,
  LogicCaptureChannel,
  LogicLevel
} from "../capture-contracts.js";
import {
  readArtifactText,
  summarizeCaptureArtifact
} from "../capture-contracts.js";

const TIME_HEADER_PATTERN = /^time\s*\[([^\]]+)\]$/i;
const SUPPORTED_TIME_UNITS = new Map<string, number>([
  ["s", 1_000_000_000],
  ["ms", 1_000_000],
  ["us", 1_000],
  ["µs", 1_000],
  ["ns", 1]
]);
const SUPPORTED_VALUE_MAP = new Map<string, LogicLevel>([
  ["0", 0],
  ["1", 1],
  ["low", 0],
  ["high", 1],
  ["l", 0],
  ["h", 1],
  ["false", 0],
  ["true", 1]
]);
const DELIMITERS = [",", ";", "\t"] as const;

interface ParsedRow {
  timeNs: number;
  levels: LogicLevel[];
}

const detectDelimiter = (line: string): string => {
  let bestDelimiter: string = DELIMITERS[0];
  let bestCount = -1;

  for (const delimiter of DELIMITERS) {
    const count = line.split(delimiter).length;
    if (count > bestCount) {
      bestDelimiter = delimiter;
      bestCount = count;
    }
  }

  return bestDelimiter;
};

const splitLines = (text: string): string[] =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

const parseLevel = (value: string): LogicLevel | null =>
  SUPPORTED_VALUE_MAP.get(value.trim().toLowerCase()) ?? null;

const buildUnreadableFailure = (
  input: CaptureArtifactInput,
  message: string,
  details: readonly string[] = []
): CaptureAdapterLoadResult => ({
  ok: false,
  reason: "unreadable-input",
  adapterId: "sigrok-csv",
  artifact: summarizeCaptureArtifact(input),
  message,
  details
});

const parseRows = (
  lines: readonly string[],
  delimiter: string,
  columnCount: number,
  timeFactorNs: number,
  input: CaptureArtifactInput
): ParsedRow[] | CaptureAdapterLoadResult => {
  const rows: ParsedRow[] = [];

  for (let index = 1; index < lines.length; index += 1) {
    const values = lines[index]?.split(delimiter).map((value) => value.trim()) ?? [];
    if (values.length !== columnCount) {
      return buildUnreadableFailure(input, "CSV row width does not match the header.", [
        `Row ${index + 1} has ${values.length} columns; expected ${columnCount}.`
      ]);
    }

    const timeValue = Number(values[0]);
    if (!Number.isFinite(timeValue)) {
      return buildUnreadableFailure(input, "CSV time column contains a non-numeric value.", [
        `Row ${index + 1} time value ${JSON.stringify(values[0])} is not numeric.`
      ]);
    }

    const levels: LogicLevel[] = [];
    for (let channelIndex = 1; channelIndex < values.length; channelIndex += 1) {
      const parsedLevel = parseLevel(values[channelIndex] ?? "");
      if (parsedLevel === null) {
        return buildUnreadableFailure(input, "CSV channel values must be binary states.", [
          `Row ${index + 1} column ${channelIndex + 1} value ${JSON.stringify(
            values[channelIndex]
          )} is not a supported logic level.`
        ]);
      }

      levels.push(parsedLevel);
    }

    rows.push({
      timeNs: timeValue * timeFactorNs,
      levels
    });
  }

  return rows;
};

const inferSamplePeriodNs = (
  rows: readonly ParsedRow[],
  input: CaptureArtifactInput
): number | CaptureAdapterLoadResult => {
  if (rows.length < 2) {
    return buildUnreadableFailure(input, "CSV capture must contain at least two samples.", [
      "A normalized capture needs two or more time rows to infer sample timing."
    ]);
  }

  const deltas = rows.slice(1).map((row, index) => row.timeNs - rows[index]!.timeNs);
  const firstDelta = deltas[0] ?? 0;

  if (!(firstDelta > 0)) {
    return buildUnreadableFailure(input, "CSV time column must increase monotonically.", [
      "The first two rows do not establish a positive sample period."
    ]);
  }

  const tolerance = Math.max(Math.abs(firstDelta) * 1e-6, 1e-3);
  for (const [index, delta] of deltas.entries()) {
    if (!(delta > 0)) {
      return buildUnreadableFailure(input, "CSV time column must increase monotonically.", [
        `Rows ${index + 1} and ${index + 2} do not increase in time.`
      ]);
    }

    if (Math.abs(delta - firstDelta) > tolerance) {
      return buildUnreadableFailure(input, "CSV sample timing must use a stable period.", [
        `Rows ${index + 1} and ${index + 2} differ by ${delta}ns instead of ${firstDelta}ns.`
      ]);
    }
  }

  return firstDelta;
};

const buildChannels = (
  channelIds: readonly string[],
  rows: readonly ParsedRow[],
  startTimeNs: number
): LogicCaptureChannel[] =>
  channelIds.map((channelId, channelIndex) => {
    const initialLevel = rows[0]?.levels[channelIndex] ?? 0;
    const transitions = [] as LogicCaptureChannel["transitions"] extends readonly (infer T)[]
      ? T[]
      : never[];
    let previousLevel = initialLevel;

    for (let sampleIndex = 1; sampleIndex < rows.length; sampleIndex += 1) {
      const nextLevel = rows[sampleIndex]?.levels[channelIndex] ?? previousLevel;
      if (nextLevel === previousLevel) {
        continue;
      }

      transitions.push({
        sampleIndex,
        timeNs: (rows[sampleIndex]?.timeNs ?? startTimeNs) - startTimeNs,
        fromLevel: previousLevel,
        toLevel: nextLevel
      });
      previousLevel = nextLevel;
    }

    return {
      channelId,
      initialLevel,
      transitions
    };
  });

const normalizeCapture = (
  input: CaptureArtifactInput,
  channelIds: readonly string[],
  rows: readonly ParsedRow[],
  samplePeriodNs: number
): LogicCapture => {
  const startTimeNs = rows[0]?.timeNs ?? 0;
  const sampleRateHz = 1_000_000_000 / samplePeriodNs;

  return {
    adapterId: "sigrok-csv",
    sourceName: input.sourceName ?? null,
    capturedAt: input.capturedAt ?? null,
    sampleRateHz,
    samplePeriodNs,
    totalSamples: rows.length,
    durationNs: rows.length * samplePeriodNs,
    channels: buildChannels(channelIds, rows, startTimeNs),
    artifact: summarizeCaptureArtifact(input)
  };
};

export const sigrokCsvAdapter: LogicCaptureAdapter = {
  id: "sigrok-csv",
  formatHints: ["sigrok-csv", "pulseview-csv", "sigrok", "csv"],

  canLoad(input: CaptureArtifactInput): boolean {
    if (typeof input.formatHint === "string") {
      const hint = input.formatHint.trim().toLowerCase();
      if (this.formatHints.includes(hint)) {
        return true;
      }
    }

    if (typeof input.sourceName === "string" && input.sourceName.toLowerCase().endsWith(".csv")) {
      return true;
    }

    const text = readArtifactText(input);
    if (!text) {
      return false;
    }

    const firstLine = splitLines(text)[0] ?? "";
    return TIME_HEADER_PATTERN.test(firstLine);
  },

  load(input: CaptureArtifactInput): CaptureAdapterLoadResult {
    const text = readArtifactText(input);
    if (!text) {
      return buildUnreadableFailure(input, "Capture artifact does not contain readable text.", [
        "Provide CSV text directly or UTF-8 bytes for the sigrok-csv adapter."
      ]);
    }

    const lines = splitLines(text);
    if (lines.length < 3) {
      return buildUnreadableFailure(input, "CSV capture must include a header and at least two samples.");
    }

    const header = lines[0] ?? "";
    const delimiter = detectDelimiter(header);
    const columns = header.split(delimiter).map((value) => value.trim());
    if (columns.length < 2) {
      return buildUnreadableFailure(input, "CSV capture must include a time column and at least one channel.");
    }

    const timeMatch = TIME_HEADER_PATTERN.exec(columns[0] ?? "");
    if (!timeMatch) {
      return buildUnreadableFailure(input, "CSV header must begin with a sigrok-style time column.", [
        `Expected a header like Time [s], received ${JSON.stringify(columns[0])}.`
      ]);
    }

    const unit = (timeMatch[1] ?? "").trim().toLowerCase();
    const timeFactorNs = SUPPORTED_TIME_UNITS.get(unit);
    if (!timeFactorNs) {
      return buildUnreadableFailure(input, "CSV time column uses an unsupported unit.", [
        `Supported units are ${Array.from(SUPPORTED_TIME_UNITS.keys()).join(", ")}; received ${unit}.`
      ]);
    }

    const channelIds = columns.slice(1).map((column) => column.trim()).filter(Boolean);
    if (channelIds.length === 0) {
      return buildUnreadableFailure(input, "CSV capture must include at least one named channel column.");
    }

    const parsedRows = parseRows(lines, delimiter, columns.length, timeFactorNs, input);
    if (!Array.isArray(parsedRows)) {
      return parsedRows;
    }

    const samplePeriodNs = inferSamplePeriodNs(parsedRows, input);
    if (typeof samplePeriodNs !== "number") {
      return samplePeriodNs;
    }

    return {
      ok: true,
      capture: normalizeCapture(input, channelIds, parsedRows, samplePeriodNs)
    };
  }
};
