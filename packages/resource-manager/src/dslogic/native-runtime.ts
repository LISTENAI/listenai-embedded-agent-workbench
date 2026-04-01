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

export interface CreateDslogicNativeRuntimeOptions {
  now?: () => string
  getHostOs?: () => NodeJS.Platform
  getHostArch?: () => NodeJS.Architecture
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

const defaultProbeRuntime: NonNullable<CreateDslogicNativeRuntimeOptions["probeRuntime"]> =
  async () => ({
    runtime: {
      state: "missing",
      libraryPath: null,
      version: null
    },
    devices: [],
    diagnostics: []
  })

export const createDslogicNativeRuntime = (
  options: CreateDslogicNativeRuntimeOptions = {}
): DslogicNativeRuntime => {
  const now = options.now ?? (() => new Date().toISOString())
  const getHostOs = options.getHostOs ?? (() => process.platform)
  const getHostArch = options.getHostArch ?? (() => process.arch)
  const probeRuntime = options.probeRuntime ?? defaultProbeRuntime

  return {
    async probe(): Promise<DslogicNativeRuntimeSnapshot> {
      const checkedAt = now()
      const os = getHostOs()
      const host: DslogicNativeHostMetadata = {
        platform: resolveInventoryPlatform(os),
        os,
        arch: getHostArch()
      }

      if (!DSLOGIC_SUPPORTED_HOST_PLATFORMS.includes(host.platform)) {
        return createUnsupportedSnapshot(checkedAt, host)
      }

      const result = await probeRuntime(host)
      return {
        checkedAt,
        host,
        runtime: { ...result.runtime },
        devices: result.devices.map((device) => ({ ...device })),
        diagnostics: result.diagnostics.map((diagnostic) => ({ ...diagnostic }))
      }
    }
  }
}

export const createDslogicNativeLiveCaptureBackend = (
  capture: DslogicNativeLiveCaptureBackend["capture"]
): DslogicNativeLiveCaptureBackend => ({ capture })
