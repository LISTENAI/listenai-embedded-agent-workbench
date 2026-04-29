import { execFile } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import process from "node:process"
import type {
  CaptureDecodeFailure,
  CaptureDecodeReport,
  CaptureDecodeRequest,
  CaptureDecodeResult,
  DecoderCapabilitiesFailure,
  DecoderCapabilitiesRequest,
  DecoderCapabilitiesResult,
  DecoderCapability,
  DecoderOptionValue,
  DeviceOptionTokenCapability,
  DeviceOptionsCapabilities,
  DeviceOptionsFailureKind,
  DeviceOptionsFailurePhase,
  DeviceOptionsRequest,
  InventoryDiagnosticCode,
  InventoryPlatform,
  LiveCaptureArtifact,
  LiveCaptureFailureKind,
  LiveCaptureFailurePhase,
  LiveCaptureRequest,
  LiveCaptureTuning
} from "@listenai/eaw-contracts"
import { summarizeLiveCaptureArtifact } from "@listenai/eaw-contracts"
import type { DslogicProbeDeviceCandidate } from "./backend-probe.js"

export const DSLOGIC_NATIVE_BACKEND_KIND = "dsview-cli" as const
export const DSLOGIC_SUPPORTED_HOST_PLATFORMS = ["linux", "macos", "windows"] as const
export const DEFAULT_DSLOGIC_RUNTIME_PROBE_TIMEOUT_MS = 3_000
const DEFAULT_DSLOGIC_RUNTIME_PROBE_MAX_BUFFER_BYTES = 64 * 1024
const DEFAULT_DSLOGIC_CAPTURE_TIMEOUT_MS = 15_000
const DEFAULT_DSLOGIC_CAPTURE_MAX_BUFFER_BYTES = 512 * 1024
const DEFAULT_DSLOGIC_OPTIONS_MAX_BUFFER_BYTES = 256 * 1024
const DEFAULT_DSLOGIC_DECODE_MAX_BUFFER_BYTES = 2 * 1024 * 1024
const DEFAULT_DSLOGIC_DECODE_RUN_MAX_BUFFER_BYTES = 64 * 1024 * 1024
const DEFAULT_DSLOGIC_DECODE_INPUT_MAX_BYTES = 64 * 1024 * 1024
const DEFAULT_DSVIEW_CAPTURE_POLL_INTERVAL_MS = 50
const DEFAULT_DSVIEW_CLI_PATH = "dsview-cli"

export type DslogicNativeRuntimeState =
  | "ready"
  | "missing"
  | "timeout"
  | "failed"
  | "malformed"
  | "unsupported-os"

export interface DslogicNativeRuntimeDiagnostic {
  code: InventoryDiagnosticCode
  message: string
  deviceId?: string
  // `libraryPath` stays as a compatibility alias while the seam transitions to bundle-aware naming.
  libraryPath?: string | null
  binaryPath?: string | null
  backendVersion?: string | null
}

export interface DslogicNativeHostMetadata {
  platform: InventoryPlatform
  os: NodeJS.Platform | string
  arch: NodeJS.Architecture | string
}

export interface DslogicNativeRuntimeSnapshot {
  checkedAt: string
  host: DslogicNativeHostMetadata
  runtime: {
    state: DslogicNativeRuntimeState
    libraryPath: string | null
    binaryPath?: string | null
    version: string | null
  }
  devices: readonly DslogicProbeDeviceCandidate[]
  diagnostics: readonly DslogicNativeRuntimeDiagnostic[]
}

export interface DslogicNativeRuntime {
  probe(): Promise<DslogicNativeRuntimeSnapshot>
}

export interface DslogicNativeCaptureStreamValue {
  text?: string
  bytes?: Uint8Array
}

export interface DslogicNativeCaptureSuccess {
  ok: true
  backendVersion?: string | null
  diagnosticOutput?: DslogicNativeCaptureStreamValue
  artifact: LiveCaptureArtifact
  auxiliaryArtifacts?: readonly LiveCaptureArtifact[]
}

export interface DslogicNativeCaptureFailure {
  ok: false
  kind: Exclude<LiveCaptureFailureKind, "unsupported-runtime">
  phase: Exclude<LiveCaptureFailurePhase, "validate-session">
  message: string
  backendVersion?: string | null
  timeoutMs?: number
  nativeCode?: string | null
  captureOutput?: DslogicNativeCaptureStreamValue
  diagnosticOutput?: DslogicNativeCaptureStreamValue
  details?: readonly string[]
}

export type DslogicNativeCaptureResult =
  | DslogicNativeCaptureSuccess
  | DslogicNativeCaptureFailure

export interface DslogicNativeLiveCaptureBackend {
  capture(request: LiveCaptureRequest): Promise<DslogicNativeCaptureResult>
}

export interface DslogicNativeDeviceOptionsSuccess {
  ok: true
  backendVersion?: string | null
  capabilities: DeviceOptionsCapabilities
  optionsOutput?: DslogicNativeCaptureStreamValue
  diagnosticOutput?: DslogicNativeCaptureStreamValue
}

export interface DslogicNativeDeviceOptionsFailure {
  ok: false
  kind: Exclude<DeviceOptionsFailureKind, "device-not-found" | "device-not-allocated" | "owner-mismatch" | "unsupported-runtime">
  phase: Exclude<DeviceOptionsFailurePhase, "validate-session">
  message: string
  backendVersion?: string | null
  timeoutMs?: number
  nativeCode?: string | null
  optionsOutput?: DslogicNativeCaptureStreamValue
  diagnosticOutput?: DslogicNativeCaptureStreamValue
  details?: readonly string[]
}

export type DslogicNativeDeviceOptionsResult =
  | DslogicNativeDeviceOptionsSuccess
  | DslogicNativeDeviceOptionsFailure

export interface DslogicNativeDeviceOptionsBackend {
  inspectDeviceOptions(request: DeviceOptionsRequest): Promise<DslogicNativeDeviceOptionsResult>
}

export interface DslogicNativeDecoderCapabilitiesBackend {
  listDecoderCapabilities(request: DecoderCapabilitiesRequest): Promise<DecoderCapabilitiesResult>
}

export interface DslogicNativeCaptureDecodeBackend {
  captureDecode(request: CaptureDecodeRequest): Promise<CaptureDecodeResult>
}

export interface DslogicNativeCommandSuccess {
  ok: true
  stdout: string
  stderr: string
}

export interface DslogicNativeCommandFailure {
  ok: false
  reason: "missing" | "timeout" | "failed"
  stdout: string
  stderr: string
  exitCode: number | null
  signal: NodeJS.Signals | null
  nativeCode: string | number | null
}

export type DslogicNativeCommandResult =
  | DslogicNativeCommandSuccess
  | DslogicNativeCommandFailure

export type DslogicNativeCommandRunner = (
  command: string,
  args: readonly string[],
  options: {
    timeoutMs: number
    maxBufferBytes: number
  }
) => Promise<DslogicNativeCommandResult>

interface ParsedDsviewVersion {
  version: string
  binaryPath: string | null
}

interface ParsedDsviewListedDevice {
  handle: number
  stableId: string | null
  model: string | null
  nativeName: string | null
}

interface ParsedDsviewCaptureResult {
  selectedHandle: number | null
  completion: string | null
  artifacts: {
    vcdPath: string | null
    metadataPath: string | null
  }
}

interface DsviewCaptureMetadata {
  toolVersion: string | null
  capturedAt: string | null
  sampleRateHz: number | null
  totalSamples: number | null
  requestedSampleLimit: number | null
}

interface ParsedDsviewDecoderSummary {
  id: string
  label?: string
  description?: string
}

interface ParsedDsviewDecoderChannel extends DeviceOptionTokenCapability {
  nativeId?: string
}

interface ParsedDsviewDecoderDetails extends ParsedDsviewDecoderSummary {
  requiredChannels: ParsedDsviewDecoderChannel[]
  optionalChannels: ParsedDsviewDecoderChannel[]
  options: Array<{
    id: string
    label?: string
    description?: string
    valueType?: "string" | "number" | "boolean"
    values: DecoderOptionValue[]
  }>
}

export interface CreateDslogicNativeRuntimeOptions {
  now?: () => string
  getHostOs?: () => NodeJS.Platform
  getHostArch?: () => NodeJS.Architecture
  dsviewCliPath?: string
  dsviewResourceDir?: string
  probeTimeoutMs?: number
  executeCommand?: DslogicNativeCommandRunner
  probeRuntime?: (
    host: DslogicNativeHostMetadata
  ) => Promise<Pick<DslogicNativeRuntimeSnapshot, "runtime" | "devices" | "diagnostics">>
}

export interface CreateDslogicNativeLiveCaptureOptions
  extends CreateDslogicNativeRuntimeOptions {
  runtime?: DslogicNativeRuntime
  readTextFile?: (path: string) => Promise<string>
  createTempDir?: () => Promise<string>
  removeTempDir?: (path: string) => Promise<void>
}

export interface CreateDslogicNativeDeviceOptionsOptions
  extends CreateDslogicNativeRuntimeOptions {
  runtime?: DslogicNativeRuntime
}

export interface CreateDslogicNativeDecoderOptions
  extends CreateDslogicNativeRuntimeOptions {
  runtime?: DslogicNativeRuntime
  readTextFile?: (path: string) => Promise<string>
  writeTextFile?: (path: string, content: string) => Promise<void>
  createTempDir?: () => Promise<string>
  removeTempDir?: (path: string) => Promise<void>
}

export const resolveInventoryPlatform = (
  platform: NodeJS.Platform | string
): InventoryPlatform => {
  switch (platform) {
    case "darwin":
    case "macos":
      return "macos"
    case "win32":
    case "windows":
      return "windows"
    default:
      return "linux"
  }
}

const SUPPORTED_HOST_OPERATING_SYSTEMS = new Set<NodeJS.Platform | string>([
  "darwin",
  "macos",
  "linux",
  "win32",
  "windows"
])

const normalizeRuntimePath = (runtime: {
  libraryPath?: string | null
  binaryPath?: string | null
}): string | null => runtime.binaryPath ?? runtime.libraryPath ?? null

const createUnsupportedSnapshot = (
  checkedAt: string,
  host: DslogicNativeHostMetadata
): DslogicNativeRuntimeSnapshot => ({
  checkedAt,
  host,
  runtime: {
    state: "unsupported-os",
    libraryPath: null,
    binaryPath: null,
    version: null
  },
  devices: [],
  diagnostics: []
})

