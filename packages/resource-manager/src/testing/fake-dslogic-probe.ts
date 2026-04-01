import type {
  DslogicBackendProbe,
  DslogicBackendProbeSnapshot,
  DslogicProbeDeviceCandidate,
  DslogicProbeDiagnostic,
  DslogicProbeBackendState
} from "../dslogic/backend-probe.js"

export type FakeDslogicProbeResult = DslogicBackendProbeSnapshot | Error

const cloneCandidate = (
  candidate: DslogicProbeDeviceCandidate
): DslogicProbeDeviceCandidate => ({ ...candidate })

const cloneDiagnostic = (
  diagnostic: DslogicProbeDiagnostic
): DslogicProbeDiagnostic => ({ ...diagnostic })

const cloneSnapshot = (
  snapshot: DslogicBackendProbeSnapshot
): DslogicBackendProbeSnapshot => ({
  ...snapshot,
  host: { ...snapshot.host },
  backend: { ...snapshot.backend },
  devices: snapshot.devices.map(cloneCandidate),
  diagnostics: snapshot.diagnostics.map(cloneDiagnostic)
})

export const createDslogicProbeSnapshot = (options: {
  checkedAt?: string
  platform?: DslogicBackendProbeSnapshot["platform"]
  os?: string
  arch?: string
  backendState?: DslogicProbeBackendState
  libraryPath?: string | null
  version?: string | null
  devices?: readonly DslogicProbeDeviceCandidate[]
  diagnostics?: readonly DslogicProbeDiagnostic[]
} = {}): DslogicBackendProbeSnapshot => {
  const platform = options.platform ?? "macos"
  const os =
    options.os ??
    (platform === "macos" ? "darwin" : platform === "windows" ? "win32" : "linux")

  return {
    platform,
    checkedAt: options.checkedAt ?? "2026-03-30T00:00:00.000Z",
    host: {
      platform,
      os,
      arch: options.arch ?? "x64"
    },
    backend: {
      state: options.backendState ?? "ready",
      libraryPath:
        options.libraryPath !== undefined ? options.libraryPath : "/usr/local/lib/libsigrok.so",
      version: options.version !== undefined ? options.version : "0.6.0"
    },
    devices: (options.devices ?? []).map(cloneCandidate),
    diagnostics: (options.diagnostics ?? []).map(cloneDiagnostic)
  }
}

export const createClassicDslogicCandidate = (
  overrides: Partial<DslogicProbeDeviceCandidate> = {}
): DslogicProbeDeviceCandidate => ({
  deviceId: overrides.deviceId ?? "logic-ready",
  label: overrides.label ?? "DSLogic Plus Ready",
  lastSeenAt: overrides.lastSeenAt ?? "2026-03-30T00:00:00.000Z",
  capabilityType: overrides.capabilityType ?? "logic-analyzer",
  usbVendorId: overrides.usbVendorId ?? "2a0e",
  usbProductId: overrides.usbProductId ?? "0001",
  model: overrides.model ?? "dslogic-plus",
  modelDisplayName: overrides.modelDisplayName ?? "DSLogic Plus",
  variantHint: overrides.variantHint !== undefined ? overrides.variantHint : "classic"
})

export const createPangoDslogicCandidate = (
  overrides: Partial<DslogicProbeDeviceCandidate> = {}
): DslogicProbeDeviceCandidate => ({
  deviceId: overrides.deviceId ?? "logic-pango",
  label: overrides.label ?? "DSLogic V421/Pango",
  lastSeenAt: overrides.lastSeenAt ?? "2026-03-30T00:00:00.000Z",
  capabilityType: overrides.capabilityType ?? "logic-analyzer",
  usbVendorId: overrides.usbVendorId ?? "2a0e",
  usbProductId: overrides.usbProductId ?? "0030",
  model: overrides.model ?? "dslogic-plus",
  modelDisplayName: overrides.modelDisplayName ?? "DSLogic V421/Pango",
  variantHint: overrides.variantHint !== undefined ? overrides.variantHint : "v421-pango"
})

export class FakeDslogicBackendProbe implements DslogicBackendProbe {
  #result: FakeDslogicProbeResult

  constructor(result: FakeDslogicProbeResult = createDslogicProbeSnapshot()) {
    this.#result = result
  }

  async probeInventory(): Promise<DslogicBackendProbeSnapshot> {
    if (this.#result instanceof Error) {
      throw this.#result
    }

    return cloneSnapshot(this.#result)
  }

  setResult(result: FakeDslogicProbeResult): void {
    this.#result = result
  }
}
