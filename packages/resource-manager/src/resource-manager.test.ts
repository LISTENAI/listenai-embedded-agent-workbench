import { describe, expect, expectTypeOf, it } from "vitest";

import {
  ALLOCATION_FAILURE_REASONS,
  ALLOCATION_STATES,
  BACKEND_READINESS_STATES,
  CONNECTION_STATES,
  type CaptureDecodeRequest,
  type CaptureDecodeResult,
  DEVICE_READINESS_STATES,
  DSLOGIC_BACKEND_KIND,
  DSLOGIC_PROVIDER_KIND,
  type DecoderCapabilitiesRequest,
  type DecoderCapabilitiesResult,
  INVENTORY_BACKEND_KINDS,
  INVENTORY_DIAGNOSTIC_CODES,
  INVENTORY_DIAGNOSTIC_SEVERITIES,
  INVENTORY_DIAGNOSTIC_TARGETS,
  INVENTORY_PLATFORMS,
  INVENTORY_PROVIDER_KINDS,
  RELEASE_FAILURE_REASONS,
  type AllocationFailure,
  type AllocationRequest,
  type AllocationResult,
  type DeviceOptionsRequest,
  type DeviceOptionsResult,
  type DeviceRecord,
  type DslogicBackendIdentity,
  type InventorySnapshot,
  type LiveCaptureResult,
  type ReleaseFailure,
  type ReleaseRequest,
  type ReleaseResult,
  type SnapshotResourceManager
} from "@listenai/eaw-contracts";
import type { DeviceProvider } from "./device-provider.js";
import {
  createDslogicLiveCaptureRunner,
  createLiveCaptureRequest
} from "./dslogic/live-capture.js";
import { createResourceManager } from "./resource-manager.js";
import { FakeDeviceProvider } from "./testing/fake-device-provider.js";

describe("resource manager contract", () => {
  it("exposes visible device state fields on DeviceRecord", () => {
    const record: DeviceRecord = {
      deviceId: "logic-1",
      label: "USB Logic Analyzer",
      capabilityType: "logic-analyzer",
      connectionState: "connected",
      allocationState: "free",
      ownerSkillId: null,
      lastSeenAt: "2026-03-25T12:00:00.000Z",
      updatedAt: "2026-03-25T12:00:00.000Z",
      readiness: "ready",
      diagnostics: [
        {
          code: "device-unsupported-variant",
          severity: "warning",
          target: "device",
          message: "Variant classification is pending.",
          deviceId: "logic-1",
          backendKind: "dsview-cli"
        }
      ],
      providerKind: "dslogic",
      backendKind: "dsview-cli",
      dslogic: {
        family: "dslogic",
        model: "dslogic-plus",
        modelDisplayName: "DSLogic Plus",
        variant: "classic",
        usbVendorId: "2a0e",
        usbProductId: "0001"
      }
    };

    expect(record).toEqual({
      deviceId: "logic-1",
      label: "USB Logic Analyzer",
      capabilityType: "logic-analyzer",
      connectionState: "connected",
      allocationState: "free",
      ownerSkillId: null,
      lastSeenAt: "2026-03-25T12:00:00.000Z",
      updatedAt: "2026-03-25T12:00:00.000Z",
      readiness: "ready",
      diagnostics: [
        {
          code: "device-unsupported-variant",
          severity: "warning",
          target: "device",
          message: "Variant classification is pending.",
          deviceId: "logic-1",
          backendKind: "dsview-cli"
        }
      ],
      providerKind: "dslogic",
      backendKind: "dsview-cli",
      dslogic: {
        family: "dslogic",
        model: "dslogic-plus",
        modelDisplayName: "DSLogic Plus",
        variant: "classic",
        usbVendorId: "2a0e",
        usbProductId: "0001"
      }
    });
  });

  it("defines explicit allocation, release, and inventory readiness enums", () => {
    expect(ALLOCATION_FAILURE_REASONS).toEqual([
      "device-not-found",
      "device-disconnected",
      "device-already-allocated",
      "server-unavailable"
    ]);
    expect(RELEASE_FAILURE_REASONS).toEqual([
      "device-not-found",
      "device-not-allocated",
      "owner-mismatch",
      "server-unavailable"
    ]);
    expect(CONNECTION_STATES).toEqual(["connected", "disconnected"]);
    expect(ALLOCATION_STATES).toEqual(["free", "allocated"]);
    expect(DEVICE_READINESS_STATES).toEqual([
      "ready",
      "degraded",
      "unsupported"
    ]);
    expect(BACKEND_READINESS_STATES).toEqual([
      "ready",
      "degraded",
      "missing",
      "unsupported"
    ]);
    expect(INVENTORY_PROVIDER_KINDS).toEqual(["fake", "dslogic"]);
    expect(INVENTORY_BACKEND_KINDS).toEqual(["fake", "dsview-cli"]);
    expect(INVENTORY_PLATFORMS).toEqual(["linux", "macos", "windows"]);
    expect(INVENTORY_DIAGNOSTIC_SEVERITIES).toEqual([
      "info",
      "warning",
      "error"
    ]);
    expect(INVENTORY_DIAGNOSTIC_TARGETS).toEqual([
      "host",
      "backend",
      "device"
    ]);
    expect(INVENTORY_DIAGNOSTIC_CODES).toEqual([
      "backend-missing-runtime",
      "backend-unsupported-os",
      "backend-runtime-failed",
      "backend-runtime-timeout",
      "backend-runtime-malformed-response",
      "device-unsupported-variant",
      "device-runtime-malformed-response"
    ]);
  });

  it("pins DSLogic contract identity to dsview-cli", () => {
    expect(DSLOGIC_PROVIDER_KIND).toBe("dslogic");
    expect(DSLOGIC_BACKEND_KIND).toBe("dsview-cli");
    expectTypeOf<DslogicBackendIdentity>().toMatchTypeOf<{
      providerKind: "dslogic";
      backendKind: "dsview-cli";
    }>();
  });

  it("keeps request, result, and snapshot contracts discriminated and additive", () => {
    expectTypeOf<AllocationRequest>().toMatchTypeOf<{
      deviceId: string;
      ownerSkillId: string;
      requestedAt: string;
    }>();

    expectTypeOf<ReleaseRequest>().toMatchTypeOf<{
      deviceId: string;
      ownerSkillId: string;
      releasedAt: string;
    }>();

    expectTypeOf<AllocationFailure>().toMatchTypeOf<{
      ok: false;
      reason: string;
      deviceId: string;
      ownerSkillId: string;
      message: string;
      device: DeviceRecord | null;
    }>();

    expectTypeOf<ReleaseFailure>().toMatchTypeOf<{
      ok: false;
      reason: string;
      deviceId: string;
      ownerSkillId: string;
      message: string;
      device: DeviceRecord | null;
    }>();

    expectTypeOf<AllocationResult>().toMatchTypeOf<
      | { ok: true; device: DeviceRecord }
      | { ok: false; reason: string; deviceId: string }
    >();

    expectTypeOf<ReleaseResult>().toMatchTypeOf<
      | { ok: true; device: DeviceRecord }
      | { ok: false; reason: string; deviceId: string }
    >();

    expectTypeOf<InventorySnapshot>().toMatchTypeOf<{
      refreshedAt: string;
      inventoryScope: {
        providerKinds: readonly string[];
        backendKinds: readonly string[];
      };
      devices: readonly DeviceRecord[];
      backendReadiness: readonly {
        platform: string;
        readiness: string;
        diagnostics: readonly {
          code: string;
          message: string;
        }[];
      }[];
      diagnostics: readonly {
        code: string;
        target: string;
        message: string;
      }[];
    }>();

    expectTypeOf<SnapshotResourceManager>().toMatchTypeOf<{
      refreshInventorySnapshot(): Promise<InventorySnapshot>;
      getInventorySnapshot(): Promise<InventorySnapshot>;
    }>();
  });
});

