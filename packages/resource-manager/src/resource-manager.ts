import type {
  AllocationRequest,
  AllocationResult,
  DeviceOptionsFailure,
  DeviceOptionsRequest,
  DeviceOptionsResult,
  DeviceRecord,
  InventoryDiagnostic,
  InventorySnapshot,
  LiveCaptureFailure,
  LiveCaptureRequest,
  LiveCaptureResult,
  ReleaseRequest,
  ReleaseResult,
  SnapshotResourceManager
} from "@listenai/contracts";
import {
  createDslogicDeviceOptionsProvider,
  createDslogicLiveCaptureProvider,
  type DslogicDeviceOptionsRunner,
  type DslogicLiveCaptureRunner
} from "./dslogic/live-capture.js";
import type {
  DeviceOptionsProvider,
  DeviceProviderInput,
  LiveCaptureProvider,
  RegisteredDeviceProvider
} from "./device-provider.js";
import {
  isDeviceOptionsProvider,
  isLiveCaptureProvider,
  normalizeDeviceProviders
} from "./device-provider.js";

export type { ResourceManager, SnapshotResourceManager } from "@listenai/contracts";

export interface ResourceManagerOptions {
  now?: () => string;
  deviceOptionsRunner?: DslogicDeviceOptionsRunner;
  liveCaptureRunner?: DslogicLiveCaptureRunner;
}

interface AllocationStateSnapshot {
  ownerSkillId: string;
  allocatedAt: string;
}

const EMPTY_SNAPSHOT: InventorySnapshot = {
  refreshedAt: "1970-01-01T00:00:00.000Z",
  inventoryScope: {
    providerKinds: ["fake"],
    backendKinds: ["fake"]
  },
  devices: [],
  backendReadiness: [],
  diagnostics: []
};

const buildDeviceOptionsFailure = (
  request: DeviceOptionsRequest,
  kind: DeviceOptionsFailure["kind"],
  message: string,
  details: readonly string[],
  device: DeviceRecord = request.session.device,
  overrides: Partial<DeviceOptionsFailure["diagnostics"]> = {}
): DeviceOptionsFailure => ({
  ok: false,
  reason: "device-options-failed",
  kind,
  message,
  session: request.session,
  requestedAt: request.requestedAt,
  capabilities: null,
  diagnostics: {
    phase: overrides.phase ?? "validate-session",
    providerKind: overrides.providerKind ?? device.providerKind ?? null,
    backendKind: overrides.backendKind ?? device.backendKind ?? null,
    backendVersion: overrides.backendVersion ?? null,
    timeoutMs: overrides.timeoutMs ?? request.timeoutMs ?? null,
    nativeCode: overrides.nativeCode ?? null,
    optionsOutput: overrides.optionsOutput ?? null,
    diagnosticOutput: overrides.diagnosticOutput ?? null,
    details,
    diagnostics: overrides.diagnostics ?? device.diagnostics ?? []
  }
});

const buildAuthoritativeSessionFailure = (
  request: LiveCaptureRequest,
  message: string,
  details: readonly string[]
): LiveCaptureFailure => ({
  ok: false,
  reason: "capture-failed",
  kind: "unsupported-runtime",
  message,
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
    details,
    diagnostics: request.session.device.diagnostics ?? []
  }
});

const buildUnsupportedProviderFailure = (
  request: LiveCaptureRequest,
  message: string,
  details: readonly string[]
): LiveCaptureFailure => ({
  ok: false,
  reason: "capture-failed",
  kind: "unsupported-runtime",
  message,
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
    details,
    diagnostics: request.session.device.diagnostics ?? []
  }
});

const collectDeviceOptionsProviders = (
  providers: readonly RegisteredDeviceProvider[],
  legacyDeviceOptionsRunner?: DslogicDeviceOptionsRunner
): readonly DeviceOptionsProvider[] => {
  const dispatchProviders = providers.flatMap(({ provider }) =>
    isDeviceOptionsProvider(provider.deviceOptions) ? [provider.deviceOptions] : []
  );

  if (!legacyDeviceOptionsRunner) {
    return dispatchProviders;
  }

  return [
    ...dispatchProviders,
    createDslogicDeviceOptionsProvider(legacyDeviceOptionsRunner)
  ];
};