const cloneProbeResult = (
  result: Pick<DslogicNativeRuntimeSnapshot, "runtime" | "devices" | "diagnostics">
): Pick<DslogicNativeRuntimeSnapshot, "runtime" | "devices" | "diagnostics"> => ({
  runtime: { ...result.runtime },
  devices: result.devices.map((device) => ({ ...device })),
  diagnostics: result.diagnostics.map((diagnostic) => ({ ...diagnostic }))
})

const combineCommandOutput = (
  result: Pick<DslogicNativeCommandResult, "stdout" | "stderr">
): string => [result.stdout, result.stderr].filter((chunk) => chunk.trim().length > 0).join("\n")

const createRuntimeDiagnostic = (
  code: InventoryDiagnosticCode,
  message: string,
  runtime: { libraryPath?: string | null; binaryPath?: string | null; version: string | null }
): DslogicNativeRuntimeDiagnostic => {
  const binaryPath = normalizeRuntimePath(runtime)

  return {
    code,
    message,
    libraryPath: binaryPath,
    binaryPath,
    backendVersion: runtime.version
  }
}

const createRuntimeResult = (
  host: DslogicNativeHostMetadata,
  state: Exclude<DslogicNativeRuntimeState, "unsupported-os">,
  runtime: { libraryPath?: string | null; binaryPath?: string | null; version: string | null },
  code?: InventoryDiagnosticCode
): Pick<DslogicNativeRuntimeSnapshot, "runtime" | "devices" | "diagnostics"> => {
  const binaryPath = normalizeRuntimePath(runtime)
  const messageByCode: Record<InventoryDiagnosticCode, string> = {
    "backend-missing-runtime": `dsview-cli runtime is not available on ${host.platform}.`,
    "backend-unsupported-os": `dsview-cli probing is not supported on ${host.platform}.`,
    "backend-runtime-failed": `dsview-cli runtime probe failed on ${host.platform}.`,
    "backend-runtime-timeout": `dsview-cli runtime probe timed out before readiness was confirmed on ${host.platform}.`,
    "backend-runtime-malformed-response": `dsview-cli runtime probe returned malformed output on ${host.platform}.`,
    "device-unsupported-variant": `Unsupported DSLogic variant detected on ${host.platform}.`,
    "device-runtime-malformed-response": `Unable to classify DSLogic variant on ${host.platform}.`
  }

  return {
    runtime: {
      state,
      libraryPath: binaryPath,
      binaryPath,
      version: runtime.version
    },
    devices: [],
    diagnostics: code
      ? [createRuntimeDiagnostic(code, messageByCode[code], { ...runtime, binaryPath })]
      : []
  }
}

const defaultExecuteCommand: DslogicNativeCommandRunner = (
  command,
  args,
  options
) =>
  new Promise((resolve, reject) => {
    execFile(
      command,
      [...args],
      {
        encoding: "utf8",
        timeout: options.timeoutMs,
        maxBuffer: options.maxBufferBytes,
        windowsHide: true
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolve({ ok: true, stdout, stderr })
          return
        }

        if (typeof error === "object" && error !== null) {
          const nativeCode = "code" in error ? (error.code as string | number | null | undefined) : null
          const signal = "signal" in error ? (error.signal as NodeJS.Signals | null | undefined) : null
          const exitCode = typeof nativeCode === "number" ? nativeCode : null
          const killed = "killed" in error ? Boolean(error.killed) : false
          const reason =
            nativeCode === "ENOENT"
              ? "missing"
              : killed && /timed out/i.test(error.message)
                ? "timeout"
                : "failed"

          resolve({
            ok: false,
            reason,
            stdout: typeof stdout === "string" ? stdout : "",
            stderr: typeof stderr === "string" ? stderr : "",
            exitCode,
            signal: signal ?? null,
            nativeCode: nativeCode ?? null
          })
          return
        }

        reject(error)
      }
    )
  })

const looksLikeFileSystemPath = (value: string): boolean => {
  const trimmed = value.trim()
  return (
    trimmed.startsWith("/") ||
    trimmed.startsWith("./") ||
    trimmed.startsWith("../") ||
    trimmed.startsWith("~") ||
    trimmed.includes("\\") ||
    /^[A-Za-z]:[\\/]/.test(trimmed)
  )
}

const isJsonRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const readRecordString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null

const readRecordNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number.parseInt(value.trim(), 10)
    return Number.isFinite(parsed) ? parsed : null
  }

  return null
}

const extractJsonObject = (output: string): string | null => {
  const start = output.indexOf("{")
  const end = output.lastIndexOf("}")

  if (start < 0 || end <= start) {
    return null
  }

  return output.slice(start, end + 1)
}

const slugifyToken = (value: string | null | undefined): string | null => {
  if (!value) {
    return null
  }

  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
  return normalized.length > 0 ? normalized : null
}

const parseDsviewVersionOutput = (
  output: string,
  commandPath?: string
): ParsedDsviewVersion | null => {
  const versionMatch =
    output.match(/\bdsview-cli\b(?:\s+version)?\s+v?([0-9][^\s]*)/i) ??
    output.match(/\bdsview\s+cli\b(?:\s+version)?\s+v?([0-9][^\s]*)/i)

  if (!versionMatch?.[1]) {
    return null
  }

  const unixBinaryMatch = output.match(/(?:^|\s)(\/[\w./-]*dsview-cli(?:\.exe)?)(?=$|\s)/i)
  const windowsBinaryMatch = output.match(/([A-Za-z]:\\[^\r\n]*?dsview-cli(?:\.exe)?)/i)
  const explicitPath =
    typeof commandPath === "string" && looksLikeFileSystemPath(commandPath)
      ? commandPath.trim()
      : null

  return {
    version: versionMatch[1],
    binaryPath: unixBinaryMatch?.[1] ?? windowsBinaryMatch?.[1] ?? explicitPath
  }
}

const parseDsviewListedDevices = (output: string): ParsedDsviewListedDevice[] => {
  const payloadText = extractJsonObject(output)
  if (!payloadText) {
    return []
  }

  const payload = JSON.parse(payloadText) as unknown
  const entries =
    isJsonRecord(payload) && Array.isArray(payload.devices)
      ? payload.devices
      : []

  return entries.flatMap((entry) => {
    if (!isJsonRecord(entry)) {
      return []
    }

    const handle = readRecordNumber(entry.handle)
    if (handle === null) {
      return []
    }

    return [{
      handle,
      stableId: readRecordString(entry.stable_id ?? entry.stableId),
      model: readRecordString(entry.model),
      nativeName: readRecordString(entry.native_name ?? entry.nativeName)
    }]
  })
}

const readTokenLabel = (entry: Record<string, unknown>, token: string): string | undefined => {
  const label = readRecordString(entry.label ?? entry.display_label ?? entry.displayLabel)
  const name = readRecordString(entry.name)

  return label ?? (name && name !== token ? name : undefined)
}

const parseCapabilityGroup = (
  value: unknown
): DeviceOptionsCapabilities["operations"] | null => {
  if (value === undefined || value === null) {
    return []
  }

  if (!Array.isArray(value)) {
    return null
  }

  const tokens: Array<DeviceOptionsCapabilities["operations"][number]> = []
  const seen = new Set<string>()

  for (const entry of value) {
    if (typeof entry === "string") {
      const token = entry.trim()
      if (token.length > 0 && !seen.has(token)) {
        seen.add(token)
        tokens.push({ token })
      }
      continue
    }

    if (!isJsonRecord(entry)) {
      return null
    }

    const token = readRecordString(
      entry.token ?? entry.value ?? entry.id ?? entry.key ?? entry.name
    )
    if (!token) {
      return null
    }

    if (seen.has(token)) {
      continue
    }

    seen.add(token)
    const capability: DeviceOptionsCapabilities["operations"][number] = { token }
    const label = readTokenLabel(entry, token)
    const description = readRecordString(entry.description ?? entry.desc ?? entry.help)
    if (label) {
      capability.label = label
    }
    if (description) {
      capability.description = description
    }
    tokens.push(capability)
  }

  return tokens
}

const readCapabilityGroup = (
  payload: Record<string, unknown>,
  aliases: readonly string[]
): unknown => {
  for (const alias of aliases) {
    if (Object.hasOwn(payload, alias)) {
      return payload[alias]
    }
  }

  return undefined
}

const parseDsviewDeviceOptions = (output: string): DeviceOptionsCapabilities | null => {
  const payloadText = extractJsonObject(output)
  if (!payloadText) {
    return null
  }

  const payload = JSON.parse(payloadText) as unknown
  if (!isJsonRecord(payload)) {
    return null
  }

  const root = isJsonRecord(payload.capabilities)
    ? payload.capabilities
    : isJsonRecord(payload.options)
      ? payload.options
      : payload

  // Try new dsview-cli structure first (operation_modes, stop_options, etc.)
  // Fall back to legacy structure (operations, stopConditions, etc.)
  const operations = parseCapabilityGroup(
    readCapabilityGroup(root, ["operation_modes", "operationModes", "operations", "operation", "modes", "mode"])
  )

  // New dsview-cli reports channel modes grouped by operation mode. Flatten unique tokens for the current contract shape.
  let channels: DeviceOptionsCapabilities["channels"] | null = null
  const channelModesByOp = readCapabilityGroup(root, ["channel_modes_by_operation_mode", "channelModesByOperationMode"])
  if (Array.isArray(channelModesByOp)) {
    const allChannelModes: DeviceOptionTokenCapability[] = []
    const seenTokens = new Set<string>()
    for (const opEntry of channelModesByOp) {
      if (!isJsonRecord(opEntry)) continue
      const opChannelModes = opEntry.channel_modes ?? opEntry.channelModes
      if (!Array.isArray(opChannelModes)) continue
      for (const channelMode of opChannelModes) {
        if (!isJsonRecord(channelMode)) continue
        const token = readRecordString(channelMode.token ?? channelMode.value ?? channelMode.id ?? channelMode.key ?? channelMode.name)
        if (!token || seenTokens.has(token)) continue
        seenTokens.add(token)
        const entry: { token: string; label?: string; description?: string } = { token }
        const label = readTokenLabel(channelMode, token)
        const description = readRecordString(channelMode.description ?? channelMode.desc ?? channelMode.help)
        if (label) entry.label = label
        if (description) entry.description = description
        allChannelModes.push(entry)
      }
    }
    channels = allChannelModes.length > 0 ? allChannelModes : null
  } else {
    // Fall back to legacy structure
    channels = parseCapabilityGroup(
      readCapabilityGroup(root, ["channels", "channel"])
    )
  }

  const stopConditions = parseCapabilityGroup(
    readCapabilityGroup(root, ["stop_options", "stopOptions", "stopConditions", "stop_conditions", "stops", "stop"])
  )
  const filters = parseCapabilityGroup(
    readCapabilityGroup(root, ["filters", "filter"])
  )

  // New dsview-cli reports threshold as a voltage range for --threshold-volts.
  let thresholds: DeviceOptionsCapabilities["thresholds"] | null = null
  const thresholdObj = readCapabilityGroup(root, ["threshold"])
  if (isJsonRecord(thresholdObj)) {
    const currentVoltsRaw = thresholdObj.current_volts ?? thresholdObj.currentVolts
    const currentVolts = typeof currentVoltsRaw === "number" && Number.isFinite(currentVoltsRaw)
      ? currentVoltsRaw
      : null
    if (currentVolts !== null) {
      thresholds = [{ token: String(currentVolts), label: `${currentVolts}V` }]
    }
  } else {
    // Fall back to legacy structure (thresholds as array).
    thresholds = parseCapabilityGroup(
      readCapabilityGroup(root, ["thresholds"])
    )
  }

  if (!operations || !channels || !stopConditions || !filters || !thresholds) {
    return null
  }

  return {
    operations,
    channels,
    stopConditions,
    filters,
    thresholds
  }
}

