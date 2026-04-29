import {
  ALLOCATION_STATES,
  BACKEND_READINESS_STATES,
  CAPTURE_DECODE_FAILURE_KINDS,
  CAPTURE_DECODE_FAILURE_PHASES,
  CONNECTION_STATES,
  DECODER_CAPABILITY_FAILURE_KINDS,
  DECODER_CAPABILITY_FAILURE_PHASES,
  DEVICE_READINESS_STATES,
  DEVICE_OPTIONS_FAILURE_KINDS,
  DEVICE_OPTIONS_FAILURE_PHASES,
  INVENTORY_BACKEND_KINDS,
  INVENTORY_DIAGNOSTIC_CODES,
  INVENTORY_DIAGNOSTIC_SEVERITIES,
  INVENTORY_DIAGNOSTIC_TARGETS,
  INVENTORY_PLATFORMS,
  INVENTORY_PROVIDER_KINDS,
  type AllocationFailure,
  type AllocationRequest,
  type AllocationResult,
  type AllocationSuccessWithLease,
  type BackendReadinessRecord,
  type CaptureDecodeFailureDiagnostics,
  type CaptureDecodeFailureKind,
  type CaptureDecodeReport,
  type CaptureDecodeRequest,
  type CaptureDecodeResult,
  type DecoderCapabilitiesRequest,
  type DecoderCapabilitiesResult,
  type DecoderCapability,
  type DecoderCapabilityFailureDiagnostics,
  type DecoderCapabilityFailureKind,
  type DecoderChannelRoleCapability,
  type DecoderOptionCapability,
  type DecoderRuntimeStreamSummary,
  type DeviceOptionsCapabilities,
  type DeviceOptionsFailureDiagnostics,
  type DeviceOptionsFailureKind,
  type DeviceOptionsRequest,
  type DeviceOptionsResult,
  type DeviceOptionsStreamSummary,
  type DeviceOptionTokenCapability,
  type DeviceRecord,
  type DslogicDeviceIdentity,
  type InventoryBackendKind,
  type InventoryDiagnostic,
  type InventoryProviderKind,
  type InventorySnapshot,
  type LiveCaptureArtifact,
  type LiveCaptureArtifactSampling,
  type LiveCaptureArtifactSummary,
  type LiveCaptureFailureDiagnostics,
  type LiveCaptureFailureKind,
  type LiveCaptureRequest,
  type LiveCaptureResult,
  type LiveCaptureSession,
  type LiveCaptureStreamSummary,
  type ReleaseFailure,
  type ReleaseRequest,
  type ReleaseResult,
  type SnapshotResourceManager,
} from "@listenai/eaw-contracts";

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const readString = (
  value: unknown,
  path: string,
  allowNull = false,
): string | null => {
  if (typeof value === "string") {
    return value;
  }

  if (allowNull && value === null) {
    return null;
  }

  throw new Error(`Malformed inventory snapshot response at ${path}`);
};

const readStringArrayField = <T>(
  value: unknown,
  path: string,
  mapper: (entry: unknown, entryPath: string) => T,
): T[] => {
  if (!Array.isArray(value)) {
    throw new Error(`Malformed inventory snapshot response at ${path}`);
  }

  return value.map((entry, index) => mapper(entry, `${path}[${index}]`));
};

const readInventoryEnum = <T extends string>(
  value: unknown,
  path: string,
  allowed: readonly T[],
  allowNull = false,
): T | null => {
  const parsed = readString(value, path, allowNull);
  if (parsed === null) {
    return null;
  }

  if (allowed.includes(parsed as T)) {
    return parsed as T;
  }

  throw new Error(`Malformed inventory snapshot response at ${path}`);
};

const readLiveCaptureString = (
  value: unknown,
  path: string,
  allowNull = false,
): string | null => {
  if (typeof value === "string") {
    return value;
  }

  if (allowNull && value === null) {
    return null;
  }

  throw new Error(`Malformed live capture response at ${path}`);
};

const readLiveCaptureNumber = (
  value: unknown,
  path: string,
  allowNull = false,
): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (allowNull && value === null) {
    return null;
  }

  throw new Error(`Malformed live capture response at ${path}`);
};

const readLiveCaptureBoolean = (value: unknown, path: string): boolean => {
  if (typeof value === "boolean") {
    return value;
  }

  throw new Error(`Malformed live capture response at ${path}`);
};

const readLiveCaptureEnum = <T extends string>(
  value: unknown,
  path: string,
  allowed: readonly T[],
  allowNull = false,
): T | null => {
  const parsed = readLiveCaptureString(value, path, allowNull);
  if (parsed === null) {
    return null;
  }

  if (allowed.includes(parsed as T)) {
    return parsed as T;
  }

  throw new Error(`Malformed live capture response at ${path}`);
};

const readDeviceOptionsString = (
  value: unknown,
  path: string,
  allowNull = false,
): string | null => {
  if (typeof value === "string") {
    return value;
  }

  if (allowNull && value === null) {
    return null;
  }

  throw new Error(`Malformed device options response at ${path}`);
};

const readDeviceOptionsNumber = (
  value: unknown,
  path: string,
  allowNull = false,
): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (allowNull && value === null) {
    return null;
  }

  throw new Error(`Malformed device options response at ${path}`);
};

const readDeviceOptionsBoolean = (value: unknown, path: string): boolean => {
  if (typeof value === "boolean") {
    return value;
  }

  throw new Error(`Malformed device options response at ${path}`);
};

const readDeviceOptionsEnum = <T extends string>(
  value: unknown,
  path: string,
  allowed: readonly T[],
  allowNull = false,
): T | null => {
  const parsed = readDeviceOptionsString(value, path, allowNull);
  if (parsed === null) {
    return null;
  }

  if (allowed.includes(parsed as T)) {
    return parsed as T;
  }

  throw new Error(`Malformed device options response at ${path}`);
};

const readDeviceOptionsArrayField = <T>(
  value: unknown,
  path: string,
  mapper: (entry: unknown, entryPath: string) => T,
): T[] => {
  if (!Array.isArray(value)) {
    throw new Error(`Malformed device options response at ${path}`);
  }

  return value.map((entry, index) => mapper(entry, `${path}[${index}]`));
};

const parseInventoryDiagnostic = (
  value: unknown,
  path: string,
): InventoryDiagnostic => {
  if (!isObject(value)) {
    throw new Error(`Malformed inventory snapshot response at ${path}`);
  }

  const diagnostic: InventoryDiagnostic = {
    code: readInventoryEnum(value.code, `${path}.code`, INVENTORY_DIAGNOSTIC_CODES) as InventoryDiagnostic["code"],
    severity: readInventoryEnum(
      value.severity,
      `${path}.severity`,
      INVENTORY_DIAGNOSTIC_SEVERITIES,
    ) as InventoryDiagnostic["severity"],
    target: readInventoryEnum(value.target, `${path}.target`, INVENTORY_DIAGNOSTIC_TARGETS) as InventoryDiagnostic["target"],
    message: readString(value.message, `${path}.message`) as string,
  };

  if (value.deviceId !== undefined) {
    diagnostic.deviceId = readString(value.deviceId, `${path}.deviceId`) as string;
  }
  if (value.platform !== undefined) {
    diagnostic.platform = readInventoryEnum(
      value.platform,
      `${path}.platform`,
      INVENTORY_PLATFORMS,
    ) as InventoryDiagnostic["platform"];
  }
  if (value.backendKind !== undefined) {
    diagnostic.backendKind = readInventoryEnum(
      value.backendKind,
      `${path}.backendKind`,
      INVENTORY_BACKEND_KINDS,
    ) as InventoryDiagnostic["backendKind"];
  }
  if (value.backendVersion !== undefined) {
    diagnostic.backendVersion = readString(
      value.backendVersion,
      `${path}.backendVersion`,
      true,
    );
  }

  return diagnostic;
};

const parseDeviceOptionsInventoryDiagnostic = (
  value: unknown,
  path: string,
): InventoryDiagnostic => {
  if (!isObject(value)) {
    throw new Error(`Malformed device options response at ${path}`);
  }

  const diagnostic: InventoryDiagnostic = {
    code: readDeviceOptionsEnum(
      value.code,
      `${path}.code`,
      INVENTORY_DIAGNOSTIC_CODES,
    ) as InventoryDiagnostic["code"],
    severity: readDeviceOptionsEnum(
      value.severity,
      `${path}.severity`,
      INVENTORY_DIAGNOSTIC_SEVERITIES,
    ) as InventoryDiagnostic["severity"],
    target: readDeviceOptionsEnum(
      value.target,
      `${path}.target`,
      INVENTORY_DIAGNOSTIC_TARGETS,
    ) as InventoryDiagnostic["target"],
    message: readDeviceOptionsString(value.message, `${path}.message`) as string,
  };

  if (value.deviceId !== undefined) {
    diagnostic.deviceId = readDeviceOptionsString(
      value.deviceId,
      `${path}.deviceId`,
    ) as string;
  }
  if (value.platform !== undefined) {
    diagnostic.platform = readDeviceOptionsEnum(
      value.platform,
      `${path}.platform`,
      INVENTORY_PLATFORMS,
    ) as InventoryDiagnostic["platform"];
  }
  if (value.backendKind !== undefined) {
    diagnostic.backendKind = readDeviceOptionsEnum(
      value.backendKind,
      `${path}.backendKind`,
      INVENTORY_BACKEND_KINDS,
    ) as InventoryDiagnostic["backendKind"];
  }
  if (value.backendVersion !== undefined) {
    diagnostic.backendVersion = readDeviceOptionsString(
      value.backendVersion,
      `${path}.backendVersion`,
      true,
    );
  }

  return diagnostic;
};