const collectLiveCaptureProviders = (
  providers: readonly RegisteredDeviceProvider[],
  legacyLiveCaptureRunner?: DslogicLiveCaptureRunner
): readonly LiveCaptureProvider[] => {
  const dispatchProviders = providers.flatMap(({ provider }) =>
    isLiveCaptureProvider(provider.liveCapture) ? [provider.liveCapture] : []
  );

  if (!legacyLiveCaptureRunner) {
    return dispatchProviders;
  }

  return [
    ...dispatchProviders,
    createDslogicLiveCaptureProvider(legacyLiveCaptureRunner)
  ];
};

const cloneDiagnostic = (
  diagnostic: InventoryDiagnostic
): InventoryDiagnostic => ({ ...diagnostic });

const cloneRecord = (record: DeviceRecord): DeviceRecord => {
  const clone: DeviceRecord = {
    ...record,
    diagnostics: record.diagnostics?.map(cloneDiagnostic),
    dslogic: record.dslogic ? { ...record.dslogic } : record.dslogic
  };

  if (record.canonicalIdentity === undefined) {
    delete (clone as Partial<DeviceRecord>).canonicalIdentity;
  } else {
    clone.canonicalIdentity = record.canonicalIdentity
      ? { ...record.canonicalIdentity }
      : record.canonicalIdentity;
  }

  return clone;
};

const cloneSnapshot = (snapshot: InventorySnapshot): InventorySnapshot => ({
  ...snapshot,
  inventoryScope: {
    providerKinds: [...snapshot.inventoryScope.providerKinds],
    backendKinds: [...snapshot.inventoryScope.backendKinds]
  },
  devices: snapshot.devices.map(cloneRecord),
  backendReadiness: snapshot.backendReadiness.map((record) => ({
    ...record,
    diagnostics: record.diagnostics.map(cloneDiagnostic)
  })),
  diagnostics: snapshot.diagnostics.map(cloneDiagnostic)
});

const appendUnique = <T extends string>(target: T[], values: readonly T[]): void => {
  for (const value of values) {
    if (!target.includes(value)) {
      target.push(value);
    }
  }
};

const mergeProviderSnapshots = (
  snapshots: readonly InventorySnapshot[]
): InventorySnapshot => {
  if (snapshots.length === 0) {
    return cloneSnapshot(EMPTY_SNAPSHOT);
  }

  const providerKinds: Array<InventorySnapshot["inventoryScope"]["providerKinds"][number]> = [];
  const backendKinds: Array<InventorySnapshot["inventoryScope"]["backendKinds"][number]> = [];
  const devices: DeviceRecord[] = [];
  const backendReadiness: Array<InventorySnapshot["backendReadiness"][number]> = [];
  const diagnostics: Array<InventorySnapshot["diagnostics"][number]> = [];

  for (const snapshot of snapshots) {
    appendUnique(providerKinds, snapshot.inventoryScope.providerKinds);
    appendUnique(backendKinds, snapshot.inventoryScope.backendKinds);
    devices.push(...snapshot.devices.map(cloneRecord));
    backendReadiness.push(
      ...snapshot.backendReadiness.map((record) => ({
        ...record,
        diagnostics: record.diagnostics.map(cloneDiagnostic)
      }))
    );
    diagnostics.push(...snapshot.diagnostics.map(cloneDiagnostic));
  }

  return {
    refreshedAt: snapshots[snapshots.length - 1]?.refreshedAt ?? EMPTY_SNAPSHOT.refreshedAt,
    inventoryScope: {
      providerKinds,
      backendKinds
    },
    devices,
    backendReadiness,
    diagnostics
  };
};

const sortDevices = (devices: Iterable<DeviceRecord>): DeviceRecord[] =>
  Array.from(devices, cloneRecord).sort((left, right) => {
    const byDeviceId = left.deviceId.localeCompare(right.deviceId);
    if (byDeviceId !== 0) {
      return byDeviceId;
    }

    return getDeviceStorageKey(left).localeCompare(getDeviceStorageKey(right));
  });

const getDeviceStorageKey = (record: DeviceRecord): string =>
  record.canonicalIdentity?.canonicalKey ?? record.deviceId;

