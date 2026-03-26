import type {
  EndLogicAnalyzerSessionRequest,
  EndLogicAnalyzerSessionResult,
  LogicAnalyzerSessionRecord,
  LogicAnalyzerValidationIssue,
  StartLogicAnalyzerSessionRequest,
  StartLogicAnalyzerSessionResult
} from "./contracts.js";
import {
  createLogicAnalyzerSkill,
  type LogicAnalyzerSkill
} from "./logic-analyzer-skill.js";
import type {
  CaptureArtifactInput,
  IncompatibleSessionCaptureFailure,
  LoadCaptureResult,
  UnreadableCaptureInputFailure,
  UnsupportedCaptureAdapterFailure
} from "./capture-contracts.js";
import {
  loadLogicCapture,
  type CaptureLoaderOptions
} from "./capture-loader.js";
import { analyzeWaveformCapture } from "./waveform-analyzer.js";
import type { WaveformAnalysisResult } from "./analysis-contracts.js";
import type { ResourceManager } from "../resource-manager/resource-manager.js";

export const GENERIC_LOGIC_ANALYZER_PHASES = [
  "request-validation",
  "start-session",
  "load-capture",
  "completed"
] as const;
export type GenericLogicAnalyzerPhase =
  (typeof GENERIC_LOGIC_ANALYZER_PHASES)[number];

export interface GenericLogicAnalyzerRequest {
  session: StartLogicAnalyzerSessionRequest;
  artifact: CaptureArtifactInput;
  cleanup: {
    endedAt: string;
  };
}

export interface GenericLogicAnalyzerRequestValidationFailure {
  ok: false;
  phase: "request-validation";
  issues: readonly LogicAnalyzerValidationIssue[];
  cleanup: {
    attempted: false;
    reason: "not-started";
  };
}

export interface GenericLogicAnalyzerStartFailure {
  ok: false;
  phase: "start-session";
  startSession: Exclude<StartLogicAnalyzerSessionResult, { ok: true }>;
  cleanup: {
    attempted: false;
    reason: "not-started";
  };
}

export interface GenericLogicAnalyzerCleanupAttempt {
  attempted: true;
  request: EndLogicAnalyzerSessionRequest;
  result: EndLogicAnalyzerSessionResult;
}

export type GenericLogicAnalyzerCleanupReport =
  | GenericLogicAnalyzerRequestValidationFailure["cleanup"]
  | GenericLogicAnalyzerStartFailure["cleanup"]
  | GenericLogicAnalyzerCleanupAttempt;

export interface GenericLogicAnalyzerLoadFailure {
  ok: false;
  phase: "load-capture";
  session: LogicAnalyzerSessionRecord;
  loadCapture:
    | UnsupportedCaptureAdapterFailure
    | UnreadableCaptureInputFailure
    | IncompatibleSessionCaptureFailure;
  cleanup: GenericLogicAnalyzerCleanupAttempt;
}

export interface GenericLogicAnalyzerSuccess {
  ok: true;
  phase: "completed";
  session: LogicAnalyzerSessionRecord;
  capture: Extract<LoadCaptureResult, { ok: true }>;
  analysis: WaveformAnalysisResult;
}

export type GenericLogicAnalyzerResult =
  | GenericLogicAnalyzerSuccess
  | GenericLogicAnalyzerRequestValidationFailure
  | GenericLogicAnalyzerStartFailure
  | GenericLogicAnalyzerLoadFailure;

export interface GenericLogicAnalyzerSkillOptions {
  createSessionId?: () => string;
  captureLoaderOptions?: CaptureLoaderOptions;
}

