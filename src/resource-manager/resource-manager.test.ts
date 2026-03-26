import { describe, expect, expectTypeOf, it } from "vitest";

import {
  ALLOCATION_FAILURE_REASONS,
  ALLOCATION_STATES,
  CONNECTION_STATES,
  RELEASE_FAILURE_REASONS,
  FakeDeviceProvider,
  type AllocationFailure,
  type AllocationRequest,
  type AllocationResult,
  type DeviceRecord,
  type ReleaseFailure,
  type ReleaseRequest,
  type ReleaseResult,
  createResourceManager
} from "../index.js";

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
      updatedAt: "2026-03-25T12:00:00.000Z"
    };

    expect(record).toEqual({
      deviceId: "logic-1",
      label: "USB Logic Analyzer",
      capabilityType: "logic-analyzer",
      connectionState: "connected",
      allocationState: "free",
      ownerSkillId: null,
      lastSeenAt: "2026-03-25T12:00:00.000Z",
      updatedAt: "2026-03-25T12:00:00.000Z"
    });
  });

  it("defines explicit allocation and release failure reasons", () => {
    expect(ALLOCATION_FAILURE_REASONS).toEqual([
      "device-not-found",
      "device-disconnected",
      "device-already-allocated"
    ]);
    expect(RELEASE_FAILURE_REASONS).toEqual([
      "device-not-found",
      "device-not-allocated",
      "owner-mismatch"
    ]);
    expect(CONNECTION_STATES).toEqual(["connected", "disconnected"]);
    expect(ALLOCATION_STATES).toEqual(["free", "allocated"]);
  });

  it("keeps request and result contracts discriminated by ok", () => {
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
        updatedAt: connectedAt
      }
    ]);
    expect(manager.listDevices()).toEqual(records);
  });

  it("transitions a connected device from free to allocated to free", async () => {
    const provider = new FakeDeviceProvider([baseDevice]);
    const manager = createResourceManager(provider, {
      now: createClock(connectedAt)
    });

    await manager.refreshInventory();

    const allocation = manager.allocateDevice({
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
        updatedAt: allocateAt
      }
    });

    const release = manager.releaseDevice({
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
        updatedAt: releaseAt
      }
    });
    expect(manager.listDevices()).toEqual([
      {
        deviceId: "logic-1",
        label: "USB Logic Analyzer",
        capabilityType: "logic-analyzer",
        connectionState: "connected",
        allocationState: "free",
        ownerSkillId: null,
        lastSeenAt: connectedAt,
        updatedAt: releaseAt
      }
    ]);
  });

  it("rejects conflicting allocation requests with the owning state still visible", async () => {
    const provider = new FakeDeviceProvider([baseDevice]);
    const manager = createResourceManager(provider, {
      now: createClock(connectedAt)
    });

    await manager.refreshInventory();

    const firstAllocation = manager.allocateDevice({
      deviceId: "logic-1",
      ownerSkillId: "skill-alpha",
      requestedAt: allocateAt
    });
    const conflictingAllocation = manager.allocateDevice({
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
        updatedAt: allocateAt
      });
    }

    expect(manager.listDevices()).toEqual([
      {
        deviceId: "logic-1",
        label: "USB Logic Analyzer",
        capabilityType: "logic-analyzer",
        connectionState: "connected",
        allocationState: "allocated",
        ownerSkillId: "skill-alpha",
        lastSeenAt: connectedAt,
        updatedAt: allocateAt
      }
    ]);
  });

  it("rejects wrong-owner release attempts without hiding the current allocation", async () => {
    const provider = new FakeDeviceProvider([baseDevice]);
    const manager = createResourceManager(provider, {
      now: createClock(connectedAt)
    });

    await manager.refreshInventory();
    manager.allocateDevice({
      deviceId: "logic-1",
      ownerSkillId: "skill-alpha",
      requestedAt: allocateAt
    });

    const releaseResult = manager.releaseDevice({
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
        updatedAt: allocateAt
      });
    }

    expect(manager.listDevices()).toEqual([
      {
        deviceId: "logic-1",
        label: "USB Logic Analyzer",
        capabilityType: "logic-analyzer",
        connectionState: "connected",
        allocationState: "allocated",
        ownerSkillId: "skill-alpha",
        lastSeenAt: connectedAt,
        updatedAt: allocateAt
      }
    ]);
  });

  it("keeps allocated missing devices visible as disconnected until release", async () => {
    const provider = new FakeDeviceProvider([baseDevice]);
    const manager = createResourceManager(provider, {
      now: createClock(connectedAt, disconnectAt)
    });

    await manager.refreshInventory();
    manager.allocateDevice({
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
        updatedAt: disconnectAt
      }
    ]);

    const releaseResult = manager.releaseDevice({
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
        updatedAt: releaseAt
      }
    });
    expect(manager.listDevices()).toEqual([]);
  });
});
