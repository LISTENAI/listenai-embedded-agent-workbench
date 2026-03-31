// @ts-ignore Root tsc can misread vitest helper re-exports in this mirrored worktree.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AllocationRequest,
  DeviceRecord,
  InventorySnapshot,
  ReleaseRequest,
} from "@listenai/contracts";
import { HttpResourceManager } from "./http-resource-manager.js";

const fakeDevice: DeviceRecord = {
  deviceId: "dev-1",
  label: "Test Device",
  capabilityType: "csk6",
  connectionState: "connected",
  allocationState: "free",
  ownerSkillId: null,
  lastSeenAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const allocatedDevice: DeviceRecord = {
  ...fakeDevice,
  allocationState: "allocated",
  ownerSkillId: "skill-a",
};

const readyClassicDevice: DeviceRecord = {
  deviceId: "logic-ready",
  label: "DSLogic Plus Ready",
  capabilityType: "logic-analyzer",
  connectionState: "connected",
  allocationState: "free",
  ownerSkillId: null,
  lastSeenAt: "2026-03-30T10:00:00.000Z",
  updatedAt: "2026-03-30T10:00:00.000Z",
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
  lastSeenAt: "2026-03-30T10:00:00.000Z",
  updatedAt: "2026-03-30T10:00:00.000Z",
  readiness: "unsupported",
  diagnostics: [
    {
      code: "device-unsupported-variant",
      severity: "error",
      target: "device",
      message: "Variant V421/Pango (2a0e:0030) is not supported.",
      deviceId: "logic-pango",
      backendKind: "dsview",
    },
  ],
  providerKind: "dslogic",
  backendKind: "dsview",
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
  refreshedAt: "2026-03-30T10:00:00.000Z",
  inventoryScope: {
    providerKinds: ["dslogic"],
    backendKinds: ["dsview"],
  },
  devices: [readyClassicDevice, unsupportedPangoDevice],
  backendReadiness: [
    {
      platform: "linux",
      backendKind: "dsview",
      readiness: "ready",
      executablePath: "/usr/bin/dsview",
      version: "1.3.1",
      checkedAt: "2026-03-30T10:00:00.000Z",
      diagnostics: [],
    },
  ],
  diagnostics: [...unsupportedPangoDevice.diagnostics ?? []],
};

const backendMissingSnapshot: InventorySnapshot = {
  refreshedAt: "2026-03-30T10:00:00.000Z",
  inventoryScope: {
    providerKinds: ["dslogic"],
    backendKinds: ["dsview"],
  },
  devices: [],
  backendReadiness: [
    {
      platform: "macos",
      backendKind: "dsview",
      readiness: "missing",
      executablePath: null,
      version: null,
      checkedAt: "2026-03-30T10:00:00.000Z",
      diagnostics: [
        {
          code: "backend-missing-executable",
          severity: "error",
          target: "backend",
          message: "DSView executable dsview was not found on macos.",
          platform: "macos",
          backendKind: "dsview",
          executablePath: null,
          backendVersion: null,
        },
      ],
    },
  ],
  diagnostics: [
    {
      code: "backend-missing-executable",
      severity: "error",
      target: "backend",
      message: "DSView executable dsview was not found on macos.",
      platform: "macos",
      backendKind: "dsview",
      executablePath: null,
      backendVersion: null,
    },
  ],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const BASE = "http://localhost:7600";

describe("HttpResourceManager", () => {
  let mgr: HttpResourceManager;

  beforeEach(() => {
    vi.restoreAllMocks();
    mgr = new HttpResourceManager(BASE);
  });

  describe("listDevices", () => {
    it("returns devices from GET /devices", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse([fakeDevice]));

      const devices = await mgr.listDevices();

      expect(devices).toEqual([fakeDevice]);
      expect(fetch).toHaveBeenCalledWith(`${BASE}/devices`, undefined);
    });

    it("keeps unsupported DSLogic devices visible on the compatibility device list", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        jsonResponse(mixedDslogicSnapshot.devices),
      );

      const devices = await mgr.listDevices();

      expect(devices).toEqual(mixedDslogicSnapshot.devices);
      expect(devices[1]).toMatchObject({
        deviceId: "logic-pango",
        readiness: "unsupported",
        diagnostics: unsupportedPangoDevice.diagnostics,
      });
      expect(fetch).toHaveBeenCalledWith(`${BASE}/devices`, undefined);
    });
  });

  describe("refreshInventory", () => {
    it("returns devices from POST /refresh", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse([fakeDevice]));

      const devices = await mgr.refreshInventory();

      expect(devices).toEqual([fakeDevice]);
      expect(fetch).toHaveBeenCalledWith(`${BASE}/refresh`, {
        method: "POST",
      });
    });

    it("returns unsupported DSLogic devices instead of filtering them out after refresh", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        jsonResponse(mixedDslogicSnapshot.devices),
      );

      const devices = await mgr.refreshInventory();

      expect(devices).toEqual(mixedDslogicSnapshot.devices);
      expect(fetch).toHaveBeenCalledWith(`${BASE}/refresh`, {
        method: "POST",
      });
    });
  });

  describe("inventory snapshots", () => {
    it("returns full snapshots from GET /inventory", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        jsonResponse(mixedDslogicSnapshot),
      );

      const snapshot = await mgr.getInventorySnapshot();

      expect(snapshot).toEqual(mixedDslogicSnapshot);
      expect(mgr.getLastInventorySnapshot()).toEqual(mixedDslogicSnapshot);
      expect(fetch).toHaveBeenCalledWith(`${BASE}/inventory`, undefined);
    });

    it("returns full snapshots from POST /inventory/refresh", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        jsonResponse(mixedDslogicSnapshot),
      );

      const snapshot = await mgr.refreshInventorySnapshot();

      expect(snapshot).toEqual(mixedDslogicSnapshot);
      expect(mgr.getLastInventorySnapshot()).toEqual(mixedDslogicSnapshot);
      expect(fetch).toHaveBeenCalledWith(`${BASE}/inventory/refresh`, {
        method: "POST",
      });
    });

    it("keeps backend-missing snapshots visible with zero ready devices", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        jsonResponse(backendMissingSnapshot),
      );

      const snapshot = await mgr.getInventorySnapshot();

      expect(snapshot).toEqual(backendMissingSnapshot);
      expect(snapshot.devices).toEqual([]);
      expect(snapshot.backendReadiness[0]).toMatchObject({
        readiness: "missing",
        executablePath: null,
        version: null,
      });
      expect(mgr.getLastInventorySnapshot()).toEqual(backendMissingSnapshot);
    });

    it("rejects malformed snapshot payloads and keeps the last good snapshot", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      fetchSpy.mockResolvedValueOnce(jsonResponse(mixedDslogicSnapshot));
      await mgr.getInventorySnapshot();

      fetchSpy.mockResolvedValueOnce(
        jsonResponse({
          providerKind: "dslogic",
          backendKind: "dsview",
          refreshedAt: "2026-01-01T00:00:00.000Z",
          devices: [{ deviceId: "broken" }],
          backendReadiness: [],
          diagnostics: [],
        }),
      );

      await expect(mgr.refreshInventorySnapshot()).rejects.toThrow(
        "Malformed inventory snapshot response",
      );
      expect(mgr.getLastInventorySnapshot()).toEqual(mixedDslogicSnapshot);
    });

    it("rejects server-unavailable snapshot calls without clearing cache", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      fetchSpy.mockResolvedValueOnce(jsonResponse(mixedDslogicSnapshot));
      await mgr.getInventorySnapshot();

      fetchSpy.mockRejectedValueOnce(new Error("socket hang up"));

      await expect(mgr.refreshInventorySnapshot()).rejects.toThrow(
        "Server unavailable",
      );
      expect(mgr.getLastInventorySnapshot()).toEqual(mixedDslogicSnapshot);
    });
  });

  describe("allocateDevice", () => {
    const req: AllocationRequest = {
      deviceId: "dev-1",
      ownerSkillId: "skill-a",
      requestedAt: "2026-01-01T00:00:00.000Z",
    };

    it("returns success and stores leaseId on 200", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        jsonResponse({
          ok: true,
          device: allocatedDevice,
          leaseId: "lease-123",
          expiresAt: "2026-01-01T00:01:30.000Z",
        }),
      );

      const result = await mgr.allocateDevice(req);

      expect(result).toEqual({ ok: true, device: allocatedDevice });
      expect(mgr.getLeaseId("dev-1")).toBe("lease-123");
    });

    it("returns server-unavailable on fetch exception", async () => {
      vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network error"));

      const result = await mgr.allocateDevice(req);

      expect(result).toEqual({
        ok: false,
        reason: "server-unavailable",
        deviceId: "dev-1",
        ownerSkillId: "skill-a",
        message: "Server unavailable",
        device: null,
      });
    });

    it("passes through 409 conflict response", async () => {
      const conflictBody = {
        ok: false,
        reason: "device-already-allocated",
        deviceId: "dev-1",
        ownerSkillId: "skill-a",
        message: "Device dev-1 is already allocated to skill-b.",
        device: allocatedDevice,
      };

      vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(conflictBody, 409));

      const result = await mgr.allocateDevice(req);

      expect(result).toEqual(conflictBody);
    });
  });

  describe("releaseDevice", () => {
    const req: ReleaseRequest = {
      deviceId: "dev-1",
      ownerSkillId: "skill-a",
      releasedAt: "2026-01-01T00:00:00.000Z",
    };

    it("returns success and removes leaseId on 200", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          device: allocatedDevice,
          leaseId: "lease-123",
          expiresAt: "2026-01-01T00:01:30.000Z",
        }),
      );

      await mgr.allocateDevice({
        deviceId: "dev-1",
        ownerSkillId: "skill-a",
        requestedAt: "2026-01-01T00:00:00.000Z",
      });
      expect(mgr.getLeaseId("dev-1")).toBe("lease-123");

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        jsonResponse({ ok: true, device: fakeDevice }),
      );

      const result = await mgr.releaseDevice(req);

      expect(result).toEqual({ ok: true, device: fakeDevice });
      expect(mgr.getLeaseId("dev-1")).toBeUndefined();
    });

    it("returns server-unavailable on fetch exception", async () => {
      vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network error"));

      const result = await mgr.releaseDevice(req);

      expect(result).toEqual({
        ok: false,
        reason: "server-unavailable",
        deviceId: "dev-1",
        ownerSkillId: "skill-a",
        message: "Server unavailable",
        device: null,
      });
    });
  });

  describe("dispose", () => {
    it("returns 0 when no devices allocated", () => {
      expect(mgr.dispose()).toBe(0);
    });
  });

  describe("heartbeat", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("sends heartbeat every 30s after allocate", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      fetchSpy.mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          device: allocatedDevice,
          leaseId: "lease-123",
          expiresAt: "2026-01-01T00:01:30.000Z",
        }),
      );

      await mgr.allocateDevice({
        deviceId: "dev-1",
        ownerSkillId: "skill-a",
        requestedAt: "2026-01-01T00:00:00.000Z",
      });

      fetchSpy.mockResolvedValue(jsonResponse({ ok: true }));

      await vi.advanceTimersByTimeAsync(30000);

      expect(fetchSpy).toHaveBeenCalledWith(
        `${BASE}/heartbeat`,
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ leaseId: "lease-123" }),
        }),
      );
    });

    it("stops heartbeat after release", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      fetchSpy.mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          device: allocatedDevice,
          leaseId: "lease-123",
          expiresAt: "2026-01-01T00:01:30.000Z",
        }),
      );

      await mgr.allocateDevice({
        deviceId: "dev-1",
        ownerSkillId: "skill-a",
        requestedAt: "2026-01-01T00:00:00.000Z",
      });

      fetchSpy.mockResolvedValueOnce(jsonResponse({ ok: true, device: fakeDevice }));
      await mgr.releaseDevice({
        deviceId: "dev-1",
        ownerSkillId: "skill-a",
        releasedAt: "2026-01-01T00:00:00.000Z",
      });

      const callsBefore = fetchSpy.mock.calls.length;
      await vi.advanceTimersByTimeAsync(30000);

      expect(fetchSpy.mock.calls.length).toBe(callsBefore);
    });

    it("dispose cleans up all timers", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      fetchSpy.mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          device: allocatedDevice,
          leaseId: "lease-123",
          expiresAt: "2026-01-01T00:01:30.000Z",
        }),
      );

      await mgr.allocateDevice({
        deviceId: "dev-1",
        ownerSkillId: "skill-a",
        requestedAt: "2026-01-01T00:00:00.000Z",
      });

      fetchSpy.mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          device: allocatedDevice,
          leaseId: "lease-456",
          expiresAt: "2026-01-01T00:01:30.000Z",
        }),
      );

      await mgr.allocateDevice({
        deviceId: "dev-2",
        ownerSkillId: "skill-a",
        requestedAt: "2026-01-01T00:00:00.000Z",
      });

      const count = mgr.dispose();
      expect(count).toBe(2);

      fetchSpy.mockResolvedValue(jsonResponse({ ok: true }));
      const callsBefore = fetchSpy.mock.calls.length;
      await vi.advanceTimersByTimeAsync(30000);

      expect(fetchSpy.mock.calls.length).toBe(callsBefore);
    });

    it("logs error but continues on heartbeat failure", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const fetchSpy = vi.spyOn(globalThis, "fetch");

      fetchSpy.mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          device: allocatedDevice,
          leaseId: "lease-123",
          expiresAt: "2026-01-01T00:01:30.000Z",
        }),
      );

      await mgr.allocateDevice({
        deviceId: "dev-1",
        ownerSkillId: "skill-a",
        requestedAt: "2026-01-01T00:00:00.000Z",
      });

      fetchSpy.mockResolvedValueOnce(jsonResponse({}, 404));

      await vi.advanceTimersByTimeAsync(30000);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Heartbeat failed for lease lease-123: 404"),
      );

      consoleSpy.mockRestore();
    });
  });
});
