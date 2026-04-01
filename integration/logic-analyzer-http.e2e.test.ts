// @ts-ignore - root workspace typecheck can miss vitest helper re-exports for these helpers, but runtime resolves them correctly
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  DeviceRecord,
  InventoryDiagnostic,
  InventorySnapshot,
  LeaseInfo,
} from "@listenai/contracts";
import {
  FakeDeviceProvider,
  LeaseManager,
  createDslogicLiveCaptureRunner,
  createResourceManager,
  createServer,
} from "@listenai/resource-manager";
import { HttpResourceManager } from "@listenai/resource-client";
import {
  createGenericLogicAnalyzerSkill,
  createLogicAnalyzerSkill,
} from "@listenai/skill-logic-analyzer";

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

interface ServerState {
  devices: DeviceRecord[];
  leases: LeaseInfo[];
}

function createDiagnostic(
  overrides: Partial<InventoryDiagnostic> = {},
): InventoryDiagnostic {
  return {
    code: "backend-probe-failed",
    severity: "warning",
    target: "backend",
    message: "Backend probe returned incomplete capability data.",
    backendKind: "libsigrok",
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
    backendKind: "libsigrok",
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
    providerKind: "dslogic",
    backendKind: "libsigrok",
    refreshedAt: connectedAt,
    devices: [createInventoryDevice()],
    backendReadiness: [
      {
        platform: "macos",
        backendKind: "libsigrok",
        readiness: "ready",
        executablePath: "/opt/homebrew/lib/libsigrok.dylib",
        version: "libsigrok 0.6.0",
        checkedAt: connectedAt,
        diagnostics: [],
      },
    ],
    diagnostics: [],
    ...overrides,
  };
}

