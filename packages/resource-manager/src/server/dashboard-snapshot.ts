import type {
  CanonicalDeviceIdentity,
  DashboardDeviceBadge,
  DashboardDeviceRow,
  DashboardLeaseState,
  DashboardOccupancyState,
  DashboardSnapshot,
  DashboardOwnerIdentity,
  InventoryScope,
  InventorySnapshot,
  LeaseInfo
} from "@listenai/contracts";
import type { LeaseManager } from "./lease-manager.js";

export interface DashboardSnapshotOptions {
  now?: () => number;
  expiringSoonThresholdMs?: number;
}

export interface DashboardLeaseSource {
  getAllLeases(): LeaseInfo[];
  getTimeoutMs(): number;
}

export const DEFAULT_EXPIRING_SOON_THRESHOLD_MS = 30000;

const READYNESS_BADGE_LABELS: Record<DashboardDeviceBadge, string> = {
  ready: "ready",
  degraded: "degraded",
  unsupported: "unsupported",
  disconnected: "disconnected"
};

const cloneLease = (lease: LeaseInfo): LeaseInfo => ({ ...lease });

const cloneOwner = (owner: DashboardOwnerIdentity | null): DashboardOwnerIdentity | null =>
  owner ? { ...owner } : null;

const cloneCanonicalIdentity = (
  identity: CanonicalDeviceIdentity | undefined
): CanonicalDeviceIdentity | undefined => (identity ? { ...identity } : undefined);

const cloneInventoryScope = (scope: InventoryScope): InventoryScope => ({
  providerKinds: [...scope.providerKinds],
  backendKinds: [...scope.backendKinds]
});

const cloneRow = (row: DashboardDeviceRow): DashboardDeviceRow => ({
  ...row,
  owner: cloneOwner(row.owner),
  lease: { ...row.lease },
  canonicalIdentity: cloneCanonicalIdentity(row.canonicalIdentity),
  diagnostics: row.diagnostics.map((diagnostic) => ({ ...diagnostic }))
});

const toExpiryMs = (lease: LeaseInfo, leaseTimeoutMs: number): number =>
  Date.parse(lease.lastRefreshedAt) + leaseTimeoutMs;

const toReadinessBadge = (
  device: InventorySnapshot["devices"][number]
): DashboardDeviceBadge => {
  if (device.connectionState === "disconnected") {
    return "disconnected";
  }

  if (device.readiness === "degraded") {
    return "degraded";
  }

  if (device.readiness === "unsupported") {
    return "unsupported";
  }

  return "ready";
};

const toOwner = (
  device: InventorySnapshot["devices"][number],
  lease: LeaseInfo | undefined
): DashboardOwnerIdentity | null => {
  if (lease) {
    return {
      skillId: lease.ownerSkillId,
      source: "lease"
    };
  }

  if (device.ownerSkillId) {
    return {
      skillId: device.ownerSkillId,
      source: "device"
    };
  }

  return null;
};

const toLeaseState = (
  device: InventorySnapshot["devices"][number],
  lease: LeaseInfo | undefined,
  remainingMs: number | null
): DashboardLeaseState => {
  if (!lease) {
    return device.allocationState === "allocated" ? "missing" : "none";
  }

  if (device.allocationState !== "allocated") {
    return "orphaned";
  }

  return remainingMs !== null && remainingMs < 0 ? "overdue" : "active";
};

const toOccupancyState = (
  device: InventorySnapshot["devices"][number],
  leaseState: DashboardLeaseState
): DashboardOccupancyState => {
  if (leaseState === "orphaned") {
    return "lease-orphaned";
  }

  if (device.allocationState !== "allocated") {
    return "available";
  }

  if (leaseState === "missing") {
    return "lease-missing";
  }

  if (leaseState === "overdue") {
    return "lease-overdue";
  }

  return "occupied";
};

