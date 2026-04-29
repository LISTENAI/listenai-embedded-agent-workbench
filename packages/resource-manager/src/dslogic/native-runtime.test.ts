import { describe, expect, it } from "vitest"
import type { DeviceOptionsRequest, LiveCaptureRequest } from "@listenai/eaw-contracts"
import {
  createDefaultDslogicNativeCaptureDecodeBackend,
  createDefaultDslogicNativeDecoderCapabilitiesBackend,
  createDefaultDslogicNativeDeviceOptionsBackend,
  createDefaultDslogicNativeLiveCaptureBackend,
  createDslogicNativeRuntime,
  type DslogicNativeCommandResult,
  type DslogicNativeCommandRunner
} from "./native-runtime.js"

const checkedAt = "2026-04-02T04:00:00.000Z"

const createCommandRunner = (results: readonly DslogicNativeCommandResult[]) => {
  const queue = [...results]
  const calls: Array<{
    command: string
    args: readonly string[]
    timeoutMs: number
    maxBufferBytes: number
  }> = []

  const runner: DslogicNativeCommandRunner = async (command, args, options) => {
    calls.push({
      command,
      args: [...args],
      timeoutMs: options.timeoutMs,
      maxBufferBytes: options.maxBufferBytes
    })

    const next = queue.shift()
    if (!next) {
      throw new Error(`No queued command result for ${command} ${args.join(" ")}`)
    }

    return next
  }

  return { runner, calls }
}

const createCaptureRequest = (overrides: Partial<LiveCaptureRequest> = {}): LiveCaptureRequest => ({
  session: {
    sessionId: "session-1",
    deviceId: "dslogic-plus",
    ownerSkillId: "logic-analyzer",
    startedAt: checkedAt,
    device: {
      deviceId: "dslogic-plus",
      label: "DSLogic Plus",
      capabilityType: "logic-analyzer",
      connectionState: "connected",
      allocationState: "allocated",
      ownerSkillId: "logic-analyzer",
      lastSeenAt: checkedAt,
      updatedAt: checkedAt,
      readiness: "ready",
      diagnostics: [],
      providerKind: "dslogic",
      backendKind: "dsview-cli",
      dslogic: {
        family: "dslogic",
        model: "dslogic-plus",
        modelDisplayName: "DSLogic Plus",
        variant: "classic",
        usbVendorId: null,
        usbProductId: null
      }
    },
    sampling: {
      sampleRateHz: 1_000_000,
      captureDurationMs: 4,
      channels: [{ channelId: "D0", label: "CLK" }]
    }
  },
  requestedAt: checkedAt,
  timeoutMs: 3_000,
  ...overrides
})

const createOptionsRequest = (): DeviceOptionsRequest => ({
  session: createCaptureRequest().session,
  requestedAt: checkedAt,
  timeoutMs: 3_000
})

