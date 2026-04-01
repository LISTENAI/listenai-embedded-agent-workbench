// @ts-ignore - root workspace typecheck can miss vitest helper re-exports for these helpers, but runtime resolves them correctly
import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createResourceManager, createServer, FakeDeviceProvider, LeaseManager } from "@listenai/resource-manager";
import { HttpResourceManager } from "@listenai/resource-client";
import type { DeviceRecord, InventorySnapshot, LeaseInfo } from "@listenai/contracts";

interface WorkerResult {
  ok: boolean;
  ownerSkillId: string;
  deviceId: string;
  leaseId?: string;
  reason?: string;
  message?: string;
}

const WORKTREE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const TSX_LOADER_PATH = fileURLToPath(new URL("../node_modules/tsx/dist/loader.mjs", import.meta.url));
const WORKER_PATH = fileURLToPath(new URL("./fixtures/resource-client-worker.ts", import.meta.url));
const DSLOGIC_REFRESHED_AT = "2026-03-30T10:00:00.000Z";

const readyClassicDevice: DeviceRecord = {
  deviceId: "logic-ready",
  label: "DSLogic Plus Ready",
  capabilityType: "logic-analyzer",
  connectionState: "connected",
  allocationState: "free",
  ownerSkillId: null,
  lastSeenAt: DSLOGIC_REFRESHED_AT,
  updatedAt: DSLOGIC_REFRESHED_AT,
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
};

const unsupportedPangoDevice: DeviceRecord = {
  deviceId: "logic-pango",
  label: "DSLogic V421/Pango",
  capabilityType: "logic-analyzer",
  connectionState: "connected",
  allocationState: "free",
  ownerSkillId: null,
  lastSeenAt: DSLOGIC_REFRESHED_AT,
  updatedAt: DSLOGIC_REFRESHED_AT,
  readiness: "unsupported",
  diagnostics: [
    {
      code: "device-unsupported-variant",
      severity: "error",
      target: "device",
      message: "Variant V421/Pango (2a0e:0030) is not supported.",
      deviceId: "logic-pango",
      backendKind: "libsigrok",
    },
  ],
  providerKind: "dslogic",
  backendKind: "libsigrok",
  dslogic: {
    family: "dslogic",
    model: "dslogic-plus",
    modelDisplayName: "DSLogic Plus",
    variant: "v421-pango",
    usbVendorId: "2a0e",
    usbProductId: "0030",
  },
};

const mixedDslogicSnapshot: InventorySnapshot = {
  refreshedAt: DSLOGIC_REFRESHED_AT,
  inventoryScope: {
    providerKinds: ["dslogic"],
    backendKinds: ["libsigrok"],
  },
  devices: [readyClassicDevice, unsupportedPangoDevice],
  backendReadiness: [
    {
      platform: "linux",
      backendKind: "libsigrok",
      readiness: "ready",
      executablePath: "/usr/local/lib/libsigrok.so",
      version: "libsigrok 0.6.0",
      checkedAt: DSLOGIC_REFRESHED_AT,
      diagnostics: [],
    },
  ],
  diagnostics: [unsupportedPangoDevice.diagnostics?.[0]].filter(Boolean),
};

const backendMissingSnapshot: InventorySnapshot = {
  refreshedAt: DSLOGIC_REFRESHED_AT,
  inventoryScope: {
    providerKinds: ["dslogic"],
    backendKinds: ["libsigrok"],
  },
  devices: [],
  backendReadiness: [
    {
      platform: "macos",
      backendKind: "libsigrok",
      readiness: "missing",
      executablePath: null,
      version: null,
      checkedAt: DSLOGIC_REFRESHED_AT,
      diagnostics: [
        {
          code: "backend-missing-runtime",
          severity: "error",
          target: "backend",
          message: "libsigrok runtime is not available on macos.",
          platform: "macos",
          backendKind: "libsigrok",
          backendVersion: null,
        },
      ],
    },
  ],
  diagnostics: [
    {
      code: "backend-missing-runtime",
      severity: "error",
      target: "backend",
      message: "libsigrok runtime is not available on macos.",
      platform: "macos",
      backendKind: "libsigrok",
      backendVersion: null,
    },
  ],
};

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

