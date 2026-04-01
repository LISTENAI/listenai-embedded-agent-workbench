import type {
  DeviceReadinessState,
  DslogicDeviceIdentity,
  InventoryDiagnostic,
  InventoryDiagnosticCode,
  InventoryPlatform
} from "@listenai/contracts"
import {
  createDslogicNativeRuntime,
  resolveInventoryPlatform,
  type CreateDslogicNativeRuntimeOptions,
  type DslogicNativeRuntime,
  type DslogicNativeRuntimeDiagnostic,
  type DslogicNativeRuntimeSnapshot,
  type DslogicNativeRuntimeState
} from "./native-runtime.js"

export const DSLOGIC_PROVIDER_KIND = "dslogic" as const
export const DSLOGIC_BACKEND_KIND = "libsigrok" as const

export type DslogicProbeBackendState = DslogicNativeRuntimeState

export interface DslogicProbeDiagnostic extends DslogicNativeRuntimeDiagnostic {}

export interface DslogicProbeDeviceCandidate {
  deviceId: string
  label: string
  lastSeenAt: string | null
  capabilityType?: string
  usbVendorId: string | null
  usbProductId: string | null
  model?: string | null
  modelDisplayName?: string | null
  variantHint?: string | null
}

export interface DslogicBackendProbeSnapshot {
  platform: InventoryPlatform
  checkedAt: string
  host: DslogicNativeRuntimeSnapshot["host"]
  backend: {
    state: DslogicProbeBackendState
    libraryPath: string | null
    version: string | null
  }
  devices: readonly DslogicProbeDeviceCandidate[]
  diagnostics: readonly DslogicProbeDiagnostic[]
}

export interface DslogicBackendProbe {
  probeInventory(): Promise<DslogicBackendProbeSnapshot>
}

export interface CreateDslogicBackendProbeOptions {
  nativeRuntime?: DslogicNativeRuntime
  now?: CreateDslogicNativeRuntimeOptions["now"]
  getHostPlatform?: CreateDslogicNativeRuntimeOptions["getHostOs"]
  getHostArch?: CreateDslogicNativeRuntimeOptions["getHostArch"]
  probeRuntime?: CreateDslogicNativeRuntimeOptions["probeRuntime"]
}

export interface ClassifiedDslogicCandidate {
  identity: DslogicDeviceIdentity
  readiness: DeviceReadinessState
  diagnostics: readonly InventoryDiagnostic[]
}

const normalizeUsbIdentifier = (value: string | null | undefined): string | null => {
  if (!value) {
    return null
  }

  const normalized = value.trim().toLowerCase()
  return normalized.length === 0 ? null : normalized
}

const readRecordString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null

const isJsonRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const extractUsbIdentifier = (value: unknown): string | null => {
  const text = readRecordString(value)
  if (!text) {
    return null
  }

  const hexMatch = text.match(/0x([0-9a-f]{4})/i)
  if (hexMatch) {
    return hexMatch[1]!.toLowerCase()
  }

  const plainMatch = text.match(/\b([0-9a-f]{4})\b/i)
  return plainMatch ? plainMatch[1]!.toLowerCase() : null
}

