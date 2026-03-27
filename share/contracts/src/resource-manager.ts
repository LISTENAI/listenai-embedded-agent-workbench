import type {
  AllocationRequest,
  AllocationResult,
  DeviceRecord,
  ReleaseRequest,
  ReleaseResult
} from "./contracts.js";

export interface ResourceManager {
  refreshInventory(): Promise<readonly DeviceRecord[]>;
  listDevices(): Promise<readonly DeviceRecord[]>;
  allocateDevice(request: AllocationRequest): Promise<AllocationResult>;
  releaseDevice(request: ReleaseRequest): Promise<ReleaseResult>;
}
