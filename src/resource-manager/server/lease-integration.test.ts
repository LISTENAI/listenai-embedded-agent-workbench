// @ts-expect-error — vitest re-exports vi, beforeEach, afterEach but TypeScript 5.9.3 with verbatimModuleSyntax reports TS2305; works at runtime
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createApp } from "./app.js";
import { LeaseManager } from "./lease-manager.js";
import { createResourceManager } from "../resource-manager.js";
import { FakeDeviceProvider } from "../testing/fake-device-provider.js";

describe("Lease integration tests", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allocate → 90s timeout → scan releases device", async () => {
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

    // Allocate device
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

    // Verify device is allocated
    let devicesRes = await app.request("/devices");
    let devices = await devicesRes.json();
    expect(devices[0].allocationState).toBe("allocated");

    // Advance time past 90s
    vi.advanceTimersByTime(90001);

    // Trigger scan
    const expiredCount = leaseManager.scanExpired(async (lease) => {
      await manager.releaseDevice({
        deviceId: lease.deviceId,
        ownerSkillId: lease.ownerSkillId,
        releasedAt: new Date().toISOString()
      });
    });
    expect(expiredCount).toBe(1);

    // Verify device is now free
    devicesRes = await app.request("/devices");
    devices = await devicesRes.json();
    expect(devices[0].allocationState).toBe("free");

    // Verify lease is gone
    const leasesRes = await app.request("/leases");
    const leases = await leasesRes.json();
    expect(leases).toEqual([]);
  });

  it("heartbeat keeps lease alive past 90s", async () => {
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

    // Allocate device
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

    // Advance 60s
    vi.advanceTimersByTime(60000);

    // Send heartbeat
    const heartbeatRes = await app.request("/heartbeat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leaseId })
    });
    expect(heartbeatRes.status).toBe(200);

    // Advance another 60s (total 120s from allocate, but only 60s from heartbeat)
    vi.advanceTimersByTime(60000);

    // Scan should find no expired leases
    const expiredCount = leaseManager.scanExpired(() => {});
    expect(expiredCount).toBe(0);

    // Device should still be allocated
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
