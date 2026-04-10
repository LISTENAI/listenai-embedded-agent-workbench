import { execFile } from "node:child_process"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import process from "node:process"
import type {
  InventoryDiagnosticCode,
  InventoryPlatform,
  LiveCaptureArtifact,
  LiveCaptureFailureKind,
  LiveCaptureFailurePhase,
  LiveCaptureRequest
} from "@listenai/contracts"
import type { DslogicProbeDeviceCandidate } from "./backend-probe.js"

export const DSLOGIC_NATIVE_BACKEND_KIND = "dsview-cli" as const
export const DSLOGIC_SUPPORTED_HOST_PLATFORMS = ["linux", "macos", "windows"] as const
export const DEFAULT_DSLOGIC_RUNTIME_PROBE_TIMEOUT_MS = 3_000
const DEFAULT_DSLOGIC_RUNTIME_PROBE_MAX_BUFFER_BYTES = 64 * 1024
const DEFAULT_DSLOGIC_CAPTURE_TIMEOUT_MS = 15_000
const DEFAULT_DSLOGIC_CAPTURE_MAX_BUFFER_BYTES = 512 * 1024
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

export interface CreateDslogicNativeRuntimeOptions {
  now?: () => string
  getHostOs?: () => NodeJS.Platform
  getHostArch?: () => NodeJS.Architecture
  dsviewCliPath?: string
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

const selectCaptureHandle = (
  devices: readonly ParsedDsviewListedDevice[],
  request: LiveCaptureRequest
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
          nativeCode:
            typeof deviceListResult.nativeCode === "string"
              ? deviceListResult.nativeCode
              : deviceListResult.nativeCode === null
                ? null
                : String(deviceListResult.nativeCode),
          diagnosticOutput: {
            text: combineCommandOutput(deviceListResult)
          },
          details: [
            "The runtime probe succeeded, but `dsview-cli devices list` could not produce a handle map for capture."
          ]
        }
      }

      const listedDevices = parseDsviewListedDevices(combineCommandOutput(deviceListResult))
      const selectedDevice = selectCaptureHandle(listedDevices, request)
      if (!selectedDevice) {
        return {
          ok: false,
          kind: "capture-failed",
          phase: "prepare-runtime",
          message: `Unable to resolve a dsview-cli handle for device ${request.session.deviceId}.`,
          backendVersion: runtimeSnapshot.runtime.version,
          diagnosticOutput: {
            text: combineCommandOutput(deviceListResult)
          },
          details: [
            `No handle from \`dsview-cli devices list\` matched deviceId ${request.session.deviceId}.`,
            "Live capture requires a fresh runtime handle because dsview-cli does not accept stable ids directly."
          ]
        }
      }

      const tempDir = await createTempDir()
      const outputPath = join(tempDir, `${request.session.deviceId}.vcd`)
      const metadataPath = join(tempDir, `${request.session.deviceId}.json`)
      const sampleLimit = resolveSampleLimit(request)

      try {
        const captureResult = await executeCommand(
          binaryPath,
          [
            "capture",
            "--format",
            "json",
            "--handle",
            String(selectedDevice.handle),
            "--sample-rate-hz",
            String(request.session.sampling.sampleRateHz),
            "--sample-limit",
            String(sampleLimit),
            "--channels",
            channelResolution.indexes.join(","),
            "--output",
            outputPath,
            "--metadata-output",
            metadataPath,
            "--wait-timeout-ms",
            String(timeoutMs),
            "--poll-interval-ms",
            String(DEFAULT_DSVIEW_CAPTURE_POLL_INTERVAL_MS)
          ],
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
            nativeCode:
              typeof captureResult.nativeCode === "string"
                ? captureResult.nativeCode
                : captureResult.nativeCode === null
                  ? null
                  : String(captureResult.nativeCode),
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

        let metadata: DsviewCaptureMetadata = {
          toolVersion: runtimeSnapshot.runtime.version,
          capturedAt: null,
          sampleRateHz: request.session.sampling.sampleRateHz,
          totalSamples: null,
          requestedSampleLimit: sampleLimit
        }
        try {
          metadata = {
            ...metadata,
            ...parseCaptureMetadata(await readTextFile(resolvedMetadataPath))
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

        return {
          ok: true,
          backendVersion: metadata.toolVersion ?? runtimeSnapshot.runtime.version,
          diagnosticOutput: commandOutput.length > 0 ? { text: commandOutput } : undefined,
          artifact
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

export {
  createDefaultProbeRuntime,
  defaultExecuteCommand,
  parseDsviewListedDevices,
  parseDsviewVersionOutput
}
