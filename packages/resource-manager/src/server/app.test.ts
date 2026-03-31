import type { InventorySnapshot } from "@listenai/contracts";
import { describe, expect, it, vi } from "vitest";
import { createResourceManager } from "../resource-manager.js";
import { FakeDeviceProvider } from "../testing/fake-device-provider.js";
import { createApp } from "./app.js";
import { LeaseManager } from "./lease-manager.js";

const refreshedAt = "2026-03-26T09:00:00.000Z";

const dslogicSnapshot: InventorySnapshot = {
  refreshedAt,
  inventoryScope: {
    providerKinds: ["dslogic"],
    backendKinds: ["dsview"]
  },
  devices: [
    {
      deviceId: "logic-ready",
      label: "DSLogic Plus Ready",
      capabilityType: "logic-analyzer",
      connectionState: "connected",
      allocationState: "free",
      ownerSkillId: null,
      lastSeenAt: refreshedAt,
      updatedAt: refreshedAt,
      readiness: "ready",
      diagnostics: [],
      providerKind: "dslogic",
      backendKind: "dsview",
      dslogic: {
        family: "dslogic",
        model: "dslogic-plus",
        modelDisplayName: "DSLogic Plus",
        variant: "classic",
        usbVendorId: "2a0e",
        usbProductId: "0001"
      }
    },
    {
      deviceId: "logic-unsupported",
      label: "DSLogic V421/Pango",
      capabilityType: "logic-analyzer",
      connectionState: "connected",
      allocationState: "free",
      ownerSkillId: null,
      lastSeenAt: refreshedAt,
      updatedAt: refreshedAt,
      readiness: "unsupported",
      diagnostics: [
        {
          code: "device-unsupported-variant",
          severity: "error",
          target: "device",
          message: "Variant V421/Pango is not supported.",
          deviceId: "logic-unsupported",
          backendKind: "dsview"
        }
      ],
      providerKind: "dslogic",
      backendKind: "dsview",
      dslogic: {
        family: "dslogic",
        model: "dslogic-plus",
        modelDisplayName: "DSLogic Plus",
        variant: "v421-pango",
        usbVendorId: "2a0e",
        usbProductId: "0030"
      }
    }
  ],
  backendReadiness: [
    {
      platform: "macos",
      backendKind: "dsview",
      readiness: "missing",
      executablePath: null,
      version: null,
      checkedAt: refreshedAt,
      diagnostics: [
        {
          code: "backend-missing-executable",
          severity: "error",
          target: "backend",
          message: "DSView was not found on PATH.",
          platform: "macos",
          backendKind: "dsview"
        }
      ]
    }
  ],
  diagnostics: [
    {
      code: "backend-missing-executable",
      severity: "error",
      target: "backend",
      message: "DSView was not found on PATH.",
      platform: "macos",
      backendKind: "dsview"
    }
  ]
};

const mixedProviderInventory: InventorySnapshot = {
  refreshedAt,
  inventoryScope: {
    providerKinds: ["dslogic", "fake"],
    backendKinds: ["dsview", "fake"]
  },
  devices: [
    {
      deviceId: "logic-collision",
      label: "DSLogic Collision",
      capabilityType: "logic-analyzer",
      connectionState: "connected",
      allocationState: "free",
      ownerSkillId: null,
      lastSeenAt: refreshedAt,
      updatedAt: refreshedAt,
      readiness: "ready",
      diagnostics: [
        {
          code: "backend-probe-timeout",
          severity: "warning",
          target: "device",
          message: "DSLogic capture path is slow.",
          deviceId: "logic-collision",
          backendKind: "dsview"
        }
      ],
      providerKind: "dslogic",
      backendKind: "dsview",
      canonicalIdentity: {
        providerKind: "dslogic",
        providerDeviceId: "collision-001",
        canonicalKey: "dslogic:collision-001"
      },
      dslogic: null
    },
    {
      deviceId: "logic-collision",
      label: "Fake Collision",
      capabilityType: "logic-analyzer",
      connectionState: "connected",
      allocationState: "free",
      ownerSkillId: null,
      lastSeenAt: refreshedAt,
      updatedAt: refreshedAt,
      readiness: "degraded",
      diagnostics: [
        {
          code: "backend-probe-timeout",
          severity: "warning",
          target: "device",
          message: "Fake provider reported a slower probe.",
          deviceId: "logic-collision",
          backendKind: "fake"
        }
      ],
      providerKind: "fake",
      backendKind: "fake",
      canonicalIdentity: {
        providerKind: "fake",
        providerDeviceId: "collision-001",
        canonicalKey: "fake:collision-001"
      },
      dslogic: null
    }
  ],
  backendReadiness: [
    {
      platform: "macos",
      backendKind: "dsview",
      readiness: "degraded",
      executablePath: "/Applications/DSView.app",
      version: "2.0.0",
      checkedAt: refreshedAt,
      diagnostics: [
        {
          code: "backend-probe-timeout",
          severity: "warning",
          target: "backend",
          message: "DSView readiness probe exceeded the soft timeout.",
          platform: "macos",
          backendKind: "dsview"
        }
      ]
    },
    {
      platform: "macos",
      backendKind: "fake",
      readiness: "ready",
      executablePath: null,
      version: null,
      checkedAt: refreshedAt,
      diagnostics: []
    }
  ],
  diagnostics: [
    {
      code: "backend-probe-timeout",
      severity: "warning",
      target: "backend",
      message: "DSView readiness probe exceeded the soft timeout.",
      platform: "macos",
      backendKind: "dsview"
    }
  ]
};

