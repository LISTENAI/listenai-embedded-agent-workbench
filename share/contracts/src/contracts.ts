export const CONNECTION_STATES = ["connected", "disconnected"] as const;
export type ConnectionState = (typeof CONNECTION_STATES)[number];

export const ALLOCATION_STATES = ["free", "allocated"] as const;
export type AllocationState = (typeof ALLOCATION_STATES)[number];

export const DEVICE_READINESS_STATES = [
  "ready",
  "degraded",
  "unsupported"
] as const;
export type DeviceReadinessState = (typeof DEVICE_READINESS_STATES)[number];

export const BACKEND_READINESS_STATES = [
  "ready",
  "degraded",
  "missing",
  "unsupported"
] as const;
export type BackendReadinessState = (typeof BACKEND_READINESS_STATES)[number];

export const INVENTORY_PROVIDER_KINDS = ["fake", "dslogic"] as const;
export type InventoryProviderKind = (typeof INVENTORY_PROVIDER_KINDS)[number];

export const INVENTORY_BACKEND_KINDS = ["fake", "libsigrok"] as const;
export type InventoryBackendKind = (typeof INVENTORY_BACKEND_KINDS)[number];

export const INVENTORY_PLATFORMS = ["linux", "macos", "windows"] as const;
export type InventoryPlatform = (typeof INVENTORY_PLATFORMS)[number];

export const INVENTORY_DIAGNOSTIC_SEVERITIES = [
  "info",
  "warning",
  "error"
] as const;
export type InventoryDiagnosticSeverity =
  (typeof INVENTORY_DIAGNOSTIC_SEVERITIES)[number];

export const INVENTORY_DIAGNOSTIC_TARGETS = [
  "host",
  "backend",
  "device"
] as const;
export type InventoryDiagnosticTarget =
  (typeof INVENTORY_DIAGNOSTIC_TARGETS)[number];

export const INVENTORY_DIAGNOSTIC_CODES = [
  "backend-missing-runtime",
  "backend-unsupported-os",
  "backend-runtime-failed",
  "backend-runtime-timeout",
  "backend-runtime-malformed-response",
  "device-unsupported-variant",
  "device-runtime-malformed-response"
] as const;
export type InventoryDiagnosticCode = (typeof INVENTORY_DIAGNOSTIC_CODES)[number];

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

export interface InventoryDiagnostic {
  code: InventoryDiagnosticCode;
  severity: InventoryDiagnosticSeverity;
  target: InventoryDiagnosticTarget;
  message: string;
  deviceId?: string;
  platform?: InventoryPlatform;
  backendKind?: InventoryBackendKind;
  backendVersion?: string | null;
}

export interface DslogicDeviceIdentity {
  family: "dslogic";
  model: string;
  modelDisplayName: string;
  variant: string | null;
  usbVendorId: string | null;
  usbProductId: string | null;
}

export interface CanonicalDeviceIdentity {
  providerKind: InventoryProviderKind;
  providerDeviceId: string;
  canonicalKey: string;
}

export interface InventoryScope {
  providerKinds: readonly InventoryProviderKind[];
  backendKinds: readonly InventoryBackendKind[];
}

export interface BackendReadinessRecord {
  platform: InventoryPlatform;
  backendKind: InventoryBackendKind;
  readiness: BackendReadinessState;
  version: string | null;
  checkedAt: string | null;
  diagnostics: readonly InventoryDiagnostic[];
}

export interface DeviceRecord {
  deviceId: string;
  label: string;
  capabilityType: string;
  connectionState: ConnectionState;
  allocationState: AllocationState;
  ownerSkillId: string | null;
  lastSeenAt: string | null;
  updatedAt: string;
  readiness?: DeviceReadinessState;
  diagnostics?: readonly InventoryDiagnostic[];
  providerKind?: InventoryProviderKind;
  backendKind?: InventoryBackendKind;
  canonicalIdentity?: CanonicalDeviceIdentity;
  dslogic?: DslogicDeviceIdentity | null;
}

export interface InventorySnapshot {
  refreshedAt: string;
  inventoryScope: InventoryScope;
  devices: readonly DeviceRecord[];
  backendReadiness: readonly BackendReadinessRecord[];
  diagnostics: readonly InventoryDiagnostic[];
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

export const DASHBOARD_DEVICE_BADGES = [
  "ready",
  "degraded",
  "unsupported",
  "disconnected"
] as const;
export type DashboardDeviceBadge = (typeof DASHBOARD_DEVICE_BADGES)[number];

export const DASHBOARD_LEASE_STATES = [
  "none",
  "active",
  "overdue",
  "missing",
  "orphaned"
] as const;
export type DashboardLeaseState = (typeof DASHBOARD_LEASE_STATES)[number];

export const DASHBOARD_OCCUPANCY_STATES = [
  "available",
  "occupied",
  "lease-overdue",
  "lease-missing",
  "lease-orphaned"
] as const;
export type DashboardOccupancyState =
  (typeof DASHBOARD_OCCUPANCY_STATES)[number];

export interface DashboardOwnerIdentity {
  skillId: string;
  source: "lease" | "device";
}

export interface DashboardLeaseTiming {
  state: DashboardLeaseState;
  leaseId: string | null;
  createdAt: string | null;
  lastRefreshedAt: string | null;
  expiresAt: string | null;
  remainingMs: number | null;
  timeoutMs: number | null;
}

export interface DashboardDeviceRow {
  deviceId: string;
  label: string;
  capabilityType: string;
  connectionState: ConnectionState;
  allocationState: AllocationState;
  readinessBadge: DashboardDeviceBadge;
  occupancyState: DashboardOccupancyState;
  owner: DashboardOwnerIdentity | null;
  lease: DashboardLeaseTiming;
  lastSeenAt: string | null;
  updatedAt: string;
  diagnostics: readonly InventoryDiagnostic[];
  providerKind?: InventoryProviderKind;
  backendKind?: InventoryBackendKind;
  canonicalIdentity?: CanonicalDeviceIdentity;
}

export interface DashboardOverview {
  totalDevices: number;
  connectedDevices: number;
  disconnectedDevices: number;
  availableDevices: number;
  occupiedDevices: number;
  readyDevices: number;
  degradedDevices: number;
  unsupportedDevices: number;
  activeLeases: number;
  overdueLeases: number;
  missingLeases: number;
  orphanedLeases: number;
  expiringSoon: number;
  backendReady: number;
  backendDegraded: number;
  backendMissing: number;
  backendUnsupported: number;
}

export interface DashboardSnapshot {
  generatedAt: string;
  inventoryScope: InventoryScope;
  overview: DashboardOverview;
  backendReadiness: readonly BackendReadinessRecord[];
  devices: readonly DashboardDeviceRow[];
  diagnostics: readonly InventoryDiagnostic[];
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
