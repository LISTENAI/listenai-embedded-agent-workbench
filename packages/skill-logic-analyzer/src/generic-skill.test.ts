import { describe, expect, expectTypeOf, it } from "vitest";

import type {
  DeviceRecord,
  InventorySnapshot,
  SnapshotResourceManager
} from "@listenai/eaw-contracts";
import {
  GENERIC_LOGIC_ANALYZER_MODES,
  GENERIC_LOGIC_ANALYZER_PHASES,
  createGenericLogicAnalyzerSkill,
  runGenericLogicAnalyzer,
  type DsviewDecodeCommandResult,
  type DsviewDecoderDetails,
  type GenericLogicAnalyzerDecodeConfig,
  type GenericLogicAnalyzerRequest,
  type GenericLogicAnalyzerResult,
  type LogicAnalyzerSessionRecord,
  type WaveformAnalysisResult
} from "./index.js";
import {
  FakeDeviceProvider,
  createDslogicLiveCaptureRunner,
  createResourceManager
} from "@listenai/eaw-resource-manager";

const connectedAt = "2026-03-26T00:00:00.000Z";
const allocatedAt = "2026-03-26T00:01:00.000Z";
const captureRequestedAt = "2026-03-26T00:01:10.000Z";
const cleanupAt = "2026-03-26T00:02:00.000Z";
const conflictingAt = "2026-03-26T00:03:00.000Z";

const fixtureCsvText = [
  "Time [us],D0,D1",
  "0,0,1",
  "1,1,1",
  "2,1,0",
  "3,0,0"
].join("\n");

const fixtureVcdText = [
  "$date",
  "  2026-03-26T00:00:01.000Z",
  "$end",
  "$version DSView $end",
  "$timescale 1 ns $end",
  "$scope module logic $end",
  "$var wire 1 ! D0 $end",
  "$var wire 1 \" D1 $end",
  "$upscope $end",
  "$enddefinitions $end",
  "#0",
  "$dumpvars",
  "0!",
  "1\"",
  "$end",
  "#1000",
  "1!",
  "#2000",
  "0\"",
  "#3000",
  "0!"
].join("\n");

const incompatibleFixtureVcdText = [
  "$date",
  "  2026-03-26T00:00:01.000Z",
  "$end",
  "$version DSView $end",
  "$timescale 1 ns $end",
  "$scope module logic $end",
  "$var wire 1 ! D0 $end",
  "$upscope $end",
  "$enddefinitions $end",
  "#0",
  "$dumpvars",
  "0!",
  "$end",
  "#1000",
  "1!",
  "#2000",
  "0!"
].join("\n");

const createClock = (...timestamps: string[]) => {
  let index = 0;

  return () =>
    timestamps[Math.min(index++, timestamps.length - 1)] ??
    timestamps[timestamps.length - 1] ??
    cleanupAt;
};

const createInventoryDevice = (
  overrides: Partial<DeviceRecord> = {}
): DeviceRecord => ({
  deviceId: "logic-1",
  label: "USB Logic Analyzer",
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
  dslogic: {
    family: "dslogic",
    model: "dslogic-plus",
    modelDisplayName: "DSLogic Plus",
    variant: "classic",
    usbVendorId: "2a0e",
    usbProductId: "0001"
  },
  ...overrides
});

const createReadyInventorySnapshot = (
  overrides: Partial<InventorySnapshot> = {}
): InventorySnapshot => ({
  refreshedAt: connectedAt,
  inventoryScope: {
    providerKinds: ["dslogic"],
    backendKinds: ["dsview-cli"]
  },
  devices: [createInventoryDevice()],
  backendReadiness: [
    {
      platform: "macos",
      backendKind: "dsview-cli",
      readiness: "ready",
      version: "1.2.2",
      checkedAt: connectedAt,
      diagnostics: []
    }
  ],
  diagnostics: [],
  ...overrides
});

type GenericLogicAnalyzerOfflineRequest = Exclude<
  GenericLogicAnalyzerRequest,
  { mode: "live" }
>;