const parseCanonicalIdentity = (
  value: unknown,
  path: string,
): NonNullable<DeviceRecord["canonicalIdentity"]> => {
  if (!isObject(value)) {
    throw new Error(`Malformed inventory snapshot response at ${path}`);
  }

  return {
    providerKind: readInventoryEnum(
      value.providerKind,
      `${path}.providerKind`,
      INVENTORY_PROVIDER_KINDS,
    ) as InventoryProviderKind,
    providerDeviceId: readString(value.providerDeviceId, `${path}.providerDeviceId`) as string,
    canonicalKey: readString(value.canonicalKey, `${path}.canonicalKey`) as string,
  };
};

const parseDslogicIdentity = (
  value: unknown,
  path: string,
): DslogicDeviceIdentity | null => {
  if (value === null || value === undefined) {
    return null;
  }

  if (!isObject(value)) {
    throw new Error(`Malformed inventory snapshot response at ${path}`);
  }

  return {
    family: readString(value.family, `${path}.family`) as DslogicDeviceIdentity["family"],
    model: readString(value.model, `${path}.model`) as string,
    modelDisplayName: readString(value.modelDisplayName, `${path}.modelDisplayName`) as string,
    variant: readString(value.variant, `${path}.variant`, true),
    usbVendorId: readString(value.usbVendorId, `${path}.usbVendorId`, true),
    usbProductId: readString(value.usbProductId, `${path}.usbProductId`, true),
  };
};

const parseDeviceRecord = (value: unknown, path: string): DeviceRecord => {
  if (!isObject(value)) {
    throw new Error(`Malformed inventory snapshot response at ${path}`);
  }

  const record: DeviceRecord = {
    deviceId: readString(value.deviceId, `${path}.deviceId`) as string,
    label: readString(value.label, `${path}.label`) as string,
    capabilityType: readString(value.capabilityType, `${path}.capabilityType`) as string,
    connectionState: readInventoryEnum(
      value.connectionState,
      `${path}.connectionState`,
      CONNECTION_STATES,
    ) as DeviceRecord["connectionState"],
    allocationState: readInventoryEnum(
      value.allocationState,
      `${path}.allocationState`,
      ALLOCATION_STATES,
    ) as DeviceRecord["allocationState"],
    ownerSkillId: readString(value.ownerSkillId, `${path}.ownerSkillId`, true),
    lastSeenAt: readString(value.lastSeenAt, `${path}.lastSeenAt`, true),
    updatedAt: readString(value.updatedAt, `${path}.updatedAt`) as string,
  };

  if (value.readiness !== undefined) {
    record.readiness = readInventoryEnum(
      value.readiness,
      `${path}.readiness`,
      DEVICE_READINESS_STATES,
    ) as DeviceRecord["readiness"];
  }
  if (value.diagnostics !== undefined) {
    record.diagnostics = readStringArrayField(
      value.diagnostics,
      `${path}.diagnostics`,
      parseInventoryDiagnostic,
    );
  }
  if (value.providerKind !== undefined) {
    record.providerKind = readInventoryEnum(
      value.providerKind,
      `${path}.providerKind`,
      INVENTORY_PROVIDER_KINDS,
    ) as DeviceRecord["providerKind"];
  }
  if (value.backendKind !== undefined) {
    record.backendKind = readInventoryEnum(
      value.backendKind,
      `${path}.backendKind`,
      INVENTORY_BACKEND_KINDS,
    ) as DeviceRecord["backendKind"];
  }
  if (value.canonicalIdentity !== undefined) {
    record.canonicalIdentity = parseCanonicalIdentity(
      value.canonicalIdentity,
      `${path}.canonicalIdentity`,
    );
  }
  if (value.dslogic !== undefined) {
    record.dslogic = parseDslogicIdentity(value.dslogic, `${path}.dslogic`);
  }

  return record;
};

const parseDeviceOptionsCanonicalIdentity = (
  value: unknown,
  path: string,
): NonNullable<DeviceRecord["canonicalIdentity"]> => {
  if (!isObject(value)) {
    throw new Error(`Malformed device options response at ${path}`);
  }

  return {
    providerKind: readDeviceOptionsEnum(
      value.providerKind,
      `${path}.providerKind`,
      INVENTORY_PROVIDER_KINDS,
    ) as InventoryProviderKind,
    providerDeviceId: readDeviceOptionsString(
      value.providerDeviceId,
      `${path}.providerDeviceId`,
    ) as string,
    canonicalKey: readDeviceOptionsString(
      value.canonicalKey,
      `${path}.canonicalKey`,
    ) as string,
  };
};

const parseDeviceOptionsDslogicIdentity = (
  value: unknown,
  path: string,
): DslogicDeviceIdentity | null => {
  if (value === null || value === undefined) {
    return null;
  }

  if (!isObject(value)) {
    throw new Error(`Malformed device options response at ${path}`);
  }

  return {
    family: readDeviceOptionsString(
      value.family,
      `${path}.family`,
    ) as DslogicDeviceIdentity["family"],
    model: readDeviceOptionsString(value.model, `${path}.model`) as string,
    modelDisplayName: readDeviceOptionsString(
      value.modelDisplayName,
      `${path}.modelDisplayName`,
    ) as string,
    variant: readDeviceOptionsString(value.variant, `${path}.variant`, true),
    usbVendorId: readDeviceOptionsString(
      value.usbVendorId,
      `${path}.usbVendorId`,
      true,
    ),
    usbProductId: readDeviceOptionsString(
      value.usbProductId,
      `${path}.usbProductId`,
      true,
    ),
  };
};

const parseDeviceOptionsDeviceRecord = (
  value: unknown,
  path: string,
): DeviceRecord => {
  if (!isObject(value)) {
    throw new Error(`Malformed device options response at ${path}`);
  }

  const record: DeviceRecord = {
    deviceId: readDeviceOptionsString(value.deviceId, `${path}.deviceId`) as string,
    label: readDeviceOptionsString(value.label, `${path}.label`) as string,
    capabilityType: readDeviceOptionsString(
      value.capabilityType,
      `${path}.capabilityType`,
    ) as string,
    connectionState: readDeviceOptionsEnum(
      value.connectionState,
      `${path}.connectionState`,
      CONNECTION_STATES,
    ) as DeviceRecord["connectionState"],
    allocationState: readDeviceOptionsEnum(
      value.allocationState,
      `${path}.allocationState`,
      ALLOCATION_STATES,
    ) as DeviceRecord["allocationState"],
    ownerSkillId: readDeviceOptionsString(
      value.ownerSkillId,
      `${path}.ownerSkillId`,
      true,
    ),
    lastSeenAt: readDeviceOptionsString(value.lastSeenAt, `${path}.lastSeenAt`, true),
    updatedAt: readDeviceOptionsString(value.updatedAt, `${path}.updatedAt`) as string,
  };

  if (value.readiness !== undefined) {
    record.readiness = readDeviceOptionsEnum(
      value.readiness,
      `${path}.readiness`,
      DEVICE_READINESS_STATES,
    ) as DeviceRecord["readiness"];
  }
  if (value.diagnostics !== undefined) {
    record.diagnostics = readDeviceOptionsArrayField(
      value.diagnostics,
      `${path}.diagnostics`,
      parseDeviceOptionsInventoryDiagnostic,
    );
  }
  if (value.providerKind !== undefined) {
    record.providerKind = readDeviceOptionsEnum(
      value.providerKind,
      `${path}.providerKind`,
      INVENTORY_PROVIDER_KINDS,
    ) as DeviceRecord["providerKind"];
  }
  if (value.backendKind !== undefined) {
    record.backendKind = readDeviceOptionsEnum(
      value.backendKind,
      `${path}.backendKind`,
      INVENTORY_BACKEND_KINDS,
    ) as DeviceRecord["backendKind"];
  }
  if (value.canonicalIdentity !== undefined) {
    record.canonicalIdentity = parseDeviceOptionsCanonicalIdentity(
      value.canonicalIdentity,
      `${path}.canonicalIdentity`,
    );
  }
  if (value.dslogic !== undefined) {
    record.dslogic = parseDeviceOptionsDslogicIdentity(
      value.dslogic,
      `${path}.dslogic`,
    );
  }

  return record;
};

