import { Hono } from "hono";
import type {
  AllocationRequest,
  DashboardSnapshot,
  DeviceOptionsRequest,
  HeartbeatRequest,
  LiveCaptureArtifact,
  LiveCaptureRequest,
  LiveCaptureResult,
  ReleaseRequest,
  SnapshotResourceManager
} from "@listenai/contracts";
import { createDashboardSnapshot } from "./dashboard-snapshot.js";
import { renderDashboardPage, renderDashboardScript } from "./dashboard-page.js";
import type { LeaseManager } from "./lease-manager.js";

const DASHBOARD_EVENT_RETRY_MS = 1000;
const DASHBOARD_KEEPALIVE_MS = 15000;

const encodeLiveCaptureArtifact = (
  artifact: LiveCaptureArtifact
): Record<string, unknown> => ({
  ...artifact,
  bytes: artifact.bytes ? Array.from(artifact.bytes) : undefined
});

const encodeLiveCaptureResult = (
  result: LiveCaptureResult
): Record<string, unknown> => {
  if (!result.ok) {
    return { ...result };
  }

  return {
    ...result,
    artifact: encodeLiveCaptureArtifact(result.artifact),
    auxiliaryArtifacts: result.auxiliaryArtifacts?.map((artifact) =>
      encodeLiveCaptureArtifact(artifact)
    )
  };
};

function getLeaseExpiryOrThrow(leaseManager: LeaseManager, leaseId: string): string {
  const expiresAt = leaseManager.getLeaseExpiry(leaseId);
  if (!expiresAt) {
    throw new Error(`Lease ${leaseId} missing immediately after mutation`);
  }
  return expiresAt;
}

const isCompatibilityVisibleDevice = (
  device: Awaited<ReturnType<SnapshotResourceManager["getInventorySnapshot"]>>["devices"][number]
): boolean => device.connectionState === "connected" && device.readiness === "ready";

async function getCompatibilityVisibleDevices(
  manager: SnapshotResourceManager,
  refresh = false
) {
  const snapshot = refresh
    ? await manager.refreshInventorySnapshot()
    : await manager.getInventorySnapshot();
  return snapshot.devices.filter(isCompatibilityVisibleDevice);
}

async function getDashboardSnapshot(
  manager: SnapshotResourceManager,
  leaseManager: LeaseManager
): Promise<DashboardSnapshot> {
  const inventory = await manager.getInventorySnapshot();
  return createDashboardSnapshot(inventory, leaseManager);
}

interface DashboardLiveEvent {
  sequence: number;
  reason: string;
  publishedAt: string;
  snapshot: DashboardSnapshot;
}

interface DashboardLiveClient {
  readonly id: number;
  readonly controller: ReadableStreamDefaultController<Uint8Array>;
  keepAlive: ReturnType<typeof setInterval> | null;
  abortListener: (() => void) | null;
  signal: AbortSignal | null;
  closed: boolean;
}

export interface DashboardLiveUpdates {
  createResponse(signal?: AbortSignal): Response;
  publish(reason: string): Promise<void>;
  close(): void;
}

export interface CreateAppOptions {
  dashboardLiveUpdates?: DashboardLiveUpdates;
}

