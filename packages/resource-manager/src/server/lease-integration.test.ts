// @ts-ignore - root workspace typecheck can miss vitest re-exports for these helpers, but runtime/package-local tests resolve them correctly
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createResourceManager } from "../resource-manager.js";
import { FakeDeviceProvider } from "../testing/fake-device-provider.js";
import { createApp } from "./app.js";
import { LeaseManager } from "./lease-manager.js";
import { createServer } from "./server.js";

async function waitFor(assertion: () => Promise<void>, timeoutMs = 500, intervalMs = 10) {
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

interface ParsedSseEvent {
  event: string;
  data: unknown;
}

function createSseReader(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  return {
    async readEvent(timeoutMs = 1500): Promise<ParsedSseEvent> {
      const deadline = Date.now() + timeoutMs;

      while (true) {
        const separatorIndex = buffer.indexOf("\n\n");
        if (separatorIndex >= 0) {
          const rawEvent = buffer.slice(0, separatorIndex);
          buffer = buffer.slice(separatorIndex + 2);

          if (!rawEvent.trim() || rawEvent.startsWith(":")) {
            continue;
          }

          let event = "message";
          const dataLines: string[] = [];

          for (const line of rawEvent.split("\n")) {
            if (line.startsWith("event:")) {
              event = line.slice("event:".length).trim();
            } else if (line.startsWith("data:")) {
              dataLines.push(line.slice("data:".length).trim());
            }
          }

          if (dataLines.length === 0) {
            continue;
          }

          return {
            event,
            data: JSON.parse(dataLines.join("\n"))
          };
        }

        const remainingMs = Math.max(1, deadline - Date.now());
        const result = await Promise.race([
          reader.read(),
          new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error(`Timed out waiting for SSE event after ${timeoutMs}ms`)), remainingMs);
          })
        ]);

        if (result.done) {
          throw new Error("SSE stream ended before the next event arrived");
        }

        buffer += decoder.decode(result.value, { stream: true });
      }
    },
    async cancel() {
      await reader.cancel();
    }
  };
}