const dashboardSnapshotInventory: InventorySnapshot = {
  refreshedAt,
  inventoryScope: {
    providerKinds: ["dslogic"],
    backendKinds: ["dsview"]
  },
  devices: [
    {
      deviceId: "logic-free",
      label: "Free ready device",
      capabilityType: "logic-analyzer",
      connectionState: "connected",
      allocationState: "free",
      ownerSkillId: null,
      lastSeenAt: refreshedAt,
      updatedAt: refreshedAt,
      readiness: "ready",
      diagnostics: [],
      providerKind: "dslogic",
      backendKind: "dsview",
      dslogic: null
    },
    {
      deviceId: "logic-ready",
      label: "Allocated ready device",
      capabilityType: "logic-analyzer",
      connectionState: "connected",
      allocationState: "free",
      ownerSkillId: null,
      lastSeenAt: refreshedAt,
      updatedAt: refreshedAt,
      readiness: "ready",
      diagnostics: [],
      providerKind: "dslogic",
      backendKind: "dsview",
      dslogic: null
    },
    {
      deviceId: "logic-degraded",
      label: "Degraded device",
      capabilityType: "logic-analyzer",
      connectionState: "connected",
      allocationState: "free",
      ownerSkillId: null,
      lastSeenAt: refreshedAt,
      updatedAt: refreshedAt,
      readiness: "degraded",
      diagnostics: [
        {
          code: "backend-probe-timeout",
          severity: "warning",
          target: "device",
          message: "Capture path is slower than expected.",
          deviceId: "logic-degraded",
          backendKind: "dsview"
        }
      ],
      providerKind: "dslogic",
      backendKind: "dsview",
      dslogic: null
    },
    {
      deviceId: "logic-unsupported",
      label: "Unsupported device",
      capabilityType: "logic-analyzer",
      connectionState: "connected",
      allocationState: "free",
      ownerSkillId: null,
      lastSeenAt: refreshedAt,
      updatedAt: refreshedAt,
      readiness: "unsupported",
      diagnostics: [
        {
          code: "device-unsupported-variant",
          severity: "error",
          target: "device",
          message: "Unsupported hardware variant.",
          deviceId: "logic-unsupported",
          backendKind: "dsview"
        }
      ],
      providerKind: "dslogic",
      backendKind: "dsview",
      dslogic: null
    }
  ],
  backendReadiness: [
    {
      platform: "macos",
      backendKind: "dsview",
      readiness: "missing",
      executablePath: null,
      version: null,
      checkedAt: refreshedAt,
      diagnostics: [
        {
          code: "backend-missing-executable",
          severity: "error",
          target: "backend",
          message: "DSView was not found on PATH.",
          platform: "macos",
          backendKind: "dsview"
        }
      ]
    }
  ],
  diagnostics: [
    {
      code: "backend-missing-executable",
      severity: "error",
      target: "backend",
      message: "DSView was not found on PATH.",
      platform: "macos",
      backendKind: "dsview"
    }
  ]
};

interface ParsedSseEvent {
  event: string;
  data: unknown;
}

