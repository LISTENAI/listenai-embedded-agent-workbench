import type {
  CaptureDecodeRequest,
  CaptureDecodeResult,
  DecoderCapabilitiesRequest,
  DecoderCapabilitiesResult,
  DeviceOptionsRequest,
  DeviceOptionsResult,
  DeviceRecord,
  InventorySnapshot,
  LiveCaptureRequest,
  LiveCaptureResult
} from "@listenai/eaw-contracts";

export interface DiscoveredDevice {
  deviceId: string;
  label: string;
  capabilityType: string;
  lastSeenAt: string;
}

export interface LiveCaptureProvider {
  supportsDevice(device: DeviceRecord): boolean;
  liveCapture(request: LiveCaptureRequest): Promise<LiveCaptureResult>;
}

export interface DeviceOptionsProvider {
  supportsDevice(device: DeviceRecord): boolean;
  inspectDeviceOptions(request: DeviceOptionsRequest): Promise<DeviceOptionsResult>;
}

export interface DecoderCapabilityProvider {
  supportsDevice(device: DeviceRecord): boolean;
  listDecoderCapabilities(request: DecoderCapabilitiesRequest): Promise<DecoderCapabilitiesResult>;
}

export interface CaptureDecodeProvider {
  supportsDevice(device: DeviceRecord): boolean;
  captureDecode(request: CaptureDecodeRequest): Promise<CaptureDecodeResult>;
}

export interface DeviceProvider {
  listInventorySnapshot(): Promise<InventorySnapshot>;
  listConnectedDevices(): Promise<readonly DiscoveredDevice[]>;
  deviceOptions?: DeviceOptionsProvider;
  decoderCapabilities?: DecoderCapabilityProvider;
  captureDecode?: CaptureDecodeProvider;
  liveCapture?: LiveCaptureProvider;
}

export interface RegisteredDeviceProvider {
  providerId: string;
  provider: DeviceProvider;
}

export type DeviceProviderInput =
  | DeviceProvider
  | readonly RegisteredDeviceProvider[]
  | ReadonlyMap<string, DeviceProvider>;

const isDeviceProvider = (value: DeviceProviderInput): value is DeviceProvider =>
  typeof value === "object" &&
  value !== null &&
  "listInventorySnapshot" in value &&
  typeof value.listInventorySnapshot === "function" &&
  "listConnectedDevices" in value &&
  typeof value.listConnectedDevices === "function";

const isRegisteredDeviceProviderList = (
  value: DeviceProviderInput
): value is readonly RegisteredDeviceProvider[] => Array.isArray(value);

const cloneRegisteredProviders = (
  providers: readonly RegisteredDeviceProvider[]
): RegisteredDeviceProvider[] =>
  providers.map((entry) => ({
    providerId: entry.providerId,
    provider: entry.provider
  }));

const normalizeProviderMapEntries = (
  providers: ReadonlyMap<string, DeviceProvider>
): RegisteredDeviceProvider[] =>
  [...providers.entries()].map(([providerId, provider]) => ({
    providerId,
    provider
  }));

export const isLiveCaptureProvider = (
  value: DeviceProvider["liveCapture"]
): value is LiveCaptureProvider =>
  typeof value === "object" &&
  value !== null &&
  "supportsDevice" in value &&
  typeof value.supportsDevice === "function" &&
  "liveCapture" in value &&
  typeof value.liveCapture === "function";

export const isDeviceOptionsProvider = (
  value: DeviceProvider["deviceOptions"]
): value is DeviceOptionsProvider =>
  typeof value === "object" &&
  value !== null &&
  "supportsDevice" in value &&
  typeof value.supportsDevice === "function" &&
  "inspectDeviceOptions" in value &&
  typeof value.inspectDeviceOptions === "function";

export const isDecoderCapabilityProvider = (
  value: DeviceProvider["decoderCapabilities"]
): value is DecoderCapabilityProvider =>
  typeof value === "object" &&
  value !== null &&
  "supportsDevice" in value &&
  typeof value.supportsDevice === "function" &&
  "listDecoderCapabilities" in value &&
  typeof value.listDecoderCapabilities === "function";

export const isCaptureDecodeProvider = (
  value: DeviceProvider["captureDecode"]
): value is CaptureDecodeProvider =>
  typeof value === "object" &&
  value !== null &&
  "supportsDevice" in value &&
  typeof value.supportsDevice === "function" &&
  "captureDecode" in value &&
  typeof value.captureDecode === "function";

export const normalizeDeviceProviders = (
  input: DeviceProviderInput
): readonly RegisteredDeviceProvider[] => {
  if (isDeviceProvider(input)) {
    return [{ providerId: "default", provider: input }];
  }

  const entries = isRegisteredDeviceProviderList(input)
    ? cloneRegisteredProviders(input)
    : normalizeProviderMapEntries(input);

  if (entries.length === 0) {
    throw new Error("At least one device provider is required.");
  }

  const seenProviderIds = new Set<string>();

  return entries.map(({ providerId, provider }) => {
    if (!providerId.trim()) {
      throw new Error("Device provider registry entries must have a non-empty providerId.");
    }

    if (seenProviderIds.has(providerId)) {
      throw new Error(`Duplicate device provider registry entry: ${providerId}`);
    }

    seenProviderIds.add(providerId);
    return { providerId, provider };
  });
};