const buildUsbDeviceId = (
  candidate: Pick<DslogicProbeDeviceCandidate, "usbVendorId" | "usbProductId" | "label">,
  serialNumber: string | null,
  locationId: string | null
): string => {
  if (serialNumber) {
    return serialNumber
  }

  if (locationId) {
    return locationId
  }

  const parts = [candidate.usbVendorId, candidate.usbProductId, candidate.label]
    .filter((part): part is string => Boolean(part && part.trim().length > 0))
    .map((part) => part.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-"))

  return parts.join(":") || "dslogic-device"
}

export const parseMacosUsbDevices = (
  output: string,
  detectedAt: string
): DslogicProbeDeviceCandidate[] => {
  const payload = JSON.parse(output) as unknown
  const roots = isJsonRecord(payload) && Array.isArray(payload.SPUSBDataType)
    ? payload.SPUSBDataType
    : []
  const devices: DslogicProbeDeviceCandidate[] = []
  const seenDeviceIds = new Set<string>()

  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const entry of node) {
        visit(entry)
      }
      return
    }

    if (!isJsonRecord(node)) {
      return
    }

    const usbVendorId = extractUsbIdentifier(node.vendor_id ?? node.spusb_vendor_id)
    const usbProductId = extractUsbIdentifier(node.product_id)
    const label =
      readRecordString(node._name) ??
      readRecordString(node.name) ??
      readRecordString(node.product_name) ??
      "DSLogic device"
    const manufacturer =
      readRecordString(node.manufacturer) ??
      readRecordString(node.vendor_name) ??
      readRecordString(node.vendor)
    const looksLikeDslogic =
      usbVendorId === "2a0e" ||
      /dslogic/i.test(label) ||
      /dreamsourcelab/i.test(manufacturer ?? "")

    if (looksLikeDslogic) {
      const serialNumber =
        readRecordString(node.serial_num) ??
        readRecordString(node.serial_number)
      const locationId = readRecordString(node.location_id)
      const candidate: DslogicProbeDeviceCandidate = {
        deviceId: buildUsbDeviceId({ usbVendorId, usbProductId, label }, serialNumber, locationId),
        label,
        lastSeenAt: detectedAt,
        capabilityType: "logic-analyzer",
        usbVendorId,
        usbProductId,
        model: /dslogic/i.test(label) ? "dslogic-plus" : null,
        modelDisplayName: label,
        variantHint: null
      }

      if (!seenDeviceIds.has(candidate.deviceId)) {
        seenDeviceIds.add(candidate.deviceId)
        devices.push(candidate)
      }
    }

    for (const child of Object.values(node)) {
      visit(child)
    }
  }

  visit(roots)
  return devices
}

const createBackendDiagnostic = (
  snapshot: DslogicBackendProbeSnapshot,
  code: InventoryDiagnosticCode,
  message: string
): InventoryDiagnostic => ({
  code,
  severity: code === "backend-runtime-timeout" ? "warning" : "error",
  target: "backend",
  message,
  platform: snapshot.platform,
  backendKind: DSLOGIC_BACKEND_KIND,
  backendVersion: snapshot.backend.version
})

export const mapBackendProbeDiagnostics = (
  snapshot: DslogicBackendProbeSnapshot
): InventoryDiagnostic[] => {
  const diagnostics = snapshot.diagnostics.map((diagnostic) =>
    createBackendDiagnostic(snapshot, diagnostic.code, diagnostic.message)
  )

  if (diagnostics.length > 0) {
    return diagnostics
  }

  switch (snapshot.backend.state) {
    case "missing":
      return [
        createBackendDiagnostic(
          snapshot,
          "backend-missing-runtime",
          `libsigrok runtime is not available on ${snapshot.platform}.`
        )
      ]
    case "timeout":
      return [
        createBackendDiagnostic(
          snapshot,
          "backend-runtime-timeout",
          `libsigrok runtime probe timed out before readiness was confirmed on ${snapshot.platform}.`
        )
      ]
    case "failed":
      return [
        createBackendDiagnostic(
          snapshot,
          "backend-runtime-failed",
          `libsigrok runtime probe failed on ${snapshot.platform}.`
        )
      ]
    case "malformed":
      return [
        createBackendDiagnostic(
          snapshot,
          "backend-runtime-malformed-response",
          `libsigrok runtime probe returned malformed output on ${snapshot.platform}.`
        )
      ]
    case "unsupported-os":
      return [
        createBackendDiagnostic(
          snapshot,
          "backend-unsupported-os",
          `libsigrok probing is not supported on ${snapshot.platform}.`
        )
      ]
    default:
      return []
  }
}