export function createDashboardLiveUpdates(
  manager: SnapshotResourceManager,
  leaseManager: LeaseManager,
  log: (message: string) => void = console.log
): DashboardLiveUpdates {
  const encoder = new TextEncoder();
  const clients = new Set<DashboardLiveClient>();
  let nextClientId = 1;
  let nextSequence = 0;
  let publishQueue = Promise.resolve();

  const cleanupClient = (client: DashboardLiveClient) => {
    if (client.closed) {
      return;
    }

    client.closed = true;

    if (client.keepAlive) {
      clearInterval(client.keepAlive);
      client.keepAlive = null;
    }

    if (client.signal && client.abortListener) {
      client.signal.removeEventListener("abort", client.abortListener);
    }

    client.abortListener = null;
    client.signal = null;
    clients.delete(client);

    try {
      client.controller.close();
    } catch {
      // The client may already be closed by the runtime.
    }
  };

  const sendChunk = (client: DashboardLiveClient, chunk: string): boolean => {
    if (client.closed) {
      return false;
    }

    try {
      client.controller.enqueue(encoder.encode(chunk));
      return true;
    } catch {
      cleanupClient(client);
      return false;
    }
  };

  const formatEvent = (event: string, payload: unknown): string =>
    `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;

  const buildEvent = async (reason: string): Promise<DashboardLiveEvent> => ({
    sequence: ++nextSequence,
    reason,
    publishedAt: new Date().toISOString(),
    snapshot: await getDashboardSnapshot(manager, leaseManager)
  });

  const broadcast = async (reason: string) => {
    const payload = await buildEvent(reason);
    const message = formatEvent("snapshot", payload);
    let delivered = 0;

    for (const client of clients) {
      if (sendChunk(client, message)) {
        delivered += 1;
      }
    }

    if (delivered > 0) {
      log(
        `[dashboard-live] published sequence=${payload.sequence} reason=${reason} listeners=${delivered}`
      );
    }
  };

  return {
    createResponse(signal?: AbortSignal): Response {
      let client: DashboardLiveClient | null = null;

      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          client = {
            id: nextClientId++,
            controller,
            keepAlive: null,
            abortListener: null,
            signal: signal ?? null,
            closed: false
          };

          clients.add(client);
          sendChunk(client, `retry: ${DASHBOARD_EVENT_RETRY_MS}\n\n`);

          client.keepAlive = setInterval(() => {
            if (client) {
              sendChunk(client, `: keepalive ${Date.now()}\n\n`);
            }
          }, DASHBOARD_KEEPALIVE_MS);

          if (signal) {
            client.abortListener = () => {
              if (client) {
                cleanupClient(client);
              }
            };
            signal.addEventListener("abort", client.abortListener, { once: true });
          }

          try {
            const initialEvent = await buildEvent("initial");
            sendChunk(client, formatEvent("snapshot", initialEvent));
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            sendChunk(client, formatEvent("error", { message }));
            log(`[dashboard-live] initial snapshot failed: ${message}`);
          }
        },
        cancel() {
          if (client) {
            cleanupClient(client);
          }
        }
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-store",
          Connection: "keep-alive"
        }
      });
    },
    publish(reason: string): Promise<void> {
      publishQueue = publishQueue
        .catch(() => undefined)
        .then(async () => {
          await broadcast(reason);
        });
      return publishQueue;
    },
    close() {
      for (const client of [...clients]) {
        cleanupClient(client);
      }
    }
  };
}

export function createApp(
  manager: SnapshotResourceManager,
  leaseManager: LeaseManager,
  options: CreateAppOptions = {}
) {
  const app = new Hono();
  const dashboardLiveUpdates =
    options.dashboardLiveUpdates ?? createDashboardLiveUpdates(manager, leaseManager);

  app.get("/", (c) => {
    return c.html(renderDashboardPage());
  });

  app.get("/dashboard.js", (c) => {
    c.header("Content-Type", "application/javascript; charset=utf-8");
    c.header("Cache-Control", "no-store");
    return c.body(renderDashboardScript());
  });

  app.get("/dashboard-events", (c) => {
    return dashboardLiveUpdates.createResponse(c.req.raw.signal);
  });

  app.get("/favicon.ico", (c) => {
    return c.body(null, 204);
  });

  app.get("/health", (c) => {
    return c.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  app.get("/inventory", async (c) => {
    return c.json(await manager.getInventorySnapshot());
  });

  app.post("/inventory/refresh", async (c) => {
    const snapshot = await manager.refreshInventorySnapshot();
    await dashboardLiveUpdates.publish("inventory-refreshed");
    return c.json(snapshot);
  });

  app.get("/dashboard-snapshot", async (c) => {
    return c.json(await getDashboardSnapshot(manager, leaseManager));
  });

  app.get("/devices", async (c) => {
    return c.json(await getCompatibilityVisibleDevices(manager));
  });

  app.post("/refresh", async (c) => {
    const devices = await getCompatibilityVisibleDevices(manager, true);
    await dashboardLiveUpdates.publish("inventory-refreshed");
    return c.json(devices);
  });

  app.post("/allocate", async (c) => {
    const body = await c.req.json<AllocationRequest>();
    const result = await manager.allocateDevice(body);
    if (result.ok) {
      const leaseId = leaseManager.createLease(body.deviceId, body.ownerSkillId);
      const expiresAt = getLeaseExpiryOrThrow(leaseManager, leaseId);
      await dashboardLiveUpdates.publish("device-allocated");
      return c.json({ ...result, leaseId, expiresAt }, 200);
    }
    return c.json(result, 409);
  });

  app.post("/release", async (c) => {
    const body = await c.req.json<ReleaseRequest>();
    const result = await manager.releaseDevice(body);
    if (result.ok) {
      leaseManager.removeLeaseByDevice(body.deviceId);
      await dashboardLiveUpdates.publish("device-released");
    }
    return c.json(result, result.ok ? 200 : 400);
  });

  app.post("/devices/options", async (c) => {
    const body = await c.req.json<DeviceOptionsRequest>();
    const result = await manager.inspectDeviceOptions(body);
    return c.json(result, 200);
  });

  app.post("/capture/live", async (c) => {
    const body = await c.req.json<LiveCaptureRequest>();
    const result = await manager.liveCapture(body);
    return c.json(encodeLiveCaptureResult(result), 200);
  });

  app.post("/heartbeat", async (c) => {
    const body = await c.req.json<HeartbeatRequest>();
    const refreshed = leaseManager.refreshLease(body.leaseId);
    if (refreshed) {
      const expiresAt = getLeaseExpiryOrThrow(leaseManager, body.leaseId);
      await dashboardLiveUpdates.publish("lease-heartbeat");
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
