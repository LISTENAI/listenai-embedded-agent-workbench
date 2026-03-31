import { access } from "node:fs/promises"
import { delimiter, join } from "node:path"
import process from "node:process"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import type {
  DeviceReadinessState,
  DslogicDeviceIdentity,
  InventoryDiagnostic,
  InventoryDiagnosticCode,
  InventoryPlatform
} from "@listenai/contracts"

const execFileAsync = promisify(execFile)

export const DSLOGIC_PROVIDER_KIND = "dslogic" as const
export const DSLOGIC_BACKEND_KIND = "dsview" as const
export const DSLOGIC_BACKEND_EXECUTABLE = "dsview"
export const DSLOGIC_SUPPORTED_HOST_PLATFORMS = ["linux", "macos", "windows"] as const

export type DslogicProbeBackendState =
  | "ready"
  | "missing"
  | "timeout"
  | "failed"
  | "malformed"
  | "unsupported-os"

export interface DslogicProbeDiagnostic {
  code: InventoryDiagnosticCode
  message: string
  deviceId?: string
  executablePath?: string | null
  backendVersion?: string | null
}

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
  backend: {
    state: DslogicProbeBackendState
    executablePath: string | null
    version: string | null
  }
  devices: readonly DslogicProbeDeviceCandidate[]
  diagnostics: readonly DslogicProbeDiagnostic[]
}

export interface DslogicBackendProbe {
  probeInventory(): Promise<DslogicBackendProbeSnapshot>
}

export interface CreateDslogicBackendProbeOptions {
  now?: () => string
  getHostPlatform?: () => NodeJS.Platform
  locateExecutable?: (command: string) => Promise<string | null>
  runCommand?: (
    command: string,
    args: readonly string[],
    options: { timeoutMs: number }
  ) => Promise<{ stdout: string; stderr: string }>
  listUsbDevices?: () => Promise<readonly DslogicProbeDeviceCandidate[]>
  timeoutMs?: number
}

export interface ClassifiedDslogicCandidate {
  identity: DslogicDeviceIdentity
  readiness: DeviceReadinessState
  diagnostics: readonly InventoryDiagnostic[]
}

const DEFAULT_TIMEOUT_MS = 1500
const DEFAULT_USB_ENUMERATION_TIMEOUT_MS = 5000

const normalizeUsbIdentifier = (value: string | null | undefined): string | null => {
  if (!value) {
    return null
  }

  const normalized = value.trim().toLowerCase()
  return normalized.length === 0 ? null : normalized
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

const parseVersionFromOutput = (output: string): string | null => {
  const normalized = output.trim()
  if (normalized.length === 0) {
    return null
  }

  const match = normalized.match(/\d+(?:\.\d+)+(?:[-+][^\s]+)?/)
  if (match) {
    return match[0]
  }

  return null
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

const listUsbDevicesForHost = async (
  getHostPlatform: () => NodeJS.Platform,
  runCommand: NonNullable<CreateDslogicBackendProbeOptions["runCommand"]>,
  now: () => string
): Promise<readonly DslogicProbeDeviceCandidate[]> => {
  switch (getHostPlatform()) {
    case "darwin": {
      const { stdout } = await runCommand(
        "system_profiler",
        ["SPUSBDataType", "-json"],
        { timeoutMs: DEFAULT_USB_ENUMERATION_TIMEOUT_MS }
      )

      return parseMacosUsbDevices(stdout, now())
    }
    default:
      return []
  }
}

const createBackendDiagnostic = (
  snapshot: DslogicBackendProbeSnapshot,
  code: InventoryDiagnosticCode,
  message: string
): InventoryDiagnostic => ({
  code,
  severity: code === "backend-probe-timeout" ? "warning" : "error",
  target: "backend",
  message,
  platform: snapshot.platform,
  backendKind: DSLOGIC_BACKEND_KIND,
  executablePath: snapshot.backend.executablePath,
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
          "backend-missing-executable",
          `DSView executable ${DSLOGIC_BACKEND_EXECUTABLE} was not found on ${snapshot.platform}.`
        )
      ]
    case "timeout":
      return [
        createBackendDiagnostic(
          snapshot,
          "backend-probe-timeout",
          `DSView probe timed out before readiness was confirmed on ${snapshot.platform}.`
        )
      ]
    case "failed":
      return [
        createBackendDiagnostic(
          snapshot,
          "backend-probe-failed",
          `DSView probe failed on ${snapshot.platform}.`
        )
      ]
    case "malformed":
      return [
        createBackendDiagnostic(
          snapshot,
          "backend-probe-malformed-output",
          `DSView probe returned malformed output on ${snapshot.platform}.`
        )
      ]
    case "unsupported-os":
      return [
        createBackendDiagnostic(
          snapshot,
          "backend-unsupported-os",
          `DSView probing is not supported on ${snapshot.platform}.`
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
        code: "device-probe-malformed-output",
        severity: "warning",
        target: "device",
        message: `Unable to classify DSLogic variant ${unknownVariant}.`,
        deviceId: candidate.deviceId,
        backendKind: DSLOGIC_BACKEND_KIND
      }
    ]
  }
}

