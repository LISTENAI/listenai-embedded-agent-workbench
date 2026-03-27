// Keep the root package as a thin compatibility layer over workspace-owned packages.
export * from "@listenai/contracts";
export * from "@listenai/skill-logic-analyzer";
export { HttpResourceManager } from "@listenai/resource-client";
export {
  FakeDeviceProvider,
  InMemoryResourceManager,
  createResourceManager,
  type DeviceProvider,
  type DiscoveredDevice,
  type ResourceManagerOptions,
} from "@listenai/resource-manager";