const parseBackendReadinessRecord = (
  value: unknown,
  path: string,
): BackendReadinessRecord => {
  if (!isObject(value)) {
    throw new Error(`Malformed inventory snapshot response at ${path}`);
  }

  return {
    platform: readInventoryEnum(value.platform, `${path}.platform`, INVENTORY_PLATFORMS) as BackendReadinessRecord["platform"],
    backendKind: readInventoryEnum(
      value.backendKind,
      `${path}.backendKind`,
      INVENTORY_BACKEND_KINDS,
    ) as BackendReadinessRecord["backendKind"],
    readiness: readInventoryEnum(
      value.readiness,
      `${path}.readiness`,
      BACKEND_READINESS_STATES,
    ) as BackendReadinessRecord["readiness"],
    version: readString(value.version, `${path}.version`, true),
    checkedAt: readString(value.checkedAt, `${path}.checkedAt`, true),
    diagnostics: readStringArrayField(
      value.diagnostics,
      `${path}.diagnostics`,
      parseInventoryDiagnostic,
    ),
  };
};

const parseDeviceRecordArray = (
  value: unknown,
  path: string,
): DeviceRecord[] => readStringArrayField(value, path, parseDeviceRecord);

const parseRootDeviceRecordArray = (value: unknown): DeviceRecord[] =>
  parseDeviceRecordArray(value, "root");

const parseInventorySnapshot = (value: unknown): InventorySnapshot => {
  if (!isObject(value)) {
    throw new Error("Malformed inventory snapshot response at root");
  }

  if (!isObject(value.inventoryScope)) {
    throw new Error("Malformed inventory snapshot response at root.inventoryScope");
  }

  return {
    refreshedAt: readString(value.refreshedAt, "root.refreshedAt") as string,
    inventoryScope: {
      providerKinds: readStringArrayField(
        value.inventoryScope.providerKinds,
        "root.inventoryScope.providerKinds",
        (entry, entryPath) =>
          readInventoryEnum(entry, entryPath, INVENTORY_PROVIDER_KINDS) as InventorySnapshot["inventoryScope"]["providerKinds"][number],
      ),
      backendKinds: readStringArrayField(
        value.inventoryScope.backendKinds,
        "root.inventoryScope.backendKinds",
        (entry, entryPath) =>
          readInventoryEnum(entry, entryPath, INVENTORY_BACKEND_KINDS) as InventorySnapshot["inventoryScope"]["backendKinds"][number],
      ),
    },
    devices: parseDeviceRecordArray(value.devices, "root.devices"),
    backendReadiness: readStringArrayField(
      value.backendReadiness,
      "root.backendReadiness",
      parseBackendReadinessRecord,
    ),
    diagnostics: readStringArrayField(
      value.diagnostics,
      "root.diagnostics",
      parseInventoryDiagnostic,
    ),
  };
};

const parseLiveCaptureSession = (
  value: unknown,
  path: string,
): LiveCaptureSession => {
  if (!isObject(value)) {
    throw new Error(`Malformed live capture response at ${path}`);
  }

  return {
    sessionId: readLiveCaptureString(value.sessionId, `${path}.sessionId`) as string,
    deviceId: readLiveCaptureString(value.deviceId, `${path}.deviceId`) as string,
    ownerSkillId: readLiveCaptureString(value.ownerSkillId, `${path}.ownerSkillId`) as string,
    startedAt: readLiveCaptureString(value.startedAt, `${path}.startedAt`) as string,
    device: parseDeviceRecord(value.device, `${path}.device`),
    sampling: parseLiveCaptureSamplingConfig(value.sampling, `${path}.sampling`),
  };
};

const parseLiveCaptureChannelSelection = (
  value: unknown,
  path: string,
) => {
  if (!isObject(value)) {
    throw new Error(`Malformed live capture response at ${path}`);
  }

  return {
    channelId: readLiveCaptureString(value.channelId, `${path}.channelId`) as string,
    label:
      value.label === undefined
        ? undefined
        : (readLiveCaptureString(value.label, `${path}.label`) as string),
  };
};

const parseLiveCaptureSamplingConfig = (
  value: unknown,
  path: string,
) => {
  if (!isObject(value)) {
    throw new Error(`Malformed live capture response at ${path}`);
  }

  return {
    sampleRateHz: readLiveCaptureNumber(value.sampleRateHz, `${path}.sampleRateHz`) as number,
    captureDurationMs: readLiveCaptureNumber(
      value.captureDurationMs,
      `${path}.captureDurationMs`,
    ) as number,
    channels: Array.isArray(value.channels)
      ? value.channels.map((entry, index) =>
          parseLiveCaptureChannelSelection(entry, `${path}.channels[${index}]`),
        )
      : (() => {
          throw new Error(`Malformed live capture response at ${path}.channels`);
        })(),
  };
};

const parseDeviceOptionsChannelSelection = (value: unknown, path: string) => {
  if (!isObject(value)) {
    throw new Error(`Malformed device options response at ${path}`);
  }

  return {
    channelId: readDeviceOptionsString(value.channelId, `${path}.channelId`) as string,
    label:
      value.label === undefined
        ? undefined
        : (readDeviceOptionsString(value.label, `${path}.label`) as string),
  };
};

const parseDeviceOptionsSamplingConfig = (value: unknown, path: string) => {
  if (!isObject(value)) {
    throw new Error(`Malformed device options response at ${path}`);
  }

  return {
    sampleRateHz: readDeviceOptionsNumber(
      value.sampleRateHz,
      `${path}.sampleRateHz`,
    ) as number,
    captureDurationMs: readDeviceOptionsNumber(
      value.captureDurationMs,
      `${path}.captureDurationMs`,
    ) as number,
    channels: readDeviceOptionsArrayField(
      value.channels,
      `${path}.channels`,
      parseDeviceOptionsChannelSelection,
    ),
  };
};

const parseDeviceOptionsSession = (
  value: unknown,
  path: string,
): LiveCaptureSession => {
  if (!isObject(value)) {
    throw new Error(`Malformed device options response at ${path}`);
  }

  return {
    sessionId: readDeviceOptionsString(value.sessionId, `${path}.sessionId`) as string,
    deviceId: readDeviceOptionsString(value.deviceId, `${path}.deviceId`) as string,
    ownerSkillId: readDeviceOptionsString(
      value.ownerSkillId,
      `${path}.ownerSkillId`,
    ) as string,
    startedAt: readDeviceOptionsString(value.startedAt, `${path}.startedAt`) as string,
    device: parseDeviceOptionsDeviceRecord(value.device, `${path}.device`),
    sampling: parseDeviceOptionsSamplingConfig(value.sampling, `${path}.sampling`),
  };
};

const parseLiveCaptureByteArray = (
  value: unknown,
  path: string,
): Uint8Array => {
  if (!Array.isArray(value)) {
    throw new Error(`Malformed live capture response at ${path}`);
  }

  return new Uint8Array(
    value.map((entry, index) => {
      if (
        typeof entry !== "number" ||
        !Number.isInteger(entry) ||
        entry < 0 ||
        entry > 255
      ) {
        throw new Error(`Malformed live capture response at ${path}[${index}]`);
      }
      return entry;
    }),
  );
};

const parseLiveCaptureArtifactSampling = (
  value: unknown,
  path: string,
): LiveCaptureArtifactSampling => {
  if (!isObject(value)) {
    throw new Error(`Malformed live capture response at ${path}`);
  }

  const sampling: LiveCaptureArtifactSampling = {};

  if (value.sampleRateHz !== undefined) {
    sampling.sampleRateHz = readLiveCaptureNumber(
      value.sampleRateHz,
      `${path}.sampleRateHz`,
    ) as number;
  }
  if (value.totalSamples !== undefined) {
    sampling.totalSamples = readLiveCaptureNumber(
      value.totalSamples,
      `${path}.totalSamples`,
    ) as number;
  }
  if (value.requestedSampleLimit !== undefined) {
    sampling.requestedSampleLimit = readLiveCaptureNumber(
      value.requestedSampleLimit,
      `${path}.requestedSampleLimit`,
    ) as number;
  }

  return sampling;
};

