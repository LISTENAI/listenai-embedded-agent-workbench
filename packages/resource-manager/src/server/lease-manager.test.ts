// @ts-ignore - root workspace typecheck can miss vitest re-exports for these helpers, but runtime/package-local tests resolve them correctly
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LeaseManager } from "./lease-manager.js";

describe("LeaseManager", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("createLease", () => {
    it("returns a unique leaseId string", () => {
      const lm = new LeaseManager();
      const id1 = lm.createLease("dev1", "skill1");
      const id2 = lm.createLease("dev2", "skill2");
      expect(typeof id1).toBe("string");
      expect(id1).not.toBe(id2);
    });

    it("getLease returns correct info after create", () => {
      const lm = new LeaseManager();
      const leaseId = lm.createLease("dev1", "skill1");
      const lease = lm.getLease(leaseId);
      expect(lease).toBeDefined();
      expect(lease!.deviceId).toBe("dev1");
      expect(lease!.ownerSkillId).toBe("skill1");
      expect(lease!.leaseId).toBe(leaseId);
    });
  });

  describe("refreshLease", () => {
    it("returns true for existing lease", () => {
      const lm = new LeaseManager();
      const leaseId = lm.createLease("dev1", "skill1");
      expect(lm.refreshLease(leaseId)).toBe(true);
    });

    it("returns false for unknown lease", () => {
      const lm = new LeaseManager();
      expect(lm.refreshLease("nonexistent")).toBe(false);
    });
  });

  describe("removeLease", () => {
    it("returns true for existing lease", () => {
      const lm = new LeaseManager();
      const leaseId = lm.createLease("dev1", "skill1");
      expect(lm.removeLease(leaseId)).toBe(true);
    });

    it("returns false for unknown lease", () => {
      const lm = new LeaseManager();
      expect(lm.removeLease("nonexistent")).toBe(false);
    });

    it("getLease returns undefined after removal", () => {
      const lm = new LeaseManager();
      const leaseId = lm.createLease("dev1", "skill1");
      lm.removeLease(leaseId);
      expect(lm.getLease(leaseId)).toBeUndefined();
    });
  });

  describe("removeLeaseByDevice", () => {
    it("removes correct lease by deviceId", () => {
      const lm = new LeaseManager();
      const leaseId = lm.createLease("dev1", "skill1");
      expect(lm.removeLeaseByDevice("dev1")).toBe(true);
      expect(lm.getLease(leaseId)).toBeUndefined();
    });

    it("returns false when device not found", () => {
      const lm = new LeaseManager();
      expect(lm.removeLeaseByDevice("nonexistent")).toBe(false);
    });
  });

  describe("getAllLeases", () => {
    it("returns all active leases", () => {
      const lm = new LeaseManager();
      lm.createLease("dev1", "skill1");
      lm.createLease("dev2", "skill2");
      const leases = lm.getAllLeases();
      expect(leases).toHaveLength(2);
      expect(leases[0].deviceId).toBe("dev1");
      expect(leases[1].deviceId).toBe("dev2");
    });
  });

  describe("scanExpired", () => {
    it("returns 0 and does not call callback when no leases expired", () => {
      const lm = new LeaseManager();
      lm.createLease("dev1", "skill1");
      const cb = vi.fn();
      expect(lm.scanExpired(cb)).toBe(0);
      expect(cb).not.toHaveBeenCalled();
    });

    it("expires lease after timeout and calls callback", () => {
      const lm = new LeaseManager();
      const leaseId = lm.createLease("dev1", "skill1");
      vi.advanceTimersByTime(90001);
      const cb = vi.fn();
      const count = lm.scanExpired(cb);
      expect(count).toBe(1);
      expect(cb).toHaveBeenCalledOnce();
      expect(cb.mock.calls[0][0].leaseId).toBe(leaseId);
      expect(cb.mock.calls[0][0].deviceId).toBe("dev1");
      expect(lm.getLease(leaseId)).toBeUndefined();
    });

    it("does not expire a recently refreshed lease", () => {
      const lm = new LeaseManager();
      const leaseId = lm.createLease("dev1", "skill1");
      vi.advanceTimersByTime(80000);
      lm.refreshLease(leaseId);
      vi.advanceTimersByTime(80000);
      const cb = vi.fn();
      expect(lm.scanExpired(cb)).toBe(0);
      expect(lm.getLease(leaseId)).toBeDefined();
    });
  });

  describe("custom timeoutMs", () => {
    it("uses a custom timeout for expiration", () => {
      const lm = new LeaseManager({ timeoutMs: 5000 });
      lm.createLease("dev1", "skill1");
      vi.advanceTimersByTime(5001);
      const cb = vi.fn();
      expect(lm.scanExpired(cb)).toBe(1);
    });
  });
});