async function getServerState(url: string): Promise<{ devices: DeviceRecord[]; leases: LeaseInfo[] }> {
  const [devices, leases] = await Promise.all([
    fetchJson<DeviceRecord[]>(`${url}/devices`),
    fetchJson<LeaseInfo[]>(`${url}/leases`),
  ]);

  return { devices, leases };
}

async function runWorker(baseUrl: string, deviceId: string, ownerSkillId: string): Promise<WorkerResult> {
  return await new Promise<WorkerResult>((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", TSX_LOADER_PATH, WORKER_PATH], {
      cwd: WORKTREE_ROOT,
      env: {
        ...process.env,
        BASE_URL: baseUrl,
        DEVICE_ID: deviceId,
        OWNER_SKILL_ID: ownerSkillId,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Worker ${ownerSkillId} exited with code ${code}: ${stderr.trim() || stdout.trim()}`));
        return;
      }

      const lines = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      const payload = lines.at(-1);
      if (!payload) {
        reject(new Error(`Worker ${ownerSkillId} produced no JSON output`));
        return;
      }

      try {
        resolve(JSON.parse(payload) as WorkerResult);
      } catch (error) {
        reject(
          new Error(
            `Worker ${ownerSkillId} returned invalid JSON: ${payload}; ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
      }
    });
  });
}

