// @ts-ignore - root workspace typecheck can miss vitest helper re-exports for these helpers, but runtime resolves them correctly
import { afterEach, describe, expect, it } from "vitest";
import type { DeviceRecord, LeaseInfo } from "@listenai/contracts";
import {
  FakeDeviceProvider,
  LeaseManager,
  createResourceManager,
  createServer,
} from "@listenai/resource-manager";
import {
  HttpResourceManager,
  createGenericLogicAnalyzerSkill,
  createLogicAnalyzerSkill,
} from "../src/index.js";

const connectedAt = "2026-03-26T00:00:00.000Z";
const allocatedAt = "2026-03-26T00:01:00.000Z";
const releasedAt = "2026-03-26T00:02:00.000Z";
const reallocatedAt = "2026-03-26T00:03:00.000Z";

const fixtureCsvText = [
  "Time [us],D0,D1",
  "0,0,1",
  "1,1,1",
  "2,1,0",
  "3,0,0",
].join("\n");

const baseDevice = {
  deviceId: "logic-1",
  label: "USB Logic Analyzer",
  capabilityType: "logic-analyzer",
  lastSeenAt: connectedAt,
} as const;

interface ServerState {
  devices: DeviceRecord[];
  leases: LeaseInfo[];
}

async function waitFor(assertion: () => Promise<void>, timeoutMs = 1500, intervalMs = 20) {
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

function createRequest(requestedAt: string) {
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

function createSessionRequest(requestedAt: string) {
  return createRequest(requestedAt).session;
}

async function withLiveServer(
  run: (context: { url: string }) => Promise<void>,
): Promise<void> {
  const provider = new FakeDeviceProvider([baseDevice]);
  const manager = createResourceManager(provider);
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
    await run({ url });
  } finally {
    server.stop();
  }
}

const managersToDispose = new Set<HttpResourceManager>();

afterEach(() => {
  for (const manager of managersToDispose) {
    manager.dispose();
  }
  managersToDispose.clear();
});

describe("logic-analyzer live HTTP workflow", () => {
  it("preserves the packaged result shape and frees the device after explicit endSession", async () => {
    await withLiveServer(async ({ url }) => {
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

      const result = await genericSkill.run(createRequest(allocatedAt));

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
        },
      ]);
      expect(releasedState.leases).toEqual([]);
    });
  });

  it("expires an abandoned HTTP client lease and allows a fresh client to reallocate the same device", async () => {
    await withLiveServer(async ({ url }) => {
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

      const abandonedResult = await firstSessionSkill.startSession(createSessionRequest(allocatedAt));
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

      const reallocatedResult = await secondSessionSkill.startSession(createSessionRequest(reallocatedAt));
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