const parseLiveCaptureArtifact = (
  value: unknown,
  path: string,
): LiveCaptureArtifact => {
  if (!isObject(value)) {
    throw new Error(`Malformed live capture response at ${path}`);
  }

  const artifact: LiveCaptureArtifact = {};

  if (value.sourceName !== undefined) {
    artifact.sourceName = readLiveCaptureString(
      value.sourceName,
      `${path}.sourceName`,
    ) as string;
  }
  if (value.formatHint !== undefined) {
    artifact.formatHint = readLiveCaptureString(
      value.formatHint,
      `${path}.formatHint`,
    ) as string;
  }
  if (value.mediaType !== undefined) {
    artifact.mediaType = readLiveCaptureString(
      value.mediaType,
      `${path}.mediaType`,
    ) as string;
  }
  if (value.capturedAt !== undefined) {
    artifact.capturedAt = readLiveCaptureString(
      value.capturedAt,
      `${path}.capturedAt`,
    ) as string;
  }
  if (value.sampling !== undefined) {
    artifact.sampling = parseLiveCaptureArtifactSampling(
      value.sampling,
      `${path}.sampling`,
    );
  }
  if (value.text !== undefined) {
    artifact.text = readLiveCaptureString(value.text, `${path}.text`) as string;
  }
  if (value.bytes !== undefined) {
    artifact.bytes = parseLiveCaptureByteArray(value.bytes, `${path}.bytes`);
  }

  return artifact;
};

const parseLiveCaptureArtifactSummary = (
  value: unknown,
  path: string,
): LiveCaptureArtifactSummary => {
  if (!isObject(value)) {
    throw new Error(`Malformed live capture response at ${path}`);
  }

  return {
    sourceName: readLiveCaptureString(value.sourceName, `${path}.sourceName`, true),
    formatHint: readLiveCaptureString(value.formatHint, `${path}.formatHint`, true),
    mediaType: readLiveCaptureString(value.mediaType, `${path}.mediaType`, true),
    capturedAt: readLiveCaptureString(value.capturedAt, `${path}.capturedAt`, true),
    byteLength: readLiveCaptureNumber(value.byteLength, `${path}.byteLength`, true),
    textLength: readLiveCaptureNumber(value.textLength, `${path}.textLength`, true),
    hasText: readLiveCaptureBoolean(value.hasText, `${path}.hasText`),
  };
};

const parseLiveCaptureStreamSummary = (
  value: unknown,
  path: string,
): LiveCaptureStreamSummary => {
  if (!isObject(value)) {
    throw new Error(`Malformed live capture response at ${path}`);
  }

  return {
    kind: readLiveCaptureEnum(value.kind, `${path}.kind`, ["empty", "text", "bytes"] as const) as LiveCaptureStreamSummary["kind"],
    byteLength: readLiveCaptureNumber(value.byteLength, `${path}.byteLength`) as number,
    textLength: readLiveCaptureNumber(value.textLength, `${path}.textLength`, true),
    preview: readLiveCaptureString(value.preview, `${path}.preview`, true),
    truncated: readLiveCaptureBoolean(value.truncated, `${path}.truncated`),
  };
};

const parseLiveCaptureFailureDiagnosticsValue = (
  value: unknown,
  path: string,
): LiveCaptureFailureDiagnostics => {
  if (!isObject(value)) {
    throw new Error(`Malformed live capture response at ${path}`);
  }

  return {
    phase: readLiveCaptureString(value.phase, `${path}.phase`) as LiveCaptureFailureDiagnostics["phase"],
    providerKind: readLiveCaptureEnum(
      value.providerKind,
      `${path}.providerKind`,
      INVENTORY_PROVIDER_KINDS,
      true,
    ) as LiveCaptureFailureDiagnostics["providerKind"],
    backendKind: readLiveCaptureEnum(
      value.backendKind,
      `${path}.backendKind`,
      INVENTORY_BACKEND_KINDS,
      true,
    ) as LiveCaptureFailureDiagnostics["backendKind"],
    backendVersion: readLiveCaptureString(
      value.backendVersion,
      `${path}.backendVersion`,
      true,
    ),
    timeoutMs: readLiveCaptureNumber(value.timeoutMs, `${path}.timeoutMs`, true),
    nativeCode: readLiveCaptureString(value.nativeCode, `${path}.nativeCode`, true),
    captureOutput:
      value.captureOutput === null
        ? null
        : parseLiveCaptureStreamSummary(value.captureOutput, `${path}.captureOutput`),
    diagnosticOutput:
      value.diagnosticOutput === null
        ? null
        : parseLiveCaptureStreamSummary(
            value.diagnosticOutput,
            `${path}.diagnosticOutput`,
          ),
    details: Array.isArray(value.details)
      ? value.details.map((entry, index) =>
          readLiveCaptureString(entry, `${path}.details[${index}]`) as string,
        )
      : (() => {
          throw new Error(`Malformed live capture response at ${path}.details`);
        })(),
    diagnostics: Array.isArray(value.diagnostics)
      ? value.diagnostics.map((entry, index) =>
          parseInventoryDiagnostic(entry, `${path}.diagnostics[${index}]`),
        )
      : (() => {
          throw new Error(`Malformed live capture response at ${path}.diagnostics`);
        })(),
  };
};

const parseDeviceOptionTokenCapability = (
  value: unknown,
  path: string,
): DeviceOptionTokenCapability => {
  if (!isObject(value)) {
    throw new Error(`Malformed device options response at ${path}`);
  }

  const capability: DeviceOptionTokenCapability = {
    token: readDeviceOptionsString(value.token, `${path}.token`) as string,
  };

  if (value.label !== undefined) {
    capability.label = readDeviceOptionsString(value.label, `${path}.label`) as string;
  }
  if (value.description !== undefined) {
    capability.description = readDeviceOptionsString(
      value.description,
      `${path}.description`,
    ) as string;
  }

  return capability;
};

const parseDeviceOptionTokenCapabilityArray = (
  value: unknown,
  path: string,
): DeviceOptionTokenCapability[] => {
  if (!Array.isArray(value)) {
    throw new Error(`Malformed device options response at ${path}`);
  }

  return value.map((entry, index) =>
    parseDeviceOptionTokenCapability(entry, `${path}[${index}]`),
  );
};

const parseDeviceOptionsCapabilities = (
  value: unknown,
  path: string,
): DeviceOptionsCapabilities => {
  if (!isObject(value)) {
    throw new Error(`Malformed device options response at ${path}`);
  }

  return {
    operations: parseDeviceOptionTokenCapabilityArray(
      value.operations,
      `${path}.operations`,
    ),
    channels: parseDeviceOptionTokenCapabilityArray(value.channels, `${path}.channels`),
    stopConditions: parseDeviceOptionTokenCapabilityArray(
      value.stopConditions,
      `${path}.stopConditions`,
    ),
    filters: parseDeviceOptionTokenCapabilityArray(value.filters, `${path}.filters`),
    thresholds: parseDeviceOptionTokenCapabilityArray(
      value.thresholds,
      `${path}.thresholds`,
    ),
  };
};

const parseDeviceOptionsStreamSummary = (
  value: unknown,
  path: string,
): DeviceOptionsStreamSummary => {
  if (!isObject(value)) {
    throw new Error(`Malformed device options response at ${path}`);
  }

  return {
    kind: readDeviceOptionsEnum(
      value.kind,
      `${path}.kind`,
      ["empty", "text", "bytes"] as const,
    ) as DeviceOptionsStreamSummary["kind"],
    byteLength: readDeviceOptionsNumber(value.byteLength, `${path}.byteLength`) as number,
    textLength: readDeviceOptionsNumber(value.textLength, `${path}.textLength`, true),
    preview: readDeviceOptionsString(value.preview, `${path}.preview`, true),
    truncated: readDeviceOptionsBoolean(value.truncated, `${path}.truncated`),
  };
};

const parseDeviceOptionsFailureDiagnosticsValue = (
  value: unknown,
  path: string,
): DeviceOptionsFailureDiagnostics => {
  if (!isObject(value)) {
    throw new Error(`Malformed device options response at ${path}`);
  }

  return {
    phase: readDeviceOptionsEnum(
      value.phase,
      `${path}.phase`,
      DEVICE_OPTIONS_FAILURE_PHASES,
    ) as DeviceOptionsFailureDiagnostics["phase"],
    providerKind: readDeviceOptionsEnum(
      value.providerKind,
      `${path}.providerKind`,
      INVENTORY_PROVIDER_KINDS,
      true,
    ) as DeviceOptionsFailureDiagnostics["providerKind"],
    backendKind: readDeviceOptionsEnum(
      value.backendKind,
      `${path}.backendKind`,
      INVENTORY_BACKEND_KINDS,
      true,
    ) as DeviceOptionsFailureDiagnostics["backendKind"],
    backendVersion: readDeviceOptionsString(
      value.backendVersion,
      `${path}.backendVersion`,
      true,
    ),
    timeoutMs: readDeviceOptionsNumber(value.timeoutMs, `${path}.timeoutMs`, true),
    nativeCode: readDeviceOptionsString(value.nativeCode, `${path}.nativeCode`, true),
    optionsOutput:
      value.optionsOutput === null
        ? null
        : parseDeviceOptionsStreamSummary(value.optionsOutput, `${path}.optionsOutput`),
    diagnosticOutput:
      value.diagnosticOutput === null
        ? null
        : parseDeviceOptionsStreamSummary(
            value.diagnosticOutput,
            `${path}.diagnosticOutput`,
          ),
    details: Array.isArray(value.details)
      ? value.details.map((entry, index) =>
          readDeviceOptionsString(entry, `${path}.details[${index}]`) as string,
        )
      : (() => {
          throw new Error(`Malformed device options response at ${path}.details`);
        })(),
    diagnostics: Array.isArray(value.diagnostics)
      ? value.diagnostics.map((entry, index) =>
          parseDeviceOptionsInventoryDiagnostic(
            entry,
            `${path}.diagnostics[${index}]`,
          ),
        )
      : (() => {
          throw new Error(`Malformed device options response at ${path}.diagnostics`);
        })(),
  };
};

