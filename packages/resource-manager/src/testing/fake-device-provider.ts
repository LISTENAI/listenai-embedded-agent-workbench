import type {
  BackendReadinessRecord,
  DeviceOptionsFailure,
  DeviceOptionsRequest,
  DeviceOptionsResult,
  DeviceRecord,
  DslogicDeviceIdentity,
  InventoryDiagnostic,
  InventorySnapshot,
  LiveCaptureFailure,
  LiveCaptureRequest,
  LiveCaptureResult
} from "@listenai/contracts";
import type {
  DeviceOptionsProvider,
  DeviceProvider,
  DiscoveredDevice,
  LiveCaptureProvider
} from "../device-provider.js";

const DEFAULT_REFRESHED_AT = "1970-01-01T00:00:00.000Z";

const cloneDiagnostic = (
  diagnostic: InventoryDiagnostic
): InventoryDiagnostic => ({ ...diagnostic });

const cloneDslogicIdentity = (
  identity: DslogicDeviceIdentity | null | undefined
): DslogicDeviceIdentity | null | undefined =>
  identity ? { ...identity } : identity;

const cloneDeviceRecord = (record: DeviceRecord): DeviceRecord => ({
  ...record,
  diagnostics: record.diagnostics?.map(cloneDiagnostic),
  canonicalIdentity: record.canonicalIdentity
    ? { ...record.canonicalIdentity }
    : record.canonicalIdentity,
  dslogic: cloneDslogicIdentity(record.dslogic)
});

const cloneBackendReadiness = (
  record: BackendReadinessRecord
): BackendReadinessRecord => ({
  ...record,
  diagnostics: record.diagnostics.map(cloneDiagnostic)
});

const collectUniqueKinds = <T extends string>(values: Iterable<T | null | undefined>): T[] => {
  const unique: T[] = [];

  for (const value of values) {
    if (!value || unique.includes(value)) {
      continue;
    }
    unique.push(value);
  }

  return unique;
};

const inferInventoryScope = (snapshot: InventorySnapshot): InventorySnapshot["inventoryScope"] => {
  const providerKinds = collectUniqueKinds([
    ...snapshot.inventoryScope?.providerKinds ?? [],
    ...snapshot.devices.map((device) => device.providerKind)
  ]);
  const backendKinds = collectUniqueKinds([
    ...snapshot.inventoryScope?.backendKinds ?? [],
    ...snapshot.devices.map((device) => device.backendKind),
    ...snapshot.backendReadiness.map((backend) => backend.backendKind)
  ]);

  return {
    providerKinds: providerKinds.length > 0 ? providerKinds : ["fake"],
    backendKinds: backendKinds.length > 0 ? backendKinds : ["fake"]
  };
};

const cloneInventorySnapshot = (snapshot: InventorySnapshot): InventorySnapshot => ({
  ...snapshot,
  inventoryScope: inferInventoryScope(snapshot),
  devices: snapshot.devices.map(cloneDeviceRecord),
  backendReadiness: snapshot.backendReadiness.map(cloneBackendReadiness),
  diagnostics: snapshot.diagnostics.map(cloneDiagnostic)
});

const toDeviceRecord = (device: DiscoveredDevice): DeviceRecord => ({
  deviceId: device.deviceId,
  label: device.label,
  capabilityType: device.capabilityType,
  connectionState: "connected",
  allocationState: "free",
  ownerSkillId: null,
  lastSeenAt: device.lastSeenAt,
  updatedAt: device.lastSeenAt,
  readiness: "ready",
  diagnostics: [],
  providerKind: "fake",
  backendKind: "fake",
  dslogic: null
});

const buildSnapshotFromDevices = (
  devices: readonly DiscoveredDevice[]
): InventorySnapshot => {
  const readyDevices = devices.map(toDeviceRecord);
  const refreshedAt =
    readyDevices[0]?.updatedAt ??
    devices[0]?.lastSeenAt ??
    DEFAULT_REFRESHED_AT;

  return {
    refreshedAt,
    inventoryScope: {
      providerKinds: ["fake"],
      backendKinds: ["fake"]
    },
    devices: readyDevices,
    backendReadiness: [],
    diagnostics: []
  };
};

const isInventorySnapshot = (
  value: readonly DiscoveredDevice[] | InventorySnapshot
): value is InventorySnapshot =>
  !Array.isArray(value) &&
  typeof value === "object" &&
  value !== null &&
  "devices" in value &&
  "refreshedAt" in value;

