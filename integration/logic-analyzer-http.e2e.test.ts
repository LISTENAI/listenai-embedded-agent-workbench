// @ts-ignore - root workspace typecheck can miss vitest helper re-exports for these helpers, but runtime resolves them correctly
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  DeviceRecord,
  InventoryDiagnostic,
  InventorySnapshot,
  LeaseInfo,
  LiveCaptureResult,
} from "@listenai/eaw-contracts";
import {
  type CaptureDecodeProvider,
  type DecoderCapabilityProvider,
  type DeviceProvider,
  FakeDeviceProvider,
  LeaseManager,
  createDslogicDeviceOptionsRunner,
  createDslogicLiveCaptureRunner,
  createResourceManager,
  createServer,
} from "@listenai/eaw-resource-manager";
import { HttpResourceManager } from "@listenai/eaw-resource-client";
import {
  createGenericLogicAnalyzerSkill,
  createLogicAnalyzerSkill,
} from "@listenai/eaw-skill-logic-analyzer";

const connectedAt = "2026-03-26T00:00:00.000Z";
const allocatedAt = "2026-03-26T00:01:00.000Z";
const captureRequestedAt = "2026-03-26T00:01:10.000Z";
const releasedAt = "2026-03-26T00:02:00.000Z";
const reallocatedAt = "2026-03-26T00:03:00.000Z";

const fixtureCsvText = [
  "Time [us],D0,D1",
  "0,0,1",
  "1,1,1",
  "2,1,0",
  "3,0,0",
].join("\n");

const fixtureVcdText = [
  "$date",
  "  2026-03-26T00:00:01.000Z",
  "$end",
  "$version DSView $end",
  "$timescale 1 ns $end",
  "$scope module logic $end",
  "$var wire 1 ! D0 $end",
  "$var wire 1 \" D1 $end",
  "$upscope $end",
  "$enddefinitions $end",
  "#0",
  "$dumpvars",
  "0!",
  "1\"",
  "$end",
  "#1000",
  "1!",
  "#2000",
  "0\"",
  "#3000",
  "0!",
].join("\n");

const fixtureCaptureTuning = {
  operation: "collect",
  channel: "buffer",
  stop: "samples",
  filter: "none",
  threshold: "1.8v",
} as const;

const uartDecoderCapability = {
  decoderId: "1:uart",
  label: "UART",
  description: "Generic UART protocol decoder exposed through dsview-cli.",
  requiredChannels: [{ id: "rx", label: "RX" }],
  optionalChannels: [],
  options: [
    {
      id: "baudrate",
      label: "Baud rate",
      valueType: "number",
      required: true,
      values: [921600],
    },
  ],
} as const;

const uartDecodeArtifactSummary = {
  sourceName: "logic-1-uart.vcd",
  formatHint: "dsview-vcd",
  mediaType: "text/x-vcd",
  capturedAt: captureRequestedAt,
  byteLength: null,
  textLength: fixtureVcdText.length,
  hasText: true,
} as const;

const uartDecodeReport = {
  decoderId: "1:uart",
  annotations: [
    {
      startSample: 4,
      endSample: 32,
      channel: "rx",
      text: "0x55",
    },
  ],
  rows: [
    {
      timestampNs: 1200,
      channel: "rx",
      value: "0x55",
      text: "U",
    },
  ],
  raw: {
    text: "U",
    bytes: [85],
    decoderId: "1:uart",
    rows: [{ value: "0x55", text: "U" }],
  },
} as const;

interface ServerState {
  devices: DeviceRecord[];
  leases: LeaseInfo[];
}

function createDiagnostic(
  overrides: Partial<InventoryDiagnostic> = {},
): InventoryDiagnostic {
  return {
    code: "backend-runtime-failed",
    severity: "warning",
    target: "backend",
    message: "Backend probe returned incomplete capability data.",
    backendKind: "dsview-cli",
    ...overrides,
  };
}

function createInventoryDevice(
  overrides: Partial<DeviceRecord> = {},
): DeviceRecord {
  return {
    deviceId: "logic-1",
    label: "USB Logic Analyzer",
    capabilityType: "logic-analyzer",
    connectionState: "connected",
    allocationState: "free",
    ownerSkillId: null,
    lastSeenAt: connectedAt,
    updatedAt: connectedAt,
    readiness: "ready",
    diagnostics: [],
    providerKind: "dslogic",
    backendKind: "dsview-cli",
    dslogic: {
      family: "dslogic",
      model: "dslogic-plus",
      modelDisplayName: "DSLogic Plus",
      variant: "classic",
      usbVendorId: "2a0e",
      usbProductId: "0001",
    },
    ...overrides,
  };
}

function createReadyInventorySnapshot(
  overrides: Partial<InventorySnapshot> = {},
): InventorySnapshot {
  return {
    refreshedAt: connectedAt,
    inventoryScope: {
      providerKinds: ["dslogic"],
      backendKinds: ["dsview-cli"],
    },
    devices: [createInventoryDevice()],
    backendReadiness: [
      {
        platform: "macos",
        backendKind: "dsview-cli",
        readiness: "ready",
        version: "dsview-cli 1.0.3",
        checkedAt: connectedAt,
        diagnostics: [],
      },
    ],
    diagnostics: [],
    ...overrides,
  };
}

function supportsDslogicRuntime(device: DeviceRecord): boolean {
  return device.providerKind === "dslogic" && device.backendKind === "dsview-cli";
}

function createBackendMissingSnapshot(): InventorySnapshot {
  return createReadyInventorySnapshot({
    backendReadiness: [
      {
        platform: "macos",
        backendKind: "dsview-cli",
        readiness: "missing",
        version: null,
        checkedAt: connectedAt,
        diagnostics: [
          createDiagnostic({
            code: "backend-missing-runtime",
            severity: "error",
            message: "dsview-cli runtime is not available on macos.",
          }),
        ],
      },
    ],
    diagnostics: [
      createDiagnostic({
        code: "backend-missing-runtime",
        severity: "error",
        message: "dsview-cli runtime is not available on macos.",
      }),
    ],
  });
}

function createUnsupportedDeviceSnapshot(): InventorySnapshot {
  return createReadyInventorySnapshot({
    devices: [
      createInventoryDevice({
        readiness: "unsupported",
        diagnostics: [
          createDiagnostic({
            code: "device-unsupported-variant",
            severity: "error",
            target: "device",
            message: "Variant V421/Pango is not supported.",
            deviceId: "logic-1",
          }),
        ],
        dslogic: {
          family: "dslogic",
          model: "dslogic-plus",
          modelDisplayName: "DSLogic Plus",
          variant: "v421-pango",
          usbVendorId: "2a0e",
          usbProductId: "0030",
        },
      }),
    ],
  });
}

