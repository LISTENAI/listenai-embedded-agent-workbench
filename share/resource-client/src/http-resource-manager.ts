import type {
  AllocationFailure,
  AllocationRequest,
  AllocationResult,
  AllocationSuccessWithLease,
  BackendReadinessRecord,
  DeviceRecord,
  DslogicDeviceIdentity,
  InventoryBackendKind,
  InventoryDiagnostic,
  InventoryProviderKind,
  InventorySnapshot,
  LiveCaptureArtifact,
  LiveCaptureArtifactSummary,
  LiveCaptureFailureDiagnostics,
  LiveCaptureFailureKind,
  LiveCaptureRequest,
  LiveCaptureResult,
  LiveCaptureSession,
  LiveCaptureStreamSummary,
  ReleaseFailure,
  ReleaseRequest,
  ReleaseResult,
  SnapshotResourceManager,
} from "@listenai/contracts";

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

const parseInventoryDiagnostic = (
  value: unknown,
  path: string,
): InventoryDiagnostic => {
  if (!isObject(value)) {
    throw new Error(`Malformed inventory snapshot response at ${path}`);
  }

  const diagnostic: InventoryDiagnostic = {
    code: readString(value.code, `${path}.code`) as InventoryDiagnostic["code"],
    severity: readString(value.severity, `${path}.severity`) as InventoryDiagnostic["severity"],
    target: readString(value.target, `${path}.target`) as InventoryDiagnostic["target"],
    message: readString(value.message, `${path}.message`) as string,
  };

  if (value.deviceId !== undefined) {
    diagnostic.deviceId = readString(value.deviceId, `${path}.deviceId`) as string;
  }
  if (value.platform !== undefined) {
    diagnostic.platform = readString(value.platform, `${path}.platform`) as InventoryDiagnostic["platform"];
  }
  if (value.backendKind !== undefined) {
    diagnostic.backendKind = readString(
      value.backendKind,
      `${path}.backendKind`,
    ) as InventoryDiagnostic["backendKind"];
  }
  if (value.executablePath !== undefined) {
    diagnostic.executablePath = readString(
      value.executablePath,
      `${path}.executablePath`,
      true,
    );
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
    connectionState: readString(
      value.connectionState,
      `${path}.connectionState`,
    ) as DeviceRecord["connectionState"],
    allocationState: readString(
      value.allocationState,
      `${path}.allocationState`,
    ) as DeviceRecord["allocationState"],
    ownerSkillId: readString(value.ownerSkillId, `${path}.ownerSkillId`, true),
    lastSeenAt: readString(value.lastSeenAt, `${path}.lastSeenAt`, true),
    updatedAt: readString(value.updatedAt, `${path}.updatedAt`) as string,
  };

  if (value.readiness !== undefined) {
    record.readiness = readString(value.readiness, `${path}.readiness`) as DeviceRecord["readiness"];
  }
  if (value.diagnostics !== undefined) {
    record.diagnostics = readStringArrayField(
      value.diagnostics,
      `${path}.diagnostics`,
      parseInventoryDiagnostic,
    );
  }
  if (value.providerKind !== undefined) {
    record.providerKind = readString(
      value.providerKind,
      `${path}.providerKind`,
    ) as DeviceRecord["providerKind"];
  }
  if (value.backendKind !== undefined) {
    record.backendKind = readString(
      value.backendKind,
      `${path}.backendKind`,
    ) as DeviceRecord["backendKind"];
  }
  if (value.dslogic !== undefined) {
    record.dslogic = parseDslogicIdentity(value.dslogic, `${path}.dslogic`);
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
    platform: readString(value.platform, `${path}.platform`) as BackendReadinessRecord["platform"],
    backendKind: readString(
      value.backendKind,
      `${path}.backendKind`,
    ) as BackendReadinessRecord["backendKind"],
    readiness: readString(value.readiness, `${path}.readiness`) as BackendReadinessRecord["readiness"],
    executablePath: readString(value.executablePath, `${path}.executablePath`, true),
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
          readString(entry, entryPath) as InventorySnapshot["inventoryScope"]["providerKinds"][number],
      ),
      backendKinds: readStringArrayField(
        value.inventoryScope.backendKinds,
        "root.inventoryScope.backendKinds",
        (entry, entryPath) =>
          readString(entry, entryPath) as InventorySnapshot["inventoryScope"]["backendKinds"][number],
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
    kind: readLiveCaptureString(value.kind, `${path}.kind`) as LiveCaptureStreamSummary["kind"],
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
    providerKind: readLiveCaptureString(
      value.providerKind,
      `${path}.providerKind`,
      true,
    ) as LiveCaptureFailureDiagnostics["providerKind"],
    backendKind: readLiveCaptureString(
      value.backendKind,
      `${path}.backendKind`,
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

const parseLiveCaptureResult = (value: unknown): LiveCaptureResult => {
  if (!isObject(value)) {
    throw new Error("Malformed live capture response at root");
  }

  const ok = readLiveCaptureBoolean(value.ok, "root.ok");
  if (ok) {
    return {
      ok: true,
      providerKind: readLiveCaptureString(
        value.providerKind,
        "root.providerKind",
      ) as InventoryProviderKind,
      backendKind: readLiveCaptureString(
        value.backendKind,
        "root.backendKind",
      ) as InventoryBackendKind,
      session: parseLiveCaptureSession(value.session, "root.session"),
      requestedAt: readLiveCaptureString(value.requestedAt, "root.requestedAt") as string,
      artifact: parseLiveCaptureArtifact(value.artifact, "root.artifact"),
      artifactSummary: parseLiveCaptureArtifactSummary(
        value.artifactSummary,
        "root.artifactSummary",
      ),
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
