import {
  DSLOGIC_BACKEND_KIND,
  DSLOGIC_PROVIDER_KIND,
  type BackendReadinessRecord,
  type DeviceRecord,
  type InventoryDiagnostic,
  type InventorySnapshot
} from "@listenai/contracts"
import type {
  DeviceProvider,
  DiscoveredDevice,
  LiveCaptureProvider
} from "../device-provider.js"
import {
  classifyDslogicCandidate,
  createDslogicBackendProbe,
  mapBackendProbeDiagnostics,
  resolveInventoryPlatform,
  type DslogicBackendProbe,
  type DslogicBackendProbeSnapshot,
  type DslogicProbeDeviceCandidate
} from "./backend-probe.js"
import {
  createDslogicLiveCaptureProvider,
  type DslogicLiveCaptureRunner
} from "./live-capture.js"

export interface DslogicDeviceProviderOptions {
  probe?: DslogicBackendProbe
  now?: () => string
  getHostPlatform?: () => NodeJS.Platform
  liveCaptureRunner?: DslogicLiveCaptureRunner
}

const cloneDiagnostic = (
  diagnostic: InventoryDiagnostic
): InventoryDiagnostic => ({ ...diagnostic })

const cloneDeviceRecord = (record: DeviceRecord): DeviceRecord => ({
  ...record,
  diagnostics: record.diagnostics?.map(cloneDiagnostic),
  dslogic: record.dslogic ? { ...record.dslogic } : record.dslogic
})

const cloneSnapshot = (snapshot: InventorySnapshot): InventorySnapshot => ({
  ...snapshot,
  devices: snapshot.devices.map(cloneDeviceRecord),
  backendReadiness: snapshot.backendReadiness.map((record) => ({
    ...record,
    diagnostics: record.diagnostics.map(cloneDiagnostic)
  })),
  diagnostics: snapshot.diagnostics.map(cloneDiagnostic)
})

const cloneCandidate = (
  candidate: DslogicProbeDeviceCandidate
): DslogicProbeDeviceCandidate => ({ ...candidate })

const toDiscoveredDevice = (record: DeviceRecord): DiscoveredDevice => ({
  deviceId: record.deviceId,
  label: record.label,
  capabilityType: record.capabilityType,
  lastSeenAt: record.lastSeenAt ?? record.updatedAt
})

const isCompatibilityVisible = (record: DeviceRecord): boolean =>
  record.connectionState === "connected" && record.readiness === "ready"

const mapBackendReadinessState = (
  snapshot: DslogicBackendProbeSnapshot
): BackendReadinessRecord["readiness"] => {
  switch (snapshot.backend.state) {
    case "ready":
      return "ready"
    case "missing":
      return "missing"
    case "unsupported-os":
      return "unsupported"
    default:
      return "degraded"
  }
}

const buildDeviceRecord = (
  candidate: DslogicProbeDeviceCandidate,
  snapshot: DslogicBackendProbeSnapshot,
  backendDiagnostics: readonly InventoryDiagnostic[]
): DeviceRecord => {
  const classification = classifyDslogicCandidate(candidate)
  const readiness =
    classification.readiness === "unsupported"
      ? "unsupported"
      : snapshot.backend.state === "ready"
        ? "ready"
        : "degraded"

  const inheritedBackendDiagnostics: InventoryDiagnostic[] =
    snapshot.backend.state === "ready"
      ? []
      : backendDiagnostics.map(
          (diagnostic): InventoryDiagnostic => ({
            ...diagnostic,
            deviceId: candidate.deviceId,
            target: diagnostic.target === "backend" ? "backend" : diagnostic.target
          })
        )

  return {
    deviceId: candidate.deviceId,
    label: candidate.label,
    capabilityType: candidate.capabilityType ?? "logic-analyzer",
    connectionState: "connected",
    allocationState: "free",
    ownerSkillId: null,
    lastSeenAt: candidate.lastSeenAt ?? snapshot.checkedAt,
    updatedAt: snapshot.checkedAt,
    readiness,
    diagnostics: [
      ...classification.diagnostics.map(cloneDiagnostic),
      ...inheritedBackendDiagnostics.map(cloneDiagnostic)
    ],
    providerKind: DSLOGIC_PROVIDER_KIND,
    backendKind: DSLOGIC_BACKEND_KIND,
    dslogic: { ...classification.identity }
  }
}

