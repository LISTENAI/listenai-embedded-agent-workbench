import { describe, it, expect } from "vitest";
import { createApp } from "./app.js";
import { createResourceManager } from "../resource-manager.js";
import { FakeDeviceProvider } from "../testing/fake-device-provider.js";
import { LeaseManager } from "./lease-manager.js";

describe("Hono app routes", () => {
  it("GET /health returns 200 with status and timestamp", async () => {
    const provider = new FakeDeviceProvider();
    const manager = createResourceManager(provider);
    const leaseManager = new LeaseManager();
    const app = createApp(manager, leaseManager);

    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("status", "ok");
    expect(body).toHaveProperty("timestamp");
    expect(typeof body.timestamp).toBe("string");
  });

  it("GET /devices returns empty array initially", async () => {
    const provider = new FakeDeviceProvider();
    const manager = createResourceManager(provider);
    const leaseManager = new LeaseManager();
    const app = createApp(manager, leaseManager);

    const res = await app.request("/devices");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([]);
  });

  it("POST /refresh returns device list", async () => {
    const provider = new FakeDeviceProvider([
      {
        deviceId: "dev1",
        label: "Device 1",
        capabilityType: "audio",
        lastSeenAt: "2026-03-26T09:00:00.000Z"
      }
    ]);
    const manager = createResourceManager(provider);
    const leaseManager = new LeaseManager();
    const app = createApp(manager, leaseManager);

    const res = await app.request("/refresh", { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({
      deviceId: "dev1",
      label: "Device 1",
      capabilityType: "audio",
      connectionState: "connected",
      allocationState: "free"
    });
  });

  it("POST /allocate succeeds with 200 and includes leaseId", async () => {
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

    const res = await app.request("/allocate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deviceId: "dev1",
        ownerSkillId: "skill1",
        requestedAt: "2026-03-26T09:01:00.000Z"
      })
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.device.allocationState).toBe("allocated");
    expect(body.device.ownerSkillId).toBe("skill1");
    expect(typeof body.leaseId).toBe("string");
    expect(typeof body.expiresAt).toBe("string");
  });

  it("POST /allocate returns 409 when device already allocated", async () => {
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
    await manager.allocateDevice({
      deviceId: "dev1",
      ownerSkillId: "skill1",
      requestedAt: "2026-03-26T09:01:00.000Z"
    });
    const leaseManager = new LeaseManager();
    const app = createApp(manager, leaseManager);

    const res = await app.request("/allocate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deviceId: "dev1",
        ownerSkillId: "skill2",
        requestedAt: "2026-03-26T09:02:00.000Z"
      })
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.reason).toBe("device-already-allocated");
  });

  it("POST /allocate returns 409 when device not found", async () => {
    const provider = new FakeDeviceProvider();
    const manager = createResourceManager(provider);
    const leaseManager = new LeaseManager();
    const app = createApp(manager, leaseManager);

    const res = await app.request("/allocate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deviceId: "nonexistent",
        ownerSkillId: "skill1",
        requestedAt: "2026-03-26T09:01:00.000Z"
      })
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.reason).toBe("device-not-found");
  });

  it("POST /release succeeds with 200 and removes lease", async () => {
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
    await manager.allocateDevice({
      deviceId: "dev1",
      ownerSkillId: "skill1",
      requestedAt: "2026-03-26T09:01:00.000Z"
    });
    const leaseManager = new LeaseManager();
    leaseManager.createLease("dev1", "skill1");
    const app = createApp(manager, leaseManager);

    const res = await app.request("/release", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deviceId: "dev1",
        ownerSkillId: "skill1",
        releasedAt: "2026-03-26T09:02:00.000Z"
      })
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.device.allocationState).toBe("free");
    expect(body.device.ownerSkillId).toBe(null);

    const leasesRes = await app.request("/leases");
    const leases = await leasesRes.json();
    expect(leases).toEqual([]);
  });

  it("POST /release returns 400 when owner mismatch", async () => {
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
    manager.allocateDevice({
      deviceId: "dev1",
      ownerSkillId: "skill1",
      requestedAt: "2026-03-26T09:01:00.000Z"
    });
    const leaseManager = new LeaseManager();
    const app = createApp(manager, leaseManager);

    const res = await app.request("/release", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deviceId: "dev1",
        ownerSkillId: "skill2",
        releasedAt: "2026-03-26T09:02:00.000Z"
      })
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.reason).toBe("owner-mismatch");
  });

  it("POST /heartbeat with valid leaseId returns 200", async () => {
    const provider = new FakeDeviceProvider();
    const manager = createResourceManager(provider);
    const leaseManager = new LeaseManager();
    const leaseId = leaseManager.createLease("dev1", "skill1");
    const app = createApp(manager, leaseManager);

    const res = await app.request("/heartbeat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leaseId })
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.leaseId).toBe(leaseId);
    expect(typeof body.expiresAt).toBe("string");
  });

  it("POST /heartbeat with unknown leaseId returns 404", async () => {
    const provider = new FakeDeviceProvider();
    const manager = createResourceManager(provider);
    const leaseManager = new LeaseManager();
    const app = createApp(manager, leaseManager);

    const res = await app.request("/heartbeat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leaseId: "unknown-lease-id" })
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.reason).toBe("lease-not-found");
    expect(body.leaseId).toBe("unknown-lease-id");
  });

  it("GET /leases returns active leases", async () => {
    const provider = new FakeDeviceProvider();
    const manager = createResourceManager(provider);
    const leaseManager = new LeaseManager();
    leaseManager.createLease("dev1", "skill1");
    leaseManager.createLease("dev2", "skill2");
    const app = createApp(manager, leaseManager);

    const res = await app.request("/leases");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(2);
    expect(body[0]).toHaveProperty("leaseId");
    expect(body[0]).toHaveProperty("deviceId");
    expect(body[0]).toHaveProperty("ownerSkillId");
  });
});