const setAllocationState = (
  record: DeviceRecord,
  allocation: AllocationStateSnapshot | undefined,
  updatedAt: string,
  connectionState: DeviceRecord["connectionState"] = record.connectionState
): DeviceRecord => {
  const nextRecord: DeviceRecord = {
    ...cloneRecord(record),
    connectionState,
    allocationState: allocation ? "allocated" : "free",
    ownerSkillId: allocation?.ownerSkillId ?? null
  };

  if (
    allocation ||
    connectionState !== record.connectionState ||
    record.readiness === "ready"
  ) {
    nextRecord.updatedAt = updatedAt;
  }

  return nextRecord;
};

const createDisconnectedAllocatedRecord = (
  record: DeviceRecord,
  allocation: AllocationStateSnapshot,
  updatedAt: string
): DeviceRecord =>
  setAllocationState(record, allocation, updatedAt, "disconnected");

export class InMemoryResourceManager implements SnapshotResourceManager {
  readonly #providers: readonly RegisteredDeviceProvider[];
  readonly #now: () => string;
  readonly #deviceOptionsProviders: readonly DeviceOptionsProvider[];
  readonly #liveCaptureProviders: readonly LiveCaptureProvider[];
  readonly #allocations = new Map<string, AllocationStateSnapshot>();
  #snapshot: InventorySnapshot = cloneSnapshot(EMPTY_SNAPSHOT);

