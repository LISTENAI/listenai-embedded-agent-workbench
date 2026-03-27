// @ts-expect-error - vi, beforeEach work at runtime but verbatimModuleSyntax + vitest re-exports cause false TS2305
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { HttpResourceManager } from "./http-resource-manager.js";
import type {
  AllocationRequest,
  DeviceRecord,
  ReleaseRequest,
} from "../contracts.js";

// ── helpers ──

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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const BASE = "http://localhost:7600";

// ── tests ──

describe("HttpResourceManager", () => {
  let mgr: HttpResourceManager;

  beforeEach(() => {
    vi.restoreAllMocks();
    mgr = new HttpResourceManager(BASE);
  });

  describe("listDevices", () => {
    it("returns devices from GET /devices", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        jsonResponse([fakeDevice]),
      );
      const devices = await mgr.listDevices();
      expect(devices).toEqual([fakeDevice]);
      expect(fetch).toHaveBeenCalledWith(`${BASE}/devices`, undefined);
    });
  });

  describe("refreshInventory", () => {
    it("returns devices from POST /refresh", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        jsonResponse([fakeDevice]),
      );
      const devices = await mgr.refreshInventory();
      expect(devices).toEqual([fakeDevice]);
      expect(fetch).toHaveBeenCalledWith(`${BASE}/refresh`, {
        method: "POST",
      });
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
      vi.spyOn(globalThis, "fetch").mockRejectedValue(
        new Error("Network error"),
      );
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
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        jsonResponse(conflictBody, 409),
      );
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
      // Pre-populate a leaseId via allocateDevice
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

      // Now release
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        jsonResponse({ ok: true, device: fakeDevice }),
      );
      const result = await mgr.releaseDevice(req);
      expect(result).toEqual({ ok: true, device: fakeDevice });
      expect(mgr.getLeaseId("dev-1")).toBeUndefined();
    });

    it("returns server-unavailable on fetch exception", async () => {
      vi.spyOn(globalThis, "fetch").mockRejectedValue(
        new Error("Network error"),
      );
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

      fetchSpy.mockResolvedValueOnce(
        jsonResponse({ ok: true, device: fakeDevice }),
      );
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
