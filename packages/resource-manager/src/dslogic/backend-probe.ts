import {
  DSLOGIC_BACKEND_KIND,
  type DeviceReadinessState,
  type DslogicDeviceIdentity,
  type InventoryDiagnostic,
  type InventoryDiagnosticCode,
  type InventoryPlatform
} from "@listenai/contracts"
import {
  createDslogicNativeRuntime,
  defaultExecuteCommand,
  resolveInventoryPlatform,
  type CreateDslogicNativeRuntimeOptions,
  type DslogicNativeCommandRunner,
  type DslogicNativeRuntime,
  type DslogicNativeRuntimeDiagnostic,
  type DslogicNativeRuntimeSnapshot,
  type DslogicNativeRuntimeState
} from "./native-runtime.js"

const DEFAULT_HOST_USB_ENUMERATION_TIMEOUT_MS = 3_000
const DEFAULT_HOST_USB_ENUMERATION_MAX_BUFFER_BYTES = 256 * 1024
const DEFAULT_RUNTIME_DEVICE_ENUMERATION_TIMEOUT_MS = 3_000
const DEFAULT_RUNTIME_DEVICE_ENUMERATION_MAX_BUFFER_BYTES = 256 * 1024
const DEFAULT_DSVIEW_CLI_PATH = "dsview-cli"

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
    binaryPath?: string | null
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
  executeCommand?: DslogicNativeCommandRunner
  enumerateHostDevices?: (
    snapshot: DslogicNativeRuntimeSnapshot
  ) => Promise<readonly DslogicProbeDeviceCandidate[]>
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

const slugifyToken = (value: string | null | undefined): string | null => {
  if (!value) {
    return null
  }

  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
  return normalized.length > 0 ? normalized : null
}

const extractJsonObject = (output: string): string | null => {
  const start = output.indexOf("{")
  const end = output.lastIndexOf("}")

  if (start < 0 || end <= start) {
    return null
  }

  return output.slice(start, end + 1)
}

const hasClassicDslogicSignal = (...values: Array<string | null | undefined>): boolean =>
  values.some((value) => typeof value === "string" && /dslogic\s*plus/i.test(value) && !/v421|pango/i.test(value))

const hasPangoDslogicSignal = (...values: Array<string | null | undefined>): boolean =>
  values.some((value) => typeof value === "string" && /v421|pango/i.test(value))

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

