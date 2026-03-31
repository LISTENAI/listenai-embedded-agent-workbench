import type {
  BackendReadinessRecord,
  BackendReadinessState,
  DeviceRecord,
  InventoryDiagnostic,
  InventorySnapshot
} from "@listenai/contracts";

import type {
  LogicAnalyzerConstraintIssue,
  LogicAnalyzerSessionConstraintEvaluation,
  LogicAnalyzerSessionConstraintReport,
  StartLogicAnalyzerSessionRequest
} from "./contracts.js";

const DSLOGIC_PLUS_SAMPLE_RATE_TIERS = [
  { maxChannels: 4, maxSampleRateHz: 400_000_000 },
  { maxChannels: 8, maxSampleRateHz: 200_000_000 },
  { maxChannels: 16, maxSampleRateHz: 100_000_000 }
] as const;

const cloneDiagnostics = (
  diagnostics: readonly InventoryDiagnostic[] | undefined
): readonly InventoryDiagnostic[] => diagnostics?.map((diagnostic) => ({ ...diagnostic })) ?? [];

const cloneBackendReadiness = (
  records: readonly BackendReadinessRecord[]
): readonly BackendReadinessRecord[] =>
  records.map((record) => ({
    ...record,
    diagnostics: cloneDiagnostics(record.diagnostics)
  }));

const cloneDevice = (device: DeviceRecord | null | undefined): DeviceRecord | null => {
  if (!device) {
    return null;
  }

  return {
    ...device,
    diagnostics: cloneDiagnostics(device.diagnostics),
    dslogic: device.dslogic ? { ...device.dslogic } : device.dslogic
  };
};

const getRelevantBackendReadiness = (
  snapshot: InventorySnapshot,
  device: DeviceRecord | null | undefined
): readonly BackendReadinessRecord[] => {
  const backendKind =
    device?.backendKind ??
    (snapshot.inventoryScope.backendKinds.length === 1
      ? snapshot.inventoryScope.backendKinds[0]
      : undefined);
  const matching =
    backendKind === undefined
      ? []
      : snapshot.backendReadiness.filter(
          (record) => record.backendKind === backendKind
        );

  return cloneBackendReadiness(
    matching.length > 0 ? matching : snapshot.backendReadiness
  );
};

const evaluateBackendReadiness = (
  backendReadiness: readonly BackendReadinessRecord[]
): BackendReadinessState | "missing" => {
  if (backendReadiness.length === 0) {
    return "missing";
  }

  if (backendReadiness.some((record) => record.readiness === "missing")) {
    return "missing";
  }

  if (backendReadiness.some((record) => record.readiness === "unsupported")) {
    return "unsupported";
  }

  if (backendReadiness.some((record) => record.readiness === "degraded")) {
    return "degraded";
  }

  return "ready";
};

const pushIssue = (
  issues: LogicAnalyzerConstraintIssue[],
  issue: LogicAnalyzerConstraintIssue
): void => {
  issues.push(issue);
};

const buildReport = (
  request: StartLogicAnalyzerSessionRequest,
  snapshot: InventorySnapshot,
  device: DeviceRecord | null | undefined,
  backendReadiness: readonly BackendReadinessRecord[],
  issues: readonly LogicAnalyzerConstraintIssue[]
): LogicAnalyzerSessionConstraintReport => {
  const requestedChannelIds = request.sampling.channels.map((channel) => channel.channelId);
  const normalizedChannelIds = requestedChannelIds
    .map((channelId) => channelId.trim())
    .filter((channelId) => channelId.length > 0);

  return {
    request: {
      deviceId: request.deviceId,
      requestedChannelIds,
      requestedChannelCount: requestedChannelIds.length,
      distinctChannelCount: new Set(normalizedChannelIds).size,
      sampleRateHz: request.sampling.sampleRateHz
    },
    device: cloneDevice(device),
    evaluatedDeviceReadiness: device?.readiness ?? "missing",
    deviceDiagnostics: cloneDiagnostics(device?.diagnostics),
    backendReadiness,
    evaluatedBackendReadiness: evaluateBackendReadiness(backendReadiness),
    snapshotDiagnostics: cloneDiagnostics(snapshot.diagnostics),
    issues: issues.map((issue) => ({ ...issue }))
  };
};

const evaluateChannelSelections = (
  request: StartLogicAnalyzerSessionRequest,
  issues: LogicAnalyzerConstraintIssue[]
): number => {
  const uniqueChannelIds = new Set<string>();

  request.sampling.channels.forEach((channel, index) => {
    const normalizedChannelId = channel.channelId.trim();

    if (normalizedChannelId.length === 0) {
      pushIssue(issues, {
        path: `sampling.channels[${index}].channelId`,
        code: "empty-channel-selection",
        message: `sampling.channels[${index}].channelId must not be empty.`
      });
      return;
    }

    if (uniqueChannelIds.has(normalizedChannelId)) {
      pushIssue(issues, {
        path: `sampling.channels[${index}].channelId`,
        code: "duplicate-channel-selection",
        message: `sampling.channels[${index}].channelId duplicates ${normalizedChannelId}.`
      });
      return;
    }

    uniqueChannelIds.add(normalizedChannelId);
  });

  return uniqueChannelIds.size;
};