const projectDeviceRow = (
  device: InventorySnapshot["devices"][number],
  lease: LeaseInfo | undefined,
  leaseTimeoutMs: number,
  nowMs: number
): DashboardDeviceRow => {
  const expiresAtMs = lease ? toExpiryMs(lease, leaseTimeoutMs) : null;
  const remainingMs = expiresAtMs === null ? null : expiresAtMs - nowMs;
  const leaseState = toLeaseState(device, lease, remainingMs);

  return {
    deviceId: device.deviceId,
    label: device.label,
    capabilityType: device.capabilityType,
    connectionState: device.connectionState,
    allocationState: device.allocationState,
    readinessBadge: toReadinessBadge(device),
    occupancyState: toOccupancyState(device, leaseState),
    owner: toOwner(device, lease),
    lease: {
      state: leaseState,
      leaseId: lease?.leaseId ?? null,
      createdAt: lease?.createdAt ?? null,
      lastRefreshedAt: lease?.lastRefreshedAt ?? null,
      expiresAt: expiresAtMs === null ? null : new Date(expiresAtMs).toISOString(),
      remainingMs,
      timeoutMs: lease ? leaseTimeoutMs : null
    },
    lastSeenAt: device.lastSeenAt,
    updatedAt: device.updatedAt,
    diagnostics: device.diagnostics?.map((diagnostic) => ({ ...diagnostic })) ?? [],
    providerKind: device.providerKind,
    backendKind: device.backendKind,
    canonicalIdentity: cloneCanonicalIdentity(device.canonicalIdentity)
  };
};

export const createDashboardSnapshot = (
  inventory: InventorySnapshot,
  leaseSource: DashboardLeaseSource | Pick<LeaseManager, "getAllLeases" | "getTimeoutMs">,
  options: DashboardSnapshotOptions = {}
): DashboardSnapshot => {
  const nowMs = options.now?.() ?? Date.now();
  const expiringSoonThresholdMs =
    options.expiringSoonThresholdMs ?? DEFAULT_EXPIRING_SOON_THRESHOLD_MS;
  const leaseTimeoutMs = leaseSource.getTimeoutMs();
  const leases = leaseSource.getAllLeases().map(cloneLease);
  const leaseByDeviceId = new Map(leases.map((lease) => [lease.deviceId, lease]));

  const devices = inventory.devices
    .map((device) => projectDeviceRow(device, leaseByDeviceId.get(device.deviceId), leaseTimeoutMs, nowMs))
    .sort((left, right) => left.deviceId.localeCompare(right.deviceId))
    .map(cloneRow);

  const allocatedDeviceIds = new Set(
    inventory.devices
      .filter((device) => device.allocationState === "allocated")
      .map((device) => device.deviceId)
  );

  const overview = {
    totalDevices: devices.length,
    connectedDevices: devices.filter((device) => device.connectionState === "connected").length,
    disconnectedDevices: devices.filter((device) => device.connectionState === "disconnected").length,
    availableDevices: devices.filter((device) => device.occupancyState === "available").length,
    occupiedDevices: devices.filter((device) => device.allocationState === "allocated").length,
    readyDevices: devices.filter((device) => device.readinessBadge === "ready").length,
    degradedDevices: devices.filter((device) => device.readinessBadge === "degraded").length,
    unsupportedDevices: devices.filter((device) => device.readinessBadge === "unsupported").length,
    activeLeases: leases.length,
    overdueLeases: devices.filter((device) => device.lease.state === "overdue").length,
    missingLeases: devices.filter((device) => device.lease.state === "missing").length,
    orphanedLeases: leases.filter((lease) => !allocatedDeviceIds.has(lease.deviceId)).length,
    expiringSoon: devices.filter(
      (device) =>
        device.lease.state === "active" &&
        device.lease.remainingMs !== null &&
        device.lease.remainingMs <= expiringSoonThresholdMs
    ).length,
    backendReady: inventory.backendReadiness.filter((backend) => backend.readiness === "ready").length,
    backendDegraded: inventory.backendReadiness.filter((backend) => backend.readiness === "degraded").length,
    backendMissing: inventory.backendReadiness.filter((backend) => backend.readiness === "missing").length,
    backendUnsupported: inventory.backendReadiness.filter((backend) => backend.readiness === "unsupported").length
  };

  return {
    generatedAt: inventory.refreshedAt,
    inventoryScope: cloneInventoryScope(inventory.inventoryScope),
    overview,
    backendReadiness: inventory.backendReadiness.map((backend) => ({
      ...backend,
      diagnostics: backend.diagnostics.map((diagnostic) => ({ ...diagnostic }))
    })),
    devices,
    diagnostics: inventory.diagnostics.map((diagnostic) => ({ ...diagnostic }))
  };
};

export const formatDashboardReadinessLabel = (
  badge: DashboardDeviceBadge
): string => READYNESS_BADGE_LABELS[badge];
