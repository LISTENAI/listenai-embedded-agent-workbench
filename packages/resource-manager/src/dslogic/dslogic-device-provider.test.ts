import { describe, expect, it } from "vitest"
import { DslogicDeviceProvider } from "./dslogic-device-provider.js"
import {
  FakeDslogicBackendProbe,
  createClassicDslogicCandidate,
  createDslogicProbeSnapshot,
  createPangoDslogicCandidate
} from "../testing/fake-dslogic-probe.js"

const refreshedAt = "2026-03-30T10:00:00.000Z"

describe("DslogicDeviceProvider", () => {
  it("maps a classic DSLogic Plus into a ready device when the backend is ready", async () => {
    const provider = new DslogicDeviceProvider({
      probe: new FakeDslogicBackendProbe(
        createDslogicProbeSnapshot({
          checkedAt: refreshedAt,
          platform: "linux",
          devices: [createClassicDslogicCandidate({ lastSeenAt: refreshedAt })]
        })
      )
    })

    const snapshot = await provider.listInventorySnapshot()

    expect(snapshot).toEqual({
      refreshedAt,
      inventoryScope: {
        providerKinds: ["dslogic"],
        backendKinds: ["dsview"]
      },
      devices: [
        {
          deviceId: "logic-ready",
          label: "DSLogic Plus Ready",
          capabilityType: "logic-analyzer",
          connectionState: "connected",
          allocationState: "free",
          ownerSkillId: null,
          lastSeenAt: refreshedAt,
          updatedAt: refreshedAt,
          readiness: "ready",
          diagnostics: [],
          providerKind: "dslogic",
          backendKind: "dsview",
          dslogic: {
            family: "dslogic",
            model: "dslogic-plus",
            modelDisplayName: "DSLogic Plus",
            variant: "classic",
            usbVendorId: "2a0e",
            usbProductId: "0001"
          }
        }
      ],
      backendReadiness: [
        {
          platform: "linux",
          backendKind: "dsview",
          readiness: "ready",
          executablePath: "/Applications/DSView.app/Contents/MacOS/dsview",
          version: "1.3.1",
          checkedAt: refreshedAt,
          diagnostics: []
        }
      ],
      diagnostics: []
    })

    expect(await provider.listConnectedDevices()).toEqual([
      {
        deviceId: "logic-ready",
        label: "DSLogic Plus Ready",
        capabilityType: "logic-analyzer",
        lastSeenAt: refreshedAt
      }
    ])
  })

  it("keeps backend-missing snapshots visible without fabricating ready devices", async () => {
    const provider = new DslogicDeviceProvider({
      probe: new FakeDslogicBackendProbe(
        createDslogicProbeSnapshot({
          checkedAt: refreshedAt,
          platform: "macos",
          backendState: "missing",
          executablePath: null,
          version: null,
          devices: []
        })
      )
    })

    const snapshot = await provider.listInventorySnapshot()

    expect(snapshot.devices).toEqual([])
    expect(snapshot.backendReadiness).toEqual([
      {
        platform: "macos",
        backendKind: "dsview",
        readiness: "missing",
        executablePath: null,
        version: null,
        checkedAt: refreshedAt,
        diagnostics: [
          {
            code: "backend-missing-executable",
            severity: "error",
            target: "backend",
            message: "DSView executable dsview was not found on macos.",
            platform: "macos",
            backendKind: "dsview",
            executablePath: null,
            backendVersion: null
          }
        ]
      }
    ])
    expect(snapshot.diagnostics).toEqual(snapshot.backendReadiness[0]?.diagnostics)
    expect(await provider.listConnectedDevices()).toEqual([])
  })

  it("freezes Linux/macOS/Windows readiness semantics to the shared contract vocabulary", async () => {
    const linuxProvider = new DslogicDeviceProvider({
      probe: new FakeDslogicBackendProbe(
        createDslogicProbeSnapshot({
          checkedAt: refreshedAt,
          platform: "linux",
          backendState: "ready",
          devices: [
            createClassicDslogicCandidate({
              deviceId: "logic-linux",
              lastSeenAt: refreshedAt
            })
          ]
        })
      )
    })
    const macosProvider = new DslogicDeviceProvider({
      probe: new FakeDslogicBackendProbe(
        createDslogicProbeSnapshot({
          checkedAt: refreshedAt,
          platform: "macos",
          backendState: "missing",
          executablePath: null,
          version: null,
          devices: []
        })
      )
    })
    const windowsProvider = new DslogicDeviceProvider({
      probe: new FakeDslogicBackendProbe(
        createDslogicProbeSnapshot({
          checkedAt: refreshedAt,
          platform: "windows",
          backendState: "timeout",
          version: null,
          devices: [
            createClassicDslogicCandidate({
              deviceId: "logic-windows",
              lastSeenAt: refreshedAt
            })
          ]
        })
      )
    })

    await expect(linuxProvider.listInventorySnapshot()).resolves.toMatchObject({
      backendReadiness: [
        {
          platform: "linux",
          readiness: "ready",
          diagnostics: []
        }
      ],
      devices: [
        {
          deviceId: "logic-linux",
          readiness: "ready",
          diagnostics: []
        }
      ]
    })
    await expect(macosProvider.listInventorySnapshot()).resolves.toMatchObject({
      backendReadiness: [
        {
          platform: "macos",
          readiness: "missing",
          diagnostics: [
            {
              code: "backend-missing-executable"
            }
          ]
        }
      ],
      devices: []
    })
    await expect(windowsProvider.listInventorySnapshot()).resolves.toMatchObject({
      backendReadiness: [
        {
          platform: "windows",
          readiness: "degraded",
          diagnostics: [
            {
              code: "backend-probe-timeout"
            }
          ]
        }
      ],
      devices: [
        {
          deviceId: "logic-windows",
          readiness: "degraded",
          diagnostics: [
            {
              code: "backend-probe-timeout",
              deviceId: "logic-windows"
            }
          ]
        }
      ]
    })

    await expect(linuxProvider.listConnectedDevices()).resolves.toEqual([
      {
        deviceId: "logic-linux",
        label: "DSLogic Plus Ready",
        capabilityType: "logic-analyzer",
        lastSeenAt: refreshedAt
      }
    ])
    await expect(macosProvider.listConnectedDevices()).resolves.toEqual([])
    await expect(windowsProvider.listConnectedDevices()).resolves.toEqual([])
  })

  it("marks V421/Pango as a first-class unsupported variant", async () => {
    const provider = new DslogicDeviceProvider({
      probe: new FakeDslogicBackendProbe(
        createDslogicProbeSnapshot({
          checkedAt: refreshedAt,
          platform: "windows",
          devices: [createPangoDslogicCandidate()]
        })
      )
    })

    const snapshot = await provider.listInventorySnapshot()
    const device = snapshot.devices[0]

    expect(device).toMatchObject({
      deviceId: "logic-pango",
      readiness: "unsupported",
      providerKind: "dslogic",
      backendKind: "dsview",
      dslogic: {
        variant: "v421-pango",
        usbVendorId: "2a0e",
        usbProductId: "0030"
      }
    })
    expect(device?.diagnostics).toEqual([
      {
        code: "device-unsupported-variant",
        severity: "error",
        target: "device",
        message: "Variant V421/Pango (2a0e:0030) is not supported.",
        deviceId: "logic-pango",
        backendKind: "dsview"
      }
    ])
    expect(snapshot.diagnostics).toContainEqual(device?.diagnostics?.[0])
    expect(await provider.listConnectedDevices()).toEqual([])
  })

  it("downgrades classic hardware to degraded when the backend probe times out", async () => {
    const provider = new DslogicDeviceProvider({
      probe: new FakeDslogicBackendProbe(
        createDslogicProbeSnapshot({
          checkedAt: refreshedAt,
          platform: "linux",
          backendState: "timeout",
          version: null,
          devices: [createClassicDslogicCandidate()]
        })
      )
    })

    const snapshot = await provider.listInventorySnapshot()
    const device = snapshot.devices[0]

    expect(snapshot.backendReadiness[0]).toEqual({
      platform: "linux",
      backendKind: "dsview",
      readiness: "degraded",
      executablePath: "/Applications/DSView.app/Contents/MacOS/dsview",
      version: null,
      checkedAt: refreshedAt,
      diagnostics: [
        {
          code: "backend-probe-timeout",
          severity: "warning",
          target: "backend",
          message: "DSView probe timed out before readiness was confirmed on linux.",
          platform: "linux",
          backendKind: "dsview",
          executablePath: "/Applications/DSView.app/Contents/MacOS/dsview",
          backendVersion: null
        }
      ]
    })
    expect(device?.readiness).toBe("degraded")
    expect(device?.diagnostics).toContainEqual({
      code: "backend-probe-timeout",
      severity: "warning",
      target: "backend",
      message: "DSView probe timed out before readiness was confirmed on linux.",
      platform: "linux",
      backendKind: "dsview",
      executablePath: "/Applications/DSView.app/Contents/MacOS/dsview",
      backendVersion: null,
      deviceId: "logic-ready"
    })
    expect(await provider.listConnectedDevices()).toEqual([])
  })

  it("treats malformed probe output and unknown variants as unsupported or degraded diagnostics", async () => {
    const provider = new DslogicDeviceProvider({
      probe: new FakeDslogicBackendProbe(
        createDslogicProbeSnapshot({
          checkedAt: refreshedAt,
          platform: "macos",
          backendState: "malformed",
          version: null,
          devices: [
            createClassicDslogicCandidate({
              deviceId: "logic-unknown",
              usbProductId: "9999",
              variantHint: null,
              modelDisplayName: "Unknown DSLogic"
            })
          ]
        })
      )
    })

    const snapshot = await provider.listInventorySnapshot()
    const device = snapshot.devices[0]

    expect(snapshot.backendReadiness[0]?.readiness).toBe("degraded")
    expect(snapshot.backendReadiness[0]?.diagnostics).toEqual([
      {
        code: "backend-probe-malformed-output",
        severity: "error",
        target: "backend",
        message: "DSView probe returned malformed output on macos.",
        platform: "macos",
        backendKind: "dsview",
        executablePath: "/Applications/DSView.app/Contents/MacOS/dsview",
        backendVersion: null
      }
    ])
    expect(device).toMatchObject({
      deviceId: "logic-unknown",
      readiness: "unsupported",
      dslogic: {
        variant: "2a0e:9999"
      }
    })
    expect(device?.diagnostics).toContainEqual({
      code: "device-probe-malformed-output",
      severity: "warning",
      target: "device",
      message: "Unable to classify DSLogic variant 2a0e:9999.",
      deviceId: "logic-unknown",
      backendKind: "dsview"
    })
    expect(await provider.listConnectedDevices()).toEqual([])
  })

  it("returns a degraded backend snapshot instead of throwing when the probe crashes", async () => {
    const provider = new DslogicDeviceProvider({
      probe: new FakeDslogicBackendProbe(new Error("spawn EACCES")),
      now: () => refreshedAt,
      getHostPlatform: () => "darwin"
    })

    await expect(provider.listInventorySnapshot()).resolves.toEqual({
      refreshedAt,
      inventoryScope: {
        providerKinds: ["dslogic"],
        backendKinds: ["dsview"]
      },
      devices: [],
      backendReadiness: [
        {
          platform: "macos",
          backendKind: "dsview",
          readiness: "degraded",
          executablePath: null,
          version: null,
          checkedAt: refreshedAt,
          diagnostics: [
            {
              code: "backend-probe-failed",
              severity: "error",
              target: "backend",
              message: "DSLogic probe threw: spawn EACCES",
              platform: "macos",
              backendKind: "dsview",
              executablePath: null,
              backendVersion: null
            }
          ]
        }
      ],
      diagnostics: [
        {
          code: "backend-probe-failed",
          severity: "error",
          target: "backend",
          message: "DSLogic probe threw: spawn EACCES",
          platform: "macos",
          backendKind: "dsview",
          executablePath: null,
          backendVersion: null
        }
      ]
    })
  })
})