describe("Lease integration tests", () => {
  describe("in-process lease behavior", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("allocate -> timeout scan releases device", async () => {
      const provider = new FakeDeviceProvider([
        {
          deviceId: "dev1",
          label: "Device 1",
          capabilityType: "audio",
          lastSeenAt: "2026-03-26T09:00:00.000Z"
        }
      ]);
      const manager = createResourceManager(provider);
      await manager.refreshInventory();
      const leaseManager = new LeaseManager();
      const app = createApp(manager, leaseManager);

      const allocateRes = await app.request("/allocate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deviceId: "dev1",
          ownerSkillId: "skill1",
          requestedAt: "2026-03-26T09:01:00.000Z"
        })
      });
      const allocateBody = await allocateRes.json();
      expect(allocateBody.ok).toBe(true);
      expect(allocateBody.leaseId).toBeDefined();

      let devicesRes = await app.request("/devices");
      let devices = await devicesRes.json();
      expect(devices[0].allocationState).toBe("allocated");

      vi.advanceTimersByTime(90001);

      const expiredCount = leaseManager.scanExpired(async (lease) => {
        await manager.releaseDevice({
          deviceId: lease.deviceId,
          ownerSkillId: lease.ownerSkillId,
          releasedAt: new Date().toISOString()
        });
      });
      expect(expiredCount).toBe(1);

      devicesRes = await app.request("/devices");
      devices = await devicesRes.json();
      expect(devices[0].allocationState).toBe("free");

      const leasesRes = await app.request("/leases");
      const leases = await leasesRes.json();
      expect(leases).toEqual([]);
    });

    it("heartbeat keeps lease alive past the timeout window", async () => {
      const provider = new FakeDeviceProvider([
        {
          deviceId: "dev1",
          label: "Device 1",
          capabilityType: "audio",
          lastSeenAt: "2026-03-26T09:00:00.000Z"
        }
      ]);
      const manager = createResourceManager(provider);
      await manager.refreshInventory();
      const leaseManager = new LeaseManager();
      const app = createApp(manager, leaseManager);

      const allocateRes = await app.request("/allocate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deviceId: "dev1",
          ownerSkillId: "skill1",
          requestedAt: "2026-03-26T09:01:00.000Z"
        })
      });
      const allocateBody = await allocateRes.json();
      const leaseId = allocateBody.leaseId;

      vi.advanceTimersByTime(60000);

      const heartbeatRes = await app.request("/heartbeat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leaseId })
      });
      expect(heartbeatRes.status).toBe(200);

      vi.advanceTimersByTime(60000);

      const expiredCount = leaseManager.scanExpired(() => {});
      expect(expiredCount).toBe(0);

      const devicesRes = await app.request("/devices");
      const devices = await devicesRes.json();
      expect(devices[0].allocationState).toBe("allocated");
    });

    it("heartbeat with unknown leaseId returns 404", async () => {
      const provider = new FakeDeviceProvider();
      const manager = createResourceManager(provider);
      const leaseManager = new LeaseManager();
      const app = createApp(manager, leaseManager);

      const res = await app.request("/heartbeat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leaseId: "unknown-uuid" })
      });
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.ok).toBe(false);
      expect(body.reason).toBe("lease-not-found");
    });
  });

  it("live server refreshes inventory before serving the first snapshot", async () => {
    vi.useRealTimers();

    const provider = new FakeDeviceProvider([
      {
        deviceId: "dev1",
        label: "Device 1",
        capabilityType: "audio",
        lastSeenAt: "2026-03-26T09:00:00.000Z"
      }
    ]);
    const manager = createResourceManager(provider, {
      now: () => "2026-03-26T09:00:00.000Z"
    });
    const leaseManager = new LeaseManager();
    const { start, stop } = createServer({
      port: 0,
      host: "127.0.0.1",
      manager,
      leaseManager,
      scanIntervalMs: 10
    });

    const { url } = await start();

    try {
      const inventoryRes = await fetch(`${url}/inventory`);
      expect(inventoryRes.status).toBe(200);
      const inventory = await inventoryRes.json();
      expect(inventory).toMatchObject({
        providerKind: "fake",
        backendKind: "fake",
        devices: [
          expect.objectContaining({
            deviceId: "dev1",
            allocationState: "free",
            connectionState: "connected"
          })
        ]
      });
      expect(inventory.refreshedAt).not.toBe("1970-01-01T00:00:00.000Z");
    } finally {
      stop();
    }
  });

  it("live server honors short timing overrides and releases expired leases", async () => {
    vi.useRealTimers();

    const provider = new FakeDeviceProvider([
      {
        deviceId: "dev1",
        label: "Device 1",
        capabilityType: "audio",
        lastSeenAt: "2026-03-26T09:00:00.000Z"
      }
    ]);
    const manager = createResourceManager(provider);
    const leaseManager = new LeaseManager({ timeoutMs: 50 });
    const { start, stop } = createServer({
      port: 0,
      host: "127.0.0.1",
      manager,
      leaseManager,
      scanIntervalMs: 10
    });

    const { url, port } = await start();

    try {
      expect(port).toBeGreaterThan(0);
      expect(url).not.toContain(":0");

      const refreshRes = await fetch(`${url}/refresh`, { method: "POST" });
      expect(refreshRes.status).toBe(200);

      const allocateRes = await fetch(`${url}/allocate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deviceId: "dev1",
          ownerSkillId: "skill-live",
          requestedAt: "2026-03-26T09:01:00.000Z"
        })
      });
      expect(allocateRes.status).toBe(200);
      const allocateBody = await allocateRes.json();
      expect(allocateBody.ok).toBe(true);

      const allocatedDevicesRes = await fetch(`${url}/devices`);
      const allocatedDevices = await allocatedDevicesRes.json();
      expect(allocatedDevices[0].allocationState).toBe("allocated");

      await waitFor(async () => {
        const devicesRes = await fetch(`${url}/devices`);
        const devices = await devicesRes.json();
        const leasesRes = await fetch(`${url}/leases`);
        const leases = await leasesRes.json();

        expect(devices[0].allocationState).toBe("free");
        expect(leases).toEqual([]);
      }, 1000, 20);
    } finally {
      stop();
    }
  });


  it("live server publishes allocate and expiry snapshots over /dashboard-events", async () => {
    vi.useRealTimers();

    const provider = new FakeDeviceProvider([
      {
        deviceId: "dev1",
        label: "Device 1",
        capabilityType: "audio",
        lastSeenAt: "2026-03-26T09:00:00.000Z"
      }
    ]);
    const manager = createResourceManager(provider, {
      now: () => "2026-03-26T09:00:00.000Z"
    });
    await manager.refreshInventorySnapshot();
    const leaseManager = new LeaseManager({ timeoutMs: 50 });
    const { start, stop } = createServer({
      port: 0,
      host: "127.0.0.1",
      manager,
      leaseManager,
      scanIntervalMs: 10
    });

    const { url } = await start();
    const streamRes = await fetch(`${url}/dashboard-events`, {
      headers: { accept: "text/event-stream" }
    });
    expect(streamRes.status).toBe(200);
    expect(streamRes.body).not.toBeNull();
    const events = createSseReader(streamRes.body!);

    try {
      const initialEvent = await events.readEvent();
      expect(initialEvent).toMatchObject({
        event: "snapshot",
        data: expect.objectContaining({
          reason: "initial",
          snapshot: expect.objectContaining({
            devices: [
              expect.objectContaining({
                deviceId: "dev1",
                allocationState: "free"
              })
            ]
          })
        })
      });

      const allocateRes = await fetch(`${url}/allocate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deviceId: "dev1",
          ownerSkillId: "skill-live",
          requestedAt: "2026-03-26T09:01:00.000Z"
        })
      });
      expect(allocateRes.status).toBe(200);

      const allocatedEvent = await events.readEvent();
      expect(allocatedEvent).toMatchObject({
        event: "snapshot",
        data: expect.objectContaining({
          reason: "device-allocated",
          snapshot: expect.objectContaining({
            devices: [
              expect.objectContaining({
                deviceId: "dev1",
                allocationState: "allocated",
                occupancyState: "occupied"
              })
            ]
          })
        })
      });

      const expiredEvent = await events.readEvent(2000);
      expect(expiredEvent).toMatchObject({
        event: "snapshot",
        data: expect.objectContaining({
          reason: "lease-expired",
          snapshot: expect.objectContaining({
            devices: [
              expect.objectContaining({
                deviceId: "dev1",
                allocationState: "free",
                occupancyState: "available"
              })
            ]
          })
        })
      });
    } finally {
      await events.cancel();
      stop();
    }
  });
});
