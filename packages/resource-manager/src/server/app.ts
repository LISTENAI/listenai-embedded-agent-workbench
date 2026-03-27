import { Hono } from "hono";
import type {
  AllocationRequest,
  HeartbeatRequest,
  ReleaseRequest,
  ResourceManager
} from "@listenai/contracts";
import type { LeaseManager } from "./lease-manager.js";

function getLeaseExpiryOrThrow(leaseManager: LeaseManager, leaseId: string): string {
  const expiresAt = leaseManager.getLeaseExpiry(leaseId);
  if (!expiresAt) {
    throw new Error(`Lease ${leaseId} missing immediately after mutation`);
  }
  return expiresAt;
}

export function createApp(manager: ResourceManager, leaseManager: LeaseManager) {
  const app = new Hono();

  app.get("/health", (c) => {
    return c.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  app.get("/devices", async (c) => {
    return c.json(await manager.listDevices());
  });

  app.post("/refresh", async (c) => {
    const devices = await manager.refreshInventory();
    return c.json(devices);
  });

  app.post("/allocate", async (c) => {
    const body = await c.req.json<AllocationRequest>();
    const result = await manager.allocateDevice(body);
    if (result.ok) {
      const leaseId = leaseManager.createLease(body.deviceId, body.ownerSkillId);
      const expiresAt = getLeaseExpiryOrThrow(leaseManager, leaseId);
      return c.json({ ...result, leaseId, expiresAt }, 200);
    }
    return c.json(result, 409);
  });

  app.post("/release", async (c) => {
    const body = await c.req.json<ReleaseRequest>();
    const result = await manager.releaseDevice(body);
    if (result.ok) {
      leaseManager.removeLeaseByDevice(body.deviceId);
    }
    return c.json(result, result.ok ? 200 : 400);
  });

  app.post("/heartbeat", async (c) => {
    const body = await c.req.json<HeartbeatRequest>();
    const refreshed = leaseManager.refreshLease(body.leaseId);
    if (refreshed) {
      const expiresAt = getLeaseExpiryOrThrow(leaseManager, body.leaseId);
      return c.json({ ok: true, leaseId: body.leaseId, expiresAt }, 200);
    }
    return c.json(
      {
        ok: false,
        reason: "lease-not-found",
        leaseId: body.leaseId,
        message: `Lease ${body.leaseId} not found`
      },
      404
    );
  });

  app.get("/leases", (c) => {
    return c.json(leaseManager.getAllLeases());
  });

  return app;
}