const toDiscoveredDevice = (
  record: DeviceRecord,
  refreshedAt: string
): DiscoveredDevice => ({
  deviceId: record.deviceId,
  label: record.label,
  capabilityType: record.capabilityType,
  lastSeenAt: record.lastSeenAt ?? record.updatedAt ?? refreshedAt
});

const isCompatibilityVisible = (record: DeviceRecord): boolean =>
  record.connectionState === "connected" &&
  (record.readiness === undefined || record.readiness === "ready");

const supportsFakeRuntime = (
  device: Pick<DeviceRecord, "providerKind" | "backendKind">
): boolean => device.providerKind === "fake" && device.backendKind === "fake";

const buildUnsupportedFakeOptions = (
  request: DeviceOptionsRequest
): DeviceOptionsFailure => ({
  ok: false,
  reason: "device-options-failed",
  kind: "unsupported-runtime",
  message: "Device options are not supported by the fake provider/backend.",
  session: request.session,
  requestedAt: request.requestedAt,
  capabilities: null,
  diagnostics: {
    phase: "validate-session",
    providerKind: request.session.device.providerKind ?? null,
    backendKind: request.session.device.backendKind ?? null,
    backendVersion: null,
    timeoutMs: request.timeoutMs ?? null,
    nativeCode: null,
    optionsOutput: null,
    diagnosticOutput: null,
    details: [
      "Fake provider inventory can drive allocation flows but does not implement device-options inspection.",
      "Use the DSLogic provider/backend to exercise real device-options lookup."
    ],
    diagnostics: request.session.device.diagnostics ?? []
  }
});

const buildUnsupportedFakeCapture = (
  request: LiveCaptureRequest
): LiveCaptureFailure => ({
  ok: false,
  reason: "capture-failed",
  kind: "unsupported-runtime",
  message: "Live capture is not supported by the fake provider/backend.",
  session: request.session,
  requestedAt: request.requestedAt,
  artifactSummary: null,
  diagnostics: {
    phase: "validate-session",
    providerKind: request.session.device.providerKind ?? null,
    backendKind: request.session.device.backendKind ?? null,
    backendVersion: null,
    timeoutMs: request.timeoutMs ?? null,
    nativeCode: null,
    captureOutput: null,
    diagnosticOutput: null,
    details: [
      "Fake provider inventory can drive allocation flows but does not implement live capture.",
      "Use the DSLogic provider/backend to exercise real live capture."
    ],
    diagnostics: request.session.device.diagnostics ?? []
  }
});

const fakeDeviceOptionsProvider: DeviceOptionsProvider = {
  supportsDevice: supportsFakeRuntime,
  inspectDeviceOptions: async (request): Promise<DeviceOptionsResult> =>
    buildUnsupportedFakeOptions(request)
};

const fakeLiveCaptureProvider: LiveCaptureProvider = {
  supportsDevice: supportsFakeRuntime,
  liveCapture: async (request): Promise<LiveCaptureResult> =>
    buildUnsupportedFakeCapture(request)
};

export class FakeDeviceProvider implements DeviceProvider {
  #snapshot: InventorySnapshot;
  readonly deviceOptions = fakeDeviceOptionsProvider;
  readonly liveCapture = fakeLiveCaptureProvider;

  constructor(initialState: readonly DiscoveredDevice[] | InventorySnapshot = []) {
    this.#snapshot = isInventorySnapshot(initialState)
      ? cloneInventorySnapshot(initialState)
      : buildSnapshotFromDevices(initialState);
  }

  async listInventorySnapshot(): Promise<InventorySnapshot> {
    return cloneInventorySnapshot(this.#snapshot);
  }

  async listConnectedDevices(): Promise<readonly DiscoveredDevice[]> {
    return this.#snapshot.devices
      .filter(isCompatibilityVisible)
      .map((record) => toDiscoveredDevice(record, this.#snapshot.refreshedAt));
  }

  setInventorySnapshot(snapshot: InventorySnapshot): void {
    this.#snapshot = cloneInventorySnapshot(snapshot);
  }

  setConnectedDevices(devices: readonly DiscoveredDevice[]): void {
    this.#snapshot = buildSnapshotFromDevices(devices);
  }
}
