// @ts-ignore Root tsc can misread vitest helper re-exports in this mirrored worktree.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AllocationRequest,
  DeviceOptionsRequest,
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
  backendKind: "dsview-cli",
  canonicalIdentity: {
    providerKind: "dslogic",
    providerDeviceId: "classic-001",
    canonicalKey: "dslogic:classic-001",
  },
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
      backendKind: "dsview-cli",
    },
  ],
  providerKind: "dslogic",
  backendKind: "dsview-cli",
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
    backendKinds: ["dsview-cli"],
  },
  devices: [readyClassicDevice, unsupportedPangoDevice],
  backendReadiness: [
    {
      platform: "linux",
      backendKind: "dsview-cli",
      readiness: "ready",
      version: "1.2.2",
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
    backendKinds: ["dsview-cli"],
  },
  devices: [],
  backendReadiness: [
    {
      platform: "macos",
      backendKind: "dsview-cli",
      readiness: "missing",
      version: null,
      checkedAt: "2026-03-30T10:00:00.000Z",
      diagnostics: [
        {
          code: "backend-missing-runtime",
          severity: "error",
          target: "backend",
          message: "dsview-cli runtime is not available on macos.",
          platform: "macos",
          backendKind: "dsview-cli",
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
      message: "dsview-cli runtime is not available on macos.",
      platform: "macos",
      backendKind: "dsview-cli",
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
          backendKind: "dsview-cli",
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

  describe("inspectDeviceOptions", () => {
    const request: DeviceOptionsRequest = {
      session: {
        sessionId: "session-1",
        deviceId: "logic-ready",
        ownerSkillId: "skill-a",
        startedAt: "2026-03-30T10:00:00.000Z",
        device: readyClassicDevice,
        sampling: {
          sampleRateHz: 1_000_000,
          captureDurationMs: 250,
          channels: [{ channelId: "D0", label: "CLK" }],
        },
      },
      requestedAt: "2026-03-30T10:00:01.000Z",
      timeoutMs: 15000,
    };

    const capabilities = {
      operations: [
        {
          token: "logic",
          label: "Logic",
          description: "Logic analyzer capture mode",
        },
      ],
      channels: [{ token: "D0", label: "Channel 0" }],
      stopConditions: [{ token: "samples", description: "Stop after sample limit" }],
      filters: [{ token: "none" }],
      thresholds: [{ token: "1.8v", label: "1.8 V" }],
    };

    const diagnostics = {
      phase: "inspect-options",
      providerKind: "dslogic",
      backendKind: "dsview-cli",
      backendVersion: "1.2.2",
      timeoutMs: 15000,
      nativeCode: "EOPTIONS",
      optionsOutput: {
        kind: "text",
        byteLength: 13,
        textLength: 13,
        preview: "bad options",
        truncated: false,
      },
      diagnosticOutput: null,
      details: ["runtime rejected the options request"],
      diagnostics: [
        {
          code: "backend-runtime-failed",
          severity: "error",
          target: "backend",
          message: "dsview-cli failed while inspecting options.",
          backendKind: "dsview-cli",
          backendVersion: "1.2.2",
        },
      ],
    };

    it("posts to /devices/options and parses capability groups", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        jsonResponse({
          ok: true,
          providerKind: "dslogic",
          backendKind: "dsview-cli",
          session: request.session,
          requestedAt: request.requestedAt,
          capabilities,
        }),
      );

      const result = await mgr.inspectDeviceOptions(request);

      expect(result).toEqual({
        ok: true,
        providerKind: "dslogic",
        backendKind: "dsview-cli",
        session: request.session,
        requestedAt: request.requestedAt,
        capabilities,
      });
      expect(fetch).toHaveBeenCalledWith(BASE + "/devices/options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
    });

    it("round-trips typed device-options failures", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        jsonResponse({
          ok: false,
          reason: "device-options-failed",
          kind: "native-error",
          message: "Could not inspect DSLogic options.",
          session: request.session,
          requestedAt: request.requestedAt,
          capabilities: null,
          diagnostics,
        }),
      );

      await expect(mgr.inspectDeviceOptions(request)).resolves.toEqual({
        ok: false,
        reason: "device-options-failed",
        kind: "native-error",
        message: "Could not inspect DSLogic options.",
        session: request.session,
        requestedAt: request.requestedAt,
        capabilities: null,
        diagnostics,
      });
    });

    it("rejects missing capability groups", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        jsonResponse({
          ok: true,
          providerKind: "dslogic",
          backendKind: "dsview-cli",
          session: request.session,
          requestedAt: request.requestedAt,
          capabilities: { ...capabilities, thresholds: undefined },
        }),
      );

      await expect(mgr.inspectDeviceOptions(request)).rejects.toThrow(
        "Malformed device options response at root.capabilities.thresholds",
      );
    });

    it("rejects non-string option tokens", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        jsonResponse({
          ok: true,
          providerKind: "dslogic",
          backendKind: "dsview-cli",
          session: request.session,
          requestedAt: request.requestedAt,
          capabilities: {
            ...capabilities,
            operations: [{ token: 42, label: "Logic" }],
          },
        }),
      );

      await expect(mgr.inspectDeviceOptions(request)).rejects.toThrow(
        "Malformed device options response at root.capabilities.operations[0].token",
      );
    });

    it("rejects unknown failure literals", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      fetchSpy.mockResolvedValueOnce(
        jsonResponse({
          ok: false,
          reason: "unknown-failure",
          kind: "native-error",
          message: "Could not inspect DSLogic options.",
          session: request.session,
          requestedAt: request.requestedAt,
          capabilities: null,
          diagnostics,
        }),
      );

      await expect(mgr.inspectDeviceOptions(request)).rejects.toThrow(
        "Malformed device options response at root.reason",
      );

      fetchSpy.mockResolvedValueOnce(
        jsonResponse({
          ok: false,
          reason: "device-options-failed",
          kind: "unknown-kind",
          message: "Could not inspect DSLogic options.",
          session: request.session,
          requestedAt: request.requestedAt,
          capabilities: null,
          diagnostics,
        }),
      );

      await expect(mgr.inspectDeviceOptions(request)).rejects.toThrow(
        "Malformed device options response at root.kind",
      );
    });

    it("rejects malformed diagnostics with device-options paths", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        jsonResponse({
          ok: false,
          reason: "device-options-failed",
          kind: "native-error",
          message: "Could not inspect DSLogic options.",
          session: request.session,
          requestedAt: request.requestedAt,
          capabilities: null,
          diagnostics: {
            ...diagnostics,
            diagnostics: [
              {
                code: "backend-runtime-failed",
                severity: "error",
                target: "backend",
                message: 99,
                backendKind: "dsview-cli",
              },
            ],
          },
        }),
      );

      await expect(mgr.inspectDeviceOptions(request)).rejects.toThrow(
        "Malformed device options response at root.diagnostics.diagnostics[0].message",
      );
    });

    it("rejects malformed session devices with device-options paths", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        jsonResponse({
          ok: true,
          providerKind: "dslogic",
          backendKind: "dsview-cli",
          session: {
            ...request.session,
            device: {
              ...request.session.device,
              connectionState: "unknown-connection",
            },
          },
          requestedAt: request.requestedAt,
          capabilities,
        }),
      );

      await expect(mgr.inspectDeviceOptions(request)).rejects.toThrow(
        "Malformed device options response at root.session.device.connectionState",
      );
    });
  });

  describe("liveCapture", () => {
    const request = {
      session: {
        sessionId: "session-1",
        deviceId: "logic-ready",
        ownerSkillId: "skill-a",
        startedAt: "2026-03-30T10:00:00.000Z",
        device: readyClassicDevice,
        sampling: {
          sampleRateHz: 1_000_000,
          captureDurationMs: 250,
          channels: [{ channelId: "D0", label: "CLK" }],
        },
      },
      requestedAt: "2026-03-30T10:00:01.000Z",
      timeoutMs: 15000,
    };

    it("parses dsview-cli live capture payloads and preserves byte artifacts", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        jsonResponse({
          ok: true,
          providerKind: "dslogic",
          backendKind: "dsview-cli",
          session: request.session,
          requestedAt: request.requestedAt,
          artifact: {
            sourceName: "capture.sr",
            formatHint: "srzip",
            mediaType: "application/octet-stream",
            capturedAt: "2026-03-30T10:00:02.000Z",
            sampling: {
              sampleRateHz: 1_000_000,
              totalSamples: 256,
              requestedSampleLimit: 256,
            },
            text: "trace",
            bytes: [1, 2, 3, 4],
          },
          artifactSummary: {
            sourceName: "capture.sr",
            formatHint: "srzip",
            mediaType: "application/octet-stream",
            capturedAt: "2026-03-30T10:00:02.000Z",
            byteLength: 4,
            textLength: 5,
            hasText: true,
          },
          auxiliaryArtifacts: [
            {
              sourceName: "capture.json",
              formatHint: "dsview-capture-metadata",
              mediaType: "application/json",
              text: '{"capture":{"actual_sample_count":256}}',
            },
          ],
          auxiliaryArtifactSummaries: [
            {
              sourceName: "capture.json",
              formatHint: "dsview-capture-metadata",
              mediaType: "application/json",
              capturedAt: null,
              byteLength: null,
              textLength: 37,
              hasText: true,
            },
          ],
        }),
      );

      const result = await mgr.liveCapture(request);

      expect(result).toEqual({
        ok: true,
        providerKind: "dslogic",
        backendKind: "dsview-cli",
        session: request.session,
        requestedAt: request.requestedAt,
        artifact: {
          sourceName: "capture.sr",
          formatHint: "srzip",
          mediaType: "application/octet-stream",
          capturedAt: "2026-03-30T10:00:02.000Z",
          sampling: {
            sampleRateHz: 1_000_000,
            totalSamples: 256,
            requestedSampleLimit: 256,
          },
          text: "trace",
          bytes: new Uint8Array([1, 2, 3, 4]),
        },
        artifactSummary: {
          sourceName: "capture.sr",
          formatHint: "srzip",
          mediaType: "application/octet-stream",
          capturedAt: "2026-03-30T10:00:02.000Z",
          byteLength: 4,
          textLength: 5,
          hasText: true,
        },
        auxiliaryArtifacts: [
          {
            sourceName: "capture.json",
            formatHint: "dsview-capture-metadata",
            mediaType: "application/json",
            text: '{"capture":{"actual_sample_count":256}}',
          },
        ],
        auxiliaryArtifactSummaries: [
          {
            sourceName: "capture.json",
            formatHint: "dsview-capture-metadata",
            mediaType: "application/json",
            capturedAt: null,
            byteLength: null,
            textLength: 37,
            hasText: true,
          },
        ],
      });
      expect(fetch).toHaveBeenCalledWith(BASE + "/capture/live", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
    });

    it("rejects unknown backend kinds in inventory snapshots", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        jsonResponse({
          ...mixedDslogicSnapshot,
          inventoryScope: {
            ...mixedDslogicSnapshot.inventoryScope,
            backendKinds: ["invalid-backend-kind"],
          },
        }),
      );

      await expect(mgr.getInventorySnapshot()).rejects.toThrow(
        "Malformed inventory snapshot response at root.inventoryScope.backendKinds[0]",
      );
    });

    it("rejects unknown backend kinds in live capture responses", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        jsonResponse({
          ok: true,
          providerKind: "dslogic",
          backendKind: "invalid-backend-kind",
          session: request.session,
          requestedAt: request.requestedAt,
          artifact: { bytes: [1] },
          artifactSummary: {
            sourceName: null,
            formatHint: null,
            mediaType: null,
            capturedAt: null,
            byteLength: 1,
            textLength: null,
            hasText: false,
          },
        }),
      );

      await expect(mgr.liveCapture(request)).rejects.toThrow(
        "Malformed live capture response at root.backendKind",
      );
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
