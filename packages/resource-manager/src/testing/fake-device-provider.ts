import type {
  DeviceProvider,
  DiscoveredDevice
} from "../device-provider.js";

const cloneDevice = (device: DiscoveredDevice): DiscoveredDevice => ({ ...device });

export class FakeDeviceProvider implements DeviceProvider {
  #devices: DiscoveredDevice[];

  constructor(initialDevices: readonly DiscoveredDevice[] = []) {
    this.#devices = initialDevices.map(cloneDevice);
  }

  async listConnectedDevices(): Promise<readonly DiscoveredDevice[]> {
    return this.#devices.map(cloneDevice);
  }

  setConnectedDevices(devices: readonly DiscoveredDevice[]): void {
    this.#devices = devices.map(cloneDevice);
  }
}