async function waitFor(
  assertion: () => Promise<void>,
  timeoutMs = 1500,
  intervalMs = 20,
) {
  const startedAt = Date.now();
  let lastError: unknown;

  while (Date.now() - startedAt <= timeoutMs) {
    try {
      await assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  throw lastError ?? new Error(`Condition not met within ${timeoutMs}ms`);
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`Request failed for ${url}: ${response.status}`);
  }

  return (await response.json()) as T;
}

async function getServerState(url: string): Promise<ServerState> {
  const [devices, leases] = await Promise.all([
    fetchJson<DeviceRecord[]>(`${url}/devices`),
    fetchJson<LeaseInfo[]>(`${url}/leases`),
  ]);

  return { devices, leases };
}

function createOfflineGenericRequest(requestedAt: string) {
  return {
    session: {
      deviceId: "logic-1",
      ownerSkillId: "logic-analyzer",
      requestedAt,
      sampling: {
        sampleRateHz: 1_000_000,
        captureDurationMs: 0.004,
        channels: [
          { channelId: "D0", label: "CLK" },
          { channelId: "D1", label: "DATA" },
        ],
      },
      analysis: {
        focusChannelIds: ["D0", "D1"],
        edgePolicy: "all",
        includePulseWidths: true,
        timeReference: "capture-start",
      },
    },
    artifact: {
      sourceName: "capture.csv",
      capturedAt: "2026-03-26T00:00:01.000Z",
      text: fixtureCsvText,
    },
    cleanup: {
      endedAt: releasedAt,
    },
  };
}

function createLiveGenericRequest(requestedAt: string) {
  return {
    mode: "live" as const,
    session: createOfflineGenericRequest(requestedAt).session,
    capture: {
      requestedAt: captureRequestedAt,
      timeoutMs: 1500,
    },
    cleanup: {
      endedAt: releasedAt,
    },
  };
}

function createSessionRequest(requestedAt: string) {
  return createOfflineGenericRequest(requestedAt).session;
}

async function withLiveServer(
  initialSnapshot: InventorySnapshot,
  run: (context: { url: string; provider: FakeDeviceProvider }) => Promise<void>,
  options: {
    decoderCapabilities?: DecoderCapabilityProvider;
    captureDecode?: CaptureDecodeProvider;
    deviceOptionsRunner?: ReturnType<typeof createDslogicDeviceOptionsRunner>;
    liveCaptureRunner?: ReturnType<typeof createDslogicLiveCaptureRunner>;
  } = {},
): Promise<void> {
  const provider = new FakeDeviceProvider(initialSnapshot);
  const managerProvider: DeviceProvider = {
    listInventorySnapshot: () => provider.listInventorySnapshot(),
    listConnectedDevices: () => provider.listConnectedDevices(),
    deviceOptions: provider.deviceOptions,
    decoderCapabilities: options.decoderCapabilities ?? provider.decoderCapabilities,
    captureDecode: options.captureDecode ?? provider.captureDecode,
    liveCapture: provider.liveCapture,
  };
  const manager = createResourceManager(managerProvider, {
    deviceOptionsRunner: options.deviceOptionsRunner,
    liveCaptureRunner: options.liveCaptureRunner,
  });
  const leaseManager = new LeaseManager({ timeoutMs: 120 });
  const server = createServer({
    port: 0,
    host: "127.0.0.1",
    manager,
    leaseManager,
    scanIntervalMs: 15,
  });

  const { url, port } = await server.start();

  try {
    expect(port).toBeGreaterThan(0);
    expect(url).not.toContain(":0");
    await fetchJson<DeviceRecord[]>(`${url}/refresh`, { method: "POST" });
    await run({ url, provider });
  } finally {
    server.stop();
  }
}

const managersToDispose = new Set<HttpResourceManager>();

afterEach(() => {
  vi.restoreAllMocks();
  for (const manager of managersToDispose) {
    manager.dispose();
  }
  managersToDispose.clear();
});