describe("fake device provider snapshot seam", () => {
  const refreshedAt = "2026-03-25T12:00:00.000Z";

  it("preserves diagnostic-only snapshots when no devices are ready", async () => {
    const diagnosticOnlySnapshot: InventorySnapshot = {
      refreshedAt,
      inventoryScope: {
        providerKinds: ["dslogic"],
        backendKinds: ["dsview-cli"]
      },
      devices: [],
      backendReadiness: [
        {
          platform: "macos",
          backendKind: "dsview-cli",
          readiness: "missing",
          version: null,
          checkedAt: refreshedAt,
          diagnostics: [
            {
              code: "backend-missing-runtime",
              severity: "error",
              target: "backend",
              message: "dsview-cli runtime is not available on macos.",
              platform: "macos",
              backendKind: "dsview-cli"
            }
          ]
        }
      ],
      diagnostics: [
        {
          code: "backend-missing-runtime",
          severity: "error",
          target: "backend",
          message: "dsview-cli runtime is not available on macos.",
          platform: "macos",
          backendKind: "dsview-cli"
        }
      ]
    };

    const provider = new FakeDeviceProvider(diagnosticOnlySnapshot);

    expect(await provider.listInventorySnapshot()).toEqual(diagnosticOnlySnapshot);
    expect(await provider.listConnectedDevices()).toEqual([]);
  });

  it("keeps degraded and unsupported DSLogic rows visible in the snapshot", async () => {
    const snapshot: InventorySnapshot = {
      refreshedAt,
      inventoryScope: {
        providerKinds: ["dslogic"],
        backendKinds: ["dsview-cli"]
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
          backendKind: "dsview-cli",
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
          deviceId: "logic-degraded",
          label: "DSLogic Plus Waiting For Backend",
          capabilityType: "logic-analyzer",
          connectionState: "connected",
          allocationState: "free",
          ownerSkillId: null,
          lastSeenAt: refreshedAt,
          updatedAt: refreshedAt,
          readiness: "degraded",
          diagnostics: [
            {
              code: "backend-runtime-timeout",
              severity: "warning",
              target: "backend",
              message: "Backend probe timed out before capabilities were confirmed.",
              deviceId: "logic-degraded",
              backendKind: "dsview-cli"
            }
          ],
          providerKind: "dslogic",
          backendKind: "dsview-cli",
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
              backendKind: "dsview-cli"
            }
          ],
          providerKind: "dslogic",
          backendKind: "dsview-cli",
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
          platform: "linux",
          backendKind: "dsview-cli",
          readiness: "ready",
          version: "1.2.2",
          checkedAt: refreshedAt,
          diagnostics: []
        }
      ],
      diagnostics: []
    };

    const provider = new FakeDeviceProvider(snapshot);

    expect(await provider.listInventorySnapshot()).toEqual(snapshot);
    expect(await provider.listConnectedDevices()).toEqual([
      {
        deviceId: "logic-ready",
        label: "DSLogic Plus Ready",
        capabilityType: "logic-analyzer",
        lastSeenAt: refreshedAt
      }
    ]);
  });

  it("still supports the legacy ready-device constructor and setter", async () => {
    const provider = new FakeDeviceProvider([
      {
        deviceId: "logic-1",
        label: "USB Logic Analyzer",
        capabilityType: "logic-analyzer",
        lastSeenAt: refreshedAt
      }
    ]);

    expect(await provider.listConnectedDevices()).toEqual([
      {
        deviceId: "logic-1",
        label: "USB Logic Analyzer",
        capabilityType: "logic-analyzer",
        lastSeenAt: refreshedAt
      }
    ]);

    provider.setConnectedDevices([]);

    expect(await provider.listInventorySnapshot()).toEqual({
      refreshedAt: "1970-01-01T00:00:00.000Z",
      inventoryScope: {
        providerKinds: ["fake"],
        backendKinds: ["fake"]
      },
      devices: [],
      backendReadiness: [],
      diagnostics: []
    });
  });
});