export interface GenericLogicAnalyzerSkill {
  run(request: unknown): Promise<GenericLogicAnalyzerResult>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const pushRequiredObjectIssue = (
  issues: LogicAnalyzerValidationIssue[],
  path: string,
  value: unknown
): void => {
  if (value === undefined || value === null) {
    issues.push({
      path,
      code: "required",
      message: `${path} is required.`
    });
    return;
  }

  if (!isRecord(value)) {
    issues.push({
      path,
      code: "invalid-type",
      message: `${path} must be an object.`
    });
  }
};

const pushRequiredStringIssue = (
  issues: LogicAnalyzerValidationIssue[],
  path: string,
  value: unknown
): void => {
  if (value === undefined || value === null || value === "") {
    issues.push({
      path,
      code: "required",
      message: `${path} is required.`
    });
    return;
  }

  if (typeof value !== "string") {
    issues.push({
      path,
      code: "invalid-type",
      message: `${path} must be a string.`
    });
  }
};

export const validateGenericLogicAnalyzerRequest = (
  value: unknown
):
  | { ok: true; value: GenericLogicAnalyzerRequest }
  | { ok: false; issues: readonly LogicAnalyzerValidationIssue[] } => {
  if (!isRecord(value)) {
    return {
      ok: false,
      issues: [
        {
          path: "$",
          code: "invalid-type",
          message: "Generic logic analyzer request must be an object."
        }
      ]
    };
  }

  const issues: LogicAnalyzerValidationIssue[] = [];
  pushRequiredObjectIssue(issues, "session", value.session);
  pushRequiredObjectIssue(issues, "artifact", value.artifact);

  if (!isRecord(value.cleanup)) {
    pushRequiredObjectIssue(issues, "cleanup", value.cleanup);
  } else {
    pushRequiredStringIssue(issues, "cleanup.endedAt", value.cleanup.endedAt);
  }

  if (issues.length > 0) {
    return {
      ok: false,
      issues
    };
  }

  return {
    ok: true,
    value: {
      session: value.session as StartLogicAnalyzerSessionRequest,
      artifact: value.artifact as CaptureArtifactInput,
      cleanup: {
        endedAt: (value.cleanup as { endedAt: string }).endedAt
      }
    }
  };
};

const buildCleanupRequest = (
  request: GenericLogicAnalyzerRequest,
  session: LogicAnalyzerSessionRecord
): EndLogicAnalyzerSessionRequest => ({
  sessionId: session.sessionId,
  deviceId: session.deviceId,
  ownerSkillId: session.ownerSkillId,
  endedAt: request.cleanup.endedAt
});

const attemptCleanup = (
  sessionSkill: GenericLogicAnalyzerSessionSkill,
  request: GenericLogicAnalyzerRequest,
  session: LogicAnalyzerSessionRecord
): GenericLogicAnalyzerCleanupAttempt => {
  const cleanupRequest = buildCleanupRequest(request, session);

  return {
    attempted: true,
    request: cleanupRequest,
    result: sessionSkill.endSession(cleanupRequest)
  };
};

export const runGenericLogicAnalyzer = async (
  resourceManager: ResourceManager,
  request: unknown,
  options: GenericLogicAnalyzerSkillOptions = {}
): Promise<GenericLogicAnalyzerResult> => {
  const validation = validateGenericLogicAnalyzerRequest(request);
  if (!validation.ok) {
    return {
      ok: false,
      phase: "request-validation",
      issues: validation.issues,
      cleanup: {
        attempted: false,
        reason: "not-started"
      }
    };
  }

  const sessionSkill = createLogicAnalyzerSkill(resourceManager, {
    createSessionId: options.createSessionId
  });
  const startSession = await sessionSkill.startSession(validation.value.session);

  if (!startSession.ok) {
    return {
      ok: false,
      phase: "start-session",
      startSession,
      cleanup: {
        attempted: false,
        reason: "not-started"
      }
    };
  }

  const capture = loadLogicCapture(
    {
      session: startSession.session,
      artifact: validation.value.artifact
    },
    options.captureLoaderOptions
  );

  if (!capture.ok) {
    return {
      ok: false,
      phase: "load-capture",
      session: startSession.session,
      loadCapture: capture,
      cleanup: attemptCleanup(sessionSkill, validation.value, startSession.session)
    };
  }

  return {
    ok: true,
    phase: "completed",
    session: startSession.session,
    capture,
    analysis: analyzeWaveformCapture(
      capture.capture,
      startSession.session.analysis
    )
  };
};

export const createGenericLogicAnalyzerSkill = (
  resourceManager: ResourceManager,
  options: GenericLogicAnalyzerSkillOptions = {}
): GenericLogicAnalyzerSkill => ({
  run(request: unknown): Promise<GenericLogicAnalyzerResult> {
    return runGenericLogicAnalyzer(resourceManager, request, options);
  }
});

export type GenericLogicAnalyzerSessionSkill = Pick<
  LogicAnalyzerSkill,
  "startSession" | "endSession"
>;