const getSupportedTokens = (
  capabilities: DeviceOptionsCapabilities,
  key: keyof LiveCaptureTuning
): readonly string[] => {
  switch (key) {
    case "operation":
      return capabilities.operations.map((entry) => entry.token)
    case "channel":
      return capabilities.channels.map((entry) => entry.token)
    case "stop":
      return capabilities.stopConditions.map((entry) => entry.token)
    case "filter":
      return capabilities.filters.map((entry) => entry.token)
    case "threshold":
      return capabilities.thresholds.map((entry) => entry.token)
  }
}

const isVoltageThresholdToken = (token: string): boolean => {
  const value = Number.parseFloat(token)
  return Number.isFinite(value) && /^\d+(?:\.\d+)?$/.test(token)
}

const validateCaptureTuning = (
  tuning: LiveCaptureTuning | undefined,
  capabilities: DeviceOptionsCapabilities
): { ok: true; args: string[] } | { ok: false; details: readonly string[] } => {
  if (!tuning) {
    return { ok: true, args: [] }
  }

  // Use new dsview-cli flag names
  const argByKey: Record<keyof LiveCaptureTuning, string> = {
    operation: "--operation-mode",
    channel: "--channel-mode",
    stop: "--stop-option",
    filter: "--filter",
    threshold: "--threshold-volts"
  }
  const args: string[] = []
  const details: string[] = []
  const requestedOperation = tuning.operation?.trim().toLowerCase()

  for (const key of ["operation", "channel", "stop", "filter", "threshold"] as const) {
    const token = tuning[key]?.trim()
    if (!token) {
      continue
    }

    // Stream captures are stopped by --duration-ms/--until-interrupt; dsview-cli rejects --stop-option with stream.
    if (requestedOperation === "stream" && key === "stop") {
      continue
    }

    const supportedTokens = getSupportedTokens(capabilities, key)
    const isSupportedThresholdVoltage =
      key === "threshold" && capabilities.thresholds.length > 0 && isVoltageThresholdToken(token)
    if (!supportedTokens.includes(token) && !isSupportedThresholdVoltage) {
      details.push(
        `Unsupported capture tuning ${key} token ${token}. Supported tokens: ${supportedTokens.length > 0 ? supportedTokens.join(", ") : "none reported"}.`
      )
      continue
    }

    args.push(argByKey[key], token)
  }

  return details.length > 0 ? { ok: false, details } : { ok: true, args }
}

const parseDsviewCaptureResult = (output: string): ParsedDsviewCaptureResult | null => {
  const payloadText = extractJsonObject(output)
  if (!payloadText) {
    return null
  }

  const payload = JSON.parse(payloadText) as unknown
  if (!isJsonRecord(payload)) {
    return null
  }

  const artifacts = isJsonRecord(payload.artifacts) ? payload.artifacts : null

  return {
    selectedHandle: readRecordNumber(payload.selected_handle ?? payload.selectedHandle),
    completion: readRecordString(payload.completion),
    artifacts: {
      vcdPath: readRecordString(artifacts?.vcd_path ?? artifacts?.vcdPath),
      metadataPath: readRecordString(artifacts?.metadata_path ?? artifacts?.metadataPath)
    }
  }
}

const parseCaptureMetadata = (input: string): DsviewCaptureMetadata => {
  const payload = JSON.parse(input) as unknown
  if (!isJsonRecord(payload)) {
    return {
      toolVersion: null,
      capturedAt: null,
      sampleRateHz: null,
      totalSamples: null,
      requestedSampleLimit: null
    }
  }

  const tool = isJsonRecord(payload.tool) ? payload.tool : null
  const capture = isJsonRecord(payload.capture) ? payload.capture : null

  return {
    toolVersion: readRecordString(tool?.version),
    capturedAt: readRecordString(capture?.timestamp_utc ?? capture?.timestampUtc),
    sampleRateHz: readRecordNumber(capture?.sample_rate_hz ?? capture?.sampleRateHz),
    totalSamples: readRecordNumber(capture?.actual_sample_count ?? capture?.actualSampleCount),
    requestedSampleLimit: readRecordNumber(
      capture?.requested_sample_limit ?? capture?.requestedSampleLimit
    )
  }
}

