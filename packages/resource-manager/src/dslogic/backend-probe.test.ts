import { describe, expect, it } from "vitest"
import {
  createDslogicBackendProbe,
  parseMacosUsbDevices,
  type CreateDslogicBackendProbeOptions
} from "./backend-probe.js"

const checkedAt = "2026-03-31T08:00:00.000Z"

const macosUsbSnapshot = JSON.stringify(
  {
    SPUSBDataType: [
      {
        _name: "USB 3.0 Bus",
        _items: [
          {
            _name: "DSLogic Plus",
            vendor_id: "0x2A0E (DreamSourceLab)",
            product_id: "0x0001",
            serial_num: "dsl-classic-001",
            location_id: "0x00100000 / 3"
          },
          {
            _name: "DSLogic V421/Pango",
            vendor_id: "0x2A0E (DreamSourceLab)",
            product_id: "0x0030",
            location_id: "0x00200000 / 8"
          },
          {
            _name: "USB Keyboard",
            vendor_id: "0x05ac (Apple)",
            product_id: "0x024f"
          }
        ]
      }
    ]
  },
  null,
  2
)

describe("backend-probe", () => {
  it("parses DSLogic-class USB devices from macOS system_profiler output", () => {
    expect(parseMacosUsbDevices(macosUsbSnapshot, checkedAt)).toEqual([
      {
        deviceId: "dsl-classic-001",
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
        deviceId: "0x00200000 / 8",
        label: "DSLogic V421/Pango",
        lastSeenAt: checkedAt,
        capabilityType: "logic-analyzer",
        usbVendorId: "2a0e",
        usbProductId: "0030",
        model: "dslogic-plus",
        modelDisplayName: "DSLogic V421/Pango",
        variantHint: null
      }
    ])
  })

  it("maps libsigrok runtime metadata into the backend probe snapshot", async () => {
    const probeRuntime: NonNullable<CreateDslogicBackendProbeOptions["probeRuntime"]> = async (
      host
    ) => ({
      runtime: {
        state: "ready",
        libraryPath: host.platform === "macos" ? "/opt/homebrew/lib/libsigrok.dylib" : null,
        version: "0.6.0"
      },
      devices: parseMacosUsbDevices(macosUsbSnapshot, checkedAt),
      diagnostics: []
    })

    const probe = createDslogicBackendProbe({
      now: () => checkedAt,
      getHostPlatform: () => "darwin",
      getHostArch: () => "arm64",
      probeRuntime
    })

    await expect(probe.probeInventory()).resolves.toEqual({
      platform: "macos",
      checkedAt,
      host: {
        platform: "macos",
        os: "darwin",
        arch: "arm64"
      },
      backend: {
        state: "ready",
        libraryPath: "/opt/homebrew/lib/libsigrok.dylib",
        version: "0.6.0"
      },
      devices: [
        {
          deviceId: "dsl-classic-001",
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
          deviceId: "0x00200000 / 8",
          label: "DSLogic V421/Pango",
          lastSeenAt: checkedAt,
          capabilityType: "logic-analyzer",
          usbVendorId: "2a0e",
          usbProductId: "0030",
          model: "dslogic-plus",
          modelDisplayName: "DSLogic V421/Pango",
          variantHint: null
        }
      ],
      diagnostics: []
    })
  })

  it("keeps DSLogic candidates visible when libsigrok is missing", async () => {
    const probeRuntime: NonNullable<CreateDslogicBackendProbeOptions["probeRuntime"]> = async () => ({
      runtime: {
        state: "missing",
        libraryPath: null,
        version: null
      },
      devices: parseMacosUsbDevices(macosUsbSnapshot, checkedAt),
      diagnostics: []
    })

    const probe = createDslogicBackendProbe({
      now: () => checkedAt,
      getHostPlatform: () => "darwin",
      getHostArch: () => "arm64",
      probeRuntime
    })

    await expect(probe.probeInventory()).resolves.toMatchObject({
      platform: "macos",
      host: {
        platform: "macos",
        os: "darwin",
        arch: "arm64"
      },
      backend: {
        state: "missing",
        libraryPath: null,
        version: null
      },
      devices: [
        {
          deviceId: "dsl-classic-001",
          usbVendorId: "2a0e",
          usbProductId: "0001"
        },
        {
          deviceId: "0x00200000 / 8",
          usbVendorId: "2a0e",
          usbProductId: "0030"
        }
      ]
    })
  })
})
