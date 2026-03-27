export interface DiscoveredDevice {
  deviceId: string;
  label: string;
  capabilityType: string;
  lastSeenAt: string;
}

export interface DeviceProvider {
  listConnectedDevices(): Promise<readonly DiscoveredDevice[]>;
}