async function withLiveServer(
  run: (context: { url: string }) => Promise<void>,
  deviceId: string,
): Promise<void> {
  const provider = new FakeDeviceProvider([
    {
      deviceId,
      label: `Device ${deviceId}`,
      capabilityType: "audio",
      lastSeenAt: "2026-03-26T09:00:00.000Z",
    },
  ]);
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

async function withLiveInventoryServer(
  initialSnapshot: InventorySnapshot,
  run: (context: {
    url: string;
    provider: FakeDeviceProvider;
    client: HttpResourceManager;
  }) => Promise<void>,
): Promise<void> {
  const provider = new FakeDeviceProvider(initialSnapshot);
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
  const client = new HttpResourceManager(url);

  try {
    expect(port).toBeGreaterThan(0);
    expect(url).not.toContain(":0");
    await run({ url, provider, client });
  } finally {
    client.dispose();
    server.stop();
  }
}

function snapshotWithObservedManagerTimestamps(
  expected: InventorySnapshot,
  observed: InventorySnapshot,
): InventorySnapshot {
  return {
    ...expected,
    refreshedAt: observed.refreshedAt,
    devices: expected.devices.map((device) => ({
      ...device,
      updatedAt: observed.refreshedAt,
    })),
  };
}

function sortedObservedDevices(
  expected: InventorySnapshot,
  observed: InventorySnapshot,
): DeviceRecord[] {
  return snapshotWithObservedManagerTimestamps(expected, observed).devices
    .slice()
    .sort((left, right) => left.deviceId.localeCompare(right.deviceId));
}

function compatibilityDevicesWithObservedTimestamps(
  expected: InventorySnapshot,
  observedDevices: readonly DeviceRecord[],
): DeviceRecord[] {
  const updatedAtById = new Map(
    observedDevices.map((device) => [device.deviceId, device.updatedAt]),
  );

  return expected.devices
    .map((device) => ({
      ...device,
      updatedAt: updatedAtById.get(device.deviceId) ?? device.updatedAt,
    }))
    .sort((left, right) => left.deviceId.localeCompare(right.deviceId));
}

async function expectInventoryState(
  context: { url: string; client: HttpResourceManager },
  expected: InventorySnapshot,
  phase: string,
): Promise<void> {
  let lastObservedSnapshot: InventorySnapshot | null = null;

  await waitFor(async () => {
    const observed = await fetchJson<InventorySnapshot>(`${context.url}/inventory`);
    lastObservedSnapshot = observed;
    expect(observed).toEqual(snapshotWithObservedManagerTimestamps(expected, observed));
  }, 1500, 25).catch((error) => {
    throw new Error(
      `${phase} did not expose the expected /inventory snapshot. Last observed snapshot: ${JSON.stringify(lastObservedSnapshot)}. ${error instanceof Error ? error.message : String(error)}`,
    );
  });

  const snapshot = await context.client.getInventorySnapshot();
  expect(snapshot).toEqual(snapshotWithObservedManagerTimestamps(expected, snapshot));
  expect(context.client.getLastInventorySnapshot()).toEqual(snapshot);
}

describe("resource-manager root e2e", () => {
  it("allows exactly one winning allocation across independent client processes", async () => {
    await withLiveServer(async ({ url }) => {
      const deviceId = "dev-race";
      const results = await Promise.all([
        runWorker(url, deviceId, "skill-alpha"),
        runWorker(url, deviceId, "skill-beta"),
      ]);

      const successes = results.filter((result) => result.ok);
      const failures = results.filter((result) => !result.ok);

      expect(successes).toHaveLength(1);
      expect(failures).toHaveLength(1);
      expect(failures[0]).toMatchObject({
        ok: false,
        deviceId,
        reason: "device-already-allocated",
      });

      const winner = successes[0];
      const state = await getServerState(url);

      expect(state.devices).toEqual([
        expect.objectContaining({
          deviceId,
          allocationState: "allocated",
          ownerSkillId: winner.ownerSkillId,
        }),
      ]);
      expect(state.leases).toEqual([
        expect.objectContaining({
          deviceId,
          ownerSkillId: winner.ownerSkillId,
          leaseId: winner.leaseId,
        }),
      ]);
    }, "dev-race");
  });

  it("expires an abandoned lease and frees the device for a new client", async () => {
    await withLiveServer(async ({ url }) => {
      const deviceId = "dev-expire";
      const firstOwner = await runWorker(url, deviceId, "skill-expiring");
      expect(firstOwner).toMatchObject({ ok: true, deviceId, ownerSkillId: "skill-expiring" });

      const allocatedState = await getServerState(url);
      expect(allocatedState.devices).toEqual([
        expect.objectContaining({
          deviceId,
          allocationState: "allocated",
          ownerSkillId: "skill-expiring",
        }),
      ]);
      expect(allocatedState.leases).toEqual([
        expect.objectContaining({
          deviceId,
          ownerSkillId: "skill-expiring",
          leaseId: firstOwner.leaseId,
        }),
      ]);

      await waitFor(async () => {
        const expiredState = await getServerState(url);
        expect(expiredState.devices).toEqual([
          expect.objectContaining({
            deviceId,
            allocationState: "free",
            ownerSkillId: null,
          }),
        ]);
        expect(expiredState.leases).toEqual([]);
      });

      const replacementOwner = await runWorker(url, deviceId, "skill-recovered");
      expect(replacementOwner).toMatchObject({ ok: true, deviceId, ownerSkillId: "skill-recovered" });

      const recoveredState = await getServerState(url);
      expect(recoveredState.devices).toEqual([
        expect.objectContaining({
          deviceId,
          allocationState: "allocated",
          ownerSkillId: "skill-recovered",
        }),
      ]);
      expect(recoveredState.leases).toEqual([
        expect.objectContaining({
          deviceId,
          ownerSkillId: "skill-recovered",
          leaseId: replacementOwner.leaseId,
        }),
      ]);
    }, "dev-expire");
  });

  it("surfaces ready and unsupported DSLogic inventory over both HTTP endpoints and the client", async () => {
    await withLiveInventoryServer(mixedDslogicSnapshot, async ({ url, client }) => {
      const refreshSnapshot = await fetchJson<InventorySnapshot>(`${url}/inventory/refresh`, {
        method: "POST",
      });
      expect(refreshSnapshot).toEqual(snapshotWithObservedManagerTimestamps(mixedDslogicSnapshot, refreshSnapshot));

      const refreshDevices = await fetchJson<DeviceRecord[]>(`${url}/refresh`, {
        method: "POST",
      });
      expect(refreshDevices).toEqual(
        compatibilityDevicesWithObservedTimestamps(mixedDslogicSnapshot, refreshDevices),
      );

      await expectInventoryState({ url, client }, mixedDslogicSnapshot, "mixed DSLogic state");
      const refreshedByClient = await client.refreshInventorySnapshot();
      expect(refreshedByClient).toEqual(snapshotWithObservedManagerTimestamps(mixedDslogicSnapshot, refreshedByClient));
      const refreshedDevicesByClient = await client.refreshInventory();
      expect(refreshedDevicesByClient).toEqual(
        compatibilityDevicesWithObservedTimestamps(mixedDslogicSnapshot, refreshedDevicesByClient),
      );
      expect(client.getLastInventorySnapshot()).toEqual(refreshedByClient);
    });
  });

  it("keeps backend-missing snapshots visible when no ready devices exist", async () => {
    await withLiveInventoryServer(backendMissingSnapshot, async ({ url, client }) => {
      const refreshSnapshot = await fetchJson<InventorySnapshot>(`${url}/inventory/refresh`, {
        method: "POST",
      });
      expect(refreshSnapshot).toEqual(snapshotWithObservedManagerTimestamps(backendMissingSnapshot, refreshSnapshot));

      const compatibilityDevices = await fetchJson<DeviceRecord[]>(`${url}/devices`);
      expect(compatibilityDevices).toEqual([]);

      const refreshedCompatibilityDevices = await fetchJson<DeviceRecord[]>(`${url}/refresh`, {
        method: "POST",
      });
      expect(refreshedCompatibilityDevices).toEqual([]);

      await expectInventoryState({ url, client }, backendMissingSnapshot, "backend-missing state");
      const refreshedByClient = await client.refreshInventorySnapshot();
      expect(refreshedByClient).toEqual(snapshotWithObservedManagerTimestamps(backendMissingSnapshot, refreshedByClient));
      await expect(client.refreshInventory()).resolves.toEqual([]);
      expect(client.getLastInventorySnapshot()).toEqual(refreshedByClient);
    });
  });

  it("preserves unsupported and degraded DSLogic states across live refreshes", async () => {
    await withLiveInventoryServer(mixedDslogicSnapshot, async ({ url, provider, client }) => {
      const initialRefresh = await client.refreshInventorySnapshot();
      expect(initialRefresh).toEqual(snapshotWithObservedManagerTimestamps(mixedDslogicSnapshot, initialRefresh));
      expect(client.getLastInventorySnapshot()).toEqual(initialRefresh);

      provider.setInventorySnapshot(backendMissingSnapshot);
      const missingRefresh = await client.refreshInventorySnapshot();
      expect(missingRefresh).toEqual(snapshotWithObservedManagerTimestamps(backendMissingSnapshot, missingRefresh));
      expect(client.getLastInventorySnapshot()).toEqual(missingRefresh);
      await expectInventoryState({ url, client }, backendMissingSnapshot, "refreshed backend-missing state");

      provider.setInventorySnapshot(mixedDslogicSnapshot);
      const rawRefreshedSnapshot = await fetchJson<InventorySnapshot>(`${url}/inventory/refresh`, {
        method: "POST",
      });
      expect(rawRefreshedSnapshot).toEqual(snapshotWithObservedManagerTimestamps(mixedDslogicSnapshot, rawRefreshedSnapshot));

      const rawRefreshedDevices = await fetchJson<DeviceRecord[]>(`${url}/refresh`, {
        method: "POST",
      });
      expect(rawRefreshedDevices).toEqual(
        compatibilityDevicesWithObservedTimestamps(mixedDslogicSnapshot, rawRefreshedDevices),
      );

      await expectInventoryState({ url, client }, mixedDslogicSnapshot, "refreshed mixed DSLogic state");
      expect(client.getLastInventorySnapshot()).toEqual(
        snapshotWithObservedManagerTimestamps(mixedDslogicSnapshot, client.getLastInventorySnapshot()!),
      );
    });
  });
});
