import { execFile } from "node:child_process"
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

export const DSLOGIC_NATIVE_BACKEND_KIND = "libsigrok" as const
export const DSLOGIC_SUPPORTED_HOST_PLATFORMS = ["linux", "macos", "windows"] as const
export const DEFAULT_DSLOGIC_RUNTIME_PROBE_TIMEOUT_MS = 3_000
const DEFAULT_DSLOGIC_RUNTIME_PROBE_MAX_BUFFER_BYTES = 64 * 1024
const DEFAULT_SIGROK_CLI_PATH = "sigrok-cli"

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
  libraryPath?: string | null
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

interface ParsedSigrokVersion {
  version: string
  libraryPath: string | null
}

export interface CreateDslogicNativeRuntimeOptions {
  now?: () => string
  getHostOs?: () => NodeJS.Platform
  getHostArch?: () => NodeJS.Architecture
  sigrokCliPath?: string
  probeTimeoutMs?: number
  executeCommand?: DslogicNativeCommandRunner
  probeRuntime?: (
    host: DslogicNativeHostMetadata
  ) => Promise<Pick<DslogicNativeRuntimeSnapshot, "runtime" | "devices" | "diagnostics">>
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

const createUnsupportedSnapshot = (
  checkedAt: string,
  host: DslogicNativeHostMetadata
): DslogicNativeRuntimeSnapshot => ({
  checkedAt,
  host,
  runtime: {
    state: "unsupported-os",
    libraryPath: null,
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
  host: DslogicNativeHostMetadata,
  code: InventoryDiagnosticCode,
  message: string,
  runtime: { libraryPath: string | null; version: string | null }
): DslogicNativeRuntimeDiagnostic => ({
  code,
  message,
  libraryPath: runtime.libraryPath,
  backendVersion: runtime.version
})

const createRuntimeResult = (
  host: DslogicNativeHostMetadata,
  state: Exclude<DslogicNativeRuntimeState, "unsupported-os">,
  runtime: { libraryPath: string | null; version: string | null },
  code?: InventoryDiagnosticCode
): Pick<DslogicNativeRuntimeSnapshot, "runtime" | "devices" | "diagnostics"> => {
  const messageByCode: Record<InventoryDiagnosticCode, string> = {
    "backend-missing-runtime": `libsigrok runtime is not available on ${host.platform}.`,
    "backend-unsupported-os": `libsigrok probing is not supported on ${host.platform}.`,
    "backend-runtime-failed": `libsigrok runtime probe failed on ${host.platform}.`,
    "backend-runtime-timeout": `libsigrok runtime probe timed out before readiness was confirmed on ${host.platform}.`,
    "backend-runtime-malformed-response": `libsigrok runtime probe returned malformed output on ${host.platform}.`,
    "device-unsupported-variant": `Unsupported DSLogic variant detected on ${host.platform}.`,
    "device-runtime-malformed-response": `Unable to classify DSLogic variant on ${host.platform}.`
  }

  return {
    runtime: {
      state,
      libraryPath: runtime.libraryPath,
      version: runtime.version
    },
    devices: [],
    diagnostics: code
      ? [createRuntimeDiagnostic(host, code, messageByCode[code], runtime)]
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

const parseSigrokVersionOutput = (output: string): ParsedSigrokVersion | null => {
  const versionMatch = output.match(/\bsigrok-cli\s+([0-9][^\s]*)/i)
  if (!versionMatch) {
    return null
  }

  const directLibraryPathMatch = output.match(/(\/[\w./-]*libsigrok[\w./-]*\.(?:dylib|so(?:\.[0-9]+)*|dll))/i)
  const libraryDirectoryMatch = output.match(/\b(?:libdir|library(?:\s+path)?)\s*[:=]\s*(\/[\w./-]+)/i)

  return {
    version: versionMatch[1] ?? null,
    libraryPath: directLibraryPathMatch?.[1] ?? libraryDirectoryMatch?.[1] ?? null
  }
}

const extractSigrokDeviceId = (line: string, label: string, index: number): string => {
  const serialMatch = line.match(/\b(?:serial|sn)\s*=\s*([^,\s)]+)/i)
  if (serialMatch?.[1]) {
    return serialMatch[1]
  }

  const connectionMatch = line.match(/\b(?:conn|connection|location|usb)\s*=\s*([^,\s)]+)/i)
  if (connectionMatch?.[1]) {
    return connectionMatch[1]
  }

  const normalizedLabel = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")

  return normalizedLabel.length > 0 ? normalizedLabel : `dslogic-${index + 1}`
}

const extractSigrokDeviceLabel = (line: string): string | null => {
  const trimmed = line.trim()

  const dashMatch = trimmed.match(/-\s*(.+?)(?:\s+with\b|\s*\(|\s*:\s*(?:conn|serial|sn|usb|location)=|$)/i)
  if (dashMatch?.[1]) {
    return dashMatch[1].trim()
  }

  const labelMatch = trimmed.match(/(DSLogic[^:(]*?(?:Pango)?)(?:\s*\(|\s*:\s*(?:conn|serial|sn|usb|location)=|$)/i)
  if (labelMatch?.[1]) {
    return labelMatch[1].trim()
  }

  return /dslogic/i.test(trimmed) ? trimmed : null
}

const parseSigrokScanOutput = (
  output: string,
  detectedAt: string
): DslogicProbeDeviceCandidate[] | null => {
  const trimmed = output.trim()
  if (trimmed.length === 0) {
    return null
  }

  if (/\bno\s+(?:devices|supported hardware)\s+found\b/i.test(trimmed)) {
    return []
  }

  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  const hasDeviceListing = lines.some((line) => /devices were found/i.test(line))
  const dslogicLines = lines.filter((line) => /dslogic|dreamsourcelab|pango/i.test(line))

  if (!hasDeviceListing && dslogicLines.length === 0) {
    return null
  }

  const seenDeviceIds = new Set<string>()
  const devices: DslogicProbeDeviceCandidate[] = []

  for (const [index, line] of dslogicLines.entries()) {
    const label = extractSigrokDeviceLabel(line) ?? "DSLogic device"
    const variantHint = /v421|pango/i.test(`${label} ${line}`) ? "v421-pango" : null
    const usbProductId = variantHint === "v421-pango" ? "0030" : "0001"
    const deviceId = extractSigrokDeviceId(line, label, index)

    if (seenDeviceIds.has(deviceId)) {
      continue
    }

    seenDeviceIds.add(deviceId)
    devices.push({
      deviceId,
      label,
      lastSeenAt: detectedAt,
      capabilityType: "logic-analyzer",
      usbVendorId: "2a0e",
      usbProductId,
      model: "dslogic-plus",
      modelDisplayName: label,
      variantHint
    })
  }

  return devices
}

const createDefaultProbeRuntime = (options: {
  sigrokCliPath: string
  probeTimeoutMs: number
  executeCommand: DslogicNativeCommandRunner
  now: () => string
}): NonNullable<CreateDslogicNativeRuntimeOptions["probeRuntime"]> =>
  async (host) => {
    if (host.platform !== "macos") {
      return createRuntimeResult(host, "missing", { libraryPath: null, version: null })
    }

    const versionResult = await options.executeCommand(
      options.sigrokCliPath,
      ["--version"],
      {
        timeoutMs: options.probeTimeoutMs,
        maxBufferBytes: DEFAULT_DSLOGIC_RUNTIME_PROBE_MAX_BUFFER_BYTES
      }
    )

    if (!versionResult.ok) {
      switch (versionResult.reason) {
        case "missing":
          return createRuntimeResult(host, "missing", { libraryPath: null, version: null }, "backend-missing-runtime")
        case "timeout":
          return createRuntimeResult(host, "timeout", { libraryPath: null, version: null }, "backend-runtime-timeout")
        default:
          return createRuntimeResult(host, "failed", { libraryPath: null, version: null }, "backend-runtime-failed")
      }
    }

    const parsedVersion = parseSigrokVersionOutput(combineCommandOutput(versionResult))
    if (!parsedVersion) {
      return createRuntimeResult(
        host,
        "malformed",
        { libraryPath: null, version: null },
        "backend-runtime-malformed-response"
      )
    }

    const scanResult = await options.executeCommand(
      options.sigrokCliPath,
      ["--scan"],
      {
        timeoutMs: options.probeTimeoutMs,
        maxBufferBytes: DEFAULT_DSLOGIC_RUNTIME_PROBE_MAX_BUFFER_BYTES
      }
    )

    if (!scanResult.ok) {
      switch (scanResult.reason) {
        case "missing":
          return createRuntimeResult(host, "missing", parsedVersion, "backend-missing-runtime")
        case "timeout":
          return createRuntimeResult(host, "timeout", parsedVersion, "backend-runtime-timeout")
        default:
          return createRuntimeResult(host, "failed", parsedVersion, "backend-runtime-failed")
      }
    }

    const devices = parseSigrokScanOutput(combineCommandOutput(scanResult), options.now())
    if (!devices) {
      return createRuntimeResult(host, "malformed", parsedVersion, "backend-runtime-malformed-response")
    }

    return {
      runtime: {
        state: "ready",
        libraryPath: parsedVersion.libraryPath,
        version: parsedVersion.version
      },
      devices,
      diagnostics: []
    }
  }

export const createDslogicNativeRuntime = (
  options: CreateDslogicNativeRuntimeOptions = {}
): DslogicNativeRuntime => {
  const now = options.now ?? (() => new Date().toISOString())
  const getHostOs = options.getHostOs ?? (() => process.platform)
  const getHostArch = options.getHostArch ?? (() => process.arch)
  const probeRuntime = options.probeRuntime ?? createDefaultProbeRuntime({
    sigrokCliPath: options.sigrokCliPath ?? DEFAULT_SIGROK_CLI_PATH,
    probeTimeoutMs: options.probeTimeoutMs ?? DEFAULT_DSLOGIC_RUNTIME_PROBE_TIMEOUT_MS,
    executeCommand: options.executeCommand ?? defaultExecuteCommand,
    now
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

export const createDslogicNativeLiveCaptureBackend = (
  capture: DslogicNativeLiveCaptureBackend["capture"]
): DslogicNativeLiveCaptureBackend => ({ capture })

export {
  createDefaultProbeRuntime,
  defaultExecuteCommand,
  parseSigrokScanOutput,
  parseSigrokVersionOutput
}
