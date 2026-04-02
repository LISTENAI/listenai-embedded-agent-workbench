import { describe, expect, it } from "vitest"
import { DslogicDeviceProvider } from "./dslogic-device-provider.js"
import {
  FakeDslogicBackendProbe,
  createClassicDslogicCandidate,
  createDslogicProbeSnapshot,
  createPangoDslogicCandidate,
  createUnknownDslogicCandidate
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
        backendKinds: ["libsigrok"]
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
          backendKind: "libsigrok",
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
          backendKind: "libsigrok",
          readiness: "ready",
          version: "0.6.0",
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
        backendKind: "libsigrok",
        readiness: "missing",
        version: null,
        checkedAt: refreshedAt,
        diagnostics: [
          {
            code: "backend-missing-runtime",
            severity: "error",
            target: "backend",
            message: "libsigrok runtime is not available on macos.",
            platform: "macos",
            backendKind: "libsigrok",
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
              code: "backend-missing-runtime"
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
              code: "backend-runtime-timeout"
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
              code: "backend-runtime-timeout",
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

  it("marks V421/Pango as a first-class unsupported variant without backend leakage when ready", async () => {
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
      backendKind: "libsigrok",
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
        backendKind: "libsigrok"
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
      backendKind: "libsigrok",
      readiness: "degraded",
      version: null,
      checkedAt: refreshedAt,
      diagnostics: [
        {
          code: "backend-runtime-timeout",
          severity: "warning",
          target: "backend",
          message: "libsigrok runtime probe timed out before readiness was confirmed on linux.",
          platform: "linux",
          backendKind: "libsigrok",
          backendVersion: null
        }
      ]
    })
    expect(device?.readiness).toBe("degraded")
    expect(device?.diagnostics).toContainEqual({
      code: "backend-runtime-timeout",
      severity: "warning",
      target: "backend",
      message: "libsigrok runtime probe timed out before readiness was confirmed on linux.",
      platform: "linux",
      backendKind: "libsigrok",
      backendVersion: null,
      deviceId: "logic-ready"
    })
    expect(await provider.listConnectedDevices()).toEqual([])
  })

  it("preserves backend-failed diagnostics on discovered classic rows", async () => {
    const provider = new DslogicDeviceProvider({
      probe: new FakeDslogicBackendProbe(
        createDslogicProbeSnapshot({
          checkedAt: refreshedAt,
          platform: "macos",
          backendState: "failed",
          version: null,
          devices: [
            createClassicDslogicCandidate({
              deviceId: "logic-failed",
              label: "DSLogic Plus Failed Backend",
              lastSeenAt: refreshedAt
            })
          ]
        })
      )
    })

    const snapshot = await provider.listInventorySnapshot()

    expect(snapshot.backendReadiness).toEqual([
      {
        platform: "macos",
        backendKind: "libsigrok",
        readiness: "degraded",
        version: null,
        checkedAt: refreshedAt,
        diagnostics: [
          {
            code: "backend-runtime-failed",
            severity: "error",
            target: "backend",
            message: "libsigrok runtime probe failed on macos.",
            platform: "macos",
            backendKind: "libsigrok",
            backendVersion: null
          }
        ]
      }
    ])
    expect(snapshot.devices).toEqual([
      {
        deviceId: "logic-failed",
        label: "DSLogic Plus Failed Backend",
        capabilityType: "logic-analyzer",
        connectionState: "connected",
        allocationState: "free",
        ownerSkillId: null,
        lastSeenAt: refreshedAt,
        updatedAt: refreshedAt,
        readiness: "degraded",
        diagnostics: [
          {
            code: "backend-runtime-failed",
            severity: "error",
            target: "backend",
            message: "libsigrok runtime probe failed on macos.",
            platform: "macos",
            backendKind: "libsigrok",
            backendVersion: null,
            deviceId: "logic-failed"
          }
        ],
        providerKind: "dslogic",
        backendKind: "libsigrok",
        dslogic: {
          family: "dslogic",
          model: "dslogic-plus",
          modelDisplayName: "DSLogic Plus",
          variant: "classic",
          usbVendorId: "2a0e",
          usbProductId: "0001"
        }
      }
    ])
    expect(await provider.listConnectedDevices()).toEqual([])
  })

  it("keeps malformed backend diagnostics visible when no candidates survive discovery", async () => {
    const provider = new DslogicDeviceProvider({
      probe: new FakeDslogicBackendProbe(
        createDslogicProbeSnapshot({
          checkedAt: refreshedAt,
          platform: "macos",
          backendState: "malformed",
          version: null,
          devices: []
        })
      )
    })

    await expect(provider.listInventorySnapshot()).resolves.toEqual({
      refreshedAt,
      inventoryScope: {
        providerKinds: ["dslogic"],
        backendKinds: ["libsigrok"]
      },
      devices: [],
      backendReadiness: [
        {
          platform: "macos",
          backendKind: "libsigrok",
          readiness: "degraded",
          version: null,
          checkedAt: refreshedAt,
          diagnostics: [
            {
              code: "backend-runtime-malformed-response",
              severity: "error",
              target: "backend",
              message: "libsigrok runtime probe returned malformed output on macos.",
              platform: "macos",
              backendKind: "libsigrok",
              backendVersion: null
            }
          ]
        }
      ],
      diagnostics: [
        {
          code: "backend-runtime-malformed-response",
          severity: "error",
          target: "backend",
          message: "libsigrok runtime probe returned malformed output on macos.",
          platform: "macos",
          backendKind: "libsigrok",
          backendVersion: null
        }
      ]
    })
  })

  it("treats malformed probe output and missing variant hints as unsupported diagnostics", async () => {
    const provider = new DslogicDeviceProvider({
      probe: new FakeDslogicBackendProbe(
        createDslogicProbeSnapshot({
          checkedAt: refreshedAt,
          platform: "macos",
          backendState: "malformed",
          version: null,
          devices: [
            createUnknownDslogicCandidate({
              deviceId: "logic-unknown",
              lastSeenAt: refreshedAt,
              usbProductId: "9999",
              variantHint: null,
              modelDisplayName: "Unknown DSLogic"
            }),
            createUnknownDslogicCandidate({
              deviceId: "logic-missing-usb",
              label: "Mystery DSLogic",
              lastSeenAt: refreshedAt,
              usbVendorId: null,
              usbProductId: null,
              variantHint: null,
              modelDisplayName: "Mystery DSLogic"
            })
          ]
        })
      )
    })

    const snapshot = await provider.listInventorySnapshot()

    expect(snapshot.backendReadiness[0]?.readiness).toBe("degraded")
    expect(snapshot.devices).toEqual([
      {
        deviceId: "logic-unknown",
        label: "Unknown DSLogic",
        capabilityType: "logic-analyzer",
        connectionState: "connected",
        allocationState: "free",
        ownerSkillId: null,
        lastSeenAt: refreshedAt,
        updatedAt: refreshedAt,
        readiness: "unsupported",
        diagnostics: [
          {
            code: "device-runtime-malformed-response",
            severity: "warning",
            target: "device",
            message: "Unable to classify DSLogic variant 2a0e:9999.",
            deviceId: "logic-unknown",
            backendKind: "libsigrok"
          },
          {
            code: "backend-runtime-malformed-response",
            severity: "error",
            target: "backend",
            message: "libsigrok runtime probe returned malformed output on macos.",
            platform: "macos",
            backendKind: "libsigrok",
            backendVersion: null,
            deviceId: "logic-unknown"
          }
        ],
        providerKind: "dslogic",
        backendKind: "libsigrok",
        dslogic: {
          family: "dslogic",
          model: "dslogic-plus",
          modelDisplayName: "Unknown DSLogic",
          variant: "2a0e:9999",
          usbVendorId: "2a0e",
          usbProductId: "9999"
        }
      },
      {
        deviceId: "logic-missing-usb",
        label: "Mystery DSLogic",
        capabilityType: "logic-analyzer",
        connectionState: "connected",
        allocationState: "free",
        ownerSkillId: null,
        lastSeenAt: refreshedAt,
        updatedAt: refreshedAt,
        readiness: "unsupported",
        diagnostics: [
          {
            code: "device-runtime-malformed-response",
            severity: "warning",
            target: "device",
            message: "Unable to classify DSLogic variant missing-usb-id.",
            deviceId: "logic-missing-usb",
            backendKind: "libsigrok"
          },
          {
            code: "backend-runtime-malformed-response",
            severity: "error",
            target: "backend",
            message: "libsigrok runtime probe returned malformed output on macos.",
            platform: "macos",
            backendKind: "libsigrok",
            backendVersion: null,
            deviceId: "logic-missing-usb"
          }
        ],
        providerKind: "dslogic",
        backendKind: "libsigrok",
        dslogic: {
          family: "dslogic",
          model: "dslogic-plus",
          modelDisplayName: "Mystery DSLogic",
          variant: "missing-usb-id",
          usbVendorId: null,
          usbProductId: null
        }
      }
    ])
    expect(await provider.listConnectedDevices()).toEqual([])
  })

  it("keeps compatibility-visible devices limited to connected ready rows in mixed snapshots", async () => {
    const provider = new DslogicDeviceProvider({
      probe: new FakeDslogicBackendProbe(
        createDslogicProbeSnapshot({
          checkedAt: refreshedAt,
          platform: "linux",
          devices: [
            createClassicDslogicCandidate({
              deviceId: "logic-ready-a",
              label: "DSLogic Plus Ready A",
              lastSeenAt: refreshedAt
            }),
            createPangoDslogicCandidate({
              deviceId: "logic-unsupported",
              lastSeenAt: refreshedAt
            }),
            createUnknownDslogicCandidate({
              deviceId: "logic-unknown-b",
              label: "Unknown DSLogic B",
              lastSeenAt: refreshedAt,
              usbProductId: "9999",
              variantHint: null,
              modelDisplayName: "Unknown DSLogic B"
            }),
            createClassicDslogicCandidate({
              deviceId: "logic-ready-b",
              label: "DSLogic Plus Ready B",
              lastSeenAt: refreshedAt
            })
          ]
        })
      )
    })

    const snapshot = await provider.listInventorySnapshot()

    expect(snapshot.devices.map((device) => [device.deviceId, device.readiness])).toEqual([
      ["logic-ready-a", "ready"],
      ["logic-unsupported", "unsupported"],
      ["logic-unknown-b", "unsupported"],
      ["logic-ready-b", "ready"]
    ])
    await expect(provider.listConnectedDevices()).resolves.toEqual([
      {
        deviceId: "logic-ready-a",
        label: "DSLogic Plus Ready A",
        capabilityType: "logic-analyzer",
        lastSeenAt: refreshedAt
      },
      {
        deviceId: "logic-ready-b",
        label: "DSLogic Plus Ready B",
        capabilityType: "logic-analyzer",
        lastSeenAt: refreshedAt
      }
    ])
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
        backendKinds: ["libsigrok"]
      },
      devices: [],
      backendReadiness: [
        {
          platform: "macos",
          backendKind: "libsigrok",
          readiness: "degraded",
          version: null,
          checkedAt: refreshedAt,
          diagnostics: [
            {
              code: "backend-runtime-failed",
              severity: "error",
              target: "backend",
              message: "DSLogic probe threw: spawn EACCES",
              platform: "macos",
              backendKind: "libsigrok",
              backendVersion: null
            }
          ]
        }
      ],
      diagnostics: [
        {
          code: "backend-runtime-failed",
          severity: "error",
          target: "backend",
          message: "DSLogic probe threw: spawn EACCES",
          platform: "macos",
          backendKind: "libsigrok",
          backendVersion: null
        }
      ]
    })
  })
})