const evaluateDeviceConstraints = (
  request: StartLogicAnalyzerSessionRequest,
  device: DeviceRecord | null | undefined,
  issues: LogicAnalyzerConstraintIssue[]
): void => {
  if (!device) {
    pushIssue(issues, {
      path: "deviceId",
      code: "device-not-found",
      message: `Device ${request.deviceId} is not present in the inventory snapshot.`
    });
    return;
  }

  if (device.connectionState !== "connected") {
    pushIssue(issues, {
      path: "device.connectionState",
      code: "device-not-ready",
      message: `Device ${device.deviceId} is ${device.connectionState} and cannot start a session.`
    });
  }

  if (device.readiness === undefined) {
    pushIssue(issues, {
      path: "device.readiness",
      code: "device-not-ready",
      message: `Device ${device.deviceId} is missing readiness information in the inventory snapshot.`
    });
  } else if (device.readiness === "unsupported") {
    pushIssue(issues, {
      path: "device.readiness",
      code: "unsupported-device",
      message: `Device ${device.deviceId} is marked unsupported by inventory diagnostics.`
    });
  } else if (device.readiness !== "ready") {
    pushIssue(issues, {
      path: "device.readiness",
      code: "device-not-ready",
      message: `Device ${device.deviceId} is ${device.readiness} and cannot start a session.`
    });
  }

  if (!device.dslogic || device.dslogic.family !== "dslogic") {
    pushIssue(issues, {
      path: "device.dslogic",
      code: "missing-dslogic-identity",
      message: `Device ${device.deviceId} is missing DSLogic identity details.`
    });
    return;
  }

  if (device.dslogic.model !== "dslogic-plus") {
    pushIssue(issues, {
      path: "device.dslogic.model",
      code: "unsupported-device",
      message: `Device ${device.deviceId} uses unsupported model ${device.dslogic.model}.`
    });
  }
};

const evaluateBackendConstraints = (
  backendReadiness: readonly BackendReadinessRecord[],
  issues: LogicAnalyzerConstraintIssue[]
): void => {
  const evaluatedBackendReadiness = evaluateBackendReadiness(backendReadiness);
  if (evaluatedBackendReadiness === "ready") {
    return;
  }

  pushIssue(issues, {
    path: "snapshot.backendReadiness",
    code: "backend-not-ready",
    message:
      evaluatedBackendReadiness === "missing"
        ? "No ready backend record is available for this inventory snapshot."
        : `Backend readiness is ${evaluatedBackendReadiness}.`
  });
};

const evaluateSampleRateConstraints = (
  request: StartLogicAnalyzerSessionRequest,
  selectedChannelCount: number,
  issues: LogicAnalyzerConstraintIssue[]
): void => {
  if (selectedChannelCount === 0) {
    return;
  }

  if (selectedChannelCount > 16) {
    pushIssue(issues, {
      path: "sampling.channels",
      code: "channel-count-exceeds-device-limit",
      message: `DSLogic Plus supports at most 16 channels, but ${selectedChannelCount} were requested.`
    });
    return;
  }

  const tier = DSLOGIC_PLUS_SAMPLE_RATE_TIERS.find(
    (candidate) => selectedChannelCount <= candidate.maxChannels
  );
  if (!tier) {
    return;
  }

  if (request.sampling.sampleRateHz > tier.maxSampleRateHz) {
    pushIssue(issues, {
      path: "sampling.sampleRateHz",
      code: "sample-rate-exceeds-device-limit",
      message: `DSLogic Plus supports up to ${tier.maxSampleRateHz}Hz with ${selectedChannelCount} channels, but ${request.sampling.sampleRateHz}Hz was requested.`
    });
  }
};

export interface EvaluateStartSessionConstraintsInput {
  request: StartLogicAnalyzerSessionRequest;
  snapshot: InventorySnapshot;
  device: DeviceRecord | null | undefined;
}

export const evaluateStartSessionConstraints = ({
  request,
  snapshot,
  device
}: EvaluateStartSessionConstraintsInput): LogicAnalyzerSessionConstraintEvaluation => {
  const issues: LogicAnalyzerConstraintIssue[] = [];
  const backendReadiness = getRelevantBackendReadiness(snapshot, device);

  evaluateBackendConstraints(backendReadiness, issues);
  evaluateDeviceConstraints(request, device, issues);
  const selectedChannelCount = evaluateChannelSelections(request, issues);
  evaluateSampleRateConstraints(request, selectedChannelCount, issues);

  const report = buildReport(request, snapshot, device, backendReadiness, issues);

  if (issues.length > 0) {
    return {
      ok: false,
      reason: "constraint-rejected",
      report
    };
  }

  return {
    ok: true,
    report
  };
};