describe("native-runtime", () => {
  it("returns unsupported-os for hosts outside the modeled platform list", async () => {
    const { runner, calls } = createCommandRunner([])
    const runtime = createDslogicNativeRuntime({
      now: () => checkedAt,
      getHostOs: () => "freebsd",
      getHostArch: () => "arm64",
      executeCommand: runner
    })

    await expect(runtime.probe()).resolves.toEqual({
      checkedAt,
      host: {
        platform: "linux",
        os: "freebsd",
        arch: "arm64"
      },
      runtime: {
        state: "unsupported-os",
        libraryPath: null,
        binaryPath: null,
        version: null
      },
      devices: [],
      diagnostics: []
    })
    expect(calls).toEqual([])
  })

  it("probes linux hosts through dsview-cli instead of short-circuiting to missing", async () => {
    const { runner, calls } = createCommandRunner([
      {
        ok: true,
        stdout: "dsview-cli 1.0.3\n",
        stderr: ""
      }
    ])

    const runtime = createDslogicNativeRuntime({
      now: () => checkedAt,
      getHostOs: () => "linux",
      getHostArch: () => "x64",
      executeCommand: runner
    })

    await expect(runtime.probe()).resolves.toEqual({
      checkedAt,
      host: {
        platform: "linux",
        os: "linux",
        arch: "x64"
      },
      runtime: {
        state: "ready",
        libraryPath: null,
        binaryPath: null,
        version: "1.0.3"
      },
      devices: [],
      diagnostics: []
    })
    expect(calls).toEqual([
      {
        command: "dsview-cli",
        args: ["--version"],
        timeoutMs: 3_000,
        maxBufferBytes: 64 * 1024
      }
    ])
  })

  it("prefers an explicitly configured dsview-cli bundle path over PATH fallback", async () => {
    const { runner, calls } = createCommandRunner([
      {
        ok: true,
        stdout: "dsview-cli 1.0.3\n",
        stderr: "bundle path=/Applications/DSView.app/Contents/MacOS/dsview-cli\n"
      }
    ])

    const runtime = createDslogicNativeRuntime({
      now: () => checkedAt,
      getHostOs: () => "darwin",
      getHostArch: () => "arm64",
      executeCommand: runner,
      dsviewCliPath: "/Applications/DSView.app/Contents/MacOS/dsview-cli",
      probeTimeoutMs: 1234
    })

    await expect(runtime.probe()).resolves.toEqual({
      checkedAt,
      host: {
        platform: "macos",
        os: "darwin",
        arch: "arm64"
      },
      runtime: {
        state: "ready",
        libraryPath: "/Applications/DSView.app/Contents/MacOS/dsview-cli",
        binaryPath: "/Applications/DSView.app/Contents/MacOS/dsview-cli",
        version: "1.0.3"
      },
      devices: [],
      diagnostics: []
    })
    expect(calls).toEqual([
      {
        command: "/Applications/DSView.app/Contents/MacOS/dsview-cli",
        args: ["--version"],
        timeoutMs: 1234,
        maxBufferBytes: 64 * 1024
      }
    ])
  })

  it("keeps PATH fallback explicit when no bundle path is configured", async () => {
    const { runner, calls } = createCommandRunner([
      {
        ok: true,
        stdout: "DSView CLI v1.0.3\n",
        stderr: "resolved executable /opt/dsview/bin/dsview-cli\n"
      }
    ])

    const runtime = createDslogicNativeRuntime({
      now: () => checkedAt,
      getHostOs: () => "darwin",
      getHostArch: () => "arm64",
      executeCommand: runner
    })

    await expect(runtime.probe()).resolves.toMatchObject({
      runtime: {
        state: "ready",
        libraryPath: "/opt/dsview/bin/dsview-cli",
        binaryPath: "/opt/dsview/bin/dsview-cli",
        version: "1.0.3"
      },
      devices: [],
      diagnostics: []
    })
    expect(calls).toEqual([
      {
        command: "dsview-cli",
        args: ["--version"],
        timeoutMs: 3_000,
        maxBufferBytes: 64 * 1024
      }
    ])
  })

  it("maps a missing configured dsview-cli bundle into the missing-runtime diagnostic", async () => {
    const { runner, calls } = createCommandRunner([
      {
        ok: false,
        reason: "missing",
        stdout: "",
        stderr: "",
        exitCode: null,
        signal: null,
        nativeCode: "ENOENT"
      }
    ])

    const runtime = createDslogicNativeRuntime({
      now: () => checkedAt,
      getHostOs: () => "darwin",
      getHostArch: () => "arm64",
      executeCommand: runner,
      dsviewCliPath: "/opt/dsview/bin/dsview-cli"
    })

    await expect(runtime.probe()).resolves.toEqual({
      checkedAt,
      host: {
        platform: "macos",
        os: "darwin",
        arch: "arm64"
      },
      runtime: {
        state: "missing",
        libraryPath: null,
        binaryPath: null,
        version: null
      },
      devices: [],
      diagnostics: [
        {
          code: "backend-missing-runtime",
          message: "dsview-cli runtime is not available on macos.",
          libraryPath: null,
          binaryPath: null,
          backendVersion: null
        }
      ]
    })
    expect(calls).toHaveLength(1)
  })

  it("maps dsview-cli probe timeouts into the timeout state", async () => {
    const { runner } = createCommandRunner([
      {
        ok: false,
        reason: "timeout",
        stdout: "dsview-cli 1.0.3\n",
        stderr: "",
        exitCode: null,
        signal: "SIGTERM",
        nativeCode: null
      }
    ])

    const runtime = createDslogicNativeRuntime({
      now: () => checkedAt,
      getHostOs: () => "darwin",
      getHostArch: () => "arm64",
      executeCommand: runner
    })

    await expect(runtime.probe()).resolves.toMatchObject({
      runtime: {
        state: "timeout",
        libraryPath: null,
        binaryPath: null,
        version: null
      },
      diagnostics: [
        {
          code: "backend-runtime-timeout",
          message: "dsview-cli runtime probe timed out before readiness was confirmed on macos."
        }
      ]
    })
  })

  it("maps non-zero dsview-cli failures into the failed state", async () => {
    const { runner } = createCommandRunner([
      {
        ok: false,
        reason: "failed",
        stdout: "",
        stderr: "bundle bootstrap failed",
        exitCode: 2,
        signal: null,
        nativeCode: 2
      }
    ])

    const runtime = createDslogicNativeRuntime({
      now: () => checkedAt,
      getHostOs: () => "darwin",
      getHostArch: () => "arm64",
      executeCommand: runner
    })

    await expect(runtime.probe()).resolves.toMatchObject({
      runtime: {
        state: "failed",
        libraryPath: null,
        binaryPath: null,
        version: null
      },
      diagnostics: [
        {
          code: "backend-runtime-failed",
          message: "dsview-cli runtime probe failed on macos.",
          libraryPath: null,
          binaryPath: null,
          backendVersion: null
        }
      ]
    })
  })

  it("rejects malformed dsview-cli version output without inventing readiness", async () => {
    const { runner, calls } = createCommandRunner([
      {
        ok: true,
        stdout: "bundle ready\n",
        stderr: "version unknown\n"
      }
    ])

    const runtime = createDslogicNativeRuntime({
      now: () => checkedAt,
      getHostOs: () => "darwin",
      getHostArch: () => "arm64",
      executeCommand: runner
    })

    await expect(runtime.probe()).resolves.toMatchObject({
      runtime: {
        state: "malformed",
        libraryPath: null,
        binaryPath: null,
        version: null
      },
      diagnostics: [
        {
          code: "backend-runtime-malformed-response",
          message: "dsview-cli runtime probe returned malformed output on macos."
        }
      ]
    })
    expect(calls).toHaveLength(1)
  })

  it("returns runtime-unavailable when the default capture backend cannot prepare dsview-cli", async () => {
    const backend = createDefaultDslogicNativeLiveCaptureBackend({
      runtime: {
        probe: async () => ({
          checkedAt,
          host: {
            platform: "linux",
            os: "linux",
            arch: "x64"
          },
          runtime: {
            state: "missing",
            libraryPath: null,
            binaryPath: null,
            version: null
          },
          devices: [],
          diagnostics: [
            {
              code: "backend-missing-runtime",
              message: "dsview-cli runtime is not available on linux.",
              libraryPath: null,
              binaryPath: null,
              backendVersion: null
            }
          ]
        })
      }
    })

    await expect(backend.capture(createCaptureRequest())).resolves.toEqual({
      ok: false,
      kind: "runtime-unavailable",
      phase: "prepare-runtime",
      message: "dsview-cli runtime is not available on linux.",
      backendVersion: null,
      nativeCode: "backend-missing-runtime",
      details: ["dsview-cli binary path could not be resolved."]
    })
  })

  it("captures a VCD artifact through dsview-cli and cleans up temporary files", async () => {
    const { runner, calls } = createCommandRunner([
      {
        ok: true,
        stdout: "sr: lib_main: Scan all connected hardware device.\n{\n  \"devices\": [\n    {\n      \"handle\": 1,\n      \"stable_id\": \"dslogic-plus\",\n      \"model\": \"DSLogic Plus\",\n      \"native_name\": \"DSLogic PLus\"\n    }\n  ]\n}\n",
        stderr: ""
      },
      {
        ok: true,
        stdout: "sr: lib_main: Start collect.\n{\n  \"selected_handle\": 1,\n  \"completion\": \"clean_success\",\n  \"artifacts\": {\n    \"vcd_path\": \"/tmp/dslogic-capture-test/dslogic-plus.vcd\",\n    \"metadata_path\": \"/tmp/dslogic-capture-test/dslogic-plus.json\"\n  }\n}\n",
        stderr: ""
      }
    ])
    const removedTempDirs: string[] = []
    const backend = createDefaultDslogicNativeLiveCaptureBackend({
      runtime: {
        probe: async () => ({
          checkedAt,
          host: {
            platform: "linux",
            os: "linux",
            arch: "x64"
          },
          runtime: {
            state: "ready",
            libraryPath: "/usr/bin/dsview-cli",
            binaryPath: "/usr/bin/dsview-cli",
            version: "1.2.2"
          },
          devices: [],
          diagnostics: []
        })
      },
      executeCommand: runner,
      createTempDir: async () => "/tmp/dslogic-capture-test",
      dsviewResourceDir: "/opt/dsview/resources",
      removeTempDir: async (path) => {
        removedTempDirs.push(path)
      },
      readTextFile: async (path) => {
        if (path.endsWith(".vcd")) {
          return "$date\n  2026-04-02T04:00:00.000Z\n$end\n#0\n1!\n"
        }

        if (path.endsWith(".json")) {
          return JSON.stringify({
            tool: {
              version: "v1.2.2"
            },
            capture: {
              timestamp_utc: "2026-04-02T04:00:01.000Z",
              sample_rate_hz: 1_000_000,
              actual_sample_count: 256,
              requested_sample_limit: 4_000
            }
          })
        }

        throw new Error(`Unexpected read path: ${path}`)
      }
    })

    await expect(backend.capture(createCaptureRequest())).resolves.toEqual({
      ok: true,
      backendVersion: "v1.2.2",
      diagnosticOutput: {
        text: "sr: lib_main: Start collect.\n{\n  \"selected_handle\": 1,\n  \"completion\": \"clean_success\",\n  \"artifacts\": {\n    \"vcd_path\": \"/tmp/dslogic-capture-test/dslogic-plus.vcd\",\n    \"metadata_path\": \"/tmp/dslogic-capture-test/dslogic-plus.json\"\n  }\n}\n"
      },
      artifact: {
        sourceName: "dslogic-plus.vcd",
        formatHint: "dsview-vcd",
        mediaType: "text/x-vcd",
        capturedAt: "2026-04-02T04:00:01.000Z",
        sampling: {
          sampleRateHz: 1_000_000,
          totalSamples: 256,
          requestedSampleLimit: 4_000
        },
        text: "$date\n  2026-04-02T04:00:00.000Z\n$end\n#0\n1!\n"
      },
      auxiliaryArtifacts: [
        {
          sourceName: "dslogic-plus.json",
          formatHint: "dsview-capture-metadata",
          mediaType: "application/json",
          capturedAt: "2026-04-02T04:00:01.000Z",
          text: JSON.stringify({
            tool: {
              version: "v1.2.2"
            },
            capture: {
              timestamp_utc: "2026-04-02T04:00:01.000Z",
              sample_rate_hz: 1_000_000,
              actual_sample_count: 256,
              requested_sample_limit: 4_000
            }
          })
        }
      ]
    })
    expect(calls).toEqual([
      {
        command: "/usr/bin/dsview-cli",
        args: ["devices", "list", "--format", "json"],
        timeoutMs: 3_000,
        maxBufferBytes: 512 * 1024
      },
      {
        command: "/usr/bin/dsview-cli",
        args: [
          "capture",
          "--resource-dir",
          "/opt/dsview/resources",
          "--format",
          "json",
          "--handle",
          "1",
          "--sample-rate-hz",
          "1000000",
          "--sample-limit",
          "4000",
          "--channels",
          "0",
          "--output",
          "/tmp/dslogic-capture-test/dslogic-plus.vcd",
          "--metadata-output",
          "/tmp/dslogic-capture-test/dslogic-plus.json",
          "--wait-timeout-ms",
          "3000",
          "--poll-interval-ms",
          "50"
        ],
        timeoutMs: 3_000,
        maxBufferBytes: 512 * 1024
      }
    ])
    expect(removedTempDirs).toEqual(["/tmp/dslogic-capture-test"])
  })

  it("looks up DSLogic native options from noisy JSON output", async () => {
    const { runner, calls } = createCommandRunner([
      {
        ok: true,
        stdout: "noise before\n{\"devices\":[{\"handle\":7,\"stable_id\":\"dslogic-plus\",\"model\":\"DSLogic Plus\"}]}\nnoise after",
        stderr: ""
      },
      {
        ok: true,
        stdout: "sr: options follow\n{\"capabilities\":{\"operations\":[{\"token\":\"collect\",\"label\":\"Collect\"}],\"channels\":[\"buffer\"],\"stop_conditions\":[\"samples\"],\"filters\":[\"none\"],\"thresholds\":[{\"value\":\"1.8v\",\"description\":\"CMOS 1.8V\"}]}}\n",
        stderr: ""
      }
    ])
    const backend = createDefaultDslogicNativeDeviceOptionsBackend({
      runtime: {
        probe: async () => ({
          checkedAt,
          host: { platform: "linux", os: "linux", arch: "x64" },
          runtime: {
            state: "ready",
            libraryPath: "/usr/bin/dsview-cli",
            binaryPath: "/usr/bin/dsview-cli",
            version: "1.2.2"
          },
          devices: [],
          diagnostics: []
        })
      },
      executeCommand: runner
    })

    await expect(backend.inspectDeviceOptions(createOptionsRequest())).resolves.toEqual({
      ok: true,
      backendVersion: "1.2.2",
      capabilities: {
        operations: [{ token: "collect", label: "Collect" }],
        channels: [{ token: "buffer" }],
        stopConditions: [{ token: "samples" }],
        filters: [{ token: "none" }],
        thresholds: [{ token: "1.8v", description: "CMOS 1.8V" }]
      },
      optionsOutput: {
        text: "sr: options follow\n{\"capabilities\":{\"operations\":[{\"token\":\"collect\",\"label\":\"Collect\"}],\"channels\":[\"buffer\"],\"stop_conditions\":[\"samples\"],\"filters\":[\"none\"],\"thresholds\":[{\"value\":\"1.8v\",\"description\":\"CMOS 1.8V\"}]}}\n"
      }
    })
    expect(calls).toEqual([
      {
        command: "/usr/bin/dsview-cli",
        args: ["devices", "list", "--format", "json"],
        timeoutMs: 3_000,
        maxBufferBytes: 512 * 1024
      },
      {
        command: "/usr/bin/dsview-cli",
        args: ["devices", "options", "--format", "json", "--handle", "7"],
        timeoutMs: 3_000,
        maxBufferBytes: 256 * 1024
      }
    ])
  })

  it("reports malformed DSLogic options JSON as a parse-options failure", async () => {
    const { runner } = createCommandRunner([
      {
        ok: true,
        stdout: "{\"devices\":[{\"handle\":1,\"stable_id\":\"dslogic-plus\"}]}",
        stderr: ""
      },
      {
        ok: true,
        stdout: "{\"capabilities\":{\"operations\":\"collect\"}}",
        stderr: ""
      }
    ])
    const backend = createDefaultDslogicNativeDeviceOptionsBackend({
      runtime: {
        probe: async () => ({
          checkedAt,
          host: { platform: "linux", os: "linux", arch: "x64" },
          runtime: { state: "ready", libraryPath: null, binaryPath: null, version: "1.2.2" },
          devices: [],
          diagnostics: []
        })
      },
      executeCommand: runner
    })

    await expect(backend.inspectDeviceOptions(createOptionsRequest())).resolves.toMatchObject({
      ok: false,
      kind: "malformed-output",
      phase: "parse-options",
      message: "dsview-cli device options output did not include parseable capability tokens.",
      optionsOutput: {
        text: "{\"capabilities\":{\"operations\":\"collect\"}}"
      }
    })
  })

  it("reports native options command timeouts without running capture", async () => {
    const { runner } = createCommandRunner([
      {
        ok: true,
        stdout: "{\"devices\":[{\"handle\":1,\"stable_id\":\"dslogic-plus\"}]}",
        stderr: ""
      },
      {
        ok: false,
        reason: "timeout",
        stdout: "partial options",
        stderr: "still waiting",
        exitCode: null,
        signal: "SIGTERM",
        nativeCode: null
      }
    ])
    const backend = createDefaultDslogicNativeDeviceOptionsBackend({
      runtime: {
        probe: async () => ({
          checkedAt,
          host: { platform: "linux", os: "linux", arch: "x64" },
          runtime: { state: "ready", libraryPath: null, binaryPath: null, version: "1.2.2" },
          devices: [],
          diagnostics: []
        })
      },
      executeCommand: runner
    })

    await expect(backend.inspectDeviceOptions(createOptionsRequest())).resolves.toMatchObject({
      ok: false,
      kind: "timeout",
      phase: "inspect-options",
      message: "Timed out while inspecting DSLogic device options.",
      optionsOutput: { text: "partial options\nstill waiting" }
    })
  })

  it("rejects unsupported tuning tokens before starting capture", async () => {
    const { runner, calls } = createCommandRunner([
      {
        ok: true,
        stdout: "{\"devices\":[{\"handle\":1,\"stable_id\":\"dslogic-plus\"}]}",
        stderr: ""
      },
      {
        ok: true,
        stdout: "{\"operations\":[\"collect\"],\"channels\":[\"buffer\"],\"stop\":[\"samples\"],\"filters\":[\"none\"],\"thresholds\":[\"1.8v\"]}",
        stderr: ""
      }
    ])
    const backend = createDefaultDslogicNativeLiveCaptureBackend({
      runtime: {
        probe: async () => ({
          checkedAt,
          host: { platform: "linux", os: "linux", arch: "x64" },
          runtime: { state: "ready", libraryPath: null, binaryPath: null, version: "1.2.2" },
          devices: [],
          diagnostics: []
        })
      },
      executeCommand: runner
    })

    await expect(backend.capture(createCaptureRequest({
      captureTuning: { operation: "unsupported" }
    }))).resolves.toMatchObject({
      ok: false,
      kind: "capture-failed",
      phase: "prepare-runtime",
      message: "Live capture request includes DSLogic tuning tokens not reported by the native runtime.",
      details: ["Unsupported capture tuning operation token unsupported. Supported tokens: collect."]
    })
    expect(calls).toHaveLength(2)
  })

  it("maps supported tuning tokens into dsview-cli capture arguments", async () => {
    const { runner, calls } = createCommandRunner([
      {
        ok: true,
        stdout: "{\"devices\":[{\"handle\":1,\"stable_id\":\"dslogic-plus\"}]}",
        stderr: ""
      },
      {
        ok: true,
        stdout: "{\"operations\":[\"collect\"],\"channels\":[\"buffer\"],\"stop\":[\"samples\"],\"filters\":[\"none\"],\"thresholds\":[\"1.8v\"]}",
        stderr: ""
      },
      {
        ok: true,
        stdout: "{\"artifacts\":{\"vcd_path\":\"/tmp/dslogic-tuned/dslogic-plus.vcd\",\"metadata_path\":\"/tmp/dslogic-tuned/dslogic-plus.json\"}}",
        stderr: ""
      }
    ])
    const backend = createDefaultDslogicNativeLiveCaptureBackend({
      runtime: {
        probe: async () => ({
          checkedAt,
          host: { platform: "linux", os: "linux", arch: "x64" },
          runtime: { state: "ready", libraryPath: "/usr/bin/dsview-cli", binaryPath: "/usr/bin/dsview-cli", version: "1.2.2" },
          devices: [],
          diagnostics: []
        })
      },
      executeCommand: runner,
      createTempDir: async () => "/tmp/dslogic-tuned",
      removeTempDir: async () => undefined,
      readTextFile: async (path) => path.endsWith(".vcd") ? "$date\n$end\n" : "{}"
    })

    await expect(backend.capture(createCaptureRequest({
      captureTuning: {
        operation: "collect",
        channel: "buffer",
        stop: "samples",
        filter: "none",
        threshold: "1.8v"
      }
    }))).resolves.toMatchObject({ ok: true })
    expect(calls[2]?.args).toEqual([
      "capture",
      "--format",
      "json",
      "--handle",
      "1",
      "--sample-rate-hz",
      "1000000",
      "--sample-limit",
      "4000",
      "--channels",
      "0",
      "--operation-mode",
      "collect",
      "--channel-mode",
      "buffer",
      "--stop-option",
      "samples",
      "--filter",
      "none",
      "--threshold-volts",
      "1.8v",
      "--output",
      "/tmp/dslogic-tuned/dslogic-plus.vcd",
      "--metadata-output",
      "/tmp/dslogic-tuned/dslogic-plus.json",
      "--wait-timeout-ms",
      "3000",
      "--poll-interval-ms",
      "50"
    ])
  })

  it("adds duration-ms while preserving sample-limit for stream captures", async () => {
    const { runner, calls } = createCommandRunner([
      {
        ok: true,
        stdout: "{\"devices\":[{\"handle\":1,\"stable_id\":\"dslogic-plus\"}]}",
        stderr: ""
      },
      {
        ok: true,
        stdout: JSON.stringify({
          operation_modes: [{ token: "stream", label: "Stream Mode" }],
          channel_modes_by_operation_mode: [
            {
              operation_mode_token: "stream",
              channel_modes: [
                { token: "use-16-channels-max-20mhz", label: "Use 16 Channels (Max 20MHz)" }
              ]
            }
          ],
          stop_options: [{ token: "upload-captured-data", label: "Upload captured data" }],
          filters: [{ token: "none", label: "None" }],
          threshold: { current_volts: 1 }
        }),
        stderr: ""
      },
      {
        ok: true,
        stdout: "{\"artifacts\":{\"vcd_path\":\"/tmp/dslogic-stream/dslogic-plus.vcd\",\"metadata_path\":\"/tmp/dslogic-stream/dslogic-plus.json\"}}",
        stderr: ""
      }
    ])
    const backend = createDefaultDslogicNativeLiveCaptureBackend({
      runtime: {
        probe: async () => ({
          checkedAt,
          host: { platform: "linux", os: "linux", arch: "x64" },
          runtime: { state: "ready", libraryPath: "/usr/bin/dsview-cli", binaryPath: "/usr/bin/dsview-cli", version: "1.2.3" },
          devices: [],
          diagnostics: []
        })
      },
      executeCommand: runner,
      createTempDir: async () => "/tmp/dslogic-stream",
      removeTempDir: async () => undefined,
      readTextFile: async (path) => path.endsWith(".vcd") ? "$date\n$end\n" : "{}"
    })

    await expect(backend.capture(createCaptureRequest({
      timeoutMs: 3_000,
      captureTuning: {
        operation: "stream",
        channel: "use-16-channels-max-20mhz",
        stop: "upload-captured-data",
        filter: "none"
      },
      session: {
        ...createCaptureRequest().session,
        sampling: {
          ...createCaptureRequest().session.sampling,
          captureDurationMs: 1000
        }
      }
    }))).resolves.toMatchObject({ ok: true })
    expect(calls[2]?.args).toEqual([
      "capture",
      "--format",
      "json",
      "--handle",
      "1",
      "--sample-rate-hz",
      "1000000",
      "--sample-limit",
      "1000000",
      "--duration-ms",
      "1000",
      "--channels",
      "0",
      "--operation-mode",
      "stream",
      "--channel-mode",
      "use-16-channels-max-20mhz",
      "--filter",
      "none",
      "--output",
      "/tmp/dslogic-stream/dslogic-plus.vcd",
      "--metadata-output",
      "/tmp/dslogic-stream/dslogic-plus.json",
      "--wait-timeout-ms",
      "6000",
      "--poll-interval-ms",
      "50"
    ])
  })

  it("lists decoder capabilities with inspected UART metadata", async () => {
    const { runner } = createCommandRunner([
      {
        ok: true,
        stdout: JSON.stringify({ decoders: [{ id: "1:uart", name: "UART", description: "Serial" }] }),
        stderr: ""
      },
      {
        ok: true,
        stdout: JSON.stringify({
          decoder: {
            id: "1:uart",
            name: "UART",
            description: "Serial",
            required_channels: [{ id: "rxtx", name: "RX/TX", description: "UART line", idn: "dec_1uart_chan_rxtx" }],
            optional_channels: [],
            options: [{ id: "baudrate", description: "Baud rate", default_value: "int64 115200", values: [] }]
          }
        }),
        stderr: ""
      }
    ])
    const backend = createDefaultDslogicNativeDecoderCapabilitiesBackend({
      runtime: {
        probe: async () => ({
          checkedAt,
          host: { platform: "linux", os: "linux", arch: "x64" },
          runtime: { state: "ready", libraryPath: "/usr/bin/dsview-cli", binaryPath: "/usr/bin/dsview-cli", version: "1.2.3" },
          devices: [],
          diagnostics: []
        })
      },
      executeCommand: runner
    })

    await expect(backend.listDecoderCapabilities({
      deviceId: "dslogic-plus",
      requestedAt: checkedAt,
      timeoutMs: 3_000
    })).resolves.toMatchObject({
      ok: true,
      decoders: [{
        decoderId: "1:uart",
        requiredChannels: [{ id: "rxtx", label: "RX/TX" }],
        options: [{ id: "baudrate", valueType: "number" }]
      }]
    })
  })

  it("captures and decodes UART bytes from DSLogic VCD events", async () => {
    const vcd = [
      "$date test $end",
      "$version test $end",
      "$timescale 1 ns $end",
      "$scope module logic $end",
      "$var wire 1 ! D0 $end",
      "$upscope $end",
      "$enddefinitions $end",
      "#0 1!",
      "#10000 0!",
      "#18681 1!",
      "#27361 0!",
      "#70764 1!",
      "#79444 0!",
      "#88125 1!"
    ].join("\n")
    const { runner } = createCommandRunner([
      {
        ok: true,
        stdout: "{\"devices\":[{\"handle\":1,\"stable_id\":\"dslogic-plus\"}]}",
        stderr: ""
      },
      {
        ok: true,
        stdout: JSON.stringify({
          operation_modes: [{ token: "stream", label: "Stream Mode" }],
          channel_modes_by_operation_mode: [{ operation_mode_token: "stream", channel_modes: [{ token: "use-16-channels-max-20mhz" }] }],
          stop_options: [{ token: "upload-captured-data" }],
          filters: [{ token: "none" }],
          threshold: { current_volts: 1 }
        }),
        stderr: ""
      },
      {
        ok: true,
        stdout: "{\"artifacts\":{\"vcd_path\":\"/tmp/dslogic-decode/dslogic-plus.vcd\",\"metadata_path\":\"/tmp/dslogic-decode/dslogic-plus.json\"}}",
        stderr: ""
      },
      {
        ok: true,
        stdout: JSON.stringify({
          decoder: {
            id: "1:uart",
            required_channels: [{ id: "rxtx", idn: "dec_1uart_chan_rxtx" }],
            optional_channels: [],
            options: [{ id: "baudrate", default_value: "int64 115200", values: [] }]
          }
        }),
        stderr: ""
      },
      {
        ok: true,
        stdout: JSON.stringify({
          report: {
            run: { status: "success", root_decoder_id: "1:uart" },
            events: [{ annotation_class: 0, annotation_type: 108, texts: ["A"], raw_texts: ["\n"], numeric_value: 65 }]
          }
        }),
        stderr: ""
      }
    ])
    const writtenFiles = new Map<string, string>()
    const backend = createDefaultDslogicNativeCaptureDecodeBackend({
      runtime: {
        probe: async () => ({
          checkedAt,
          host: { platform: "linux", os: "linux", arch: "x64" },
          runtime: { state: "ready", libraryPath: "/usr/bin/dsview-cli", binaryPath: "/usr/bin/dsview-cli", version: "1.2.3" },
          devices: [],
          diagnostics: []
        })
      },
      executeCommand: runner,
      createTempDir: async () => "/tmp/dslogic-decode",
      removeTempDir: async () => undefined,
      writeTextFile: async (path, content) => {
        writtenFiles.set(path, content)
      },
      readTextFile: async (path) => path.endsWith(".vcd")
        ? vcd
        : path.endsWith("decode-report.json")
          ? JSON.stringify({
              report: {
                run: { status: "success", root_decoder_id: "1:uart" },
                events: [{ annotation_class: 0, annotation_type: 108, texts: ["A"], raw_texts: ["\n"], numeric_value: 65 }]
              }
            })
          : JSON.stringify({
            tool: { version: "1.2.3" },
            capture: { timestamp_utc: checkedAt, sample_rate_hz: 1_000_000, requested_sample_limit: 120, actual_sample_count: 120 }
          })
    })

    const result = await backend.captureDecode({
      ...createCaptureRequest({
        timeoutMs: 3_000,
        captureTuning: { operation: "stream", channel: "use-16-channels-max-20mhz", filter: "none" },
        session: {
          ...createCaptureRequest().session,
          sampling: {
            sampleRateHz: 1_000_000,
            captureDurationMs: 1,
            channels: [{ channelId: "D0" }]
          }
        }
      }),
      decode: {
        decoderId: "1:uart",
        channelMappings: { rxtx: "D0" },
        decoderOptions: { baudrate: 115200, num_data_bits: 8, invert: "no" }
      }
    })

    const decodeInput = JSON.parse(writtenFiles.get("/tmp/dslogic-decode/decode-input.json") ?? "{}")
    expect(decodeInput).toMatchObject({
      samplerate_hz: 1_000_000,
      format: "cross_logic",
      unitsize: 1,
      channel_count: 1
    })
    expect(decodeInput.sample_bytes).toHaveLength(16)

    expect(result).toMatchObject({
      ok: true,
      decode: {
        decoderId: "1:uart",
        annotations: [{ annotation_class: 0, annotation_type: 108, texts: ["A"], raw_texts: ["\n"], numeric_value: 65 }],
        rows: [{ id: "events" }]
      }
    })
  })

})