  constructor(providers: DeviceProviderInput, options: ResourceManagerOptions = {}) {
    this.#providers = normalizeDeviceProviders(providers);
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#deviceOptionsProviders = collectDeviceOptionsProviders(
      this.#providers,
      options.deviceOptionsRunner
    );
    this.#liveCaptureProviders = collectLiveCaptureProviders(
      this.#providers,
      options.liveCaptureRunner
    );
  }

  async refreshInventory(): Promise<readonly DeviceRecord[]> {
    const snapshot = await this.refreshInventorySnapshot();
    return sortDevices(snapshot.devices);
  }

  async refreshInventorySnapshot(): Promise<InventorySnapshot> {
    const providerSnapshots = await Promise.all(
      this.#providers.map(({ provider }) => provider.listInventorySnapshot().then(cloneSnapshot))
    );
    const providerSnapshot = mergeProviderSnapshots(providerSnapshots);
    const updatedAt = this.#now();
    const nextDevices = new Map<string, DeviceRecord>();

    for (const discovered of providerSnapshot.devices) {
      const allocation = this.#allocations.get(discovered.deviceId);
      nextDevices.set(
        getDeviceStorageKey(discovered),
        setAllocationState(discovered, allocation, updatedAt)
      );
    }

    for (const [deviceId, allocation] of this.#allocations) {
      const previousRecord = this.#findStoredDevice(deviceId);
      if (!previousRecord) {
        continue;
      }

      const storageKey = getDeviceStorageKey(previousRecord);
      if (nextDevices.has(storageKey)) {
        continue;
      }

      nextDevices.set(
        storageKey,
        createDisconnectedAllocatedRecord(previousRecord, allocation, updatedAt)
      );
    }

    this.#snapshot = {
      ...providerSnapshot,
      refreshedAt: updatedAt,
      devices: Array.from(nextDevices.values())
    };

    return cloneSnapshot(this.#snapshot);
  }

  async listDevices(): Promise<readonly DeviceRecord[]> {
    return sortDevices(this.#snapshot.devices);
  }

  async getInventorySnapshot(): Promise<InventorySnapshot> {
    return cloneSnapshot(this.#snapshot);
  }

  async allocateDevice(request: AllocationRequest): Promise<AllocationResult> {
    const device = this.#findStoredDevice(request.deviceId);
    if (!device) {
      return {
        ok: false,
        reason: "device-not-found",
        deviceId: request.deviceId,
        ownerSkillId: request.ownerSkillId,
        message: `Device ${request.deviceId} is not present in inventory.`,
        device: null
      };
    }

    if (device.connectionState === "disconnected") {
      return {
        ok: false,
        reason: "device-disconnected",
        deviceId: request.deviceId,
        ownerSkillId: request.ownerSkillId,
        message: `Device ${request.deviceId} is disconnected and cannot be allocated.`,
        device: cloneRecord(device)
      };
    }

    if (device.allocationState === "allocated") {
      if (device.ownerSkillId === request.ownerSkillId) {
        return {
          ok: true,
          device: cloneRecord(device)
        };
      }

      return {
        ok: false,
        reason: "device-already-allocated",
        deviceId: request.deviceId,
        ownerSkillId: request.ownerSkillId,
        message: `Device ${request.deviceId} is already allocated to ${device.ownerSkillId}.`,
        device: cloneRecord(device)
      };
    }

    const updatedDevice: DeviceRecord = {
      ...cloneRecord(device),
      allocationState: "allocated",
      ownerSkillId: request.ownerSkillId,
      updatedAt: request.requestedAt
    };

    this.#allocations.set(request.deviceId, {
      ownerSkillId: request.ownerSkillId,
      allocatedAt: request.requestedAt
    });
    this.#setStoredDevice(updatedDevice);

    return {
      ok: true,
      device: cloneRecord(updatedDevice)
    };
  }

  async releaseDevice(request: ReleaseRequest): Promise<ReleaseResult> {
    const device = this.#findStoredDevice(request.deviceId);
    if (!device) {
      return {
        ok: false,
        reason: "device-not-found",
        deviceId: request.deviceId,
        ownerSkillId: request.ownerSkillId,
        message: `Device ${request.deviceId} is not present in inventory.`,
        device: null
      };
    }

    if (device.allocationState !== "allocated" || !device.ownerSkillId) {
      return {
        ok: false,
        reason: "device-not-allocated",
        deviceId: request.deviceId,
        ownerSkillId: request.ownerSkillId,
        message: `Device ${request.deviceId} is not currently allocated.`,
        device: cloneRecord(device)
      };
    }

    if (device.ownerSkillId !== request.ownerSkillId) {
      return {
        ok: false,
        reason: "owner-mismatch",
        deviceId: request.deviceId,
        ownerSkillId: request.ownerSkillId,
        message: `Device ${request.deviceId} is allocated to ${device.ownerSkillId}, not ${request.ownerSkillId}.`,
        device: cloneRecord(device)
      };
    }

    const releasedDevice: DeviceRecord = {
      ...cloneRecord(device),
      allocationState: "free",
      ownerSkillId: null,
      updatedAt: request.releasedAt
    };

    this.#allocations.delete(request.deviceId);

    if (releasedDevice.connectionState === "disconnected") {
      this.#deleteStoredDevice(request.deviceId);
    } else {
      this.#setStoredDevice(releasedDevice);
    }

    return {
      ok: true,
      device: cloneRecord(releasedDevice)
    };
  }

  async inspectDeviceOptions(request: DeviceOptionsRequest): Promise<DeviceOptionsResult> {
    const authoritativeDevice = this.#findStoredDevice(request.session.deviceId);
    if (!authoritativeDevice) {
      return buildDeviceOptionsFailure(
        request,
        "device-not-found",
        `Cannot inspect options for unknown device ${request.session.deviceId}.`,
        [
          `Device ${request.session.deviceId} is not present in authoritative inventory.`,
          "Option inspection requests must target a device that is still visible to the resource manager."
        ]
      );
    }

    if (authoritativeDevice.allocationState !== "allocated") {
      return buildDeviceOptionsFailure(
        request,
        "device-not-allocated",
        `Cannot inspect options for unallocated device ${request.session.deviceId}.`,
        [
          `Authoritative allocation state is ${authoritativeDevice.allocationState}.`,
          "Option inspection requests must use an active allocated session."
        ],
        authoritativeDevice
      );
    }

    if (authoritativeDevice.ownerSkillId !== request.session.ownerSkillId) {
      return buildDeviceOptionsFailure(
        request,
        "owner-mismatch",
        `Cannot inspect options for device ${request.session.deviceId} as owner ${request.session.ownerSkillId}.`,
        [
          `Authoritative owner is ${authoritativeDevice.ownerSkillId ?? "unowned"}.`,
          "Option inspection requests must use the currently allocated owner for the accepted session."
        ],
        authoritativeDevice
      );
    }

    const dispatchedRequest: DeviceOptionsRequest = {
      ...request,
      session: {
        ...request.session,
        device: cloneRecord(authoritativeDevice)
      }
    };
    const deviceOptionsProvider = this.#deviceOptionsProviders.find((provider) =>
      provider.supportsDevice(authoritativeDevice)
    );

    if (!deviceOptionsProvider) {
      return buildDeviceOptionsFailure(
        dispatchedRequest,
        "unsupported-runtime",
        `Device options are not configured for provider ${authoritativeDevice.providerKind ?? "unknown"} with backend ${authoritativeDevice.backendKind ?? "unknown"}.`,
        [
          `No registered device-options provider accepted provider ${authoritativeDevice.providerKind ?? "unknown"}.`,
          `No registered device-options provider accepted backend ${authoritativeDevice.backendKind ?? "unknown"}.`,
          "Configure a provider-specific device-options handler for the authoritative device runtime."
        ],
        authoritativeDevice
      );
    }

    try {
      return await deviceOptionsProvider.inspectDeviceOptions(dispatchedRequest);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return buildDeviceOptionsFailure(
        dispatchedRequest,
        "native-error",
        `Device options provider failed while inspecting device ${request.session.deviceId}.`,
        [
          "Device-options provider threw during inspection dispatch.",
          detail
        ],
        authoritativeDevice,
        { phase: "inspect-options" }
      );
    }
  }

  async liveCapture(request: LiveCaptureRequest): Promise<LiveCaptureResult> {
    const authoritativeDevice = this.#findStoredDevice(request.session.deviceId);
    if (!authoritativeDevice) {
      return buildAuthoritativeSessionFailure(
        request,
        `Cannot capture from unknown device ${request.session.deviceId}.`,
        [
          `Device ${request.session.deviceId} is not present in authoritative inventory.`,
          "Accepted sessions must target a device that is still visible to the resource manager."
        ]
      );
    }

    if (
      authoritativeDevice.allocationState !== "allocated" ||
      authoritativeDevice.ownerSkillId !== request.session.ownerSkillId
    ) {
      return buildAuthoritativeSessionFailure(
        request,
        `Cannot capture from device ${request.session.deviceId} for owner ${request.session.ownerSkillId}.`,
        [
          `Authoritative allocation state is ${authoritativeDevice.allocationState}.`,
          `Authoritative owner is ${authoritativeDevice.ownerSkillId ?? "unowned"}.`,
          "Live capture requests must use the currently allocated owner for the accepted session."
        ]
      );
    }

    const dispatchedRequest: LiveCaptureRequest = {
      ...request,
      session: {
        ...request.session,
        device: cloneRecord(authoritativeDevice)
      }
    };
    const liveCaptureProvider = this.#liveCaptureProviders.find((provider) =>
      provider.supportsDevice(authoritativeDevice)
    );

    if (!liveCaptureProvider) {
      return buildUnsupportedProviderFailure(
        dispatchedRequest,
        `Live capture is not configured for provider ${authoritativeDevice.providerKind ?? "unknown"} with backend ${authoritativeDevice.backendKind ?? "unknown"}.`,
        [
          `No registered live-capture provider accepted provider ${authoritativeDevice.providerKind ?? "unknown"}.`,
          `No registered live-capture provider accepted backend ${authoritativeDevice.backendKind ?? "unknown"}.`,
          "Configure a provider-specific live-capture handler for the authoritative device runtime."
        ]
      );
    }

    return liveCaptureProvider.liveCapture(dispatchedRequest);
  }

  #findStoredDevice(deviceId: string): DeviceRecord | undefined {
    return this.#snapshot.devices.find((record) => record.deviceId === deviceId);
  }

  #setStoredDevice(record: DeviceRecord): void {
    const storageKey = getDeviceStorageKey(record);
    const nextDevices = this.#snapshot.devices.filter(
      (candidate) => getDeviceStorageKey(candidate) !== storageKey
    );
    nextDevices.push(cloneRecord(record));
    this.#snapshot = {
      ...this.#snapshot,
      devices: nextDevices
    };
  }

  #deleteStoredDevice(deviceId: string): void {
    this.#snapshot = {
      ...this.#snapshot,
      devices: this.#snapshot.devices.filter((record) => record.deviceId !== deviceId)
    };
  }
}

export const createResourceManager = (
  providers: DeviceProviderInput,
  options?: ResourceManagerOptions
): SnapshotResourceManager => new InMemoryResourceManager(providers, options);