export const parseDsviewDeviceList = (
  output: string,
  detectedAt: string
): DslogicProbeDeviceCandidate[] => {
  const payloadText = extractJsonObject(output)
  if (!payloadText) {
    return []
  }

  const payload = JSON.parse(payloadText) as unknown
  const deviceEntries =
    isJsonRecord(payload) && Array.isArray(payload.devices)
      ? payload.devices
      : []
  const devices: DslogicProbeDeviceCandidate[] = []
  const seenDeviceIds = new Set<string>()
  const stableIdCounts = new Map<string, number>()

  for (const entry of deviceEntries) {
    if (!isJsonRecord(entry)) {
      continue
    }

    const stableId = readRecordString(entry.stable_id ?? entry.stableId)
    const modelText = readRecordString(entry.model)
    const nativeName = readRecordString(entry.native_name ?? entry.nativeName)
    const label = modelText ?? nativeName ?? stableId ?? "DSLogic device"
    const looksLikeDslogic = [stableId, modelText, nativeName, label].some(
      (value) => typeof value === "string" && /dslogic/i.test(value)
    )

    if (!looksLikeDslogic) {
      continue
    }

    const handle =
      typeof entry.handle === "number" || typeof entry.handle === "string"
        ? String(entry.handle)
        : null

    let model: string | null = null
    let modelDisplayName = modelText ?? nativeName ?? label
    let variantHint: string | null = stableId?.toLowerCase() ?? null

    if (hasPangoDslogicSignal(stableId, modelText, nativeName)) {
      model = "dslogic-plus"
      modelDisplayName = "DSLogic V421/Pango"
      variantHint = "v421-pango"
    } else if (hasClassicDslogicSignal(stableId, modelText, nativeName)) {
      model = "dslogic-plus"
      modelDisplayName = "DSLogic Plus"
      variantHint = "classic"
    }

    const baseId =
      slugifyToken(stableId) ??
      (handle ? `dsview-handle-${handle}` : null) ??
      slugifyToken(modelDisplayName) ??
      "dslogic-device"
    const duplicateCount = (stableIdCounts.get(baseId) ?? 0) + 1
    stableIdCounts.set(baseId, duplicateCount)
    const deviceId = duplicateCount === 1 ? baseId : `${baseId}:${duplicateCount}`

    if (seenDeviceIds.has(deviceId)) {
      continue
    }

    seenDeviceIds.add(deviceId)
    devices.push({
      deviceId,
      label,
      lastSeenAt: detectedAt,
      capabilityType: "logic-analyzer",
      usbVendorId: null,
      usbProductId: null,
      model,
      modelDisplayName,
      variantHint
    })
  }

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
          `dsview-cli runtime is not available on ${snapshot.platform}.`
        )
      ]
    case "timeout":
      return [
        createBackendDiagnostic(
          snapshot,
          "backend-runtime-timeout",
          `dsview-cli runtime probe timed out before readiness was confirmed on ${snapshot.platform}.`
        )
      ]
    case "failed":
      return [
        createBackendDiagnostic(
          snapshot,
          "backend-runtime-failed",
          `dsview-cli runtime probe failed on ${snapshot.platform}.`
        )
      ]
    case "malformed":
      return [
        createBackendDiagnostic(
          snapshot,
          "backend-runtime-malformed-response",
          `dsview-cli runtime probe returned malformed output on ${snapshot.platform}.`
        )
      ]
    case "unsupported-os":
      return [
        createBackendDiagnostic(
          snapshot,
          "backend-unsupported-os",
          `dsview-cli probing is not supported on ${snapshot.platform}.`
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
  const normalizedVariantHint = normalizeUsbIdentifier(candidate.variantHint)
  const hasClassicHint =
    normalizedVariantHint === "classic" ||
    hasClassicDslogicSignal(candidate.label, candidate.modelDisplayName, candidate.model)
  const hasPangoHint =
    normalizedVariantHint === "v421-pango" ||
    hasPangoDslogicSignal(candidate.label, candidate.modelDisplayName, candidate.model, candidate.variantHint)

  const baseIdentity: DslogicDeviceIdentity = {
    family: "dslogic",
    model,
    modelDisplayName,
    variant: candidate.variantHint ?? null,
    usbVendorId,
    usbProductId
  }

  if ((usbVendorId === "2a0e" && usbProductId === "0030") || hasPangoHint) {
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

  if ((usbVendorId === "2a0e" && usbProductId === "0001") || hasClassicHint) {
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

  const unknownVariant = [usbVendorId, usbProductId].filter(Boolean).join(":") || normalizedVariantHint || "missing-usb-id"

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
    libraryPath: snapshot.runtime.binaryPath ?? snapshot.runtime.libraryPath,
    binaryPath: snapshot.runtime.binaryPath ?? snapshot.runtime.libraryPath,
    version: snapshot.runtime.version
  },
  devices: snapshot.devices.map((device) => ({ ...device })),
  diagnostics: snapshot.diagnostics.map((diagnostic) => ({ ...diagnostic }))
})

const mergeProbeDeviceCandidates = (
  ...collections: ReadonlyArray<readonly DslogicProbeDeviceCandidate[]>
): DslogicProbeDeviceCandidate[] => {
  const seenDeviceIds = new Set<string>()
  const merged: DslogicProbeDeviceCandidate[] = []

  for (const collection of collections) {
    for (const candidate of collection) {
      if (seenDeviceIds.has(candidate.deviceId)) {
        continue
      }

      seenDeviceIds.add(candidate.deviceId)
      merged.push({ ...candidate })
    }
  }

  return merged
}

const createDefaultHostDeviceEnumerator = (options: {
  executeCommand: DslogicNativeCommandRunner
}): NonNullable<CreateDslogicBackendProbeOptions["enumerateHostDevices"]> =>
  async (snapshot) => {
    if (snapshot.host.platform === "macos") {
      const result = await options.executeCommand(
        "system_profiler",
        ["SPUSBDataType", "-json"],
        {
          timeoutMs: DEFAULT_HOST_USB_ENUMERATION_TIMEOUT_MS,
          maxBufferBytes: DEFAULT_HOST_USB_ENUMERATION_MAX_BUFFER_BYTES
        }
      )

      if (!result.ok) {
        return []
      }

      const output = result.stdout.trim().length > 0 ? result.stdout : result.stderr
      if (output.trim().length === 0) {
        return []
      }

      try {
        return parseMacosUsbDevices(output, snapshot.checkedAt)
      } catch {
        return []
      }
    }

    if (snapshot.runtime.state !== "ready") {
      return []
    }

    const dsviewCliPath = snapshot.runtime.binaryPath ?? snapshot.runtime.libraryPath ?? DEFAULT_DSVIEW_CLI_PATH
    const result = await options.executeCommand(
      dsviewCliPath,
      ["devices", "list"],
      {
        timeoutMs: DEFAULT_RUNTIME_DEVICE_ENUMERATION_TIMEOUT_MS,
        maxBufferBytes: DEFAULT_RUNTIME_DEVICE_ENUMERATION_MAX_BUFFER_BYTES
      }
    )

    if (!result.ok) {
      return []
    }

    const output = [result.stdout, result.stderr]
      .filter((chunk) => chunk.trim().length > 0)
      .join("\n")
    if (output.trim().length === 0) {
      return []
    }

    try {
      return parseDsviewDeviceList(output, snapshot.checkedAt)
    } catch {
      return []
    }
  }

export const createDslogicBackendProbe = (
  options: CreateDslogicBackendProbeOptions = {}
): DslogicBackendProbe => {
  const nativeRuntime = options.nativeRuntime ?? createDslogicNativeRuntime({
    now: options.now,
    getHostOs: options.getHostPlatform,
    getHostArch: options.getHostArch,
    probeRuntime: options.probeRuntime
  })
  const enumerateHostDevices =
    options.enumerateHostDevices ??
    createDefaultHostDeviceEnumerator({
      executeCommand: options.executeCommand ?? defaultExecuteCommand
    })

  return {
    async probeInventory(): Promise<DslogicBackendProbeSnapshot> {
      const runtimeSnapshot = await nativeRuntime.probe()
      const baseSnapshot = mapNativeRuntimeSnapshot(runtimeSnapshot)
      const hostDevices = await enumerateHostDevices(runtimeSnapshot)

      return {
        ...baseSnapshot,
        devices: mergeProbeDeviceCandidates(baseSnapshot.devices, hostDevices)
      }
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