function createSseReader(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  return {
    async readEvent(timeoutMs = 1000): Promise<ParsedSseEvent> {
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

describe("Hono app routes", () => {
  it("GET / serves the system-first browser dashboard entrypoint", async () => {
    const provider = new FakeDeviceProvider();
    const manager = createResourceManager(provider);
    const leaseManager = new LeaseManager();
    const app = createApp(manager, leaseManager);

    const res = await app.request("/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const body = await res.text();
    expect(body).toContain("<title>ListenAI Resource Manager</title>");
    expect(body).toContain("System dashboard");
    expect(body).toContain("System overview");
    expect(body).toContain("Current system posture");
    expect(body).toContain("Device occupancy");
    expect(body).toContain("Owner identity, readiness, and lease timing from the live snapshot.");
    expect(body).toContain('id="device-summary"');
    expect(body).toContain('id="device-cards"');
    expect(body).toContain('src="/dashboard.js"');
    expect(body).toContain("/dashboard-snapshot");
  });

  it("GET /dashboard.js serves the client script for overview-led system metrics", async () => {
    const provider = new FakeDeviceProvider();
    const manager = createResourceManager(provider);
    const leaseManager = new LeaseManager();
    const app = createApp(manager, leaseManager);

    const res = await app.request("/dashboard.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/javascript");
    const body = await res.text();
    expect(body).toContain('fetch(\'/dashboard-snapshot\'');
    expect(body).toContain('document.querySelector("#overview")');
    expect(body).toContain('document.querySelector("#device-cards")');
    expect(body).toContain("Supported devices");
    expect(body).toContain("Unavailable / abnormal");
    expect(body).toContain("Backend readiness");
    expect(body).toContain("No per-device diagnostics reported.");
    expect(body).toContain("Owner identity");
    expect(body).toContain("Lease timing");
    expect(body).toContain("A fake provider/backend is serving this snapshot");
    expect(body).toContain("Backend readiness has not reported any probe results yet.");
  });

  it("GET /favicon.ico returns 204 so the dashboard loads without failed requests", async () => {
    const provider = new FakeDeviceProvider();
    const manager = createResourceManager(provider);
    const leaseManager = new LeaseManager();
    const app = createApp(manager, leaseManager);

    const res = await app.request("/favicon.ico");
    expect(res.status).toBe(204);
  });

  it("GET /dashboard-events streams the initial authoritative snapshot", async () => {
    const provider = new FakeDeviceProvider(dashboardSnapshotInventory);
    const manager = createResourceManager(provider, { now: () => refreshedAt });
    await manager.refreshInventorySnapshot();
    const leaseManager = new LeaseManager();
    const app = createApp(manager, leaseManager);

    const res = await app.request("/dashboard-events");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.body).not.toBeNull();

    const events = createSseReader(res.body!);

    try {
      const initialEvent = await events.readEvent();
      expect(initialEvent).toMatchObject({
        event: "snapshot",
        data: expect.objectContaining({
          reason: "initial",
          sequence: 1,
          snapshot: expect.objectContaining({
            generatedAt: refreshedAt,
            overview: expect.objectContaining({
              totalDevices: 4,
              availableDevices: 4,
              activeLeases: 0
            })
          })
        })
      });
    } finally {
      await events.cancel();
    }
  });

  it("GET /dashboard-events publishes new snapshots after allocate and release mutations", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse(refreshedAt));

    const provider = new FakeDeviceProvider([
      {
        deviceId: "dev1",
        label: "Device 1",
        capabilityType: "audio",
        lastSeenAt: refreshedAt
      }
    ]);
    const manager = createResourceManager(provider, { now: () => refreshedAt });
    await manager.refreshInventorySnapshot();
    const leaseManager = new LeaseManager({ timeoutMs: 30000, now: () => Date.parse(refreshedAt) });
    const app = createApp(manager, leaseManager);

    const res = await app.request("/dashboard-events");
    expect(res.body).not.toBeNull();
    const events = createSseReader(res.body!);

    try {
      await events.readEvent();

      const allocateRes = await app.request("/allocate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deviceId: "dev1",
          ownerSkillId: "skill-live",
          requestedAt: refreshedAt
        })
      });
      expect(allocateRes.status).toBe(200);

      const allocatedEvent = await events.readEvent();
      expect(allocatedEvent).toMatchObject({
        event: "snapshot",
        data: expect.objectContaining({
          reason: "device-allocated",
          sequence: 2,
          snapshot: expect.objectContaining({
            devices: [
              expect.objectContaining({
                deviceId: "dev1",
                allocationState: "allocated",
                occupancyState: "occupied",
                owner: {
                  skillId: "skill-live",
                  source: "lease"
                },
                lease: expect.objectContaining({
                  state: "active"
                })
              })
            ]
          })
        })
      });

      const releaseRes = await app.request("/release", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deviceId: "dev1",
          ownerSkillId: "skill-live",
          releasedAt: "2026-03-26T09:01:30.000Z"
        })
      });
      expect(releaseRes.status).toBe(200);

      const releasedEvent = await events.readEvent();
      expect(releasedEvent).toMatchObject({
        event: "snapshot",
        data: expect.objectContaining({
          reason: "device-released",
          sequence: 3,
          snapshot: expect.objectContaining({
            devices: [
              expect.objectContaining({
                deviceId: "dev1",
                allocationState: "free",
                occupancyState: "available",
                owner: null,
                lease: expect.objectContaining({
                  state: "none"
                })
              })
            ]
          })
        })
      });
    } finally {
      await events.cancel();
      vi.useRealTimers();
    }
  });

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

  it("GET /inventory returns backend readiness and device diagnostics intact", async () => {
    const provider = new FakeDeviceProvider(dslogicSnapshot);
    const manager = createResourceManager(provider, { now: () => refreshedAt });
    await manager.refreshInventorySnapshot();
    const leaseManager = new LeaseManager();
    const app = createApp(manager, leaseManager);

    const res = await app.request("/inventory");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(dslogicSnapshot);
  });

  it("POST /inventory/refresh returns the full snapshot without collapsing metadata", async () => {
    const provider = new FakeDeviceProvider(dslogicSnapshot);
    const manager = createResourceManager(provider, { now: () => refreshedAt });
    const leaseManager = new LeaseManager();
    const app = createApp(manager, leaseManager);

    const res = await app.request("/inventory/refresh", { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(dslogicSnapshot);
  });

  it("POST /refresh keeps compatibility fields on device rows derived from the snapshot", async () => {
    const provider = new FakeDeviceProvider(dslogicSnapshot);
    const manager = createResourceManager(provider, { now: () => refreshedAt });
    const leaseManager = new LeaseManager();
    const app = createApp(manager, leaseManager);

    const res = await app.request("/refresh", { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(dslogicSnapshot.devices);
  });


  it("GET /inventory and /dashboard-snapshot preserve mixed-provider identity and backend diagnostics", async () => {
    const provider = new FakeDeviceProvider(mixedProviderInventory);
    const manager = createResourceManager(provider, { now: () => refreshedAt });
    await manager.refreshInventorySnapshot();
    const leaseManager = new LeaseManager();
    const app = createApp(manager, leaseManager);

    const inventoryRes = await app.request("/inventory");
    expect(inventoryRes.status).toBe(200);
    const inventoryBody = await inventoryRes.json();
    expect(inventoryBody).toEqual(mixedProviderInventory);

    const dashboardRes = await app.request("/dashboard-snapshot");
    expect(dashboardRes.status).toBe(200);
    const dashboardBody = await dashboardRes.json();

    expect(dashboardBody.inventoryScope).toEqual(mixedProviderInventory.inventoryScope);
    expect(dashboardBody.devices).toHaveLength(2);
    expect(
      dashboardBody.devices.map((device: { canonicalIdentity: { canonicalKey: string } }) =>
        device.canonicalIdentity.canonicalKey
      )
    ).toEqual(["dslogic:collision-001", "fake:collision-001"]);
    expect(
      dashboardBody.devices.map((device: { backendKind: string; diagnostics: Array<{ backendKind?: string }> }) => ({
        backendKind: device.backendKind,
        diagnosticBackendKinds: device.diagnostics.map((diagnostic) => diagnostic.backendKind ?? null)
      }))
    ).toEqual([
      {
        backendKind: "dsview",
        diagnosticBackendKinds: ["dsview"]
      },
      {
        backendKind: "fake",
        diagnosticBackendKinds: ["fake"]
      }
    ]);
    expect(dashboardBody.backendReadiness).toEqual(mixedProviderInventory.backendReadiness);
    expect(dashboardBody.diagnostics).toEqual(mixedProviderInventory.diagnostics);
    expect(dashboardBody.overview).toEqual(
      expect.objectContaining({
        totalDevices: 2,
        readyDevices: 1,
        degradedDevices: 1,
        backendReady: 1,
        backendDegraded: 1,
        backendMissing: 0,
        backendUnsupported: 0
      })
    );
  });

  it("GET /dashboard-snapshot proves free, allocated, degraded, unsupported, and backend-missing truth", async () => {
    const now = Date.parse("2026-03-26T09:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    try {
      const provider = new FakeDeviceProvider(dashboardSnapshotInventory);
      const manager = createResourceManager(provider, {
        now: () => new Date(now).toISOString()
      });
      await manager.refreshInventorySnapshot();

      const leaseManager = new LeaseManager({
        timeoutMs: 30000,
        now: () => now
      });

      await manager.allocateDevice({
        deviceId: "logic-ready",
        ownerSkillId: "skill-alpha",
        requestedAt: new Date(now).toISOString()
      });
      const readyLeaseId = leaseManager.createLease("logic-ready", "skill-alpha");

      await manager.allocateDevice({
        deviceId: "logic-degraded",
        ownerSkillId: "skill-device-only",
        requestedAt: new Date(now).toISOString()
      });

      const app = createApp(manager, leaseManager);
      const res = await app.request("/dashboard-snapshot");

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.generatedAt).toBe(refreshedAt);
      expect(body.overview).toEqual({
        totalDevices: 4,
        connectedDevices: 4,
        disconnectedDevices: 0,
        availableDevices: 2,
        occupiedDevices: 2,
        readyDevices: 2,
        degradedDevices: 1,
        unsupportedDevices: 1,
        activeLeases: 1,
        overdueLeases: 0,
        missingLeases: 1,
        orphanedLeases: 0,
        expiringSoon: 1,
        backendReady: 0,
        backendDegraded: 0,
        backendMissing: 1,
        backendUnsupported: 0
      });
      expect(body.devices).toEqual([
        expect.objectContaining({
          deviceId: "logic-degraded",
          readinessBadge: "degraded",
          occupancyState: "lease-missing",
          owner: {
            skillId: "skill-device-only",
            source: "device"
          },
          lease: expect.objectContaining({
            state: "missing",
            leaseId: null,
            remainingMs: null,
            timeoutMs: null
          })
        }),
        expect.objectContaining({
          deviceId: "logic-free",
          readinessBadge: "ready",
          occupancyState: "available",
          owner: null,
          lease: expect.objectContaining({
            state: "none",
            leaseId: null,
            expiresAt: null,
            remainingMs: null,
            timeoutMs: null
          })
        }),
        expect.objectContaining({
          deviceId: "logic-ready",
          readinessBadge: "ready",
          occupancyState: "occupied",
          owner: {
            skillId: "skill-alpha",
            source: "lease"
          },
          lease: expect.objectContaining({
            state: "active",
            leaseId: readyLeaseId,
            expiresAt: "2026-03-26T09:00:30.000Z",
            remainingMs: 30000,
            timeoutMs: 30000
          })
        }),
        expect.objectContaining({
          deviceId: "logic-unsupported",
          readinessBadge: "unsupported",
          occupancyState: "available",
          owner: null,
          lease: expect.objectContaining({
            state: "none",
            leaseId: null,
            remainingMs: null
          })
        })
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("GET /dashboard-snapshot preserves disconnected and overdue lease state from authoritative data", async () => {
    let now = Date.parse("2026-03-26T09:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    try {
      const provider = new FakeDeviceProvider(dashboardSnapshotInventory);
      const manager = createResourceManager(provider, {
        now: () => new Date(now).toISOString()
      });
      await manager.refreshInventorySnapshot();

      const leaseManager = new LeaseManager({
        timeoutMs: 30000,
        now: () => now
      });

      await manager.allocateDevice({
        deviceId: "logic-ready",
        ownerSkillId: "skill-disconnected",
        requestedAt: new Date(now).toISOString()
      });
      leaseManager.createLease("logic-ready", "skill-disconnected");

      provider.setInventorySnapshot({
        ...dashboardSnapshotInventory,
        devices: dashboardSnapshotInventory.devices.filter(
          (device) => device.deviceId !== "logic-ready"
        )
      });

      now += 45000;
      vi.setSystemTime(now);
      await manager.refreshInventorySnapshot();

      const app = createApp(manager, leaseManager);
      const res = await app.request("/dashboard-snapshot");

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.overview).toEqual({
        totalDevices: 4,
        connectedDevices: 3,
        disconnectedDevices: 1,
        availableDevices: 3,
        occupiedDevices: 1,
        readyDevices: 1,
        degradedDevices: 1,
        unsupportedDevices: 1,
        activeLeases: 1,
        overdueLeases: 1,
        missingLeases: 0,
        orphanedLeases: 0,
        expiringSoon: 0,
        backendReady: 0,
        backendDegraded: 0,
        backendMissing: 1,
        backendUnsupported: 0
      });
      expect(body.devices).toEqual([
        expect.objectContaining({
          deviceId: "logic-degraded",
          readinessBadge: "degraded",
          occupancyState: "available",
          owner: null,
          lease: expect.objectContaining({
            state: "none",
            leaseId: null
          })
        }),
        expect.objectContaining({
          deviceId: "logic-free",
          readinessBadge: "ready",
          occupancyState: "available",
          owner: null,
          lease: expect.objectContaining({
            state: "none",
            leaseId: null
          })
        }),
        expect.objectContaining({
          deviceId: "logic-ready",
          connectionState: "disconnected",
          readinessBadge: "disconnected",
          occupancyState: "lease-overdue",
          owner: {
            skillId: "skill-disconnected",
            source: "lease"
          },
          lease: expect.objectContaining({
            state: "overdue",
            leaseId: expect.any(String),
            expiresAt: "2026-03-26T09:00:30.000Z",
            remainingMs: -15000,
            timeoutMs: 30000
          })
        }),
        expect.objectContaining({
          deviceId: "logic-unsupported",
          readinessBadge: "unsupported",
          occupancyState: "available",
          owner: null,
          lease: expect.objectContaining({
            state: "none",
            leaseId: null
          })
        })
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("GET /devices returns device rows from backend-only snapshots without fabricating entries", async () => {
    const provider = new FakeDeviceProvider({
      refreshedAt,
      inventoryScope: {
        providerKinds: ["dslogic"],
        backendKinds: ["dsview"]
      },
      devices: [],
      backendReadiness: dslogicSnapshot.backendReadiness,
      diagnostics: dslogicSnapshot.diagnostics
    });
    const manager = createResourceManager(provider, { now: () => refreshedAt });
    await manager.refreshInventorySnapshot();
    const leaseManager = new LeaseManager();
    const app = createApp(manager, leaseManager);

    const res = await app.request("/devices");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([]);
  });

  it("POST /allocate succeeds with 200 and includes leaseId", async () => {
    const provider = new FakeDeviceProvider([
      {
        deviceId: "dev1",
        label: "Device 1",
        capabilityType: "audio",
        lastSeenAt: refreshedAt
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

  it("POST /allocate reports expiry from the configured lease timeout", async () => {
    const baseTime = Date.parse("2026-03-26T09:01:00.000Z");
    const provider = new FakeDeviceProvider([
      {
        deviceId: "dev1",
        label: "Device 1",
        capabilityType: "audio",
        lastSeenAt: refreshedAt
      }
    ]);
    const manager = createResourceManager(provider);
    await manager.refreshInventory();
    const leaseManager = new LeaseManager({
      timeoutMs: 5000,
      now: () => baseTime
    });
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
    expect(body.expiresAt).toBe("2026-03-26T09:01:05.000Z");
  });

  it("POST /allocate returns 409 when device already allocated", async () => {
    const provider = new FakeDeviceProvider([
      {
        deviceId: "dev1",
        label: "Device 1",
        capabilityType: "audio",
        lastSeenAt: refreshedAt
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
        lastSeenAt: refreshedAt
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
        lastSeenAt: refreshedAt
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

  it("POST /heartbeat reports expiry from the refreshed lease timestamp", async () => {
    let now = Date.parse("2026-03-26T09:01:00.000Z");
    const provider = new FakeDeviceProvider();
    const manager = createResourceManager(provider);
    const leaseManager = new LeaseManager({
      timeoutMs: 5000,
      now: () => now
    });
    const leaseId = leaseManager.createLease("dev1", "skill1");
    const app = createApp(manager, leaseManager);

    now += 2000;

    const res = await app.request("/heartbeat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leaseId })
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.expiresAt).toBe("2026-03-26T09:01:07.000Z");
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