describe("logic-analyzer live HTTP workflow", () => {
  it("inspects options, tunes live capture, loads dsview-vcd, and preserves auxiliary artifacts over HTTP", async () => {
    let optionsLookupCount = 0;
    let captureCount = 0;
    const deviceOptionsRunner = createDslogicDeviceOptionsRunner(async (request) => {
      optionsLookupCount += 1;
      expect(request.requestedAt).toBe(captureRequestedAt);
      expect(request.session.deviceId).toBe("logic-1");

      return {
        ok: true,
        backendVersion: "1.2.2",
        capabilities: {
          operations: [{ token: fixtureCaptureTuning.operation, label: "Collect" }],
          channels: [{ token: fixtureCaptureTuning.channel, label: "Buffer" }],
          stopConditions: [{ token: fixtureCaptureTuning.stop, label: "Samples" }],
          filters: [{ token: fixtureCaptureTuning.filter, label: "None" }],
          thresholds: [{ token: fixtureCaptureTuning.threshold, label: "CMOS 1.8V" }],
        },
        optionsOutput: { text: "fixture options payload" },
      };
    });
    const liveCaptureRunner = createDslogicLiveCaptureRunner(async (request) => {
      captureCount += 1;
      expect(request.captureTuning).toEqual(fixtureCaptureTuning);

      return {
        ok: true,
        backendVersion: "1.2.2",
        artifact: {
          sourceName: "logic-1-live.vcd",
          formatHint: "dsview-vcd",
          mediaType: "text/x-vcd",
          capturedAt: captureRequestedAt,
          text: fixtureVcdText,
        },
        auxiliaryArtifacts: [
          {
            sourceName: "logic-1-live.metadata.json",
            formatHint: "dsview-metadata",
            mediaType: "application/json",
            capturedAt: captureRequestedAt,
            text: JSON.stringify({ backendVersion: "1.2.2", tuned: true }),
          },
        ],
      };
    });

    await withLiveServer(
      createReadyInventorySnapshot(),
      async ({ url }) => {
        const resourceManager = new HttpResourceManager(url);
        const rawLiveCaptures: LiveCaptureResult[] = [];
        const originalLiveCapture = resourceManager.liveCapture.bind(resourceManager);
        resourceManager.liveCapture = async (request) => {
          const result = await originalLiveCapture(request);
          rawLiveCaptures.push(result);
          return result;
        };
        managersToDispose.add(resourceManager);
        const sessionSkill = createLogicAnalyzerSkill(resourceManager, {
          createSessionId: () => "session-live",
        });

        const startResult = await sessionSkill.startSession(createSessionRequest(allocatedAt));
        expect(startResult).toMatchObject({
          ok: true,
          session: {
            sessionId: "session-live",
            deviceId: "logic-1",
            ownerSkillId: "logic-analyzer",
          },
        });
        expect(startResult.ok).toBe(true);
        if (!startResult.ok) {
          return;
        }

        const optionsResult = await resourceManager.inspectDeviceOptions({
          session: startResult.session,
          requestedAt: captureRequestedAt,
          timeoutMs: 1500,
        });
        expect(optionsResult).toMatchObject({
          ok: true,
          providerKind: "dslogic",
          backendKind: "dsview-cli",
          capabilities: {
            operations: [{ token: fixtureCaptureTuning.operation }],
            channels: [{ token: fixtureCaptureTuning.channel }],
            stopConditions: [{ token: fixtureCaptureTuning.stop }],
            filters: [{ token: fixtureCaptureTuning.filter }],
            thresholds: [{ token: fixtureCaptureTuning.threshold }],
          },
        });
        expect(optionsLookupCount).toBe(1);
        expect(captureCount).toBe(0);

        const captureResult = await sessionSkill.captureSession({
          session: startResult.session,
          requestedAt: captureRequestedAt,
          timeoutMs: 1500,
          captureTuning: fixtureCaptureTuning,
        });

        expect(captureResult).toMatchObject({
          ok: true,
          session: {
            sessionId: "session-live",
            deviceId: "logic-1",
            ownerSkillId: "logic-analyzer",
          },
          providerKind: "dslogic",
          backendKind: "dsview-cli",
          artifactSummary: {
            sourceName: "logic-1-live.vcd",
            formatHint: "dsview-vcd",
            hasText: true,
          },
          capture: {
            ok: true,
            adapterId: "dsview-vcd",
            selectedBy: "format-hint",
            capture: {
              sampleRateHz: 1_000_000,
              totalSamples: 4,
              artifact: {
                sourceName: "logic-1-live.vcd",
                hasText: true,
              },
            },
          },
        });
        expect(captureCount).toBe(1);
        expect(rawLiveCaptures).toHaveLength(1);
        expect(rawLiveCaptures[0]).toMatchObject({
          ok: true,
          auxiliaryArtifactSummaries: [
            {
              sourceName: "logic-1-live.metadata.json",
              formatHint: "dsview-metadata",
              mediaType: "application/json",
              hasText: true,
            },
          ],
        });

        const allocatedState = await getServerState(url);
        expect(allocatedState.devices).toEqual([
          expect.objectContaining({
            deviceId: "logic-1",
            allocationState: "allocated",
            ownerSkillId: "logic-analyzer",
            updatedAt: expect.any(String),
          }),
        ]);
        expect(allocatedState.leases).toEqual([
          expect.objectContaining({
            deviceId: "logic-1",
            ownerSkillId: "logic-analyzer",
            leaseId: resourceManager.getLeaseId("logic-1"),
          }),
        ]);

        const endResult = await sessionSkill.endSession({
          sessionId: startResult.session.sessionId,
          deviceId: startResult.session.deviceId,
          ownerSkillId: startResult.session.ownerSkillId,
          endedAt: releasedAt,
        });

        expect(endResult).toMatchObject({
          ok: true,
          device: {
            deviceId: "logic-1",
            allocationState: "free",
            ownerSkillId: null,
          },
        });
      },
      { deviceOptionsRunner, liveCaptureRunner },
    );
  });

  it("proves connected UART capture-decode over HTTP without live waveform capture", async () => {
    const events: string[] = [];
    let capabilityRequestCount = 0;
    let captureDecodeRequestCount = 0;
    let liveCaptureCount = 0;

    const decoderCapabilities: DecoderCapabilityProvider = {
      supportsDevice: supportsDslogicRuntime,
      listDecoderCapabilities: async (request) => {
        capabilityRequestCount += 1;
        events.push("decoder-capabilities");
        expect(request).toMatchObject({
          deviceId: "logic-1",
          requestedAt: captureRequestedAt,
          timeoutMs: 1500,
        });

        return {
          ok: true,
          providerKind: "dslogic",
          backendKind: "dsview-cli",
          backendVersion: "1.2.2",
          deviceId: request.deviceId,
          requestedAt: request.requestedAt,
          decoders: [uartDecoderCapability],
        };
      },
    };

    const captureDecode: CaptureDecodeProvider = {
      supportsDevice: supportsDslogicRuntime,
      captureDecode: async (request) => {
        captureDecodeRequestCount += 1;
        events.push("capture-decode");
        expect(request.session).toMatchObject({
          sessionId: "session-uart",
          deviceId: "logic-1",
          ownerSkillId: "logic-analyzer",
          device: {
            deviceId: "logic-1",
            allocationState: "allocated",
            ownerSkillId: "logic-analyzer",
            providerKind: "dslogic",
            backendKind: "dsview-cli",
          },
        });
        expect(request.captureTuning).toEqual(fixtureCaptureTuning);
        expect(request.decode).toEqual({
          decoderId: "1:uart",
          channelMappings: { rx: "D0" },
          decoderOptions: { baudrate: 921600 },
        });

        return {
          ok: true,
          providerKind: "dslogic",
          backendKind: "dsview-cli",
          session: request.session,
          requestedAt: request.requestedAt,
          artifactSummary: uartDecodeArtifactSummary,
          auxiliaryArtifactSummaries: [
            {
              sourceName: "logic-1-uart.decoder.json",
              formatHint: "decoder-report",
              mediaType: "application/json",
              capturedAt: request.requestedAt,
              byteLength: null,
              textLength: JSON.stringify(uartDecodeReport.raw).length,
              hasText: true,
            },
          ],
          decode: uartDecodeReport,
        };
      },
    };

    const liveCaptureRunner = createDslogicLiveCaptureRunner(async () => {
      liveCaptureCount += 1;
      throw new Error("Connected UART capture-decode must not use live waveform capture.");
    });

    await withLiveServer(
      createReadyInventorySnapshot(),
      async ({ url }) => {
        const resourceManager = new HttpResourceManager(url);
        managersToDispose.add(resourceManager);
        const sessionSkill = createLogicAnalyzerSkill(resourceManager, {
          createSessionId: () => "session-uart",
        });

        const startResult = await sessionSkill.startSession(createSessionRequest(allocatedAt));
        expect(startResult).toMatchObject({
          ok: true,
          session: {
            sessionId: "session-uart",
            deviceId: "logic-1",
            ownerSkillId: "logic-analyzer",
          },
        });
        expect(startResult.ok).toBe(true);
        if (!startResult.ok) {
          return;
        }

        const capabilitiesResult = await resourceManager.listDecoderCapabilities({
          deviceId: startResult.session.deviceId,
          requestedAt: captureRequestedAt,
          timeoutMs: 1500,
        });
        expect(capabilitiesResult).toMatchObject({
          ok: true,
          providerKind: "dslogic",
          backendKind: "dsview-cli",
          backendVersion: "1.2.2",
          deviceId: "logic-1",
          requestedAt: captureRequestedAt,
        });
        expect(capabilitiesResult.ok).toBe(true);
        if (!capabilitiesResult.ok) {
          return;
        }
        expect(capabilitiesResult.decoders).toContainEqual(uartDecoderCapability);
        const uartCapability = capabilitiesResult.decoders.find(
          (decoder) => decoder.decoderId === "1:uart",
        );
        expect(uartCapability).toMatchObject({
          decoderId: "1:uart",
          requiredChannels: [{ id: "rx" }],
          options: [{ id: "baudrate", valueType: "number", values: [921600] }],
        });

        const decodeRequest = {
          session: startResult.session,
          requestedAt: captureRequestedAt,
          timeoutMs: 1500,
          captureTuning: fixtureCaptureTuning,
          decode: {
            decoderId: "1:uart",
            channelMappings: { rx: "D0" },
            decoderOptions: { baudrate: 921600 },
          },
        };
        const decodeResult = await resourceManager.captureDecode(decodeRequest);

        expect(decodeResult).toMatchObject({
          ok: true,
          providerKind: "dslogic",
          backendKind: "dsview-cli",
          session: {
            sessionId: "session-uart",
            deviceId: "logic-1",
            ownerSkillId: "logic-analyzer",
          },
          requestedAt: captureRequestedAt,
          artifactSummary: {
            sourceName: "logic-1-uart.vcd",
            formatHint: "dsview-vcd",
            mediaType: "text/x-vcd",
            hasText: true,
          },
          auxiliaryArtifactSummaries: [
            expect.objectContaining({
              sourceName: "logic-1-uart.decoder.json",
              formatHint: "decoder-report",
              hasText: true,
            }),
          ],
          decode: {
            decoderId: "1:uart",
            rows: [
              {
                timestampNs: 1200,
                channel: "rx",
                value: "0x55",
                text: "U",
              },
            ],
            annotations: [
              {
                startSample: 4,
                endSample: 32,
                channel: "rx",
                text: "0x55",
              },
            ],
          },
        });
        expect(decodeResult.ok).toBe(true);
        if (!decodeResult.ok) {
          return;
        }
        expect(decodeResult.decode.raw).toEqual(uartDecodeReport.raw);

        const unavailableResult = await resourceManager.captureDecode({
          ...decodeRequest,
          decode: {
            ...decodeRequest.decode,
            decoderId: "1:not-present",
          },
        });
        expect(unavailableResult).toMatchObject({
          ok: false,
          reason: "capture-decode-failed",
          kind: "decode-failed",
          message: "Decoder 1:not-present is not available for device logic-1.",
          session: {
            sessionId: "session-uart",
            deviceId: "logic-1",
            ownerSkillId: "logic-analyzer",
          },
          artifactSummary: null,
          decode: null,
          diagnostics: {
            phase: "decode-validation",
            providerKind: "dslogic",
            backendKind: "dsview-cli",
            backendVersion: "1.2.2",
            timeoutMs: 1500,
            details: [
              "Available decoder ids: 1:uart.",
              "Requested channel mapping rx -> D0 and baudrate 921600.",
            ],
          },
        });

        expect(events).toEqual([
          "decoder-capabilities",
          "decoder-capabilities",
          "capture-decode",
          "decoder-capabilities",
        ]);
        expect(capabilityRequestCount).toBe(3);
        expect(captureDecodeRequestCount).toBe(1);
        expect(liveCaptureCount).toBe(0);

        const allocatedState = await getServerState(url);
        expect(allocatedState.devices).toEqual([
          expect.objectContaining({
            deviceId: "logic-1",
            allocationState: "allocated",
            ownerSkillId: "logic-analyzer",
          }),
        ]);
        expect(allocatedState.leases).toEqual([
          expect.objectContaining({
            deviceId: "logic-1",
            ownerSkillId: "logic-analyzer",
            leaseId: resourceManager.getLeaseId("logic-1"),
          }),
        ]);

        const endResult = await sessionSkill.endSession({
          sessionId: startResult.session.sessionId,
          deviceId: startResult.session.deviceId,
          ownerSkillId: startResult.session.ownerSkillId,
          endedAt: releasedAt,
        });
        expect(endResult).toMatchObject({
          ok: true,
          device: {
            deviceId: "logic-1",
            allocationState: "free",
            ownerSkillId: null,
          },
        });
      },
      { decoderCapabilities, captureDecode, liveCaptureRunner },
    );
  });

  it("preserves typed live runtime failures over HTTP and leaves the accepted lease inspectable", async () => {
    const liveCaptureRunner = createDslogicLiveCaptureRunner(async () => ({
      ok: false,
      kind: "timeout",
      phase: "capture",
      message: "dsview-cli capture timed out.",
            timeoutMs: 1500,
    }));

    await withLiveServer(
      createReadyInventorySnapshot(),
      async ({ url }) => {
        const resourceManager = new HttpResourceManager(url);
        managersToDispose.add(resourceManager);
        const sessionSkill = createLogicAnalyzerSkill(resourceManager, {
          createSessionId: () => "session-timeout",
        });

        const startResult = await sessionSkill.startSession(createSessionRequest(allocatedAt));
        expect(startResult.ok).toBe(true);
        if (!startResult.ok) {
          return;
        }

        const captureResult = await sessionSkill.captureSession({
          session: startResult.session,
          requestedAt: captureRequestedAt,
          timeoutMs: 1500,
        });

        expect(captureResult).toMatchObject({
          ok: false,
          reason: "capture-runtime-failed",
          session: {
            sessionId: "session-timeout",
            deviceId: "logic-1",
            ownerSkillId: "logic-analyzer",
          },
          captureRuntime: {
            ok: false,
            kind: "timeout",
            diagnostics: {
              phase: "capture",
              timeoutMs: 1500,
            },
          },
        });

        const allocatedState = await getServerState(url);
        expect(allocatedState.devices).toEqual([
          expect.objectContaining({
            deviceId: "logic-1",
            allocationState: "allocated",
            ownerSkillId: "logic-analyzer",
          }),
        ]);
        expect(allocatedState.leases).toEqual([
          expect.objectContaining({
            deviceId: "logic-1",
            ownerSkillId: "logic-analyzer",
          }),
        ]);
      },
      { liveCaptureRunner },
    );
  });

  it("proves the packaged live entrypoint over HTTP and keeps cleanup explicit on success", async () => {
    const liveCaptureRunner = createDslogicLiveCaptureRunner(async () => ({
      ok: true,
            artifact: {
        sourceName: "logic-1-live.vcd",
        formatHint: "dsview-vcd",
        mediaType: "text/x-vcd",
        capturedAt: captureRequestedAt,
        text: fixtureVcdText,
      },
    }));

    await withLiveServer(
      createReadyInventorySnapshot(),
      async ({ url }) => {
        const resourceManager = new HttpResourceManager(url);
        managersToDispose.add(resourceManager);
        const genericSkill = createGenericLogicAnalyzerSkill(resourceManager, {
          createSessionId: () => "session-001",
        });
        const sessionSkill = createLogicAnalyzerSkill(resourceManager);

        const beforeRunState = await getServerState(url);
        expect(beforeRunState.devices).toEqual([
          expect.objectContaining({
            deviceId: "logic-1",
            allocationState: "free",
            ownerSkillId: null,
          }),
        ]);
        expect(beforeRunState.leases).toEqual([]);

        const result = await genericSkill.run(createLiveGenericRequest(allocatedAt));

        expect(result).toMatchObject({
          ok: true,
          phase: "completed",
          session: {
            sessionId: "session-001",
            deviceId: "logic-1",
            ownerSkillId: "logic-analyzer",
          },
          capture: {
            ok: true,
            adapterId: "dsview-vcd",
            selectedBy: "format-hint",
            capture: {
              adapterId: "dsview-vcd",
              sampleRateHz: 1_000_000,
              samplePeriodNs: 1000,
              totalSamples: 4,
              durationNs: 4000,
              artifact: {
                sourceName: "logic-1-live.vcd",
                hasText: true,
              },
            },
          },
          captureSession: {
            ok: true,
            requestedAt: captureRequestedAt,
            artifactSummary: {
              sourceName: "logic-1-live.vcd",
              formatHint: "dsview-vcd",
              hasText: true,
            },
          },
          analysis: {
            captureSource: {
              adapterId: "dsview-vcd",
              sourceName: "logic-1-live.vcd",
              capturedAt: captureRequestedAt,
            },
            analyzedChannelIds: ["D0", "D1"],
          },
        });
        expect(result.ok).toBe(true);
        if (!result.ok) {
          return;
        }

        expect(result.analysis.channels).toEqual([
          expect.objectContaining({
            channelId: "D0",
            observedEdgeKinds: ["rising", "falling"],
            qualifyingTransitionCount: 2,
            summaryText:
              "2 rising/falling edges observed, rhythm is steady at about 500000Hz, high widths avg 2000ns, low widths avg 1000ns.",
          }),
          expect.objectContaining({
            channelId: "D1",
            observedEdgeKinds: ["falling"],
            qualifyingTransitionCount: 1,
            summaryText:
              "1 falling edge observed, insufficient data for rhythm, high widths avg 2000ns, low widths avg 2000ns.",
          }),
        ]);
        expect(result.analysis.capabilityNotes).toEqual([
          {
            code: "focus-channels-applied",
            message: "Analysis is limited to the requested focus channels.",
            details: {
              requestedChannelCount: 2,
              analyzedChannelCount: 2,
            },
          },
          {
            code: "baseline-only-no-protocol-decoding",
            message: "Structured output only covers baseline waveform interpretation.",
          },
        ]);

        expect(resourceManager.getLastInventorySnapshot()).toMatchObject({
          backendReadiness: [
            expect.objectContaining({
              backendKind: "dsview-cli",
              readiness: "ready",
            }),
          ],
          devices: [
            expect.objectContaining({
              deviceId: "logic-1",
              readiness: "ready",
            }),
          ],
        });

        const allocatedState = await getServerState(url);
        expect(allocatedState.devices).toEqual([
          expect.objectContaining({
            deviceId: "logic-1",
            allocationState: "allocated",
            ownerSkillId: "logic-analyzer",
            updatedAt: expect.any(String),
          }),
        ]);
        expect(allocatedState.leases).toEqual([
          expect.objectContaining({
            deviceId: "logic-1",
            ownerSkillId: "logic-analyzer",
          }),
        ]);

        const endResult = await sessionSkill.endSession({
          sessionId: result.session.sessionId,
          deviceId: result.session.deviceId,
          ownerSkillId: result.session.ownerSkillId,
          endedAt: releasedAt,
        });

        expect(endResult).toEqual({
          ok: true,
          device: {
            deviceId: "logic-1",
            label: "USB Logic Analyzer",
            capabilityType: "logic-analyzer",
            connectionState: "connected",
            allocationState: "free",
            ownerSkillId: null,
            lastSeenAt: connectedAt,
            updatedAt: releasedAt,
            readiness: "ready",
            diagnostics: [],
            providerKind: "dslogic",
            backendKind: "dsview-cli",
            dslogic: {
              family: "dslogic",
              model: "dslogic-plus",
              modelDisplayName: "DSLogic Plus",
              variant: "classic",
              usbVendorId: "2a0e",
              usbProductId: "0001",
            },
          },
        });

        const releasedState = await getServerState(url);
        expect(releasedState.devices).toEqual([
          {
            deviceId: "logic-1",
            label: "USB Logic Analyzer",
            capabilityType: "logic-analyzer",
            connectionState: "connected",
            allocationState: "free",
            ownerSkillId: null,
            lastSeenAt: connectedAt,
            updatedAt: expect.any(String),
            readiness: "ready",
            diagnostics: [],
            providerKind: "dslogic",
            backendKind: "dsview-cli",
            dslogic: {
              family: "dslogic",
              model: "dslogic-plus",
              modelDisplayName: "DSLogic Plus",
              variant: "classic",
              usbVendorId: "2a0e",
              usbProductId: "0001",
            },
          },
        ]);
        expect(releasedState.leases).toEqual([]);
      },
      { liveCaptureRunner },
    );
  });

  it("throws malformed live HTTP payloads as parser errors and keeps the accepted lease inspectable", async () => {
    const liveCaptureRunner = createDslogicLiveCaptureRunner(async () => ({
      ok: true,
            artifact: {
        sourceName: "logic-1-live.vcd",
        formatHint: "dsview-vcd",
        mediaType: "text/x-vcd",
        capturedAt: captureRequestedAt,
        text: fixtureVcdText,
      },
    }));

    await withLiveServer(
      createReadyInventorySnapshot(),
      async ({ url }) => {
        const resourceManager = new HttpResourceManager(url);
        managersToDispose.add(resourceManager);
        const genericSkill = createGenericLogicAnalyzerSkill(resourceManager, {
          createSessionId: () => "session-malformed-http",
        });
        const sessionSkill = createLogicAnalyzerSkill(resourceManager);
        const originalFetch = globalThis.fetch;

        vi
          .spyOn(globalThis, "fetch")
          .mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
          const requestUrl =
            typeof input === "string"
              ? input
              : input instanceof URL
                ? input.href
                : input.url;

          if (requestUrl === `${url}/capture/live`) {
            const body = JSON.parse(String(init?.body ?? "{}")) as {
              session?: {
                sessionId?: string;
                deviceId?: string;
                ownerSkillId?: string;
                startedAt?: string;
                sampling?: unknown;
              };
              requestedAt?: string;
            };

            return new Response(
              JSON.stringify({
                ok: true,
                providerKind: "dslogic",
                backendKind: "dsview-cli",
                session: {
                  sessionId: body.session?.sessionId,
                  deviceId: body.session?.deviceId,
                  ownerSkillId: body.session?.ownerSkillId,
                  startedAt: body.session?.startedAt,
                  device: createInventoryDevice({
                    allocationState: "allocated",
                    ownerSkillId: body.session?.ownerSkillId ?? "logic-analyzer",
                    updatedAt: allocatedAt,
                  }),
                  sampling: body.session?.sampling,
                },
                requestedAt: body.requestedAt,
                artifact: {
                  sourceName: "logic-1-live.vcd",
                  formatHint: "dsview-vcd",
                  mediaType: "text/x-vcd",
                  capturedAt: captureRequestedAt,
                  text: fixtureVcdText,
                },
                artifactSummary: {
                  sourceName: "logic-1-live.vcd",
                  formatHint: "dsview-vcd",
                  mediaType: null,
                  capturedAt: captureRequestedAt,
                  byteLength: null,
                  textLength: fixtureVcdText.length,
                  hasText: "yes",
                },
              }),
              {
                status: 200,
                headers: {
                  "Content-Type": "application/json",
                },
              },
            );
          }

          return originalFetch(input, init);
        });

        await expect(genericSkill.run(createLiveGenericRequest(allocatedAt))).rejects.toThrow(
          "Malformed live capture response at root.artifactSummary.hasText",
        );

        const allocatedState = await getServerState(url);
        expect(allocatedState.devices).toEqual([
          expect.objectContaining({
            deviceId: "logic-1",
            allocationState: "allocated",
            ownerSkillId: "logic-analyzer",
            updatedAt: expect.any(String),
          }),
        ]);
        expect(allocatedState.leases).toEqual([
          expect.objectContaining({
            deviceId: "logic-1",
            ownerSkillId: "logic-analyzer",
            leaseId: resourceManager.getLeaseId("logic-1"),
          }),
        ]);

        const endResult = await sessionSkill.endSession({
          sessionId: "session-malformed-http",
          deviceId: "logic-1",
          ownerSkillId: "logic-analyzer",
          endedAt: releasedAt,
        });

        expect(endResult).toMatchObject({
          ok: true,
          device: {
            deviceId: "logic-1",
            allocationState: "free",
            ownerSkillId: null,
          },
        });
      },
      { liveCaptureRunner },
    );
  });

  it("keeps packaged live runtime failures typed over HTTP and exposes cleanup diagnostics", async () => {
    const liveCaptureRunner = createDslogicLiveCaptureRunner(async () => ({
      ok: false,
      kind: "timeout",
      phase: "capture",
      message: "dsview-cli capture timed out.",
            timeoutMs: 1500,
    }));

    await withLiveServer(
      createReadyInventorySnapshot(),
      async ({ url }) => {
        const resourceManager = new HttpResourceManager(url);
        managersToDispose.add(resourceManager);
        const genericSkill = createGenericLogicAnalyzerSkill(resourceManager, {
          createSessionId: () => "session-timeout",
        });

        const result = await genericSkill.run(createLiveGenericRequest(allocatedAt));

        expect(result).toMatchObject({
          ok: false,
          phase: "live-capture",
          session: {
            sessionId: "session-timeout",
            deviceId: "logic-1",
            ownerSkillId: "logic-analyzer",
          },
          captureSession: {
            ok: false,
            reason: "capture-runtime-failed",
            requestedAt: captureRequestedAt,
            captureRuntime: {
              ok: false,
              kind: "timeout",
              diagnostics: {
                phase: "capture",
                timeoutMs: 1500,
              },
            },
          },
          cleanup: {
            attempted: true,
            request: {
              sessionId: "session-timeout",
              deviceId: "logic-1",
              ownerSkillId: "logic-analyzer",
              endedAt: releasedAt,
            },
            result: {
              ok: true,
              device: {
                deviceId: "logic-1",
                allocationState: "free",
                ownerSkillId: null,
              },
            },
          },
        });

        const releasedState = await getServerState(url);
        expect(releasedState.devices).toEqual([
          expect.objectContaining({
            deviceId: "logic-1",
            allocationState: "free",
            ownerSkillId: null,
          }),
        ]);
        expect(releasedState.leases).toEqual([]);
      },
      { liveCaptureRunner },
    );
  });

  it("preserves the packaged result shape and frees the device after explicit endSession", async () => {
    await withLiveServer(createReadyInventorySnapshot(), async ({ url }) => {
      const resourceManager = new HttpResourceManager(url);
      managersToDispose.add(resourceManager);
      const genericSkill = createGenericLogicAnalyzerSkill(resourceManager, {
        createSessionId: () => "session-001",
      });
      const sessionSkill = createLogicAnalyzerSkill(resourceManager);

      const beforeRunState = await getServerState(url);
      expect(beforeRunState.devices).toEqual([
        expect.objectContaining({
          deviceId: "logic-1",
          allocationState: "free",
          ownerSkillId: null,
        }),
      ]);
      expect(beforeRunState.leases).toEqual([]);

      const result = await genericSkill.run(createOfflineGenericRequest(allocatedAt));

      expect(result).toMatchObject({
        ok: true,
        phase: "completed",
        session: {
          sessionId: "session-001",
          deviceId: "logic-1",
          ownerSkillId: "logic-analyzer",
        },
        capture: {
          ok: true,
          adapterId: "sigrok-csv",
          selectedBy: "probe",
          capture: {
            adapterId: "sigrok-csv",
            sampleRateHz: 1_000_000,
            samplePeriodNs: 1000,
            totalSamples: 4,
            durationNs: 4000,
            artifact: {
              sourceName: "capture.csv",
              hasText: true,
            },
          },
        },
        analysis: {
          captureSource: {
            adapterId: "sigrok-csv",
            sourceName: "capture.csv",
            capturedAt: "2026-03-26T00:00:01.000Z",
          },
          analyzedChannelIds: ["D0", "D1"],
        },
      });
      expect(result.ok).toBe(true);
      if (!result.ok) {
        return;
      }

      expect(result.analysis.channels).toEqual([
        expect.objectContaining({
          channelId: "D0",
          observedEdgeKinds: ["rising", "falling"],
          qualifyingTransitionCount: 2,
          summaryText:
            "2 rising/falling edges observed, rhythm is steady at about 500000Hz, high widths avg 2000ns, low widths avg 1000ns.",
        }),
        expect.objectContaining({
          channelId: "D1",
          observedEdgeKinds: ["falling"],
          qualifyingTransitionCount: 1,
          summaryText:
            "1 falling edge observed, insufficient data for rhythm, high widths avg 2000ns, low widths avg 2000ns.",
        }),
      ]);
      expect(result.analysis.capabilityNotes).toEqual([
        {
          code: "focus-channels-applied",
          message: "Analysis is limited to the requested focus channels.",
          details: {
            requestedChannelCount: 2,
            analyzedChannelCount: 2,
          },
        },
        {
          code: "baseline-only-no-protocol-decoding",
          message: "Structured output only covers baseline waveform interpretation.",
        },
      ]);

      expect(resourceManager.getLastInventorySnapshot()).toMatchObject({
        backendReadiness: [
          expect.objectContaining({
            backendKind: "dsview-cli",
            readiness: "ready",
          }),
        ],
        devices: [
          expect.objectContaining({
            deviceId: "logic-1",
            readiness: "ready",
          }),
        ],
      });

      const allocatedState = await getServerState(url);
      expect(allocatedState.devices).toEqual([
        expect.objectContaining({
          deviceId: "logic-1",
          allocationState: "allocated",
          ownerSkillId: "logic-analyzer",
          updatedAt: expect.any(String),
        }),
      ]);
      expect(allocatedState.leases).toEqual([
        expect.objectContaining({
          deviceId: "logic-1",
          ownerSkillId: "logic-analyzer",
        }),
      ]);

      const endResult = await sessionSkill.endSession({
        sessionId: result.session.sessionId,
        deviceId: result.session.deviceId,
        ownerSkillId: result.session.ownerSkillId,
        endedAt: releasedAt,
      });

      expect(endResult).toEqual({
        ok: true,
        device: {
          deviceId: "logic-1",
          label: "USB Logic Analyzer",
          capabilityType: "logic-analyzer",
          connectionState: "connected",
          allocationState: "free",
          ownerSkillId: null,
          lastSeenAt: connectedAt,
          updatedAt: releasedAt,
          readiness: "ready",
          diagnostics: [],
          providerKind: "dslogic",
          backendKind: "dsview-cli",
          dslogic: {
            family: "dslogic",
            model: "dslogic-plus",
            modelDisplayName: "DSLogic Plus",
            variant: "classic",
            usbVendorId: "2a0e",
            usbProductId: "0001",
          },
        },
      });

      const releasedState = await getServerState(url);
      expect(releasedState.devices).toEqual([
        {
          deviceId: "logic-1",
          label: "USB Logic Analyzer",
          capabilityType: "logic-analyzer",
          connectionState: "connected",
          allocationState: "free",
          ownerSkillId: null,
          lastSeenAt: connectedAt,
          updatedAt: expect.any(String),
          readiness: "ready",
          diagnostics: [],
          providerKind: "dslogic",
          backendKind: "dsview-cli",
          dslogic: {
            family: "dslogic",
            model: "dslogic-plus",
            modelDisplayName: "DSLogic Plus",
            variant: "classic",
            usbVendorId: "2a0e",
            usbProductId: "0001",
          },
        },
      ]);
      expect(releasedState.leases).toEqual([]);
    });
  });

  it("rejects backend-missing snapshots over HTTP without mutating allocation or lease state", async () => {
    const backendMissingSnapshot = createBackendMissingSnapshot();

    await withLiveServer(backendMissingSnapshot, async ({ url }) => {
      const resourceManager = new HttpResourceManager(url);
      managersToDispose.add(resourceManager);
      const sessionSkill = createLogicAnalyzerSkill(resourceManager, {
        createSessionId: () => "session-blocked",
      });

      const beforeStartState = await getServerState(url);
      expect(beforeStartState.devices).toEqual([
        expect.objectContaining({
          deviceId: "logic-1",
          allocationState: "free",
          ownerSkillId: null,
        }),
      ]);
      expect(beforeStartState.leases).toEqual([]);

      const result = await sessionSkill.startSession(createSessionRequest(allocatedAt));

      expect(result).toMatchObject({
        ok: false,
        reason: "constraint-rejected",
        report: {
          evaluatedBackendReadiness: "missing",
          backendReadiness: backendMissingSnapshot.backendReadiness,
          snapshotDiagnostics: backendMissingSnapshot.diagnostics,
          device: expect.objectContaining({
            deviceId: "logic-1",
            allocationState: "free",
            ownerSkillId: null,
          }),
        },
      });
      expect(result.ok).toBe(false);
      if (!result.ok && result.reason === "constraint-rejected") {
        expect(result.report.issues).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ code: "backend-not-ready" }),
          ]),
        );
      }
      expect(resourceManager.getLastInventorySnapshot()).toMatchObject({
        backendReadiness: backendMissingSnapshot.backendReadiness,
        diagnostics: backendMissingSnapshot.diagnostics,
        devices: [
          expect.objectContaining({
            deviceId: "logic-1",
            readiness: "ready",
            allocationState: "free",
            ownerSkillId: null,
          }),
        ],
      });

      const afterStartState = await getServerState(url);
      expect(afterStartState.devices).toEqual([
        expect.objectContaining({
          deviceId: "logic-1",
          allocationState: beforeStartState.devices[0]?.allocationState,
          ownerSkillId: beforeStartState.devices[0]?.ownerSkillId,
          readiness: "ready",
        }),
      ]);
      expect(afterStartState.leases).toEqual(beforeStartState.leases);
    });
  });

  it("rejects unsupported-device snapshots over HTTP, then allocates once the snapshot becomes admissible", async () => {
    const readySnapshot = createReadyInventorySnapshot();
    const unsupportedSnapshot = createUnsupportedDeviceSnapshot();

    await withLiveServer(unsupportedSnapshot, async ({ url, provider }) => {
      const resourceManager = new HttpResourceManager(url);
      managersToDispose.add(resourceManager);
      const sessionSkill = createLogicAnalyzerSkill(resourceManager, {
        createSessionId: () => "session-recovered",
      });

      const beforeRejectedStart = await getServerState(url);
      // `/devices` stays compatibility-filtered even when authoritative inventory carries an unsupported row.
      expect(beforeRejectedStart.devices).toEqual([]);
      expect(beforeRejectedStart.leases).toEqual([]);

      const rejectedStart = await sessionSkill.startSession(createSessionRequest(allocatedAt));

      expect(rejectedStart).toMatchObject({
        ok: false,
        reason: "constraint-rejected",
        report: {
          evaluatedDeviceReadiness: "unsupported",
          deviceDiagnostics: unsupportedSnapshot.devices[0]?.diagnostics,
          device: expect.objectContaining({
            deviceId: "logic-1",
            allocationState: "free",
            ownerSkillId: null,
            readiness: "unsupported",
          }),
        },
      });
      expect(rejectedStart.ok).toBe(false);
      if (!rejectedStart.ok && rejectedStart.reason === "constraint-rejected") {
        expect(rejectedStart.report.issues).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ code: "unsupported-device" }),
          ]),
        );
      }
      expect(resourceManager.getLastInventorySnapshot()).toMatchObject({
        devices: [
          expect.objectContaining({
            deviceId: "logic-1",
            readiness: "unsupported",
            allocationState: "free",
            ownerSkillId: null,
          }),
        ],
      });

      const afterRejectedStart = await getServerState(url);
      expect(afterRejectedStart.devices).toEqual([]);
      expect(afterRejectedStart.leases).toEqual(beforeRejectedStart.leases);

      provider.setInventorySnapshot(readySnapshot);
      const acceptedStart = await sessionSkill.startSession(createSessionRequest(reallocatedAt));

      expect(acceptedStart).toMatchObject({
        ok: true,
        session: {
          sessionId: "session-recovered",
          deviceId: "logic-1",
          ownerSkillId: "logic-analyzer",
        },
      });
      expect(acceptedStart.ok).toBe(true);
      if (!acceptedStart.ok) {
        return;
      }

      expect(resourceManager.getLastInventorySnapshot()).toMatchObject({
        backendReadiness: readySnapshot.backendReadiness,
        diagnostics: readySnapshot.diagnostics,
        devices: [
          expect.objectContaining({
            deviceId: "logic-1",
            readiness: "ready",
            allocationState: "free",
            ownerSkillId: null,
          }),
        ],
      });

      const allocatedState = await getServerState(url);
      expect(allocatedState.devices).toEqual([
        expect.objectContaining({
          deviceId: "logic-1",
          allocationState: "allocated",
          ownerSkillId: "logic-analyzer",
          updatedAt: expect.any(String),
        }),
      ]);
      expect(allocatedState.leases).toEqual([
        expect.objectContaining({
          deviceId: "logic-1",
          ownerSkillId: "logic-analyzer",
          leaseId: resourceManager.getLeaseId("logic-1"),
        }),
      ]);
    });
  });

  it("expires an abandoned HTTP client lease and allows a fresh client to reallocate the same device", async () => {
    await withLiveServer(createReadyInventorySnapshot(), async ({ url }) => {
      const firstManager = new HttpResourceManager(url);
      const secondManager = new HttpResourceManager(url);
      managersToDispose.add(firstManager);
      managersToDispose.add(secondManager);

      const firstSessionSkill = createLogicAnalyzerSkill(firstManager, {
        createSessionId: () => "session-abandoned",
      });
      const secondSessionSkill = createLogicAnalyzerSkill(secondManager, {
        createSessionId: () => "session-recovered",
      });

      const beforeAllocationState = await getServerState(url);
      expect(beforeAllocationState.devices).toEqual([
        expect.objectContaining({
          deviceId: "logic-1",
          allocationState: "free",
          ownerSkillId: null,
        }),
      ]);
      expect(beforeAllocationState.leases).toEqual([]);

      const abandonedResult = await firstSessionSkill.startSession(
        createSessionRequest(allocatedAt),
      );
      expect(abandonedResult).toMatchObject({
        ok: true,
        session: {
          sessionId: "session-abandoned",
          deviceId: "logic-1",
          ownerSkillId: "logic-analyzer",
        },
      });
      expect(abandonedResult.ok).toBe(true);
      if (!abandonedResult.ok) {
        return;
      }

      const afterAllocationState = await getServerState(url);
      expect(afterAllocationState.devices).toEqual([
        expect.objectContaining({
          deviceId: "logic-1",
          allocationState: "allocated",
          ownerSkillId: "logic-analyzer",
          updatedAt: expect.any(String),
        }),
      ]);
      expect(afterAllocationState.leases).toEqual([
        expect.objectContaining({
          deviceId: "logic-1",
          ownerSkillId: "logic-analyzer",
          leaseId: firstManager.getLeaseId("logic-1"),
        }),
      ]);

      firstManager.dispose();
      managersToDispose.delete(firstManager);

      await waitFor(async () => {
        const expiredState = await getServerState(url);
        expect(expiredState.devices).toEqual([
          expect.objectContaining({
            deviceId: "logic-1",
            allocationState: "free",
            ownerSkillId: null,
          }),
        ]);
        expect(expiredState.leases).toEqual([]);
      });

      const reallocatedResult = await secondSessionSkill.startSession(
        createSessionRequest(reallocatedAt),
      );
      expect(reallocatedResult).toMatchObject({
        ok: true,
        session: {
          sessionId: "session-recovered",
          deviceId: "logic-1",
          ownerSkillId: "logic-analyzer",
        },
      });
      expect(reallocatedResult.ok).toBe(true);
      if (!reallocatedResult.ok) {
        return;
      }

      const reallocatedState = await getServerState(url);
      expect(reallocatedState.devices).toEqual([
        expect.objectContaining({
          deviceId: "logic-1",
          allocationState: "allocated",
          ownerSkillId: "logic-analyzer",
          updatedAt: expect.any(String),
        }),
      ]);
      expect(reallocatedState.leases).toEqual([
        expect.objectContaining({
          deviceId: "logic-1",
          ownerSkillId: "logic-analyzer",
          leaseId: secondManager.getLeaseId("logic-1"),
        }),
      ]);
    });
  });
});
