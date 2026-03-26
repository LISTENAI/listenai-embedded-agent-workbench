import { describe, expect, it, expectTypeOf } from "vitest";

import {
  ALLOCATION_FAILURE_REASONS,
  ALLOCATION_STATES,
  CONNECTION_STATES,
  RELEASE_FAILURE_REASONS,
  type AllocationFailure,
  type AllocationRequest,
  type AllocationResult,
  type DeviceRecord,
  type ReleaseFailure,
  type ReleaseRequest,
  type ReleaseResult
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