const readPrimitiveDecoderValue = (value: unknown): DecoderOptionValue | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }
  if (typeof value === "boolean") {
    return value
  }
  if (typeof value !== "string") {
    return null
  }

  const trimmed = value.trim()
  const intMatch = trimmed.match(/^int(?:32|64)?\s+(-?\d+)$/i)
  if (intMatch?.[1]) {
    return Number.parseInt(intMatch[1], 10)
  }
  const floatMatch = trimmed.match(/^float(?:32|64)?\s+(-?\d+(?:\.\d+)?)$/i)
  if (floatMatch?.[1]) {
    return Number.parseFloat(floatMatch[1])
  }
  const quotedMatch = trimmed.match(/^['\"](.*)['\"]$/)
  if (quotedMatch?.[1] !== undefined) {
    return quotedMatch[1]
  }
  const numeric = Number(trimmed)
  if (Number.isFinite(numeric) && /^-?\d+(?:\.\d+)?$/.test(trimmed)) {
    return numeric
  }

  return trimmed.length > 0 ? trimmed : null
}

const inferDecoderValueType = (
  defaultValue: unknown,
  values: readonly DecoderOptionValue[]
): "string" | "number" | "boolean" | undefined => {
  const parsedDefault = readPrimitiveDecoderValue(defaultValue)
  const sample = parsedDefault ?? values[0]
  if (typeof sample === "number") return "number"
  if (typeof sample === "boolean") return "boolean"
  if (typeof sample === "string") return "string"
  return undefined
}

const parseDecoderSummaries = (output: string): ParsedDsviewDecoderSummary[] | null => {
  const payloadText = extractJsonObject(output)
  if (!payloadText) return null
  const payload = JSON.parse(payloadText) as unknown
  if (!isJsonRecord(payload) || !Array.isArray(payload.decoders)) return null

  return payload.decoders.flatMap((entry): ParsedDsviewDecoderSummary[] => {
    if (!isJsonRecord(entry)) return []
    const id = readRecordString(entry.id)
    if (!id) return []
    const label = readRecordString(entry.name ?? entry.longname)
    const description = readRecordString(entry.description)
    return [{ id, ...(label ? { label } : {}), ...(description ? { description } : {}) }]
  })
}

const parseDecoderCapability = (output: string): ParsedDsviewDecoderDetails | null => {
  const payloadText = extractJsonObject(output)
  if (!payloadText) return null
  const payload = JSON.parse(payloadText) as unknown
  const decoder = isJsonRecord(payload) && isJsonRecord(payload.decoder) ? payload.decoder : null
  if (!decoder) return null

  const id = readRecordString(decoder.id)
  if (!id) return null
  const label = readRecordString(decoder.name ?? decoder.longname)
  const description = readRecordString(decoder.description)
  const mapChannel = (entry: unknown): ParsedDsviewDecoderChannel[] => {
    if (!isJsonRecord(entry)) return []
    const token = readRecordString(entry.id)
    if (!token) return []
    const nativeId = readRecordString(entry.idn)
    const channelLabel = readRecordString(entry.name)
    const channelDescription = readRecordString(entry.description)
    return [{ token, ...(nativeId ? { nativeId } : {}), ...(channelLabel ? { label: channelLabel } : {}), ...(channelDescription ? { description: channelDescription } : {}) }]
  }

  const options = Array.isArray(decoder.options)
    ? decoder.options.flatMap((entry): ParsedDsviewDecoderDetails["options"] => {
        if (!isJsonRecord(entry)) return []
        const optionId = readRecordString(entry.id)
        if (!optionId) return []
        const values = Array.isArray(entry.values)
          ? entry.values.flatMap((value): DecoderOptionValue[] => {
              const parsed = readPrimitiveDecoderValue(value)
              return parsed === null ? [] : [parsed]
            })
          : []
        const optionLabel = readRecordString(entry.name ?? entry.description)
        const optionDescription = readRecordString(entry.description)
        const valueType = inferDecoderValueType(entry.default_value ?? entry.defaultValue, values)
        return [{
          id: optionId,
          values,
          ...(optionLabel ? { label: optionLabel } : {}),
          ...(optionDescription ? { description: optionDescription } : {}),
          ...(valueType ? { valueType } : {})
        }]
      })
    : []

  return {
    id,
    ...(label ? { label } : {}),
    ...(description ? { description } : {}),
    requiredChannels: Array.isArray(decoder.required_channels) ? decoder.required_channels.flatMap(mapChannel) : [],
    optionalChannels: Array.isArray(decoder.optional_channels) ? decoder.optional_channels.flatMap(mapChannel) : [],
    options
  }
}

const toDecoderCapability = (
  decoder: ParsedDsviewDecoderSummary | ParsedDsviewDecoderDetails
): DecoderCapability => ({
  decoderId: decoder.id,
  ...(decoder.label ? { label: decoder.label } : {}),
  ...(decoder.description ? { description: decoder.description } : {}),
  requiredChannels: "requiredChannels" in decoder ? decoder.requiredChannels.map((channel) => ({
    id: channel.token,
    ...(channel.label ? { label: channel.label } : {}),
    ...(channel.description ? { description: channel.description } : {})
  })) : [],
  optionalChannels: "optionalChannels" in decoder ? decoder.optionalChannels.map((channel) => ({
    id: channel.token,
    ...(channel.label ? { label: channel.label } : {}),
    ...(channel.description ? { description: channel.description } : {})
  })) : [],
  options: "options" in decoder ? decoder.options : []
})

const createDefaultProbeRuntime = (options: {
  dsviewCliPath: string
  probeTimeoutMs: number
  executeCommand: DslogicNativeCommandRunner
}): NonNullable<CreateDslogicNativeRuntimeOptions["probeRuntime"]> =>
  async (host) => {
    const versionResult = await options.executeCommand(
      options.dsviewCliPath,
      ["--version"],
      {
        timeoutMs: options.probeTimeoutMs,
        maxBufferBytes: DEFAULT_DSLOGIC_RUNTIME_PROBE_MAX_BUFFER_BYTES
      }
    )

    if (!versionResult.ok) {
      switch (versionResult.reason) {
        case "missing":
          return createRuntimeResult(
            host,
            "missing",
            { libraryPath: null, binaryPath: null, version: null },
            "backend-missing-runtime"
          )
        case "timeout":
          return createRuntimeResult(
            host,
            "timeout",
            { libraryPath: null, binaryPath: null, version: null },
            "backend-runtime-timeout"
          )
        default:
          return createRuntimeResult(
            host,
            "failed",
            { libraryPath: null, binaryPath: null, version: null },
            "backend-runtime-failed"
          )
      }
    }

    const parsedVersion = parseDsviewVersionOutput(
      combineCommandOutput(versionResult),
      options.dsviewCliPath
    )
    if (!parsedVersion) {
      return createRuntimeResult(
        host,
        "malformed",
        { libraryPath: null, binaryPath: null, version: null },
        "backend-runtime-malformed-response"
      )
    }

    return {
      runtime: {
        state: "ready",
        libraryPath: parsedVersion.binaryPath,
        binaryPath: parsedVersion.binaryPath,
        version: parsedVersion.version
      },
      devices: [],
      diagnostics: []
    }
  }

const defaultCreateTempDir = async (): Promise<string> =>
  mkdtemp(join(tmpdir(), "dslogic-capture-"))

const defaultRemoveTempDir = async (path: string): Promise<void> => {
  await rm(path, { recursive: true, force: true })
}

const defaultWriteTextFile = async (path: string, content: string): Promise<void> => {
  await writeFile(path, content, "utf8")
}

const resolveChannelIndexes = (
  request: LiveCaptureRequest
): { ok: true; indexes: number[] } | { ok: false; message: string; details: readonly string[] } => {
  const indexes: number[] = []
  const seen = new Set<number>()

  for (const channel of request.session.sampling.channels) {
    const match = channel.channelId.trim().match(/^D(\d+)$/i)
    if (!match?.[1]) {
      return {
        ok: false,
        message: "Live capture request includes channel ids that dsview-cli cannot translate into DSLogic indexes.",
        details: [`Unsupported channel id ${channel.channelId}. Expected identifiers like D0, D1, ..., D15.`]
      }
    }

    const index = Number.parseInt(match[1], 10)
    if (!Number.isFinite(index) || index < 0) {
      return {
        ok: false,
        message: "Live capture request includes invalid DSLogic channel indexes.",
        details: [`Unsupported channel id ${channel.channelId}.`]
      }
    }

    if (!seen.has(index)) {
      seen.add(index)
      indexes.push(index)
    }
  }

  return { ok: true, indexes }
}

const resolveSampleLimit = (request: LiveCaptureRequest): number => {
  const sampleRateHz = request.session.sampling.sampleRateHz
  const captureDurationMs = request.session.sampling.captureDurationMs
  const rawLimit = Math.ceil((sampleRateHz * captureDurationMs) / 1_000)

  return Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 1
}

const isStreamModeCapture = (request: LiveCaptureRequest): boolean => {
  // Check if user explicitly requested stream mode via captureTuning.operation
  const operation = request.captureTuning?.operation?.trim()?.toLowerCase()
  return operation === "stream"
}

const resolveStreamCaptureDurationMs = (request: LiveCaptureRequest): number => {
  const captureDurationMs = request.session.sampling.captureDurationMs
  return Number.isFinite(captureDurationMs) && captureDurationMs > 0 ? captureDurationMs : 1000
}

const selectCaptureHandle = (
  devices: readonly ParsedDsviewListedDevice[],
  request: Pick<LiveCaptureRequest, "session"> | Pick<DeviceOptionsRequest, "session">
): ParsedDsviewListedDevice | null => {
  const requestedDeviceId = request.session.deviceId
  const requestedModel = request.session.device.dslogic?.modelDisplayName ?? null
  const requestedVariant = request.session.device.dslogic?.variant ?? null

  const byStableId = devices.find((device) => device.stableId === requestedDeviceId)
  if (byStableId) {
    return byStableId
  }

  const normalizedRequestedDeviceId = slugifyToken(requestedDeviceId)
  if (normalizedRequestedDeviceId) {
    const bySlug = devices.find((device) =>
      [device.stableId, device.model, device.nativeName]
        .map((value) => slugifyToken(value))
        .some((value) => value === normalizedRequestedDeviceId)
    )
    if (bySlug) {
      return bySlug
    }
  }

  if (requestedModel) {
    const byModel = devices.find((device) =>
      [device.model, device.nativeName].some((value) => value === requestedModel)
    )
    if (byModel) {
      return byModel
    }
  }

  if (requestedVariant === "classic") {
    const classicDevice = devices.find((device) =>
      [device.stableId, device.model, device.nativeName].some(
        (value) => typeof value === "string" && /dslogic\s*plus/i.test(value) && !/v421|pango/i.test(value)
      )
    )
    if (classicDevice) {
      return classicDevice
    }
  }

  return devices.length === 1 ? devices[0] ?? null : null
}

const createRuntimeUnavailableFailure = (
  snapshot: DslogicNativeRuntimeSnapshot,
  details: readonly string[] = []
): DslogicNativeCaptureFailure => {
  const diagnostic = snapshot.diagnostics[0]
  return {
    ok: false,
    kind: "runtime-unavailable",
    phase: "prepare-runtime",
    message:
      diagnostic?.message ??
      `dsview-cli runtime is not available on ${snapshot.host.platform}.`,
    backendVersion: snapshot.runtime.version,
    nativeCode: diagnostic?.code ?? snapshot.runtime.state,
    details
  }
}

const nativeCodeToString = (nativeCode: string | number | null): string | null =>
  typeof nativeCode === "string"
    ? nativeCode
    : nativeCode === null
      ? null
      : String(nativeCode)

const resolveLookupTimeoutMs = (requestedTimeoutMs: number | undefined): number =>
  Math.min(
    requestedTimeoutMs ?? DEFAULT_DSLOGIC_RUNTIME_PROBE_TIMEOUT_MS,
    DEFAULT_DSLOGIC_RUNTIME_PROBE_TIMEOUT_MS
  )

const createOptionsRuntimeUnavailableFailure = (
  snapshot: DslogicNativeRuntimeSnapshot,
  details: readonly string[] = []
): DslogicNativeDeviceOptionsFailure => {
  const diagnostic = snapshot.diagnostics[0]
  return {
    ok: false,
    kind: "runtime-unavailable",
    phase: "prepare-runtime",
    message:
      diagnostic?.message ??
      `dsview-cli runtime is not available on ${snapshot.host.platform}.`,
    backendVersion: snapshot.runtime.version,
    nativeCode: diagnostic?.code ?? snapshot.runtime.state,
    details
  }
}

const inspectOptionsForHandle = async (options: {
  binaryPath: string
  executeCommand: DslogicNativeCommandRunner
  runtimeSnapshot: DslogicNativeRuntimeSnapshot
  handle: number
  timeoutMs: number
}): Promise<DslogicNativeDeviceOptionsResult> => {
  const optionsResult = await options.executeCommand(
    options.binaryPath,
    ["devices", "options", "--format", "json", "--handle", String(options.handle)],
    {
      timeoutMs: options.timeoutMs,
      maxBufferBytes: DEFAULT_DSLOGIC_OPTIONS_MAX_BUFFER_BYTES
    }
  )
  const commandOutput = combineCommandOutput(optionsResult)

  if (!optionsResult.ok) {
    return {
      ok: false,
      kind: optionsResult.reason === "timeout" ? "timeout" : "native-error",
      phase: "inspect-options",
      message:
        optionsResult.reason === "timeout"
          ? "Timed out while inspecting DSLogic device options."
          : "dsview-cli failed while inspecting DSLogic device options.",
      backendVersion: options.runtimeSnapshot.runtime.version,
      timeoutMs: options.timeoutMs,
      nativeCode: nativeCodeToString(optionsResult.nativeCode),
      optionsOutput: commandOutput.length > 0 ? { text: commandOutput } : undefined,
      details: [
        `Resolved handle ${options.handle} before running \`dsview-cli devices options\`.`
      ]
    }
  }

  const capabilities = parseDsviewDeviceOptions(commandOutput)
  if (!capabilities) {
    return {
      ok: false,
      kind: "malformed-output",
      phase: "parse-options",
      message: "dsview-cli device options output did not include parseable capability tokens.",
      backendVersion: options.runtimeSnapshot.runtime.version,
      timeoutMs: options.timeoutMs,
      optionsOutput: commandOutput.length > 0 ? { text: commandOutput } : undefined,
      details: [
        "Expected JSON with operation/channel/stop/filter/threshold capability arrays."
      ]
    }
  }

  return {
    ok: true,
    backendVersion: options.runtimeSnapshot.runtime.version,
    capabilities,
    optionsOutput: commandOutput.length > 0 ? { text: commandOutput } : undefined
  }
}

const summarizeDecodeStream = (
  value: DslogicNativeCaptureStreamValue | undefined
): NonNullable<DecoderCapabilitiesFailure["diagnostics"]["decoderOutput"]> | null => {
  if (!value) return null
  const text = typeof value.text === "string"
    ? value.text
    : value.bytes instanceof Uint8Array
      ? new TextDecoder().decode(value.bytes)
      : null
  const byteLength = value.bytes instanceof Uint8Array
    ? value.bytes.byteLength
    : typeof value.text === "string"
      ? new TextEncoder().encode(value.text).byteLength
      : 0
  return {
    kind: typeof value.text === "string" ? "text" : value.bytes instanceof Uint8Array ? "bytes" : "empty",
    byteLength,
    textLength: text === null ? null : text.length,
    preview: text === null ? null : text.slice(0, 160),
    truncated: text !== null && text.length > 160
  }
}

const createDecoderRuntimeUnavailableFailure = (
  request: DecoderCapabilitiesRequest,
  snapshot: DslogicNativeRuntimeSnapshot,
  details: readonly string[] = []
): DecoderCapabilitiesFailure => ({
  ok: false,
  reason: "decoder-capabilities-failed",
  kind: "runtime-unavailable",
  message: `dsview-cli runtime is not available for decoder discovery on ${snapshot.host.platform}.`,
  deviceId: request.deviceId,
  requestedAt: request.requestedAt,
  decoders: null,
  diagnostics: {
    phase: "prepare-runtime",
    providerKind: DSLOGIC_NATIVE_BACKEND_KIND === "dsview-cli" ? "dslogic" : null,
    backendKind: DSLOGIC_NATIVE_BACKEND_KIND,
    backendVersion: snapshot.runtime.version,
    timeoutMs: request.timeoutMs ?? null,
    nativeCode: snapshot.runtime.state,
    decoderOutput: null,
    diagnosticOutput: null,
    details,
    diagnostics: []
  }
})

export const createDefaultDslogicNativeDecoderCapabilitiesBackend = (
  options: CreateDslogicNativeDecoderOptions = {}
): DslogicNativeDecoderCapabilitiesBackend => {
  const executeCommand = options.executeCommand ?? defaultExecuteCommand
  const runtime = options.runtime ?? createDslogicNativeRuntime(options)

  return {
    async listDecoderCapabilities(request): Promise<DecoderCapabilitiesResult> {
      const runtimeSnapshot = await runtime.probe()
      if (runtimeSnapshot.runtime.state !== "ready") {
        return createDecoderRuntimeUnavailableFailure(request, runtimeSnapshot, [
          runtimeSnapshot.runtime.binaryPath
            ? `Resolved runtime path ${runtimeSnapshot.runtime.binaryPath} is not ready for decoder discovery.`
            : "dsview-cli binary path could not be resolved."
        ])
      }

      const binaryPath = runtimeSnapshot.runtime.binaryPath ?? runtimeSnapshot.runtime.libraryPath ?? DEFAULT_DSVIEW_CLI_PATH
      const timeoutMs = request.timeoutMs ?? DEFAULT_DSLOGIC_RUNTIME_PROBE_TIMEOUT_MS
      const listResult = await executeCommand(binaryPath, ["decode", "list", "--format", "json"], {
        timeoutMs,
        maxBufferBytes: DEFAULT_DSLOGIC_DECODE_MAX_BUFFER_BYTES
      })
      const listOutput = combineCommandOutput(listResult)
      if (!listResult.ok) {
        return {
          ok: false,
          reason: "decoder-capabilities-failed",
          kind: listResult.reason === "timeout" ? "timeout" : "native-error",
          message: listResult.reason === "timeout" ? "Timed out while listing dsview-cli decoders." : "dsview-cli failed while listing decoders.",
          deviceId: request.deviceId,
          requestedAt: request.requestedAt,
          decoders: null,
          diagnostics: {
            phase: "list-decoders",
            providerKind: "dslogic",
            backendKind: DSLOGIC_NATIVE_BACKEND_KIND,
            backendVersion: runtimeSnapshot.runtime.version,
            timeoutMs,
            nativeCode: nativeCodeToString(listResult.nativeCode),
            decoderOutput: summarizeDecodeStream(listOutput.length > 0 ? { text: listOutput } : undefined),
            diagnosticOutput: null,
            details: ["Ran `dsview-cli decode list --format json`."],
            diagnostics: []
          }
        }
      }

      const summaries = parseDecoderSummaries(listOutput)
      if (!summaries) {
        return {
          ok: false,
          reason: "decoder-capabilities-failed",
          kind: "malformed-output",
          message: "dsview-cli decode list output did not include a parseable decoder array.",
          deviceId: request.deviceId,
          requestedAt: request.requestedAt,
          decoders: null,
          diagnostics: {
            phase: "parse-decoders",
            providerKind: "dslogic",
            backendKind: DSLOGIC_NATIVE_BACKEND_KIND,
            backendVersion: runtimeSnapshot.runtime.version,
            timeoutMs,
            nativeCode: null,
            decoderOutput: summarizeDecodeStream(listOutput.length > 0 ? { text: listOutput } : undefined),
            diagnosticOutput: null,
            details: ["Expected JSON payload with a `decoders` array."],
            diagnostics: []
          }
        }
      }

      const capabilities = summaries.map(toDecoderCapability)
      const uartIndex = summaries.findIndex((decoder) => decoder.id === "1:uart" || decoder.id === "uart")
      if (uartIndex >= 0) {
        const inspectResult = await executeCommand(binaryPath, ["decode", "inspect", "--format", "json", summaries[uartIndex]!.id], {
          timeoutMs,
          maxBufferBytes: DEFAULT_DSLOGIC_DECODE_MAX_BUFFER_BYTES
        })
        const inspectOutput = combineCommandOutput(inspectResult)
        if (inspectResult.ok) {
          const details = parseDecoderCapability(inspectOutput)
          if (details) {
            capabilities[uartIndex] = toDecoderCapability(details)
          }
        }
      }

      return {
        ok: true,
        providerKind: "dslogic",
        backendKind: DSLOGIC_NATIVE_BACKEND_KIND,
        backendVersion: runtimeSnapshot.runtime.version,
        deviceId: request.deviceId,
        requestedAt: request.requestedAt,
        decoders: capabilities
      }
    }
  }
}

const createCaptureDecodeFailure = (
  request: CaptureDecodeRequest,
  kind: CaptureDecodeFailure["kind"],
  phase: CaptureDecodeFailure["diagnostics"]["phase"],
  message: string,
  details: readonly string[],
  overrides: Partial<CaptureDecodeFailure["diagnostics"]> & Pick<Partial<CaptureDecodeFailure>, "artifactSummary" | "decode"> = {}
): CaptureDecodeFailure => ({
  ok: false,
  reason: "capture-decode-failed",
  kind,
  message,
  session: request.session,
  requestedAt: request.requestedAt,
  artifactSummary: overrides.artifactSummary ?? null,
  decode: overrides.decode ?? null,
  diagnostics: {
    phase,
    providerKind: "dslogic",
    backendKind: DSLOGIC_NATIVE_BACKEND_KIND,
    backendVersion: overrides.backendVersion ?? null,
    timeoutMs: overrides.timeoutMs ?? request.timeoutMs ?? null,
    nativeCode: overrides.nativeCode ?? null,
    captureOutput: overrides.captureOutput ?? null,
    decoderOutput: overrides.decoderOutput ?? null,
    diagnosticOutput: overrides.diagnosticOutput ?? null,
    details,
    diagnostics: overrides.diagnostics ?? request.session.device.diagnostics ?? []
  }
})

const parseChannelIndex = (channelId: string): number | null => {
  const match = channelId.trim().match(/^D(\d+)$/i)
  if (!match?.[1]) return null
  const parsed = Number.parseInt(match[1], 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

const buildDecodeConfig = (request: CaptureDecodeRequest): Record<string, unknown> | null => {
  const channels: Record<string, number> = {}
  for (const [role, channelId] of Object.entries(request.decode.channelMappings)) {
    const index = parseChannelIndex(channelId)
    if (index === null) return null
    channels[role] = index
  }
  const options: Record<string, string | number> = {}
  for (const [key, value] of Object.entries(request.decode.decoderOptions ?? {})) {
    options[key] = typeof value === "boolean" ? (value ? "true" : "false") : value
  }
  return {
    version: 1,
    decoder: {
      id: request.decode.decoderId,
      channels,
      options
    },
    stack: []
  }
}

const timescaleToNs = (value: string): number | null => {
  const match = value.trim().match(/^(1|10|100)\s*(s|ms|us|ns|ps|fs)$/i)
  if (!match?.[1] || !match?.[2]) return null
  const multiplier = Number.parseInt(match[1], 10)
  const unit = match[2].toLowerCase()
  const factor = unit === "s" ? 1_000_000_000 : unit === "ms" ? 1_000_000 : unit === "us" ? 1_000 : unit === "ns" ? 1 : unit === "ps" ? 0.001 : 0.000001
  return multiplier * factor
}

const fillCrossLogicHighInterval = (
  bytes: Uint8Array,
  view: DataView,
  channelIndex: number,
  channelCount: number,
  fromSample: number,
  toSample: number
): void => {
  if (toSample <= fromSample) return
  const startBlock = Math.floor(fromSample / 64)
  const endBlock = Math.floor((toSample - 1) / 64)
  for (let block = startBlock; block <= endBlock; block += 1) {
    const blockStart = block * 64
    const bitStart = Math.max(fromSample - blockStart, 0)
    const bitEnd = Math.min(toSample - blockStart, 64)
    if (bitEnd <= bitStart) continue
    const width = bitEnd - bitStart
    const mask = ((1n << BigInt(width)) - 1n) << BigInt(bitStart)
    const offset = (block * channelCount + channelIndex) * 8
    view.setBigUint64(offset, view.getBigUint64(offset, true) | mask, true)
  }
  void bytes
}

const buildOfflineDecodeInput = (
  request: CaptureDecodeRequest,
  artifact: LiveCaptureArtifact
): { ok: true; input: Record<string, unknown> } | { ok: false; message: string; details: string[] } => {
  const text = artifact.text
  if (typeof text !== "string" || text.length === 0) {
    return { ok: false, message: "Captured artifact does not contain VCD text for decode.", details: ["captureDecode currently requires a text VCD artifact from liveCapture."] }
  }
  const sampleRateHz = artifact.sampling?.sampleRateHz ?? request.session.sampling.sampleRateHz
  const totalSamples = artifact.sampling?.totalSamples ?? artifact.sampling?.requestedSampleLimit ?? resolveSampleLimit(request)
  if (!Number.isFinite(sampleRateHz) || sampleRateHz <= 0 || !Number.isFinite(totalSamples) || totalSamples <= 0) {
    return { ok: false, message: "Captured artifact is missing usable sampling metadata.", details: ["Expected sampleRateHz and totalSamples/requestedSampleLimit on the VCD artifact."] }
  }

  let timescaleNs: number | null = null
  let inDefinitions = true
  let currentTimeNs = 0
  const symbolToChannel = new Map<string, number>()
  const events: Array<{ sampleIndex: number; channelIndex: number; level: 0 | 1 }> = []
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line.length === 0) continue
    if (inDefinitions) {
      if (line.startsWith("$timescale")) {
        const inline = line.replace(/^\$timescale\s*/i, "").replace(/\s*\$end$/i, "").trim()
        timescaleNs = timescaleToNs(inline)
      }
      const varMatch = line.match(/^\$var\s+\S+\s+1\s+(\S+)\s+(.+?)\s+\$end$/)
      if (varMatch?.[1] && varMatch?.[2]) {
        const channelIndex = parseChannelIndex(varMatch[2])
        if (channelIndex !== null) symbolToChannel.set(varMatch[1], channelIndex)
      }
      if (line === "$enddefinitions $end") inDefinitions = false
      continue
    }
    if (line.startsWith("#")) {
      const timeMatch = line.match(/^#(\d+)\s*(.*)$/)
      const ticks = Number.parseInt(timeMatch?.[1] ?? "", 10)
      if (Number.isFinite(ticks) && timescaleNs !== null) currentTimeNs = ticks * timescaleNs
      const inlineValue = timeMatch?.[2]?.trim()
      if (!inlineValue) continue
      const valueMatch = inlineValue.match(/^([01])(.+)$/)
      if (!valueMatch?.[1] || !valueMatch?.[2]) continue
      const channelIndex = symbolToChannel.get(valueMatch[2].trim())
      if (channelIndex === undefined) continue
      const sampleIndex = Math.max(0, Math.min(totalSamples - 1, Math.round(currentTimeNs / (1_000_000_000 / sampleRateHz))))
      events.push({ sampleIndex, channelIndex, level: valueMatch[1] === "1" ? 1 : 0 })
      continue
    }
    const valueMatch = line.match(/^([01])(.+)$/)
    if (!valueMatch?.[1] || !valueMatch?.[2]) continue
    const channelIndex = symbolToChannel.get(valueMatch[2].trim())
    if (channelIndex === undefined) continue
    const sampleIndex = Math.max(0, Math.min(totalSamples - 1, Math.round(currentTimeNs / (1_000_000_000 / sampleRateHz))))
    events.push({ sampleIndex, channelIndex, level: valueMatch[1] === "1" ? 1 : 0 })
  }
  if (timescaleNs === null || symbolToChannel.size === 0) {
    return { ok: false, message: "Captured VCD could not be converted for offline decode.", details: ["Expected $timescale and single-bit $var declarations in VCD text."] }
  }

  const maxChannelIndex = Math.max(...Array.from(symbolToChannel.values()), 0)
  const channelCount = maxChannelIndex + 1
  const blockCount = Math.ceil(totalSamples / 64)
  const byteLength = blockCount * channelCount * 8
  if (byteLength > DEFAULT_DSLOGIC_DECODE_INPUT_MAX_BYTES) {
    return {
      ok: false,
      message: "Captured sample window is too large to convert into dsview-cli offline decode input safely.",
      details: [
        `Cross-logic input would require ${byteLength} bytes before JSON encoding; safety limit is ${DEFAULT_DSLOGIC_DECODE_INPUT_MAX_BYTES}.`,
        "Use fewer channels, a shorter capture duration, or stream decode in chunks."
      ]
    }
  }

  const bytes = new Uint8Array(byteLength)
  const view = new DataView(bytes.buffer)
  const highChannels = new Set<number>()
  let cursor = 0
  const sortedEvents = events.sort((left, right) => left.sampleIndex - right.sampleIndex || left.channelIndex - right.channelIndex)
  let eventIndex = 0
  const fillHighChannels = (toSample: number) => {
    if (toSample <= cursor) return
    for (const channelIndex of highChannels) {
      fillCrossLogicHighInterval(bytes, view, channelIndex, channelCount, cursor, toSample)
    }
    cursor = toSample
  }
  while (eventIndex < sortedEvents.length) {
    const sampleIndex = sortedEvents[eventIndex]!.sampleIndex
    fillHighChannels(sampleIndex)
    while (eventIndex < sortedEvents.length && sortedEvents[eventIndex]!.sampleIndex === sampleIndex) {
      const event = sortedEvents[eventIndex]!
      if (event.level === 1) highChannels.add(event.channelIndex)
      else highChannels.delete(event.channelIndex)
      eventIndex += 1
    }
  }
  fillHighChannels(totalSamples)

  return {
    ok: true,
    input: {
      samplerate_hz: sampleRateHz,
      format: "cross_logic",
      sample_bytes: Array.from(bytes),
      unitsize: 1,
      channel_count: channelCount
    }
  }
}

const serializeDecodeConfig = (config: Record<string, unknown>): string =>
  JSON.stringify(config).replace(/("num_stop_bits":)(-?\d+)([},])/g, "$1$2.0$3")

const bytesToLatin1Text = (bytes: readonly number[]): string => {
  let text = ""
  const chunkSize = 8192
  for (let index = 0; index < bytes.length; index += chunkSize) {
    text += String.fromCharCode(...bytes.slice(index, index + chunkSize))
  }
  return text
}

const readDecodedByte = (annotation: Record<string, unknown>): number | null => {
  const numericValue = annotation.numeric_value ?? annotation.numericValue ?? annotation.byte
  if (typeof numericValue === "number" && Number.isInteger(numericValue) && numericValue >= 0 && numericValue <= 255) {
    return numericValue
  }

  const texts = annotation.texts
  if (Array.isArray(texts) && typeof texts[0] === "string" && texts[0].length === 1) {
    const byte = texts[0].charCodeAt(0)
    return byte <= 255 ? byte : null
  }

  const text = annotation.text
  if (typeof text === "string" && text.length === 1) {
    const byte = text.charCodeAt(0)
    return byte <= 255 ? byte : null
  }

  return null
}

const isDecodedDataAnnotation = (annotation: Record<string, unknown>): boolean =>
  annotation.numeric_value !== undefined
  || annotation.numericValue !== undefined
  || annotation.byte !== undefined
  || annotation.type === "data"
  || annotation.annotation_class === 0

const extractRawDecodeBytes = (annotations: readonly Record<string, unknown>[]): number[] => {
  const bytes: number[] = []
  for (const annotation of annotations) {
    if (!isDecodedDataAnnotation(annotation)) continue
    const byte = readDecodedByte(annotation)
    if (byte !== null) bytes.push(byte)
  }
  return bytes
}

const parseDecodeReport = (decoderId: string, output: string): CaptureDecodeReport | null => {
  const payloadText = extractJsonObject(output)
  if (!payloadText) return null
  let payload: unknown
  try {
    payload = JSON.parse(payloadText) as unknown
  } catch {
    return null
  }
  if (!isJsonRecord(payload)) return null
  const report = isJsonRecord(payload.report) ? payload.report : payload
  const annotations = Array.isArray(report.annotations)
    ? report.annotations.filter(isJsonRecord)
    : Array.isArray(report.events)
      ? report.events.filter(isJsonRecord)
      : []
  const rows = Array.isArray(report.rows)
    ? report.rows.filter(isJsonRecord)
    : Array.isArray(report.annotation_rows)
      ? report.annotation_rows.filter(isJsonRecord)
      : annotations.length > 0
        ? [{ id: "events", label: "Decoder events" }]
        : []
  const rawBytes = extractRawDecodeBytes(annotations)
  return {
    decoderId,
    annotations,
    rows,
    raw: {
      ...payload,
      text: bytesToLatin1Text(rawBytes),
      bytes: rawBytes
    }
  }
}

export const createDefaultDslogicNativeCaptureDecodeBackend = (
  options: CreateDslogicNativeDecoderOptions = {}
): DslogicNativeCaptureDecodeBackend => {
  const executeCommand = options.executeCommand ?? defaultExecuteCommand
  const runtime = options.runtime ?? createDslogicNativeRuntime(options)
  const readTextFile = options.readTextFile ?? ((path: string) => readFile(path, "utf8"))
  const writeTextFile = options.writeTextFile ?? defaultWriteTextFile
  const createTempDir = options.createTempDir ?? defaultCreateTempDir
  const removeTempDir = options.removeTempDir ?? defaultRemoveTempDir

  return {
    async captureDecode(request): Promise<CaptureDecodeResult> {
      const runtimeSnapshot = await runtime.probe()
      if (runtimeSnapshot.runtime.state !== "ready") {
        return createCaptureDecodeFailure(request, "runtime-unavailable", "prepare-runtime", "dsview-cli runtime is not available for capture-decode.", ["Runtime probe did not report ready."], { backendVersion: runtimeSnapshot.runtime.version })
      }
      const liveCapture = createDefaultDslogicNativeLiveCaptureBackend({ ...options, runtime, executeCommand, readTextFile, createTempDir, removeTempDir })
      const captureResult = await liveCapture.capture(request)
      if (!captureResult.ok) {
        return createCaptureDecodeFailure(request, captureResult.kind === "timeout" ? "timeout" : "capture-failed", "capture", captureResult.message, captureResult.details ?? [], {
          backendVersion: captureResult.backendVersion ?? runtimeSnapshot.runtime.version,
          timeoutMs: captureResult.timeoutMs,
          nativeCode: captureResult.nativeCode ?? null,
          captureOutput: summarizeDecodeStream(captureResult.captureOutput) as CaptureDecodeFailure["diagnostics"]["captureOutput"],
          diagnosticOutput: summarizeDecodeStream(captureResult.diagnosticOutput)
        })
      }

      const binaryPath = runtimeSnapshot.runtime.binaryPath ?? runtimeSnapshot.runtime.libraryPath ?? DEFAULT_DSVIEW_CLI_PATH
      const timeoutMs = request.timeoutMs ?? DEFAULT_DSLOGIC_CAPTURE_TIMEOUT_MS
      const inspectResult = await executeCommand(binaryPath, ["decode", "inspect", "--format", "json", request.decode.decoderId], { timeoutMs, maxBufferBytes: DEFAULT_DSLOGIC_DECODE_MAX_BUFFER_BYTES })
      const inspectOutput = combineCommandOutput(inspectResult)
      if (!inspectResult.ok) {
        return createCaptureDecodeFailure(request, inspectResult.reason === "timeout" ? "timeout" : "decode-failed", "decode-validation", "dsview-cli failed while inspecting requested decoder.", ["Ran `dsview-cli decode inspect` before decode run."], {
          backendVersion: runtimeSnapshot.runtime.version,
          nativeCode: nativeCodeToString(inspectResult.nativeCode),
          decoderOutput: summarizeDecodeStream(inspectOutput.length > 0 ? { text: inspectOutput } : undefined)
        })
      }
      const decoder = parseDecoderCapability(inspectOutput)
      if (!decoder) {
        return createCaptureDecodeFailure(request, "malformed-output", "decode-validation", "dsview-cli decode inspect output was malformed.", [`Decoder ${request.decode.decoderId} did not return parseable metadata.`], {
          backendVersion: runtimeSnapshot.runtime.version,
          decoderOutput: summarizeDecodeStream(inspectOutput.length > 0 ? { text: inspectOutput } : undefined)
        })
      }
      const config = buildDecodeConfig(request)
      const missingRequiredChannels = decoder.requiredChannels
        .map((channel) => channel.token)
        .filter((channelId) => request.decode.channelMappings[channelId] === undefined)
      if (missingRequiredChannels.length > 0) {
        return createCaptureDecodeFailure(request, "decode-failed", "decode-validation", "Decode request is missing required decoder channel mappings.", missingRequiredChannels.map((channelId) => `Missing mapping for ${channelId}.`), {
          backendVersion: runtimeSnapshot.runtime.version,
          artifactSummary: summarizeLiveCaptureArtifact(captureResult.artifact)
        })
      }

      if (!config) {
        return createCaptureDecodeFailure(request, "decode-failed", "decode-validation", "Decode channel mappings must target DSLogic D* channel ids.", Object.entries(request.decode.channelMappings).map(([role, channel]) => `${role} -> ${channel}`), {
          backendVersion: runtimeSnapshot.runtime.version,
          artifactSummary: summarizeLiveCaptureArtifact(captureResult.artifact)
        })
      }
      const offlineInput = buildOfflineDecodeInput(request, captureResult.artifact)
      if (!offlineInput.ok) {
        return createCaptureDecodeFailure(request, "decode-failed", "decode-validation", offlineInput.message, offlineInput.details, {
          backendVersion: runtimeSnapshot.runtime.version,
          artifactSummary: summarizeLiveCaptureArtifact(captureResult.artifact)
        })
      }

      const tempDir = await createTempDir()
      const configPath = join(tempDir, "decode-config.json")
      const inputPath = join(tempDir, "decode-input.json")
      const outputPath = join(tempDir, "decode-report.json")
      try {
        await writeTextFile(configPath, serializeDecodeConfig(config))
        await writeTextFile(inputPath, JSON.stringify(offlineInput.input))
        const decodeResult = await executeCommand(binaryPath, ["decode", "run", "--format", "json", "--config", configPath, "--input", inputPath, "--output", outputPath], { timeoutMs, maxBufferBytes: DEFAULT_DSLOGIC_DECODE_RUN_MAX_BUFFER_BYTES })
        const decodeOutput = combineCommandOutput(decodeResult)
        const outputFileText = await readTextFile(outputPath).catch(() => "")
        const report = parseDecodeReport(request.decode.decoderId, outputFileText || decodeOutput)
        if (!decodeResult.ok && !report) {
          return createCaptureDecodeFailure(request, decodeResult.reason === "timeout" ? "timeout" : "decode-failed", "decode-run", "dsview-cli decode run failed.", ["Ran `dsview-cli decode run --config --input`."], {
            backendVersion: runtimeSnapshot.runtime.version,
            nativeCode: nativeCodeToString(decodeResult.nativeCode),
            artifactSummary: summarizeLiveCaptureArtifact(captureResult.artifact),
            decoderOutput: summarizeDecodeStream(decodeOutput.length > 0 ? { text: decodeOutput } : undefined)
          })
        }
        if (!report) {
          return createCaptureDecodeFailure(request, "malformed-output", "decode-run", "dsview-cli decode run did not return a parseable report.", ["Expected JSON report with annotations or rows."], {
            backendVersion: runtimeSnapshot.runtime.version,
            artifactSummary: summarizeLiveCaptureArtifact(captureResult.artifact),
            decoderOutput: summarizeDecodeStream((outputFileText || decodeOutput).length > 0 ? { text: outputFileText || decodeOutput } : undefined)
          })
        }
        return {
          ok: true,
          providerKind: "dslogic",
          backendKind: DSLOGIC_NATIVE_BACKEND_KIND,
          session: request.session,
          requestedAt: request.requestedAt,
          artifactSummary: summarizeLiveCaptureArtifact(captureResult.artifact),
          auxiliaryArtifactSummaries: captureResult.auxiliaryArtifacts?.map(summarizeLiveCaptureArtifact),
          decode: report
        }
      } finally {
        await removeTempDir(tempDir)
      }
    }
  }
}

export const createDslogicNativeRuntime = (
  options: CreateDslogicNativeRuntimeOptions = {}
): DslogicNativeRuntime => {
  const now = options.now ?? (() => new Date().toISOString())
  const getHostOs = options.getHostOs ?? (() => process.platform)
  const getHostArch = options.getHostArch ?? (() => process.arch)
  const configuredBinaryPath = options.dsviewCliPath?.trim()
  const probeRuntime = options.probeRuntime ?? createDefaultProbeRuntime({
    dsviewCliPath:
      configuredBinaryPath && configuredBinaryPath.length > 0
        ? configuredBinaryPath
        : DEFAULT_DSVIEW_CLI_PATH,
    probeTimeoutMs: options.probeTimeoutMs ?? DEFAULT_DSLOGIC_RUNTIME_PROBE_TIMEOUT_MS,
    executeCommand: options.executeCommand ?? defaultExecuteCommand
  })

  return {
    async probe(): Promise<DslogicNativeRuntimeSnapshot> {
      const checkedAt = now()
      const os = getHostOs()
      const host: DslogicNativeHostMetadata = {
        platform: resolveInventoryPlatform(os),
        os,
        arch: getHostArch()
      }

      if (!SUPPORTED_HOST_OPERATING_SYSTEMS.has(os)) {
        return createUnsupportedSnapshot(checkedAt, host)
      }

      if (!DSLOGIC_SUPPORTED_HOST_PLATFORMS.includes(host.platform)) {
        return createUnsupportedSnapshot(checkedAt, host)
      }

      return {
        checkedAt,
        host,
        ...cloneProbeResult(await probeRuntime(host))
      }
    }
  }
}

export const createDefaultDslogicNativeDeviceOptionsBackend = (
  options: CreateDslogicNativeDeviceOptionsOptions = {}
): DslogicNativeDeviceOptionsBackend => {
  const executeCommand = options.executeCommand ?? defaultExecuteCommand
  const runtime = options.runtime ?? createDslogicNativeRuntime(options)

  return createDslogicNativeDeviceOptionsBackend(
    async (request): Promise<DslogicNativeDeviceOptionsResult> => {
      const runtimeSnapshot = await runtime.probe()
      if (runtimeSnapshot.runtime.state !== "ready") {
        const details = runtimeSnapshot.runtime.binaryPath
          ? [`Resolved runtime path ${runtimeSnapshot.runtime.binaryPath} is not ready for device options.`]
          : ["dsview-cli binary path could not be resolved."]
        return createOptionsRuntimeUnavailableFailure(runtimeSnapshot, details)
      }

      const binaryPath = runtimeSnapshot.runtime.binaryPath ?? runtimeSnapshot.runtime.libraryPath ?? DEFAULT_DSVIEW_CLI_PATH
      const timeoutMs = resolveLookupTimeoutMs(request.timeoutMs)
      const deviceListResult = await executeCommand(
        binaryPath,
        ["devices", "list", "--format", "json"],
        {
          timeoutMs,
          maxBufferBytes: DEFAULT_DSLOGIC_CAPTURE_MAX_BUFFER_BYTES
        }
      )
      const deviceListOutput = combineCommandOutput(deviceListResult)

      if (!deviceListResult.ok) {
        return {
          ok: false,
          kind: deviceListResult.reason === "timeout" ? "timeout" : "native-error",
          phase: "list-handles",
          message:
            deviceListResult.reason === "timeout"
              ? "Timed out while resolving the DSLogic device handle for options lookup."
              : `Unable to enumerate DSLogic handles through ${binaryPath}.`,
          backendVersion: runtimeSnapshot.runtime.version,
          timeoutMs,
          nativeCode: nativeCodeToString(deviceListResult.nativeCode),
          diagnosticOutput: deviceListOutput.length > 0 ? { text: deviceListOutput } : undefined,
          details: [
            "The runtime probe succeeded, but `dsview-cli devices list` could not produce a handle map for options lookup."
          ]
        }
      }

      const listedDevices = parseDsviewListedDevices(deviceListOutput)
      const selectedDevice = selectCaptureHandle(listedDevices, request)
      if (!selectedDevice) {
        return {
          ok: false,
          kind: "native-error",
          phase: "list-handles",
          message: `Unable to resolve a dsview-cli handle for device ${request.session.deviceId}.`,
          backendVersion: runtimeSnapshot.runtime.version,
          timeoutMs,
          diagnosticOutput: deviceListOutput.length > 0 ? { text: deviceListOutput } : undefined,
          details: [
            `No handle from \`dsview-cli devices list\` matched deviceId ${request.session.deviceId}.`,
            "Device-options lookup requires a fresh runtime handle because dsview-cli does not accept stable ids directly."
          ]
        }
      }

      return inspectOptionsForHandle({
        binaryPath,
        executeCommand,
        runtimeSnapshot,
        handle: selectedDevice.handle,
        timeoutMs
      })
    }
  )
}

export const createDefaultDslogicNativeLiveCaptureBackend = (
  options: CreateDslogicNativeLiveCaptureOptions = {}
): DslogicNativeLiveCaptureBackend => {
  const executeCommand = options.executeCommand ?? defaultExecuteCommand
  const runtime = options.runtime ?? createDslogicNativeRuntime(options)
  const readTextFile = options.readTextFile ?? ((path: string) => readFile(path, "utf8"))
  const createTempDir = options.createTempDir ?? defaultCreateTempDir
  const removeTempDir = options.removeTempDir ?? defaultRemoveTempDir

  return createDslogicNativeLiveCaptureBackend(
    async (request): Promise<DslogicNativeCaptureResult> => {
      const runtimeSnapshot = await runtime.probe()
      if (runtimeSnapshot.runtime.state !== "ready") {
        const details = runtimeSnapshot.runtime.binaryPath
          ? [`Resolved runtime path ${runtimeSnapshot.runtime.binaryPath} is not ready for capture.`]
          : ["dsview-cli binary path could not be resolved."]
        return createRuntimeUnavailableFailure(runtimeSnapshot, details)
      }

      const binaryPath = runtimeSnapshot.runtime.binaryPath ?? runtimeSnapshot.runtime.libraryPath ?? DEFAULT_DSVIEW_CLI_PATH
      const timeoutMs = request.timeoutMs ?? DEFAULT_DSLOGIC_CAPTURE_TIMEOUT_MS
      const channelResolution = resolveChannelIndexes(request)
      if (!channelResolution.ok) {
        return {
          ok: false,
          kind: "capture-failed",
          phase: "prepare-runtime",
          message: channelResolution.message,
          backendVersion: runtimeSnapshot.runtime.version,
          details: channelResolution.details
        }
      }

      const deviceListResult = await executeCommand(
        binaryPath,
        ["devices", "list", "--format", "json"],
        {
          timeoutMs: Math.min(timeoutMs, DEFAULT_DSLOGIC_RUNTIME_PROBE_TIMEOUT_MS),
          maxBufferBytes: DEFAULT_DSLOGIC_CAPTURE_MAX_BUFFER_BYTES
        }
      )

      const deviceListOutput = combineCommandOutput(deviceListResult)
      if (!deviceListResult.ok) {
        return {
          ok: false,
          kind: deviceListResult.reason === "timeout" ? "timeout" : "runtime-unavailable",
          phase: "prepare-runtime",
          message:
            deviceListResult.reason === "timeout"
              ? "Timed out while resolving the DSLogic device handle for capture."
              : `Unable to enumerate DSLogic handles through ${binaryPath}.`,
          backendVersion: runtimeSnapshot.runtime.version,
          timeoutMs,
          nativeCode: nativeCodeToString(deviceListResult.nativeCode),
          diagnosticOutput: deviceListOutput.length > 0 ? { text: deviceListOutput } : undefined,
          details: [
            "The runtime probe succeeded, but `dsview-cli devices list` could not produce a handle map for capture."
          ]
        }
      }

      const listedDevices = parseDsviewListedDevices(deviceListOutput)
      const selectedDevice = selectCaptureHandle(listedDevices, request)
      if (!selectedDevice) {
        return {
          ok: false,
          kind: "capture-failed",
          phase: "prepare-runtime",
          message: `Unable to resolve a dsview-cli handle for device ${request.session.deviceId}.`,
          backendVersion: runtimeSnapshot.runtime.version,
          diagnosticOutput: deviceListOutput.length > 0 ? { text: deviceListOutput } : undefined,
          details: [
            `No handle from \`dsview-cli devices list\` matched deviceId ${request.session.deviceId}.`,
            "Live capture requires a fresh runtime handle because dsview-cli does not accept stable ids directly."
          ]
        }
      }

      let captureTuningArgs: string[] = []
      if (request.captureTuning) {
        const optionsResult = await inspectOptionsForHandle({
          binaryPath,
          executeCommand,
          runtimeSnapshot,
          handle: selectedDevice.handle,
          timeoutMs: resolveLookupTimeoutMs(request.timeoutMs)
        })

        if (!optionsResult.ok) {
          return {
            ok: false,
            kind:
              optionsResult.kind === "timeout"
                ? "timeout"
                : optionsResult.kind === "malformed-output"
                  ? "malformed-output"
                  : "capture-failed",
            phase: "prepare-runtime",
            message: `Unable to validate DSLogic capture tuning: ${optionsResult.message}`,
            backendVersion: optionsResult.backendVersion ?? runtimeSnapshot.runtime.version,
            timeoutMs: optionsResult.timeoutMs,
            nativeCode: optionsResult.nativeCode ?? null,
            diagnosticOutput: optionsResult.optionsOutput ?? optionsResult.diagnosticOutput,
            details: optionsResult.details ?? []
          }
        }

        const tuningValidation = validateCaptureTuning(
          request.captureTuning,
          optionsResult.capabilities
        )
        if (!tuningValidation.ok) {
          return {
            ok: false,
            kind: "capture-failed",
            phase: "prepare-runtime",
            message: "Live capture request includes DSLogic tuning tokens not reported by the native runtime.",
            backendVersion: optionsResult.backendVersion ?? runtimeSnapshot.runtime.version,
            timeoutMs: resolveLookupTimeoutMs(request.timeoutMs),
            diagnosticOutput: optionsResult.optionsOutput,
            details: tuningValidation.details
          }
        }
        captureTuningArgs = tuningValidation.args
      }

      const tempDir = await createTempDir()
      const outputPath = join(tempDir, `${request.session.deviceId}.vcd`)
      const metadataPath = join(tempDir, `${request.session.deviceId}.json`)
      const isStreamMode = isStreamModeCapture(request)

      const sampleLimit = resolveSampleLimit(request)
      const streamDurationMs = isStreamMode ? resolveStreamCaptureDurationMs(request) : null

      // In stream mode, wait timeout should be longer than the capture duration
      // to allow the capture to complete naturally.
      const effectiveWaitTimeoutMs = isStreamMode && streamDurationMs
        ? Math.max(timeoutMs, streamDurationMs + 5000)
        : timeoutMs

      try {
        const captureArgs = [
          "capture",
          ...(options.dsviewResourceDir?.trim()
            ? ["--resource-dir", options.dsviewResourceDir.trim()]
            : []),
          "--format",
          "json",
          "--handle",
          String(selectedDevice.handle),
          "--sample-rate-hz",
          String(request.session.sampling.sampleRateHz),
          "--sample-limit",
          String(sampleLimit),
          ...(isStreamMode && streamDurationMs
            ? ["--duration-ms", String(streamDurationMs)]
            : []),
          "--channels",
          channelResolution.indexes.join(","),
          ...captureTuningArgs,
          "--output",
          outputPath,
          "--metadata-output",
          metadataPath,
          "--wait-timeout-ms",
          String(effectiveWaitTimeoutMs),
          "--poll-interval-ms",
          String(DEFAULT_DSVIEW_CAPTURE_POLL_INTERVAL_MS)
        ]

        const captureResult = await executeCommand(
          binaryPath,
          captureArgs,
          {
            timeoutMs,
            maxBufferBytes: DEFAULT_DSLOGIC_CAPTURE_MAX_BUFFER_BYTES
          }
        )

        const commandOutput = combineCommandOutput(captureResult)
        if (!captureResult.ok) {
          return {
            ok: false,
            kind: captureResult.reason === "timeout" ? "timeout" : "capture-failed",
            phase: "capture",
            message:
              captureResult.reason === "timeout"
                ? "dsview-cli capture timed out."
                : "dsview-cli capture failed.",
            backendVersion: runtimeSnapshot.runtime.version,
            timeoutMs,
            nativeCode: nativeCodeToString(captureResult.nativeCode),
            captureOutput: commandOutput.length > 0 ? { text: commandOutput } : undefined,
            details: [
              `Resolved handle ${selectedDevice.handle} for device ${request.session.deviceId}.`,
              `Requested ${sampleLimit} samples at ${request.session.sampling.sampleRateHz}Hz on channels ${channelResolution.indexes.join(",")}.`
            ]
          }
        }

        const parsedCapture = parseDsviewCaptureResult(commandOutput)
        const resolvedVcdPath = parsedCapture?.artifacts.vcdPath ?? outputPath
        const resolvedMetadataPath = parsedCapture?.artifacts.metadataPath ?? metadataPath

        let artifactText: string
        try {
          artifactText = await readTextFile(resolvedVcdPath)
        } catch (error) {
          return {
            ok: false,
            kind: "malformed-output",
            phase: "collect-artifact",
            message: "dsview-cli capture finished but the VCD artifact could not be read.",
            backendVersion: runtimeSnapshot.runtime.version,
            diagnosticOutput: commandOutput.length > 0 ? { text: commandOutput } : undefined,
            details: [
              `Expected VCD artifact at ${resolvedVcdPath}.`,
              error instanceof Error ? error.message : String(error)
            ]
          }
        }

        let metadataText: string | null = null
        let metadata: DsviewCaptureMetadata = {
          toolVersion: runtimeSnapshot.runtime.version,
          capturedAt: null,
          sampleRateHz: request.session.sampling.sampleRateHz,
          totalSamples: null,
          requestedSampleLimit: sampleLimit
        }
        try {
          metadataText = await readTextFile(resolvedMetadataPath)
          metadata = {
            ...metadata,
            ...parseCaptureMetadata(metadataText)
          }
        } catch {
          // Capture metadata is optional, but when present it lets upstream loaders normalize sparse VCD output truthfully.
        }

        const artifact: LiveCaptureArtifact = {
          sourceName: basename(resolvedVcdPath),
          formatHint: "dsview-vcd",
          mediaType: "text/x-vcd",
          text: artifactText
        }
        if (metadata.capturedAt) {
          artifact.capturedAt = metadata.capturedAt
        }
        artifact.sampling = {
          sampleRateHz: metadata.sampleRateHz ?? request.session.sampling.sampleRateHz,
          requestedSampleLimit: metadata.requestedSampleLimit ?? sampleLimit,
          ...(metadata.totalSamples !== null ? { totalSamples: metadata.totalSamples } : {})
        }

        const auxiliaryArtifacts: LiveCaptureArtifact[] = []
        if (typeof metadataText === "string" && metadataText.length > 0) {
          auxiliaryArtifacts.push({
            sourceName: basename(resolvedMetadataPath),
            formatHint: "dsview-capture-metadata",
            mediaType: "application/json",
            ...(metadata.capturedAt ? { capturedAt: metadata.capturedAt } : {}),
            text: metadataText
          })
        }

        return {
          ok: true,
          backendVersion: metadata.toolVersion ?? runtimeSnapshot.runtime.version,
          diagnosticOutput: commandOutput.length > 0 ? { text: commandOutput } : undefined,
          artifact,
          ...(auxiliaryArtifacts.length > 0 ? { auxiliaryArtifacts } : {})
        }
      } finally {
        await removeTempDir(tempDir)
      }
    }
  )
}

export const createDslogicNativeLiveCaptureBackend = (
  capture: DslogicNativeLiveCaptureBackend["capture"]
): DslogicNativeLiveCaptureBackend => ({ capture })

export const createDslogicNativeDeviceOptionsBackend = (
  inspectDeviceOptions: DslogicNativeDeviceOptionsBackend["inspectDeviceOptions"]
): DslogicNativeDeviceOptionsBackend => ({ inspectDeviceOptions })

export {
  createDefaultProbeRuntime,
  defaultExecuteCommand,
  parseDsviewDeviceOptions,
  parseDsviewListedDevices,
  parseDsviewVersionOutput
}
