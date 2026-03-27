export const CONNECTION_STATES = ["connected", "disconnected"] as const;
export type ConnectionState = (typeof CONNECTION_STATES)[number];

export const ALLOCATION_STATES = ["free", "allocated"] as const;
export type AllocationState = (typeof ALLOCATION_STATES)[number];

export const ALLOCATION_FAILURE_REASONS = [
  "device-not-found",
  "device-disconnected",
  "device-already-allocated",
  "server-unavailable"
] as const;
export type AllocationFailureReason =
  (typeof ALLOCATION_FAILURE_REASONS)[number];

export const RELEASE_FAILURE_REASONS = [
  "device-not-found",
  "device-not-allocated",
  "owner-mismatch",
  "server-unavailable"
] as const;
export type ReleaseFailureReason = (typeof RELEASE_FAILURE_REASONS)[number];

export interface DeviceRecord {
  deviceId: string;
  label: string;
  capabilityType: string;
  connectionState: ConnectionState;
  allocationState: AllocationState;
  ownerSkillId: string | null;
  lastSeenAt: string | null;
  updatedAt: string;
}

export interface AllocationRequest {
  deviceId: string;
  ownerSkillId: string;
  requestedAt: string;
}

export interface AllocationSuccess {
  ok: true;
  device: DeviceRecord;
}

export interface AllocationFailure {
  ok: false;
  reason: AllocationFailureReason;
  deviceId: string;
  ownerSkillId: string;
  message: string;
  device: DeviceRecord | null;
}

export type AllocationResult = AllocationSuccess | AllocationFailure;

export interface ReleaseRequest {
  deviceId: string;
  ownerSkillId: string;
  releasedAt: string;
}

export interface ReleaseSuccess {
  ok: true;
  device: DeviceRecord;
}

export interface ReleaseFailure {
  ok: false;
  reason: ReleaseFailureReason;
  deviceId: string;
  ownerSkillId: string;
  message: string;
  device: DeviceRecord | null;
}

export type ReleaseResult = ReleaseSuccess | ReleaseFailure;

export interface LeaseInfo {
  leaseId: string;
  deviceId: string;
  ownerSkillId: string;
  createdAt: string;
  lastRefreshedAt: string;
}

export interface HeartbeatRequest {
  leaseId: string;
}

export interface HeartbeatSuccess {
  ok: true;
  leaseId: string;
  expiresAt: string;
}

export interface HeartbeatFailure {
  ok: false;
  reason: "lease-not-found";
  leaseId: string;
  message: string;
}

export type HeartbeatResult = HeartbeatSuccess | HeartbeatFailure;

export const HEARTBEAT_FAILURE_REASONS = ["lease-not-found"] as const;

export interface AllocationSuccessWithLease extends AllocationSuccess {
  leaseId: string;
  expiresAt: string;
}