const buildInventorySnapshot = (
  snapshot: DslogicBackendProbeSnapshot
): InventorySnapshot => {
  const backendDiagnostics = mapBackendProbeDiagnostics(snapshot)
  const backendReadiness: BackendReadinessRecord = {
    platform: snapshot.platform,
    backendKind: DSLOGIC_BACKEND_KIND,
    readiness: mapBackendReadinessState(snapshot),
    version: snapshot.backend.version,
    checkedAt: snapshot.checkedAt,
    diagnostics: backendDiagnostics
  }

  const devices = snapshot.devices.map((candidate) =>
    buildDeviceRecord(cloneCandidate(candidate), snapshot, backendDiagnostics)
  )

  return {
    refreshedAt: snapshot.checkedAt,
    inventoryScope: {
      providerKinds: [DSLOGIC_PROVIDER_KIND],
      backendKinds: [DSLOGIC_BACKEND_KIND]
    },
    devices,
    backendReadiness: [backendReadiness],
    diagnostics: [
      ...backendDiagnostics.map(cloneDiagnostic),
      ...devices.flatMap((record) =>
        (record.diagnostics ?? []).filter((diagnostic) => diagnostic.target === "device")
      )
    ]
  }
}

const buildFallbackSnapshot = (
  checkedAt: string,
  platform: BackendReadinessRecord["platform"],
  message: string
): InventorySnapshot => {
  const diagnostic: InventoryDiagnostic = {
    code: "backend-runtime-failed",
    severity: "error",
    target: "backend",
    message,
    platform,
    backendKind: DSLOGIC_BACKEND_KIND,
    backendVersion: null
  }

  return {
    refreshedAt: checkedAt,
    inventoryScope: {
      providerKinds: [DSLOGIC_PROVIDER_KIND],
      backendKinds: [DSLOGIC_BACKEND_KIND]
    },
    devices: [],
    backendReadiness: [
      {
        platform,
        backendKind: DSLOGIC_BACKEND_KIND,
        readiness: "degraded",
        version: null,
        checkedAt,
        diagnostics: [diagnostic]
      }
    ],
    diagnostics: [diagnostic]
  }
}

export class DslogicDeviceProvider implements DeviceProvider {
  readonly #probe: DslogicBackendProbe
  readonly #now: () => string
  readonly #getHostPlatform: () => NodeJS.Platform
  readonly liveCapture?: LiveCaptureProvider

  constructor(options: DslogicDeviceProviderOptions = {}) {
    this.#probe = options.probe ?? createDslogicBackendProbe({
      now: options.now,
      getHostPlatform: options.getHostPlatform
    })
    this.#now = options.now ?? (() => new Date().toISOString())
    this.#getHostPlatform = options.getHostPlatform ?? (() => process.platform)
    this.liveCapture = options.liveCaptureRunner
      ? createDslogicLiveCaptureProvider(options.liveCaptureRunner)
      : undefined
  }

  async listInventorySnapshot(): Promise<InventorySnapshot> {
    try {
      return cloneSnapshot(buildInventorySnapshot(await this.#probe.probeInventory()))
    } catch (error) {
      const checkedAt = this.#now()
      const platform = resolveInventoryPlatform(this.#getHostPlatform())
      const message = error instanceof Error
        ? `DSLogic probe threw: ${error.message}`
        : "DSLogic probe threw an unknown error."

      return buildFallbackSnapshot(checkedAt, platform, message)
    }
  }

  async listConnectedDevices(): Promise<readonly DiscoveredDevice[]> {
    const snapshot = await this.listInventorySnapshot()
    return snapshot.devices
      .filter(isCompatibilityVisible)
      .map(toDiscoveredDevice)
  }
}