function createBackendMissingSnapshot(): InventorySnapshot {
  return createReadyInventorySnapshot({
    backendReadiness: [
      {
        platform: "macos",
        backendKind: "libsigrok",
        readiness: "missing",
        executablePath: null,
        version: null,
        checkedAt: connectedAt,
        diagnostics: [
          createDiagnostic({
            code: "backend-missing-runtime",
            severity: "error",
            message: "libsigrok runtime is not available on macos.",
          }),
        ],
      },
    ],
    diagnostics: [
      createDiagnostic({
        code: "backend-missing-runtime",
        severity: "error",
        message: "libsigrok runtime is not available on macos.",
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
    liveCaptureRunner?: ReturnType<typeof createDslogicLiveCaptureRunner>;
  } = {},
): Promise<void> {
  const provider = new FakeDeviceProvider(initialSnapshot);
  const manager = createResourceManager(provider, {
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
  it("normalizes a live capture over HTTP and keeps the accepted lease until endSession", async () => {
    const liveCaptureRunner = createDslogicLiveCaptureRunner(async () => ({
      ok: true,
      executablePath: "/opt/homebrew/lib/libsigrok.dylib",
            artifact: {
        sourceName: "logic-1-live.csv",
        formatHint: "sigrok-csv",
        capturedAt: captureRequestedAt,
        text: fixtureCsvText,
      },
    }));

    await withLiveServer(
      createReadyInventorySnapshot(),
      async ({ url }) => {
        const resourceManager = new HttpResourceManager(url);
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

        const captureResult = await sessionSkill.captureSession({
          session: startResult.session,
          requestedAt: captureRequestedAt,
          timeoutMs: 1500,
        });

        expect(captureResult).toMatchObject({
          ok: true,
          session: {
            sessionId: "session-live",
            deviceId: "logic-1",
            ownerSkillId: "logic-analyzer",
          },
          providerKind: "dslogic",
          backendKind: "libsigrok",
          artifactSummary: {
            sourceName: "logic-1-live.csv",
            formatHint: "sigrok-csv",
            hasText: true,
          },
          capture: {
            ok: true,
            adapterId: "sigrok-csv",
            selectedBy: "format-hint",
            capture: {
              sampleRateHz: 1_000_000,
              totalSamples: 4,
              artifact: {
                sourceName: "logic-1-live.csv",
                hasText: true,
              },
            },
          },
        });

        const allocatedState = await getServerState(url);
        expect(allocatedState.devices).toEqual([
          expect.objectContaining({
            deviceId: "logic-1",
            allocationState: "allocated",
            ownerSkillId: "logic-analyzer",
            updatedAt: allocatedAt,
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
      { liveCaptureRunner },
    );
  });

  it("preserves typed live runtime failures over HTTP and leaves the accepted lease inspectable", async () => {
    const liveCaptureRunner = createDslogicLiveCaptureRunner(async () => ({
      ok: false,
      kind: "timeout",
      phase: "await-runner",
      message: "libsigrok capture timed out.",
      executablePath: "/opt/homebrew/lib/libsigrok.dylib",
            timeoutMs: 1500,
      stderr: {
        text: "Capture did not complete within 1500ms.",
      },
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
              phase: "await-runner",
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
      executablePath: "/opt/homebrew/lib/libsigrok.dylib",
            artifact: {
        sourceName: "logic-1-live.csv",
        formatHint: "sigrok-csv",
        capturedAt: captureRequestedAt,
        text: fixtureCsvText,
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
            adapterId: "sigrok-csv",
            selectedBy: "format-hint",
            capture: {
              adapterId: "sigrok-csv",
              sampleRateHz: 1_000_000,
              samplePeriodNs: 1000,
              totalSamples: 4,
              durationNs: 4000,
              artifact: {
                sourceName: "logic-1-live.csv",
                hasText: true,
              },
            },
          },
          captureSession: {
            ok: true,
            requestedAt: captureRequestedAt,
            artifactSummary: {
              sourceName: "logic-1-live.csv",
              formatHint: "sigrok-csv",
              hasText: true,
            },
          },
          analysis: {
            captureSource: {
              adapterId: "sigrok-csv",
              sourceName: "logic-1-live.csv",
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
              backendKind: "libsigrok",
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
            updatedAt: allocatedAt,
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
            backendKind: "libsigrok",
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
            updatedAt: releasedAt,
            readiness: "ready",
            diagnostics: [],
            providerKind: "dslogic",
            backendKind: "libsigrok",
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
      executablePath: "/opt/homebrew/lib/libsigrok.dylib",
            artifact: {
        sourceName: "logic-1-live.csv",
        formatHint: "sigrok-csv",
        capturedAt: captureRequestedAt,
        text: fixtureCsvText,
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

        vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
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
                backendKind: "libsigrok",
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
                  sourceName: "logic-1-live.csv",
                  formatHint: "sigrok-csv",
                  capturedAt: captureRequestedAt,
                  text: fixtureCsvText,
                },
                artifactSummary: {
                  sourceName: "logic-1-live.csv",
                  formatHint: "sigrok-csv",
                  mediaType: null,
                  capturedAt: captureRequestedAt,
                  byteLength: null,
                  textLength: fixtureCsvText.length,
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
            updatedAt: allocatedAt,
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
      phase: "await-runner",
      message: "libsigrok capture timed out.",
      executablePath: "/opt/homebrew/lib/libsigrok.dylib",
            timeoutMs: 1500,
      stderr: {
        text: "Capture did not complete within 1500ms.",
      },
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
                phase: "await-runner",
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
            backendKind: "libsigrok",
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
          updatedAt: allocatedAt,
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
          backendKind: "libsigrok",
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
          updatedAt: releasedAt,
          readiness: "ready",
          diagnostics: [],
          providerKind: "dslogic",
          backendKind: "libsigrok",
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
      expect(beforeRejectedStart.devices).toEqual([
        expect.objectContaining({
          deviceId: "logic-1",
          allocationState: "free",
          ownerSkillId: null,
        }),
      ]);
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
      expect(afterRejectedStart.devices).toEqual([
        expect.objectContaining({
          deviceId: "logic-1",
          allocationState: beforeRejectedStart.devices[0]?.allocationState,
          ownerSkillId: beforeRejectedStart.devices[0]?.ownerSkillId,
          readiness: "unsupported",
        }),
      ]);
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
          updatedAt: reallocatedAt,
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
          updatedAt: allocatedAt,
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
          updatedAt: reallocatedAt,
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
