import type {
  AllocationRequest,
  AllocationResult,
  DeviceRecord,
  ReleaseRequest,
  ReleaseResult,
  ResourceManager
} from "@listenai/contracts";
import type { DeviceProvider, DiscoveredDevice } from "./device-provider.js";

export type { ResourceManager } from "@listenai/contracts";

export interface ResourceManagerOptions {
  now?: () => string;
}

interface AllocationStateSnapshot {
  ownerSkillId: string;
  allocatedAt: string;
}

const cloneRecord = (record: DeviceRecord): DeviceRecord => ({ ...record });

const sortDevices = (devices: Iterable<DeviceRecord>): DeviceRecord[] =>
  Array.from(devices, cloneRecord).sort((left, right) =>
    left.deviceId.localeCompare(right.deviceId)
  );

const createRecordFromDiscovery = (
  discovered: DiscoveredDevice,
  updatedAt: string,
  allocation?: AllocationStateSnapshot
): DeviceRecord => ({
  deviceId: discovered.deviceId,
  label: discovered.label,
  capabilityType: discovered.capabilityType,
  connectionState: "connected",
  allocationState: allocation ? "allocated" : "free",
  ownerSkillId: allocation?.ownerSkillId ?? null,
  lastSeenAt: discovered.lastSeenAt,
  updatedAt
});

export class InMemoryResourceManager implements ResourceManager {
  readonly #provider: DeviceProvider;
  readonly #now: () => string;
  readonly #inventory = new Map<string, DeviceRecord>();
  readonly #allocations = new Map<string, AllocationStateSnapshot>();

  constructor(provider: DeviceProvider, options: ResourceManagerOptions = {}) {
    this.#provider = provider;
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  async refreshInventory(): Promise<readonly DeviceRecord[]> {
    const updatedAt = this.#now();
    const connectedDevices = await this.#provider.listConnectedDevices();
    const seenDeviceIds = new Set<string>();

    for (const discovered of connectedDevices) {
      seenDeviceIds.add(discovered.deviceId);
      const allocation = this.#allocations.get(discovered.deviceId);
      this.#inventory.set(
        discovered.deviceId,
        createRecordFromDiscovery(discovered, updatedAt, allocation)
      );
    }

    for (const [deviceId, record] of this.#inventory) {
      if (seenDeviceIds.has(deviceId)) {
        continue;
      }

      const allocation = this.#allocations.get(deviceId);
      if (!allocation) {
        this.#inventory.delete(deviceId);
        continue;
      }

      this.#inventory.set(deviceId, {
        ...record,
        connectionState: "disconnected",
        allocationState: "allocated",
        ownerSkillId: allocation.ownerSkillId,
        updatedAt
      });
    }

    return this.listDevices();
  }

  async listDevices(): Promise<readonly DeviceRecord[]> {
    return sortDevices(this.#inventory.values());
  }

  async allocateDevice(request: AllocationRequest): Promise<AllocationResult> {
    const device = this.#inventory.get(request.deviceId);
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
      ...device,
      allocationState: "allocated",
      ownerSkillId: request.ownerSkillId,
      updatedAt: request.requestedAt
    };

    this.#allocations.set(request.deviceId, {
      ownerSkillId: request.ownerSkillId,
      allocatedAt: request.requestedAt
    });
    this.#inventory.set(request.deviceId, updatedDevice);

    return {
      ok: true,
      device: cloneRecord(updatedDevice)
    };
  }

  async releaseDevice(request: ReleaseRequest): Promise<ReleaseResult> {
    const device = this.#inventory.get(request.deviceId);
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
      ...device,
      allocationState: "free",
      ownerSkillId: null,
      updatedAt: request.releasedAt
    };

    this.#allocations.delete(request.deviceId);

    if (releasedDevice.connectionState === "disconnected") {
      this.#inventory.delete(request.deviceId);
    } else {
      this.#inventory.set(request.deviceId, releasedDevice);
    }

    return {
      ok: true,
      device: cloneRecord(releasedDevice)
    };
  }
}

export const createResourceManager = (
  provider: DeviceProvider,
  options?: ResourceManagerOptions
): ResourceManager => new InMemoryResourceManager(provider, options);