const defaultLocateExecutable = async (command: string): Promise<string | null> => {
  const pathValue = process.env.PATH ?? ""
  const pathEntries = pathValue.split(delimiter).filter(Boolean)
  const pathext = process.platform === "win32"
    ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM")
        .split(";")
        .filter(Boolean)
    : [""]

  for (const entry of pathEntries) {
    for (const extension of pathext) {
      const candidatePath = process.platform === "win32"
        ? join(entry, `${command}${extension.toLowerCase()}`)
        : join(entry, command)

      try {
        await access(candidatePath)
        return candidatePath
      } catch {
        continue
      }
    }
  }

  return null
}

const defaultRunCommand: NonNullable<CreateDslogicBackendProbeOptions["runCommand"]> = async (
  command,
  args,
  options
) => {
  const result = await execFileAsync(command, [...args], {
    timeout: options.timeoutMs,
    windowsHide: true
  })

  return {
    stdout: result.stdout,
    stderr: result.stderr
  }
}

const defaultListUsbDevices = (
  getHostPlatform: () => NodeJS.Platform,
  runCommand: NonNullable<CreateDslogicBackendProbeOptions["runCommand"]>,
  now: () => string
): NonNullable<CreateDslogicBackendProbeOptions["listUsbDevices"]> =>
  async () => listUsbDevicesForHost(getHostPlatform, runCommand, now)

export const createDslogicBackendProbe = (
  options: CreateDslogicBackendProbeOptions = {}
): DslogicBackendProbe => {
  const now = options.now ?? (() => new Date().toISOString())
  const getHostPlatform = options.getHostPlatform ?? (() => process.platform)
  const locateExecutable = options.locateExecutable ?? defaultLocateExecutable
  const runCommand = options.runCommand ?? defaultRunCommand
  const listUsbDevices = options.listUsbDevices ?? defaultListUsbDevices(getHostPlatform, runCommand, now)
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

  return {
    async probeInventory(): Promise<DslogicBackendProbeSnapshot> {
      const checkedAt = now()
      const platform = resolveInventoryPlatform(getHostPlatform())
      const devices = await listUsbDevices()
      const baseSnapshot: DslogicBackendProbeSnapshot = {
        platform,
        checkedAt,
        backend: {
          state: DSLOGIC_SUPPORTED_HOST_PLATFORMS.includes(platform)
            ? "missing"
            : "unsupported-os",
          executablePath: null,
          version: null
        },
        devices,
        diagnostics: []
      }

      if (!DSLOGIC_SUPPORTED_HOST_PLATFORMS.includes(platform)) {
        return {
          ...baseSnapshot,
          backend: {
            ...baseSnapshot.backend,
            state: "unsupported-os"
          }
        }
      }

      const executablePath = await locateExecutable(DSLOGIC_BACKEND_EXECUTABLE)
      if (!executablePath) {
        return {
          ...baseSnapshot,
          backend: {
            ...baseSnapshot.backend,
            state: "missing"
          }
        }
      }

      try {
        const { stdout, stderr } = await runCommand(executablePath, ["--version"], {
          timeoutMs
        })
        const version = parseVersionFromOutput(`${stdout}\n${stderr}`)

        if (!version) {
          return {
            ...baseSnapshot,
            backend: {
              state: "malformed",
              executablePath,
              version: null
            }
          }
        }

        return {
          ...baseSnapshot,
          backend: {
            state: "ready",
            executablePath,
            version
          }
        }
      } catch (error) {
        if (error instanceof Error && error.name === "TimeoutError") {
          return {
            ...baseSnapshot,
            backend: {
              state: "timeout",
              executablePath,
              version: null
            }
          }
        }

        return {
          ...baseSnapshot,
          backend: {
            state: "failed",
            executablePath,
            version: null
          }
        }
      }
    }
  }
}