const i2cDecoder: DsviewDecoderDetails = {
  id: "1:i2c",
  name: "1:I2C",
  longname: "Inter-Integrated Circuit",
  description: "Two-wire serial bus.",
  license: "gplv2+",
  inputs: [{ id: "logic" }],
  outputs: [{ id: "i2c" }],
  tags: ["Embedded/industrial"],
  requiredChannelIds: ["scl", "sda"],
  optionalChannelIds: [],
  optionIds: ["address_format"],
  annotationIds: ["start"],
  annotationRowIds: ["bits"],
  requiredChannels: [
    {
      id: "scl",
      name: "SCL",
      description: "Serial clock line",
      order: 0,
      channelType: 8,
      idn: "dec_1i2c_chan_scl"
    },
    {
      id: "sda",
      name: "SDA",
      description: "Serial data line",
      order: 1,
      channelType: 108,
      idn: "dec_1i2c_chan_sda"
    }
  ],
  optionalChannels: [],
  options: [
    {
      id: "address_format",
      idn: "dec_1i2c_opt_addr",
      description: "Displayed slave address format",
      defaultValue: "'unshifted'",
      values: ["'shifted'", "'unshifted'"]
    }
  ],
  annotations: [
    {
      id: "start",
      label: "start",
      description: "Start condition",
      annotationType: 1000
    }
  ],
  annotationRows: [
    {
      id: "bits",
      description: "Bits",
      annotationClasses: [5]
    }
  ]
};

const createDecodeConfig = (
  overrides: Partial<GenericLogicAnalyzerDecodeConfig> = {}
): GenericLogicAnalyzerDecodeConfig => ({
  decoderId: "1:i2c",
  decoder: i2cDecoder,
  channelMappings: {
    scl: "D0",
    sda: "D1"
  },
  decoderOptions: {
    address_format: "'unshifted'"
  },
  ...overrides
});

const createDecodeCommandRunner = (results: readonly DsviewDecodeCommandResult[]) => {
  const queue = [...results];
  const calls: Array<{
    command: string;
    args: readonly string[];
    timeoutMs: number;
    maxBufferBytes: number;
  }> = [];

  const executeCommand = async (
    command: string,
    args: readonly string[],
    options: { timeoutMs: number; maxBufferBytes: number }
  ): Promise<DsviewDecodeCommandResult> => {
    calls.push({
      command,
      args: [...args],
      timeoutMs: options.timeoutMs,
      maxBufferBytes: options.maxBufferBytes
    });

    const next = queue.shift();
    if (!next) {
      throw new Error(`No queued decode result for ${command} ${args.join(" ")}`);
    }

    return next;
  };

  return { executeCommand, calls };
};

const createOfflineRequest = (
  overrides: Partial<GenericLogicAnalyzerOfflineRequest> = {}
): GenericLogicAnalyzerOfflineRequest => ({
  session: {
    deviceId: "logic-1",
    ownerSkillId: "logic-analyzer",
    requestedAt: allocatedAt,
    sampling: {
      sampleRateHz: 1_000_000,
      captureDurationMs: 0.004,
      channels: [
        { channelId: "D0", label: "CLK" },
        { channelId: "D1", label: "DATA" }
      ]
    },
    analysis: {
      focusChannelIds: ["D0", "D1"],
      edgePolicy: "all",
      includePulseWidths: true,
      timeReference: "capture-start"
    }
  },
  artifact: {
    sourceName: "capture.csv",
    capturedAt: "2026-03-26T00:00:01.000Z",
    text: fixtureCsvText
  },
  cleanup: {
    endedAt: cleanupAt
  },
  ...overrides
});

const createLiveRequest = (
  overrides: Partial<Extract<GenericLogicAnalyzerRequest, { mode: "live" }>> = {}
): Extract<GenericLogicAnalyzerRequest, { mode: "live" }> => ({
  mode: "live",
  session: {
    deviceId: "logic-1",
    ownerSkillId: "logic-analyzer",
    requestedAt: allocatedAt,
    sampling: {
      sampleRateHz: 1_000_000,
      captureDurationMs: 0.004,
      channels: [
        { channelId: "D0", label: "CLK" },
        { channelId: "D1", label: "DATA" }
      ]
    },
    analysis: {
      focusChannelIds: ["D0", "D1"],
      edgePolicy: "all",
      includePulseWidths: true,
      timeReference: "capture-start"
    }
  },
  capture: {
    requestedAt: captureRequestedAt,
    timeoutMs: 1500
  },
  cleanup: {
    endedAt: cleanupAt
  },
  ...overrides
});