const parseDeviceOptionsResult = (value: unknown): DeviceOptionsResult => {
  if (!isObject(value)) {
    throw new Error("Malformed device options response at root");
  }

  const ok = readDeviceOptionsBoolean(value.ok, "root.ok");
  if (ok) {
    return {
      ok: true,
      providerKind: readDeviceOptionsEnum(
        value.providerKind,
        "root.providerKind",
        INVENTORY_PROVIDER_KINDS,
      ) as InventoryProviderKind,
      backendKind: readDeviceOptionsEnum(
        value.backendKind,
        "root.backendKind",
        INVENTORY_BACKEND_KINDS,
      ) as InventoryBackendKind,
      session: parseDeviceOptionsSession(value.session, "root.session"),
      requestedAt: readDeviceOptionsString(value.requestedAt, "root.requestedAt") as string,
      capabilities: parseDeviceOptionsCapabilities(
        value.capabilities,
        "root.capabilities",
      ),
    };
  }

  if (value.capabilities !== null) {
    throw new Error("Malformed device options response at root.capabilities");
  }

  const reason = readDeviceOptionsString(value.reason, "root.reason") as string;
  if (reason !== "device-options-failed") {
    throw new Error("Malformed device options response at root.reason");
  }

  return {
    ok: false,
    reason,
    kind: readDeviceOptionsEnum(
      value.kind,
      "root.kind",
      DEVICE_OPTIONS_FAILURE_KINDS,
    ) as DeviceOptionsFailureKind,
    message: readDeviceOptionsString(value.message, "root.message") as string,
    session: parseDeviceOptionsSession(value.session, "root.session"),
    requestedAt: readDeviceOptionsString(value.requestedAt, "root.requestedAt") as string,
    capabilities: null,
    diagnostics: parseDeviceOptionsFailureDiagnosticsValue(
      value.diagnostics,
      "root.diagnostics",
    ),
  };
};

const readDecoderCapabilitiesString = (
  value: unknown,
  path: string,
  allowNull = false,
): string | null => {
  if (typeof value === "string") {
    return value;
  }

  if (allowNull && value === null) {
    return null;
  }

  throw new Error(`Malformed decoder capabilities response at ${path}`);
};

const readDecoderCapabilitiesNumber = (
  value: unknown,
  path: string,
  allowNull = false,
): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (allowNull && value === null) {
    return null;
  }

  throw new Error(`Malformed decoder capabilities response at ${path}`);
};

const readDecoderCapabilitiesBoolean = (value: unknown, path: string): boolean => {
  if (typeof value === "boolean") {
    return value;
  }

  throw new Error(`Malformed decoder capabilities response at ${path}`);
};

const readDecoderCapabilitiesEnum = <T extends string>(
  value: unknown,
  path: string,
  allowed: readonly T[],
  allowNull = false,
): T | null => {
  const parsed = readDecoderCapabilitiesString(value, path, allowNull);
  if (parsed === null) {
    return null;
  }

  if (allowed.includes(parsed as T)) {
    return parsed as T;
  }

  throw new Error(`Malformed decoder capabilities response at ${path}`);
};

const parseDecoderCapabilitiesInventoryDiagnostic = (
  value: unknown,
  path: string,
): InventoryDiagnostic => {
  if (!isObject(value)) {
    throw new Error(`Malformed decoder capabilities response at ${path}`);
  }

  const diagnostic: InventoryDiagnostic = {
    code: readDecoderCapabilitiesEnum(
      value.code,
      `${path}.code`,
      INVENTORY_DIAGNOSTIC_CODES,
    ) as InventoryDiagnostic["code"],
    severity: readDecoderCapabilitiesEnum(
      value.severity,
      `${path}.severity`,
      INVENTORY_DIAGNOSTIC_SEVERITIES,
    ) as InventoryDiagnostic["severity"],
    target: readDecoderCapabilitiesEnum(
      value.target,
      `${path}.target`,
      INVENTORY_DIAGNOSTIC_TARGETS,
    ) as InventoryDiagnostic["target"],
    message: readDecoderCapabilitiesString(value.message, `${path}.message`) as string,
  };

  if (value.deviceId !== undefined) {
    diagnostic.deviceId = readDecoderCapabilitiesString(
      value.deviceId,
      `${path}.deviceId`,
    ) as string;
  }
  if (value.platform !== undefined) {
    diagnostic.platform = readDecoderCapabilitiesEnum(
      value.platform,
      `${path}.platform`,
      INVENTORY_PLATFORMS,
    ) as InventoryDiagnostic["platform"];
  }
  if (value.backendKind !== undefined) {
    diagnostic.backendKind = readDecoderCapabilitiesEnum(
      value.backendKind,
      `${path}.backendKind`,
      INVENTORY_BACKEND_KINDS,
    ) as InventoryDiagnostic["backendKind"];
  }
  if (value.backendVersion !== undefined) {
    diagnostic.backendVersion = readDecoderCapabilitiesString(
      value.backendVersion,
      `${path}.backendVersion`,
      true,
    );
  }

  return diagnostic;
};

const readCaptureDecodeString = (
  value: unknown,
  path: string,
  allowNull = false,
): string | null => {
  if (typeof value === "string") {
    return value;
  }

  if (allowNull && value === null) {
    return null;
  }

  throw new Error(`Malformed capture-decode response at ${path}`);
};

const readCaptureDecodeNumber = (
  value: unknown,
  path: string,
  allowNull = false,
): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (allowNull && value === null) {
    return null;
  }

  throw new Error(`Malformed capture-decode response at ${path}`);
};

const readCaptureDecodeBoolean = (value: unknown, path: string): boolean => {
  if (typeof value === "boolean") {
    return value;
  }

  throw new Error(`Malformed capture-decode response at ${path}`);
};

const readCaptureDecodeEnum = <T extends string>(
  value: unknown,
  path: string,
  allowed: readonly T[],
  allowNull = false,
): T | null => {
  const parsed = readCaptureDecodeString(value, path, allowNull);
  if (parsed === null) {
    return null;
  }

  if (allowed.includes(parsed as T)) {
    return parsed as T;
  }

  throw new Error(`Malformed capture-decode response at ${path}`);
};

const parseCaptureDecodeInventoryDiagnostic = (
  value: unknown,
  path: string,
): InventoryDiagnostic => {
  if (!isObject(value)) {
    throw new Error(`Malformed capture-decode response at ${path}`);
  }

  const diagnostic: InventoryDiagnostic = {
    code: readCaptureDecodeEnum(
      value.code,
      `${path}.code`,
      INVENTORY_DIAGNOSTIC_CODES,
    ) as InventoryDiagnostic["code"],
    severity: readCaptureDecodeEnum(
      value.severity,
      `${path}.severity`,
      INVENTORY_DIAGNOSTIC_SEVERITIES,
    ) as InventoryDiagnostic["severity"],
    target: readCaptureDecodeEnum(
      value.target,
      `${path}.target`,
      INVENTORY_DIAGNOSTIC_TARGETS,
    ) as InventoryDiagnostic["target"],
    message: readCaptureDecodeString(value.message, `${path}.message`) as string,
  };

  if (value.deviceId !== undefined) {
    diagnostic.deviceId = readCaptureDecodeString(
      value.deviceId,
      `${path}.deviceId`,
    ) as string;
  }
  if (value.platform !== undefined) {
    diagnostic.platform = readCaptureDecodeEnum(
      value.platform,
      `${path}.platform`,
      INVENTORY_PLATFORMS,
    ) as InventoryDiagnostic["platform"];
  }
  if (value.backendKind !== undefined) {
    diagnostic.backendKind = readCaptureDecodeEnum(
      value.backendKind,
      `${path}.backendKind`,
      INVENTORY_BACKEND_KINDS,
    ) as InventoryDiagnostic["backendKind"];
  }
  if (value.backendVersion !== undefined) {
    diagnostic.backendVersion = readCaptureDecodeString(
      value.backendVersion,
      `${path}.backendVersion`,
      true,
    );
  }

  return diagnostic;
};

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseDecoderChannelRoleCapability = (
  value: unknown,
  path: string,
): DecoderChannelRoleCapability => {
  if (!isObject(value)) {
    throw new Error(`Malformed decoder capabilities response at ${path}`);
  }

  const channel: DecoderChannelRoleCapability = {
    id: readDecoderCapabilitiesString(value.id, `${path}.id`) as string,
  };

  if (value.label !== undefined) {
    channel.label = readDecoderCapabilitiesString(value.label, `${path}.label`) as string;
  }
  if (value.description !== undefined) {
    channel.description = readDecoderCapabilitiesString(
      value.description,
      `${path}.description`,
    ) as string;
  }

  return channel;
};