describe("in-memory resource manager", () => {
  const connectedAt = "2026-03-25T12:00:00.000Z";
  const allocateAt = "2026-03-25T12:01:00.000Z";
  const conflictAt = "2026-03-25T12:01:30.000Z";
  const disconnectAt = "2026-03-25T12:02:00.000Z";
  const releaseAt = "2026-03-25T12:03:00.000Z";

  const baseDevice = {
    deviceId: "logic-1",
    label: "USB Logic Analyzer",
    capabilityType: "logic-analyzer",
    lastSeenAt: connectedAt
  } as const;

  const baseInventoryFields = {
    readiness: "ready",
    diagnostics: [],
    providerKind: "fake",
    backendKind: "fake",
    dslogic: null
  } as const;

  const createClock = (...timestamps: string[]) => {
    let index = 0;

    return () => timestamps[Math.min(index++, timestamps.length - 1)] ?? releaseAt;
  };

  it("refreshes discovered devices into visible inventory records", async () => {
    const provider = new FakeDeviceProvider([baseDevice]);
    const manager = createResourceManager(provider, {
      now: createClock(connectedAt)
    });

    const records = await manager.refreshInventory();

    expect(records).toEqual([
      {
        deviceId: "logic-1",
        label: "USB Logic Analyzer",
        capabilityType: "logic-analyzer",
        connectionState: "connected",
        allocationState: "free",
        ownerSkillId: null,
        lastSeenAt: connectedAt,
        updatedAt: connectedAt,
        ...baseInventoryFields
      }
    ]);
    expect(await manager.listDevices()).toEqual(records);
  });

  it("transitions a connected device from free to allocated to free", async () => {
    const provider = new FakeDeviceProvider([baseDevice]);
    const manager = createResourceManager(provider, {
      now: createClock(connectedAt)
    });

    await manager.refreshInventory();

    const allocation = await manager.allocateDevice({
      deviceId: "logic-1",
      ownerSkillId: "skill-alpha",
      requestedAt: allocateAt
    });

    expect(allocation).toEqual({
      ok: true,
      device: {
        deviceId: "logic-1",
        label: "USB Logic Analyzer",
        capabilityType: "logic-analyzer",
        connectionState: "connected",
        allocationState: "allocated",
        ownerSkillId: "skill-alpha",
        lastSeenAt: connectedAt,
        updatedAt: allocateAt,
        ...baseInventoryFields
      }
    });

    const release = await manager.releaseDevice({
      deviceId: "logic-1",
      ownerSkillId: "skill-alpha",
      releasedAt: releaseAt
    });

    expect(release).toEqual({
      ok: true,
      device: {
        deviceId: "logic-1",
        label: "USB Logic Analyzer",
        capabilityType: "logic-analyzer",
        connectionState: "connected",
        allocationState: "free",
        ownerSkillId: null,
        lastSeenAt: connectedAt,
        updatedAt: releaseAt,
        ...baseInventoryFields
      }
    });
    expect(await manager.listDevices()).toEqual([
      {
        deviceId: "logic-1",
        label: "USB Logic Analyzer",
        capabilityType: "logic-analyzer",
        connectionState: "connected",
        allocationState: "free",
        ownerSkillId: null,
        lastSeenAt: connectedAt,
        updatedAt: releaseAt,
        ...baseInventoryFields
      }
    ]);
  });

  it("rejects conflicting allocation requests with the owning state still visible", async () => {
    const provider = new FakeDeviceProvider([baseDevice]);
    const manager = createResourceManager(provider, {
      now: createClock(connectedAt)
    });

    await manager.refreshInventory();

    const firstAllocation = await manager.allocateDevice({
      deviceId: "logic-1",
      ownerSkillId: "skill-alpha",
      requestedAt: allocateAt
    });
    const conflictingAllocation = await manager.allocateDevice({
      deviceId: "logic-1",
      ownerSkillId: "skill-beta",
      requestedAt: conflictAt
    });

    expect(firstAllocation.ok).toBe(true);
    expect(conflictingAllocation).toMatchObject({
      ok: false,
      reason: "device-already-allocated",
      deviceId: "logic-1",
      ownerSkillId: "skill-beta"
    });
    expect(conflictingAllocation.ok).toBe(false);
    if (!conflictingAllocation.ok) {
      expect(conflictingAllocation.message).toContain("skill-alpha");
      expect(conflictingAllocation.device).toEqual({
        deviceId: "logic-1",
        label: "USB Logic Analyzer",
        capabilityType: "logic-analyzer",
        connectionState: "connected",
        allocationState: "allocated",
        ownerSkillId: "skill-alpha",
        lastSeenAt: connectedAt,
        updatedAt: allocateAt,
        ...baseInventoryFields
      });
    }

    expect(await manager.listDevices()).toEqual([
      {
        deviceId: "logic-1",
        label: "USB Logic Analyzer",
        capabilityType: "logic-analyzer",
        connectionState: "connected",
        allocationState: "allocated",
        ownerSkillId: "skill-alpha",
        lastSeenAt: connectedAt,
        updatedAt: allocateAt,
        ...baseInventoryFields
      }
    ]);
  });

  it("rejects wrong-owner release attempts without hiding the current allocation", async () => {
    const provider = new FakeDeviceProvider([baseDevice]);
    const manager = createResourceManager(provider, {
      now: createClock(connectedAt)
    });

    await manager.refreshInventory();
    await manager.allocateDevice({
      deviceId: "logic-1",
      ownerSkillId: "skill-alpha",
      requestedAt: allocateAt
    });

    const releaseResult = await manager.releaseDevice({
      deviceId: "logic-1",
      ownerSkillId: "skill-beta",
      releasedAt: releaseAt
    });

    expect(releaseResult).toMatchObject({
      ok: false,
      reason: "owner-mismatch",
      deviceId: "logic-1",
      ownerSkillId: "skill-beta"
    });
    expect(releaseResult.ok).toBe(false);
    if (!releaseResult.ok) {
      expect(releaseResult.message).toContain("skill-alpha");
      expect(releaseResult.device).toEqual({
        deviceId: "logic-1",
        label: "USB Logic Analyzer",
        capabilityType: "logic-analyzer",
        connectionState: "connected",
        allocationState: "allocated",
        ownerSkillId: "skill-alpha",
        lastSeenAt: connectedAt,
        updatedAt: allocateAt,
        ...baseInventoryFields
      });
    }

    expect(await manager.listDevices()).toEqual([
      {
        deviceId: "logic-1",
        label: "USB Logic Analyzer",
        capabilityType: "logic-analyzer",
        connectionState: "connected",
        allocationState: "allocated",
        ownerSkillId: "skill-alpha",
        lastSeenAt: connectedAt,
        updatedAt: allocateAt,
        ...baseInventoryFields
      }
    ]);
  });

  it("keeps allocated missing devices visible as disconnected until release", async () => {
    const provider = new FakeDeviceProvider([baseDevice]);
    const manager = createResourceManager(provider, {
      now: createClock(connectedAt, disconnectAt)
    });

    await manager.refreshInventory();
    await manager.allocateDevice({
      deviceId: "logic-1",
      ownerSkillId: "skill-alpha",
      requestedAt: allocateAt
    });

    provider.setConnectedDevices([]);
    const refreshed = await manager.refreshInventory();

    expect(refreshed).toEqual([
      {
        deviceId: "logic-1",
        label: "USB Logic Analyzer",
        capabilityType: "logic-analyzer",
        connectionState: "disconnected",
        allocationState: "allocated",
        ownerSkillId: "skill-alpha",
        lastSeenAt: connectedAt,
        updatedAt: disconnectAt,
        ...baseInventoryFields
      }
    ]);

    const releaseResult = await manager.releaseDevice({
      deviceId: "logic-1",
      ownerSkillId: "skill-alpha",
      releasedAt: releaseAt
    });

    expect(releaseResult).toEqual({
      ok: true,
      device: {
        deviceId: "logic-1",
        label: "USB Logic Analyzer",
        capabilityType: "logic-analyzer",
        connectionState: "disconnected",
        allocationState: "free",
        ownerSkillId: null,
        lastSeenAt: connectedAt,
        updatedAt: releaseAt,
        ...baseInventoryFields
      }
    });
    expect(await manager.listDevices()).toEqual([]);
  });

  it("merges registered provider snapshots without collapsing canonical identities", async () => {
    const dslogicSnapshot: InventorySnapshot = {
      refreshedAt: connectedAt,
      inventoryScope: {
        providerKinds: ["dslogic"],
        backendKinds: ["dsview-cli"]
      },
      devices: [
        {
          deviceId: "logic-collision",
          label: "DSLogic Collision",
          capabilityType: "logic-analyzer",
          connectionState: "connected",
          allocationState: "free",
          ownerSkillId: null,
          lastSeenAt: connectedAt,
          updatedAt: connectedAt,
          readiness: "ready",
          diagnostics: [
            {
              code: "backend-runtime-timeout",
              severity: "warning",
              target: "device",
              message: "DSLogic capture path is slow.",
              deviceId: "logic-collision",
              backendKind: "dsview-cli"
            }
          ],
          providerKind: "dslogic",
          backendKind: "dsview-cli",
          canonicalIdentity: {
            providerKind: "dslogic",
            providerDeviceId: "collision-001",
            canonicalKey: "dslogic:collision-001"
          },
          dslogic: null
        }
      ],
      backendReadiness: [
        {
          platform: "macos",
          backendKind: "dsview-cli",
          readiness: "degraded",
          version: "2.0.0",
          checkedAt: connectedAt,
          diagnostics: [
            {
              code: "backend-runtime-timeout",
              severity: "warning",
              target: "backend",
              message: "dsview-cli runtime probe timed out before readiness was confirmed on macos.",
              platform: "macos",
              backendKind: "dsview-cli"
            }
          ]
        }
      ],
      diagnostics: [
        {
          code: "backend-runtime-timeout",
          severity: "warning",
          target: "backend",
          message: "dsview-cli runtime probe timed out before readiness was confirmed on macos.",
          platform: "macos",
          backendKind: "dsview-cli"
        }
      ]
    };

    const fakeSnapshot: InventorySnapshot = {
      refreshedAt: connectedAt,
      inventoryScope: {
        providerKinds: ["fake"],
        backendKinds: ["fake"]
      },
      devices: [
        {
          deviceId: "logic-collision",
          label: "Fake Collision",
          capabilityType: "logic-analyzer",
          connectionState: "connected",
          allocationState: "free",
          ownerSkillId: null,
          lastSeenAt: connectedAt,
          updatedAt: connectedAt,
          readiness: "degraded",
          diagnostics: [
            {
              code: "backend-runtime-timeout",
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
          backendKind: "fake",
          readiness: "ready",
          version: null,
          checkedAt: connectedAt,
          diagnostics: []
        }
      ],
      diagnostics: []
    };

    const manager = createResourceManager(
      [
        {
          providerId: "dslogic-runtime",
          provider: new FakeDeviceProvider(dslogicSnapshot)
        },
        {
          providerId: "fake-runtime",
          provider: new FakeDeviceProvider(fakeSnapshot)
        }
      ],
      {
        now: createClock(connectedAt)
      }
    );

    const snapshot = await manager.refreshInventorySnapshot();

    expect(snapshot.refreshedAt).toBe(connectedAt);
    expect(snapshot.inventoryScope).toEqual({
      providerKinds: ["dslogic", "fake"],
      backendKinds: ["dsview-cli", "fake"]
    });
    expect(snapshot.devices.map((device) => device.canonicalIdentity?.canonicalKey)).toEqual([
      "dslogic:collision-001",
      "fake:collision-001"
    ]);
    expect(snapshot.backendReadiness).toEqual([
      ...dslogicSnapshot.backendReadiness,
      ...fakeSnapshot.backendReadiness
    ]);
    expect(snapshot.diagnostics).toEqual(dslogicSnapshot.diagnostics);
  });

  it("keeps allocation ownership centralized across aggregated provider refreshes", async () => {
    const dslogicProvider = new FakeDeviceProvider([
      {
        deviceId: "logic-1",
        label: "DSLogic One",
        capabilityType: "logic-analyzer",
        lastSeenAt: connectedAt
      }
    ]);
    const fakeProvider = new FakeDeviceProvider([
      {
        deviceId: "logic-2",
        label: "Fake Two",
        capabilityType: "logic-analyzer",
        lastSeenAt: connectedAt
      }
    ]);
    const manager = createResourceManager(
      [
        { providerId: "dslogic-runtime", provider: dslogicProvider },
        { providerId: "fake-runtime", provider: fakeProvider }
      ],
      {
        now: createClock(connectedAt, disconnectAt)
      }
    );

    await manager.refreshInventorySnapshot();
    await manager.allocateDevice({
      deviceId: "logic-1",
      ownerSkillId: "skill-alpha",
      requestedAt: allocateAt
    });

    dslogicProvider.setInventorySnapshot({
      refreshedAt: disconnectAt,
      inventoryScope: {
        providerKinds: ["dslogic"],
        backendKinds: ["fake"]
      },
      devices: [],
      backendReadiness: [],
      diagnostics: []
    });

    const refreshed = await manager.refreshInventory();

    expect(refreshed).toEqual([
      {
        deviceId: "logic-1",
        label: "DSLogic One",
        capabilityType: "logic-analyzer",
        connectionState: "disconnected",
        allocationState: "allocated",
        ownerSkillId: "skill-alpha",
        lastSeenAt: connectedAt,
        updatedAt: disconnectAt,
        ...baseInventoryFields
      },
      {
        deviceId: "logic-2",
        label: "Fake Two",
        capabilityType: "logic-analyzer",
        connectionState: "connected",
        allocationState: "free",
        ownerSkillId: null,
        lastSeenAt: connectedAt,
        updatedAt: disconnectAt,
        ...baseInventoryFields
      }
    ]);

    const release = await manager.releaseDevice({
      deviceId: "logic-1",
      ownerSkillId: "skill-alpha",
      releasedAt: releaseAt
    });

    expect(release).toEqual({
      ok: true,
      device: {
        deviceId: "logic-1",
        label: "DSLogic One",
        capabilityType: "logic-analyzer",
        connectionState: "disconnected",
        allocationState: "free",
        ownerSkillId: null,
        lastSeenAt: connectedAt,
        updatedAt: releaseAt,
        ...baseInventoryFields
      }
    });
    expect(await manager.listDevices()).toEqual([
      {
        deviceId: "logic-2",
        label: "Fake Two",
        capabilityType: "logic-analyzer",
        connectionState: "connected",
        allocationState: "free",
        ownerSkillId: null,
        lastSeenAt: connectedAt,
        updatedAt: disconnectAt,
        ...baseInventoryFields
      }
    ]);
  });

  it("preserves DSLogic diagnostics for non-ready rows when allocation overlays refresh the snapshot", async () => {
    const snapshot: InventorySnapshot = {
      refreshedAt: connectedAt,
      inventoryScope: {
        providerKinds: ["dslogic"],
        backendKinds: ["dsview-cli"]
      },
      devices: [
        {
          deviceId: "logic-ready",
          label: "DSLogic Plus Ready",
          capabilityType: "logic-analyzer",
          connectionState: "connected",
          allocationState: "free",
          ownerSkillId: null,
          lastSeenAt: connectedAt,
          updatedAt: connectedAt,
          readiness: "ready",
          diagnostics: [],
          providerKind: "dslogic",
          backendKind: "dsview-cli",
          dslogic: null
        },
        {
          deviceId: "logic-degraded",
          label: "DSLogic Plus Waiting For Backend",
          capabilityType: "logic-analyzer",
          connectionState: "connected",
          allocationState: "free",
          ownerSkillId: null,
          lastSeenAt: connectedAt,
          updatedAt: connectedAt,
          readiness: "degraded",
          diagnostics: [
            {
              code: "backend-runtime-timeout",
              severity: "warning",
              target: "device",
              message: "Backend probe timed out before capabilities were confirmed.",
              deviceId: "logic-degraded",
              backendKind: "dsview-cli"
            }
          ],
          providerKind: "dslogic",
          backendKind: "dsview-cli",
          dslogic: null
        },
        {
          deviceId: "logic-unsupported",
          label: "DSLogic V421/Pango",
          capabilityType: "logic-analyzer",
          connectionState: "connected",
          allocationState: "free",
          ownerSkillId: null,
          lastSeenAt: connectedAt,
          updatedAt: connectedAt,
          readiness: "unsupported",
          diagnostics: [
            {
              code: "device-unsupported-variant",
              severity: "error",
              target: "device",
              message: "Variant V421/Pango is not supported.",
              deviceId: "logic-unsupported",
              backendKind: "dsview-cli"
            }
          ],
          providerKind: "dslogic",
          backendKind: "dsview-cli",
          dslogic: null
        }
      ],
      backendReadiness: [
        {
          platform: "macos",
          backendKind: "dsview-cli",
          readiness: "degraded",
          version: null,
          checkedAt: connectedAt,
          diagnostics: [
            {
              code: "backend-runtime-timeout",
              severity: "warning",
              target: "backend",
              message: "dsview-cli runtime probe timed out before readiness was confirmed on macos.",
              platform: "macos",
              backendKind: "dsview-cli"
            }
          ]
        }
      ],
      diagnostics: [
        {
          code: "backend-runtime-timeout",
          severity: "warning",
          target: "backend",
          message: "dsview-cli runtime probe timed out before readiness was confirmed on macos.",
          platform: "macos",
          backendKind: "dsview-cli"
        }
      ]
    };

    const provider = new FakeDeviceProvider(snapshot);
    const manager = createResourceManager(provider, {
      now: createClock(connectedAt, disconnectAt)
    });

    await manager.refreshInventorySnapshot();
    await manager.allocateDevice({
      deviceId: "logic-ready",
      ownerSkillId: "skill-alpha",
      requestedAt: allocateAt
    });

    const refreshedSnapshot = await manager.refreshInventorySnapshot();
    const readyDevice = refreshedSnapshot.devices.find((device) => device.deviceId === "logic-ready");
    const degradedDevice = refreshedSnapshot.devices.find((device) => device.deviceId === "logic-degraded");
    const unsupportedDevice = refreshedSnapshot.devices.find((device) => device.deviceId === "logic-unsupported");

    expect(readyDevice).toMatchObject({
      allocationState: "allocated",
      ownerSkillId: "skill-alpha",
      updatedAt: disconnectAt,
      diagnostics: []
    });
    expect(degradedDevice).toEqual(snapshot.devices[1]);
    expect(unsupportedDevice).toEqual(snapshot.devices[2]);
    expect(refreshedSnapshot.backendReadiness).toEqual(snapshot.backendReadiness);
    expect(refreshedSnapshot.diagnostics).toEqual(snapshot.diagnostics);
  });
});



describe("in-memory resource manager device-options dispatch", () => {
  const refreshedAt = "2026-03-31T10:00:00.000Z";
  const requestedAt = "2026-03-31T10:00:05.000Z";
  const allocatedAt = "2026-03-31T10:00:06.000Z";

  const createDslogicSnapshot = (): InventorySnapshot => ({
    refreshedAt,
    inventoryScope: {
      providerKinds: ["dslogic"],
      backendKinds: ["dsview-cli"]
    },
    devices: [
      {
        deviceId: "logic-1",
        label: "DSLogic Plus",
        capabilityType: "logic-analyzer",
        connectionState: "connected",
        allocationState: "free",
        ownerSkillId: null,
        lastSeenAt: refreshedAt,
        updatedAt: refreshedAt,
        readiness: "ready",
        diagnostics: [],
        providerKind: "dslogic",
        backendKind: "dsview-cli",
        dslogic: {
          family: "dslogic",
          model: "dslogic-plus",
          modelDisplayName: "DSLogic Plus",
          variant: "classic",
          usbVendorId: "2a0e",
          usbProductId: "0001"
        }
      }
    ],
    backendReadiness: [
      {
        platform: "macos",
        backendKind: "dsview-cli",
        readiness: "ready",
        version: "1.2.2",
        checkedAt: refreshedAt,
        diagnostics: []
      }
    ],
    diagnostics: []
  });

  const createOptionsRequest = (
    snapshot: InventorySnapshot,
    ownerSkillId = "skill-alpha"
  ): DeviceOptionsRequest => ({
    session: {
      sessionId: "session-1",
      deviceId: "logic-1",
      ownerSkillId,
      startedAt: refreshedAt,
      device: {
        ...snapshot.devices[0]!,
        allocationState: "free",
        ownerSkillId: null
      },
      sampling: {
        sampleRateHz: 1_000_000,
        captureDurationMs: 10,
        channels: [
          {
            channelId: "D0",
            label: "Channel 0"
          }
        ]
      }
    },
    requestedAt
  });

  it("delegates options lookup through a provider-dispatched seam with the authoritative session device", async () => {
    const snapshot = createDslogicSnapshot();
    let capturedRequest = null as Parameters<SnapshotResourceManager["inspectDeviceOptions"]>[0] | null;
    const provider: DeviceProvider = {
      async listInventorySnapshot() {
        return snapshot;
      },
      async listConnectedDevices() {
        return [];
      },
      deviceOptions: {
        supportsDevice(device: DeviceRecord) {
          return device.providerKind === "dslogic" && device.backendKind === "dsview-cli";
        },
        async inspectDeviceOptions(
          request: Parameters<SnapshotResourceManager["inspectDeviceOptions"]>[0]
        ): Promise<DeviceOptionsResult> {
          capturedRequest = request;
          return {
            ok: true,
            providerKind: "dslogic",
            backendKind: "dsview-cli",
            session: request.session,
            requestedAt: request.requestedAt,
            capabilities: {
              operations: [{ token: "collect", label: "Collect" }],
              channels: [{ token: "D0", label: "Channel 0" }],
              stopConditions: [{ token: "samples=1000" }],
              filters: [{ token: "none" }],
              thresholds: [{ token: "1.8v" }]
            }
          };
        }
      }
    };
    const manager = createResourceManager(provider, {
      now: () => refreshedAt
    });
    const request = createOptionsRequest(snapshot);

    await manager.refreshInventory();
    await manager.allocateDevice({
      deviceId: "logic-1",
      ownerSkillId: "skill-alpha",
      requestedAt: allocatedAt
    });

    const result = await manager.inspectDeviceOptions(request);

    expect(result).toMatchObject({
      ok: true,
      providerKind: "dslogic",
      backendKind: "dsview-cli",
      capabilities: {
        operations: [{ token: "collect", label: "Collect" }]
      }
    });
    expect(capturedRequest?.session.device.allocationState).toBe("allocated");
    expect(capturedRequest?.session.device.ownerSkillId).toBe("skill-alpha");
    expect(capturedRequest?.session.device.updatedAt).toBe(allocatedAt);
  });

  it("rejects unknown devices before dispatching to an options provider", async () => {
    const snapshot = createDslogicSnapshot();
    let dispatched = false;
    const provider: DeviceProvider = {
      async listInventorySnapshot() {
        return snapshot;
      },
      async listConnectedDevices() {
        return [];
      },
      deviceOptions: {
        supportsDevice() {
          return true;
        },
        async inspectDeviceOptions(): Promise<DeviceOptionsResult> {
          dispatched = true;
          throw new Error("unexpected dispatch");
        }
      }
    };
    const manager = createResourceManager(provider, {
      now: () => refreshedAt
    });
    const request: DeviceOptionsRequest = {
      ...createOptionsRequest(snapshot),
      session: {
        ...createOptionsRequest(snapshot).session,
        deviceId: "missing-logic",
        device: {
          ...snapshot.devices[0]!,
          deviceId: "missing-logic"
        }
      }
    };

    await manager.refreshInventory();

    await expect(manager.inspectDeviceOptions(request)).resolves.toMatchObject({
      ok: false,
      reason: "device-options-failed",
      kind: "device-not-found",
      diagnostics: {
        phase: "validate-session",
        providerKind: "dslogic",
        backendKind: "dsview-cli"
      }
    });
    expect(dispatched).toBe(false);
  });

  it("rejects wrong-owner options requests before dispatching to an options provider", async () => {
    const snapshot = createDslogicSnapshot();
    let dispatched = false;
    const provider: DeviceProvider = {
      async listInventorySnapshot() {
        return snapshot;
      },
      async listConnectedDevices() {
        return [];
      },
      deviceOptions: {
        supportsDevice() {
          return true;
        },
        async inspectDeviceOptions(): Promise<DeviceOptionsResult> {
          dispatched = true;
          throw new Error("unexpected dispatch");
        }
      }
    };
    const manager = createResourceManager(provider, {
      now: () => refreshedAt
    });

    await manager.refreshInventory();
    await manager.allocateDevice({
      deviceId: "logic-1",
      ownerSkillId: "skill-alpha",
      requestedAt: allocatedAt
    });

    await expect(manager.inspectDeviceOptions(createOptionsRequest(snapshot, "skill-beta"))).resolves.toMatchObject({
      ok: false,
      reason: "device-options-failed",
      kind: "owner-mismatch",
      diagnostics: {
        phase: "validate-session",
        providerKind: "dslogic",
        backendKind: "dsview-cli",
        details: [
          "Authoritative owner is skill-alpha.",
          "Option inspection requests must use the currently allocated owner for the accepted session."
        ]
      }
    });
    expect(dispatched).toBe(false);
  });

  it("returns an explicit unsupported-runtime failure for fake-provider options requests", async () => {
    const snapshot: InventorySnapshot = {
      refreshedAt,
      inventoryScope: {
        providerKinds: ["fake"],
        backendKinds: ["fake"]
      },
      devices: [
        {
          deviceId: "fake-1",
          label: "Fake logic analyzer",
          capabilityType: "logic-analyzer",
          connectionState: "connected",
          allocationState: "free",
          ownerSkillId: null,
          lastSeenAt: refreshedAt,
          updatedAt: refreshedAt,
          readiness: "ready",
          diagnostics: [],
          providerKind: "fake",
          backendKind: "fake",
          dslogic: null
        }
      ],
      backendReadiness: [],
      diagnostics: []
    };
    const provider = new FakeDeviceProvider(snapshot);
    const manager = createResourceManager(provider, {
      now: () => refreshedAt
    });
    const request: DeviceOptionsRequest = {
      ...createOptionsRequest(snapshot),
      session: {
        ...createOptionsRequest(snapshot).session,
        sessionId: "session-fake-1",
        deviceId: "fake-1",
        device: {
          ...snapshot.devices[0]!,
          allocationState: "free",
          ownerSkillId: null
        }
      }
    };

    await manager.refreshInventory();
    await manager.allocateDevice({
      deviceId: "fake-1",
      ownerSkillId: "skill-alpha",
      requestedAt: allocatedAt
    });

    await expect(manager.inspectDeviceOptions(request)).resolves.toMatchObject({
      ok: false,
      reason: "device-options-failed",
      kind: "unsupported-runtime",
      message: "Device options are not supported by the fake provider/backend.",
      diagnostics: {
        phase: "validate-session",
        providerKind: "fake",
        backendKind: "fake",
        details: [
          "Fake provider inventory can drive allocation flows but does not implement device-options inspection.",
          "Use the DSLogic provider/backend to exercise real device-options lookup."
        ]
      }
    });
  });

  it("wraps thrown options-provider failures as typed diagnostics", async () => {
    const snapshot = createDslogicSnapshot();
    const provider: DeviceProvider = {
      async listInventorySnapshot() {
        return snapshot;
      },
      async listConnectedDevices() {
        return [];
      },
      deviceOptions: {
        supportsDevice(device: DeviceRecord) {
          return device.providerKind === "dslogic" && device.backendKind === "dsview-cli";
        },
        async inspectDeviceOptions(): Promise<DeviceOptionsResult> {
          throw new Error("native options command failed");
        }
      }
    };
    const manager = createResourceManager(provider, {
      now: () => refreshedAt
    });

    await manager.refreshInventory();
    await manager.allocateDevice({
      deviceId: "logic-1",
      ownerSkillId: "skill-alpha",
      requestedAt: allocatedAt
    });

    await expect(manager.inspectDeviceOptions(createOptionsRequest(snapshot))).resolves.toMatchObject({
      ok: false,
      reason: "device-options-failed",
      kind: "native-error",
      message: "Device options provider failed while inspecting device logic-1.",
      diagnostics: {
        phase: "inspect-options",
        providerKind: "dslogic",
        backendKind: "dsview-cli",
        details: [
          "Device-options provider threw during inspection dispatch.",
          "native options command failed"
        ]
      }
    });
  });
});

describe("in-memory resource manager decoder orchestration", () => {
  const refreshedAt = "2026-04-01T10:00:00.000Z";
  const requestedAt = "2026-04-01T10:00:05.000Z";
  const allocatedAt = "2026-04-01T10:00:06.000Z";

  interface DecoderCapabilityProvider {
    supportsDevice(device: DeviceRecord): boolean;
    listDecoderCapabilities(request: DecoderCapabilitiesRequest): Promise<DecoderCapabilitiesResult>;
  }

  interface CaptureDecodeProvider {
    supportsDevice(device: DeviceRecord): boolean;
    captureDecode(request: CaptureDecodeRequest): Promise<CaptureDecodeResult>;
  }

  type FutureDecoderDeviceProvider = DeviceProvider & {
    decoderCapabilities?: DecoderCapabilityProvider;
    captureDecode?: CaptureDecodeProvider;
  };

  const createDslogicSnapshot = (): InventorySnapshot => ({
    refreshedAt,
    inventoryScope: {
      providerKinds: ["dslogic"],
      backendKinds: ["dsview-cli"]
    },
    devices: [
      {
        deviceId: "logic-1",
        label: "DSLogic Plus",
        capabilityType: "logic-analyzer",
        connectionState: "connected",
        allocationState: "free",
        ownerSkillId: null,
        lastSeenAt: refreshedAt,
        updatedAt: refreshedAt,
        readiness: "ready",
        diagnostics: [],
        providerKind: "dslogic",
        backendKind: "dsview-cli",
        dslogic: {
          family: "dslogic",
          model: "dslogic-plus",
          modelDisplayName: "DSLogic Plus",
          variant: "classic",
          usbVendorId: "2a0e",
          usbProductId: "0001"
        }
      }
    ],
    backendReadiness: [
      {
        platform: "macos",
        backendKind: "dsview-cli",
        readiness: "ready",
        version: "1.2.2",
        checkedAt: refreshedAt,
        diagnostics: []
      }
    ],
    diagnostics: []
  });

  const createCaptureDecodeRequest = (
    snapshot: InventorySnapshot,
    decoderId = "1:uart"
  ): CaptureDecodeRequest => ({
    session: {
      sessionId: "session-decode-1",
      deviceId: "logic-1",
      ownerSkillId: "skill-alpha",
      startedAt: refreshedAt,
      device: {
        ...snapshot.devices[0]!,
        allocationState: "free",
        ownerSkillId: null
      },
      sampling: {
        sampleRateHz: 1_000_000,
        captureDurationMs: 10,
        channels: [{ channelId: "D0", label: "RX" }]
      }
    },
    requestedAt,
    timeoutMs: 15000,
    decode: {
      decoderId,
      channelMappings: { rx: "D0" },
      decoderOptions: { baudrate: 921600 }
    }
  });

  it("delegates decoder capability lookup through a provider-dispatched seam", async () => {
    const snapshot = createDslogicSnapshot();
    let supportedDevice = null as DeviceRecord | null;
    let capturedRequest = null as DecoderCapabilitiesRequest | null;
    const provider: FutureDecoderDeviceProvider = {
      async listInventorySnapshot() {
        return snapshot;
      },
      async listConnectedDevices() {
        return [];
      },
      decoderCapabilities: {
        supportsDevice(device) {
          supportedDevice = device;
          return device.providerKind === "dslogic" && device.backendKind === "dsview-cli";
        },
        async listDecoderCapabilities(request) {
          capturedRequest = request;
          return {
            ok: true,
            providerKind: "dslogic",
            backendKind: "dsview-cli",
            backendVersion: "1.2.2",
            deviceId: request.deviceId,
            requestedAt: request.requestedAt,
            decoders: [
              {
                decoderId: "1:uart",
                label: "UART",
                requiredChannels: [{ id: "rx", label: "RX" }],
                optionalChannels: [],
                options: [
                  {
                    id: "baudrate",
                    label: "Baud rate",
                    valueType: "number",
                    required: true,
                    values: [921600]
                  }
                ]
              }
            ]
          };
        }
      }
    };
    const manager = createResourceManager(provider, {
      now: () => refreshedAt
    });

    await manager.refreshInventory();

    const result = await manager.listDecoderCapabilities({
      deviceId: "logic-1",
      requestedAt,
      timeoutMs: 15000
    });

    expect(result).toEqual({
      ok: true,
      providerKind: "dslogic",
      backendKind: "dsview-cli",
      backendVersion: "1.2.2",
      deviceId: "logic-1",
      requestedAt,
      decoders: [
        {
          decoderId: "1:uart",
          label: "UART",
          requiredChannels: [{ id: "rx", label: "RX" }],
          optionalChannels: [],
          options: [
            {
              id: "baudrate",
              label: "Baud rate",
              valueType: "number",
              required: true,
              values: [921600]
            }
          ]
        }
      ]
    });
    expect(supportedDevice).toMatchObject({
      deviceId: "logic-1",
      providerKind: "dslogic",
      backendKind: "dsview-cli"
    });
    expect(capturedRequest).toEqual({
      deviceId: "logic-1",
      requestedAt,
      timeoutMs: 15000
    });
  });

  it("runs capture and decode through the authoritative allocated session", async () => {
    const snapshot = createDslogicSnapshot();
    let capturedRequest = null as CaptureDecodeRequest | null;
    const provider: FutureDecoderDeviceProvider = {
      async listInventorySnapshot() {
        return snapshot;
      },
      async listConnectedDevices() {
        return [];
      },
      captureDecode: {
        supportsDevice(device) {
          return device.providerKind === "dslogic" && device.backendKind === "dsview-cli";
        },
        async captureDecode(request) {
          capturedRequest = request;
          return {
            ok: true,
            providerKind: "dslogic",
            backendKind: "dsview-cli",
            session: request.session,
            requestedAt: request.requestedAt,
            artifactSummary: {
              sourceName: "logic-1.sr",
              formatHint: "dsview-session",
              mediaType: "application/vnd.sigrok.session",
              capturedAt: requestedAt,
              byteLength: 128,
              textLength: null,
              hasText: false
            },
            auxiliaryArtifactSummaries: [
              {
                sourceName: "logic-1.decode.json",
                formatHint: "protocol-decode-report",
                mediaType: "application/json",
                capturedAt: requestedAt,
                byteLength: null,
                textLength: 96,
                hasText: true
              }
            ],
            decode: {
              decoderId: "1:uart",
              annotations: [{ startSample: 0, endSample: 8, kind: "frame" }],
              rows: [{ startSample: 0, endSample: 8, data: "A" }],
              raw: { text: "A", bytes: [65], decoderId: "1:uart", rows: 1 }
            }
          };
        }
      }
    };
    const manager = createResourceManager(provider, {
      now: () => refreshedAt
    });
    const request = createCaptureDecodeRequest(snapshot);

    await manager.refreshInventory();
    await manager.allocateDevice({
      deviceId: "logic-1",
      ownerSkillId: "skill-alpha",
      requestedAt: allocatedAt
    });

    const result = await manager.captureDecode(request);

    expect(result).toMatchObject({
      ok: true,
      providerKind: "dslogic",
      backendKind: "dsview-cli",
      decode: {
        decoderId: "1:uart",
        rows: [{ startSample: 0, endSample: 8, data: "A" }]
      }
    });
    expect(capturedRequest?.session.device.allocationState).toBe("allocated");
    expect(capturedRequest?.session.device.ownerSkillId).toBe("skill-alpha");
    expect(capturedRequest?.session.device.updatedAt).toBe(allocatedAt);
    expect(capturedRequest?.decode).toEqual({
      decoderId: "1:uart",
      channelMappings: { rx: "D0" },
      decoderOptions: { baudrate: 921600 }
    });
  });

  it("returns typed decode-validation diagnostics when the requested decoder is unavailable", async () => {
    const snapshot = createDslogicSnapshot();
    let dispatched = false;
    const provider: FutureDecoderDeviceProvider = {
      async listInventorySnapshot() {
        return snapshot;
      },
      async listConnectedDevices() {
        return [];
      },
      decoderCapabilities: {
        supportsDevice() {
          return true;
        },
        async listDecoderCapabilities(request) {
          return {
            ok: true,
            providerKind: "dslogic",
            backendKind: "dsview-cli",
            backendVersion: "1.2.2",
            deviceId: request.deviceId,
            requestedAt: request.requestedAt,
            decoders: [
              {
                decoderId: "1:uart",
                label: "UART",
                requiredChannels: [{ id: "rx", label: "RX" }],
                optionalChannels: [],
                options: []
              }
            ]
          };
        }
      },
      captureDecode: {
        supportsDevice() {
          return true;
        },
        async captureDecode() {
          dispatched = true;
          throw new Error("unexpected decode dispatch");
        }
      }
    };
    const manager = createResourceManager(provider, {
      now: () => refreshedAt
    });
    const request = createCaptureDecodeRequest(snapshot, "2:i2c");

    await manager.refreshInventory();
    await manager.allocateDevice({
      deviceId: "logic-1",
      ownerSkillId: "skill-alpha",
      requestedAt: allocatedAt
    });

    await expect(manager.captureDecode(request)).resolves.toMatchObject({
      ok: false,
      reason: "capture-decode-failed",
      kind: "decode-failed",
      message: "Decoder 2:i2c is not available for device logic-1.",
      artifactSummary: null,
      decode: null,
      diagnostics: {
        phase: "decode-validation",
        providerKind: "dslogic",
        backendKind: "dsview-cli",
        details: [
          "Available decoder ids: 1:uart.",
          "Requested channel mapping rx -> D0 and baudrate 921600."
        ]
      }
    });
    expect(dispatched).toBe(false);
  });
});

describe("in-memory resource manager live capture dispatch", () => {
  const refreshedAt = "2026-03-30T10:00:00.000Z";
  const requestedAt = "2026-03-30T10:00:05.000Z";
  const allocatedAt = "2026-03-30T10:00:06.000Z";

  const createDslogicSnapshot = (): InventorySnapshot => ({
    refreshedAt,
    inventoryScope: {
      providerKinds: ["dslogic"],
      backendKinds: ["dsview-cli"]
    },
    devices: [
      {
        deviceId: "logic-1",
        label: "DSLogic Plus",
        capabilityType: "logic-analyzer",
        connectionState: "connected",
        allocationState: "free",
        ownerSkillId: null,
        lastSeenAt: refreshedAt,
        updatedAt: refreshedAt,
        readiness: "ready",
        diagnostics: [],
        providerKind: "dslogic",
        backendKind: "dsview-cli",
        dslogic: {
          family: "dslogic",
          model: "dslogic-plus",
          modelDisplayName: "DSLogic Plus",
          variant: "classic",
          usbVendorId: "2a0e",
          usbProductId: "0001"
        }
      }
    ],
    backendReadiness: [
      {
        platform: "macos",
        backendKind: "dsview-cli",
        readiness: "ready",
        version: "1.2.2",
        checkedAt: refreshedAt,
        diagnostics: []
      }
    ],
    diagnostics: []
  });

  const createAcceptedRequest = (snapshot: InventorySnapshot) =>
    createLiveCaptureRequest(
      {
        sessionId: "session-1",
        deviceId: "logic-1",
        ownerSkillId: "skill-alpha",
        startedAt: refreshedAt,
        device: {
          ...snapshot.devices[0]!,
          allocationState: "free",
          ownerSkillId: null
        },
        sampling: {
          sampleRateHz: 1_000_000,
          captureDurationMs: 10,
          channels: [
            {
              channelId: "D0",
              label: "Channel 0"
            },
            {
              channelId: "D1",
              label: "Channel 1"
            }
          ]
        }
      },
      {
        requestedAt
      }
    );

  it("delegates live capture through a provider-dispatched seam", async () => {
    const snapshot = createDslogicSnapshot();
    let capturedRequest = null as Parameters<
      NonNullable<SnapshotResourceManager["liveCapture"]>
    >[0] | null;
    const provider: DeviceProvider = {
      async listInventorySnapshot() {
        return snapshot;
      },
      async listConnectedDevices() {
        return [];
      },
      liveCapture: {
        supportsDevice(device: DeviceRecord) {
          return device.providerKind === "dslogic" && device.backendKind === "dsview-cli";
        },
        async liveCapture(
          request: Parameters<NonNullable<SnapshotResourceManager["liveCapture"]>>[0]
        ): Promise<LiveCaptureResult> {
          capturedRequest = request;
          return {
            ok: true,
            providerKind: "dslogic",
            backendKind: "dsview-cli",
            session: request.session,
            requestedAt: request.requestedAt,
            artifact: {
              sourceName: "logic-1.csv",
              formatHint: "sigrok-csv",
              mediaType: "text/csv",
              text: "Time [us],D0,D1\n0,0,1\n"
            },
            artifactSummary: {
              sourceName: "logic-1.csv",
              formatHint: "sigrok-csv",
              mediaType: "text/csv",
              capturedAt: null,
              byteLength: null,
              textLength: 24,
              hasText: true
            }
          };
        }
      }
    };
    const manager = createResourceManager(provider, {
      now: () => refreshedAt
    });
    const request = createAcceptedRequest(snapshot);

    await manager.refreshInventory();
    await manager.allocateDevice({
      deviceId: "logic-1",
      ownerSkillId: "skill-alpha",
      requestedAt: allocatedAt
    });

    const result = await manager.liveCapture(request);

    expect(result).toMatchObject({
      ok: true,
      providerKind: "dslogic",
      backendKind: "dsview-cli"
    });
    expect(capturedRequest?.session.device.allocationState).toBe("allocated");
    expect(capturedRequest?.session.device.ownerSkillId).toBe("skill-alpha");
    expect(capturedRequest?.session.device.updatedAt).toBe(allocatedAt);
  });

  it("names the responsible provider and backend when no live-capture handler is registered", async () => {
    const snapshot = createDslogicSnapshot();
    const provider = new FakeDeviceProvider(snapshot);
    const manager = createResourceManager(provider, {
      now: () => refreshedAt
    });
    const request = createAcceptedRequest(snapshot);

    await manager.refreshInventory();
    await manager.allocateDevice({
      deviceId: "logic-1",
      ownerSkillId: "skill-alpha",
      requestedAt: allocatedAt
    });

    const result = await manager.liveCapture(request);

    expect(result).toMatchObject({
      ok: false,
      reason: "capture-failed",
      kind: "unsupported-runtime",
      diagnostics: {
        phase: "validate-session",
        providerKind: "dslogic",
        backendKind: "dsview-cli"
      }
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("provider dslogic");
      expect(result.message).toContain("backend dsview-cli");
      expect(result.diagnostics.details).toEqual([
        "No registered live-capture provider accepted provider dslogic.",
        "No registered live-capture provider accepted backend dsview-cli.",
        "Configure a provider-specific live-capture handler for the authoritative device runtime."
      ]);
    }
  });

  it("returns an explicit unsupported-runtime failure for fake-provider capture requests", async () => {
    const snapshot: InventorySnapshot = {
      refreshedAt,
      inventoryScope: {
        providerKinds: ["fake"],
        backendKinds: ["fake"]
      },
      devices: [
        {
          deviceId: "fake-1",
          label: "Fake logic analyzer",
          capabilityType: "logic-analyzer",
          connectionState: "connected",
          allocationState: "free",
          ownerSkillId: null,
          lastSeenAt: refreshedAt,
          updatedAt: refreshedAt,
          readiness: "ready",
          diagnostics: [],
          providerKind: "fake",
          backendKind: "fake",
          dslogic: null
        }
      ],
      backendReadiness: [],
      diagnostics: []
    };
    const provider = new FakeDeviceProvider(snapshot);
    const manager = createResourceManager(provider, {
      now: () => refreshedAt
    });
    const request = createLiveCaptureRequest(
      {
        sessionId: "session-fake-1",
        deviceId: "fake-1",
        ownerSkillId: "skill-alpha",
        startedAt: refreshedAt,
        device: {
          ...snapshot.devices[0]!,
          allocationState: "free",
          ownerSkillId: null
        },
        sampling: {
          sampleRateHz: 1_000_000,
          captureDurationMs: 10,
          channels: [
            {
              channelId: "D0",
              label: "Channel 0"
            }
          ]
        }
      },
      {
        requestedAt
      }
    );

    await manager.refreshInventory();
    await manager.allocateDevice({
      deviceId: "fake-1",
      ownerSkillId: "skill-alpha",
      requestedAt: allocatedAt
    });

    await expect(manager.liveCapture(request)).resolves.toMatchObject({
      ok: false,
      reason: "capture-failed",
      kind: "unsupported-runtime",
      message: "Live capture is not supported by the fake provider/backend.",
      diagnostics: {
        phase: "validate-session",
        providerKind: "fake",
        backendKind: "fake",
        details: [
          "Fake provider inventory can drive allocation flows but does not implement live capture.",
          "Use the DSLogic provider/backend to exercise real live capture."
        ]
      }
    });
  });

  it("keeps the legacy DSLogic runner option working through the provider seam", async () => {
    const snapshot = createDslogicSnapshot();
    const provider = new FakeDeviceProvider(snapshot);
    const manager = createResourceManager(provider, {
      now: () => refreshedAt,
      liveCaptureRunner: createDslogicLiveCaptureRunner(async () => ({
        ok: true,
        artifact: {
          sourceName: "logic-1.csv",
          formatHint: "sigrok-csv",
          mediaType: "text/csv",
          text: "Time [us],D0,D1\n0,0,1\n"
        }
      }))
    });
    const request = createAcceptedRequest(snapshot);

    await manager.refreshInventory();
    await manager.allocateDevice({
      deviceId: "logic-1",
      ownerSkillId: "skill-alpha",
      requestedAt: allocatedAt
    });

    await expect(manager.liveCapture(request)).resolves.toMatchObject({
      ok: true,
      providerKind: "dslogic",
      backendKind: "dsview-cli"
    });
  });
});
