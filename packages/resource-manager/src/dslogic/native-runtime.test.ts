import { describe, expect, it } from "vitest"
import {
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
        version: null
      },
      devices: [],
      diagnostics: []
    })
    expect(calls).toEqual([])
  })

  it("keeps non-macos hosts explicit without spawning sigrok-cli", async () => {
    const { runner, calls } = createCommandRunner([])
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
        state: "missing",
        libraryPath: null,
        version: null
      },
      devices: [],
      diagnostics: []
    })
    expect(calls).toEqual([])
  })

  it("maps bounded macOS sigrok-cli success into ready runtime metadata and DSLogic candidates", async () => {
    const { runner, calls } = createCommandRunner([
      {
        ok: true,
        stdout: "sigrok-cli 0.7.2\n",
        stderr: "library path=/opt/homebrew/lib/libsigrok.dylib\n"
      },
      {
        ok: true,
        stdout: [
          "The following devices were found:",
          "demo - Demo device with 8 channels: conn=demo",
          "dslogic - DSLogic Plus with 16 channels: conn=usb:1-4",
          "dslogic - DSLogic V421/Pango with 16 channels: serial=pango-002"
        ].join("\n"),
        stderr: "sr: scan completed\n"
      }
    ])

    const runtime = createDslogicNativeRuntime({
      now: () => checkedAt,
      getHostOs: () => "darwin",
      getHostArch: () => "arm64",
      executeCommand: runner,
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
        libraryPath: "/opt/homebrew/lib/libsigrok.dylib",
        version: "0.7.2"
      },
      devices: [
        {
          deviceId: "usb:1-4",
          label: "DSLogic Plus",
          lastSeenAt: checkedAt,
          capabilityType: "logic-analyzer",
          usbVendorId: "2a0e",
          usbProductId: "0001",
          model: "dslogic-plus",
          modelDisplayName: "DSLogic Plus",
          variantHint: null
        },
        {
          deviceId: "pango-002",
          label: "DSLogic V421/Pango",
          lastSeenAt: checkedAt,
          capabilityType: "logic-analyzer",
          usbVendorId: "2a0e",
          usbProductId: "0030",
          model: "dslogic-plus",
          modelDisplayName: "DSLogic V421/Pango",
          variantHint: "v421-pango"
        }
      ],
      diagnostics: []
    })
    expect(calls).toEqual([
      {
        command: "sigrok-cli",
        args: ["--version"],
        timeoutMs: 1234,
        maxBufferBytes: 64 * 1024
      },
      {
        command: "sigrok-cli",
        args: ["--scan"],
        timeoutMs: 1234,
        maxBufferBytes: 64 * 1024
      }
    ])
  })

  it("keeps runtime ready when sigrok-cli reports no DSLogic device rows yet", async () => {
    const { runner } = createCommandRunner([
      {
        ok: true,
        stdout: "sigrok-cli 0.7.1\n",
        stderr: ""
      },
      {
        ok: true,
        stdout: "The following devices were found:\nfx2lafw - CWAV USBee SX with 8 channels: conn=1.23\n",
        stderr: ""
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
        version: "0.7.1"
      },
      devices: [],
      diagnostics: []
    })
  })

  it("maps missing sigrok-cli into the existing missing-runtime diagnostic", async () => {
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
      executeCommand: runner
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
        version: null
      },
      devices: [],
      diagnostics: [
        {
          code: "backend-missing-runtime",
          message: "libsigrok runtime is not available on macos.",
          libraryPath: null,
          backendVersion: null
        }
      ]
    })
    expect(calls).toHaveLength(1)
  })

  it("maps macOS probe timeouts into the existing timeout state", async () => {
    const { runner } = createCommandRunner([
      {
        ok: false,
        reason: "timeout",
        stdout: "sigrok-cli 0.7.2\n",
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
        version: null
      },
      diagnostics: [
        {
          code: "backend-runtime-timeout",
          message: "libsigrok runtime probe timed out before readiness was confirmed on macos."
        }
      ]
    })
  })

  it("maps non-zero scan failures into the existing failed state while preserving parsed version", async () => {
    const { runner } = createCommandRunner([
      {
        ok: true,
        stdout: "sigrok-cli 0.7.2\nlibdir=/opt/homebrew/lib\n",
        stderr: ""
      },
      {
        ok: false,
        reason: "failed",
        stdout: "",
        stderr: "driver init failed",
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
        libraryPath: "/opt/homebrew/lib",
        version: "0.7.2"
      },
      diagnostics: [
        {
          code: "backend-runtime-failed",
          message: "libsigrok runtime probe failed on macos.",
          libraryPath: "/opt/homebrew/lib",
          backendVersion: "0.7.2"
        }
      ]
    })
  })

  it("rejects truncated version output as malformed without scanning further", async () => {
    const { runner, calls } = createCommandRunner([
      {
        ok: true,
        stdout: "sigrok cli version unknown\n",
        stderr: ""
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
        version: null
      },
      diagnostics: [
        {
          code: "backend-runtime-malformed-response",
          message: "libsigrok runtime probe returned malformed output on macos."
        }
      ]
    })
    expect(calls).toHaveLength(1)
  })

  it("treats empty scan output as malformed even after a valid version probe", async () => {
    const { runner } = createCommandRunner([
      {
        ok: true,
        stdout: "sigrok-cli 0.7.2\n",
        stderr: "library path=/opt/homebrew/lib/libsigrok.dylib\n"
      },
      {
        ok: true,
        stdout: "",
        stderr: ""
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
        libraryPath: "/opt/homebrew/lib/libsigrok.dylib",
        version: "0.7.2"
      },
      diagnostics: [
        {
          code: "backend-runtime-malformed-response",
          backendVersion: "0.7.2",
          libraryPath: "/opt/homebrew/lib/libsigrok.dylib"
        }
      ]
    })
  })
})