const parseDecoderChannelRoleCapabilityArray = (
  value: unknown,
  path: string,
): DecoderChannelRoleCapability[] => {
  if (!Array.isArray(value)) {
    throw new Error(`Malformed decoder capabilities response at ${path}`);
  }

  return value.map((entry, index) =>
    parseDecoderChannelRoleCapability(entry, `${path}[${index}]`),
  );
};

const parseDecoderOptionValue = (value: unknown, path: string) => {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  throw new Error(`Malformed decoder capabilities response at ${path}`);
};

const parseDecoderOptionCapability = (
  value: unknown,
  path: string,
): DecoderOptionCapability => {
  if (!isObject(value)) {
    throw new Error(`Malformed decoder capabilities response at ${path}`);
  }

  const option: DecoderOptionCapability = {
    id: readDecoderCapabilitiesString(value.id, `${path}.id`) as string,
    values: Array.isArray(value.values)
      ? value.values.map((entry, index) =>
          parseDecoderOptionValue(entry, `${path}.values[${index}]`),
        )
      : (() => {
          throw new Error(`Malformed decoder capabilities response at ${path}.values`);
        })(),
  };

  if (value.label !== undefined) {
    option.label = readDecoderCapabilitiesString(value.label, `${path}.label`) as string;
  }
  if (value.description !== undefined) {
    option.description = readDecoderCapabilitiesString(
      value.description,
      `${path}.description`,
    ) as string;
  }
  if (value.valueType !== undefined) {
    option.valueType = readDecoderCapabilitiesEnum(
      value.valueType,
      `${path}.valueType`,
      ["string", "number", "boolean"] as const,
    ) as DecoderOptionCapability["valueType"];
  }
  if (value.required !== undefined) {
    option.required = readDecoderCapabilitiesBoolean(value.required, `${path}.required`);
  }

  return option;
};

const parseDecoderOptionCapabilityArray = (
  value: unknown,
  path: string,
): DecoderOptionCapability[] => {
  if (!Array.isArray(value)) {
    throw new Error(`Malformed decoder capabilities response at ${path}`);
  }

  return value.map((entry, index) =>
    parseDecoderOptionCapability(entry, `${path}[${index}]`),
  );
};

const parseDecoderCapability = (value: unknown, path: string): DecoderCapability => {
  if (!isObject(value)) {
    throw new Error(`Malformed decoder capabilities response at ${path}`);
  }

  const decoder: DecoderCapability = {
    decoderId: readDecoderCapabilitiesString(value.decoderId, `${path}.decoderId`) as string,
    requiredChannels: parseDecoderChannelRoleCapabilityArray(
      value.requiredChannels,
      `${path}.requiredChannels`,
    ),
    optionalChannels: parseDecoderChannelRoleCapabilityArray(
      value.optionalChannels,
      `${path}.optionalChannels`,
    ),
    options: parseDecoderOptionCapabilityArray(value.options, `${path}.options`),
  };

  if (value.label !== undefined) {
    decoder.label = readDecoderCapabilitiesString(value.label, `${path}.label`) as string;
  }
  if (value.description !== undefined) {
    decoder.description = readDecoderCapabilitiesString(
      value.description,
      `${path}.description`,
    ) as string;
  }

  return decoder;
};

const parseDecoderRuntimeStreamSummary = (
  value: unknown,
  path: string,
): DecoderRuntimeStreamSummary => {
  if (!isObject(value)) {
    throw new Error(`Malformed decoder capabilities response at ${path}`);
  }

  return {
    kind: readDecoderCapabilitiesEnum(
      value.kind,
      `${path}.kind`,
      ["empty", "text", "bytes"] as const,
    ) as DecoderRuntimeStreamSummary["kind"],
    byteLength: readDecoderCapabilitiesNumber(value.byteLength, `${path}.byteLength`) as number,
    textLength: readDecoderCapabilitiesNumber(value.textLength, `${path}.textLength`, true),
    preview: readDecoderCapabilitiesString(value.preview, `${path}.preview`, true),
    truncated: readDecoderCapabilitiesBoolean(value.truncated, `${path}.truncated`),
  };
};

const parseDecoderCapabilityFailureDiagnosticsValue = (
  value: unknown,
  path: string,
): DecoderCapabilityFailureDiagnostics => {
  if (!isObject(value)) {
    throw new Error(`Malformed decoder capabilities response at ${path}`);
  }

  return {
    phase: readDecoderCapabilitiesEnum(
      value.phase,
      `${path}.phase`,
      DECODER_CAPABILITY_FAILURE_PHASES,
    ) as DecoderCapabilityFailureDiagnostics["phase"],
    providerKind: readDecoderCapabilitiesEnum(
      value.providerKind,
      `${path}.providerKind`,
      INVENTORY_PROVIDER_KINDS,
      true,
    ) as DecoderCapabilityFailureDiagnostics["providerKind"],
    backendKind: readDecoderCapabilitiesEnum(
      value.backendKind,
      `${path}.backendKind`,
      INVENTORY_BACKEND_KINDS,
      true,
    ) as DecoderCapabilityFailureDiagnostics["backendKind"],
    backendVersion: readDecoderCapabilitiesString(
      value.backendVersion,
      `${path}.backendVersion`,
      true,
    ),
    timeoutMs: readDecoderCapabilitiesNumber(value.timeoutMs, `${path}.timeoutMs`, true),
    nativeCode: readDecoderCapabilitiesString(value.nativeCode, `${path}.nativeCode`, true),
    decoderOutput:
      value.decoderOutput === null
        ? null
        : parseDecoderRuntimeStreamSummary(value.decoderOutput, `${path}.decoderOutput`),
    diagnosticOutput:
      value.diagnosticOutput === null
        ? null
        : parseDecoderRuntimeStreamSummary(
            value.diagnosticOutput,
            `${path}.diagnosticOutput`,
          ),
    details: Array.isArray(value.details)
      ? value.details.map((entry, index) =>
          readDecoderCapabilitiesString(entry, `${path}.details[${index}]`) as string,
        )
      : (() => {
          throw new Error(`Malformed decoder capabilities response at ${path}.details`);
        })(),
    diagnostics: Array.isArray(value.diagnostics)
      ? value.diagnostics.map((entry, index) =>
          parseDecoderCapabilitiesInventoryDiagnostic(
            entry,
            `${path}.diagnostics[${index}]`,
          ),
        )
      : (() => {
          throw new Error(`Malformed decoder capabilities response at ${path}.diagnostics`);
        })(),
  };
};

const parseDecoderCapabilitiesResult = (value: unknown): DecoderCapabilitiesResult => {
  if (!isObject(value)) {
    throw new Error("Malformed decoder capabilities response at root");
  }

  const ok = readDecoderCapabilitiesBoolean(value.ok, "root.ok");
  if (ok) {
    return {
      ok: true,
      providerKind: readDecoderCapabilitiesEnum(
        value.providerKind,
        "root.providerKind",
        INVENTORY_PROVIDER_KINDS,
      ) as InventoryProviderKind,
      backendKind: readDecoderCapabilitiesEnum(
        value.backendKind,
        "root.backendKind",
        INVENTORY_BACKEND_KINDS,
      ) as InventoryBackendKind,
      backendVersion: readDecoderCapabilitiesString(
        value.backendVersion,
        "root.backendVersion",
        true,
      ),
      deviceId: readDecoderCapabilitiesString(value.deviceId, "root.deviceId") as string,
      requestedAt: readDecoderCapabilitiesString(value.requestedAt, "root.requestedAt") as string,
      decoders: Array.isArray(value.decoders)
        ? value.decoders.map((entry, index) =>
            parseDecoderCapability(entry, `root.decoders[${index}]`),
          )
        : (() => {
            throw new Error("Malformed decoder capabilities response at root.decoders");
          })(),
    };
  }

  if (value.decoders !== null) {
    throw new Error("Malformed decoder capabilities response at root.decoders");
  }

  const reason = readDecoderCapabilitiesString(value.reason, "root.reason") as string;
  if (reason !== "decoder-capabilities-failed") {
    throw new Error("Malformed decoder capabilities response at root.reason");
  }

  return {
    ok: false,
    reason,
    kind: readDecoderCapabilitiesEnum(
      value.kind,
      "root.kind",
      DECODER_CAPABILITY_FAILURE_KINDS,
    ) as DecoderCapabilityFailureKind,
    message: readDecoderCapabilitiesString(value.message, "root.message") as string,
    deviceId: readDecoderCapabilitiesString(value.deviceId, "root.deviceId") as string,
    requestedAt: readDecoderCapabilitiesString(value.requestedAt, "root.requestedAt") as string,
    decoders: null,
    diagnostics: parseDecoderCapabilityFailureDiagnosticsValue(
      value.diagnostics,
      "root.diagnostics",
    ),
  };
};

