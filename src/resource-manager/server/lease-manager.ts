import type { LeaseInfo } from "../contracts.js";

export interface LeaseManagerOptions {
  timeoutMs?: number;
  now?: () => number;
}

interface LeaseRecord {
  deviceId: string;
  ownerSkillId: string;
  createdAt: number;
  lastRefreshedAt: number;
}

export class LeaseManager {
  private leases = new Map<string, LeaseRecord>();
  private timeoutMs: number;
  private now: () => number;

  constructor(options: LeaseManagerOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 90000;
    this.now = options.now ?? (() => Date.now());
  }

  createLease(deviceId: string, ownerSkillId: string): string {
    const leaseId = crypto.randomUUID();
    const now = this.now();
    this.leases.set(leaseId, { deviceId, ownerSkillId, createdAt: now, lastRefreshedAt: now });
    return leaseId;
  }

  refreshLease(leaseId: string): boolean {
    const lease = this.leases.get(leaseId);
    if (!lease) return false;
    lease.lastRefreshedAt = this.now();
    return true;
  }

  removeLease(leaseId: string): boolean {
    return this.leases.delete(leaseId);
  }

  removeLeaseByDevice(deviceId: string): boolean {
    for (const [leaseId, lease] of this.leases.entries()) {
      if (lease.deviceId === deviceId) {
        this.leases.delete(leaseId);
        return true;
      }
    }
    return false;
  }

  getLease(leaseId: string): LeaseInfo | undefined {
    const lease = this.leases.get(leaseId);
    if (!lease) return undefined;
    return {
      leaseId,
      deviceId: lease.deviceId,
      ownerSkillId: lease.ownerSkillId,
      createdAt: new Date(lease.createdAt).toISOString(),
      lastRefreshedAt: new Date(lease.lastRefreshedAt).toISOString()
    };
  }

  getAllLeases(): LeaseInfo[] {
    const result: LeaseInfo[] = [];
    for (const [leaseId, lease] of this.leases.entries()) {
      result.push({
        leaseId,
        deviceId: lease.deviceId,
        ownerSkillId: lease.ownerSkillId,
        createdAt: new Date(lease.createdAt).toISOString(),
        lastRefreshedAt: new Date(lease.lastRefreshedAt).toISOString()
      });
    }
    return result;
  }

  scanExpired(onExpired: (lease: LeaseInfo) => void): number {
    const now = this.now();
    const expired: string[] = [];
    
    for (const [leaseId, lease] of this.leases.entries()) {
      if (now - lease.lastRefreshedAt > this.timeoutMs) {
        expired.push(leaseId);
        onExpired({
          leaseId,
          deviceId: lease.deviceId,
          ownerSkillId: lease.ownerSkillId,
          createdAt: new Date(lease.createdAt).toISOString(),
          lastRefreshedAt: new Date(lease.lastRefreshedAt).toISOString()
        });
      }
    }
    
    for (const leaseId of expired) {
      this.leases.delete(leaseId);
    }
    
    return expired.length;
  }
}
