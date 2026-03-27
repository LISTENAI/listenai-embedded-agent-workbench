// @ts-ignore - root workspace typecheck can miss vitest helper re-exports for these helpers, but runtime resolves them correctly
import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createResourceManager, createServer, FakeDeviceProvider, LeaseManager } from "@listenai/resource-manager";
import type { DeviceRecord, LeaseInfo } from "@listenai/contracts";

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
});