const parseCaptureDecodeArtifactSummary = (
  value: unknown,
  path: string,
): LiveCaptureArtifactSummary => {
  if (!isObject(value)) {
    throw new Error(`Malformed capture-decode response at ${path}`);
  }

  return {
    sourceName: readCaptureDecodeString(value.sourceName, `${path}.sourceName`, true),
    formatHint: readCaptureDecodeString(value.formatHint, `${path}.formatHint`, true),
    mediaType: readCaptureDecodeString(value.mediaType, `${path}.mediaType`, true),
    capturedAt: readCaptureDecodeString(value.capturedAt, `${path}.capturedAt`, true),
    byteLength: readCaptureDecodeNumber(value.byteLength, `${path}.byteLength`, true),
    textLength: readCaptureDecodeNumber(value.textLength, `${path}.textLength`, true),
    hasText: readCaptureDecodeBoolean(value.hasText, `${path}.hasText`),
  };
};

const parseGenericRecordArray = (
  value: unknown,
  path: string,
): Record<string, unknown>[] => {
  if (!Array.isArray(value)) {
    throw new Error(`Malformed capture-decode response at ${path}`);
  }

  return value.map((entry, index) => {
    if (!isPlainRecord(entry)) {
      throw new Error(`Malformed capture-decode response at ${path}[${index}]`);
    }

    return entry;
  });
};

const parseCaptureDecodeRawBytes = (
  value: unknown,
  path: string,
): number[] => {
  if (!Array.isArray(value)) {
    throw new Error(`Malformed capture-decode response at ${path}`);
  }

  return value.map((entry, index) => {
    if (typeof entry !== "number" || !Number.isInteger(entry) || entry < 0 || entry > 255) {
      throw new Error(`Malformed capture-decode response at ${path}[${index}]`);
    }
    return entry;
  });
};

const parseCaptureDecodeReport = (
  value: unknown,
  path: string,
): CaptureDecodeReport => {
  if (!isPlainRecord(value)) {
    throw new Error(`Malformed capture-decode response at ${path}`);
  }

  if (!isPlainRecord(value.raw)) {
    throw new Error(`Malformed capture-decode response at ${path}.raw`);
  }

  const rawText = readCaptureDecodeString(value.raw.text, `${path}.raw.text`) as string;
  const rawBytes = parseCaptureDecodeRawBytes(value.raw.bytes, `${path}.raw.bytes`);

  return {
    decoderId: readCaptureDecodeString(value.decoderId, `${path}.decoderId`) as string,
    annotations: parseGenericRecordArray(value.annotations, `${path}.annotations`),
    rows: parseGenericRecordArray(value.rows, `${path}.rows`),
    raw: {
      ...value.raw,
      text: rawText,
      bytes: rawBytes,
    },
  };
};

const parseCaptureDecodeStreamSummary = (
  value: unknown,
  path: string,
): DecoderRuntimeStreamSummary => {
  if (!isObject(value)) {
    throw new Error(`Malformed capture-decode response at ${path}`);
  }

  return {
    kind: readCaptureDecodeEnum(
      value.kind,
      `${path}.kind`,
      ["empty", "text", "bytes"] as const,
    ) as DecoderRuntimeStreamSummary["kind"],
    byteLength: readCaptureDecodeNumber(value.byteLength, `${path}.byteLength`) as number,
    textLength: readCaptureDecodeNumber(value.textLength, `${path}.textLength`, true),
    preview: readCaptureDecodeString(value.preview, `${path}.preview`, true),
    truncated: readCaptureDecodeBoolean(value.truncated, `${path}.truncated`),
  };
};

const parseCaptureDecodeFailureDiagnosticsValue = (
  value: unknown,
  path: string,
): CaptureDecodeFailureDiagnostics => {
  if (!isObject(value)) {
    throw new Error(`Malformed capture-decode response at ${path}`);
  }

  return {
    phase: readCaptureDecodeEnum(
      value.phase,
      `${path}.phase`,
      CAPTURE_DECODE_FAILURE_PHASES,
    ) as CaptureDecodeFailureDiagnostics["phase"],
    providerKind: readCaptureDecodeEnum(
      value.providerKind,
      `${path}.providerKind`,
      INVENTORY_PROVIDER_KINDS,
      true,
    ) as CaptureDecodeFailureDiagnostics["providerKind"],
    backendKind: readCaptureDecodeEnum(
      value.backendKind,
      `${path}.backendKind`,
      INVENTORY_BACKEND_KINDS,
      true,
    ) as CaptureDecodeFailureDiagnostics["backendKind"],
    backendVersion: readCaptureDecodeString(value.backendVersion, `${path}.backendVersion`, true),
    timeoutMs: readCaptureDecodeNumber(value.timeoutMs, `${path}.timeoutMs`, true),
    nativeCode: readCaptureDecodeString(value.nativeCode, `${path}.nativeCode`, true),
    captureOutput:
      value.captureOutput === null
        ? null
        : parseCaptureDecodeStreamSummary(
            value.captureOutput,
            `${path}.captureOutput`,
          ),
    decoderOutput:
      value.decoderOutput === null
        ? null
        : parseCaptureDecodeStreamSummary(value.decoderOutput, `${path}.decoderOutput`),
    diagnosticOutput:
      value.diagnosticOutput === null
        ? null
        : parseCaptureDecodeStreamSummary(
            value.diagnosticOutput,
            `${path}.diagnosticOutput`,
          ),
    details: Array.isArray(value.details)
      ? value.details.map((entry, index) =>
          readCaptureDecodeString(entry, `${path}.details[${index}]`) as string,
        )
      : (() => {
          throw new Error(`Malformed capture-decode response at ${path}.details`);
        })(),
    diagnostics: Array.isArray(value.diagnostics)
      ? value.diagnostics.map((entry, index) =>
          parseCaptureDecodeInventoryDiagnostic(
            entry,
            `${path}.diagnostics[${index}]`,
          ),
        )
      : (() => {
          throw new Error(`Malformed capture-decode response at ${path}.diagnostics`);
        })(),
  };
};

const parseCaptureDecodeResult = (value: unknown): CaptureDecodeResult => {
  if (!isObject(value)) {
    throw new Error("Malformed capture-decode response at root");
  }

  const ok = readCaptureDecodeBoolean(value.ok, "root.ok");
  if (ok) {
    return {
      ok: true,
      providerKind: readCaptureDecodeEnum(
        value.providerKind,
        "root.providerKind",
        INVENTORY_PROVIDER_KINDS,
      ) as InventoryProviderKind,
      backendKind: readCaptureDecodeEnum(
        value.backendKind,
        "root.backendKind",
        INVENTORY_BACKEND_KINDS,
      ) as InventoryBackendKind,
      session: parseLiveCaptureSession(value.session, "root.session"),
      requestedAt: readCaptureDecodeString(value.requestedAt, "root.requestedAt") as string,
      artifactSummary: parseCaptureDecodeArtifactSummary(
        value.artifactSummary,
        "root.artifactSummary",
      ),
      auxiliaryArtifactSummaries:
        value.auxiliaryArtifactSummaries === undefined
          ? undefined
          : Array.isArray(value.auxiliaryArtifactSummaries)
            ? value.auxiliaryArtifactSummaries.map((entry, index) =>
                parseCaptureDecodeArtifactSummary(
                  entry,
                  `root.auxiliaryArtifactSummaries[${index}]`,
                ),
              )
            : (() => {
                throw new Error(
                  "Malformed capture-decode response at root.auxiliaryArtifactSummaries",
                );
              })(),
      decode: parseCaptureDecodeReport(value.decode, "root.decode"),
    };
  }

  const reason = readCaptureDecodeString(value.reason, "root.reason") as string;
  if (reason !== "capture-decode-failed") {
    throw new Error("Malformed capture-decode response at root.reason");
  }

  return {
    ok: false,
    reason,
    kind: readCaptureDecodeEnum(
      value.kind,
      "root.kind",
      CAPTURE_DECODE_FAILURE_KINDS,
    ) as CaptureDecodeFailureKind,
    message: readCaptureDecodeString(value.message, "root.message") as string,
    session: parseLiveCaptureSession(value.session, "root.session"),
    requestedAt: readCaptureDecodeString(value.requestedAt, "root.requestedAt") as string,
    artifactSummary:
      value.artifactSummary === null
        ? null
        : parseCaptureDecodeArtifactSummary(
            value.artifactSummary,
            "root.artifactSummary",
          ),
    decode:
      value.decode === null ? null : parseCaptureDecodeReport(value.decode, "root.decode"),
    diagnostics: parseCaptureDecodeFailureDiagnosticsValue(
      value.diagnostics,
      "root.diagnostics",
    ),
  };
};