describe("generic logic analyzer contract", () => {
  it("exports the additive offline/live package contract through the root barrel", () => {
    expect(GENERIC_LOGIC_ANALYZER_MODES).toEqual(["artifact", "live"]);
    expect(GENERIC_LOGIC_ANALYZER_PHASES).toEqual([
      "request-validation",
      "start-session",
      "live-capture",
      "load-capture",
      "decode-validation",
      "decode-run",
      "completed"
    ]);

    expectTypeOf<GenericLogicAnalyzerRequest>().toMatchTypeOf<
      | {
          mode?: "artifact";
          session: { deviceId: string; sampling: { sampleRateHz: number } };
          artifact: { text?: string; bytes?: Uint8Array };
          cleanup: { endedAt: string };
          decode?: {
            decoderId: string;
            decoder: DsviewDecoderDetails;
            channelMappings: Readonly<Record<string, string>>;
          };
        }
      | {
          mode: "live";
          session: { deviceId: string; sampling: { sampleRateHz: number } };
          capture: { requestedAt: string; timeoutMs?: number; captureTuning?: { operation?: string } };
          cleanup: { endedAt: string };
        }
    >();

    expectTypeOf<GenericLogicAnalyzerResult>().toMatchTypeOf<
      | {
          ok: false;
          phase: "request-validation";
          issues: readonly { path: string; code: string }[];
          cleanup: { attempted: false; reason: "not-started" };
        }
      | {
          ok: false;
          phase: "start-session";
          startSession: {
            ok: false;
            reason: "invalid-request" | "constraint-rejected" | "allocation-failed";
          };
          cleanup: { attempted: false; reason: "not-started" };
        }
      | {
          ok: false;
          phase: "live-capture";
          session: LogicAnalyzerSessionRecord;
          captureSession: {
            ok: false;
            reason: "invalid-request" | "capture-runtime-failed" | "malformed-artifact";
          };
          cleanup: {
            attempted: true;
            request: { endedAt: string; deviceId: string; ownerSkillId: string };
            result: { ok: boolean };
          };
        }
      | {
          ok: false;
          phase: "load-capture";
          session: LogicAnalyzerSessionRecord;
          cleanup: {
            attempted: true;
            request: { endedAt: string; deviceId: string; ownerSkillId: string };
            result: { ok: boolean };
          };
        }
      | {
          ok: false;
          phase: "decode-validation" | "decode-run";
          session: LogicAnalyzerSessionRecord;
          capture: { ok: true; adapterId: string };
          analysis: WaveformAnalysisResult;
          decode: { ok: false; phase: "decode-validation" | "decode-run" };
          cleanup: { attempted: true; result: { ok: boolean } };
        }
      | {
          ok: true;
          phase: "completed";
          session: LogicAnalyzerSessionRecord;
          capture: { ok: true; adapterId: string };
          analysis: WaveformAnalysisResult;
          decode?: { ok: true; phase: "decode-run" };
        }
    >();
  });

  it("keeps offline callers working without changing their request shape", async () => {
    const provider = new FakeDeviceProvider(createReadyInventorySnapshot());
    const resourceManager = createResourceManager(provider, {
      now: createClock(connectedAt)
    });
    const skill = createGenericLogicAnalyzerSkill(resourceManager, {
      createSessionId: () => "session-001"
    });

    const result = await skill.run(createOfflineRequest());

    expect(result).toMatchObject({
      ok: true,
      phase: "completed",
      session: {
        sessionId: "session-001",
        deviceId: "logic-1",
        ownerSkillId: "logic-analyzer"
      },
      capture: {
        ok: true,
        adapterId: "sigrok-csv",
        selectedBy: "probe"
      }
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect("captureSession" in result).toBe(false);
      expect("decode" in result).toBe(false);
      expect(result.analysis.captureSource).toEqual({
        adapterId: "sigrok-csv",
        sourceName: "capture.csv",
        capturedAt: "2026-03-26T00:00:01.000Z"
      });
    }
  });

  it("returns offline decode reports alongside waveform outputs when decode is requested", async () => {
    const provider = new FakeDeviceProvider(createReadyInventorySnapshot());
    const resourceManager = createResourceManager(provider, {
      now: createClock(connectedAt)
    });
    const payload = {
      report: {
        annotations: [
          {
            row: "bits",
            start_sample: 0,
            end_sample: 3,
            text: ["START"]
          }
        ],
        rows: [{ id: "bits", label: "Bits" }]
      }
    };
    const { executeCommand, calls } = createDecodeCommandRunner([
      {
        ok: true,
        stdout: JSON.stringify(payload),
        stderr: ""
      }
    ]);
    const skill = createGenericLogicAnalyzerSkill(resourceManager, {
      createSessionId: () => "session-001",
      decodeRunnerOptions: {
        dsviewCliPath: "/opt/dsview/dsview-cli",
        decodeRuntimePath: "/opt/dsview/lib/libdsview_decode_runtime.so",
        decoderDir: "/opt/dsview/decoders",
        timeoutMs: 1234,
        maxBufferBytes: 4096,
        executeCommand
      }
    });

    const result = await skill.run(
      createOfflineRequest({
        decode: createDecodeConfig()
      })
    );

    expect(result).toMatchObject({
      ok: true,
      phase: "completed",
      session: {
        sessionId: "session-001",
        deviceId: "logic-1"
      },
      capture: {
        ok: true,
        adapterId: "sigrok-csv"
      },
      decode: {
        ok: true,
        phase: "decode-run",
        decoderId: "1:i2c",
        report: {
          decoderId: "1:i2c",
          annotations: [
            {
              row: "bits",
              start_sample: 0,
              end_sample: 3,
              text: ["START"]
            }
          ],
          rows: [{ id: "bits", label: "Bits" }],
          raw: payload
        },
        command: {
          command: "/opt/dsview/dsview-cli",
          stdout: JSON.stringify(payload),
          exitCode: null,
          nativeCode: null
        },
        cleanup: {
          attempted: true,
          ok: true
        }
      }
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.analysis.capabilityNotes.map((entry) => entry.code)).toEqual([
        "focus-channels-applied"
      ]);
      expect(result.analysis.summaryText).not.toContain("no protocol decoding is attempted");
      expect("captureSession" in result).toBe(false);
    }
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      command: "/opt/dsview/dsview-cli",
      timeoutMs: 1234,
      maxBufferBytes: 4096
    });
    expect(calls[0]?.args).toEqual([
      "decode",
      "run",
      "--decode-runtime",
      "/opt/dsview/lib/libdsview_decode_runtime.so",
      "--decoder-dir",
      "/opt/dsview/decoders",
      "--format",
      "json",
      "--decoder",
      "1:i2c",
      "--input",
      expect.stringContaining("artifact.logic"),
      "--channel",
      "scl=D0",
      "--channel",
      "sda=D1",
      "--option",
      "address_format='unshifted'"
    ]);
  });

  it("returns decode-validation failures with loaded capture, analysis, and session cleanup", async () => {
    const provider = new FakeDeviceProvider(createReadyInventorySnapshot());
    const resourceManager = createResourceManager(provider, {
      now: createClock(connectedAt)
    });
    const { executeCommand, calls } = createDecodeCommandRunner([]);
    const skill = createGenericLogicAnalyzerSkill(resourceManager, {
      createSessionId: () => "session-001",
      decodeRunnerOptions: { executeCommand }
    });

    const result = await skill.run(
      createOfflineRequest({
        decode: createDecodeConfig({
          channelMappings: { scl: "D0" }
        })
      })
    );

    expect(result).toMatchObject({
      ok: false,
      phase: "decode-validation",
      session: {
        sessionId: "session-001",
        deviceId: "logic-1"
      },
      capture: {
        ok: true,
        adapterId: "sigrok-csv"
      },
      decode: {
        ok: false,
        phase: "decode-validation",
        reason: "validation-failed",
        command: null,
        cleanup: {
          attempted: false,
          ok: false
        },
        issues: [
          expect.objectContaining({
            path: "channelMappings.sda",
            code: "missing-channel"
          })
        ]
      },
      cleanup: {
        attempted: true,
        request: {
          sessionId: "session-001",
          deviceId: "logic-1",
          ownerSkillId: "logic-analyzer",
          endedAt: cleanupAt
        },
        result: {
          ok: true,
          device: {
            allocationState: "free",
            ownerSkillId: null
          }
        }
      }
    });
    expect(calls).toEqual([]);
    expect(result.ok).toBe(false);
    if (!result.ok && result.phase === "decode-validation") {
      expect(result.analysis.capabilityNotes.map((entry) => entry.code)).toContain(
        "baseline-only-no-protocol-decoding"
      );
    }
  });

  it("returns decode-run failures with command diagnostics, temp cleanup, and session cleanup", async () => {
    const provider = new FakeDeviceProvider(createReadyInventorySnapshot());
    const resourceManager = createResourceManager(provider, {
      now: createClock(connectedAt)
    });
    const cliError = {
      code: "decoder_runtime_missing",
      message: "decoder runtime could not be loaded",
      detail: "Pass --decode-runtime or install bundled runtime."
    };
    const { executeCommand } = createDecodeCommandRunner([
      {
        ok: false,
        reason: "failed",
        stdout: JSON.stringify(cliError),
        stderr: "native stderr",
        exitCode: 2,
        signal: null,
        nativeCode: 2
      }
    ]);
    const skill = createGenericLogicAnalyzerSkill(resourceManager, {
      createSessionId: () => "session-001",
      decodeRunnerOptions: { executeCommand }
    });

    const result = await skill.run(
      createOfflineRequest({
        decode: createDecodeConfig()
      })
    );

    expect(result).toMatchObject({
      ok: false,
      phase: "decode-run",
      capture: {
        ok: true,
        adapterId: "sigrok-csv"
      },
      decode: {
        ok: false,
        phase: "decode-run",
        reason: "cli-error",
        code: "decoder_runtime_missing",
        message: "decoder runtime could not be loaded",
        detail: "Pass --decode-runtime or install bundled runtime.",
        command: {
          stdout: JSON.stringify(cliError),
          stderr: "native stderr",
          exitCode: 2,
          signal: null,
          nativeCode: 2
        },
        cleanup: {
          attempted: true,
          ok: true
        }
      },
      cleanup: {
        attempted: true,
        result: {
          ok: true,
          device: {
            allocationState: "free",
            ownerSkillId: null
          }
        }
      }
    });
  });

  it("rejects unknown request discriminants before allocation", async () => {
    const provider = new FakeDeviceProvider(createReadyInventorySnapshot());
    const resourceManager = createResourceManager(provider, {
      now: createClock(connectedAt)
    });

    const result = await runGenericLogicAnalyzer(resourceManager, {
      ...createOfflineRequest(),
      mode: "stream"
    });

    expect(result).toEqual({
      ok: false,
      phase: "request-validation",
      issues: [
        {
          path: "mode",
          code: "invalid-value",
          message: "mode must be one of artifact, live."
        }
      ],
      cleanup: {
        attempted: false,
        reason: "not-started"
      }
    });
    expect(await resourceManager.listDevices()).toEqual([]);
  });

  it("rejects live requests that omit the live capture config", async () => {
    const provider = new FakeDeviceProvider(createReadyInventorySnapshot());
    const resourceManager = createResourceManager(provider, {
      now: createClock(connectedAt)
    });

    const result = await runGenericLogicAnalyzer(resourceManager, {
      mode: "live",
      session: createLiveRequest().session,
      cleanup: { endedAt: cleanupAt }
    });

    expect(result).toEqual({
      ok: false,
      phase: "request-validation",
      issues: [
        {
          path: "capture",
          code: "required",
          message: "capture is required."
        }
      ],
      cleanup: {
        attempted: false,
        reason: "not-started"
      }
    });
    expect(await resourceManager.listDevices()).toEqual([]);
  });

  it("rejects malformed live capture tuning before allocation", async () => {
    const provider = new FakeDeviceProvider(createReadyInventorySnapshot());
    const resourceManager = createResourceManager(provider, {
      now: createClock(connectedAt)
    });

    const result = await runGenericLogicAnalyzer(
      resourceManager,
      createLiveRequest({
        capture: {
          requestedAt: captureRequestedAt,
          timeoutMs: 1500,
          captureTuning: {
            operation: "",
            channel: 42 as unknown as string
          }
        }
      })
    );

    expect(result).toEqual({
      ok: false,
      phase: "request-validation",
      issues: [
        {
          path: "capture.captureTuning.operation",
          code: "invalid-type",
          message: "capture.captureTuning.operation must be a non-empty string when provided."
        },
        {
          path: "capture.captureTuning.channel",
          code: "invalid-type",
          message: "capture.captureTuning.channel must be a non-empty string when provided."
        }
      ],
      cleanup: {
        attempted: false,
        reason: "not-started"
      }
    });
    expect(await resourceManager.listDevices()).toEqual([]);
  });

  it("rejects offline requests that do not provide artifact text or bytes", async () => {
    const provider = new FakeDeviceProvider(createReadyInventorySnapshot());
    const resourceManager = createResourceManager(provider, {
      now: createClock(connectedAt)
    });

    const result = await runGenericLogicAnalyzer(
      resourceManager,
      createOfflineRequest({
        artifact: {
          sourceName: "capture.csv",
          capturedAt: "2026-03-26T00:00:01.000Z"
        }
      })
    );

    expect(result).toEqual({
      ok: false,
      phase: "request-validation",
      issues: [
        {
          path: "artifact",
          code: "required",
          message: "artifact must include non-empty text or bytes."
        }
      ],
      cleanup: {
        attempted: false,
        reason: "not-started"
      }
    });
    expect(await resourceManager.listDevices()).toEqual([]);
  });

  it("proves the same packaged known pattern through live capture and leaves cleanup explicit on success", async () => {
    const provider = new FakeDeviceProvider(createReadyInventorySnapshot());
    const resourceManager = createResourceManager(provider, {
      now: createClock(connectedAt),
      liveCaptureRunner: createDslogicLiveCaptureRunner(async (request) => {
        expect(request.captureTuning).toEqual({
          operation: "collect",
          channel: "buffer",
          stop: "samples",
          filter: "none",
          threshold: "1.8v"
        });

        return {
          ok: true,
          artifact: {
            sourceName: "logic-1-live.vcd",
            formatHint: "dsview-vcd",
            mediaType: "text/x-vcd",
            capturedAt: captureRequestedAt,
            text: fixtureVcdText
          }
        };
      })
    });
    const skill = createGenericLogicAnalyzerSkill(resourceManager, {
      createSessionId: () => "session-001"
    });

    const result = await skill.run(
      createLiveRequest({
        capture: {
          requestedAt: captureRequestedAt,
          timeoutMs: 1500,
          captureTuning: {
            operation: "collect",
            channel: "buffer",
            stop: "samples",
            filter: "none",
            threshold: "1.8v"
          }
        }
      })
    );

    expect(result).toMatchObject({
      ok: true,
      phase: "completed",
      session: {
        sessionId: "session-001",
        deviceId: "logic-1",
        ownerSkillId: "logic-analyzer"
      },
      capture: {
        ok: true,
        adapterId: "dsview-vcd",
        selectedBy: "format-hint"
      },
      captureSession: {
        ok: true,
        requestedAt: captureRequestedAt,
        providerKind: "dslogic",
        backendKind: "dsview-cli",
        artifactSummary: {
          sourceName: "logic-1-live.vcd",
          formatHint: "dsview-vcd",
          hasText: true
        }
      }
    });
    expect(result.ok).toBe(true);
    if (result.ok && "captureSession" in result) {
      expect("cleanup" in result).toBe(false);
      expect(result.captureSession.capture.capture).toEqual({
        adapterId: "dsview-vcd",
        sourceName: "logic-1-live.vcd",
        capturedAt: captureRequestedAt,
        sampleRateHz: 1_000_000,
        samplePeriodNs: 1000,
        totalSamples: 4,
        durationNs: 4000,
        artifact: {
          sourceName: "logic-1-live.vcd",
          hasText: true,
          formatHint: "dsview-vcd",
          mediaType: "text/x-vcd",
          capturedAt: captureRequestedAt,
          byteLength: null
        },
        channels: expect.any(Array)
      });
      expect(result.analysis.analyzedChannelIds).toEqual(["D0", "D1"]);
      expect(result.analysis.channels).toEqual([
        expect.objectContaining({
          channelId: "D0",
          observedEdgeKinds: ["rising", "falling"],
          qualifyingTransitionCount: 2,
          summaryText:
            "2 rising/falling edges observed, rhythm is steady at about 500000Hz, high widths avg 2000ns, low widths avg 1000ns."
        }),
        expect.objectContaining({
          channelId: "D1",
          observedEdgeKinds: ["falling"],
          qualifyingTransitionCount: 1,
          summaryText:
            "1 falling edge observed, insufficient data for rhythm, high widths avg 2000ns, low widths avg 2000ns."
        })
      ]);
      expect(result.analysis.capabilityNotes).toEqual([
        {
          code: "focus-channels-applied",
          message: "Analysis is limited to the requested focus channels.",
          details: {
            requestedChannelCount: 2,
            analyzedChannelCount: 2
          }
        },
        {
          code: "baseline-only-no-protocol-decoding",
          message: "Structured output only covers baseline waveform interpretation."
        }
      ]);
    }
    expect(await resourceManager.listDevices()).toEqual([
      expect.objectContaining({
        deviceId: "logic-1",
        allocationState: "allocated",
        ownerSkillId: "logic-analyzer"
      })
    ]);
  });

  it("preserves capture runtime failures as live-capture failures with timeout diagnostics and cleanup status", async () => {
    const provider = new FakeDeviceProvider(createReadyInventorySnapshot());
    const resourceManager = createResourceManager(provider, {
      now: createClock(connectedAt),
      liveCaptureRunner: createDslogicLiveCaptureRunner(async () => ({
        ok: false,
        kind: "timeout",
        phase: "capture",
        message: "dsview-cli capture timed out.",
        timeoutMs: 1500,
        stderr: {
          text: "Capture did not complete within 1500ms."
        }
      }))
    });
    const skill = createGenericLogicAnalyzerSkill(resourceManager, {
      createSessionId: () => "session-001"
    });

    const result = await skill.run(createLiveRequest());

    expect(result).toMatchObject({
      ok: false,
      phase: "live-capture",
      session: {
        sessionId: "session-001",
        deviceId: "logic-1"
      },
      captureSession: {
        ok: false,
        reason: "capture-runtime-failed",
        requestedAt: captureRequestedAt,
        captureRuntime: {
          ok: false,
          kind: "timeout",
          diagnostics: {
            phase: "capture",
            timeoutMs: 1500
          }
        }
      },
      cleanup: {
        attempted: true,
        request: {
          sessionId: "session-001",
          deviceId: "logic-1",
          ownerSkillId: "logic-analyzer",
          endedAt: cleanupAt
        },
        result: {
          ok: true,
          device: {
            deviceId: "logic-1",
            allocationState: "free",
            ownerSkillId: null
          }
        }
      }
    });
  });

  it("preserves malformed live artifacts as a dedicated live-capture failure with cleanup status", async () => {
    const sessionDevice = createInventoryDevice({
      allocationState: "allocated",
      ownerSkillId: "logic-analyzer",
      updatedAt: allocatedAt
    });
    const session: LogicAnalyzerSessionRecord = {
      sessionId: "session-001",
      deviceId: "logic-1",
      ownerSkillId: "logic-analyzer",
      startedAt: allocatedAt,
      device: sessionDevice,
      sampling: createLiveRequest().session.sampling,
      analysis: createLiveRequest().session.analysis
    };
    const snapshot = createReadyInventorySnapshot({
      devices: [sessionDevice]
    });
    const resourceManager: SnapshotResourceManager = {
      async refreshInventory() {
        return snapshot.devices;
      },
      async refreshInventorySnapshot() {
        return snapshot;
      },
      async getInventorySnapshot() {
        return snapshot;
      },
      async listDevices() {
        return snapshot.devices;
      },
      async allocateDevice() {
        return { ok: true, device: sessionDevice };
      },
      async releaseDevice() {
        return {
          ok: true,
          device: createInventoryDevice({
            allocationState: "free",
            ownerSkillId: null,
            updatedAt: cleanupAt
          })
        };
      },
      async inspectDeviceOptions(optionsRequest) {
        return {
          ok: false,
          reason: "device-options-failed",
          kind: "unsupported-runtime",
          message: "unused",
          session: optionsRequest.session,
          requestedAt: optionsRequest.requestedAt,
          capabilities: null,
          diagnostics: {
            phase: "validate-session",
            providerKind: optionsRequest.session.device.providerKind ?? null,
            backendKind: optionsRequest.session.device.backendKind ?? null,
            backendVersion: null,
            timeoutMs: optionsRequest.timeoutMs ?? null,
            nativeCode: null,
            optionsOutput: null,
            diagnosticOutput: null,
            details: [],
            diagnostics: optionsRequest.session.device.diagnostics ?? []
          }
        };
      },
      async listDecoderCapabilities() {
        throw new Error("unused");
      },
      async captureDecode() {
        throw new Error("unused");
      },
      async liveCapture() {
        return {
          ok: true,
          providerKind: "dslogic",
          backendKind: "dsview-cli",
          session: {
            sessionId: session.sessionId,
            deviceId: session.deviceId,
            ownerSkillId: session.ownerSkillId,
            startedAt: session.startedAt,
            device: session.device,
            sampling: session.sampling
          },
          requestedAt: captureRequestedAt,
          artifact: {
            sourceName: "broken-live.vcd",
            formatHint: "dsview-vcd"
          },
          artifactSummary: {
            sourceName: "broken-live.vcd",
            formatHint: "dsview-vcd",
            mediaType: null,
            capturedAt: null,
            byteLength: null,
            textLength: null,
            hasText: false
          }
        };
      }
    };

    const result = await runGenericLogicAnalyzer(
      resourceManager,
      createLiveRequest(),
      {
        createSessionId: () => "session-001"
      }
    );

    expect(result).toEqual({
      ok: false,
      phase: "live-capture",
      session,
      captureSession: {
        ok: false,
        reason: "malformed-artifact",
        session,
        requestedAt: captureRequestedAt,
        providerKind: "dslogic",
        backendKind: "dsview-cli",
        artifactSummary: {
          sourceName: "broken-live.vcd",
          formatHint: "dsview-vcd",
          mediaType: null,
          capturedAt: null,
          byteLength: null,
          textLength: null,
          hasText: false
        },
        issues: [
          {
            path: "capture.artifact",
            code: "required",
            message: "Live capture response must include non-empty artifact text or bytes."
          }
        ]
      },
      cleanup: {
        attempted: true,
        request: {
          sessionId: "session-001",
          deviceId: "logic-1",
          ownerSkillId: "logic-analyzer",
          endedAt: cleanupAt
        },
        result: {
          ok: true,
          device: createInventoryDevice({
            allocationState: "free",
            ownerSkillId: null,
            updatedAt: cleanupAt
          })
        }
      }
    });
  });

  it("keeps loader incompatibility after live capture as a separate load-capture failure", async () => {
    const provider = new FakeDeviceProvider(createReadyInventorySnapshot());
    const resourceManager = createResourceManager(provider, {
      now: createClock(connectedAt),
      liveCaptureRunner: createDslogicLiveCaptureRunner(async () => ({
        ok: true,
        artifact: {
          sourceName: "logic-1-incompatible.vcd",
          formatHint: "dsview-vcd",
          capturedAt: captureRequestedAt,
          text: incompatibleFixtureVcdText
        }
      }))
    });
    const skill = createGenericLogicAnalyzerSkill(resourceManager, {
      createSessionId: () => "session-001"
    });

    const result = await skill.run(createLiveRequest());

    expect(result).toMatchObject({
      ok: false,
      phase: "load-capture",
      session: {
        sessionId: "session-001",
        deviceId: "logic-1"
      },
      captureSession: {
        ok: false,
        reason: "load-capture-failed",
        requestedAt: captureRequestedAt,
        providerKind: "dslogic",
        backendKind: "dsview-cli",
        artifactSummary: {
          sourceName: "logic-1-incompatible.vcd",
          hasText: true
        },
        loadCapture: {
          ok: false,
          reason: "incompatible-session",
          issues: expect.arrayContaining([
            expect.objectContaining({
              code: "missing-channel",
              channelId: "D1"
            })
          ])
        }
      },
      cleanup: {
        attempted: true,
        result: {
          ok: true,
          device: {
            allocationState: "free",
            ownerSkillId: null
          }
        }
      }
    });
  });

  it("preserves start-session allocation failures without attempting cleanup", async () => {
    const provider = new FakeDeviceProvider(createReadyInventorySnapshot());
    const resourceManager = createResourceManager(provider, {
      now: createClock(connectedAt, conflictingAt)
    });
    const skill = createGenericLogicAnalyzerSkill(resourceManager, {
      createSessionId: () => "session-001"
    });

    const firstResult = await skill.run(createOfflineRequest());
    const conflictingResult = await skill.run(
      createOfflineRequest({
        session: {
          ...createOfflineRequest().session,
          ownerSkillId: "other-skill",
          requestedAt: conflictingAt
        }
      })
    );

    expect(firstResult.ok).toBe(true);
    expect(conflictingResult).toMatchObject({
      ok: false,
      phase: "start-session",
      startSession: {
        ok: false,
        reason: "allocation-failed",
        allocation: {
          ok: false,
          reason: "device-already-allocated",
          deviceId: "logic-1",
          ownerSkillId: "other-skill"
        }
      },
      cleanup: {
        attempted: false,
        reason: "not-started"
      }
    });
  });
});