export const classifyDslogicCandidate = (
  candidate: DslogicProbeDeviceCandidate
): ClassifiedDslogicCandidate => {
  const usbVendorId = normalizeUsbIdentifier(candidate.usbVendorId)
  const usbProductId = normalizeUsbIdentifier(candidate.usbProductId)
  const model = candidate.model ?? "dslogic-plus"
  const fallbackLabel = candidate.label.trim().length > 0 ? candidate.label : "DSLogic device"
  const modelDisplayName = candidate.modelDisplayName ?? fallbackLabel

  const baseIdentity: DslogicDeviceIdentity = {
    family: "dslogic",
    model,
    modelDisplayName,
    variant: candidate.variantHint ?? null,
    usbVendorId,
    usbProductId
  }

  if (usbVendorId === "2a0e" && usbProductId === "0001") {
    return {
      identity: {
        ...baseIdentity,
        model: "dslogic-plus",
        modelDisplayName: candidate.modelDisplayName ?? "DSLogic Plus",
        variant: "classic"
      },
      readiness: "ready",
      diagnostics: []
    }
  }

  if (usbVendorId === "2a0e" && usbProductId === "0030") {
    return {
      identity: {
        ...baseIdentity,
        model: "dslogic-plus",
        modelDisplayName: candidate.modelDisplayName ?? "DSLogic V421/Pango",
        variant: "v421-pango"
      },
      readiness: "unsupported",
      diagnostics: [
        {
          code: "device-unsupported-variant",
          severity: "error",
          target: "device",
          message: "Variant V421/Pango (2a0e:0030) is not supported.",
          deviceId: candidate.deviceId,
          backendKind: DSLOGIC_BACKEND_KIND
        }
      ]
    }
  }

  const unknownVariant = [usbVendorId, usbProductId].filter(Boolean).join(":") || "missing-usb-id"

  return {
    identity: {
      ...baseIdentity,
      variant: candidate.variantHint ?? unknownVariant
    },
    readiness: "unsupported",
    diagnostics: [
      {
        code: "device-runtime-malformed-response",
        severity: "warning",
        target: "device",
        message: `Unable to classify DSLogic variant ${unknownVariant}.`,
        deviceId: candidate.deviceId,
        backendKind: DSLOGIC_BACKEND_KIND
      }
    ]
  }
}

const mapNativeRuntimeSnapshot = (
  snapshot: DslogicNativeRuntimeSnapshot
): DslogicBackendProbeSnapshot => ({
  platform: snapshot.host.platform,
  checkedAt: snapshot.checkedAt,
  host: { ...snapshot.host },
  backend: {
    state: snapshot.runtime.state,
    libraryPath: snapshot.runtime.libraryPath,
    version: snapshot.runtime.version
  },
  devices: snapshot.devices.map((device) => ({ ...device })),
  diagnostics: snapshot.diagnostics.map((diagnostic) => ({ ...diagnostic }))
})

export const createDslogicBackendProbe = (
  options: CreateDslogicBackendProbeOptions = {}
): DslogicBackendProbe => {
  const nativeRuntime = options.nativeRuntime ?? createDslogicNativeRuntime({
    now: options.now,
    getHostOs: options.getHostPlatform,
    getHostArch: options.getHostArch,
    probeRuntime: options.probeRuntime
  })

  return {
    async probeInventory(): Promise<DslogicBackendProbeSnapshot> {
      return mapNativeRuntimeSnapshot(await nativeRuntime.probe())
    }
  }
}

export { createDslogicNativeRuntime, resolveInventoryPlatform }
export type {
  CreateDslogicNativeRuntimeOptions,
  DslogicNativeHostMetadata,
  DslogicNativeRuntime,
  DslogicNativeRuntimeDiagnostic,
  DslogicNativeRuntimeSnapshot,
  DslogicNativeRuntimeState
} from "./native-runtime.js"