const parseLiveCaptureResult = (value: unknown): LiveCaptureResult => {
  if (!isObject(value)) {
    throw new Error("Malformed live capture response at root");
  }

  const ok = readLiveCaptureBoolean(value.ok, "root.ok");
  if (ok) {
    return {
      ok: true,
      providerKind: readLiveCaptureEnum(
        value.providerKind,
        "root.providerKind",
        INVENTORY_PROVIDER_KINDS,
      ) as InventoryProviderKind,
      backendKind: readLiveCaptureEnum(
        value.backendKind,
        "root.backendKind",
        INVENTORY_BACKEND_KINDS,
      ) as InventoryBackendKind,
      session: parseLiveCaptureSession(value.session, "root.session"),
      requestedAt: readLiveCaptureString(value.requestedAt, "root.requestedAt") as string,
      artifact: parseLiveCaptureArtifact(value.artifact, "root.artifact"),
      artifactSummary: parseLiveCaptureArtifactSummary(
        value.artifactSummary,
        "root.artifactSummary",
      ),
      auxiliaryArtifacts:
        value.auxiliaryArtifacts === undefined
          ? undefined
          : Array.isArray(value.auxiliaryArtifacts)
            ? value.auxiliaryArtifacts.map((entry, index) =>
                parseLiveCaptureArtifact(entry, `root.auxiliaryArtifacts[${index}]`),
              )
            : (() => {
                throw new Error("Malformed live capture response at root.auxiliaryArtifacts");
              })(),
      auxiliaryArtifactSummaries:
        value.auxiliaryArtifactSummaries === undefined
          ? undefined
          : Array.isArray(value.auxiliaryArtifactSummaries)
            ? value.auxiliaryArtifactSummaries.map((entry, index) =>
                parseLiveCaptureArtifactSummary(
                  entry,
                  `root.auxiliaryArtifactSummaries[${index}]`,
                ),
              )
            : (() => {
                throw new Error(
                  "Malformed live capture response at root.auxiliaryArtifactSummaries",
                );
              })(),
    };
  }

  return {
    ok: false,
    reason: readLiveCaptureString(value.reason, "root.reason") as "capture-failed",
    kind: readLiveCaptureString(value.kind, "root.kind") as LiveCaptureFailureKind,
    message: readLiveCaptureString(value.message, "root.message") as string,
    session: parseLiveCaptureSession(value.session, "root.session"),
    requestedAt: readLiveCaptureString(value.requestedAt, "root.requestedAt") as string,
    artifactSummary:
      value.artifactSummary === null
        ? null
        : parseLiveCaptureArtifactSummary(
            value.artifactSummary,
            "root.artifactSummary",
          ),
    diagnostics: parseLiveCaptureFailureDiagnosticsValue(
      value.diagnostics,
      "root.diagnostics",
    ),
  };
};

export class HttpResourceManager implements SnapshotResourceManager {
  readonly #baseUrl: string;
  readonly #leases = new Map<string, string>();
  readonly #heartbeatTimers = new Map<string, NodeJS.Timeout>();
  #lastSnapshot: InventorySnapshot | null = null;

  constructor(baseUrl: string) {
    this.#baseUrl = baseUrl;
  }

  async listDevices(): Promise<readonly DeviceRecord[]> {
    return this.#requestJson(
      `${this.#baseUrl}/devices`,
      parseRootDeviceRecordArray,
    );
  }

  async refreshInventory(): Promise<readonly DeviceRecord[]> {
    return this.#requestJson(
      `${this.#baseUrl}/refresh`,
      parseRootDeviceRecordArray,
      { method: "POST" },
    );
  }

  async getInventorySnapshot(): Promise<InventorySnapshot> {
    const snapshot = await this.#requestJson(
      `${this.#baseUrl}/inventory`,
      parseInventorySnapshot,
    );
    this.#lastSnapshot = snapshot;
    return snapshot;
  }

  async refreshInventorySnapshot(): Promise<InventorySnapshot> {
    const snapshot = await this.#requestJson(
      `${this.#baseUrl}/inventory/refresh`,
      parseInventorySnapshot,
      { method: "POST" },
    );
    this.#lastSnapshot = snapshot;
    return snapshot;
  }

  async allocateDevice(
    request: AllocationRequest,
  ): Promise<AllocationResult> {
    let res: Response;
    try {
      res = await fetch(`${this.#baseUrl}/allocate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
    } catch {
      return this.#allocationServerUnavailable(request, "Server unavailable");
    }

    if (!res.ok) {
      const body = (await res.json()) as AllocationResult;
      if (!body.ok) {
        return body;
      }

      return this.#allocationServerUnavailable(
        request,
        `Server returned ${res.status}`,
      );
    }

    const body = (await res.json()) as AllocationSuccessWithLease;
    this.#leases.set(request.deviceId, body.leaseId);

    const timer = setInterval(async () => {
      try {
        const heartbeatRes = await fetch(`${this.#baseUrl}/heartbeat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ leaseId: body.leaseId }),
        });

        if (!heartbeatRes.ok) {
          console.error(
            `Heartbeat failed for lease ${body.leaseId}: ${heartbeatRes.status}`,
          );
        }
      } catch (err) {
        console.error(`Heartbeat failed for lease ${body.leaseId}:`, err);
      }
    }, 30000);

    this.#heartbeatTimers.set(request.deviceId, timer);
    return { ok: true, device: body.device };
  }

  async releaseDevice(request: ReleaseRequest): Promise<ReleaseResult> {
    let res: Response;
    try {
      res = await fetch(`${this.#baseUrl}/release`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
    } catch {
      return this.#releaseServerUnavailable(request, "Server unavailable");
    }

    const body = (await res.json()) as ReleaseResult;
    if (body.ok) {
      this.#leases.delete(request.deviceId);
      const timer = this.#heartbeatTimers.get(request.deviceId);
      if (timer) {
        clearInterval(timer);
        this.#heartbeatTimers.delete(request.deviceId);
      }
    }

    return body;
  }

  async inspectDeviceOptions(
    request: DeviceOptionsRequest,
  ): Promise<DeviceOptionsResult> {
    return this.#requestJson(
      `${this.#baseUrl}/devices/options`,
      parseDeviceOptionsResult,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      },
    );
  }

  async listDecoderCapabilities(
    request: DecoderCapabilitiesRequest,
  ): Promise<DecoderCapabilitiesResult> {
    return this.#requestJson(
      `${this.#baseUrl}/decoders/capabilities`,
      parseDecoderCapabilitiesResult,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      },
    );
  }

  async captureDecode(request: CaptureDecodeRequest): Promise<CaptureDecodeResult> {
    return this.#requestJson(
      `${this.#baseUrl}/capture/decode`,
      parseCaptureDecodeResult,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      },
    );
  }

  async liveCapture(request: LiveCaptureRequest): Promise<LiveCaptureResult> {
    return this.#requestJson(
      `${this.#baseUrl}/capture/live`,
      parseLiveCaptureResult,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      },
    );
  }

  dispose(): number {
    const count = this.#heartbeatTimers.size;
    for (const timer of this.#heartbeatTimers.values()) {
      clearInterval(timer);
    }
    this.#heartbeatTimers.clear();
    return count;
  }

  getLeaseId(deviceId: string): string | undefined {
    return this.#leases.get(deviceId);
  }

  getLastInventorySnapshot(): InventorySnapshot | null {
    return this.#lastSnapshot;
  }

  async #requestJson<T>(
    url: string,
    parser: (value: unknown) => T,
    init?: RequestInit,
  ): Promise<T> {
    const res = await this.#fetch(url, init);
    const body = await res.json();
    return parser(body);
  }

  async #fetch(url: string, init?: RequestInit): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(url, init);
    } catch {
      throw new Error("Server unavailable");
    }

    if (!res.ok) {
      throw new Error(`Server returned ${res.status}`);
    }

    return res;
  }

  #allocationServerUnavailable(
    request: AllocationRequest,
    message: string,
  ): AllocationFailure {
    return {
      ok: false,
      reason: "server-unavailable",
      deviceId: request.deviceId,
      ownerSkillId: request.ownerSkillId,
      message,
      device: null,
    };
  }

  #releaseServerUnavailable(
    request: ReleaseRequest,
    message: string,
  ): ReleaseFailure {
    return {
      ok: false,
      reason: "server-unavailable",
      deviceId: request.deviceId,
      ownerSkillId: request.ownerSkillId,
      message,
      device: null,
    };
  }
}
